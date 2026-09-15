"""image_task_* services 单测。"""

from __future__ import annotations

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.studio import (
    Actor,
    ActorImage,
    AssetViewAngle,
    Character,
    CharacterImage,
    Costume,
    FileItem,
)
from app.services.studio.generation.asset_image import build_base as asset_base
from app.services.studio.image_task_references import (
    pick_ordered_ref_file_ids,
    resolve_reference_image_refs_by_file_ids,
)
from app.services.studio.image_task_validation import (
    validate_actor_image,
    validate_asset_image_and_relation_type,
    validate_character_image,
)


class _FakeScalarResult:
    def __init__(self, rows):
        self._rows = rows

    def all(self):
        return self._rows


class _FakeExecuteResult:
    def __init__(self, rows=None, single=None):
        self._rows = rows or []
        self._single = single

    def scalars(self):
        return _FakeScalarResult(self._rows)

    def scalar_one_or_none(self):
        return self._single


class _FakeColumn:
    def is_not(self, _value):
        return self

    def desc(self):
        return self

    def __eq__(self, _other):
        return self


class _FakeImageModel:
    actor_id = _FakeColumn()
    file_id = _FakeColumn()
    created_at = _FakeColumn()
    id = _FakeColumn()


class _FakeStmt:
    def where(self, *_args, **_kwargs):
        return self

    def order_by(self, *_args, **_kwargs):
        return self


class _FakeDB:
    def __init__(self, mapping=None, execute_results=None):
        self.mapping = mapping or {}
        self.execute_results = list(execute_results or [])

    async def get(self, model, entity_id):
        return self.mapping.get((model, entity_id))

    async def execute(self, *_args, **_kwargs):
        if not self.execute_results:
            return _FakeExecuteResult()
        return self.execute_results.pop(0)


@pytest.mark.asyncio
async def test_validate_actor_image_returns_row_when_belongs_to_actor():
    actor = SimpleNamespace(id="actor-1")
    image = SimpleNamespace(id=1, actor_id="actor-1")
    db = _FakeDB(
        mapping={
            (Actor, "actor-1"): actor,
            (ActorImage, 1): image,
        }
    )

    row = await validate_actor_image(db, actor_id="actor-1", image_id=1)

    assert row is image


@pytest.mark.asyncio
async def test_validate_asset_image_and_relation_type_rejects_invalid_asset_type():
    db = _FakeDB()

    with pytest.raises(HTTPException) as exc:
        await validate_asset_image_and_relation_type(
            db,
            asset_type="invalid",
            asset_id="asset-1",
            image_id=1,
        )

    assert exc.value.status_code == 400
    assert exc.value.detail == "asset_type must be one of: prop/scene/costume"


@pytest.mark.asyncio
async def test_validate_character_image_requires_image_id():
    character = SimpleNamespace(id="char-1")
    db = _FakeDB(mapping={(Character, "char-1"): character})

    with pytest.raises(HTTPException) as exc:
        await validate_character_image(db, character_id="char-1", image_id=None)

    assert exc.value.status_code == 400
    assert exc.value.detail == "image_id is required for character image generation"




@pytest.mark.asyncio
async def test_resolve_reference_image_refs_by_file_ids_returns_data_urls(monkeypatch):
    file_obj = FileItem(id="file-1", name="sample.png", storage_key="images/sample.png")
    db = _FakeDB(mapping={(FileItem, "file-1"): file_obj})

    async def _fake_download_file(*, key: str):
        assert key == "images/sample.png"
        return b"png-bytes"

    async def _fake_get_file_info(*, key: str):
        assert key == "images/sample.png"
        return SimpleNamespace(content_type="image/png")

    monkeypatch.setattr("app.services.studio.image_task_references.storage.download_file", _fake_download_file)
    monkeypatch.setattr("app.services.studio.image_task_references.storage.get_file_info", _fake_get_file_info)

    refs = await resolve_reference_image_refs_by_file_ids(db, file_ids=["file-1"])

    assert len(refs) == 1
    assert refs[0]["image_url"].startswith("data:image/png;base64,")


@pytest.mark.asyncio
async def test_pick_ordered_ref_file_ids_returns_requested_angle_order(monkeypatch):
    rows = [
        SimpleNamespace(file_id="file-back", view_angle=AssetViewAngle.back),
        SimpleNamespace(file_id="file-right", view_angle=AssetViewAngle.right),
        SimpleNamespace(file_id="file-front", view_angle=AssetViewAngle.front),
    ]
    db = _FakeDB(execute_results=[_FakeExecuteResult(rows=rows)])
    monkeypatch.setattr("app.services.studio.image_task_references.select", lambda *_args, **_kwargs: _FakeStmt())

    out = await pick_ordered_ref_file_ids(
        db,
        image_model=_FakeImageModel,
        parent_field_name="actor_id",
        parent_id="actor-1",
        view_angles=(AssetViewAngle.front, AssetViewAngle.right, AssetViewAngle.left),
    )

    assert out == ["file-front", "file-right"]


@pytest.mark.asyncio
async def test_build_actor_image_base_draft_front_view_returns_no_refs(monkeypatch):
    actor = SimpleNamespace(
        id="actor-1",
        name="演员A",
        description="沉稳男性",
        tags=["成熟", "都市"],
        visual_style="写实",
        style="影视",
        prompt_template_id=None,
    )
    image = SimpleNamespace(
        id=1,
        actor_id="actor-1",
        view_angle=AssetViewAngle.front,
        quality_level="high",
        format="png",
        prompt_overrides={},
    )
    db = _FakeDB(
        mapping={
            (Actor, "actor-1"): actor,
            (ActorImage, 1): image,
        }
    )

    async def _fake_build_prompt(*_args, **_kwargs):
        return "演员渲染提示词", "template-1", 2, {"view_angle": "front"}

    monkeypatch.setattr(asset_base, "_build_asset_prompt", _fake_build_prompt)
    monkeypatch.setattr(asset_base, "asset_prompt_category", lambda **_kwargs: "actor_front")

    draft = await asset_base.build_actor_image_base_draft(
        db,
        actor_id="actor-1",
        image_id=1,
    )

    assert draft.prompt == "演员渲染提示词"
    assert draft.default_images == []
    assert draft.image_id == 1
    assert draft.template_version == 2


@pytest.mark.asyncio
async def test_build_character_image_base_draft_combines_actor_and_costume_refs(monkeypatch):
    async def available_file(**kwargs):
        """隔离参考图元数据查询。"""
        return None
    monkeypatch.setattr("app.services.studio.generation.asset_image.prompt_rules.storage.get_file_info", available_file)
    character = SimpleNamespace(
        id="char-1",
        name="角色A",
        description="主角",
        actor_id="actor-1",
        costume_id="costume-1",
        visual_style="写实",
        style="影视",
    )
    image = SimpleNamespace(
        id=1,
        character_id="char-1",
        view_angle=AssetViewAngle.front,
        quality_level="high",
        format="png",
        prompt_overrides={},
    )
    db = _FakeDB(
        mapping={
            (Character, "char-1"): character,
            (CharacterImage, 1): image,
            (Actor, "actor-1"): SimpleNamespace(id="actor-1", name="演员", description="黑发"),
            (Costume, "costume-1"): SimpleNamespace(id="costume-1", name="服装", description="白衣"),
            **{(FileItem, key): SimpleNamespace(type="image", storage_key=key) for key in ("actor-front", "actor-left", "costume-front")},
        }
    )

    async def _fake_build_prompt(*_args, **_kwargs):
        return "角色合成提示词", "template-character", 1, {"view_angle": "front"}

    async def _fake_pick_ordered(*_args, parent_id: str, **_kwargs):
        if parent_id == "actor-1":
            return ["actor-front", "actor-left"]
        return ["costume-front"]

    monkeypatch.setattr(asset_base, "_build_asset_prompt", _fake_build_prompt)
    monkeypatch.setattr(asset_base, "pick_ordered_ref_file_ids", _fake_pick_ordered)

    draft = await asset_base.build_character_image_base_draft(
        db,
        character_id="char-1",
        image_id=1,
    )

    assert draft.prompt == "角色合成提示词"
    assert draft.default_images == ["actor-front", "actor-left", "costume-front"]
    assert draft.image_id == 1
