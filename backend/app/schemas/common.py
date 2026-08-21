"""API 全局响应结构与分页。"""

from __future__ import annotations

from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    """无分页时的统一响应结构。"""

    code: int = Field(200, description="与 HTTP 状态码一致")
    message: str = Field("success", description="提示信息")
    data: T | None = Field(None, description="实际数据")
    meta: dict[str, Any] | None = Field(None, description="附加元信息")

    def model_dump(
        self,
        *args: Any,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """始终序列化 meta 字段，保证响应壳结构稳定。"""
        kwargs["exclude_none"] = False
        dumped = super().model_dump(*args, **kwargs)
        if "meta" not in dumped:
            dumped["meta"] = None
        return dumped


class Pagination(BaseModel):
    """分页信息。"""

    page: int = Field(..., description="当前页，从 1 开始")
    page_size: int = Field(..., description="每页条数")
    total: int = Field(..., description="总条数")
    max_page: int = Field(..., description="最大页码")


class PaginatedData(BaseModel, Generic[T]):
    """有分页时的 data 结构。"""

    items: list[T] = Field(..., description="当前页数据")
    pagination: Pagination = Field(..., description="分页信息")


def success_response(
    data: T,
    *,
    code: int = 200,
    message: str = "success",
    meta: dict[str, Any] | None = None,
) -> ApiResponse[T]:
    """构造无分页的成功响应。"""
    return ApiResponse(code=code, message=message, data=data, meta=meta)


def created_response(
    data: T,
    *,
    message: str = "success",
    meta: dict[str, Any] | None = None,
) -> ApiResponse[T]:
    """构造创建成功响应。"""
    return success_response(data, code=201, message=message, meta=meta)


def empty_response(
    *,
    code: int = 200,
    message: str = "success",
    meta: dict[str, Any] | None = None,
) -> ApiResponse[None]:
    """构造 data 为 null 的成功响应。"""
    return ApiResponse(code=code, message=message, data=None, meta=meta)


def paginated_response(
    items: list[T],
    *,
    page: int,
    page_size: int,
    total: int,
    code: int = 200,
    message: str = "success",
    meta: dict[str, Any] | None = None,
) -> ApiResponse[PaginatedData[T]]:
    """构造有分页的成功响应。"""
    max_page = max(1, (total + page_size - 1) // page_size) if page_size > 0 else 1
    pagination = Pagination(
        page=page,
        page_size=page_size,
        total=total,
        max_page=max_page,
    )
    payload = PaginatedData(items=items, pagination=pagination)
    return ApiResponse(code=code, message=message, data=payload, meta=meta)


def error_response(
    *,
    code: int = 500,
    message: str = "error",
) -> ApiResponse[None]:
    """构造错误响应（data 为 null）。"""
    return ApiResponse(code=code, message=message, data=None)
