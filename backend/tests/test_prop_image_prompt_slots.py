"""道具（prop）的图片提示词槽位补齐：注册表 / 生成链路 / 保存链路 / 分流表。

用户口径：「人物→16:9 人物参考图；场景→场景资产图；**道具→道具资产图**；
服装→服装设计图」，并且「道具要补齐正式的图片提示词槽位与保存/生成链路，
不要再用『不支持（无槽位）』兜底」。

这一批用例钉住的就是"道具不再是二等公民"这件事。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.types import PromptCategory
from app.schemas.studio.llm_orchestration import EntityProfileInput, ImagePromptPreviewRequest
from app.services.studio.image_pipeline import asset_strategies as strategies
from app.services.studio.llm_orchestration import image_prompt as image_prompt_service
from app.services.studio.llm_orchestration.registry import (
    ALL_IMAGE_PROMPT_SLOT_SPECS,
    ASSET_IMAGE_PROMPT_SLOTS,
    DEFAULT_IMAGE_PROMPT_CATEGORIES,
    IMAGE_PROMPT_SLOT_BY_CATEGORY,
    PROP_IMAGE_PROMPT_SLOT_SPECS,
    SLOT_NEGATIVE_EXTRA,
    SLOT_STYLE_RULES,
    image_prompt_slot_specs,
)
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot

PROP_PROFILE = "材质：乌木；颜色：深褐近黑；形状：直杆带龙首弯柄；尺寸：约一米二；状态：握柄有磨痕；用途：支撑行走"

def _stub_caller(categories: list[PromptCategory]):
    """桩化文本模型：按请求槽位返回"分层结构完整 + 带结构化特征"的 JSON（不出网）。"""
    import json

    subjects = {
        "character_image_front": "姜岁欢（角色）：十六岁少女，鹅蛋脸杏眼，乌黑长直发束双环髻，素白襦裙",
        "scene_image_front": "将军府·正堂（场景）：高梁方厅，青砖地面，乌木太师椅，冷白日光",
        "prop_image_front": "乌木拐杖（道具）：乌木材质，深褐近黑，直杆带龙首弯柄，约一米二",
        "costume_image_front": "素白襦裙（服装）：交领右衽，上襦下裙，素白细棉布",
    }

    async def _call(_prompt: str) -> str:
        return json.dumps(
            {
                "slots": [
                    {
                        "category": str(category.value),
                        "subject": subjects.get(str(category.value), "通用主体"),
                        "action_pose": "按槽位视角展示",
                        "environment": "干净背景",
                        "camera_language": "中景平视，柔和主光",
                        "style": "写实短剧风格",
                        "quality": "高清锐利",
                    }
                    for category in categories
                ]
            },
            ensure_ascii=False,
        )

    return _call



def test_prop_slots_are_registered_with_real_specs() -> None:
    """道具的两个槽位必须在注册表里有正式规格（有标签/视角说明/实体类型）。"""
    assert {str(spec.category.value) for spec in PROP_IMAGE_PROMPT_SLOT_SPECS} == {
        "prop_image_front",
        "prop_image_other",
    }
    front = IMAGE_PROMPT_SLOT_BY_CATEGORY["prop_image_front"]
    assert front.label == "道具正面图片"
    assert front.entity_type == "prop"
    assert "画" in front.view_hint or "展示" in front.view_hint
    assert front.subject_source == "道具画像卡"

    other = IMAGE_PROMPT_SLOT_BY_CATEGORY["prop_image_other"]
    assert other.entity_type == "prop"
    assert "材质" in other.view_hint and "颜色" in other.view_hint


def test_prop_slots_have_style_and_negative_rules() -> None:
    """道具槽位要有自己的风格词与负面词（否则等于没有按类型分流模板）。"""
    assert "prop_image_front" in SLOT_STYLE_RULES
    assert any("whole object" in rule for rule in SLOT_STYLE_RULES["prop_image_front"])
    assert "prop_image_front" in SLOT_NEGATIVE_EXTRA
    assert "human figure" in SLOT_NEGATIVE_EXTRA["prop_image_front"]


def test_default_nine_slots_are_unchanged() -> None:
    """默认九槽位口径**逐字不变**（道具槽位是新增能力，不改镜头级/批量预览的既有行为）。"""
    assert len(DEFAULT_IMAGE_PROMPT_CATEGORIES) == 9
    assert "prop_image_front" not in {str(category.value) for category in DEFAULT_IMAGE_PROMPT_CATEGORIES}
    assert len(ALL_IMAGE_PROMPT_SLOT_SPECS) == 11


def test_slot_specs_endpoint_listing_includes_prop() -> None:
    """给前端渲染表单的槽位清单里必须有道具槽位（否则前端只能硬编码或没入口）。"""
    slots = image_prompt_slot_specs()
    by_category = {slot["category"]: slot for slot in slots}
    assert "prop_image_front" in by_category and "prop_image_other" in by_category
    assert by_category["prop_image_front"]["entity_type"] == "prop"
    assert by_category["prop_image_front"]["default"] is False
    assert by_category["character_image_front"]["default"] is True


def test_resolve_requested_categories_no_longer_drops_prop() -> None:
    """道具槽位以前被 `resolve_requested_categories` **静默丢掉**，现在必须保留。"""
    resolved = image_prompt_service.resolve_requested_categories(
        [PromptCategory.prop_image_front, PromptCategory.character_image_front]
    )
    assert [str(category.value) for category in resolved] == ["prop_image_front", "character_image_front"]


def test_asset_type_slot_map_is_four_way_symmetric() -> None:
    """四类资产同构：每类都有自己的正面/其它视角槽位。"""
    assert set(ASSET_IMAGE_PROMPT_SLOTS) == {"character", "scene", "prop", "costume"}
    assert ASSET_IMAGE_PROMPT_SLOTS["prop"] == (
        PromptCategory.prop_image_front,
        PromptCategory.prop_image_other,
    )
    for asset_type, (front, other) in ASSET_IMAGE_PROMPT_SLOTS.items():
        assert str(front.value).startswith(asset_type)
        assert str(other.value).startswith(asset_type)


def test_strategy_table_points_prop_at_the_registered_slot() -> None:
    """分流表策略里的槽位必须就是注册表里那个（不能一个指向有规格、一个指向没规格的）。"""
    for asset_type, strategy in strategies.STRATEGIES.items():
        assert str(strategy.prompt_slot.value) in IMAGE_PROMPT_SLOT_BY_CATEGORY, asset_type
    assert strategies.STRATEGIES["prop"].prompt_slot is PromptCategory.prop_image_front
    assert strategies.STRATEGIES["prop"].result_kind == "propAssetImage"
    assert strategies.STRATEGIES["prop"].result_label == "道具资产图"


@pytest.mark.asyncio
async def test_mixed_batch_preview_routes_each_slot_by_asset_type() -> None:
    """混合批量：四类资产各出一个槽位，必须按 asset_type 路由到各自模板（不套同一个角色模板）。"""
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        result = await image_prompt_service.preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                project_id="proj-1",
                entity_profiles=[
                    EntityProfileInput(name="姜岁欢", entity_type="character", profile="十六岁少女，素白襦裙"),
                    EntityProfileInput(name="将军府·正堂", entity_type="scene", profile="高梁方厅，青砖地面"),
                    EntityProfileInput(name="乌木拐杖", entity_type="prop", profile=PROP_PROFILE),
                    EntityProfileInput(name="素白襦裙", entity_type="costume", profile="交领右衽，素白细棉布"),
                ],
                categories=[
                    PromptCategory.character_image_front,
                    PromptCategory.scene_image_front,
                    PromptCategory.prop_image_front,
                    PromptCategory.costume_image_front,
                ],
            ),
            llm_caller=_stub_caller(
                [
                    PromptCategory.character_image_front,
                    PromptCategory.scene_image_front,
                    PromptCategory.prop_image_front,
                    PromptCategory.costume_image_front,
                ]
            ),
        )
    await engine.dispose()

    by_category = {str(slot.category.value): slot for slot in result.slots}
    assert set(by_category) == {
        "character_image_front",
        "scene_image_front",
        "prop_image_front",
        "costume_image_front",
    }

    prop = by_category["prop_image_front"]
    assert prop.entity_name == "乌木拐杖"
    assert "乌木" in prop.layers["subject"]
    # 风格/负面词按类型分流（道具槽位专属规则，不是角色模板）
    assert "isolated prop reference" in prop.layers["style"]
    assert "human figure" in prop.negative_prompt

    # 没有串味：道具槽位不能拿到人物的视角说明或结果类型
    assert "characterReference" not in prop.prompt
    assert "正面全身参考图" not in prop.prompt
    assert "角色" not in prop.layers["action_pose"]


@pytest.mark.asyncio
async def test_prop_preview_is_savable_when_profile_has_features() -> None:
    """道具槽位提示词在后端质量判定里是"可保存"的（有结构化特征，不是名字 + 通用词）。"""
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        result = await image_prompt_service.preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                project_id="proj-1",
                entity_profiles=[EntityProfileInput(name="乌木拐杖", entity_type="prop", profile=PROP_PROFILE)],
                categories=[PromptCategory.prop_image_front],
            ),
            llm_caller=_stub_caller([PromptCategory.prop_image_front]),
        )
    await engine.dispose()

    slot = result.slots[0]
    assert slot.savable is True
    assert slot.quality_issues == []
    assert slot.entity_name == "乌木拐杖"


@pytest.mark.asyncio
async def test_slot_without_structured_profile_is_refused_with_reason_and_fix() -> None:
    """画像卡只剩空话时**如实拒绝这一项**（结构化原因 + 怎么补），且不发起任何调用。

    口径（真实事故修复后）：本次请求要的**每一项**都没资料 → 这才是"整体不可用"，
    返回结构化 422（`asset_profile_missing`）；原因只写这几项、并给"怎么补"，
    拒绝发生在生成之前（不花钱）。请求里只要还有一项有资料，就照常逐项生成，
    缺资料的那一项单独标在它自己的槽位上（见 `test_image_prompt_request_scope.py`）。
    """
    recorded: list[str] = []

    async def _recording(_prompt: str) -> str:
        recorded.append(_prompt)
        return await _stub_caller([PromptCategory.character_image_front])(_prompt)

    db, engine = await build_session()
    try:
        async with db:
            await seed_project_chapter_shot(db)
            with pytest.raises(HTTPException) as excinfo:
                await image_prompt_service.preview_image_prompts(
                    db,
                    body=ImagePromptPreviewRequest(
                        project_id="proj-1",
                        entity_profiles=[EntityProfileInput(name="姜岁欢", entity_type="character", profile="")],
                        categories=[PromptCategory.character_image_front],
                    ),
                    llm_caller=_recording,
                )
    finally:
        await engine.dispose()

    assert excinfo.value.status_code == 422
    detail = excinfo.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "asset_profile_missing"
    # 原因说清"为什么不可用"，并且点名的是这次要的那一项
    assert "姜岁欢" in detail["message"]
    assert "没有可用于出图的资料" in detail["message"]
    # 怎么补是必给的（用户照做就能拿到可用结果）
    assert detail["fix"]
    # 拒绝发生在生成之前：一次模型调用都没发出去（不花钱）
    assert recorded == []


@pytest.mark.asyncio
async def test_character_slot_reports_structured_source() -> None:
    """有资料时如实标注来源（页面可以说明"这段描述是从哪来的"）。"""
    db, engine = await build_session()
    async with db:
        await seed_project_chapter_shot(db)
        result = await image_prompt_service.preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                project_id="proj-1",
                entity_profiles=[
                    EntityProfileInput(
                        name="姜岁欢",
                        entity_type="character",
                        profile="十六岁少女，鹅蛋脸杏眼，素白襦裙",
                        profile_source="candidate_profile",
                    )
                ],
                categories=[PromptCategory.character_image_front],
            ),
            llm_caller=_stub_caller([PromptCategory.character_image_front]),
        )
    await engine.dispose()

    slot = result.slots[0]
    assert slot.structured_source == "candidate_profile"
    assert slot.savable is True
