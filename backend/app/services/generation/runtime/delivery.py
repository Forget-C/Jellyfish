"""将已归档 Artifact 交给目标 WorkflowHandler 的统一入口。"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.generation import GenerationOperation, ResolvedGenerationSnapshot
from app.services.generation.workflows import (
    GenerationWorkflowExecutionContext,
)
from app.services.generation.workflows.defaults import generation_workflow_registry


async def validate_workflow_execution(
    db: AsyncSession,
    *,
    task_id: str,
    operation: GenerationOperation,
    snapshot: ResolvedGenerationSnapshot,
) -> None:
    """在 Provider 调用前委托目标 Handler 复核任务仍可安全执行。"""
    handler = generation_workflow_registry.resolve(operation=operation, target_kind=snapshot.canonical_target.kind)
    await handler.validate_execution(
        GenerationWorkflowExecutionContext(task_id=task_id, data={"db": db, "snapshot": snapshot})
    )
