"""镜头对象范围的确认、历史兼容、AI 纠错和固定编译验证。"""

from copy import deepcopy
import json
from types import SimpleNamespace

import pytest
from sqlalchemy import update

from app.core.contracts.directing.design import SceneDesign
from app.core.contracts.directing.production import GenerationUnit
from app.models.directing import DirectingRevision
from app.services.directing.ai import generate_directing_result, DirectingOutputError
from app.services.directing.production import ProductionService
from tests.directing.samples import design_sample, plan_sample
from tests.directing.test_store import database
from tests.directing.test_production import prepare


@pytest.mark.asyncio
async def test_unknown_scope_saves_but_confirmation_requires_explicit_scope(tmp_path):
    """草稿可保留未知；确认后空名单与明确名单无损持久化。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProductionService(db, "p1")
            sequence = await service.create_sequence(chapter_id="ch1", title="对象范围", position=0)
            data = design_sample()
            del data["direction"]["shots"][0]["participant_ids"]
            draft = await service.save_revision(sequence.id, kind="design", payload=data)
            assert (await service.read_revision(draft.id)).content.direction.shots[0].participant_ids is None
            with pytest.raises(ValueError, match="s1.*参与对象范围待核对"):
                await service.confirm_revision(draft.id, expected_version=draft.version, actor_id="author")
            assert (await service.revision(draft.id)).confirmed_at is None
            data["direction"]["shots"][0]["participant_ids"] = []
            saved = await service.save_revision(sequence.id, kind="design", payload=data,
                revision_id=draft.id, expected_version=draft.version)
            confirmed = await service.confirm_revision(saved.id, expected_version=saved.version, actor_id="author")
            design_id = confirmed.id
        async with sessions.begin() as db:
            content = (await ProductionService(db, "p1").read_revision(design_id)).content
            assert [shot.participant_ids for shot in content.direction.shots] == [[], ["younger"]]


@pytest.mark.asyncio
async def test_legacy_confirmed_design_remains_usable_and_fork_does_not_rewrite_it(tmp_path):
    """仅在隔离库构造升级前快照；正常读、编译及新版本保存仍经过领域服务。"""
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, plan_id, _, _ = await prepare(db)
            plan = await service.revision(plan_id)
            design = await service.revision(plan.payload["design_revision_id"])
            legacy = deepcopy(design.payload)
            for shot in legacy["direction"]["shots"]:
                del shot["participant_ids"]
            await db.execute(update(DirectingRevision).where(DirectingRevision.id == design.id).values(payload=legacy))
            prompt = await service.compile_unit(sequence_id, plan.id, "u1")
            original_text = prompt.payload["text"]
            assert "镜头参与对象：范围待核对（历史设计）" in original_text
            fork = await service.save_revision(sequence_id, kind="design", payload=design_sample(), parent_id=design.id)
            await service.confirm_revision(fork.id, expected_version=fork.version, actor_id="author")
            assert (await service.revision(design.id)).payload == legacy
            assert (await service.revision(plan.id)).payload["design_revision_id"] == design.id
            assert (await service.revision(prompt.id)).payload["text"] == original_text
            assert (await service.read_revision(design.id)).content.direction.shots[0].participant_ids is None


@pytest.mark.parametrize("missing", [None, "omit"])
def test_ai_repairs_missing_object_scope_instead_of_inferring_it(missing):
    """缺少名单会反馈模型一次；合法名单原样保留，包含静态物件。"""
    valid = design_sample()
    valid["participants"].append({"id": "van", "name": "白色面包车"})
    valid["direction"]["shots"][0]["participant_ids"] = ["van"]
    invalid = deepcopy(valid)
    invalid["direction"]["shots"][0]["participant_ids"] = missing
    if missing == "omit":
        del invalid["direction"]["shots"][0]["participant_ids"]
    calls = []

    def invoke(messages):
        calls.append(messages)
        return SimpleNamespace(content=json.dumps(invalid if len(calls) == 1 else valid))

    result = generate_directing_result("directing_design", SimpleNamespace(invoke=invoke), {})
    assert result.direction.shots[0].participant_ids == ["van"]
    assert len(calls) == 2 and "参与对象范围待核对" in calls[1][-1].content
    with pytest.raises(DirectingOutputError, match="参与对象范围待核对"):
        generate_directing_result("directing_design", SimpleNamespace(invoke=lambda _: SimpleNamespace(content=json.dumps(invalid))), {})


@pytest.mark.asyncio
@pytest.mark.parametrize("ids,expected", [(None, "范围待核对（历史设计）"), ([], "明确无参与对象"), (["van"], "白色面包车")])
async def test_compile_preserves_scope_and_background_separation(tmp_path, ids, expected):
    """逐镜名单来源可追溯，其他镜头对象保留为背景而非本次名单。"""
    data = design_sample()
    data["participants"].extend([{"id": "van", "name": "白色面包车"}, {"id": "baton", "name": "警用甩棍"}])
    data["direction"]["shots"][0]["participant_ids"] = ids
    data["direction"]["shots"][1]["participant_ids"] = ["baton"]
    unit = plan_sample()["units"][0]
    unit["coverage"] = unit["coverage"][:1]
    before = deepcopy(data)
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service, sequence_id, _, _, _ = await prepare(db)
            text, decisions = await service.render_unit(sequence_id, SceneDesign.model_validate(data), GenerationUnit.model_validate(unit))
    background, execution = text.split("【本次执行动作】", 1)
    assert "警用甩棍" in background and "警用甩棍" not in execution
    assert f"镜头参与对象：{expected}" in execution
    assert any(row.section_path == "/direction/shots/0/participant_ids" and expected in row.text_excerpt for row in decisions)
    assert data == before


@pytest.mark.asyncio
async def test_api_preserves_scope_and_rejects_unknown_confirmation(tmp_path):
    """外部读写保留 null 与 []，确认错误不会冻结或破坏草稿。"""
    from tests.directing.test_api import client_for
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            sequence = await ProductionService(db, "p1").create_sequence(chapter_id="ch1", title="名单契约", position=0)
            sequence_id = sequence.id
        async with client_for(sessions) as client:
            path = f"/api/v1/studio/projects/p1/directing/sequences/{sequence_id}"
            data = design_sample()
            data["direction"]["shots"][0]["participant_ids"] = None
            body = {"sequence_version": 1, "document": {"kind": "design", "content": data}}
            response = await client.post(path + "/revisions", json=body)
            assert response.status_code == 200
            draft = response.json()["data"]["designs"][0]
            assert draft["content"]["direction"]["shots"][0]["participant_ids"] is None
            confirm_path = path + "/revisions/" + draft["id"] + "/confirm"
            rejected = await client.post(confirm_path, json={"expected_version": draft["version"]})
            assert rejected.status_code == 422 and "参与对象范围待核对" in rejected.text
            data["direction"]["shots"][0]["participant_ids"] = []
            saved = await client.post(path + "/revisions", json={**body, "revision_id": draft["id"], "expected_version": draft["version"]})
            assert saved.status_code == 200
            draft = saved.json()["data"]["designs"][0]
            assert (await client.post(confirm_path, json={"expected_version": draft["version"]})).status_code == 200
            design = (await client.get(path)).json()["data"]["designs"][0]
            assert design["confirmed_at"] and design["content"]["direction"]["shots"][0]["participant_ids"] == []
