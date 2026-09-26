"""4.2 图片提示词生成：分层结构、画像卡一致性、槽位白名单、DRY_RUN 占位。"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.types import PromptCategory
from app.schemas.studio.llm_orchestration import (
    EntityProfileCardRead,
    EntityProfileInput,
    ImagePromptPreviewRequest,
)
from app.services.studio.llm_orchestration.image_prompt import (
    assemble_image_prompt,
    build_slot_negative_prompt,
    pick_entity_for_slot,
    postprocess_slots,
    preview_image_prompts,
    resolve_requested_categories,
)
from app.services.studio.llm_orchestration.registry import (
    DEFAULT_IMAGE_PROMPT_CATEGORIES,
    IMAGE_PROMPT_LAYER_ORDER,
    IMAGE_PROMPT_SLOT_BY_CATEGORY,
)
from tests.llm_orchestration_fixtures import (
    build_session,
    make_recording_stub_caller,
    seed_project_chapter_shot,
)

SHOT_TEXT = "姜岁欢在将军府庭院里跪着抬头，秦老夫人拄拐俯视她。"


def _card(
    name: str = "姜岁欢",
    entity_type: str = "character",
    profile: str = "清冷少女，素色襦裙，腰间系玉佩",
) -> EntityProfileCardRead:
    return EntityProfileCardRead(
        name=name,
        entity_type=entity_type,
        source="request",
        profile=profile,
        canonical_subject=f"{name}（角色）：{profile}",
    )


def _slot(category: PromptCategory, **extra: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "category": category.value,
        "subject": "一个模糊的美女",
        "action_pose": "站立",
        "environment": "庭院",
        "camera_language": "中景平视",
        "style": "写实",
        "quality": "高清",
    }
    payload.update(extra)
    return payload


# ---------------------------------------------------------------------------
# 纯函数
# ---------------------------------------------------------------------------


def test_resolve_requested_categories_defaults_and_filters() -> None:
    assert resolve_requested_categories(None) == list(DEFAULT_IMAGE_PROMPT_CATEGORIES)
    assert resolve_requested_categories([]) == list(DEFAULT_IMAGE_PROMPT_CATEGORIES)
    assert resolve_requested_categories(
        [PromptCategory.character_image_front, PromptCategory.frame_head_image]
    ) == [PromptCategory.character_image_front, PromptCategory.frame_head_image]
    # 重复项去重
    assert resolve_requested_categories(
        [PromptCategory.frame_head_image, PromptCategory.frame_head_image]
    ) == [PromptCategory.frame_head_image]


def test_pick_entity_prefers_entity_mentioned_in_shot_text() -> None:
    spec = IMAGE_PROMPT_SLOT_BY_CATEGORY["character_image_front"]
    cards = [_card("秦老夫人", profile="白发老妇"), _card("姜岁欢")]

    picked = pick_entity_for_slot(spec, cards=cards, shot_text=SHOT_TEXT)
    assert picked is not None
    assert picked.name == "姜岁欢"

    # 槽位实体类型不匹配时返回 None
    prop_spec = IMAGE_PROMPT_SLOT_BY_CATEGORY["frame_head_image"]
    assert pick_entity_for_slot(prop_spec, cards=cards, shot_text=SHOT_TEXT) is None


def test_assemble_image_prompt_keeps_fixed_layer_order() -> None:
    layers = {
        "quality": "高清",
        "style": "写实",
        "subject": "主体",
        "camera_language": "镜头",
        "action_pose": "动作",
        "environment": "环境",
    }
    assert assemble_image_prompt(layers) == "主体，动作，环境，镜头，写实，高清。"


def test_build_slot_negative_prompt_merges_and_dedupes() -> None:
    negative = build_slot_negative_prompt(
        slot_category="character_image_front",
        global_negative="low quality, 自定义负面词",
    )
    assert "自定义负面词" in negative
    # 需求清单第 2 条：角色版式改成设定图后，旧负面词 "half body" / "cropped body"
    # 与新版式**直接冲突**（左区本来就是面部裁切特写），已换成设定图专属负面词
    assert "different people" in negative  # 角色槽位特有规则（同一个人出现四次，禁的是"不同的人"）
    assert "portrait grid" in negative
    assert "half body" not in negative
    assert negative.count("low quality") == 1  # 与默认规则去重


def test_postprocess_slots_overrides_subject_with_profile_card() -> None:
    parsed = {
        "slots": [
            _slot(PromptCategory.character_image_front),
            _slot(PromptCategory.scene_image_front, subject="庭院"),
        ]
    }
    cards = [_card()]

    slots, warnings = postprocess_slots(
        parsed=parsed,
        categories=[PromptCategory.character_image_front, PromptCategory.scene_image_front],
        cards=cards,
        shot_text=SHOT_TEXT,
        global_negative="",
    )

    assert len(slots) == 2
    character_slot = slots[0]
    assert character_slot.entity_name == "姜岁欢"
    # 画像卡一致性：主体描述被强制统一
    assert character_slot.layers["subject"] == cards[0].canonical_subject
    assert list(character_slot.layers.keys()) == list(IMAGE_PROMPT_LAYER_ORDER)
    assert character_slot.prompt.startswith(cards[0].canonical_subject)
    assert any("画像卡不一致" in warning for warning in warnings)


def test_postprocess_slots_drops_unknown_category_and_warns_missing() -> None:
    parsed = {
        "slots": [
            _slot(PromptCategory.character_image_front),
            {"category": "totally_made_up", "subject": "x"},
            {"category": PromptCategory.video_prompt.value, "subject": "x"},
        ]
    }

    slots, warnings = postprocess_slots(
        parsed=parsed,
        categories=[PromptCategory.character_image_front, PromptCategory.frame_tail_image],
        cards=[],
        shot_text=SHOT_TEXT,
        global_negative="",
    )

    assert [slot.category for slot in slots] == [PromptCategory.character_image_front]
    assert any("不在本次请求范围内" in warning for warning in warnings)
    assert any("frame_tail_image" in warning and "未返回" in warning for warning in warnings)


def test_postprocess_slots_fills_missing_layers_with_warnings() -> None:
    parsed = {"slots": [{"category": PromptCategory.frame_key_image.value, "subject": "只有主体"}]}

    slots, warnings = postprocess_slots(
        parsed=parsed,
        categories=[PromptCategory.frame_key_image],
        cards=[],
        shot_text=SHOT_TEXT,
        global_negative="",
    )

    slot = slots[0]
    assert slot.layers["subject"] == "只有主体"
    assert slot.layers["action_pose"]  # 用槽位视角说明兜底
    assert slot.layers["style"]
    assert slot.layers["quality"]
    assert any("缺少动作姿态" in warning for warning in warnings)


def test_postprocess_slots_requires_slots_array() -> None:
    from app.services.studio.llm_orchestration.json_utils import JSONParseError

    with pytest.raises(JSONParseError):
        postprocess_slots(
            parsed={"result": "nope"},
            categories=[PromptCategory.frame_key_image],
            cards=[],
            shot_text=SHOT_TEXT,
            global_negative="",
        )


# ---------------------------------------------------------------------------
# 服务层
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_image_prompts_success_with_stub() -> None:
    payload = {
        "slots": [
            _slot(PromptCategory.character_image_front, subject="姜岁欢", entity_name="姜岁欢"),
            _slot(PromptCategory.scene_image_front, subject="将军府庭院", entity_name="将军府庭院"),
        ]
    }
    caller, prompts = make_recording_stub_caller(payload)
    body = ImagePromptPreviewRequest(
        shot_text=SHOT_TEXT,
        categories=[PromptCategory.character_image_front, PromptCategory.scene_image_front],
        entity_profiles=[
            EntityProfileInput(name="姜岁欢", entity_type="character", profile="清冷少女，素色襦裙")
        ],
        style_hint="真人古装短剧",
    )

    db, engine = await build_session()
    async with db:
        result = await preview_image_prompts(db, body=body, llm_caller=caller)

    assert result.meta.llm_called is True
    assert [slot.category for slot in result.slots] == [
        PromptCategory.character_image_front,
        PromptCategory.scene_image_front,
    ]
    assert result.slots[0].entity_name == "姜岁欢"
    assert result.slots[0].layers["subject"].startswith("姜岁欢（角色）：")
    assert "只返回合法 JSON 对象" in prompts[0]
    # 分层结构约束与画像卡都进了提示词
    assert "主体描述 + 动作姿态 + 场景环境 + 镜头语言" in prompts[0]
    assert "必须逐字使用" in prompts[0]
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_image_prompts_loads_project_entities_from_db() -> None:
    from app.models.studio import Character

    payload = {"slots": [_slot(PromptCategory.character_image_front)]}
    caller = make_recording_stub_caller(payload)[0]

    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        db.add(Character(id="char-1", project_id="proj-1", name="姜岁欢", description="清冷少女", style="真人古装"))
        await db.flush()

        result = await preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                shot_id="shot-1",
                categories=[PromptCategory.character_image_front],
            ),
            llm_caller=caller,
        )

    assert result.shot_id == "shot-1"
    assert result.project_id == "proj-1"
    assert [card.name for card in result.entity_cards] == ["姜岁欢"]
    assert result.entity_cards[0].source == "project"
    assert result.slots[0].entity_name == "姜岁欢"
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_image_prompts_bad_json_raises_422() -> None:
    caller = make_recording_stub_caller("<html>502 Bad Gateway</html>")[0]

    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_image_prompts(
                db,
                body=ImagePromptPreviewRequest(shot_text=SHOT_TEXT),
                llm_caller=caller,
            )

    assert exc_info.value.status_code == 422
    assert exc_info.value.detail["code"] == "llm_json_parse_failed"
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_image_prompts_requires_shot_input() -> None:
    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_image_prompts(
                db,
                body=ImagePromptPreviewRequest(),
                llm_caller=make_recording_stub_caller({"slots": []})[0],
            )
    assert exc_info.value.status_code == 400
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_image_prompts_dry_run_returns_all_default_slots(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")

    db, engine = await build_session()
    async with db:
        result = await preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                shot_text=SHOT_TEXT,
                entity_profiles=[
                    EntityProfileInput(name="姜岁欢", entity_type="character", profile="清冷少女")
                ],
            ),
        )

    assert result.meta.dry_run is True
    assert result.meta.llm_called is False
    assert len(result.slots) == len(DEFAULT_IMAGE_PROMPT_CATEGORIES)
    character_slot = result.slots[0]
    assert character_slot.layers["subject"].startswith("姜岁欢（角色）：")
    assert "[DRY_RUN 占位]" in character_slot.layers["action_pose"]
    assert any("DRY_RUN" in warning for warning in result.warnings)
    await engine.dispose()


# ---------------------------------------------------------------------------
# 资产级生成（资产准备页用：没有镜头，只给实体画像）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preview_image_prompts_asset_level_without_shot(monkeypatch: pytest.MonkeyPatch) -> None:
    """资产准备页调用形态：只给 entity_profiles，不给 shot_id / shot_text。"""
    monkeypatch.setenv("JELLYFISH_DRY_RUN", "1")

    db, engine = await build_session()
    async with db:
        result = await preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                entity_profiles=[
                    EntityProfileInput(name="姜岁欢", entity_type="character", profile="清冷少女，素色襦裙")
                ],
            ),
        )

    assert result.meta.dry_run is True
    categories = {str(slot.category.value) for slot in result.slots}
    # 帧槽位需要镜头文本，资产级应自动排除
    assert categories.isdisjoint({"frame_head_image", "frame_tail_image", "frame_key_image"})
    # 资产槽位仍然齐备
    assert {"character_image_front", "character_image_other", "scene_image_front"}.issubset(categories)
    assert any("资产级生成" in w for w in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_image_prompts_asset_level_keeps_explicit_frame_categories() -> None:
    """显式指定 categories 时不做自动排除（调用方说了算）。"""
    caller = make_recording_stub_caller({"slots": []})[0]

    db, engine = await build_session()
    async with db:
        result = await preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                entity_profiles=[EntityProfileInput(name="姜岁欢", entity_type="character", profile="x")],
                categories=[PromptCategory.frame_head_image],
            ),
            llm_caller=caller,
        )

    assert [str(slot.category.value) for slot in result.slots] == []  # stub 没返回 → 跳过
    assert not any("资产级生成" in w for w in result.warnings)
    await engine.dispose()


@pytest.mark.asyncio
async def test_preview_image_prompts_requires_shot_or_profiles() -> None:
    """两者都没有才报 400。"""
    db, engine = await build_session()
    async with db:
        with pytest.raises(HTTPException) as exc_info:
            await preview_image_prompts(
                db, body=ImagePromptPreviewRequest(), llm_caller=make_recording_stub_caller({"slots": []})[0]
            )
    assert exc_info.value.status_code == 400
    assert "entity_profiles" in str(exc_info.value.detail)
    await engine.dispose()
