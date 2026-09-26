"""项目列表排序回归测试。

对应本轮修复（项目列表排序不符合使用习惯）：

1. 后端默认按 `created_at` **倒序**返回 —— 最新创建的项目在最上面。
   以前默认是 `is_desc=False`（升序），最新项目被排到最后。
2. `ProjectRead` 必须下发 `created_at` / `updated_at`。
   以前响应里没有时间戳，前端只能拿 `stats.updated_at`（后端从不写入）兜底成
   `new Date().toISOString()`，于是列表上每个项目的时间都等于「打开页面那一刻」，
   本地排序也彻底失效。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import select

from app.api.utils import apply_order
from app.main import app
from app.models.studio import Project
from app.schemas.studio.projects import ProjectRead

PROJECT_ORDER_FIELDS = {"name", "created_at", "updated_at", "progress"}


def test_list_projects_defaults_to_desc_order() -> None:
    """`GET /studio/projects` 的 `is_desc` 参数默认必须是 True（最新在最上面）。"""
    spec = app.openapi()
    params = spec["paths"]["/api/v1/studio/projects"]["get"]["parameters"]
    is_desc = next(p for p in params if p["name"] == "is_desc")
    assert is_desc["schema"]["default"] is True


def test_project_read_exposes_timestamps() -> None:
    """响应模型必须带 created_at / updated_at，前端才能按真实时间排序与展示。"""
    fields = set(ProjectRead.model_fields)
    assert "created_at" in fields
    assert "updated_at" in fields

    now = datetime(2026, 9, 19, 15, 2, 58, tzinfo=UTC)
    row = Project(
        id="proj-1",
        name="项目",
        description="",
        style="真人都市",
        visual_style="现实",
        seed=0,
        unify_style=True,
        progress=0,
        stats={},
    )
    row.created_at = now
    row.updated_at = now

    payload = ProjectRead.model_validate(row).model_dump()
    assert payload["created_at"] == now
    assert payload["updated_at"] == now


def test_apply_order_desc_sorts_by_created_at() -> None:
    """is_desc=True 时生成的 SQL 必须是 `ORDER BY projects.created_at DESC`。"""
    stmt = apply_order(
        select(Project),
        model=Project,
        order=None,
        is_desc=True,
        allow_fields=PROJECT_ORDER_FIELDS,
        default="created_at",
    )
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "ORDER BY projects.created_at DESC" in sql


def test_apply_order_asc_when_asked() -> None:
    """显式 is_desc=False 时仍然要能升序（老行为没有被删掉，只是默认值改了）。"""
    stmt = apply_order(
        select(Project),
        model=Project,
        order=None,
        is_desc=False,
        allow_fields=PROJECT_ORDER_FIELDS,
        default="created_at",
    )
    sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
    assert "ORDER BY projects.created_at ASC" in sql
