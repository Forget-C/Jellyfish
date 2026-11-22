"""全部脚本提交入口的冻结输入、活动复用和历史保留测试。"""

import pytest
from hashlib import sha256
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.core.db import Base
from app.models.llm import Model, ModelSettings, Provider
from app.models.studio import Chapter, Project
from app.models.task import Task
from app.services import script_processing_tasks as submission
from app.services.task_service import TaskService


@pytest.mark.asyncio
@pytest.mark.parametrize("name,args,relation", [
    ('create_consistency_task', {'relation_entity_id': 'chapter-1', 'script_text': '完整剧本'}, submission.CONSISTENCY_CHECK_RELATION_TYPE),
    ('create_character_portrait_task', {'relation_entity_id': 'chapter-1', 'character_context': None, 'character_description': '人物描述'}, submission.CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE),
    ('create_prop_info_task', {'relation_entity_id': 'chapter-1', 'prop_context': None, 'prop_description': '道具描述'}, submission.PROP_INFO_ANALYSIS_RELATION_TYPE),
    ('create_scene_info_task', {'relation_entity_id': 'chapter-1', 'scene_context': None, 'scene_description': '场景描述'}, submission.SCENE_INFO_ANALYSIS_RELATION_TYPE),
    ('create_costume_info_task', {'relation_entity_id': 'chapter-1', 'costume_context': None, 'costume_description': '服装描述'}, submission.COSTUME_INFO_ANALYSIS_RELATION_TYPE),
    ('create_script_optimization_task', {'relation_entity_id': 'chapter-1', 'script_text': '原始剧本', 'consistency': {'check_scope': 'source_consistency', 'policy_version': 2, 'review_version': sha256(b'[]').hexdigest(), 'explanation_version': sha256(b'[]').hexdigest(), 'source_version': sha256('原始剧本'.encode()).hexdigest(), 'issues': [{'excerpt': '原始剧本', 'resolution': 'repair'}]}}, submission.SCRIPT_OPTIMIZATION_RELATION_TYPE),
    ('create_script_simplification_task', {'relation_entity_id': 'chapter-1', 'script_text': '原始剧本'}, submission.SCRIPT_SIMPLIFICATION_RELATION_TYPE)
])
async def test_script_submission_keeps_single_input_and_reuses_only_active_task(name, args, relation):
    """每类脚本入口保存一份输入，活动任务复用，终态后新建并保留原记录。"""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    try:
        async with sessions() as db:
            db.add(Provider(id="provider", provider_key='openai', name="OpenAI", api_key="test-secret", base_url="https://example.invalid"))
            db.add(Project(id="project-1", name="project", style="guoman", visual_style="anime"))
            await db.flush()
            db.add(Chapter(id="chapter-1", project_id="project-1", index=1, title="chapter"))
            db.add(Model(id="model", provider_id="provider", name="frozen-model", category="text"))
            await db.flush()
            db.add(ModelSettings(id=1, default_text_model_id="model"))
            await db.flush()
            create = getattr(submission, name)
            first = await create(db, **args)
            task = await db.get(Task, first.task_id)
            assert not first.reused and first.status == "queued"
            assert task.target_type == relation and task.target_id == "chapter-1"
            assert task.project_id == "project-1" and task.provider_id == "provider"
            assert task.input_snapshot["model_name"] == "frozen-model"
            assert task.input_snapshot["run_args"] == {key: value for key, value in args.items() if key != "relation_entity_id"}
            assert "test-secret" not in str(task.input_snapshot)
            assert "command" not in task.input_snapshot and "snapshot" not in task.input_snapshot
            assert (await create(db, **args)).task_id == first.task_id
            await TaskService(db).claim(task.id, worker_id="worker")
            repeated = await create(db, **args)
            assert repeated.reused and repeated.task_id == first.task_id
            await TaskService(db).request_cancel(task.id)
            await TaskService(db).finish(task.id, cancelled=True)
            second = await create(db, **args)
            await db.commit()
            assert not second.reused and second.task_id != first.task_id
            assert (await db.get(Task, first.task_id)).status == "cancelled"
    finally:
        await engine.dispose()




def test_pick_consistency_relation_entity_id_prefers_chapter() -> None:
    assert submission.pick_consistency_relation_entity_id(chapter_id="chapter-1", project_id="project-1") == "chapter-1"
    assert submission.pick_consistency_relation_entity_id(chapter_id=None, project_id="project-1") == "project-1"




def test_pick_analysis_relation_entity_id_prefers_chapter() -> None:
    assert submission.pick_analysis_relation_entity_id(chapter_id="chapter-1", project_id="project-1", endpoint="x") == "chapter-1"
    assert submission.pick_analysis_relation_entity_id(chapter_id=None, project_id="project-1", endpoint="x") == "project-1"
