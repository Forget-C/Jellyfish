"""断点①回归：上一环保存的 image_prompts 必须成为生图实际使用的输入。

这是「上一环确认保存的产物，必须成为下一环实际使用的输入」的最直接一个落点：
步骤 3 确认保存的九槽位提示词，生图时不能被通用模板 / description 顶掉。
"""

from __future__ import annotations

import pytest

from app.models.studio import Character, CharacterImage, FileItem, Scene, SceneImage
from app.models.types import PromptCategory
from app.services.studio.generation.asset_image.build_base import (
    build_character_image_base_draft,
    saved_image_prompt_for,
)
from tests.llm_orchestration_fixtures import build_session

FRONT_PROMPT = "【已保存】A公司法务，深色职业套装，白底全身参考图，五官清晰"
OTHER_PROMPT = "【已保存·侧背】A公司法务，侧面与背面视角，同一造型"


async def _seed_character_with_image(db, *, is_front: bool = True):  # type: ignore[no-untyped-def]
    db.add(Character(id="char-1", project_id="proj-1", name="A公司法务",
                     description="description 兜底内容", style="真人都市"))
    db.add(FileItem(id="file-1", type="image", name="图", storage_key="a/b.png"))
    await db.flush()
    db.add(
        CharacterImage(
            id=1,
            character_id="char-1",
            file_id="file-1",
            is_primary=True,
            view_angle="FRONT" if is_front else "BACK",
            quality_level="HIGH",
        )
    )
    await db.flush()


# ---------------------------------------------------------------------------
# helper 单测
# ---------------------------------------------------------------------------


def test_saved_image_prompt_picks_first_matching_category() -> None:
    entity = Character(id="c", project_id="p", name="n", description="d", style="真人都市")
    entity.image_prompts = {  # type: ignore[assignment]
        "character_image_other": OTHER_PROMPT,
        "character_image_front": FRONT_PROMPT,
    }
    assert saved_image_prompt_for(entity, PromptCategory.character_image_front) == FRONT_PROMPT
    assert saved_image_prompt_for(entity, PromptCategory.character_image_other) == OTHER_PROMPT
    # 多候选按顺序取第一个命中
    assert (
        saved_image_prompt_for(
            entity, PromptCategory.character_image_front, PromptCategory.character_image_other
        )
        == FRONT_PROMPT
    )
    # 都没有 → 空串（回落到模板/description）
    assert saved_image_prompt_for(entity, PromptCategory.scene_image_front) == ""


def test_saved_image_prompt_is_defensive() -> None:
    entity = Character(id="c", project_id="p", name="n", description="d", style="真人都市")
    entity.image_prompts = None  # type: ignore[assignment]
    assert saved_image_prompt_for(entity, PromptCategory.character_image_front) == ""
    entity.image_prompts = {"character_image_front": "   "}  # type: ignore[assignment]
    assert saved_image_prompt_for(entity, PromptCategory.character_image_front) == ""
    entity.image_prompts = "not-a-dict"  # type: ignore[assignment]
    assert saved_image_prompt_for(entity, PromptCategory.character_image_front) == ""


# ---------------------------------------------------------------------------
# 端到端：保存 → 生图读取
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_generation_uses_saved_front_prompt() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_character_with_image(db, is_front=True)
        # 未保存时：回落 description（证明默认行为没被破坏）
        before = await build_character_image_base_draft(db, character_id="char-1", image_id=1)
        assert before.prompt != FRONT_PROMPT
        assert "description 兜底内容" in before.prompt

        # 保存后：生图必须读到它
        char = await db.get(Character, "char-1")
        char.image_prompts = {"character_image_front": FRONT_PROMPT}  # type: ignore[assignment]
        await db.flush()

        after = await build_character_image_base_draft(db, character_id="char-1", image_id=1)
        assert after.prompt.strip() == FRONT_PROMPT.strip()

        # 非正面视角应取 other 槽位
        char.image_prompts = {  # type: ignore[assignment]
            "character_image_front": FRONT_PROMPT,
            "character_image_other": OTHER_PROMPT,
        }
        await db.flush()
    await engine.dispose()


@pytest.mark.asyncio
async def test_generation_uses_saved_other_prompt_for_non_front_view() -> None:
    db, engine = await build_session()
    async with db:
        await _seed_character_with_image(db, is_front=False)
        char = await db.get(Character, "char-1")
        char.image_prompts = {  # type: ignore[assignment]
            "character_image_front": FRONT_PROMPT,
            "character_image_other": OTHER_PROMPT,
        }
        await db.flush()
        base = await build_character_image_base_draft(db, character_id="char-1", image_id=1)
    assert base.prompt.strip() == OTHER_PROMPT.strip()
    await engine.dispose()


@pytest.mark.asyncio
async def test_scene_generation_uses_saved_prompt() -> None:
    """scene/prop/costume 走另一条构建分支，同样要读到已保存提示词。"""
    from app.services.studio.generation.asset_image.build_base import build_asset_image_base_draft

    SAVED = "【已保存】会议室正面广角，无人，冷色调，青石板地面"

    db, engine = await build_session()
    async with db:
        db.add(Scene(id="scene-1", name="会议室", description="兜底描述内容", style="真人都市"))
        db.add(FileItem(id="file-2", type="image", name="图", storage_key="c/d.png"))
        await db.flush()
        db.add(
            SceneImage(
                id=1,
                scene_id="scene-1",
                file_id="file-2",
                is_primary=True,
                view_angle="FRONT",
                quality_level="HIGH",
            )
        )
        await db.flush()

        # 未保存 → 回落 description
        before = await build_asset_image_base_draft(
            db, asset_type="scene", asset_id="scene-1", image_id=1
        )
        assert SAVED not in before.prompt

        # 保存 → 生图必须读到
        scene = await db.get(Scene, "scene-1")
        scene.image_prompts = {"scene_image_front": SAVED}  # type: ignore[assignment]
        await db.flush()

        after = await build_asset_image_base_draft(
            db, asset_type="scene", asset_id="scene-1", image_id=1
        )
        assert after.prompt.strip() == SAVED.strip()
    await engine.dispose()


# ---------------------------------------------------------------------------
# 断点①回归（实点验收发现）：出图**管线**（plan/submit）此前根本不读已保存提示词
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_image_pipeline_build_targets_reads_saved_prompt() -> None:
    """``image_pipeline.build_targets`` 是 P3 计划/提交的实际入口。

    实点验收时发现：legacy ``build_base`` 那条路读 ``image_prompts``，但本管线
    用 ``build_deterministic_prompt`` 覆盖成了模板文本 —— 用户「保存了提示词，
    生图却用模板」，断点①在管线上是断的。这里锁住修复。
    """
    from app.services.studio.image_pipeline.image_pipeline import (
        PROMPT_SOURCE_REQUEST,
        PROMPT_SOURCE_SAVED,
        PROMPT_SOURCE_TEMPLATE,
        build_targets,
    )

    db, engine = await build_session()
    async with db:
        db.add(
            Character(
                id="char-pipe",
                project_id="proj-pipe",
                name="A公司法务",
                description="description 兜底内容",
                style="真人都市",
            )
        )
        await db.flush()

        # 1) 什么都没保存 → 模板来源
        targets, _ = await build_targets(
            db, project_id="proj-pipe", asset_type="character", stage="character_sheet",
            asset_ids=["char-pipe"],
        )
        assert targets[0].prompt_source == PROMPT_SOURCE_TEMPLATE
        assert "description 兜底内容" in targets[0].prompt

        # 2) 保存后 → 计划必须读到它，并显式标来源为 saved
        char = await db.get(Character, "char-pipe")
        char.image_prompts = {"character_image_front": FRONT_PROMPT}  # type: ignore[assignment]
        await db.flush()
        targets, _ = await build_targets(
            db, project_id="proj-pipe", asset_type="character", stage="character_sheet",
            asset_ids=["char-pipe"],
        )
        assert targets[0].prompt.strip() == FRONT_PROMPT.strip()
        assert targets[0].prompt_source == PROMPT_SOURCE_SAVED
        assert targets[0].to_read().prompt_source == PROMPT_SOURCE_SAVED

        # 3) 调用方显式传的提示词优先级最高
        targets, _ = await build_targets(
            db, project_id="proj-pipe", asset_type="character", stage="character_sheet",
            asset_ids=["char-pipe"], prompt_overrides={"char-pipe": "显式覆盖文本"},
        )
        assert targets[0].prompt == "显式覆盖文本"
        assert targets[0].prompt_source == PROMPT_SOURCE_REQUEST

        # 4) 幂等键 = 「资产 + 提示词摘要」：保存提示词后必须换一个键，
        #    否则出图服务会认为「同一个任务已存在」而不再重出，保存等于白保存。
        saved_targets, _ = await build_targets(
            db, project_id="proj-pipe", asset_type="character", stage="character_sheet",
            asset_ids=["char-pipe"],
        )
        char.image_prompts = {}  # type: ignore[assignment]
        await db.flush()
        template_targets, _ = await build_targets(
            db, project_id="proj-pipe", asset_type="character", stage="character_sheet",
            asset_ids=["char-pipe"],
        )
        assert saved_targets[0].source_task_id != template_targets[0].source_task_id
    await engine.dispose()
