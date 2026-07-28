from __future__ import annotations

from dataclasses import dataclass

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.db import Base
from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore
from app.core.task_manager.types import TaskStatus
from app.models.task import GenerationTask, GenerationTaskStatus
from app.models.task_links import GenerationTaskLink
from app.services.script_processing_worker import run_extract_task_sync
from app.services.script_processing_tasks import (
    CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE,
    CHAPTER_DIVISION_RELATION_TYPE,
    CONSISTENCY_CHECK_RELATION_TYPE,
    COSTUME_INFO_ANALYSIS_RELATION_TYPE,
    ENTITY_MERGE_RELATION_TYPE,
    PROP_INFO_ANALYSIS_RELATION_TYPE,
    SCENE_INFO_ANALYSIS_RELATION_TYPE,
    SCRIPT_OPTIMIZATION_RELATION_TYPE,
    SCRIPT_SIMPLIFICATION_RELATION_TYPE,
    SCRIPT_EXTRACTION_RELATION_TYPE,
    VARIANT_ANALYSIS_RELATION_TYPE,
    create_character_portrait_task,
    create_consistency_task,
    create_costume_info_task,
    create_divide_task,
    create_extract_task,
    create_merge_task,
    create_prop_info_task,
    create_scene_info_task,
    create_script_optimization_task,
    create_script_simplification_task,
    create_variant_task,
    pick_analysis_relation_entity_id,
    pick_consistency_relation_entity_id,
    pick_merge_relation_entity_id,
    pick_variant_relation_entity_id,
)


@pytest.mark.asyncio
async def test_create_divide_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_divide_task(
            db,
            chapter_id="chapter-1",
            script_text="一段剧本",
            write_to_db=True,
        )

        assert result.reused is False
        assert result.status == TaskStatus.pending
        assert result.relation_type == CHAPTER_DIVISION_RELATION_TYPE
        assert result.relation_entity_id == "chapter-1"

        task = await db.get(GenerationTask, result.task_id)
        assert task is not None
        assert task.payload["command"] == {
            "modality": "text",
            "operation": "text_agent",
            "delivery": "async_polling",
            "target": {"kind": "script_processing", "entity_id": "chapter-1"},
            "request": {
                "operation_input": {
                    "kind": "script_operation",
                    "operation": "divide",
                    "source_text": "一段剧本",
                }
            },
        }
        assert task.payload["snapshot"] == {
            "operation": "divide",
            "run_args": {
                "chapter_id": "chapter-1",
                "script_text": "一段剧本",
                "write_to_db": True,
            },
        }
        assert "credential_ref" not in task.payload["snapshot"]

        link = (
            await db.execute(
                select(GenerationTaskLink).where(
                    GenerationTaskLink.task_id == result.task_id,
                    GenerationTaskLink.relation_type == CHAPTER_DIVISION_RELATION_TYPE,
                    GenerationTaskLink.relation_entity_id == "chapter-1",
                )
            )
        ).scalars().first()
        assert link is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_divide_task_reuses_existing_active_task() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        first = await create_divide_task(
            db,
            chapter_id="chapter-1",
            script_text="第一版",
            write_to_db=True,
        )
        second = await create_divide_task(
            db,
            chapter_id="chapter-1",
            script_text="第二版",
            write_to_db=True,
        )

        assert second.reused is True
        assert second.task_id == first.task_id

        link_count = len(
            (
                await db.execute(
                    select(GenerationTaskLink).where(
                        GenerationTaskLink.relation_type == CHAPTER_DIVISION_RELATION_TYPE,
                        GenerationTaskLink.relation_entity_id == "chapter-1",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert link_count == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_request_cancel_marks_pending_task_cancelled_immediately() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        store = SqlAlchemyTaskStore(db)
        task = await store.create(payload={"k": "v"}, mode=DeliveryMode.async_polling, task_kind="test_task")
        rec = await store.request_cancel(task.id, "用户取消")
        assert rec is not None
        assert rec.cancel_requested is True
        assert rec.status == TaskStatus.cancelled

        view = await store.get_status_view(task.id)
        assert view is not None
        assert view.cancel_requested is True
        assert view.status == TaskStatus.cancelled

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_extract_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_extract_task(
            db,
            project_id="project-1",
            chapter_id="chapter-1",
            script_division={"shots": []},
            consistency=None,
            refresh_cache=False,
        )

        assert result.reused is False
        assert result.status == TaskStatus.pending
        assert result.relation_type == SCRIPT_EXTRACTION_RELATION_TYPE
        assert result.relation_entity_id == "chapter-1"

        task = await db.get(GenerationTask, result.task_id)
        assert task is not None

        link = (
            await db.execute(
                select(GenerationTaskLink).where(
                    GenerationTaskLink.task_id == result.task_id,
                    GenerationTaskLink.relation_type == SCRIPT_EXTRACTION_RELATION_TYPE,
                    GenerationTaskLink.relation_entity_id == "chapter-1",
                )
            )
        ).scalars().first()
        assert link is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_extract_task_reuses_existing_active_task() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        first = await create_extract_task(
            db,
            project_id="project-1",
            chapter_id="chapter-1",
            script_division={"shots": []},
            consistency=None,
            refresh_cache=False,
        )
        second = await create_extract_task(
            db,
            project_id="project-1",
            chapter_id="chapter-1",
            script_division={"shots": [{"index": 1}]},
            consistency={"ok": True},
            refresh_cache=True,
        )

        assert second.reused is True
        assert second.task_id == first.task_id

        link_count = len(
            (
                await db.execute(
                    select(GenerationTaskLink).where(
                        GenerationTaskLink.relation_type == SCRIPT_EXTRACTION_RELATION_TYPE,
                        GenerationTaskLink.relation_entity_id == "chapter-1",
                    )
                )
            )
            .scalars()
            .all()
        )
        assert link_count == 1

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_merge_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_merge_task(
            db,
            relation_entity_id="chapter-1",
            all_shot_extractions=[],
            historical_library=None,
            script_division=None,
            previous_merge=None,
            conflict_resolutions=None,
        )

        assert result.reused is False
        assert result.status == TaskStatus.pending
        assert result.relation_type == ENTITY_MERGE_RELATION_TYPE
        assert result.relation_entity_id == "chapter-1"

        link = (
            await db.execute(
                select(GenerationTaskLink).where(
                    GenerationTaskLink.task_id == result.task_id,
                    GenerationTaskLink.relation_type == ENTITY_MERGE_RELATION_TYPE,
                    GenerationTaskLink.relation_entity_id == "chapter-1",
                )
            )
        ).scalars().first()
        assert link is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_merge_task_reuses_existing_active_task() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        first = await create_merge_task(
            db,
            relation_entity_id="chapter-1",
            all_shot_extractions=[],
            historical_library=None,
            script_division=None,
            previous_merge=None,
            conflict_resolutions=None,
        )
        second = await create_merge_task(
            db,
            relation_entity_id="chapter-1",
            all_shot_extractions=[{"a": 1}],
            historical_library={"x": 1},
            script_division={"shots": []},
            previous_merge=None,
            conflict_resolutions=[],
        )

        assert second.reused is True
        assert second.task_id == first.task_id

    await engine.dispose()


def test_pick_merge_relation_entity_id_prefers_chapter() -> None:
    assert pick_merge_relation_entity_id(chapter_id="chapter-1", project_id="project-1") == "chapter-1"
    assert pick_merge_relation_entity_id(chapter_id=None, project_id="project-1") == "project-1"


@pytest.mark.asyncio
async def test_create_consistency_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_consistency_task(
            db,
            relation_entity_id="chapter-1",
            script_text="完整剧本",
        )

        assert result.reused is False
        assert result.status == TaskStatus.pending
        assert result.relation_type == CONSISTENCY_CHECK_RELATION_TYPE
        assert result.relation_entity_id == "chapter-1"

        link = (
            await db.execute(
                select(GenerationTaskLink).where(
                    GenerationTaskLink.task_id == result.task_id,
                    GenerationTaskLink.relation_type == CONSISTENCY_CHECK_RELATION_TYPE,
                    GenerationTaskLink.relation_entity_id == "chapter-1",
                )
            )
        ).scalars().first()
        assert link is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_consistency_task_reuses_existing_active_task() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        first = await create_consistency_task(
            db,
            relation_entity_id="chapter-1",
            script_text="完整剧本 A",
        )
        second = await create_consistency_task(
            db,
            relation_entity_id="chapter-1",
            script_text="完整剧本 B",
        )

        assert second.reused is True
        assert second.task_id == first.task_id

    await engine.dispose()


def test_pick_consistency_relation_entity_id_prefers_chapter() -> None:
    assert pick_consistency_relation_entity_id(chapter_id="chapter-1", project_id="project-1") == "chapter-1"
    assert pick_consistency_relation_entity_id(chapter_id=None, project_id="project-1") == "project-1"


@pytest.mark.asyncio
async def test_create_variant_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_variant_task(
            db,
            relation_entity_id="chapter-1",
            merged_library={},
            all_shot_extractions=[],
            script_division=None,
        )

        assert result.reused is False
        assert result.status == TaskStatus.pending
        assert result.relation_type == VARIANT_ANALYSIS_RELATION_TYPE
        assert result.relation_entity_id == "chapter-1"

        link = (
            await db.execute(
                select(GenerationTaskLink).where(
                    GenerationTaskLink.task_id == result.task_id,
                    GenerationTaskLink.relation_type == VARIANT_ANALYSIS_RELATION_TYPE,
                    GenerationTaskLink.relation_entity_id == "chapter-1",
                )
            )
        ).scalars().first()
        assert link is not None

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_variant_task_reuses_existing_active_task() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        first = await create_variant_task(
            db,
            relation_entity_id="chapter-1",
            merged_library={},
            all_shot_extractions=[],
            script_division=None,
        )
        second = await create_variant_task(
            db,
            relation_entity_id="chapter-1",
            merged_library={"characters": []},
            all_shot_extractions=[{"a": 1}],
            script_division={"shots": []},
        )

        assert second.reused is True
        assert second.task_id == first.task_id

    await engine.dispose()


def test_pick_variant_relation_entity_id_prefers_chapter() -> None:
    assert pick_variant_relation_entity_id(chapter_id="chapter-1", project_id="project-1") == "chapter-1"
    assert pick_variant_relation_entity_id(chapter_id=None, project_id="project-1") == "project-1"


@pytest.mark.asyncio
async def test_create_character_portrait_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_character_portrait_task(
            db,
            relation_entity_id="chapter-1",
            character_context=None,
            character_description="人物描述",
        )
        assert result.relation_type == CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_prop_info_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_prop_info_task(
            db,
            relation_entity_id="chapter-1",
            prop_context=None,
            prop_description="道具描述",
        )
        assert result.relation_type == PROP_INFO_ANALYSIS_RELATION_TYPE

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_scene_info_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_scene_info_task(
            db,
            relation_entity_id="chapter-1",
            scene_context=None,
            scene_description="场景描述",
        )
        assert result.relation_type == SCENE_INFO_ANALYSIS_RELATION_TYPE

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_costume_info_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_costume_info_task(
            db,
            relation_entity_id="chapter-1",
            costume_context=None,
            costume_description="服装描述",
        )
        assert result.relation_type == COSTUME_INFO_ANALYSIS_RELATION_TYPE

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_script_optimization_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_script_optimization_task(
            db,
            relation_entity_id="chapter-1",
            script_text="原始剧本",
            consistency={"has_issues": True},
        )
        assert result.relation_type == SCRIPT_OPTIMIZATION_RELATION_TYPE

    await engine.dispose()


@pytest.mark.asyncio
async def test_create_script_simplification_task_creates_task_and_link() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        result = await create_script_simplification_task(
            db,
            relation_entity_id="chapter-1",
            script_text="原始剧本",
        )
        assert result.relation_type == SCRIPT_SIMPLIFICATION_RELATION_TYPE

    await engine.dispose()


def test_pick_analysis_relation_entity_id_prefers_chapter() -> None:
    assert pick_analysis_relation_entity_id(chapter_id="chapter-1", project_id="project-1", endpoint="x") == "chapter-1"
    assert pick_analysis_relation_entity_id(chapter_id=None, project_id="project-1", endpoint="x") == "project-1"


@dataclass
class _FakeDraft:
    payload: dict

    def model_dump(self) -> dict:
        return self.payload

    def model_copy(self, *, deep: bool = False):  # noqa: ARG002
        return _FakeDraft(dict(self.payload))


class _FakeExtractorAgent:
    def __init__(self, _llm) -> None:
        pass

    def extract(self, **_kwargs):
        return _FakeDraft({"shots": []})


@pytest.mark.asyncio
async def test_run_extract_task_marks_cancelled_when_cancel_requested_before_start(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "extract-cancel-before-start.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    SyncSessionLocal = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with SessionLocal() as db:
        created = await create_extract_task(
            db,
            project_id="project-1",
            chapter_id="chapter-1",
            script_division={"shots": []},
            consistency=None,
            refresh_cache=False,
        )
        store = SqlAlchemyTaskStore(db)
        await store.request_cancel(created.task_id, "用户取消")
        await db.commit()

    monkeypatch.setattr("app.services.script_processing_worker.sync_session_maker", SyncSessionLocal)

    run_extract_task_sync(created.task_id)

    async with SessionLocal() as db:
        row = await db.get(GenerationTask, created.task_id)
        assert row is not None
        assert row.status == GenerationTaskStatus.cancelled
        assert bool(row.cancel_requested) is True
        assert row.cancelled_at is not None

    await engine.dispose()
    sync_engine.dispose()


@pytest.mark.asyncio
async def test_run_extract_task_marks_cancelled_at_stage_boundary(monkeypatch, tmp_path) -> None:
    db_path = tmp_path / "extract-cancel-stage-boundary.db"
    engine = create_async_engine(f"sqlite+aiosqlite:///{db_path}", future=True)
    sync_engine = create_engine(f"sqlite:///{db_path}", future=True)
    SessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    SyncSessionLocal = sessionmaker(sync_engine, class_=Session, expire_on_commit=False)

    import app.models.task  # noqa: F401
    import app.models.task_links  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    monkeypatch.setattr("app.services.script_processing_worker.sync_session_maker", SyncSessionLocal)
    monkeypatch.setattr("app.services.script_processing_worker.ElementExtractorAgent", _FakeExtractorAgent)

    def _fake_llm(_db, *, thinking: bool):  # noqa: ARG001
        return object()

    def _cancel_during_sync(db, chapter_id: str, draft) -> None:  # noqa: ANN001
        del chapter_id, draft
        from app.core.task_manager import SyncSqlAlchemyTaskStore

        store = SyncSqlAlchemyTaskStore(db)
        task_id = getattr(_cancel_during_sync, "task_id")
        store.request_cancel(task_id, "阶段边界取消")
        db.commit()

    def _noop_dialog_sync(_db, chapter_id: str, draft) -> None:  # noqa: ANN001
        return None

    monkeypatch.setattr("app.services.script_processing_worker.build_default_text_llm_sync", _fake_llm)
    monkeypatch.setattr(
        "app.services.script_processing_worker.sync_shot_extracted_candidates_from_draft_sync",
        _cancel_during_sync,
    )
    monkeypatch.setattr(
        "app.services.script_processing_worker.sync_shot_extracted_dialogue_candidates_from_draft_sync",
        _noop_dialog_sync,
    )

    async with SessionLocal() as db:
        created = await create_extract_task(
            db,
            project_id="project-1",
            chapter_id="chapter-1",
            script_division={"shots": []},
            consistency=None,
            refresh_cache=True,
        )
        await db.commit()
        setattr(_cancel_during_sync, "task_id", created.task_id)

    run_extract_task_sync(created.task_id)

    async with SessionLocal() as db:
        row = await db.get(GenerationTask, created.task_id)
        assert row is not None
        assert row.status == GenerationTaskStatus.cancelled
        assert bool(row.cancel_requested) is True
        assert row.result == {"draft": {"shots": []}, "from_cache": False}

    await engine.dispose()
    sync_engine.dispose()
