"""角色设定图的版式（需求清单**第 2 条**第 2 项）。

需求原文
========

> **人物生成类型错误**：目前人物只生成**单张全身图**。应改为生成**人物参考图（角色设定图）**，
> 版式为：**左侧**面部大特写；**右侧**全身图，包含**正面、侧面、背面**三个视角。

这里钉住**参数装配口径**：角色提示词的版式词只能来自
:data:`registry.CHARACTER_REFERENCE_SHEET_LAYOUT`
（**ported from** ``人物及场景生产项目``，只搬提示词文本、不 import 该项目）。

（同属需求第 2 条的「类型 → 画幅」见 ``test_asset_type_ratio_mapping.py``。）

不触网、不付费、不碰任何真实库。
"""

from __future__ import annotations

import pytest

from app.models.types import PromptCategory
from app.services.studio.llm_orchestration import registry


# ---------------------------------------------------------------------------
# 角色设定图版式
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "category",
    [PromptCategory.character_image_front, PromptCategory.character_image_other],
)
def test_character_slots_carry_the_reference_sheet_layout(category: PromptCategory) -> None:
    """两个角色槽位的版式词都是「左面部大特写 + 右全身三视图」这一套，不是单张全身图。"""
    rules = registry.SLOT_STYLE_RULES[str(category.value)]
    assert rules == registry.CHARACTER_REFERENCE_SHEET_LAYOUT
    blob = " ".join(rules).lower()
    assert "face close-up" in blob
    assert "three-view turnaround" in blob
    assert "front view, side view, back view" in blob
    # 旧口径的"单张全身图"必须已经不在版式词里
    assert "full body character reference sheet" not in blob


def test_character_layout_ported_lines_are_present_verbatim() -> None:
    """port 过来的关键版式句必须**逐字**在表里（否则模型会被自己的措辞带偏）。"""
    assert (
        "left panel contains exactly one large face close-up only, one single head, "
        "cropped from top of head to collarbone"
    ) in registry.CHARACTER_REFERENCE_SHEET_LAYOUT
    assert "face occupies 75 to 85 percent of the left panel" in registry.CHARACTER_REFERENCE_SHEET_LAYOUT
    assert (
        "right panel contains full-body three-view turnaround: front view, side view, back view"
    ) in registry.CHARACTER_REFERENCE_SHEET_LAYOUT


def test_character_negative_words_no_longer_fight_the_layout() -> None:
    """旧负面词与新版的冲突必须已消除（否则版式做不出来）。

    - ``half body`` / ``cropped body``：新版式**左区本来就是面部裁切特写**，
      留着这两条会把左区逼回全身；
    - ``multiple people``：三视图里同一个人出现四次，写它会压掉版式；
      正确口径是禁止"**不同**的人"与"多余的人"。
    """
    for category in (PromptCategory.character_image_front, PromptCategory.character_image_other):
        negatives = registry.SLOT_NEGATIVE_EXTRA[str(category.value)]
        assert "half body" not in negatives
        assert "cropped body" not in negatives
        assert "multiple people" not in negatives
        assert "different people" in negatives
        assert "extra people" in negatives
        assert "portrait grid" in negatives


def test_character_slot_view_hint_describes_the_two_panel_layout() -> None:
    """槽位视角说明（进提示词的「需要生成的槽位」段落）也要说清左右两块版式。"""
    spec = registry.IMAGE_PROMPT_SLOT_BY_CATEGORY[str(PromptCategory.character_image_front.value)]
    assert "面部特写" in spec.view_hint
    assert "三视图" in spec.view_hint
    assert spec.label == "角色设定图（正面）"


def test_character_layout_is_ported_not_imported() -> None:
    """硬约束：只 port 提示词文本，**不 import、不在运行时依赖**参考项目。

    检查方式：整个 registry.py 的 import 语句里不许出现参考项目路径，
    也不许出现任何运行时取值自该项目的写法（它压根不在本仓库里）。
    """
    import pathlib
    import re

    source = pathlib.Path("app/services/studio/llm_orchestration/registry.py").read_text(encoding="utf-8")
    assert "人物及场景生产项目" in source, "port 的来源必须写在注释里（便于日后对账）"

    import_lines = [
        line for line in source.splitlines() if re.match(r"\s*(from|import)\s", line)
    ]
    for line in import_lines:
        assert "人物及场景生产项目" not in line
        assert "server.js" not in line
