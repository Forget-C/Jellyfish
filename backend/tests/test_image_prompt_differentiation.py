"""同身份多角色的提示词差异化（需求清单**第 4 条**，P0 阻断项的回归）。

现场（用户报的原始事故）
========================

剧本里出现**两个丫鬟**。系统按剧本原文给两人提取出**同一段外貌资料**
（原文本来就是把两人写在一起写的），于是两条图片提示词除名字外完全一样，
保存/出图前的**跨资产查重**判定「高度重复」并给 409 ——
用户**卡在生图之前**，资产准备这一步走不下去。

本文件钉住三件事
================

1. **强制**区分：即使模型对两个角色返回**逐字相同**的槽位内容，
   两个人的主体描述也必须被拆成两组互不重复的形象设计
   （靠后端确定性的「差异化设计锚点」，不靠模型临场发挥）；
2. **与调用顺序无关**：资产准备页一次只点名一个资产，
   只点名甲、只点名乙、两个一起生成，分配给某人的锚点必须**完全一致**；
3. **真的能进生图**：两条提示词必须通过 ``check_cross_asset_duplicates``
   （这是出图前置门禁，不是"看着不一样"就算）。

只跑内存库 + 桩模型：不触网、不付费、不碰任何真实库。
"""

from __future__ import annotations

from typing import Any

import pytest

from app.models.types import PromptCategory
from app.schemas.studio.llm_orchestration import ImagePromptPreviewRequest
from app.services.studio.asset_prompt_quality import check_cross_asset_duplicates
from app.services.studio.llm_orchestration.differentiation import (
    DESIGN_DIMENSIONS,
    apply_design_anchors,
    assign_design_anchors,
    build_identity_groups,
    extract_plot_identity,
    render_differentiation_rules,
    role_word_of,
)
from app.services.studio.llm_orchestration.image_prompt import preview_image_prompts
from tests.llm_orchestration_fixtures import build_session, make_recording_stub_caller

PROJECT_ID = "proj-maids"
CHAPTER_ID = "chap-maids"

#: 两人在剧本里被写在一起的**同一段**外貌资料 —— 这正是事故的形态。
SHARED_MAID_PROFILE = "两名丫鬟，青色布衣，梳双髻"

MAID_A = "丫鬟甲"
MAID_B = "丫鬟乙"


async def _seed(db: Any) -> None:
    """项目 + 本章 + 两个同身份角色（资料逐字相同）。"""
    from app.models.studio import Chapter, Character, Project

    db.add(Project(id=PROJECT_ID, name="两个丫鬟", description="", style="真人古装", visual_style="现实"))
    db.add(
        Chapter(
            id=CHAPTER_ID,
            project_id=PROJECT_ID,
            index=1,
            title="第一集",
            raw_text="两个丫鬟端茶进来。",
            condensed_text="两个丫鬟端茶进来。",
        )
    )
    db.add(
        Character(
            id="char-maid-a",
            project_id=PROJECT_ID,
            name=MAID_A,
            description=SHARED_MAID_PROFILE,
            style="真人古装",
            visual_style="现实",
        )
    )
    db.add(
        Character(
            id="char-maid-b",
            project_id=PROJECT_ID,
            name=MAID_B,
            description=SHARED_MAID_PROFILE,
            style="真人古装",
            visual_style="现实",
        )
    )
    await db.flush()


def _identical_slots_payload() -> dict[str, Any]:
    """模型**完全没有区分**两人时返回的内容（两次调用逐字相同）。

    刻意写成"一模一样"：差异化必须由后端兜住，而不是指望模型这次发挥好。
    """
    return {
        "slots": [
            {
                "category": "character_image_front",
                "subject": "一个年轻女子",
                "action_pose": "正面站立",
                "environment": "古装室内",
                "camera_language": "中景平视，柔和主光",
                "style": "真人古装，电影质感",
                "quality": "超清，细节丰富",
            }
        ]
    }


async def _preview(asset_name: str) -> Any:
    """按资产准备页的真实调用形态生成一次提示词（一次只点名一项）。"""
    db, engine = await build_session()
    try:
        await _seed(db)
        caller, prompts = make_recording_stub_caller(_identical_slots_payload())
        result = await preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                project_id=PROJECT_ID,
                chapter_id=CHAPTER_ID,
                entity_names=[asset_name],
                categories=[PromptCategory.character_image_front],
                shot_text=asset_name,
            ),
            llm_caller=caller,
        )
        return result, prompts
    finally:
        await engine.dispose()


# ---------------------------------------------------------------------------
# 纯函数：同身份分组
# ---------------------------------------------------------------------------


def test_role_word_and_plot_identity_extraction() -> None:
    """两种身份来源都要认得出来：名字里的身份词，以及画像文本里的「本章剧情身份」。"""
    assert role_word_of("丫鬟甲") == "丫鬟"
    assert role_word_of("贴身丫鬟小翠") == "贴身丫鬟"
    assert role_word_of("苏晚棠") == ""
    assert extract_plot_identity("外貌：素白襦裙；本章剧情身份：侯府嫡长女；出场镜头：#1") == "侯府嫡长女"
    assert extract_plot_identity("外貌：素白襦裙") == ""


def test_same_identity_group_needs_two_members() -> None:
    """只有一个成员的组不产生任何差异化动作（绝大多数资产行为不变）。"""
    from app.schemas.studio.llm_orchestration import EntityProfileCardRead

    lone = [
        EntityProfileCardRead(
            name="苏晚棠",
            entity_type="character",
            source="request",
            profile="素白襦裙",
            canonical_subject="苏晚棠（角色）：素白襦裙",
            has_structured_profile=True,
        )
    ]
    assert build_identity_groups(lone) == []
    assert assign_design_anchors(lone) == {}
    cards, notes = apply_design_anchors(lone, all_cards=lone)
    assert notes == []
    assert cards[0].canonical_subject == "苏晚棠（角色）：素白襦裙"


def test_anchor_assignment_is_stable_and_unique() -> None:
    """同组内锚点两两不同，且同一份数据永远得到同一组锚点。"""
    from app.schemas.studio.llm_orchestration import EntityProfileCardRead

    cards = [
        EntityProfileCardRead(
            name=name,
            entity_type="character",
            source="request",
            profile=SHARED_MAID_PROFILE,
            canonical_subject=f"{name}（角色）：{SHARED_MAID_PROFILE}",
            has_structured_profile=True,
        )
        for name in (MAID_A, MAID_B)
    ]
    first = assign_design_anchors(cards)
    second = assign_design_anchors(list(reversed(cards)))  # 顺序无关
    assert first == second

    # 组内组合两两不同
    combos = {tuple(value for _name, value in anchor.choices) for anchor in first.values()}
    assert len(combos) == len(first)


def test_differentiation_rules_only_list_real_groups() -> None:
    """没有同身份多角色时，不写具体名单（不给模型凭空编造区分对象的机会）。"""
    from app.schemas.studio.llm_orchestration import EntityProfileCardRead

    lone = EntityProfileCardRead(
        name="苏晚棠",
        entity_type="character",
        source="request",
        profile="素白襦裙",
        canonical_subject="苏晚棠（角色）：素白襦裙",
        has_structured_profile=True,
    )
    text = render_differentiation_rules([lone])
    assert "严禁" in text
    assert "本项目的同身份角色" not in text


# ---------------------------------------------------------------------------
# 端到端（桩模型）：两条提示词必须逐项不重复，且能过出图门禁
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_two_maids_get_distinct_prompts_and_pass_the_outlet_gate() -> None:
    """**验收主用例**：含两个丫鬟的项目，两条提示词不重复，且能进入生图步骤。"""
    result_a, prompts_a = await _preview(MAID_A)
    result_b, _ = await _preview(MAID_B)

    slot_a = result_a.slots[0]
    slot_b = result_b.slots[0]
    assert slot_a.category is PromptCategory.character_image_front

    # ① 两条完整提示词不重复（这是页面「两条一样 → 不能保存」的直接对照）
    assert slot_a.prompt != slot_b.prompt

    # ② 主体描述逐项不重复：七个设计维度上两人的取值必须两两不同
    for dimension, _options in DESIGN_DIMENSIONS:
        values = []
        for slot in (slot_a, slot_b):
            body = slot.layers["subject"]
            marker = f"{dimension}："
            assert marker in body, f"主体描述里缺少设计维度「{dimension}」：{body}"
            values.append(body.split(marker, 1)[1].split("；", 1)[0])
        assert values[0] != values[1], f"维度「{dimension}」上两个丫鬟仍然相同：{values[0]}"

    # ③ **真的能进生图**：出图前置的跨资产查重必须放行
    issues = check_cross_asset_duplicates(
        [
            ("char-maid-a", MAID_A, slot_a.prompt),
            ("char-maid-b", MAID_B, slot_b.prompt),
        ]
    )
    assert issues == [], f"跨资产查重仍然拦住出图：{[issue.message for issue in issues]}"

    # ④ 页面上看得到"这两个角色被怎么区分开了"（用户语言，可人工核对）
    notes = [item for item in result_a.warnings if MAID_B in item]
    assert notes, result_a.warnings
    assert "形象设计分开" in notes[0]

    # ⑤ 提示词正文里确实带上了「逐个独立设计」的硬规则与同身份名单
    assert MAID_B in prompts_a[0]
    assert "逐个独立设计" in prompts_a[0] or "互不重复的外貌" in prompts_a[0]


@pytest.mark.asyncio
async def test_anchor_is_identical_whether_requested_alone_or_together() -> None:
    """与调用顺序无关：只点名甲、只点名乙、两个一起生成，同一人拿到的锚点必须一致。"""
    alone_a, _ = await _preview(MAID_A)
    alone_b, _ = await _preview(MAID_B)

    db, engine = await build_session()
    try:
        await _seed(db)
        caller, _prompts = make_recording_stub_caller(_identical_slots_payload())
        together = await preview_image_prompts(
            db,
            body=ImagePromptPreviewRequest(
                project_id=PROJECT_ID,
                chapter_id=CHAPTER_ID,
                entity_names=[MAID_A, MAID_B],
                categories=[PromptCategory.character_image_front, PromptCategory.character_image_other],
                shot_text=f"{MAID_A}{MAID_B}",
            ),
            llm_caller=caller,
        )
    finally:
        await engine.dispose()

    # 甲单独生成时的主体描述，必须与"两人一起生成"时属于甲的那条完全一致
    anchor_a = alone_a.entity_cards[0].canonical_subject
    assert anchor_a in {card.canonical_subject for card in together.entity_cards}
    anchor_b = alone_b.entity_cards[0].canonical_subject
    assert anchor_b in {card.canonical_subject for card in together.entity_cards}
    assert anchor_a != anchor_b


# ---------------------------------------------------------------------------
# 查重门禁本身：**剔掉共享版式词之后**再比，且真重复照样拦住（不许被削弱）
# ---------------------------------------------------------------------------


def test_duplicate_gate_is_not_weakened_for_true_duplicates() -> None:
    """两个资产**内容真的没区分开**时，必须照旧 409（这是修复的前提，不是代价）。"""
    from app.services.studio.asset_prompt_quality import CODE_DUPLICATE_TEXT

    text = (
        "丫鬟甲（角色）：两名丫鬟，青色布衣，梳双髻，16:9 horizontal character reference sheet，"
        "the layout has two clear sections，photorealistic, cinematic lighting"
    )
    issues = check_cross_asset_duplicates([("char-a", "丫鬟甲", text), ("char-b", "丫鬟乙", text)])
    assert [issue.code for issue in issues] == [CODE_DUPLICATE_TEXT]


def test_duplicate_gate_still_ignores_boilerplate_only_prompts() -> None:
    """只剩共享版式词的提示词（没有资产特有内容）仍然是重复 —— 剔词不等于放行。"""
    from app.services.studio.llm_orchestration import registry

    boilerplate_only = "，".join(registry.CHARACTER_REFERENCE_SHEET_LAYOUT)
    issues = check_cross_asset_duplicates(
        [("char-a", "丫鬟甲", boilerplate_only), ("char-b", "丫鬟乙", boilerplate_only)]
    )
    assert len(issues) == 1


def test_shared_boilerplate_strip_only_removes_known_deterministic_text() -> None:
    """剔掉的只能是后端逐字补齐的那批词；资产自己的描述一个字都不能少。

    实现是**整句**匹配（不做单词级模糊剔除）：只有装配时逐字写进去的整段
    版式 / 画质 / 负面词才会被剔掉，避免把用户自己写的相近措辞误删。
    """
    from app.services.studio.asset_prompt_quality import strip_shared_boilerplate
    from app.services.studio.llm_orchestration import registry

    raw = (
        "丫鬟甲（角色）：两名丫鬟，青色布衣，梳双髻，"
        f"{registry.DEFAULT_QUALITY_WORDS}，{registry.CHARACTER_REFERENCE_SHEET_LAYOUT[0]}"
    )
    residue = strip_shared_boilerplate(raw)
    assert "两名丫鬟" in residue
    assert "青色布衣" in residue
    assert "cinematiclighting" not in residue
    assert "16:9horizontalcharacterreferencesheet" not in residue
