"""CAS EpisodePackage 导入器集成测试（SQLite，单事务）。

覆盖：成功导入、dry-run 不写库、幂等重放、幂等冲突、跨 key 重复 episode、相机映射、
对白映射、资产复用、章节/镜头创建、错误回滚、项目不存在。

用同步测试函数内 ``asyncio.run`` 驱动异步会话，避免 pytest-asyncio 事件循环夹具的复杂度。
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
from app.core.db import Base
from app.crypto_animal_studio.application.import_episode import (
    EpisodeAlreadyImportedError,
    IdempotencyConflictError,
    ProjectNotFoundError,
    import_episode,
)
from app.crypto_animal_studio.domain.import_ledger import CasImportLedger
from app.crypto_animal_studio.schemas.episode_package import EpisodePackage
from app.models.studio import (
    Actor,
    Chapter,
    Character,
    Costume,
    Project,
    Prop,
    Scene,
    Shot,
    ShotDetail,
    ShotDialogLine,
)
from app.models.types import ProjectStyle, ProjectVisualStyle

_REPO_ROOT = Path(__file__).resolve().parents[2]
_SAMPLE = _REPO_ROOT / "docs" / "crypto-animal-studio" / "samples" / "sample-episode-package-v1.json"


def _sample_dict() -> dict:
    return json.loads(_SAMPLE.read_text(encoding="utf-8"))


async def _make_sessionmaker():
    """建内存 SQLite（StaticPool 共享单连接）并创建全部表，返回 (engine, Session)。"""
    engine = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # 注册模型到 Base.metadata
    import app.models.studio  # noqa: F401
    import app.models.llm  # noqa: F401
    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401
    import app.crypto_animal_studio.domain.import_ledger  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    return engine, async_sessionmaker(engine, expire_on_commit=False)


async def _seed_project(Session, project_id: str = "proj-1") -> str:
    async with Session() as db:
        db.add(
            Project(
                id=project_id,
                name="Crypto Animal Street (Season 1)",
                style=ProjectStyle.anime_3d,
                visual_style=ProjectVisualStyle.anime,
            )
        )
        await db.commit()
    return project_id


async def _count(Session, model) -> int:
    async with Session() as db:
        return int((await db.execute(select(func.count()).select_from(model))).scalar() or 0)


# --------------------------------------------------------------------------- #
def test_successful_import_creates_chapter_and_shots() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        pkg = EpisodePackage.model_validate(_sample_dict())
        async with Session() as db:
            result = await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.commit()
        assert result.status == "imported"
        assert result.chapter_id is not None
        assert result.created.shots == 4
        assert result.created.dialog_lines >= 4
        assert result.created.characters == 3
        assert result.created.actors == 3
        assert result.created.scenes == 1
        assert result.created.props >= 2
        assert result.created.costumes >= 2
        assert result.created.links > 0
        # 持久化核对
        assert await _count(Session, Chapter) == 1
        assert await _count(Session, Shot) == 4
        assert await _count(Session, ShotDetail) == 4
        assert await _count(Session, ShotDialogLine) >= 4
        assert await _count(Session, Character) == 3
        assert await _count(Session, CasImportLedger) == 1
        await engine.dispose()

    asyncio.run(_run())


def test_dry_run_writes_nothing() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        pkg = EpisodePackage.model_validate(_sample_dict())
        async with Session() as db:
            result = await import_episode(
                db, project_id=pid, package=pkg, idempotency_key="k1", dry_run=True
            )
            await db.commit()  # 模拟 get_db 的最终提交（服务内部已 rollback → 空提交）
        assert result.status == "dry_run"
        assert result.dry_run is True
        assert result.chapter_id is None
        assert result.chapter_index == 1
        assert result.created.shots == 4  # 报告“将创建”的计数
        assert await _count(Session, Chapter) == 0
        assert await _count(Session, Shot) == 0
        assert await _count(Session, CasImportLedger) == 0
        await engine.dispose()

    asyncio.run(_run())


def test_idempotent_replay_returns_existing() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        pkg = EpisodePackage.model_validate(_sample_dict())
        async with Session() as db:
            first = await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.commit()
        async with Session() as db:
            replay = await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.commit()
        assert replay.status == "replayed"
        assert replay.idempotent_replay is True
        assert replay.chapter_id == first.chapter_id
        assert await _count(Session, Chapter) == 1  # 无重复章节
        await engine.dispose()

    asyncio.run(_run())


def test_same_key_different_payload_conflicts() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        async with Session() as db:
            await import_episode(
                db, project_id=pid, package=EpisodePackage.model_validate(_sample_dict()),
                idempotency_key="k1",
            )
            await db.commit()
        changed = _sample_dict()
        changed["title"] = "Different Title"
        async with Session() as db:
            with pytest.raises(IdempotencyConflictError):
                await import_episode(
                    db, project_id=pid, package=EpisodePackage.model_validate(changed),
                    idempotency_key="k1",
                )
        await engine.dispose()

    asyncio.run(_run())


def test_same_episode_other_key_rejected() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        async with Session() as db:
            await import_episode(
                db, project_id=pid, package=EpisodePackage.model_validate(_sample_dict()),
                idempotency_key="k1",
            )
            await db.commit()
        async with Session() as db:
            with pytest.raises(EpisodeAlreadyImportedError):
                await import_episode(
                    db, project_id=pid, package=EpisodePackage.model_validate(_sample_dict()),
                    idempotency_key="k2-different",
                )
        await engine.dispose()

    asyncio.run(_run())


def test_camera_missing_defaults_and_warns() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        data = _sample_dict()
        data["shots"][0].pop("camera", None)  # 移除首镜 camera
        pkg = EpisodePackage.model_validate(data)
        async with Session() as db:
            result = await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.commit()
        assert any("camera missing" in w for w in result.warnings)
        # 首镜 ShotDetail 使用默认相机
        async with Session() as db:
            details = (await db.execute(select(ShotDetail))).scalars().all()
            defaulted = [d for d in details if d.camera_shot == "MS" and d.movement == "STATIC"]
            assert defaulted, "expected a shot detail with defaulted camera"
        await engine.dispose()

    asyncio.run(_run())


def test_dialogue_mapping_persists_lines_and_speakers() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        pkg = EpisodePackage.model_validate(_sample_dict())
        async with Session() as db:
            await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.commit()
        async with Session() as db:
            lines = (await db.execute(select(ShotDialogLine))).scalars().all()
            assert len(lines) >= 4
            assert all(l.text for l in lines)
            assert any(l.speaker_name for l in lines)  # 说话人名回填
            assert any(l.speaker_character_id for l in lines)  # 关联到角色
        await engine.dispose()

    asyncio.run(_run())


def test_asset_reuse_across_episodes_same_project() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        async with Session() as db:
            await import_episode(
                db, project_id=pid, package=EpisodePackage.model_validate(_sample_dict()),
                idempotency_key="k1",
            )
            await db.commit()
        # 第二集：不同 episode_id + 不同 key，但角色/演员同名 → 复用
        data2 = _sample_dict()
        data2["episode_id"] = "CAS-E002"
        async with Session() as db:
            result2 = await import_episode(
                db, project_id=pid, package=EpisodePackage.model_validate(data2),
                idempotency_key="k2",
            )
            await db.commit()
        assert result2.reused.actors >= 1
        assert result2.reused.characters >= 1
        assert result2.created.actors == 0  # 全部复用，未重复创建
        # 全库只有一份 3 个 Actor（未翻倍）
        assert await _count(Session, Actor) == 3
        await engine.dispose()

    asyncio.run(_run())


def test_error_midway_rolls_back_everything(monkeypatch) -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        pkg = EpisodePackage.model_validate(_sample_dict())

        calls = {"n": 0}
        real = ie.create_and_refresh

        async def failing(db, obj):
            calls["n"] += 1
            if calls["n"] >= 6:  # 在写入若干行之后失败
                raise RuntimeError("boom")
            return await real(db, obj)

        monkeypatch.setattr(ie, "create_and_refresh", failing)
        async with Session() as db:
            with pytest.raises(RuntimeError):
                await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.rollback()  # 模拟 get_db 异常时回滚
        # 无部分写入
        assert await _count(Session, Chapter) == 0
        assert await _count(Session, Shot) == 0
        assert await _count(Session, CasImportLedger) == 0
        await engine.dispose()

    asyncio.run(_run())


def test_ledger_insert_failure_rolls_back_entire_episode(monkeypatch) -> None:
    """台账行写入失败 → 整集（Chapter/Shots/Details/对白/资产/链接）全部回滚。

    证明 ledger 与全部业务写入共用同一 AsyncSession、处于同一个事务：
    ledger 是导入的最后一步，令其失败后回滚，库中应无任何本次导入的数据。
    """

    async def _run():
        engine, Session = await _make_sessionmaker()
        pid = await _seed_project(Session)
        pkg = EpisodePackage.model_validate(_sample_dict())

        real = ie.create_and_refresh

        async def failing(db, obj):
            # 仅在写入台账行时失败；此前所有业务写入都在同一事务内。
            if isinstance(obj, CasImportLedger):
                raise RuntimeError("ledger insert boom")
            return await real(db, obj)

        monkeypatch.setattr(ie, "create_and_refresh", failing)
        async with Session() as db:
            with pytest.raises(RuntimeError):
                await import_episode(db, project_id=pid, package=pkg, idempotency_key="k1")
            await db.rollback()  # 模拟 get_db 异常时的回滚

        # 全部回滚：没有任何部分写入
        for model in (Chapter, Shot, ShotDetail, ShotDialogLine, Character, Actor, Scene, Prop, Costume, CasImportLedger):
            assert await _count(Session, model) == 0, f"{model.__name__} not rolled back"
        await engine.dispose()

    asyncio.run(_run())


def test_project_not_found() -> None:
    async def _run():
        engine, Session = await _make_sessionmaker()
        pkg = EpisodePackage.model_validate(_sample_dict())
        async with Session() as db:
            with pytest.raises(ProjectNotFoundError):
                await import_episode(db, project_id="missing", package=pkg, idempotency_key="k1")
        await engine.dispose()

    asyncio.run(_run())
