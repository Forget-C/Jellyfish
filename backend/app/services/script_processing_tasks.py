from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.schemas.source_explanations import SOURCE_POLICY_VERSION
from app.services.chapters.explanations import source_version, validate_explanations
import json
from app.core.contracts.task import TaskStatus
from app.models.task import Task
from app.models.llm import Model, ModelSettings, ModelCategoryKey, Provider
from app.models.studio_projects import Chapter, Project
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.task_service import TaskService

CONSISTENCY_CHECK_RELATION_TYPE = "consistency_check"
CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE = "character_portrait_analysis"
PROP_INFO_ANALYSIS_RELATION_TYPE = "prop_info_analysis"
SCENE_INFO_ANALYSIS_RELATION_TYPE = "scene_info_analysis"
COSTUME_INFO_ANALYSIS_RELATION_TYPE = "costume_info_analysis"
SCRIPT_OPTIMIZATION_RELATION_TYPE = "script_optimization"
SCRIPT_SIMPLIFICATION_RELATION_TYPE = "script_simplification"
SCRIPT_CONSISTENCY_TASK_KIND = "script_consistency"
SCRIPT_CHARACTER_PORTRAIT_TASK_KIND = "script_character_portrait"
SCRIPT_PROP_INFO_TASK_KIND = "script_prop_info"
SCRIPT_SCENE_INFO_TASK_KIND = "script_scene_info"
SCRIPT_COSTUME_INFO_TASK_KIND = "script_costume_info"
SCRIPT_OPTIMIZE_TASK_KIND = "script_optimize"
SCRIPT_SIMPLIFY_TASK_KIND = "script_simplify"
_ACTIVE_TASK_STATUSES = (TaskStatus.queued, TaskStatus.running)


@dataclass(slots=True)
class AsyncTaskCreateResult:
    task_id: str
    status: TaskStatus
    reused: bool
    relation_type: str
    relation_entity_id: str


async def _create_script_task(
    db: AsyncSession, *, task_kind: str, relation_type: str,
    relation_entity_id: str, run_args: dict[str, object],
) -> AsyncTaskCreateResult:
    """通过统一入口保存一份脚本输入，不创建重复命令、任务关联或投递记录。"""
    settings = await db.get(ModelSettings, 1)
    model = await db.get(Model, settings.default_text_model_id) if settings and settings.default_text_model_id else None
    if model is None or model.category != ModelCategoryKey.text:
        raise HTTPException(status_code=400, detail="model_unavailable")
    provider = await db.get(Provider, model.provider_id)
    if provider is None:
        raise HTTPException(status_code=400, detail="model_unavailable")
    config = resolve_provider_config_from_provider(provider=provider, category=ModelCategoryKey.text)
    project_id = run_args.get("project_id")
    if not project_id:
        chapter = await db.get(Chapter, relation_entity_id)
        if chapter is not None:
            project_id = chapter.project_id
        elif await db.get(Project, relation_entity_id) is not None:
            project_id = relation_entity_id
    task = await TaskService(db).submit(
        kind=task_kind, title=task_kind, target_type=relation_type, target_id=relation_entity_id,
        project_id=project_id, provider_id=provider.id,
        snapshot={"run_args": run_args, "model_id": model.id, "model_name": model.name,
                  "provider_key": config.provider_key},
    )
    return AsyncTaskCreateResult(
        task_id=task.id, status=TaskStatus(task.status), reused=False,
        relation_type=relation_type, relation_entity_id=relation_entity_id,
    )


async def _find_active_task(
    db: AsyncSession,
    *,
    relation_type: str,
    relation_entity_id: str,
) -> Task | None:
    """通过任务主表的业务目标查询活动任务，不再连接 TaskLink。"""
    return await db.scalar(select(Task).where(
        Task.target_type == relation_type, Task.target_id == relation_entity_id,
        Task.status.in_(_ACTIVE_TASK_STATUSES),
    ).limit(1))


async def find_active_consistency_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
) -> Task | None:
    return await _find_active_task(
        db,
        relation_type=CONSISTENCY_CHECK_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
    )


async def _find_active_analysis_task(
    db: AsyncSession,
    *,
    relation_type: str,
    relation_entity_id: str,
) -> Task | None:
    return await _find_active_task(
        db,
        relation_type=relation_type,
        relation_entity_id=relation_entity_id,
    )


def pick_consistency_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
    relation_entity_id = (chapter_id or "").strip() or (project_id or "").strip()
    if not relation_entity_id:
        raise HTTPException(status_code=400, detail="chapter_id or project_id is required for check-consistency-async")
    return relation_entity_id


def pick_analysis_relation_entity_id(
    *,
    relation_entity_id: str | None = None,
    chapter_id: str | None,
    project_id: str | None,
    endpoint: str,
) -> str:
    relation_entity_id = (relation_entity_id or "").strip() or (chapter_id or "").strip() or (project_id or "").strip()
    if not relation_entity_id:
        raise HTTPException(status_code=400, detail=f"relation_entity_id or chapter_id or project_id is required for {endpoint}")
    return relation_entity_id


async def create_consistency_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    script_text: str,
    source_explanations: list[dict] | None = None,
) -> AsyncTaskCreateResult:
    validate_explanations(source_explanations or [], script_text)
    existing = await find_active_consistency_task(db, relation_entity_id=relation_entity_id)
    if existing is not None:
        status_value = existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        return AsyncTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=CONSISTENCY_CHECK_RELATION_TYPE,
            relation_entity_id=relation_entity_id,
        )

    return await _create_script_task(
        db,
        task_kind=SCRIPT_CONSISTENCY_TASK_KIND,
        relation_type=CONSISTENCY_CHECK_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={"script_text": script_text, **({"source_explanations": source_explanations} if source_explanations is not None else {})},
    )


async def _create_analysis_task(
    db: AsyncSession,
    *,
    task_kind: str,
    relation_type: str,
    relation_entity_id: str,
    run_args: dict,
) -> AsyncTaskCreateResult:
    existing = await _find_active_analysis_task(db, relation_type=relation_type, relation_entity_id=relation_entity_id)
    if existing is not None:
        status_value = existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        return AsyncTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=relation_type,
            relation_entity_id=relation_entity_id,
        )

    return await _create_script_task(
        db,
        task_kind=task_kind,
        relation_type=relation_type,
        relation_entity_id=relation_entity_id,
        run_args=run_args,
    )


async def create_character_portrait_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    character_context: str | None,
    character_description: str,
) -> AsyncTaskCreateResult:
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_CHARACTER_PORTRAIT_TASK_KIND,
        relation_type=CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "character_context": character_context,
            "character_description": character_description,
        },
    )


async def create_prop_info_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    prop_context: str | None,
    prop_description: str,
) -> AsyncTaskCreateResult:
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_PROP_INFO_TASK_KIND,
        relation_type=PROP_INFO_ANALYSIS_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "prop_context": prop_context,
            "prop_description": prop_description,
        },
    )


async def create_scene_info_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    scene_context: str | None,
    scene_description: str,
) -> AsyncTaskCreateResult:
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_SCENE_INFO_TASK_KIND,
        relation_type=SCENE_INFO_ANALYSIS_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "scene_context": scene_context,
            "scene_description": scene_description,
        },
    )


async def create_costume_info_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    costume_context: str | None,
    costume_description: str,
) -> AsyncTaskCreateResult:
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_COSTUME_INFO_TASK_KIND,
        relation_type=COSTUME_INFO_ANALYSIS_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "costume_context": costume_context,
            "costume_description": costume_description,
        },
    )


async def create_script_optimization_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    script_text: str,
    consistency: dict,
    source_explanations: list[dict] | None = None,
) -> AsyncTaskCreateResult:
    if consistency.get('check_scope') != 'source_consistency' or consistency.get('policy_version') != SOURCE_POLICY_VERSION:
        raise HTTPException(409, '旧版检查结果不能用于新修复，请重新检查')
    if consistency.get('source_version') != source_version(script_text):
        raise HTTPException(409, '检查依据已变化，请重新检查')
    validate_explanations(source_explanations or [], script_text)
    review_version = source_version(json.dumps(source_explanations or [], ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    if consistency.get('review_version') != review_version:
        raise HTTPException(409, '检查时的解释内容已变化，请重新检查')
    valid = [item for item in source_explanations or [] if item['source_version'] == source_version(script_text) and item.get('policy_version') == SOURCE_POLICY_VERSION]
    version = source_version(json.dumps(valid, ensure_ascii=False, sort_keys=True, separators=(',', ':')))
    if consistency.get('explanation_version') != version:
        raise HTTPException(409, '补充解释已变化，请重新检查')
    issues = consistency.get('issues') or []
    if not isinstance(issues, list) or not issues or any(not isinstance(item, dict) or item.get('target', 'source') != 'source' or item.get('resolution') != 'repair' or
                         (item.get('classification') == 'ambiguity' and not str(item.get('instruction', '')).strip()) for item in issues):
        raise HTTPException(422, '请先确认并选择需要修复的原文异常')
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_OPTIMIZE_TASK_KIND,
        relation_type=SCRIPT_OPTIMIZATION_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "script_text": script_text,
            "consistency": consistency,
            **({"source_explanations": valid} if source_explanations is not None else {}),
        },
    )


async def create_script_simplification_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    script_text: str,
) -> AsyncTaskCreateResult:
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_SIMPLIFY_TASK_KIND,
        relation_type=SCRIPT_SIMPLIFICATION_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "script_text": script_text,
        },
    )
