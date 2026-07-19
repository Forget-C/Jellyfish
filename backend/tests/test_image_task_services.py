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
    ShotFrameType,
)
from app.schemas.studio.shots import ShotLinkedAssetItem
from app.services.studio.generation.asset_image import build_base as asset_base
from app.services.studio.generation.frame.build_base import build_frame_base_draft
from app.services.studio.generation.frame.build_context import build_frame_context
from app.services.studio.generation.frame.derive_preview import derive_frame_preview
from app.services.studio.image_task_references import (
    pick_ordered_ref_file_ids,
    resolve_reference_file_ids_and_names_from_linked_items,
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
async def test_resolve_reference_file_ids_and_names_filters_empty_file_ids():
    items = [
        ShotLinkedAssetItem(id="a1", type="prop", name="道具一", file_id="file-1"),
        ShotLinkedAssetItem(id="a2", type="scene", name="", file_id="file-2"),
        ShotLinkedAssetItem(id="a3", type="costume", name="忽略项", file_id=""),
    ]

    file_ids, names = await resolve_reference_file_ids_and_names_from_linked_items(None, items=items)

    assert file_ids == ["file-1", "file-2"]
    assert names == ["道具一", "a2"]


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
        return SimpleNamespace(
            prompt="演员渲染提示词",
            template_id="template-1",
            template_version=2,
            merged_variables={"view_angle": "front"},
        )

    monkeypatch.setattr(asset_base, "build_prompt_with_template_snapshot", _fake_build_prompt)
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
    )
    db = _FakeDB(
        mapping={
            (Character, "char-1"): character,
            (CharacterImage, 1): image,
            (Actor, "actor-1"): SimpleNamespace(id="actor-1"),
            (Costume, "costume-1"): SimpleNamespace(id="costume-1"),
        }
    )

    async def _fake_build_prompt(*_args, **_kwargs):
        return "角色合成提示词"

    async def _fake_pick_ordered(*_args, parent_id: str, **_kwargs):
        if parent_id == "actor-1":
            return ["actor-front", "actor-left"]
        return ["costume-front"]

    monkeypatch.setattr(asset_base, "build_prompt_with_template", _fake_build_prompt)
    monkeypatch.setattr(asset_base, "pick_ordered_ref_file_ids", _fake_pick_ordered)

    draft = await asset_base.build_character_image_base_draft(
        db,
        character_id="char-1",
        image_id=1,
    )

    assert draft.prompt == "角色合成提示词"
    assert draft.default_images == ["actor-front", "actor-left", "costume-front"]
    assert draft.image_id == 1


def test_derive_frame_preview_replaces_reference_names_with_stable_order() -> None:
    base = build_frame_base_draft(
        shot_id="shot-1",
        frame_type=ShotFrameType.first,
        prompt="张三在雨夜中逼近李四",
        director_command_summary="必须：锁定主角视线方向；优先：保持同场景轴线稳定",
        continuity_guidance="当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局",
        frame_specific_guidance="首帧只表现受惊瞬间，人物身体骤然僵住，动作尚未完成",
        composition_anchor="以门口灯光和主角站位作为画面重心，保持环境与人物同时可读",
        screen_direction_guidance="保持张三与李四的左右站位和对视方向稳定，避免无故翻转朝向",
    )
    context = build_frame_context(
        shot_id="shot-1",
        frame_type=ShotFrameType.first,
        items=[
            ShotLinkedAssetItem(id="char-1", type="character", name="张三", file_id="char-1-front"),
            ShotLinkedAssetItem(id="char-2", type="character", name="李四", file_id="char-2-front"),
        ],
    )

    preview = derive_frame_preview(base=base, context=context)

    assert preview.images == ["char-1-front", "char-2-front"]
    assert preview.mappings[0].token == "图1"
    assert preview.mappings[1].token == "图2"
    assert preview.selected_guidance == [
        "高优先级导演指令：必须：锁定主角视线方向；优先：保持同场景轴线稳定",
        "当前帧职责：首帧只表现受惊瞬间，人物身体骤然僵住，动作尚未完成",
        "连续性要求：当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局",
    ]
    assert preview.dropped_guidance == [
        "构图锚点：以门口灯光和主角站位作为画面重心，保持环境与人物同时可读",
        "朝向与视线：保持张三与李四的左右站位和对视方向稳定，避免无故翻转朝向",
    ]
    assert preview.selected_guidance_details[1].reason_tag == "首帧保时序"
    assert preview.selected_guidance_details[1].reason == "当前是首帧，系统优先保留触发瞬间与未完成态约束，避免画面直接跳到后续完成动作。"
    assert preview.dropped_guidance_details[0].reason_tag == "首帧降构图"
    assert preview.dropped_guidance_details[1].reason_tag == "首帧降轴线"
    assert "高优先级导演指令：必须：锁定主角视线方向；优先：保持同场景轴线稳定" in preview.rendered_prompt
    assert "当前帧职责：首帧只表现受惊瞬间，人物身体骤然僵住，动作尚未完成" in preview.rendered_prompt
    assert "连续性要求：当前镜头应承接上一镜头的动作与情绪，不要像全新场面重新开局" in preview.rendered_prompt
    assert "构图锚点：以门口灯光和主角站位作为画面重心，保持环境与人物同时可读" not in preview.rendered_prompt
    assert "朝向与视线：保持张三与李四的左右站位和对视方向稳定，避免无故翻转朝向" not in preview.rendered_prompt
    assert "图1在雨夜中逼近图2" in preview.rendered_prompt


def test_derive_frame_preview_prioritizes_composition_for_first_frame() -> None:
    base = build_frame_base_draft(
        shot_id="shot-2",
        frame_type=ShotFrameType.first,
        prompt="主角推门进入空旷大厅",
        director_command_summary="必须：先建立空间",
        continuity_guidance="当前镜头应承接上一镜头的动作与情绪",
        frame_specific_guidance="首帧优先表现推门瞬间和人物尚未完全进入大厅的状态",
        composition_anchor="以门框、人物站位和大厅纵深作为空间锚点，优先建立环境与人物关系",
        screen_direction_guidance="保持人物朝向稳定",
    )
    context = build_frame_context(
        shot_id="shot-2",
        frame_type=ShotFrameType.first,
        items=[],
    )

    preview = derive_frame_preview(base=base, context=context)

    assert preview.selected_guidance[1] == "当前帧职责：首帧优先表现推门瞬间和人物尚未完全进入大厅的状态"
    assert preview.dropped_guidance == [
        "构图锚点：以门框、人物站位和大厅纵深作为空间锚点，优先建立环境与人物关系",
        "朝向与视线：保持人物朝向稳定",
    ]
    assert preview.selected_guidance_details[1].reason_tag == "首帧保时序"
    assert preview.selected_guidance_details[1].reason == "当前是首帧，系统优先保留触发瞬间与未完成态约束，避免画面直接跳到后续完成动作。"
    assert "当前帧职责：首帧优先表现推门瞬间和人物尚未完全进入大厅的状态" in preview.rendered_prompt
    assert "构图锚点：以门框、人物站位和大厅纵深作为空间锚点，优先建立环境与人物关系" not in preview.rendered_prompt
    assert "朝向与视线：保持人物朝向稳定" not in preview.rendered_prompt


def test_derive_frame_preview_prioritizes_screen_guidance_for_key_frame() -> None:
    base = build_frame_base_draft(
        shot_id="shot-3",
        frame_type=ShotFrameType.key,
        prompt="两人对峙，情绪到达顶点",
        director_command_summary="必须：锁定对峙张力",
        continuity_guidance="当前镜头应承接上一镜头的动作与情绪",
        frame_specific_guidance="关键帧应锁定对峙动作的峰值瞬间",
        composition_anchor="以走廊尽头和人物站位作为空间锚点，保持环境与人物同时可读",
        screen_direction_guidance="保持两人的左右站位和对视方向稳定，避免跳轴",
    )
    context = build_frame_context(
        shot_id="shot-3",
        frame_type=ShotFrameType.key,
        items=[],
    )

    preview = derive_frame_preview(base=base, context=context)

    assert preview.selected_guidance[2] == "朝向与视线：保持两人的左右站位和对视方向稳定，避免跳轴"
    assert preview.dropped_guidance == [
        "当前帧职责：关键帧应锁定对峙动作的峰值瞬间",
        "构图锚点：以走廊尽头和人物站位作为空间锚点，保持环境与人物同时可读",
    ]
    assert preview.selected_guidance_details[2].reason_tag == "关键帧保轴线"
    assert preview.selected_guidance_details[2].reason == "当前镜头更看重视线与左右轴线稳定，因此优先保留朝向与视线 guidance。"
    assert preview.dropped_guidance_details[0].reason_tag == "关键帧降峰值"
    assert "朝向与视线：保持两人的左右站位和对视方向稳定，避免跳轴" in preview.rendered_prompt
    assert "构图锚点：以走廊尽头和人物站位作为空间锚点，保持环境与人物同时可读" not in preview.rendered_prompt
    assert "当前帧职责：关键帧应锁定对峙动作的峰值瞬间" not in preview.rendered_prompt
