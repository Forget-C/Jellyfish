"""EP001 生产纵切测试：EpisodePackage v1.1 → Jellyfish 可编辑生产实体。

覆盖 Step 5 要求的全部验收点：
- 生产版 EP001 包可加载；
- schema 契约 + CAS QA 五阶段校验；
- 完整实体映射（Project/Chapter/Shot/ShotDetail/ShotDialogLine/links）；
- Character 与 Actor 的区分与关联；
- 镜头顺序与对白顺序/内容保真；
- 英文对白与 zh-Hant 字幕的保真（字幕按既定决策留在契约侧，见下方说明）；
- 二次导入幂等；
- 事务回滚（QA 失败与运行期失败都零写入）；
- 异步任务的成功与失败状态。

事件循环纪律：每个测试用一次 ``asyncio.run``，并在同一次运行内 ``engine.dispose()``，
避免 aiosqlite worker 线程绑定到已关闭的事件循环。
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.crypto_animal_studio.application.import_episode as ie
from app.core import storage as core_storage
from app.core.db import Base, async_session_maker
from app.core.task_manager.types import TaskStatus
from app.crypto_animal_studio.application.hashing import canonical_payload_hash
from app.crypto_animal_studio.application.import_episode import (
    CasValidationError,
    import_episode,
)
from app.crypto_animal_studio.application.import_tasks import (
    CAS_EPISODE_IMPORT_RELATION_TYPE,
    CAS_IMPORT_EPISODE_TASK_KIND,
    create_cas_import_task,
    episode_relation_entity_id,
    run_cas_import_task,
)
from app.crypto_animal_studio.application.parsing import parse_episode_package
from app.crypto_animal_studio.application.validation import (
    ValidationStage,
    derived_runtime_for,
    validate_episode_package,
)
from app.crypto_animal_studio.domain.import_ledger import CasImportLedger
from app.crypto_animal_studio.schemas.episode_package import EpisodePackageV11
from app.models.studio import (
    Actor,
    Chapter,
    Character,
    Project,
    Shot,
    ShotCharacterLink,
    ShotDetail,
    ShotDialogLine,
)
from app.models.studio_file_usages import FileUsage
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import GenerationTask
from app.models.task_links import GenerationTaskLink
from app.models.types import FileType, FileUsageKind, ProjectStyle, ProjectVisualStyle
from tests.support.fake_storage import FakeStorage

_REPO_ROOT = Path(__file__).resolve().parents[2]
_EP001 = _REPO_ROOT / "samples" / "cas" / "ep001_btc_breakout.json"

#: 审定文档锁定的英文对白（EP001 §6 对白表），按镜头顺序。
_EXPECTED_ENGLISH = [
    "Breakout! We are so back!",
    "The candle hasn't closed yet.",
    "It's still green… right?",
    "Your confetti arrives before candle close.",
]

#: 审定文档锁定的 zh-Hant 字幕，按 cue 顺序。
_EXPECTED_ZH_HANT = [
    "突破了！我們回來了！",
    "這根K棒還沒收。",
    "還是綠的……對吧？",
    "你的彩帶會比收盤先到。",
]


@pytest.fixture(autouse=True)
def fake_storage(monkeypatch: pytest.MonkeyPatch) -> FakeStorage:
    """所有测试都跑在内存对象存储上：字幕产物写入无需真实 S3/RustFS。"""
    return FakeStorage().install(monkeypatch, core_storage)


def _ep001_dict() -> dict:
    """读取生产版 EP001 包。"""
    return json.loads(_EP001.read_text(encoding="utf-8"))


def _ep001_package() -> EpisodePackageV11:
    """解析生产版 EP001 包。"""
    return parse_episode_package(_ep001_dict())


async def _make_sessionmaker():
    """建内存 SQLite（StaticPool 共享单连接）并建表，返回 (engine, Session)。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
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
    """建一个代表系列/季的 Project 容器（不新增 Episode 表）。"""
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
    """统计某表行数。"""
    async with session_factory() as db:
        return int((await db.execute(select(func.count()).select_from(model))).scalar() or 0)


# --------------------------------------------------------------------------- #
# 1. 包加载与契约
# --------------------------------------------------------------------------- #
def test_ep001_package_loads_as_v11() -> None:
    """生产包按 v1.1 解析，身份与规格符合审定文档。"""
    package = _ep001_package()
    assert type(package) is EpisodePackageV11
    assert package.schema_version == "1.1"
    assert package.episode_id == "CAS-EP001"
    assert package.title == "BTC Breaks Out — Bruno Celebrates Too Early"
    assert len(package.shots) == 4
    assert package.output.aspect_ratio == "9:16"
    assert package.output.orientation == "vertical"
    assert package.language == "en"
    assert package.localization.spoken_language == "en"
    assert package.localization.required_publish_language_tags == ["zh-Hant"]


def test_ep001_runtime_matches_approved_24_seconds() -> None:
    """派生时长为审定文档锁定的 24.0 秒，且落在 15–30 秒发布区间内。"""
    package = _ep001_package()
    assert derived_runtime_for(package).total_ms == 24_000
    assert package.output.total_runtime_ms == 24_000
    assert [s.duration_seconds for s in sorted(package.shots, key=lambda s: s.sequence)] == [
        3.0,
        7.0,
        6.5,
        4.5,
    ]


def test_ep001_uses_canonical_cast_only() -> None:
    """只使用 Bible v1 的三位主角，绝不出现替身角色。"""
    keys = {c.character_key for c in _ep001_package().characters}
    assert keys == {"bruno_bull", "boris_bear", "milo_cat"}
    assert "walter" not in {k.lower() for k in keys}


def test_ep001_passes_every_validation_stage() -> None:
    """CAS QA 五阶段全部通过（含 publish 的时长与禁用措辞检查）。"""
    package = _ep001_package()
    for stage in ValidationStage:
        result = validate_episode_package(package, stage=stage)
        assert result.ok, f"stage {stage.value} failed: {[i.code for i in result.errors]}"


# --------------------------------------------------------------------------- #
# 2. 完整实体映射
# --------------------------------------------------------------------------- #
def test_import_creates_complete_entity_graph() -> None:
    """一次导入建立 Chapter→Shot→ShotDetail→ShotDialogLine 的完整图，且只建一个 Chapter。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                result = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                )
                await db.commit()

            assert result.status == "imported"
            assert result.chapter_id is not None
            assert result.created.chapters == 1
            assert result.created.shots == 4
            assert result.created.shot_details == 4
            assert result.created.dialog_lines == 4
            assert result.created.characters == 3

            assert await _count(session_factory, Chapter) == 1
            assert await _count(session_factory, Shot) == 4
            assert await _count(session_factory, ShotDetail) == 4
            assert await _count(session_factory, ShotDialogLine) == 4
            assert await _count(session_factory, CasImportLedger) == 1

            async with session_factory() as db:
                chapter = (await db.execute(select(Chapter))).scalars().one()
                assert chapter.project_id == pid
                assert chapter.title == "BTC Breaks Out — Bruno Celebrates Too Early"
                assert chapter.storyboard_count == 4
                # raw_text 保留完整剧本，供追溯（决策 4）。
                assert "Breakout! We are so back!" in chapter.raw_text
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_character_and_actor_are_linked_but_distinct() -> None:
    """Character（项目内角色）与 Actor（可复用视觉身份）分开建模并正确关联。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                )
                await db.commit()

            async with session_factory() as db:
                characters = (await db.execute(select(Character))).scalars().all()
                actors = (await db.execute(select(Actor))).scalars().all()

            assert len(characters) == 3
            assert len(actors) == 3
            assert {c.name for c in characters} == {"Bruno Bull", "Boris Bear", "Milo Cat"}
            # 每个角色都归属该项目，并链接到一个独立的 Actor 身份。
            for character in characters:
                assert character.project_id == pid
                assert character.actor_id is not None
            # Character 与 Actor 是两套 ID，绝不合并。
            assert {c.id for c in characters}.isdisjoint({a.id for a in actors})
            assert len({c.actor_id for c in characters}) == 3
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_shot_order_and_dialogue_are_preserved() -> None:
    """镜头按 sequence 落到 Shot.index，对白顺序与文本逐字保真。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                )
                await db.commit()

            async with session_factory() as db:
                shots = (await db.execute(select(Shot).order_by(Shot.index))).scalars().all()
                assert [s.index for s in shots] == [1, 2, 3, 4]
                assert [s.title for s in shots] == [
                    "The premature toast",
                    "Confirmation, please",
                    "The dip",
                    "Before the close",
                ]

                texts: list[str] = []
                for shot in shots:
                    lines = (
                        (
                            await db.execute(
                                select(ShotDialogLine)
                                .where(ShotDialogLine.shot_detail_id == shot.id)
                                .order_by(ShotDialogLine.index)
                            )
                        )
                        .scalars()
                        .all()
                    )
                    texts.extend(line.text for line in lines)
                assert texts == _EXPECTED_ENGLISH

                links = (await db.execute(select(ShotCharacterLink))).scalars().all()
                assert len(links) > 0
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_english_dialogue_and_zh_hant_subtitles_are_preserved() -> None:
    """英文对白进入可编辑实体；zh-Hant 字幕在契约侧保真并被幂等哈希覆盖。

    经批准的决策：Jellyfish 当前没有任何字幕/语言列（``shot_dialog_lines`` 只有单一
    ``text``），因此本切片**不**新增迁移。字幕留在 EpisodePackage 与 CAS 生产产物中；
    这里断言两件可验证的事：
    1. 数据库里的对白确实是英文原文（不是被字幕覆盖）；
    2. zh-Hant 字幕轨完整、与镜头正确关联，并被纳入幂等 payload 哈希——
       改动任一字幕都会改变哈希，因此字幕不可能被静默丢弃。
    """

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                )
                await db.commit()

            async with session_factory() as db:
                lines = (
                    (await db.execute(select(ShotDialogLine).order_by(ShotDialogLine.id)))
                    .scalars()
                    .all()
                )
            # 1. 落库的是英文对白。
            assert sorted(line.text for line in lines) == sorted(_EXPECTED_ENGLISH)
            for line in lines:
                assert line.speaker_name in {"Bruno Bull", "Boris Bear", "Milo Cat"}
        finally:
            await engine.dispose()

    asyncio.run(_run())

    # 2. 字幕轨在契约侧完整且与镜头关联。
    package = _ep001_package()
    tracks = package.localization.subtitle_tracks
    assert len(tracks) == 1
    track = tracks[0]
    assert track.language_tag == "zh-Hant"
    assert [cue.text for cue in track.cues] == _EXPECTED_ZH_HANT
    shot_ids = {shot.shot_id for shot in package.shots}
    for cue in track.cues:
        assert cue.shot_id in shot_ids
        assert cue.end_ms > cue.start_ms

    # 3. 字幕纳入幂等哈希：改一个字就换哈希。
    mutated = _ep001_dict()
    mutated["localization"]["subtitle_tracks"][0]["cues"][0]["text"] = "改過的字幕"
    assert canonical_payload_hash(parse_episode_package(mutated)) != canonical_payload_hash(package)


# --------------------------------------------------------------------------- #
# 3. 幂等
# --------------------------------------------------------------------------- #
def test_second_import_is_idempotent() -> None:
    """同一 (project, key, payload) 重复导入不产生任何重复实体。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                first = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                )
                await db.commit()

            async with session_factory() as db:
                second = await import_episode(
                    db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                )
                await db.commit()

            assert first.status == "imported"
            assert second.status == "replayed"
            assert second.idempotent_replay is True
            assert second.chapter_id == first.chapter_id

            assert await _count(session_factory, Chapter) == 1
            assert await _count(session_factory, Shot) == 4
            assert await _count(session_factory, ShotDetail) == 4
            assert await _count(session_factory, ShotDialogLine) == 4
            assert await _count(session_factory, Character) == 3
            assert await _count(session_factory, Actor) == 3
            assert await _count(session_factory, CasImportLedger) == 1
        finally:
            await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# 4. 事务与回滚
# --------------------------------------------------------------------------- #
def test_qa_gate_failure_creates_no_rows() -> None:
    """QA 闸门失败发生在建实体之前 → 零写入。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            broken = _ep001_dict()
            # 让事实处于未锁定状态：data-lock 阶段必须拒绝。
            broken["market_data"]["data_lock"]["status"] = "unresolved"
            package = parse_episode_package(broken)

            async with session_factory() as db:
                with pytest.raises(CasValidationError) as excinfo:
                    await import_episode(
                        db, project_id=pid, package=package, idempotency_key="ep001-bad"
                    )
                await db.rollback()

            assert excinfo.value.stage is ValidationStage.pre_render_data_lock
            assert "data_lock_required" in {issue.code for issue in excinfo.value.issues}

            assert await _count(session_factory, Chapter) == 0
            assert await _count(session_factory, Shot) == 0
            assert await _count(session_factory, ShotDialogLine) == 0
            assert await _count(session_factory, Character) == 0
            assert await _count(session_factory, CasImportLedger) == 0
        finally:
            await engine.dispose()

    asyncio.run(_run())


def test_failure_midway_rolls_back_completely(monkeypatch: pytest.MonkeyPatch) -> None:
    """导入中途抛错 → 整个事务回滚，不留任何部分写入。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            real_round = ie.mapping.round_duration
            calls = {"n": 0}

            def _boom(seconds: float) -> int:
                calls["n"] += 1
                if calls["n"] == 3:  # 前两镜已写入后再炸，确保确实有部分写入待回滚
                    raise RuntimeError("injected failure during shot mapping")
                return real_round(seconds)

            monkeypatch.setattr(ie.mapping, "round_duration", _boom)

            async with session_factory() as db:
                with pytest.raises(RuntimeError, match="injected failure"):
                    await import_episode(
                        db, project_id=pid, package=_ep001_package(), idempotency_key="ep001-k1"
                    )
                await db.rollback()

            assert await _count(session_factory, Chapter) == 0
            assert await _count(session_factory, Shot) == 0
            assert await _count(session_factory, ShotDetail) == 0
            assert await _count(session_factory, ShotDialogLine) == 0
            assert await _count(session_factory, CasImportLedger) == 0
        finally:
            await engine.dispose()

    asyncio.run(_run())


# --------------------------------------------------------------------------- #
# 5. 异步任务
# --------------------------------------------------------------------------- #
def test_async_task_succeeds_and_imports_episode() -> None:
    """cas_import_episode_package 任务跑通：状态 succeeded，且实体确实落库。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        original = async_session_maker._maker  # pylint: disable=protected-access
        try:
            pid = await _seed_project(session_factory)
            async_session_maker.configure(session_factory)

            async with session_factory() as db:
                created = await create_cas_import_task(
                    db,
                    project_id=pid,
                    episode_package=_ep001_dict(),
                    idempotency_key="ep001-async",
                )
                await db.commit()

            assert created.reused is False
            assert created.relation_type == CAS_EPISODE_IMPORT_RELATION_TYPE
            assert created.relation_entity_id == episode_relation_entity_id(pid, "CAS-EP001")

            async with session_factory() as db:
                task = await db.get(GenerationTask, created.task_id)
                assert task is not None
                assert task.task_kind == CAS_IMPORT_EPISODE_TASK_KIND
                link = (await db.execute(select(GenerationTaskLink))).scalars().one()
                assert link.task_id == created.task_id

            await run_cas_import_task(created.task_id)

            async with session_factory() as db:
                task = await db.get(GenerationTask, created.task_id)
                status_value = (
                    task.status.value if hasattr(task.status, "value") else str(task.status)
                )
                assert status_value == TaskStatus.succeeded.value
                assert not task.error

            assert await _count(session_factory, Chapter) == 1
            assert await _count(session_factory, Shot) == 4
            assert await _count(session_factory, CasImportLedger) == 1
        finally:
            async_session_maker.configure(original)
            await engine.dispose()

    asyncio.run(_run())


def test_async_task_records_failure_state() -> None:
    """目标项目不存在 → 任务落 failed 且带错误信息，同时零写入。"""

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
                    idempotency_key="ep001-async-fail",
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
            assert await _count(session_factory, CasImportLedger) == 0
        finally:
            async_session_maker.configure(original)
            await engine.dispose()

    asyncio.run(_run())


def test_async_task_reuses_active_task_for_same_episode() -> None:
    """同一 (project, episode) 已有活动任务时复用，不重复登记。"""

    async def _run() -> None:
        engine, session_factory = await _make_sessionmaker()
        try:
            pid = await _seed_project(session_factory)
            async with session_factory() as db:
                first = await create_cas_import_task(
                    db, project_id=pid, episode_package=_ep001_dict(), idempotency_key="a"
                )
                await db.commit()
            async with session_factory() as db:
                second = await create_cas_import_task(
                    db, project_id=pid, episode_package=_ep001_dict(), idempotency_key="b"
                )
                await db.commit()

            assert first.reused is False
            assert second.reused is True
            assert second.task_id == first.task_id
            assert await _count(session_factory, GenerationTask) == 1
        finally:
            await engine.dispose()

    asyncio.run(_run())
