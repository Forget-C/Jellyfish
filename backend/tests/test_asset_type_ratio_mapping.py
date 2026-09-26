"""类型 → 画幅的映射（需求清单**第 2 条**第 3 项）。

需求原文
========

> **画面比例被统一成一个值**：所有资产共用一个比例。实际应按类型区分：
> **人物：16:9**、**场景：16:9**、**道具：1:1**。

这里钉住**参数装配口径**：画幅只能来自
:data:`asset_strategies.ASSET_TYPE_ASPECT_RATIOS`（不许别处再写第二份）。

（同属需求第 2 条的「角色设定图版式」见 ``test_character_reference_sheet_layout.py``：
两者原本在同一个文件里，但它们属于**两个不同的台账项**（A3 / A2），
拆开之后每个 commit 都能独立跑绿，评审时也能按项对应。）

不触网、不付费、不碰任何真实库。
"""

from __future__ import annotations

from app.services.studio.image_pipeline import asset_strategies as strategies


# ---------------------------------------------------------------------------
# 类型 → 画幅
# ---------------------------------------------------------------------------


# A3 类型 → 画幅
# ---------------------------------------------------------------------------


def test_type_to_ratio_mapping_is_exactly_the_required_one() -> None:
    """需求给的映射逐项对齐：人物 16:9、场景 16:9、道具 1:1。"""
    assert strategies.ASSET_TYPE_ASPECT_RATIOS["character"] == "16:9"
    assert strategies.ASSET_TYPE_ASPECT_RATIOS["scene"] == "16:9"
    assert strategies.ASSET_TYPE_ASPECT_RATIOS["prop"] == "1:1"
    # 服装没有本清单给出的口径 → 不允许替用户拍板，表里就不该有它
    assert "costume" not in strategies.ASSET_TYPE_ASPECT_RATIOS
    assert strategies.aspect_ratio_for("costume") is None
    assert strategies.aspect_ratio_for("不存在的类型") is None


def test_every_strategy_ratio_comes_from_the_single_mapping() -> None:
    """分流表里的画幅必须与映射表一致（唯一事实来源，不允许两处各写一份）。"""
    for asset_type, ratio in strategies.ASSET_TYPE_ASPECT_RATIOS.items():
        strategy = strategies.strategy_for(asset_type)
        assert strategy.aspect_ratio == ratio, asset_type
    # 人物是**写死**口径（覆盖映射），场景/道具是**默认**口径（允许调用方覆盖）
    assert strategies.strategy_for("character").fixed_aspect_ratio == "16:9"
    assert strategies.strategy_for("character").default_aspect_ratio is None
    for asset_type in ("scene", "prop"):
        strategy = strategies.strategy_for(asset_type)
        assert strategy.fixed_aspect_ratio is None
        assert strategy.default_aspect_ratio == strategies.ASSET_TYPE_ASPECT_RATIOS[asset_type]


def test_resolve_aspect_ratio_reports_where_the_ratio_came_from() -> None:
    """没传比例时按类型取；来源必须如实回报（页面据此解释"为什么是这个比例"）。"""
    # 不传 → 类型映射
    for asset_type, ratio in strategies.ASSET_TYPE_ASPECT_RATIOS.items():
        if asset_type == "character":
            continue  # 人物是写死口径，来源不同，见下面的断言
        resolved = strategies.resolve_aspect_ratio(asset_type, "")
        assert (resolved.ratio, resolved.source) == (ratio, "asset_type_default")
        assert resolved.warning == ""

    # 道具：这次修复的**重点** —— 此前它跟场景一起落到 16:9
    prop = strategies.resolve_aspect_ratio("prop", "")
    assert prop.ratio == "1:1"
    assert "1:1" in strategies.strategy_for("prop").ratio_note

    # 场景：默认 16:9
    assert strategies.resolve_aspect_ratio("scene", "").ratio == "16:9"

    # 人物：写死 16:9，传什么都不采纳，并如实回报被忽略的值
    character = strategies.resolve_aspect_ratio("character", "1:1")
    assert (character.ratio, character.source) == ("16:9", "character_reference_fixed")
    assert "1:1" in character.warning

    # 调用方显式传了比例 → 以调用方为准（人物除外）
    assert strategies.resolve_aspect_ratio("prop", "3:4") == strategies.AspectRatioResolution(
        ratio="3:4", source="request"
    )
    # 服装没有任何类型口径 → 沿用管线默认
    costume = strategies.resolve_aspect_ratio("costume", "")
    assert costume.source == "default"
    assert costume.ratio == strategies.DEFAULT_ASPECT_RATIO
