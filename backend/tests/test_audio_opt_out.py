"""「本镜无需声音」的显式标记（用户授权新增的可空列 `shot_details.audio_opt_out`）。

为什么需要它：只靠 `audio_file_id IS NULL` 无法区分
（a）还没绑声音 和（b）这一镜明确不需要声音 —— 后者会被就绪判定与交付导出当成"漏绑"。
本测试锁三件事：两个字段互斥、无需声音会进交付文本、未表态时行为不变（不产生噪音）。
"""

from __future__ import annotations

import pytest

from app.models.studio import FileItem, ShotDetail
from app.models.types import FileType
from app.schemas.studio.shots import ShotDetailUpdate
from app.services.studio import shot_details as shot_details_service
from app.services.studio.bound_asset_files import render_bound_file_lines, resolve_shot_audio_file
from tests.llm_orchestration_fixtures import build_session, seed_project_chapter_shot


async def _seed_shot(db, *, audio_file_id: str | None = None, opt_out: bool = False) -> None:
    await seed_project_chapter_shot(db)
    db.add(
        ShotDetail(
            id="shot-1",
            camera_shot="中景",
            angle="平视",
            movement="固定",
            audio_file_id=audio_file_id,
            audio_opt_out=opt_out,
        )
    )
    await db.flush()


@pytest.mark.asyncio
async def test_opt_out_marks_audio_slot_as_decided_but_unusable():
    db, engine = await build_session()
    try:
        await _seed_shot(db, opt_out=True)
        audio = await resolve_shot_audio_file(db, shot_id="shot-1")
        lines = render_bound_file_lines([audio] if audio else [])
    finally:
        await engine.dispose()

    assert audio is not None
    assert audio.resolved_from == "audio_opt_out"
    assert audio.usable is False
    assert lines == ["声音：本镜明确标记：无需声音"]


@pytest.mark.asyncio
async def test_no_audio_and_no_flag_keeps_old_behaviour():
    db, engine = await build_session()
    try:
        await _seed_shot(db)
        audio = await resolve_shot_audio_file(db, shot_id="shot-1")
    finally:
        await engine.dispose()

    assert audio is None  # 未表态：不产生噪音（与改动前一致）


@pytest.mark.asyncio
async def test_patch_opt_out_clears_audio_file_id():
    db, engine = await build_session()
    try:
        db.add(FileItem(id="f-audio", name="配音.mp3", storage_key="audio/a.mp3", type=FileType.audio))
        await db.flush()
        await _seed_shot(db, audio_file_id="f-audio")

        updated = await shot_details_service.update(
            db,
            shot_id="shot-1",
            body=ShotDetailUpdate(audio_opt_out=True),
        )

        assert updated.audio_opt_out is True
        assert updated.audio_file_id is None
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_patch_audio_file_id_clears_opt_out():
    db, engine = await build_session()
    try:
        db.add(FileItem(id="f-audio", name="配音.mp3", storage_key="audio/a.mp3", type=FileType.audio))
        await db.flush()
        await _seed_shot(db, opt_out=True)

        updated = await shot_details_service.update(
            db,
            shot_id="shot-1",
            body=ShotDetailUpdate(audio_file_id="f-audio"),
        )

        assert updated.audio_file_id == "f-audio"
        assert updated.audio_opt_out is False
    finally:
        await engine.dispose()


@pytest.mark.asyncio
async def test_preparation_link_marks_matching_candidate_linked():
    """准备页的「关联」必须把提取候选回写为 linked。

    回归点：`link_existing_asset_for_preparation` 以前只建业务关联、不回写候选状态，
    界面因"已关联"过滤不再显示按钮，而库里候选仍是 pending ——
    按口径"只要还有任意一条候选 pending，镜头就不能 ready"，镜头永久卡住且无处可点。
    """
    from app.models.studio import Character, ShotCandidateStatus, ShotExtractedCandidate
    from app.services.studio.shot_preparation_state import link_existing_asset_for_preparation

    db, engine = await build_session()
    try:
        await seed_project_chapter_shot(db)
        db.add(
            ShotDetail(id="shot-1", camera_shot="中景", angle="平视", movement="固定")
        )
        db.add(Character(id="CHAR_A", project_id="proj-1", name="林小满", style="真人都市"))
        db.add(
            ShotExtractedCandidate(
                id=1,
                shot_id="shot-1",
                candidate_type="character",
                candidate_name="林小满",
                candidate_status=ShotCandidateStatus.pending,
            )
        )
        await db.flush()

        await link_existing_asset_for_preparation(
            db,
            project_id="proj-1",
            chapter_id="chap-1",
            shot_id="shot-1",
            entity_type="character",
            linked_entity_id="CHAR_A",
        )

        candidate = await db.get(ShotExtractedCandidate, 1)
    finally:
        await engine.dispose()

    assert candidate is not None
    assert candidate.candidate_status == ShotCandidateStatus.linked
    assert candidate.linked_entity_id == "CHAR_A"
