"""B2b：镜头**没自己表态**时，从绑定的资产自动带出声音（需求清单第 6 条）。

用户口径
========

声音改为**直接绑在资产上**；镜头只要绑定了带声音的资产，视频生成就自动带出它的声音。
优先级：**镜头绑定 → 资产声音**（镜头自己的选择永远优先，不会被资产覆盖）。

评审附带条件②：**兜底规则不许猜**。所以这里刻意有三态：

============  ==============================================  ==================
状态           条件                                            行为
============  ==============================================  ==================
``none``      绑定的资产里没有一个带声音                       不带、不产生噪音
``single``    **恰好一个**带声音的资产                         带出它的声音，并说明来源
``ambiguous`` **多个**带声音的资产                              **不替用户选**，留空 + 明示候选
============  ==============================================  ==================

「多人物镜头随便挑一个声音，比没有声音更糟糕」—— 这是这条规则的由来。

全部零出网、零付费：本文件只跑内存库与服务层，不调任何供应商。
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest

from app.services.studio.video_audio_input import (
    resolve_asset_voice_for_shot,
    resolve_audio_admission,
)
from tests.llm_orchestration_fixtures import build_session

PROJECT_ID = "proj-carry"
CHAPTER_ID = "chap-carry"
SHOT_ID = "shot-carry"
SHOT_NO_VOICE = "shot-carry-2"

PUBLIC_AUDIO = "https://cdn.example.test/voice-a.mp3"
PUBLIC_AUDIO_2 = "https://cdn.example.test/voice-b.mp3"
AUDIO_A = "file-voice-a"
AUDIO_B = "file-voice-b"
AUDIO_SHOT = "file-voice-shot"

PROVIDER = "apimart"


async def _seed(db: Any, *, characters: list[tuple[str, str, str | None]] | None = None) -> None:
    """项目 + 章节 + 两个镜头 + 角色（可选各自绑资产声音）。

    ``characters`` 是 ``[(character_id, name, voice_storage_key|None)]``。
    """
    from app.models.studio import (
        Chapter,
        Character,
        FileItem,
        Project,
        Shot,
        ShotCharacterLink,
        ShotDetail,
    )
    from app.models.types import FileType

    db.add(Project(id=PROJECT_ID, name="带声音测试", description="", style="真人古装", visual_style="现实"))
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
    await db.flush()
    db.add(Shot(id=SHOT_ID, chapter_id=CHAPTER_ID, index=1, title="端茶", script_excerpt="丫鬟甲端茶进来。"))
    db.add(Shot(id=SHOT_NO_VOICE, chapter_id=CHAPTER_ID, index=2, title="空镜", script_excerpt="庭院空无一人。"))
    # ShotDetail 行存在但两个字段都空 = "镜头没有表态"（这正是要兜底的情形）
    db.add(
        ShotDetail(
            id=SHOT_ID,
            camera_shot="中景",
            angle="平视",
            movement="固定",
            description="",
        )
    )
    await db.flush()

    for index, (character_id, name, voice_key) in enumerate(characters or [], start=1):
        db.add(
            Character(
                id=character_id,
                project_id=PROJECT_ID,
                name=name,
                description="丫鬟装束",
                style="真人古装",
                visual_style="现实",
            )
        )
        await db.flush()
        db.add(ShotCharacterLink(shot_id=SHOT_ID, character_id=character_id, index=index))
        if voice_key:
            file_id = AUDIO_A if index == 1 else AUDIO_B
            db.add(
                FileItem(
                    id=file_id,
                    type=FileType.audio,
                    name=f"{name}的配音.mp3",
                    storage_key=voice_key,
                )
            )
            await db.flush()
            from app.services.studio.asset_voices import bind_asset_voice

            await bind_asset_voice(db, asset_type="character", asset_id=character_id, file_id=file_id)
    await db.flush()


async def _carry(db: Any) -> Any:
    return await resolve_asset_voice_for_shot(db, shot_id=SHOT_ID)


@pytest.mark.asyncio
async def test_single_voiced_asset_is_carried() -> None:
    """恰好一个带声音的资产 → 带出它的声音，并说明"这是从资产带出来的"。"""
    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO)])
        carry = await _carry(db)
    finally:
        await engine.dispose()

    assert carry.state == "single"
    assert carry.file_id == AUDIO_A
    assert carry.url == PUBLIC_AUDIO
    assert "丫鬟甲" in carry.asset_label
    assert "自动带出" in carry.note
    assert carry.candidates == ()


@pytest.mark.asyncio
async def test_two_voiced_assets_are_not_guessed() -> None:
    """**附带条件②**：两个带声音的资产 → 一个都不选，留空并把候选说清。"""
    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO), ("char-b", "丫鬟乙", PUBLIC_AUDIO_2)])
        carry = await _carry(db)
    finally:
        await engine.dispose()

    assert carry.state == "ambiguous"
    assert carry.file_id == "", "多个候选时必须留空，不许替用户挑一个"
    assert carry.url == ""
    assert len(carry.candidates) == 2
    assert "丫鬟甲" in carry.note and "丫鬟乙" in carry.note
    assert "不替你" in carry.note
    assert carry.note, "多个候选时必须明示，否则用户不知道声音为什么没带"


@pytest.mark.asyncio
async def test_assets_without_voice_produce_no_noise() -> None:
    """绑了资产但都没声音 → 什么都不带，也不产生噪音（与既有"未绑定"行为一致）。"""
    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", None), ("char-b", "丫鬟乙", None)])
        carry = await _carry(db)
    finally:
        await engine.dispose()

    assert carry.state == "none"
    assert carry.file_id == ""
    assert carry.note == "", "没有候选时不许制造噪音"


@pytest.mark.asyncio
async def test_no_bound_assets_at_all() -> None:
    db, engine = await build_session()
    try:
        await _seed(db, characters=[])
        carry = await _carry(db)
    finally:
        await engine.dispose()
    assert carry.state == "none"
    assert carry.note == ""


# ---------------------------------------------------------------------------
# 端到端（准入结论）：三态怎么落到 audio_urls / 提示上
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_admission_carries_the_single_asset_voice_into_the_request() -> None:
    """唯一候选时，声音真的进了准入结论（可携带），并带上来源说明。"""
    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO)])
        admission = await resolve_audio_admission(db, shot_id=SHOT_ID, provider=PROVIDER, model=None)
    finally:
        await engine.dispose()

    assert admission.file_id == AUDIO_A
    assert admission.included is True, "公网地址必须可携带"
    assert admission.url == PUBLIC_AUDIO
    assert any("自动带出" in item for item in admission.extra_warnings)


@pytest.mark.asyncio
async def test_admission_leaves_audio_empty_and_explains_when_ambiguous() -> None:
    """多个候选：请求里**没有**音频，但计划/页面拿得到"为什么"（不静默）。"""
    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO), ("char-b", "丫鬟乙", PUBLIC_AUDIO_2)])
        admission = await resolve_audio_admission(db, shot_id=SHOT_ID, provider=PROVIDER, model=None)
    finally:
        await engine.dispose()

    assert admission.file_id == ""
    assert admission.included is False
    notes = " ".join(admission.extra_warnings)
    assert "丫鬟甲" in notes and "丫鬟乙" in notes, "候选必须出现在说明里"
    assert "不替你" in notes


@pytest.mark.asyncio
async def test_shot_own_binding_wins_over_asset_voice() -> None:
    """**优先级**：镜头自己绑了声音 → 用它，资产声音一律不参与。"""
    from app.models.studio import ShotDetail

    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO)])
        detail = await db.get(ShotDetail, SHOT_ID)
        detail.audio_file_id = AUDIO_SHOT
        await db.flush()
        from app.models.studio import FileItem
        from app.models.types import FileType

        db.add(FileItem(id=AUDIO_SHOT, type=FileType.audio, name="本镜专用.mp3", storage_key="https://cdn.example.test/shot.mp3"))
        await db.flush()

        admission = await resolve_audio_admission(db, shot_id=SHOT_ID, provider=PROVIDER, model=None)
        # 镜头自己的绑定生效；资产那条"自动带出"的说明不应出现
        assert admission.file_id == AUDIO_SHOT
        assert not any("自动带出" in item for item in admission.extra_warnings)
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_shot_opt_out_beats_asset_voice() -> None:
    """镜头明确标记「无需声音」→ 资产声音**不许**把它顶回来（用户显式选择优先）。"""
    from app.models.studio import ShotDetail

    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO)])
        detail = await db.get(ShotDetail, SHOT_ID)
        detail.audio_opt_out = True
        await db.flush()
        admission = await resolve_audio_admission(db, shot_id=SHOT_ID, provider=PROVIDER, model=None)
    finally:
        await engine.dispose()

    assert admission.file_id == "", "明确无需声音时不能被资产声音顶回来"
    assert admission.included is False
    assert not any("自动带出" in item for item in admission.extra_warnings)


@pytest.mark.asyncio
async def test_carry_is_stable_across_repeated_reads() -> None:
    """同一份数据重复解析结论必须一致（顺序稳定，不靠字典遍历顺序）。"""
    db, engine = await build_session()
    try:
        await _seed(db, characters=[("char-a", "丫鬟甲", PUBLIC_AUDIO), ("char-b", "丫鬟乙", PUBLIC_AUDIO_2)])
        first = await _carry(db)
        second = await _carry(db)
    finally:
        await engine.dispose()
    assert first == second
