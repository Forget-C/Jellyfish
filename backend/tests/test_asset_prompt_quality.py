"""资产图片提示词的质量拦截与覆盖保护（后端必须拦，不能只靠前端）。

覆盖用户口径 ③④ 的判定与 409/422 形状：

- 含「外观信息不足 / 需人工补充」这类空话 → **422**；
- 空提示词 → **422**；
- 只有资产名 + 通用摄影词（没有该资产的结构化特征）→ **422**；
- 两个**不同**资产生成逐字相同或高度重复的内容 → **409**；
- 已有提示词槽位默认**不被覆盖**，要覆盖必须显式确认 → **409**；
- 同一资产的正面/侧面（本来就该一致）**不算**重复。
"""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app.models.studio import Character, Chapter, Project, ProjectPropLink, Prop, Scene, Shot
from app.services.studio.asset_prompt_batch import save_asset_image_prompts
from app.services.studio.asset_prompt_quality import (
    IMAGE_PROMPT_CONFIRM_FIELD,
    check_cross_asset_duplicates,
    check_prompt_map,
    check_single_prompt,
    ensure_image_prompts_not_silently_replaced,
    normalize_for_compare,
    strip_generic_words,
)
from tests.llm_orchestration_fixtures import build_session

GOOD_PROMPT = (
    "姜岁欢（角色）：身份：将军府庶女；外貌：鹅蛋脸杏眼，肤色白皙；"
    "发型：乌黑长直发束双环髻；服装配饰：素白交领襦裙，腰间垂羊脂玉佩，"
    "正面全身参考图，clean white background，photorealistic"
)
OTHER_GOOD_PROMPT = (
    "秦老夫人（角色）：身份：将军府当家主母；外貌：鬓发花白，面容清瘦严峻；"
    "发型：圆髻插银簪；服装配饰：凤纹织金褙子，正面全身参考图，photorealistic"
)


async def _seed(db) -> None:
    db.add(Project(id="proj-1", name="测试项目", description="", style="真人古装", visual_style="现实"))
    await db.flush()
    db.add(Chapter(id="chap-1", project_id="proj-1", index=1, title="第一集", raw_text="x", condensed_text="x"))
    await db.flush()
    db.add(Shot(id="shot-1", chapter_id="chap-1", index=1, title="t", script_excerpt="x"))
    await db.flush()


# ---------------------------------------------------------------------------
# 单条判定
# ---------------------------------------------------------------------------


def test_empty_prompt_is_rejected_with_422_shape() -> None:
    issues = check_single_prompt("   ", asset_name="姜岁欢", asset_type="character", slot="character_image_front")
    assert [issue.code for issue in issues] == ["empty_prompt"]
    assert issues[0].status_code == 422
    payload = issues[0].to_read()
    assert set(payload) >= {"code", "message", "status_code", "fix"}
    assert "空" in payload["message"]


@pytest.mark.parametrize("filler", ["外观信息不足", "需人工补充", "信息不详", "未知", "待补充"])
def test_vague_filler_is_rejected_with_422_shape(filler: str) -> None:
    text = f"姜岁欢（角色）：{filler}，中景平视，柔和主光，高清"
    issues = check_single_prompt(text, asset_name="姜岁欢", asset_type="character", slot="character_image_front")
    assert [issue.code for issue in issues] == ["vague_filler"]
    payload = issues[0].to_read()
    assert payload["status_code"] == 422
    assert payload["matched"] == filler
    assert "补齐" in payload["fix"]  # 可照做修


def test_name_plus_generic_photography_words_is_rejected() -> None:
    # 去掉资产名与所有通用摄影词后**一个字都不剩**：这正是"只有资产名 + 通用摄影词"
    text = "姜岁欢，正面全身参考图，白色背景，干净背景，中景平视，柔和主光，高清，写实，电影感"
    issues = check_single_prompt(text, asset_name="姜岁欢", asset_type="character", slot="character_image_front")
    assert [issue.code for issue in issues] == ["name_only_generic"]
    payload = issues[0].to_read()
    assert payload["status_code"] == 422
    assert payload["detail"]["specific_residue_chars"] == 0
    assert payload["detail"]["specific_residue_chars"] < payload["detail"]["min_specific_chars"]
    assert "外貌" in payload["detail"]["expected_visual_fields"]


def test_prompt_with_real_features_passes() -> None:
    assert check_single_prompt(GOOD_PROMPT, asset_name="姜岁欢", asset_type="character") == []


def test_strip_generic_words_keeps_asset_specific_residue() -> None:
    residue = strip_generic_words("姜岁欢，正面全身，白色背景，鹅蛋脸杏眼", given_names=["姜岁欢"])
    assert "鹅蛋脸杏眼" in residue
    assert "背景" not in residue


def test_prompt_map_reports_every_bad_slot() -> None:
    issues = check_prompt_map(
        {"character_image_front": "", "character_image_other": "姜岁欢，参考图，高清"},
        asset_name="姜岁欢",
        asset_type="character",
    )
    assert sorted(issue.code for issue in issues) == ["empty_prompt", "name_only_generic"]


# ---------------------------------------------------------------------------
# 跨资产查重（409）
# ---------------------------------------------------------------------------


def test_identical_text_across_two_assets_is_conflict_409() -> None:
    issues = check_cross_asset_duplicates(
        [
            ("character:char-1", "姜岁欢（character_image_front）", GOOD_PROMPT),
            ("character:char-2", "秦老夫人（character_image_front）", GOOD_PROMPT),
        ]
    )
    assert [issue.code for issue in issues] == ["duplicate_prompt_text"]
    payload = issues[0].to_read()
    assert payload["status_code"] == 409
    assert "姜岁欢" in payload["message"] and "秦老夫人" in payload["message"]


def test_near_duplicate_text_across_two_assets_is_conflict_409() -> None:
    long_suffix = "，正面全身参考图，clean white background，photorealistic，cinematic lighting"
    issues = check_cross_asset_duplicates(
        [
            ("character:char-1", "姜岁欢（front）", "十六岁少女素白襦裙腰间垂羊脂玉佩" + long_suffix),
            ("character:char-2", "秦老夫人（front）", "十六岁少女素白襦裙腰间垂羊脂玉佩" + long_suffix.replace("white", "neutral")),
        ]
    )
    assert [issue.code for issue in issues] == ["near_duplicate_prompt_text"]
    assert issues[0].status_code == 409


def test_same_asset_two_slots_are_not_flagged_as_duplicate() -> None:
    """同一资产的正面/侧面本来就该一致，不算"两个资产拿到同一段"。"""
    issues = check_cross_asset_duplicates(
        [
            ("character:char-1", "姜岁欢（front）", GOOD_PROMPT),
            ("character:char-1", "姜岁欢（side）", GOOD_PROMPT),
        ]
    )
    assert issues == []


def test_distinct_prompts_are_not_flagged() -> None:
    assert check_cross_asset_duplicates(
        [
            ("character:char-1", "姜岁欢", GOOD_PROMPT),
            ("character:char-2", "秦老夫人", OTHER_GOOD_PROMPT),
        ]
    ) == []


def test_normalize_for_compare_ignores_punctuation_and_case() -> None:
    assert normalize_for_compare("A,B。C") == normalize_for_compare("a，b；c")


# ---------------------------------------------------------------------------
# 不许自动覆盖
# ---------------------------------------------------------------------------


def test_existing_prompt_is_not_silently_replaced() -> None:
    with pytest.raises(HTTPException) as exc_info:
        ensure_image_prompts_not_silently_replaced(
            {"character_image_front": "人工写的旧提示词"},
            {"character_image_front": "新的提示词"},
            raw_body={},
            asset_name="姜岁欢",
        )
    assert exc_info.value.status_code == 409
    detail = exc_info.value.detail
    assert detail["code"] == "image_prompt_replace_required"
    assert detail["confirm_field"] == IMAGE_PROMPT_CONFIRM_FIELD
    assert detail["conflicts"][0]["field"] == "character_image_front"
    assert "确认" in detail["fix"]


def test_existing_prompt_can_be_replaced_with_explicit_confirmation() -> None:
    ensure_image_prompts_not_silently_replaced(
        {"character_image_front": "人工写的旧提示词"},
        {"character_image_front": "新的提示词"},
        raw_body={IMAGE_PROMPT_CONFIRM_FIELD: True},
        asset_name="姜岁欢",
    )
    # 字符串写法也认（前端拼串时不至于静默失效）
    ensure_image_prompts_not_silently_replaced(
        {"character_image_front": "旧"},
        {"character_image_front": "新"},
        raw_body={IMAGE_PROMPT_CONFIRM_FIELD: "1"},
        asset_name="姜岁欢",
    )


def test_adding_a_new_slot_does_not_count_as_replacement() -> None:
    ensure_image_prompts_not_silently_replaced(
        {"character_image_front": "旧的"},
        {"character_image_other": "新增的侧面提示词"},
        raw_body={},
        asset_name="姜岁欢",
    )


# ---------------------------------------------------------------------------
# 批量保存：全有或全无
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_batch_save_accepts_good_prompts_and_merges_slots() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(
            Character(
                id="char-1",
                project_id="proj-1",
                name="姜岁欢",
                description="",
                style="真人古装",
                visual_style="现实",
                image_prompts={"character_image_other": "已有的侧面提示词，双环髻素白襦裙"},
            )
        )
        await db.flush()
        result = await save_asset_image_prompts(
            db,
            project_id="proj-1",
            items=[
                {
                    "asset_type": "character",
                    "asset_id": "char-1",
                    "image_prompts": {"character_image_front": GOOD_PROMPT},
                }
            ],
        )
        assert result["summary"]["slot_saved"] == 1
        row = await db.get(Character, "char-1")
        # 只动提交过的槽位：已有的侧面提示词原样保留
        assert row.image_prompts["character_image_other"] == "已有的侧面提示词，双环髻素白襦裙"
        assert row.image_prompts["character_image_front"] == GOOD_PROMPT
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_save_rejects_vague_filler_with_422_and_writes_nothing() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(Character(id="char-1", project_id="proj-1", name="姜岁欢", description="", style="真人古装", visual_style="现实"))
        db.add(Prop(id="prop-1", name="乌木拐杖", description="", style="真人古装", visual_style="现实"))
        await db.flush()
        db.add(ProjectPropLink(project_id="proj-1", prop_id="prop-1", chapter_id="chap-1"))
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await save_asset_image_prompts(
                db,
                project_id="proj-1",
                items=[
                    {
                        "asset_type": "character",
                        "asset_id": "char-1",
                        "image_prompts": {"character_image_front": GOOD_PROMPT},
                    },
                    {
                        "asset_type": "prop",
                        "asset_id": "prop-1",
                        "image_prompts": {"prop_image_front": "乌木拐杖（道具）：外观信息不足，需人工补充，道具正面展示"},
                    },
                ],
            )
        assert exc_info.value.status_code == 422
        assert exc_info.value.detail["code"] == "vague_filler"
        # 全有或全无：第一个资产虽然内容合规，也必须一个槽位都没写
        row = await db.get(Character, "char-1")
        assert dict(row.image_prompts or {}) == {}
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_save_rejects_cross_asset_duplicates_with_409() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(Character(id="char-1", project_id="proj-1", name="姜岁欢", description="", style="真人古装", visual_style="现实"))
        db.add(Character(id="char-2", project_id="proj-1", name="秦老夫人", description="", style="真人古装", visual_style="现实"))
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await save_asset_image_prompts(
                db,
                project_id="proj-1",
                items=[
                    {
                        "asset_type": "character",
                        "asset_id": "char-1",
                        "image_prompts": {"character_image_front": GOOD_PROMPT},
                    },
                    {
                        "asset_type": "character",
                        "asset_id": "char-2",
                        "image_prompts": {"character_image_front": GOOD_PROMPT},
                    },
                ],
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "duplicate_prompt_text"
        assert "姜岁欢" in exc_info.value.detail["message"]
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_save_refuses_asset_outside_project() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(Scene(id="scene-1", name="别家正堂", description="", style="真人古装"))
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await save_asset_image_prompts(
                db,
                project_id="proj-1",
                items=[
                    {
                        "asset_type": "scene",
                        "asset_id": "scene-1",
                        "image_prompts": {"scene_image_front": "别家正堂，高梁方厅，青砖地面，冷白日光"},
                    }
                ],
            )
        assert exc_info.value.status_code == 400
        assert "尚未关联到项目" in str(exc_info.value.detail)
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_save_requires_explicit_confirmation_to_overwrite() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        db.add(
            Character(
                id="char-1",
                project_id="proj-1",
                name="姜岁欢",
                description="",
                style="真人古装",
                visual_style="现实",
                image_prompts={"character_image_front": "人工写好的提示词，十六岁少女素白襦裙腰间玉佩"},
            )
        )
        await db.flush()
        with pytest.raises(HTTPException) as exc_info:
            await save_asset_image_prompts(
                db,
                project_id="proj-1",
                items=[
                    {
                        "asset_type": "character",
                        "asset_id": "char-1",
                        "image_prompts": {"character_image_front": GOOD_PROMPT},
                    }
                ],
            )
        assert exc_info.value.status_code == 409
        assert exc_info.value.detail["code"] == "image_prompt_replace_required"

        ok = await save_asset_image_prompts(
            db,
            project_id="proj-1",
            items=[
                {
                    "asset_type": "character",
                    "asset_id": "char-1",
                    "image_prompts": {"character_image_front": GOOD_PROMPT},
                }
            ],
            raw_body={IMAGE_PROMPT_CONFIRM_FIELD: True},
        )
        assert ok["summary"]["asset_changed"] == 1
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_save_rejects_unsupported_asset_type() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        with pytest.raises(HTTPException) as exc_info:
            await save_asset_image_prompts(
                db,
                project_id="proj-1",
                items=[{"asset_type": "actor", "asset_id": "actor-1", "image_prompts": {"x": "y"}}],
            )
        assert exc_info.value.status_code == 422
        assert "actor" in str(exc_info.value.detail)
    await engine.dispose()


@pytest.mark.asyncio
async def test_batch_save_rejects_empty_items() -> None:
    db, engine = await build_session()
    async with db:
        await _seed(db)
        with pytest.raises(HTTPException) as exc_info:
            await save_asset_image_prompts(db, project_id="proj-1", items=[])
        assert exc_info.value.status_code == 400
    await engine.dispose()
