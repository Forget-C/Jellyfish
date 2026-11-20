"""管理页提示词摘要搜索。"""

import re

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import PromptTemplate
from app.schemas.studio.prompts import PromptTemplateSummary


async def search_template_summaries(
    db: AsyncSession, *, q: str, page: int, page_size: int,
) -> tuple[list[PromptTemplateSummary], int]:
    """匹配名称或简介，计数后只读取当前页的摘要字段。"""
    filters = []
    if keyword := q.strip():
        fields = (PromptTemplate.name, PromptTemplate.preview)
        if db.get_bind().dialect.name == "mysql":
            matches = [func.instr(col.collate("utf8mb4_0900_as_ci"), keyword) > 0 for col in fields]
        else:
            # SQLite 的 lower 只支持 ASCII；SQLAlchemy 的 REGEXP 支持 Unicode。
            pattern = "(?i)" + re.escape(keyword)
            matches = [col.regexp_match(pattern) for col in fields]
        filters.append(or_(*matches))

    total = await db.scalar(select(func.count()).select_from(PromptTemplate).where(*filters))
    stmt = select(PromptTemplate.id, PromptTemplate.category, PromptTemplate.name).where(*filters)
    rows = await db.execute(stmt.order_by(PromptTemplate.created_at, PromptTemplate.id)
                            .offset((page - 1) * page_size).limit(page_size))
    return [PromptTemplateSummary.model_validate(row) for row in rows.mappings()], total or 0
