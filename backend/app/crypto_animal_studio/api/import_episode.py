"""CAS EpisodePackage 导入端点（薄路由）。

职责仅限：收参、依赖注入、调用 application 层导入服务、把领域异常翻译为 HTTP、
用统一 ``ApiResponse`` 壳返回。业务逻辑全在 application 层。

事务：复用 ``get_db`` 请求级会话（单事务、成功提交一次、异常回滚）。
导入服务只 flush；dry-run 在服务内部 rollback，故不写库。
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.crypto_animal_studio.application.import_episode import (
    CasValidationError,
    EpisodeAlreadyImportedError,
    IdempotencyConflictError,
    ProjectNotFoundError,
    import_episode,
)
from app.crypto_animal_studio.application.import_result import ImportResult
from app.crypto_animal_studio.application.import_tasks import (
    CAS_IMPORT_EPISODE_TASK_KIND,
    create_cas_import_task,
)
from app.crypto_animal_studio.schemas.import_request import (
    CasImportTaskAccepted,
    ImportEpisodeRequest,
)
from app.dependencies import get_db
from app.schemas.common import ApiResponse, success_response

router = APIRouter()


@router.post("/import", response_model=ApiResponse[ImportResult])
async def import_episode_endpoint(
    body: ImportEpisodeRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[ImportResult]:
    """导入一个 EpisodePackage 为一个 Jellyfish Chapter（含 Shots 等）。

    返回：统一 ``ApiResponse``，data 为 ImportResult。
    错误：项目不存在→404；幂等冲突/重复导入→409；契约校验失败→422（由 pydantic）；
    CAS QA 闸门失败→422（零写入）。
    """
    try:
        result = await import_episode(
            db,
            project_id=body.project_id,
            package=body.episode_package,
            idempotency_key=body.idempotency_key,
            dry_run=body.dry_run,
        )
    except ProjectNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except (IdempotencyConflictError, EpisodeAlreadyImportedError) as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except CasValidationError as exc:
        # 与 pydantic 契约校验一致用 422：两者都表示「文档不可接受」，且都零写入。
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc
    return success_response(data=result)


@router.post("/import/async", response_model=ApiResponse[CasImportTaskAccepted])
async def import_episode_async_endpoint(
    body: ImportEpisodeRequest,
    db: AsyncSession = Depends(get_db),
) -> ApiResponse[CasImportTaskAccepted]:
    """把导入登记为任务中心的 ``cas_import_episode_package`` 任务并立即返回。

    请求体与同步端点完全一致（同一个 ``ImportEpisodeRequest``），因此契约校验行为不变。
    真正的导入由 ``run_cas_import_task`` 驱动，成功/失败通过既有任务状态查询接口获取。

    返回：统一 ``ApiResponse``，data 为任务受理信息（``reused=true`` 表示复用活动任务）。
    """
    created = await create_cas_import_task(
        db,
        project_id=body.project_id,
        # 以 JSON 模式导出：run_args 需要可序列化，且不改变契约本身。
        episode_package=body.episode_package.model_dump(mode="json"),
        idempotency_key=body.idempotency_key,
        dry_run=body.dry_run,
    )
    if not created.reused:
        # 与既有异步生成任务同一入队机制（Celery task.execute + task_kind registry）。
        # 延迟导入：避免 api → tasks → services → api 的导入环，与 script 任务写法一致。
        from app.tasks.execute_task import enqueue_task_execution

        # 任务行必须先可见，worker 才能按 task_id 取到它。
        await db.commit()
        enqueue_task_execution(created.task_id)
    return success_response(
        data=CasImportTaskAccepted(
            task_id=created.task_id,
            status=created.status.value,
            reused=created.reused,
            task_kind=CAS_IMPORT_EPISODE_TASK_KIND,
            relation_type=created.relation_type,
            relation_entity_id=created.relation_entity_id,
        )
    )
