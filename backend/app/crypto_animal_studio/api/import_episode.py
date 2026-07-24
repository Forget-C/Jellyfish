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
    EpisodeAlreadyImportedError,
    IdempotencyConflictError,
    ProjectNotFoundError,
    import_episode,
)
from app.crypto_animal_studio.application.import_result import ImportResult
from app.crypto_animal_studio.schemas.import_request import ImportEpisodeRequest
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
    错误：项目不存在→404；幂等冲突/重复导入→409；契约校验失败→422（由 pydantic）。
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
    return success_response(data=result)
