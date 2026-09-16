"""真实数据库核对来源身份、历史快照与归属。"""

import pytest

from app.core.contracts.directing.common import Source, MediaRange
from datetime import datetime

from app.models.studio import Chapter, FileItem, FileUsage
from app.models.task import Task
from app.services.directing.provenance import ProvenanceService
from tests.directing.samples import design_sample
from tests.directing.test_store import database


@pytest.mark.asyncio
async def test_exact_model_identity_and_project_boundary(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProvenanceService(db, "p1")
            seq = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            db.add(Task(id="task-id", kind="directing_design", project_id="p1", target_type="directing_sequence", target_id=seq.id,
                        input_snapshot={"model_name": "历史模型", "secret": "never expose", "run_args": {"task_identity": "generation-id", "script_text": "当时原文"}}))
            db.add(Task(id="legacy", kind="directing_design", project_id="p1", target_type="directing_sequence", target_id=seq.id, input_snapshot={"run_args": None}))
            db.add(Task(id="foreign", kind="directing_design", project_id="p2", target_type="directing_sequence", target_id=seq.id,
                        input_snapshot={"run_args": {"task_identity": "foreign-id", "script_text": "不可读"}}))
            await db.flush()
            sources = [Source(kind="model", reference=ref, version="1") for ref in ["generation-id", "task-id", "foreign-id", "missing"]]
            rows = await service.resolve_sources(seq.id, sources)
            assert rows[0].model_name == "历史模型" and rows[0].context_text == "当时原文"
            assert rows[0].task_id == "task-id" and rows[0].created_at
            assert "never expose" not in rows[0].model_dump_json()
            assert all(row.status == "unavailable" and row.context_text is None for row in rows[1:])
            with pytest.raises(ValueError, match="sequence not found"):
                await ProvenanceService(db, "p2").resolve_sources(seq.id, sources)
            db.add(Task(id="ambiguous", kind="directing_design", project_id="p1", target_type="directing_sequence", target_id=seq.id,
                        input_snapshot={"run_args": {"task_identity": "generation-id"}}))
            await db.flush()
            assert (await service.resolve_sources(seq.id, sources[:1]))[0].status == "unavailable"


@pytest.mark.asyncio
async def test_frozen_chapter_and_exact_revision(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProvenanceService(db, "p1")
            seq = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            source = Source.model_validate(seq.source)
            chapter = await db.get(Chapter, "ch1")
            chapter.raw_text = "修改后的原文"
            revision = await service.save_revision(seq.id, kind="design", payload=design_sample())
            rows = await service.resolve_sources(seq.id, [source, source.model_copy(update={"version": "missing"}),
                Source(kind="revision", reference=revision.id, version=str(revision.version)),
                Source(kind="revision", reference=revision.id, version="99"),
                Source(kind="human", reference="local-user", version="1")])
            assert rows[0].context_text == "兄弟在店中交谈"
            assert rows[1].context_text is None
            assert rows[2].revision_id == revision.id and rows[3].status == "unavailable"
            assert rows[4].label == "人工填写" and rows[4].created_at is None
            other = await service.create_sequence(chapter_id="ch1", title="另一场", position=1)
            foreign = await service.resolve_sources(other.id, [Source(kind="revision", reference=revision.id, version=str(revision.version))])
            assert foreign[0].status == "unavailable" and foreign[0].revision_id is None


@pytest.mark.asyncio
async def test_historical_chapter_snapshot_requires_unambiguous_same_sequence(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProvenanceService(db, "p1")
            seq = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            other = await service.create_sequence(chapter_id="ch1", title="另一场", position=1)
            source = Source(kind="chapter", reference="ch1", version="historic")
            args = {"source": source.model_dump(mode="json"), "script_text": "冻结的旧摘录", "task_identity": "old-generation"}
            db.add(Task(id="snapshot", kind="directing_design", project_id="p1", target_type="directing_sequence", target_id=seq.id, input_snapshot={"run_args": args}))
            await db.flush()
            assert (await service.resolve_sources(seq.id, [source]))[0].context_text == "冻结的旧摘录"
            foreign = await service.resolve_sources(other.id, [source, Source(kind="model", reference="old-generation", version="1")])
            assert all(row.status == "unavailable" and row.context_text is None for row in foreign)
            db.add(Task(id="conflicting-snapshot", kind="directing_design", project_id="p1", target_type="directing_sequence", target_id=seq.id, input_snapshot={"run_args": {**args, "script_text": "另一份冲突摘录"}}))
            await db.flush()
            assert (await service.resolve_sources(seq.id, [source]))[0].status == "unavailable"


@pytest.mark.asyncio
async def test_foreign_files_and_invalid_ranges(tmp_path):
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            service = ProvenanceService(db, "p1")
            seq = await service.create_sequence(chapter_id="ch1", title="店内", position=0)
            db.add(FileUsage(file_id="image1", project_id="p2", usage_kind="directing_reference", source_ref="foreign"))
            deleted = await db.get(FileItem, "video2")
            deleted.deleted_at = datetime.now()
            await db.flush()
            rows = await service.resolve_sources(seq.id, [
                Source(kind="file", reference="original", version="1", file_id="video1", media_range=MediaRange(source_in_ms=1000, source_out_ms=2000)),
                Source(kind="file", reference="original", version="1", file_id="image1"),
                Source(kind="file", reference="original", version="1", file_id="missing"),
                Source(kind="file", reference="original", version="1", file_id="video2"),
                Source(kind="file", reference="original", version="1", file_id="video1", media_range=MediaRange(source_in_ms=1000, source_out_ms=10000))])
            assert rows[0].file_name == "试拍" and rows[0].status == "ready"
            assert all(row.status == "unavailable" and row.file_name is None for row in rows[1:])


@pytest.mark.asyncio
async def test_source_api_limits_and_scope(tmp_path):
    from tests.directing.test_api import client_for
    async with database(tmp_path) as sessions:
        async with sessions.begin() as db:
            seq = await ProvenanceService(db, "p1").create_sequence(chapter_id="ch1", title="店内", position=0)
        async with client_for(sessions) as client:
            path = f"/api/v1/studio/projects/p1/directing/sequences/{seq.id}/sources/resolve"
            source = {"kind": "human", "reference": "local-user", "version": "manual-1"}
            response = await client.post(path, json={"sources": [source]})
            assert response.status_code == 200
            assert response.json()["data"][0]["label"] == "人工填写"
            assert (await client.post(path, json={"sources": [source] * 101})).status_code == 422
            assert (await client.post(path, json={"sources": []})).status_code == 422
            assert (await client.post(path.replace("projects/p1/", "projects/p2/"), json={"sources": [source]})).status_code == 422
