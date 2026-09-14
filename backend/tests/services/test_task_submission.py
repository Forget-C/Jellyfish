"""新提交链使用唯一任务入口，并保持媒体关系的业务语义。"""

import pytest
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.contracts.generation import GenerationCommand, ResolvedGenerationSnapshot
from app.models.experiment_sessions import ExperimentSession
from app.models.llm import Model, Provider
from app.models.studio_prompts_files_timeline import FileItem
from app.models.task import Task, TaskInput
from app.services.generation.gate import GenerationEntityGate
from app.services.generation.submission.submitter import GenerationSubmitter
from app.services.generation.task_snapshot import restore_snapshot, split_snapshot


@pytest.mark.asyncio
async def test_media_submission_records_project_for_history_filter():
    """视频提交从镜头解析项目，历史项目筛选无需再次猜测业务关联。"""
    from app.models.studio import Project, Chapter, Shot
    from app.services.task_queries import TaskQueries

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            db.add(Provider(id="provider", name="Vidu", base_url="https://example.invalid", api_key="test"))
            db.add(Project(id="p", name="project", style="realistic"))
            await db.flush()
            db.add(Model(id="model", name="viduq2", category="video", provider_id="provider"))
            db.add(Chapter(id="c", project_id="p", index=1, title="chapter"))
            await db.flush()
            db.add(Shot(id="s", chapter_id="c", index=1, title="shot"))
            await db.flush()
            command = GenerationCommand.model_validate({
                "modality": "video", "operation": "video_generation", "delivery": "async_polling",
                "target": {"kind": "shot_video", "entity_id": "s"},
                "request": {"model_id": "model", "execution_prompt": "test",
                            "operation_input": {"kind": "video_generation", "ratio": "16:9"}},
            })
            accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, command)
            await db.commit()
            task = await db.get(Task, accepted.task_id)
            assert task.project_id == "p"
            page = await TaskQueries(db).list(project_id="p")
            assert [item.task_id for item in page.items] == [task.id]
            assert page.items[0].source.id == "s"
            assert not (await TaskQueries(db).list(project_id="other")).items
    finally:
        await engine.dispose()


@pytest.mark.asyncio
@pytest.mark.parametrize("provider_name,mode", [("OpenAI", "direct"), ("Vidu", "remote")])
async def test_image_submission_accepts_direct_and_remote_providers(provider_name, mode, monkeypatch):
    """无需恢复能力也可提交；快照只保存一份输入且不包含供应商凭据。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            db.add(Provider(id="provider", name=provider_name, base_url="https://example.invalid", api_key="test-secret"))
            db.add(ExperimentSession(id="session", lab_type="image"))
            db.add(FileItem(id="input", type="image", name="reference", storage_key="input.png"))
            await db.flush()
            db.add(Model(id="model", name="test-model", category="image", provider_id="provider"))
            await db.flush()
            command = GenerationCommand.model_validate({
                "modality": "image", "operation": "image_generation", "delivery": "async_polling",
                "target": {"kind": "experiment_session", "entity_id": "session"},
                "request": {"model_id": "model", "execution_prompt": "test",
                            "operation_input": {"kind": "image_generation"},
                            "media": {"references": [{"file_id": "input", "media_kind": "image", "ordinal": 2}]}},
            })
            reference_file = await db.get(FileItem, "input")
            reference_file.type = "video"
            await db.flush()
            with pytest.raises(HTTPException):
                await GenerationEntityGate().validate(db, command)
            reference_file.type = "image"
            await db.flush()
            missing = command.model_copy(deep=True)
            missing.request.media.references[0].file_id = "missing"
            with pytest.raises(HTTPException):
                await GenerationEntityGate().validate(db, missing)
            accepted = await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, command)
            await db.commit()
            task = await db.get(Task, accepted.task_id)
            assert task.status == "queued"
            assert task.execution_mode == mode
            assert task.provider_id == "provider"
            assert "test-secret" not in str(task.input_snapshot)
            assert "media" not in task.input_snapshot
            assert "command" not in task.input_snapshot
            rows = (await db.execute(select(TaskInput, FileItem).join(FileItem, FileItem.id == TaskInput.file_id))).all()
            restored = restore_snapshot(task, rows)
            assert restored.media == command.request.media
            assert restored.canonical_target == command.target
            session = await db.get(ExperimentSession, "session")
            session.lab_type = "video"
            with pytest.raises(HTTPException) as error:
                await GenerationSubmitter(entity_gate=GenerationEntityGate()).submit_async(db, command)
            assert error.value.detail == "experiment_session_type_invalid"
        from app.services.generation.media_execution import load_media_context, build_media_input
        async with sessions() as execution_db:
            task = await execution_db.get(Task, accepted.task_id)
            _, snapshot, files = await load_media_context(execution_db, task)
        async def download(*, key):
            """只有执行期下载参考图，而且数据库事务已释放。"""
            assert not execution_db.in_transaction()
            assert key == "input.png"
            return b"png-bytes"
        monkeypatch.setattr("app.core.storage.download_file", download)
        input_ = await build_media_input(task, snapshot, files)
        assert input_.prompt == "test" and input_.model == "test-model"
        assert input_.images[0].image_url == "data:image/png;base64,cG5nLWJ5dGVz"
        assert input_.images[0].file_id is None
        assert "data:image" not in str(task.input_snapshot)
    finally:
        await engine.dispose()


def test_grouped_media_and_asset_identity_round_trip():
    """主体名中的点不影响分组，槽位数值重复也不会混淆资产类别。"""
    snapshot = ResolvedGenerationSnapshot.model_validate({
        "model_id": "model", "canonical_target": {"kind": "asset_image_slot", "asset_type": "character",
                                                  "entity_id": "character-1", "slot_id": "5"},
        "expected_version_id": 3, "execution_prompt": "test", "operation_input": {"kind": "video_generation", "ratio": "16:9"},
        "media": {"frames": {"first": {"file_id": "image", "media_kind": "image"}},
                  "subjects": [{"name": "a.b", "media": [{"file_id": "video", "media_kind": "video", "ordinal": 4}]}]},
    })
    data, target_type, target_id, references = split_snapshot(snapshot)
    assert target_type == "character_image_slot"
    task = Task(id="task", input_snapshot=data, target_type=target_type, target_id=target_id, expected_target_version=3)
    files = {key: FileItem(id=key, type=key) for key in ("image", "video")}
    rows = [(TaskInput(task_id="task", role_path=role, ordinal=ordinal, file_id=file_id), files[file_id])
            for role, ordinal, file_id in references]
    assert restore_snapshot(task, rows) == snapshot


@pytest.mark.asyncio
async def test_script_submission_reuses_active_task_and_keeps_single_input():
    """脚本活动任务查询使用主表；终态之后创建新任务且保留历史。"""
    from app.models.llm import ModelSettings
    from app.services.script_processing_tasks import create_script_simplification_task
    from app.services.task_service import TaskService

    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            db.add(Provider(id="provider", name="OpenAI", base_url="https://example.invalid", api_key="test-secret"))
            await db.flush()
            db.add(Model(id="text-model", name="text-model", category="text", provider_id="provider"))
            await db.flush()
            db.add(ModelSettings(id=1, default_text_model_id="text-model"))
            await db.flush()
            first = await create_script_simplification_task(db, relation_entity_id="source", script_text="original")
            repeated = await create_script_simplification_task(db, relation_entity_id="source", script_text="changed")
            assert repeated.reused and repeated.task_id == first.task_id
            task = await db.get(Task, first.task_id)
            assert task.input_snapshot["run_args"] == {"script_text": "original"}
            assert "command" not in task.input_snapshot
            assert "snapshot" not in task.input_snapshot
            await TaskService(db).request_cancel(task.id)
            second = await create_script_simplification_task(db, relation_entity_id="source", script_text="changed")
            await db.commit()
            assert not second.reused and second.task_id != first.task_id
            assert (await db.get(Task, first.task_id)).status == "cancelled"
    finally:
        await engine.dispose()
