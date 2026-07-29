from __future__ import annotations

import json
from dataclasses import dataclass

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.task_manager import DeliveryMode, SqlAlchemyTaskStore, TaskManager
from app.core.task_manager.types import TaskStatus
from app.models.task import GenerationTask, GenerationTaskStatus
from app.models.generation_artifacts import GenerationDispatchOutbox
from app.models.task_links import GenerationTaskLink

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
_ACTIVE_TASK_STATUSES = (
    GenerationTaskStatus.pending,
    GenerationTaskStatus.running,
    GenerationTaskStatus.streaming,
)


class _CreateOnlyTask:
    """仅用于 TaskManager.create，避免为异步任务额外声明无意义 task 类。"""

    async def run(self, *args: object, **kwargs: object):
        return None

    async def status(self) -> dict[str, object]:
        return {}

    async def is_done(self) -> bool:
        return False

    async def get_result(self) -> object:
        return None


@dataclass(slots=True)
class AsyncTaskCreateResult:
    task_id: str
    status: TaskStatus
    reused: bool
    relation_type: str
    relation_entity_id: str


def _build_script_command(
    *,
    relation_entity_id: str,
    operation: str,
    source_text: str,
) -> dict[str, object]:
    """构造剧本 Agent 的统一命令，避免 Worker 从路由语义反推执行意图。"""

    return {
        "modality": "text",
        "operation": "text_agent",
        "delivery": "async_polling",
        "target": {
            "kind": "script_processing",
            "entity_id": relation_entity_id,
        },
        "request": {
            "operation_input": {
                "kind": "script_operation",
                "operation": operation,
                "source_text": source_text,
            },
        },
    }


async def _create_script_task(
    db: AsyncSession,
    *,
    task_kind: str,
    relation_type: str,
    relation_entity_id: str,
    operation: str,
    source_text: str,
    run_args: dict[str, object],
) -> AsyncTaskCreateResult:
    """创建剧本处理任务并冻结 command/snapshot，防止执行期重新推断请求语义。"""

    store = SqlAlchemyTaskStore(db)
    tm = TaskManager(store=store, strategies={})
    task_record = await tm.create(
        task=_CreateOnlyTask(),
        mode=DeliveryMode.async_polling,
        task_kind=task_kind,
        run_args=run_args,
    )
    task = await db.get(GenerationTask, task_record.id)
    if task is None:  # pragma: no cover - TaskManager.create 已在同一事务 flush
        raise RuntimeError(f"script task not found after creation: {task_record.id}")
    task.payload = {
        **dict(task.payload or {}),
        "command": _build_script_command(
            relation_entity_id=relation_entity_id,
            operation=operation,
            source_text=source_text,
        ),
        "snapshot": {
            "operation": operation,
            "run_args": run_args,
        },
    }
    db.add(
        GenerationTaskLink(
            task_id=task_record.id,
            resource_type="text",
            relation_type=relation_type,
            relation_entity_id=relation_entity_id,
        )
    )
    # 任务、关联与投递记录由调用方在同一事务提交；dispatcher 负责随后可靠投递。
    db.add(GenerationDispatchOutbox(task_id=task_record.id, payload={"task_id": task_record.id}))
    await db.flush()
    return AsyncTaskCreateResult(
        task_id=task_record.id,
        status=task_record.status,
        reused=False,
        relation_type=relation_type,
        relation_entity_id=relation_entity_id,
    )


async def find_active_divide_task(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> GenerationTask | None:
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
) -> GenerationTask | None:
    """按业务关联查询任意活动任务。

    这里的目标只是“是否已有运行中的同类任务”，不需要挑出“最新”那一条。
    因此直接从 relation link 侧过滤，再按活动状态做一次连接，并去掉排序，
    避免在任务量大时触发 MySQL 的大排序与 sort buffer 压力。
    """
    stmt = (
        select(GenerationTask)
        .join(GenerationTaskLink, GenerationTaskLink.task_id == GenerationTask.id)
        .where(
            GenerationTaskLink.relation_type == relation_type,
            GenerationTaskLink.relation_entity_id == relation_entity_id,
            GenerationTask.status.in_(_ACTIVE_TASK_STATUSES),
        )
        .limit(1)
    )
    return (await db.execute(stmt)).scalars().first()


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
        operation="divide",
        source_text=script_text,
        run_args=run_args,
    )


async def find_active_extract_task(
    db: AsyncSession,
    *,
    chapter_id: str,
) -> GenerationTask | None:
    return await _find_active_task(
        db,
        relation_type=SCRIPT_EXTRACTION_RELATION_TYPE,
        relation_entity_id=chapter_id,
    )


async def find_active_merge_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
) -> GenerationTask | None:
    return await _find_active_task(
        db,
        relation_type=ENTITY_MERGE_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
    )


async def find_active_consistency_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
) -> GenerationTask | None:
    return await _find_active_task(
        db,
        relation_type=CONSISTENCY_CHECK_RELATION_TYPE,
        relation_entity_id=relation_entity_id,
    )


async def find_active_variant_task(
    db: AsyncSession,
    *,
    relation_entity_id: str,
) -> GenerationTask | None:
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
) -> GenerationTask | None:
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
    refresh_cache: bool,
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
        "refresh_cache": refresh_cache,
    }
    return await _create_script_task(
        db,
        task_kind=SCRIPT_EXTRACT_TASK_KIND,
        relation_type=SCRIPT_EXTRACTION_RELATION_TYPE,
        relation_entity_id=chapter_id,
        operation="extract",
        source_text=json.dumps(script_division, ensure_ascii=False),
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
        operation="merge-entities",
        source_text=json.dumps(all_shot_extractions, ensure_ascii=False),
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
        operation="check-consistency",
        source_text=script_text,
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
        operation="analyze-variants",
        source_text=json.dumps(merged_library, ensure_ascii=False),
        run_args=run_args,
    )


async def _create_analysis_task(
    db: AsyncSession,
    *,
    task_kind: str,
    relation_type: str,
    relation_entity_id: str,
    operation: str,
    source_text: str,
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
        operation=operation,
        source_text=source_text,
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
        operation="analyze-character-portrait",
        source_text=character_description,
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
        operation="analyze-prop-info",
        source_text=prop_description,
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
        operation="analyze-scene-info",
        source_text=scene_description,
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
        operation="analyze-costume-info",
        source_text=costume_description,
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
        operation="optimize-script",
        source_text=script_text,
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
        operation="simplify-script",
        source_text=script_text,
        run_args={
            "script_text": script_text,
        },
    )
