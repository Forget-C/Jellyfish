from __future__ import annotations

from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.task import TaskStatus
from app.models.task import Task
from app.models.llm import Model, ModelSettings, ModelCategoryKey, Provider
from app.models.studio_projects import Chapter, Project
from app.services.llm.provider_resolver import resolve_provider_config_from_provider
from app.services.task_service import TaskService

CHAPTER_DIVISION_RELATION_TYPE = "chapter_division"
SCRIPT_EXTRACTION_RELATION_TYPE = "script_extraction"
ENTITY_MERGE_RELATION_TYPE = "entity_merge"  # 预备能力：当前无真实前端入口
CONSISTENCY_CHECK_RELATION_TYPE = "consistency_check"
VARIANT_ANALYSIS_RELATION_TYPE = "variant_analysis"  # 预备能力：当前无真实前端入口
CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE = "character_portrait_analysis"
PROP_INFO_ANALYSIS_RELATION_TYPE = "prop_info_analysis"
SCENE_INFO_ANALYSIS_RELATION_TYPE = "scene_info_analysis"
COSTUME_INFO_ANALYSIS_RELATION_TYPE = "costume_info_analysis"
SCRIPT_OPTIMIZATION_RELATION_TYPE = "script_optimization"
SCRIPT_SIMPLIFICATION_RELATION_TYPE = "script_simplification"
SCRIPT_DIVIDE_TASK_KIND = "script_divide"
SCRIPT_EXTRACT_TASK_KIND = "script_extract"
SCRIPT_MERGE_TASK_KIND = "script_merge"
SCRIPT_CONSISTENCY_TASK_KIND = "script_consistency"
SCRIPT_VARIANT_TASK_KIND = "script_variant"
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


async def find_active_divide_task(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> Task | None:
    return await _find_active_task(
        db,
        relation_type=CHAPTER_DIVISION_RELATION_TYPE,
        relation_entity_id=chapter_id,
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


async def create_divide_task(
    db: AsyncSession,
    *,
    chapter_id: str,
    script_text: str,
    write_to_db: bool,
) -> AsyncTaskCreateResult:
    existing = await find_active_divide_task(db, chapter_id=chapter_id)
    if existing is not None:
        status_value = existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        return AsyncTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=CHAPTER_DIVISION_RELATION_TYPE,
            relation_entity_id=chapter_id,
        )

    run_args = {
        "chapter_id": chapter_id,
        "script_text": script_text,
        "write_to_db": write_to_db,
    }
    return await _create_script_task(
        db,
        task_kind=SCRIPT_DIVIDE_TASK_KIND,
        relation_type=CHAPTER_DIVISION_RELATION_TYPE,
        relation_entity_id=chapter_id,
        run_args=run_args,
    )


async def find_active_extract_task(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> Task | None:
    return await _find_active_task(
        db,
        relation_type=SCRIPT_EXTRACTION_RELATION_TYPE,
        relation_entity_id=chapter_id,
    )


async def find_active_merge_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
) -> Task | None:
    return await _find_active_task(
        db,
        relation_type=ENTITY_MERGE_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
    )


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


async def find_active_variant_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
) -> Task | None:
    return await _find_active_task(
        db,
        relation_type=VARIANT_ANALYSIS_RELATION_TYPE,
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


def pick_merge_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
    relation_entity_id = (chapter_id or "").strip() or (project_id or "").strip()
    if not relation_entity_id:
        raise HTTPException(status_code=400, detail="chapter_id or project_id is required for merge-entities-async")
    return relation_entity_id


def pick_consistency_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
    relation_entity_id = (chapter_id or "").strip() or (project_id or "").strip()
    if not relation_entity_id:
        raise HTTPException(status_code=400, detail="chapter_id or project_id is required for check-consistency-async")
    return relation_entity_id


def pick_variant_relation_entity_id(*, chapter_id: str | None, project_id: str | None) -> str:
    relation_entity_id = (chapter_id or "").strip() or (project_id or "").strip()
    if not relation_entity_id:
        raise HTTPException(status_code=400, detail="chapter_id or project_id is required for analyze-variants-async")
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


async def create_extract_task(
    db: AsyncSession,
    *,
    project_id: str,
    chapter_id: str,
    script_division: dict,
    consistency: dict | None,
) -> AsyncTaskCreateResult:
    existing = await find_active_extract_task(db, chapter_id=chapter_id)
    if existing is not None:
        status_value = existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        return AsyncTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=SCRIPT_EXTRACTION_RELATION_TYPE,
            relation_entity_id=chapter_id,
        )

    run_args = {
        "project_id": project_id,
        "chapter_id": chapter_id,
        "script_division": script_division,
        "consistency": consistency,
    }
    return await _create_script_task(
        db,
        task_kind=SCRIPT_EXTRACT_TASK_KIND,
        relation_type=SCRIPT_EXTRACTION_RELATION_TYPE,
        relation_entity_id=chapter_id,
        run_args=run_args,
    )


async def create_merge_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    all_shot_extractions: list[dict],
    historical_library: dict | None,
    script_division: dict | None,
    previous_merge: dict | None,
    conflict_resolutions: list[dict] | None,
) -> AsyncTaskCreateResult:
    existing = await find_active_merge_task(db, relation_entity_id=relation_entity_id)
    if existing is not None:
        status_value = existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        return AsyncTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=ENTITY_MERGE_RELATION_TYPE,
            relation_entity_id=relation_entity_id,
        )

    run_args = {
        "all_shot_extractions": all_shot_extractions,
        "historical_library": historical_library,
        "script_division": script_division,
        "previous_merge": previous_merge,
        "conflict_resolutions": conflict_resolutions,
    }
    return await _create_script_task(
        db,
        task_kind=SCRIPT_MERGE_TASK_KIND,
        relation_type=ENTITY_MERGE_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args=run_args,
    )


async def create_consistency_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    script_text: str,
) -> AsyncTaskCreateResult:
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
        run_args={"script_text": script_text},
    )


async def create_variant_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
    merged_library: dict,
    all_shot_extractions: list[dict],
    script_division: dict | None,
) -> AsyncTaskCreateResult:
    existing = await find_active_variant_task(db, relation_entity_id=relation_entity_id)
    if existing is not None:
        status_value = existing.status.value if hasattr(existing.status, "value") else str(existing.status)
        return AsyncTaskCreateResult(
            task_id=existing.id,
            status=TaskStatus(status_value),
            reused=True,
            relation_type=VARIANT_ANALYSIS_RELATION_TYPE,
            relation_entity_id=relation_entity_id,
        )

    run_args = {
        "merged_library": merged_library,
        "all_shot_extractions": all_shot_extractions,
        "script_division": script_division,
    }
    return await _create_script_task(
        db,
        task_kind=SCRIPT_VARIANT_TASK_KIND,
        relation_type=VARIANT_ANALYSIS_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args=run_args,
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
) -> AsyncTaskCreateResult:
    return await _create_analysis_task(
        db,
        task_kind=SCRIPT_OPTIMIZE_TASK_KIND,
        relation_type=SCRIPT_OPTIMIZATION_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
        run_args={
            "script_text": script_text,
            "consistency": consistency,
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
