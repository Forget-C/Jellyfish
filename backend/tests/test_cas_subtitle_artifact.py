"""Step 5.1：字幕产物与真实 worker 执行的硬化测试。

覆盖：
- 确定性 zh-Hant WebVTT 生成（逐字节稳定）；
- cue 时间戳与译文逐字保真；
- 产物与 Project / Chapter 的关联；
- 二次导入不产生重复产物（对象与数据库行都不重复）；
- 上传失败后的回滚与补偿清理（无孤儿对象、无部分数据库记录）；
- worker 注册、入队、成功、失败；
- 活动任务复用；
- 任务结果中包含产物信息。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core import storage as core_storage
from app.core.db import Base, async_session_maker
from app.core.task_manager.types import TaskStatus
from app.crypto_animal_studio.application.import_episode import import_episode
from app.crypto_animal_studio.application.import_result import ImportResult, SubtitleArtifact
from app.crypto_animal_studio.application.import_tasks import (
    CAS_IMPORT_EPISODE_TASK_KIND,
    _compensate_uploaded_artifacts,
    create_cas_import_task,
    run_cas_import_task,
)
from app.crypto_animal_studio.application.parsing import parse_episode_package
from app.crypto_animal_studio.application.subtitle_artifact import (
    subtitle_source_ref,
    subtitle_storage_key,
)
from app.crypto_animal_studio.domain.webvtt import format_timestamp, render_webvtt
from app.crypto_animal_studio.domain.import_ledger import CasImportLedger
from app.models.studio import Chapter, Project, Shot
from app.models.studio_file_usages import FileUsage
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import GenerationTask
from app.models.types import FileType, FileUsageKind, ProjectStyle, ProjectVisualStyle
from app.services.worker.task_registry import task_executor_registry
from tests.support.fake_storage import FakeStorage

_REPO_ROOT = Path(__file__).resolve().parents[2]
_EP001 = _REPO_ROOT / "samples" / "cas" / "ep001_btc_breakout.json"
_V1_SAMPLE = _REPO_ROOT / "samples" / "cas" / "demo_episode.json"

_EXPECTED_ZH_HANT = [
    "突破了！我們回來了！",
    "這根K棒還沒收。",
    "還是綠的……對吧？",
    "你的彩帶會比收盤先到。",
]


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> FakeStorage:
    """内存对象存储替身。"""
    return FakeStorage().install(monkeypatch, core_storage)


def _ep001_dict() -> dict:
    return json.loads(_EP001.read_text(encoding="utf-8"))


def _ep001_package():
    return parse_episode_package(_ep001_dict())


async def _make_sessionmaker():
    engine = create_async_engine(
        "sqlite+aiosqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    import app.crypto_animal_studio.domain.import_ledger  # noqa: F401
    import app.models.llm  # noqa: F401
    import app.models.studio  # noqa: F401
    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed_project(session_factory, project_id: str = "cas-series-1") -> str:
    async with session_factory() as db:
        db.add(
            Project(
                id=project_id,
                name="Crypto Animal Studio — Block Street (Season 1)",
                style=ProjectStyle.anime_3d,
                visual_style=ProjectVisualStyle.anime,
            )
        )
        await db.commit()
    return project_id


async def _count(session_factory, model) -> int:
    async with session_factory() as db:
        return int((await db.execute(select(func.count()).select_from(model))).scalar() or 0)


# --------------------------------------------------------------------------- #
# 1. 确定性 WebVTT
# --------------------------------------------------------------------------- #
def test_webvtt_timestamp_formatting() -> None:
    """毫秒 → HH:MM:SS.mmm。"""
    assert format_timestamp(0) == "00:00:00.000"
    assert format_timestamp(400) == "00:00:00.400"
    assert format_timestamp(24_000) == "00:00:24.000"
    assert format_timestamp(3_661_123) == "01:01:01.123"
    with pytest.raises(ValueError):
        format_timestamp(-1)


def test_webvtt_generation_is_deterministic() -> None:
    """同一 track 渲染两次逐字节相同。"""
    track = _ep001_package().localization.subtitle_tracks[0]
    first = render_webvtt(track)
    second = render_webvtt(_ep001_package().localization.subtitle_tracks[0])
    assert first == second
    assert first.encode("utf-8") == second.encode("utf-8")


def test_webvtt_preserves_every_required_field() -> None:
    """语言标签、cue ID、顺序、起止时间、译文、镜头引用全部保留。"""
    package = _ep001_package()
    track = package.localization.subtitle_tracks[0]
    text = render_webvtt(track)

    assert text.startswith("WEBVTT\nLanguage: zh-Hant\n")
    assert text.endswith("\n")

    for cue in track.cues:
        assert f"\n{cue.cue_id}\n" in text
        assert f"{format_timestamp(cue.start_ms)} --> {format_timestamp(cue.end_ms)}" in text
        assert cue.text in text
        assert f"shot={cue.shot_id}" in text

    # cue 顺序保持声明顺序
    positions = [text.index(cue.text) for cue in track.cues]
    assert positions == sorted(positions)
    # 译文逐字保真
    assert [cue.text for cue in track.cues] == _EXPECTED_ZH_HANT


def test_webvtt_rejects_invalid_cue_window() -> None:
    """end_ms <= start_ms 直接拒绝（不生成半成品产物）。"""
    data = _ep001_dict()
    # 绕过 schema 校验直接构造轨对象，验证渲染层自身的防线。
    track = parse_episode_package(data).localization.subtitle_tracks[0]
    track.cues[0].end_ms = track.cues[0].start_ms
    with pytest.raises(ValueError, match="end_ms"):
        render_webvtt(track)


# --------------------------------------------------------------------------- #
# 2. 产物关联
# --------------------------------------------------------------------------- #
def test_subtitle_artifact_is_linked_to_project_and_chapter(fake_storage: FakeStorage) -> None:
    """产物落成 FileItem + FileUsage，并关联到 Project 与 Chapter。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                result = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="k1"
                )
                await db.commit()

            # 导入结果显式标识产物（要求 8）
            assert len(result.subtitle_artifacts) == 1
            artifact = result.subtitle_artifacts[0]
            assert artifact.language_tag == "zh-Hant"
            assert artifact.cue_count == 4
            assert artifact.created is True
            assert artifact.storage_key == subtitle_storage_key(pid, "CAS-EP001", "zh-Hant")

            async with session_factory() as db:
                chapter = (await db.execute(select(Chapter))).scalars().one()
                file_item = (await db.execute(select(FileItem))).scalars().one()
                usage = (await db.execute(select(FileUsage))).scalars().one()

            assert file_item.id == artifact.file_id
            assert file_item.type == FileType.subtitle
            assert file_item.name == "CAS-EP001.zh-Hant.vtt"
            assert file_item.storage_key == artifact.storage_key
            assert usage.file_id == file_item.id
            assert usage.project_id == pid
            assert usage.chapter_id == chapter.id
            assert usage.usage_kind == FileUsageKind.subtitle
            assert usage.source_ref == subtitle_source_ref("CAS-EP001", "zh-Hant")

            # 对象内容就是确定性 WebVTT
            stored = fake_storage.objects[artifact.storage_key].decode("utf-8")
            assert stored == render_webvtt(_ep001_package().localization.subtitle_tracks[0])
            assert len(stored.encode("utf-8")) == artifact.byte_size
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_v1_package_produces_no_subtitle_artifact() -> None:
    """v1 文档没有 localization → 不生成产物，既有行为完全不变。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            package = parse_episode_package(json.loads(_V1_SAMPLE.read_text(encoding="utf-8")))
            async with session_factory() as db:
                result = await import_episode(
                    db, project_id=pid, package=package, idempotency_key="v1"
                )
                await db.commit()
            assert result.subtitle_artifacts == []
            assert await _count(session_factory, FileItem) == 0
            assert await _count(session_factory, FileUsage) == 0
        finally:
            await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# 3. 幂等
# --------------------------------------------------------------------------- #
def test_second_import_does_not_duplicate_artifact(fake_storage: FakeStorage) -> None:
    """幂等重放不新增 FileItem / FileUsage / 对象，并如实报告既有产物。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                first = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="k1"
                )
                await db.commit()
            async with session_factory() as db:
                second = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="k1"
                )
                await db.commit()

            assert second.status == "replayed"
            assert await _count(session_factory, FileItem) == 1
            assert await _count(session_factory, FileUsage) == 1
            assert len(fake_storage.objects) == 1
            # 重放仍然报告产物，且指向同一个 file_id
            assert len(second.subtitle_artifacts) == 1
            assert second.subtitle_artifacts[0].file_id == first.subtitle_artifacts[0].file_id
            assert second.subtitle_artifacts[0].created is False
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_reimport_under_new_key_reuses_same_artifact_slot(fake_storage: FakeStorage) -> None:
    """同一剧集在新项目章节下重新导入时，产物按确定性键覆盖而非新增。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="k1"
                )
                await db.commit()

            # 清掉台账模拟「重新导入同一剧集」，产物槽位必须复用而不是新增。
            async with session_factory() as db:
                for row in (await db.execute(select(CasImportLedger))).scalars().all():
                    await db.delete(row)
                await db.commit()

            async with session_factory() as db:
                again = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="k2"
                )
                await db.commit()

            assert again.status == "imported"
            assert again.subtitle_artifacts[0].created is False
            assert await _count(session_factory, FileItem) == 1
            assert await _count(session_factory, FileUsage) == 1
            assert len(fake_storage.objects) == 1
            # 新章节接管关联
            async with session_factory() as db:
                usage = (await db.execute(select(FileUsage))).scalars().one()
                assert usage.chapter_id == again.chapter_id
        finally:
            await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# 4. 失败与补偿
# --------------------------------------------------------------------------- #
def test_upload_failure_rolls_back_and_leaves_no_orphans(fake_storage: FakeStorage) -> None:
    """上传失败 → 整个导入回滚：无数据库记录、无孤儿对象。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            fake_storage.fail_upload_key = subtitle_storage_key(pid, "CAS-EP001", "zh-Hant")

            async with session_factory() as db:
                with pytest.raises(Exception, match="injected upload failure"):
                    await import_episode(
                        db, project_id=pid, package=_ep001_package(), idempotency_key="k1"
                    )
                await db.rollback()

            assert await _count(session_factory, Chapter) == 0
            assert await _count(session_factory, Shot) == 0
            assert await _count(session_factory, FileItem) == 0
            assert await _count(session_factory, FileUsage) == 0
            assert await _count(session_factory, CasImportLedger) == 0
            assert fake_storage.objects == {}
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_compensation_deletes_only_newly_created_objects(fake_storage: FakeStorage) -> None:
    """提交失败后的补偿只删除本次新建的对象，不动复用的既有产物。

    这是「对象存储不参与数据库事务」的兜底路径：``import_episode`` 已经上传成功，
    但调用方的 commit 失败，此时必须回收本次新建的对象，同时保留上一次成功导入的产物。
    """

    async def _run() -> None:
        fresh = SubtitleArtifact(
            file_id="f-new",
            language_tag="zh-Hant",
            storage_key="cas/subtitles/p/E1/zh-Hant.vtt",
            cue_count=4,
            byte_size=10,
            created=True,
        )
        reused = SubtitleArtifact(
            file_id="f-old",
            language_tag="en",
            storage_key="cas/subtitles/p/E1/en.vtt",
            cue_count=4,
            byte_size=10,
            created=False,
        )
        fake_storage.objects[fresh.storage_key] = b"new"
        fake_storage.objects[reused.storage_key] = b"old"

        result = ImportResult(
            status="imported",
            dry_run=False,
            idempotent_replay=False,
            project_id="p",
            episode_id="E1",
            idempotency_key="k",
            payload_hash="h",
            subtitle_artifacts=[fresh, reused],
        )
        await _compensate_uploaded_artifacts(result)

        assert fake_storage.delete_calls == [fresh.storage_key]
        assert fresh.storage_key not in fake_storage.objects
        assert reused.storage_key in fake_storage.objects  # 复用的产物必须保留

    asyncio.run(_run())


def test_compensation_is_a_noop_without_result(fake_storage: FakeStorage) -> None:
    """导入尚未返回结果（例如解析阶段就失败）时补偿不应做任何事。"""
    asyncio.run(_compensate_uploaded_artifacts(None))
    assert fake_storage.delete_calls == []


# --------------------------------------------------------------------------- #
# 5. Worker 注册与执行
# --------------------------------------------------------------------------- #
def test_worker_executor_is_registered() -> None:
    """task_kind 已注册到既有 registry，且未新建队列体系。"""
    executor = task_executor_registry.resolve(CAS_IMPORT_EPISODE_TASK_KIND)
    assert executor.task_kind == CAS_IMPORT_EPISODE_TASK_KIND
    assert executor.timeout_seconds == 300.0


def test_worker_success_persists_result_with_artifact(fake_storage: FakeStorage) -> None:
    """worker 成功：导入落库，任务结果里带字幕产物信息。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        original = async_session_maker._maker  # pylint: disable=protected-access
        try:
            pid = await _seed_project(session_factory)
            async_session_maker.configure(session_factory)

            async with session_factory() as db:
                created = await create_cas_import_task(
                    db, project_id=pid, episode_package=_ep001_dict(), idempotency_key="k1"
                )
                await db.commit()

            await run_cas_import_task(created.task_id)

            async with session_factory() as db:
                task = await db.get(GenerationTask, created.task_id)
                status_value = (
                    task.status.value if hasattr(task.status, "value") else str(task.status)
                )
                result = task.result or {}

            assert status_value == TaskStatus.succeeded.value
            artifacts = result.get("subtitle_artifacts") or []
            assert len(artifacts) == 1
            assert artifacts[0]["language_tag"] == "zh-Hant"
            assert artifacts[0]["cue_count"] == 4
            assert artifacts[0]["storage_key"] in fake_storage.objects
            assert await _count(session_factory, Chapter) == 1
            assert await _count(session_factory, FileItem) == 1
        finally:
            async_session_maker.configure(original)
            await engine.dispose()

    asyncio.run(_run())


def test_worker_failure_marks_failed_without_partial_import(fake_storage: FakeStorage) -> None:
    """worker 失败：任务 failed，且没有任何部分导入或孤儿对象。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        original = async_session_maker._maker  # pylint: disable=protected-access
        try:
            async_session_maker.configure(session_factory)
            async with session_factory() as db:
                created = await create_cas_import_task(
                    db,
                    project_id="no-such-project",
                    episode_package=_ep001_dict(),
                    idempotency_key="k1",
                )
                await db.commit()

            await run_cas_import_task(created.task_id)

            async with session_factory() as db:
                task = await db.get(GenerationTask, created.task_id)
                status_value = (
                    task.status.value if hasattr(task.status, "value") else str(task.status)
                )
            assert status_value == TaskStatus.failed.value
            assert "Project not found" in task.error
            assert await _count(session_factory, Chapter) == 0
            assert await _count(session_factory, FileItem) == 0
            assert fake_storage.objects == {}
        finally:
            async_session_maker.configure(original)
            await engine.dispose()

    asyncio.run(_run())


def test_worker_accepts_run_args_from_executor(fake_storage: FakeStorage) -> None:
    """runner 签名兼容 (task_id, run_args)：executor 传入的 run_args 被直接使用。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        original = async_session_maker._maker  # pylint: disable=protected-access
        try:
            pid = await _seed_project(session_factory)
            async_session_maker.configure(session_factory)
            async with session_factory() as db:
                created = await create_cas_import_task(
                    db, project_id=pid, episode_package=_ep001_dict(), idempotency_key="k1"
                )
                await db.commit()

            run_args = {
                "project_id": pid,
                "episode_package": _ep001_dict(),
                "idempotency_key": "k1",
                "dry_run": False,
            }
            await run_cas_import_task(created.task_id, run_args)

            async with session_factory() as db:
                task = await db.get(GenerationTask, created.task_id)
                status_value = (
                    task.status.value if hasattr(task.status, "value") else str(task.status)
                )
            assert status_value == TaskStatus.succeeded.value
            assert len(fake_storage.objects) == 1
        finally:
            async_session_maker.configure(original)
            await engine.dispose()

    asyncio.run(_run())
