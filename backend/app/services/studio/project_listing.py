"""全量查询项目，先应用制作阶段和排序，再分页。"""

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.utils import apply_order, normalize_q, paginate
from app.models.studio import Chapter, Project

PROJECT_ORDER_FIELDS = {"name", "created_at", "updated_at", "progress"}
# 与项目卡片的 String.trim() 一致，覆盖制表符、换行和全角空格。
_BLANK_SOURCE = "^[\u0009-\u000d\u0020\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]*$"


async def list_project_page(
    db: AsyncSession,
    *,
    q: str | None,
    order: str | None,
    is_desc: bool,
    missing_source: bool,
    page: int,
    page_size: int,
) -> tuple[list[Project], int]:
    """筛选并稳定排序后返回一页项目及匹配总数。"""
    stmt = select(Project)
    if keyword := normalize_q(q):
        stmt = stmt.where(or_(
            Project.name.icontains(keyword, autoescape=True),
            Project.description.icontains(keyword, autoescape=True),
        ))
    project_chapters = select(Chapter.id).where(Chapter.project_id == Project.id)
    if missing_source:
        stmt = stmt.where(or_(
            ~project_chapters.exists(),
            project_chapters.where(Chapter.raw_text.regexp_match(_BLANK_SOURCE)).exists(),
        ))
    if order == "chapter_count":
        chapter_count = project_chapters.with_only_columns(func.count(Chapter.id)).scalar_subquery()
        stmt = stmt.order_by(chapter_count.desc() if is_desc else chapter_count.asc())
    else:
        stmt = apply_order(stmt, model=Project, order=order, is_desc=is_desc,
                           allow_fields=PROJECT_ORDER_FIELDS, default="created_at")
    return await paginate(db, stmt=stmt.order_by(Project.id), page=page, page_size=page_size)
