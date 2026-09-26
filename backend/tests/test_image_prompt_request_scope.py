"""图片提示词生成的**请求范围**：只对本次要的资产预检 + 逐项隔离（真实事故的回归）。

现场（用户点名，御兽嫡长女第 1 集）：在工作台勾了 4 项（2 角色 + 1 场景 + 1 道具），
按钮显示「生成图片提示词（4）」；点下去之后页面却说
「后端标注：以下实体在库里没有可用于出图的资料（苏晚棠素服、叶老夫人常服、邓嬷嬷嬷嬷服、昭昭丧服）…」——
这 4 件服装**一个都没被勾选**（它们在本章只有资料记录、资料全空），
却让用户勾的那几项一起变成"不能保存"。

根因（两条，都在本文件里钉住）：
1. 资产级自动装载会把**整个项目/本章**的实体装成画像卡（给模型当上下文是合理的），
   而"谁没有资料"的预检此前是拿**整份画像卡**做的 → 没被要求的空壳资产把整批判死；
2. 那段原因被页面当成"这一行不可保存的原因"（前端部分见 `assetPromptRequestScope.test.ts`）。

本文件只跑内存库 + 桩模型：不触网、不付费、不碰任何真实库。
"""

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
    preview_image_prompts,
    requested_asset_names,
    resolve_profile_scope,
)
from tests.llm_orchestration_fixtures import build_session, make_recording_stub_caller

PROJECT_ID = "proj-scope"
CHAPTER_ID = "chap-scope"

#: 本章只有资料记录、资料全空的 4 件服装（现场里"没被勾选却出现在原因里"的就是它们）。
EMPTY_COSTUMES = ("苏晚棠素服", "叶老夫人常服", "邓嬷嬷嬷嬷服", "昭昭丧服")
#: 用户真正勾选的 4 项。
SELECTED = (
    ("character", "苏晚棠", "character_image_front"),
    ("character", "乌鸦", "character_image_front"),
    ("scene", "南安侯府大堂", "scene_image_front"),
    ("prop", "棺材", "prop_image_front"),
)

CHARACTER_PROFILE = "二十六岁女子，鹅蛋脸杏眼，乌黑长发绾髻，素白交领襦裙，腰间系青玉佩"
SCENE_PROFILE = "侯府正堂，青砖地面，朱红立柱，高悬「南安侯府」匾额，两列太师椅"
PROP_PROFILE = "黑漆棺木，木质纹理清晰，长两米，两端铜钉包角，棺盖半掩"
COSTUME_PROFILE = "月白色交领襦裙，绸缎质地，袖口绣兰草，腰束青带"


async def _seed(db) -> None:  # type: ignore[no-untyped-def]
    """项目 + 本章 + 用户勾的 4 项（都有资料）+ 4 件没被勾选的空壳服装。

    只建测试库里的最小结构，**不生成任何候选/资料记录**：
    空壳服装走的是"资产存在但描述与本章资料都是空的"这条最普通的路。
    """
    from app.models.studio import (
        Chapter,
        Character,
        Costume,
        Project,
        ProjectCostumeLink,
        ProjectPropLink,
        ProjectSceneLink,
        Prop,
        Scene,
    )

    db.add(Project(id=PROJECT_ID, name="御兽嫡长女", description="", style="真人古装", visual_style="现实"))
    db.add(Chapter(id=CHAPTER_ID, project_id=PROJECT_ID, index=1, title="第一集", raw_text="", condensed_text=""))
    db.add(
        Character(
            id="char-su",
            project_id=PROJECT_ID,
            name="苏晚棠",
            description=CHARACTER_PROFILE,
            style="真人古装",
            visual_style="现实",
        )
    )
    db.add(
        Character(
            id="char-wu",
            project_id=PROJECT_ID,
            name="乌鸦",
            description="三十岁男子，瘦高个，黑布短打，左眉有一道刀疤",
            style="真人古装",
            visual_style="现实",
        )
    )
    db.add(Scene(id="scene-hall", name="南安侯府大堂", description=SCENE_PROFILE, style="真人古装", view_count=1, tags=[]))
    db.add(Prop(id="prop-coffin", name="棺材", description=PROP_PROFILE, style="真人古装", view_count=1, tags=[]))
    db.add(ProjectSceneLink(id=1, project_id=PROJECT_ID, scene_id="scene-hall"))
    db.add(ProjectPropLink(id=1, project_id=PROJECT_ID, prop_id="prop-coffin"))
    for index, name in enumerate(EMPTY_COSTUMES, start=1):
        # 资产是之前确认时建出来的，但描述为空、本章资料也为空（"待补资料"状态）
        db.add(Costume(id=f"costume-empty-{index}", name=name, description="", style="真人古装", view_count=1, tags=[]))
        db.add(ProjectCostumeLink(id=index, project_id=PROJECT_ID, costume_id=f"costume-empty-{index}"))
    await db.flush()


def _card(
    name: str,
    entity_type: str = "character",
    profile: str = CHARACTER_PROFILE,
) -> EntityProfileCardRead:
    return EntityProfileCardRead(
        name=name,
        entity_type=entity_type,
        source="request",
        profile=profile,
        canonical_subject=f"{name}（{entity_type}）：{profile}",
        has_structured_profile=bool(profile),
    )


def _slots_payload(categories: list[PromptCategory]) -> dict[str, object]:
    return {
        "slots": [
            {
                "category": category.value,
                "subject": "模型自己编的主体描述",
                "action_pose": "正面站立",
                "environment": "侯府大堂",
                "camera_language": "中景平视，柔和主光",
                "style": "真人古装，电影质感",
                "quality": "超清，细节丰富",
            }
            for category in categories
        ]
    }


# ---------------------------------------------------------------------------
# 纯函数：范围只认"本次请求涉及的资产"
# ---------------------------------------------------------------------------


def test_requested_asset_names_prefers_entity_names_then_profiles() -> None:
    assert requested_asset_names(ImagePromptPreviewRequest(shot_text="随便一句话")) == []
    assert requested_asset_names(
        ImagePromptPreviewRequest(
            entity_names=["苏晚棠"],
            entity_profiles=[EntityProfileInput(name="别的东西", entity_type="scene", profile="x")],
        )
    ) == ["苏晚棠"]
    assert requested_asset_names(
        ImagePromptPreviewRequest(
            entity_profiles=[EntityProfileInput(name="乌鸦", entity_type="character", profile="y")]
        )
    ) == ["乌鸦"]


def test_resolve_profile_scope_ignores_cards_outside_the_request() -> None:
    """没被本次请求点到的画像卡（例如整章自动装载进来的空壳服装）不进预检范围。"""
    cards = [_card("苏晚棠"), *[_card(name, "costume", "") for name in EMPTY_COSTUMES], _card("乌鸦")]

    # ① 调用方点名 → 范围就是它
    named = resolve_profile_scope(
        cards=cards,
        categories=[PromptCategory.character_image_front],
        shot_text="苏晚棠",
        explicit_names=["苏晚棠"],
    )
    assert [card.name for card in named] == ["苏晚棠"]

    # ② 没点名 → 范围是**本次槽位实际会用到的那张卡**（按镜头/资产名挑），不是整份画像卡
    picked = resolve_profile_scope(
        cards=cards,
        categories=[PromptCategory.character_image_front],
        shot_text="苏晚棠",
        explicit_names=[],
    )
    assert [card.name for card in picked] == ["苏晚棠"]
    # 空壳服装一张都不在范围里
    assert all(card.name not in EMPTY_COSTUMES for card in picked)


# ---------------------------------------------------------------------------
# ① 只勾 4 项、4 项都有资料 → 生成集合里**没有**第 5 个资产
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_each_requested_asset_gets_its_own_scoped_request() -> None:
    """逐项请求：每次只有这一项进画像卡与提示词，未被要求的 4 件服装一个都不出现。"""
    db, engine = await build_session()
    all_prompts: list[str] = []
    try:
        async with db:
            await _seed(db)
            for _asset_type, name, slot in SELECTED:
                category = PromptCategory(slot)
                caller, prompts = make_recording_stub_caller(_slots_payload([category]))
                preview = await preview_image_prompts(
                    db,
                    body=_body(name=name, category=category),
                    llm_caller=caller,
                )
                all_prompts.extend(prompts)
                # 本次生成集合 = 这一项：画像卡只有它，槽位也只认它
                assert [card.name for card in preview.entity_cards] == [name]
                assert [slot_.entity_name for slot_ in preview.slots] == [name]
    finally:
        await engine.dispose()

    # 4 项 = 4 次调用（没有第二条"批量/全域"路径）
    assert len(all_prompts) == len(SELECTED)
    joined = "\n".join(all_prompts)
    for name in EMPTY_COSTUMES:
        assert name not in joined, f"没被勾选的服装 {name} 不该进提示词"


@pytest.mark.asyncio
async def test_unselected_empty_costumes_do_not_poison_the_result() -> None:
    """现场回归：整章自动装载里有 4 件空壳服装，但不影响被要求的那一项可用。"""
    db, engine = await build_session()
    try:
        async with db:
            await _seed(db)
            # 面板的实际调用形态：只给项目 + 资产名（不点名实体），后端自动装载整章画像
            caller, _prompts = make_recording_stub_caller(
                _slots_payload([PromptCategory.character_image_front])
            )
            preview = await preview_image_prompts(
                db,
                body=ImagePromptPreviewRequest(
                    project_id=PROJECT_ID,
                    chapter_id=CHAPTER_ID,
                    shot_text="苏晚棠",
                    categories=[PromptCategory.character_image_front],
                ),
                llm_caller=caller,
            )
    finally:
        await engine.dispose()

    # 上下文里确实装着整章（这是自动装载的本意），但原因里一个字都不提它们
    assert any(card.name in EMPTY_COSTUMES for card in preview.entity_cards)
    assert all(name not in " ".join(preview.warnings) for name in EMPTY_COSTUMES)
    # 这一项自己有资料 → 结果可用（不再被别人的空壳判死）
    assert preview.slots[0].savable is True
    assert preview.slots[0].quality_issues == []


# ---------------------------------------------------------------------------
# ② 请求里混入 1 项无资料 → 其它项照常产出，缺资料那项逐项标原因与怎么补
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_one_missing_profile_does_not_block_the_others() -> None:
    db, engine = await build_session()
    try:
        async with db:
            await _seed(db)
            categories = [PromptCategory.costume_image_front, PromptCategory.character_image_front]
            caller, prompts = make_recording_stub_caller(_slots_payload(categories))
            preview = await preview_image_prompts(
                db,
                body=ImagePromptPreviewRequest(
                    project_id=PROJECT_ID,
                    chapter_id=CHAPTER_ID,
                    entity_profiles=[
                        # 无资料的那一项（本章资料为空）
                        EntityProfileInput(name="苏晚棠素服", entity_type="costume", profile=""),
                        # 有资料的这一项
                        EntityProfileInput(name="苏晚棠", entity_type="character", profile=CHARACTER_PROFILE),
                    ],
                    categories=categories,
                ),
                llm_caller=caller,
            )
    finally:
        await engine.dispose()

    # 没有整批拒绝：两项都产出了结果
    by_category = {str(slot.category.value): slot for slot in preview.slots}
    assert set(by_category) == {"costume_image_front", "character_image_front"}
    # 有资料的照常可用
    assert by_category["character_image_front"].savable is True
    # 无资料的**只标在它自己那一条**上：不可保存 + 结构化原因（前端据此给出"怎么补"）
    missing = by_category["costume_image_front"]
    assert missing.savable is False
    assert missing.quality_issues[0]["code"] == "vague_filler"
    # 原因逐项写清：为什么不可用 + 怎么补，而且只提这一项
    note = next(item for item in preview.warnings if "苏晚棠素服" in item)
    assert "没有可用于出图的资料" in note
    assert "怎么补" in note
    assert "苏晚棠（角色）" not in note
    # 这一段原因里**只**该出现这一项：其它三件没被要求的服装一个字都不提
    joined_warnings = " ".join(preview.warnings)
    assert all(name not in joined_warnings for name in EMPTY_COSTUMES[1:])
    # 这一次请求真的照着生成了（隔离不等于跳过）
    assert preview.meta.llm_called is True


# ---------------------------------------------------------------------------
# ③ 整体不可用（本次要的每一项都没资料）→ 拒绝，并说清"你选的这几项都没有资料"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_all_missing_profiles_are_refused_with_their_own_names_and_no_paid_call() -> None:
    db, engine = await build_session()
    prompts: list[str] = []
    try:
        async with db:
            await _seed(db)
            caller, prompts = make_recording_stub_caller(_slots_payload([PromptCategory.costume_image_other]))
            with pytest.raises(HTTPException) as excinfo:
                await preview_image_prompts(
                    db,
                    body=ImagePromptPreviewRequest(
                        project_id=PROJECT_ID,
                        chapter_id=CHAPTER_ID,
                        entity_names=["苏晚棠素服", "叶老夫人常服"],
                        categories=[PromptCategory.costume_image_other],
                    ),
                    llm_caller=caller,
                )
    finally:
        await engine.dispose()

    assert excinfo.value.status_code == 422
    detail = excinfo.value.detail
    assert isinstance(detail, dict)
    assert detail["code"] == "asset_profile_missing"
    # 原因只说这几项（用户选的），不牵进没被要求的资产
    assert "苏晚棠素服" in detail["message"] and "叶老夫人常服" in detail["message"]
    assert "邓嬷嬷嬷嬷服" not in detail["message"] and "昭昭丧服" not in detail["message"]
    assert detail["assets"] == ["苏晚棠素服", "叶老夫人常服"]
    assert detail["fix"]
    # 拒绝发生在生成之前：一次调用都没有发出去（不花钱）
    assert prompts == []


def _body(*, name: str, category: PromptCategory) -> ImagePromptPreviewRequest:
    """面板逐项生成的请求形态：点名这一项（拿它自己的库里资料）+ 只生成它那个槽位。"""
    return ImagePromptPreviewRequest(
        project_id=PROJECT_ID,
        chapter_id=CHAPTER_ID,
        shot_text=name,
        entity_names=[name],
        categories=[category],
    )
