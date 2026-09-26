"""路由层：新链路的**真实 HTTP 形状**（请求体 / 响应体 / 错误信封）。

这一批用例全部走 TestClient → 真实路由 → 真实服务层 → 内存库，
证明的是"接口对外长什么样"，而不是"内部函数算得对不对"。

覆盖：

- ``POST /studio/chapters/{id}/asset-profiles``（结构化清单，含 user_flow / technical_detail 分区）
- 同一路径的 ``GET`` 便捷入口
- ``POST /studio/chapters/{id}/asset-profiles/confirm``（无冲突直接确认 / 冲突项留人工 / 未生成则 409）
- ``POST /studio/projects/{id}/asset-image-prompts``（422 空话 / 409 跨资产重复 / 409 覆盖保护 / 200 合并写入）
"""

from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncGenerator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.dependencies import get_db
from app.main import app
from app.services.studio.chapter_asset_profile_cache import clear_chapter_profile_cache
from tests.test_chapter_asset_profiles import CHAPTER_TEXT, SHOT_1, SHOT_2, _model_payload

PROJECT_ID = "proj-route"
CHAPTER_ID = "chap-route"
BUILD_URL = f"/api/v1/studio/chapters/{CHAPTER_ID}/asset-profiles"
CONFIRM_URL = f"{BUILD_URL}/confirm"
PROMPTS_URL = f"/api/v1/studio/projects/{PROJECT_ID}/asset-image-prompts"


def _build_harness() -> tuple[async_sessionmaker[AsyncSession], Any]:
    from app.core.db import Base
    from app.models.studio import Chapter, Project, Shot  # noqa: F401  (触发建表)

    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async def _create() -> None:
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)

    asyncio.run(_create())
    return factory, engine


def _override(factory: async_sessionmaker[AsyncSession]):
    async def override_db() -> AsyncGenerator[AsyncSession, None]:
        async with factory() as session:
            try:
                yield session
                await session.commit()
            except Exception:
                await session.rollback()
                raise

    return override_db


def _seed(factory: async_sessionmaker[AsyncSession]) -> None:
    from app.models.studio import Chapter, Project, Shot, ShotExtractedCandidate
    from app.models.types import ShotCandidateType

    async def run() -> None:
        async with factory() as db:
            db.add(Project(id=PROJECT_ID, name="路由测试项目", description="", style="真人古装", visual_style="现实"))
            await db.flush()
            db.add(
                Chapter(
                    id=CHAPTER_ID,
                    project_id=PROJECT_ID,
                    index=1,
                    title="第一集",
                    raw_text=CHAPTER_TEXT,
                    condensed_text=CHAPTER_TEXT,
                )
            )
            await db.flush()
            db.add(Shot(id="shot-r1", chapter_id=CHAPTER_ID, index=1, title="正堂逼问", script_excerpt=SHOT_1))
            db.add(Shot(id="shot-r2", chapter_id=CHAPTER_ID, index=2, title="起身", script_excerpt=SHOT_2))
            await db.flush()
            for shot_id, candidate_type, name in (
                ("shot-r1", ShotCandidateType.character, "秦老夫人"),
                ("shot-r1", ShotCandidateType.character, "姜岁欢"),
                ("shot-r1", ShotCandidateType.scene, "将军府·正堂"),
                ("shot-r1", ShotCandidateType.prop, "乌木拐杖"),
                ("shot-r2", ShotCandidateType.costume, "素白襦裙"),
            ):
                db.add(
                    ShotExtractedCandidate(
                        shot_id=shot_id,
                        candidate_type=candidate_type,
                        candidate_name=name,
                        payload={},
                    )
                )
            await db.commit()

    asyncio.run(run())


@pytest.fixture
def routed_client(monkeypatch: pytest.MonkeyPatch):
    """TestClient + 内存库 + 桩化大模型（零出网、零付费）。"""
    from app.services.studio.llm_orchestration.client import (
        TextLLMTarget,
    )
    from app.services.studio import chapter_asset_profiles as service

    factory, engine = _build_harness()
    app.dependency_overrides[get_db] = _override(factory)
    _seed(factory)
    clear_chapter_profile_cache()

    async def _fake_resolve(_db: Any) -> TextLLMTarget:
        return TextLLMTarget(
            provider_id="provider-stub",
            provider_name="桩供应商",
            model_id="model-stub",
            model_name="桩模型",
            base_url="https://example.invalid/v1",
            timeout_seconds=5,
        )

    async def _fake_call_text_llm(_prompt: str, target: Any = None, **kwargs: Any) -> Any:
        from app.services.studio.llm_orchestration.client import LLMCompletion

        return LLMCompletion(
            text=json.dumps(_model_payload(), ensure_ascii=False),
            target=target,
            latency_ms=7,
        )

    # 桩掉"解析模型配置"与"真实调用"两个入口：一行网都不出，但仍然走完整编排流程
    monkeypatch.setattr(service, "resolve_text_llm_target", _fake_resolve)
    monkeypatch.setattr(service, "call_text_llm", _fake_call_text_llm)
    # 演练开关关掉，才会走真实调用分支（调用本身已被上面的桩替换）
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "0")
    monkeypatch.setenv("JELLYFISH_REAL_LLM_CONFIRMED", "1")

    client = TestClient(app)
    try:
        yield client, factory
    finally:
        app.dependency_overrides.clear()
        asyncio.run(engine.dispose())


# ---------------------------------------------------------------------------
# 结构化清单
# ---------------------------------------------------------------------------


def test_asset_profiles_route_returns_user_flow_and_technical_detail(routed_client) -> None:
    client, _factory = routed_client
    response = client.post(BUILD_URL, json={"extra_instructions": ""})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["code"] == 200

    data = body["data"]
    assert data["chapter_id"] == CHAPTER_ID
    assert data["project_id"] == PROJECT_ID
    assert data["meta"]["llm_called"] is True

    # 用户主流程
    flow = data["user_flow"]
    assert flow["summary"]["asset_total"] == 5
    assert flow["summary"]["needs_review"] == 0
    assert flow["summary"]["auto_confirmable"] == 5
    girl = next(item for item in flow["items"] if item["name"] == "姜岁欢")
    assert girl["fields"]["appearance"] == "鹅蛋脸杏眼，肤色白皙，身形纤细"
    assert [ref["shot_index"] for ref in girl["shot_refs"]] == [1, 2]
    assert girl["suggested_action"] == "create_new"
    # field_labels 按 ASSET_TYPES 生成：商品（第五类资产）在 MVP 不进实体提取/工作台平权，
    # 但它**有**资料字段表（asset_profiles.PROFILE_FIELD_SPECS），所以这里也会出现。
    assert set(flow["field_labels"]) == {"character", "scene", "prop", "costume", "product"}

    # 技术详情（默认收起）
    detail = data["technical_detail"]
    assert detail["candidate_groups"], "原始候选必须在技术详情里可查"
    assert detail["alias_merge"] and detail["match_status"]
    assert {entry["name"] for entry in detail["dropped_model_items"]} == {"并不存在的黑衣人", "妆容"}
    assert detail["llm"]["prompt_chars"] > 0


def test_asset_profiles_get_route_behaves_like_post(routed_client) -> None:
    client, _factory = routed_client
    first = client.post(BUILD_URL, json={"extra_instructions": ""})
    second = client.get(BUILD_URL)
    assert first.status_code == 200 and second.status_code == 200
    assert second.json()["data"]["meta"]["from_cache"] is True
    assert [item["name"] for item in second.json()["data"]["user_flow"]["items"]] == [
        item["name"] for item in first.json()["data"]["user_flow"]["items"]
    ]


def test_confirm_route_creates_assets_and_returns_readiness(routed_client) -> None:
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200
    response = client.post(CONFIRM_URL, json={})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["summary"]["created"] == 5
    assert data["summary"]["skipped"] == 0
    assert data["summary"]["needs_review_remaining"] == 0
    readiness = data["asset_readiness"]
    assert readiness["summary"]["total"] == 5
    names = {item["name"] for item in readiness["items"]}
    assert names == {"姜岁欢", "秦老夫人", "将军府·正堂", "乌木拐杖", "素白襦裙"}


def test_confirm_route_409_when_list_not_generated(routed_client) -> None:
    client, _factory = routed_client
    clear_chapter_profile_cache()
    response = client.post(CONFIRM_URL, json={})
    assert response.status_code == 409
    assert response.json()["meta"]["error"]["code"] == "asset_profile_not_generated"


def test_confirm_route_rejects_unknown_group_key(routed_client) -> None:
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200
    response = client.post(
        CONFIRM_URL,
        json={"selections": [{"group_key": "character:不存在的人", "action": "create_new"}]},
    )
    assert response.status_code == 422
    assert response.json()["meta"]["error"]["code"] == "unknown_group_key"


def test_confirm_route_skips_conflicts_without_explicit_decision(routed_client) -> None:
    client, factory = routed_client

    async def _add_scene() -> None:
        from app.models.studio import Scene

        async with factory() as db:
            db.add(Scene(id="scene-conflict", name="姜岁欢", description="", style="真人古装"))
            await db.commit()

    asyncio.run(_add_scene())
    clear_chapter_profile_cache()
    assert client.post(BUILD_URL, json={}).status_code == 200
    data = client.post(CONFIRM_URL, json={}).json()["data"]
    assert data["summary"]["needs_review_remaining"] >= 1
    skipped = [item for item in data["results"] if item["action"] == "skip"]
    assert any("冲突" in str(item["reason"]) for item in skipped)


# ---------------------------------------------------------------------------
# 批量保存资产图片提示词
# ---------------------------------------------------------------------------

GOOD = "姜岁欢（角色）：外貌：鹅蛋脸杏眼；发型：乌黑长直发束双环髻；服装配饰：素白襦裙；正面全身参考图，photorealistic"


def _create_assets(client) -> dict[str, str]:
    assert client.post(BUILD_URL, json={}).status_code == 200
    data = client.post(CONFIRM_URL, json={}).json()["data"]
    return data["created_asset_ids"]


def test_batch_prompt_save_ok_and_slot_merge(routed_client) -> None:
    client, _factory = routed_client
    ids = _create_assets(client)
    response = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {"character_image_front": GOOD},
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["summary"]["asset_changed"] == 1
    assert data["saved"][0]["saved_slots"] == ["character_image_front"]


def test_batch_prompt_save_vague_filler_422(routed_client) -> None:
    client, _factory = routed_client
    ids = _create_assets(client)
    response = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {
                        "character_image_front": "姜岁欢（角色）：外观信息不足，需人工补充，中景平视"
                    },
                }
            ]
        },
    )
    assert response.status_code == 422
    detail = response.json()["meta"]["error"]
    assert detail["code"] == "vague_filler"
    assert detail["field"] == "character_image_front"
    assert detail["issues"][0]["status_code"] == 422


def test_batch_prompt_save_cross_asset_duplicate_409(routed_client) -> None:
    client, _factory = routed_client
    ids = _create_assets(client)
    response = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {"character_image_front": GOOD},
                },
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {"character_image_front": GOOD},
                },
            ]
        },
    )
    # 同一资产重复出现 → 422（形状检查先命中）
    assert response.status_code == 422

    girl_key = ids["character"]
    # 造一个"两个不同角色拿到同一段提示词"的场景：先建第二个角色
    created = client.post(
        "/api/v1/studio/entities/character",
        json={
            "id": "char-dup",
            "project_id": PROJECT_ID,
            "name": "另一个少女",
            "description": "",
            "style": "真人古装",
            "visual_style": "现实",
        },
    )
    assert created.status_code == 201, created.text
    response = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": girl_key,
                    "image_prompts": {"character_image_front": GOOD},
                },
                {
                    "asset_type": "character",
                    "asset_id": "char-dup",
                    "image_prompts": {"character_image_front": GOOD},
                },
            ]
        },
    )
    assert response.status_code == 409, response.text
    assert response.json()["meta"]["error"]["code"] == "duplicate_prompt_text"


def test_batch_prompt_save_overwrite_needs_confirmation(routed_client) -> None:
    client, _factory = routed_client
    ids = _create_assets(client)
    first = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {"character_image_front": GOOD},
                }
            ]
        },
    )
    assert first.status_code == 200, first.text

    second = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {"character_image_front": GOOD + "，侧面视角"},
                }
            ]
        },
    )
    assert second.status_code == 409
    assert second.json()["meta"]["error"]["code"] == "image_prompt_replace_required"
    assert second.json()["meta"]["error"]["confirm_field"] == "confirm_replace_image_prompt"

    third = client.post(
        PROMPTS_URL,
        json={
            "confirm_replace_image_prompt": True,
            "items": [
                {
                    "asset_type": "character",
                    "asset_id": ids["character"],
                    "image_prompts": {"character_image_front": GOOD + "，侧面视角"},
                }
            ],
        },
    )
    assert third.status_code == 200, third.text
    assert third.json()["data"]["summary"]["asset_changed"] == 1


def test_batch_prompt_save_prop_slot_is_supported(routed_client) -> None:
    """道具走**同一个**批量保存入口，槽位是正式的 prop_image_front（不是"无槽位"）。"""
    client, _factory = routed_client
    ids = _create_assets(client)
    response = client.post(
        PROMPTS_URL,
        json={
            "items": [
                {
                    "asset_type": "prop",
                    "asset_id": ids["prop"],
                    "image_prompts": {
                        "prop_image_front": "乌木拐杖（道具）：材质：乌木；颜色：深褐近黑；形状：直杆带龙首弯柄；道具正面展示"
                    },
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["data"]["saved"][0]["saved_slots"] == ["prop_image_front"]


def test_batch_prompt_save_rejects_unknown_asset_type(routed_client) -> None:
    client, _factory = routed_client
    response = client.post(
        PROMPTS_URL,
        json={"items": [{"asset_type": "actor", "asset_id": "actor-1", "image_prompts": {"x": "y"}}]},
    )
    assert response.status_code == 422
    assert "actor" in json.dumps(response.json()["meta"]["error"], ensure_ascii=False)


# ---------------------------------------------------------------------------
# 数据边界：章节隔离 overlay + 全局更新差异/显式确认
# ---------------------------------------------------------------------------

OVERLAYS_URL = f"/api/v1/studio/chapters/{CHAPTER_ID}/asset-overlays"
GLOBAL_PREVIEW_URL = f"{BUILD_URL}/global-updates/preview"
GLOBAL_APPLY_URL = f"{BUILD_URL}/global-updates/apply"


def test_asset_overlays_route_reports_chapter_scope(routed_client) -> None:
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200
    confirmed = client.post(CONFIRM_URL, json={})
    assert confirmed.status_code == 200, confirmed.text

    response = client.get(OVERLAYS_URL)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["summary"]["total"] == 5
    # 场景/道具/服装是全局资产；角色归属项目
    assert data["summary"]["global_assets"] == 3
    assert data["summary"]["project_assets"] == 2
    scene = next(item for item in data["items"] if item["asset_type"] == "scene")
    assert scene["scope"] == "chapter"
    assert scene["global_asset"] is True
    assert "不会写回全局资产" in scene["scope_description"]
    assert scene["chapter_fields"]["spatial_structure"]
    assert scene["plot_identity"]
    # 该场景名只出现在章节原文（"将军府·正堂"），两个镜头摘录都没提它 →
    # 如实标为 chapter_only 且 shot_refs 为空（不伪造出场依据）
    assert scene["evidence_scope"] == "chapter_only"
    assert scene["shot_refs"] == []
    # 道具名真的出现在 shot-r1 的摘录里 → 必须是 shot 级证据
    prop = next(item for item in data["items"] if item["asset_type"] == "prop")
    assert prop["evidence_scope"] == "shot"
    assert prop["shot_refs"][0]["shot_index"] == 1

    prop = next(item for item in data["items"] if item["asset_type"] == "prop")
    assert prop["global_asset"] is True
    assert prop["chapter_fields"]["material"] == "乌木"


def _add_existing_global_scene(factory, *, scene_id: str, name: str, description: str) -> None:
    """预置一个**已经存在**的全局场景（走"选用已有"，全局更新才有差异可算）。"""

    async def _run() -> None:
        from app.models.studio import Scene

        async with factory() as db:
            db.add(Scene(id=scene_id, name=name, description=description, style="真人古装"))
            await db.commit()

    asyncio.run(_run())


def _scene_description(factory, scene_id: str) -> str:
    async def _run() -> str:
        from app.models.studio import Scene

        async with factory() as db:
            row = await db.get(Scene, scene_id)
            return str(row.description or "")

    return asyncio.run(_run())


OLD_SCENE_DESCRIPTION = "旧的正堂：木结构三间，正中设主位。"


def test_global_updates_preview_is_read_only_and_shows_diff(routed_client) -> None:
    client, factory = routed_client
    _add_existing_global_scene(factory, scene_id="scene-existing", name="将军府·正堂", description=OLD_SCENE_DESCRIPTION)
    clear_chapter_profile_cache()
    assert client.post(BUILD_URL, json={}).status_code == 200
    assert client.post(CONFIRM_URL, json={}).status_code == 200

    response = client.post(GLOBAL_PREVIEW_URL, json={"asset_types": ["scene", "prop"]})
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["apply_endpoint"].endswith("/global-updates/apply")

    entry = next(item for item in data["items"] if item["asset_id"] == "scene-existing")
    assert entry["requires_confirmation"] is True
    assert entry["global_asset"] is True
    diff = entry["diff"]["description"]
    assert diff["before"] == OLD_SCENE_DESCRIPTION
    assert diff["added"], "本章通用资料应当体现为新增段"
    assert diff["removed"] == []
    # 本章特有字段（时间天气/光线色调/相关事件）**不进**全局提议
    assert "时间天气" not in diff["proposed"]
    assert "光线色调" not in diff["proposed"]
    assert entry["chapter_scope"]["chapter_only_fields"]
    assert entry["diff"]["image_prompts"]["changed"] is False
    # 预览不写库
    assert _scene_description(factory, "scene-existing") == OLD_SCENE_DESCRIPTION


def test_global_scene_is_not_written_by_confirm(routed_client) -> None:
    """确认本章资产时**绝不**写全局资产（选用已有的情况下一个字都不动）。"""
    client, factory = routed_client
    _add_existing_global_scene(factory, scene_id="scene-existing", name="将军府·正堂", description=OLD_SCENE_DESCRIPTION)
    clear_chapter_profile_cache()
    assert client.post(BUILD_URL, json={}).status_code == 200
    data = client.post(CONFIRM_URL, json={}).json()["data"]

    scene_entry = next(item for item in data["results"] if item["asset_id"] == "scene-existing")
    assert scene_entry["action"] == "link_existing"
    assert scene_entry["global_write_skipped"] is True
    assert scene_entry["chapter_scoped"] is True
    assert "global_description" in scene_entry["preserved"]
    assert _scene_description(factory, "scene-existing") == OLD_SCENE_DESCRIPTION

    # 但本章资料确实按章节保存下来了
    overlays = client.get(OVERLAYS_URL).json()["data"]
    scene_overlay = next(item for item in overlays["items"] if item["asset_id"] == "scene-existing")
    assert scene_overlay["chapter_fields"]["spatial_structure"]
    assert scene_overlay["temporary_notes"]


def test_global_updates_apply_requires_confirmation_flag(routed_client) -> None:
    client, factory = routed_client
    _add_existing_global_scene(factory, scene_id="scene-existing", name="将军府·正堂", description=OLD_SCENE_DESCRIPTION)
    clear_chapter_profile_cache()
    assert client.post(BUILD_URL, json={}).status_code == 200
    assert client.post(CONFIRM_URL, json={}).status_code == 200

    response = client.post(
        GLOBAL_APPLY_URL,
        json={"items": [{"asset_type": "scene", "asset_id": "scene-existing", "apply": ["description"]}]},
    )
    assert response.status_code == 409, response.text
    error = response.json()["meta"]["error"]
    assert error["code"] == "global_asset_update_required"
    assert error["confirm_field"] == "confirm"
    assert error["diff"], "409 必须带差异，用户才能看着差异决定"
    assert _scene_description(factory, "scene-existing") == OLD_SCENE_DESCRIPTION

    ok = client.post(
        GLOBAL_APPLY_URL,
        json={
            "confirm": True,
            "items": [{"asset_type": "scene", "asset_id": "scene-existing", "apply": ["description"]}],
        },
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["data"]["summary"]["applied"] == 1

    merged = _scene_description(factory, "scene-existing")
    assert OLD_SCENE_DESCRIPTION.rstrip("。") in merged  # 原有内容保留
    assert "空间结构" in merged  # 本章通用资料合并进来
    assert "光线色调" not in merged  # 本章特有字段仍然不写全局
    assert "时间天气" not in merged


def test_global_updates_apply_rejects_non_whitelisted_field(routed_client) -> None:
    client, factory = routed_client
    _add_existing_global_scene(factory, scene_id="scene-existing", name="将军府·正堂", description=OLD_SCENE_DESCRIPTION)
    clear_chapter_profile_cache()
    assert client.post(BUILD_URL, json={}).status_code == 200
    confirmed = client.post(CONFIRM_URL, json={}).json()["data"]
    prop_id = confirmed["created_asset_ids"]["prop"]

    response = client.post(
        GLOBAL_APPLY_URL,
        json={
            "confirm": True,
            "items": [{"asset_type": "prop", "asset_id": prop_id, "apply": ["chapter_fields"]}],
        },
    )
    assert response.status_code == 422
    assert "chapter_fields" in json.dumps(response.json()["meta"]["error"], ensure_ascii=False)


# ---------------------------------------------------------------------------
# 持久化：专用表读写 / 人工修改 / 内容变化的处置
# ---------------------------------------------------------------------------

RECORDS_URL = f"{BUILD_URL}/records"
DECISIONS_URL = f"{BUILD_URL}/decisions"


def test_records_route_serves_database_rows(routed_client) -> None:
    """``GET .../asset-profiles/records`` 直接读专用表：类型/名称/资料/依据/状态/来源签名。"""
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200

    response = client.get(RECORDS_URL)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["summary"]["records_total"] == 5
    assert data["run"] is not None and data["run"]["status"] == "generated"
    assert data["current_source_hash"] and data["run"]["source_hash"] == data["current_source_hash"]
    assert data["content_changed"] is False

    girl = next(item for item in data["items"] if item["name"] == "姜岁欢")
    assert girl["asset_type"] == "character"
    assert girl["fields"]["appearance"]
    assert girl["shot_refs"], "分镜依据必须落库"
    assert girl["source_summary"]["script_chars"] > 0
    assert girl["status"] == "generated"
    assert girl["manual_overrides"] == {} and girl["user_notes"] == []
    assert girl["has_pending_change"] is False
    # 记录里不出现在何密钥/本机路径字段
    blob = json.dumps(data, ensure_ascii=False)
    for forbidden in ("api_key", "LTAI", "/Users/", "secret"):
        assert forbidden not in blob


def test_manual_edit_route_keeps_human_fields_separate_from_model(routed_client) -> None:
    """人工修改写进 ``manual_overrides`` / ``user_notes``，模型侧资料一个字不动。"""
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200
    records = client.get(RECORDS_URL).json()["data"]["items"]
    girl = next(item for item in records if item["name"] == "姜岁欢")
    model_fields_before = dict(girl["fields"])

    response = client.patch(
        f"{RECORDS_URL}/{girl['id']}",
        json={"fields": {"hairstyle": "人工指定：垂挂双环髻"}, "notes": ["导演要求改成素银簪"]},
    )
    assert response.status_code == 200, response.text
    updated = response.json()["data"]
    assert updated["manual_overrides"] == {"hairstyle": "人工指定：垂挂双环髻"}
    assert updated["user_notes"] == ["导演要求改成素银簪"]
    assert updated["profile_source"] == "model+manual"
    assert updated["fields"]["hairstyle"] == "人工指定：垂挂双环髻"
    # 模型侧那份没有被改写（只是被人工覆盖生效）
    assert girl["profile_text"] != updated["profile_text"]
    del model_fields_before

    # 清单（GET 只读）必须立刻看到人工修改 —— 数据库是事实来源
    after = client.get(BUILD_URL).json()["data"]
    girl_item = next(item for item in after["user_flow"]["items"] if item["name"] == "姜岁欢")
    assert girl_item["fields"]["hairstyle"] == "人工指定：垂挂双环髻"
    assert girl_item["manual_edited"] is True


def test_manual_edit_route_404_for_other_chapter(routed_client) -> None:
    """记录不属于本章 → 404（章节隔离不能被 id 猜出来绕过）。"""
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200
    response = client.patch(f"{RECORDS_URL}/999999", json={"fields": {"appearance": "x"}})
    assert response.status_code == 404


def test_decisions_route_validates_action_and_group_key(routed_client) -> None:
    client, _factory = routed_client
    assert client.post(BUILD_URL, json={}).status_code == 200
    bad_action = client.post(DECISIONS_URL, json={"decisions": [{"group_key": "character:姜岁欢", "action": "删掉"}]})
    assert bad_action.status_code == 422
    assert "action" in json.dumps(bad_action.json()["meta"]["error"], ensure_ascii=False)

    unknown = client.post(DECISIONS_URL, json={"decisions": [{"group_key": "character:不存在", "action": "keep"}]})
    assert unknown.status_code == 422
    assert unknown.json()["meta"]["error"]["code"] == "unknown_group_key"


def test_get_route_is_read_only_when_nothing_is_persisted(routed_client) -> None:
    """GET 只读入口：库里没有清单时**一次模型调用都不发**，如实给中文引导。"""
    client, _factory = routed_client
    clear_chapter_profile_cache()
    response = client.get(BUILD_URL)
    assert response.status_code == 200, response.text
    data = response.json()["data"]
    assert data["persistence"]["generated"] is False
    assert data["persistence"]["status"] == "not_generated"
    assert data["user_flow"]["items"] == []
    assert data["meta"]["llm_called"] is False

    # 确认接口在没有清单时如实 409（不会拿空清单建资产）
    confirm = client.post(CONFIRM_URL, json={})
    assert confirm.status_code == 409
    assert confirm.json()["meta"]["error"]["code"] == "asset_profile_not_generated"


def test_post_route_without_refresh_reuses_persisted_list(routed_client, monkeypatch) -> None:
    """``refresh=false``（默认）再次 POST：读库返回，**不再调用模型**。"""
    client, _factory = routed_client
    from app.services.studio import chapter_asset_profiles as service

    assert client.post(BUILD_URL, json={}).status_code == 200
    clear_chapter_profile_cache()

    async def _explode(*_args: Any, **_kwargs: Any) -> Any:
        raise AssertionError("库里已有清单时不得再调用模型")

    monkeypatch.setattr(service, "call_text_llm", _explode)
    monkeypatch.setattr(service, "_make_target_caller", lambda _target: _explode)

    again = client.post(BUILD_URL, json={"extra_instructions": ""})
    assert again.status_code == 200, again.text
    data = again.json()["data"]
    assert data["persistence"]["source"] == "database"
    assert data["persistence"]["llm_called"] is False
    assert data["persistence"]["generated_by_llm"] is True
    assert data["persistence"]["content_changed"] is False
