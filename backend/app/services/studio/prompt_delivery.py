"""出口 A「任务交付 · 仅提示词」——取数与编排。

**交付文本的口径不在本文件**，在 ``prompt_delivery_text.py``（零第三方依赖，
可脱离 sqlalchemy/fastapi 独立自检）。本文件只负责一件事：
从 Jellyfish 的表结构里按范围取出镜头行，喂给纯函数。

数据源说明（与中控台的差异，详见 prompt_delivery_text.py 文件头）：
  - 中控台读 ``prompts`` 表；Jellyfish 读 ``shot_details.video_prompt`` /
    ``video_prompt_source``。迁移时已按原 ``source`` 忠实回填 126 条，两边逐条一致。
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.studio import Chapter, Shot, ShotDetail
from app.services.studio.bound_asset_files import (
    render_bound_file_lines,
    resolve_bound_files_for_shots,
)
from app.services.studio.prompt_delivery_text import (
    EXPORT_SOURCES,
    has_exportable_prompt,
    CHAPTER_RULE,
    EXPORT_SOURCE,
    JURILU_PROMPT_HEADER,
    JURILU_PROMPT_SOURCE,
    SCOPE_CURRENT_SHOT,
    SCOPE_EPISODE,
    SCOPE_EPISODES,
    SCOPE_LABELS,
    SHOT_RULE,
    build_jurilu_prompt_export_document,
    chapter_label,
    encode_txt_download,
    export_filename,
    has_jurilu_prompt,
    shot_code,
    shot_sort_key,
)

__all__ = [
    "JURILU_PROMPT_SOURCE",
    "JURILU_PROMPT_HEADER",
    "SHOT_RULE",
    "CHAPTER_RULE",
    "SCOPE_CURRENT_SHOT",
    "SCOPE_EPISODE",
    "SCOPE_EPISODES",
    "SCOPE_LABELS",
    "EXPORT_SOURCE",
    "chapter_label",
    "shot_code",
    "shot_sort_key",
    "has_jurilu_prompt",
    "has_exportable_prompt",
    "fetch_bound_asset_names",
    "resolve_bound_files_for_shots",
    "EXPORT_SOURCES",
    "build_jurilu_prompt_export_document",
    "encode_txt_download",
    "export_filename",
    "fetch_delivery_rows",
    "build_prompt_only_delivery",
]


async def fetch_delivery_rows(
    db: AsyncSession,
    *,
    project_id: str,
    chapter_id: str | None = None,
    shot_id: str | None = None,
    shot_ids: list[str] | None = None,
) -> list[dict[str, Any]]:
    """按范围取镜头行。

    范围与中控台三档一一对应（app.py:task_delivery_page:21322 行 21362-21383），
    另加一档「选中镜头」：
      - ``shot_id`` 给定 → 当前镜头
      - ``shot_ids`` 给定 → **选中的那些镜头**（工作室里勾选后导出/判就绪用；
        它比 ``chapter_id`` 更贴近用户实际在看的范围，避免"一镜试通就显示整集已就绪"）
      - ``chapter_id`` 给定 → 当前集
      - 只给 ``project_id`` → 多集（本项目全部章节）

    刻意用 ``outerjoin(ShotDetail)``：没有 detail 行的镜头也要出现在清单里，
    否则「缺提示词」的镜头会被静默漏掉，交付清单就对不上范围总数。
    """
    stmt = (
        select(
            Shot.id,
            Shot.chapter_id,
            Shot.index,
            Shot.title,
            ShotDetail.video_prompt,
            ShotDetail.video_prompt_source,
            Chapter.index,
            Chapter.title,
        )
        .join(Chapter, Chapter.id == Shot.chapter_id)
        .outerjoin(ShotDetail, ShotDetail.id == Shot.id)
        .where(Chapter.project_id == project_id)
    )
    wanted_ids = [str(item).strip() for item in (shot_ids or []) if str(item).strip()]
    if shot_id:
        stmt = stmt.where(Shot.id == shot_id)
    elif wanted_ids:
        stmt = stmt.where(Shot.id.in_(wanted_ids))
    elif chapter_id:
        stmt = stmt.where(Shot.chapter_id == chapter_id)
    stmt = stmt.order_by(Chapter.index.asc(), Shot.index.asc())

    rows: list[dict[str, Any]] = []
    for (
        sid,
        cid,
        s_index,
        s_title,
        video_prompt,
        video_prompt_source,
        c_index,
        c_title,
    ) in (await db.execute(stmt)).all():
        rows.append(
            {
                "shot_id": str(sid or ""),
                "chapter_id": str(cid or ""),
                "chapter_index": c_index,
                "chapter_title": str(c_title or ""),
                "shot_index": s_index,
                "shot_title": str(s_title or ""),
                "video_prompt": str(video_prompt or ""),
                "video_prompt_source": str(video_prompt_source or ""),
            }
        )

    # 绑定资产：交付文本要带出「这条提示词对应哪些角色/场景/道具/服装」
    shot_ids = [row["shot_id"] for row in rows]
    bound = await fetch_bound_asset_names(db, shot_ids=shot_ids)
    # 绑定素材的真实文件：名称之外必须能落到 file_id（用户要求）
    files_by_shot = await resolve_bound_files_for_shots(db, shot_ids=shot_ids)
    for row in rows:
        row["bound_assets"] = bound.get(row["shot_id"], {})
        bound_files = files_by_shot.get(row["shot_id"], [])
        row["bound_files"] = [item.to_read() for item in bound_files]
        # 预渲染好的行直接给文本模块用（那边刻意只依赖标准库）
        row["bound_file_lines"] = render_bound_file_lines(bound_files)
    return rows


# 槽位 key 与交付文本里的中文标签一一对应（渲染在 prompt_delivery_text.render_binding_lines）
_BINDING_SLOTS: tuple[tuple[str, str, str], ...] = (
    ("characters", "shot_character_links", "character_id"),
    ("scene", "project_scene_links", "scene_id"),
    ("props", "project_prop_links", "prop_id"),
    ("costumes", "project_costume_links", "costume_id"),
)


async def fetch_bound_asset_names(
    db: AsyncSession, *, shot_ids: list[str]
) -> dict[str, dict[str, list[str]]]:
    """按 shot_id 取已绑定资产**名称**（交付文本要的是名字，不是内部 ID）。

    四类各一条查询（角色走 shot_character_links，其余走 project_*_links），
    只读、只 join 名称列，避免逐镜头开查询。
    """
    from app.models.studio import (
        Character,
        Costume,
        ProjectCostumeLink,
        ProjectPropLink,
        ProjectSceneLink,
        Prop,
        Scene,
        ShotCharacterLink,
    )

    result: dict[str, dict[str, list[str]]] = {}
    if not shot_ids:
        return result

    def bucket(shot_id: str) -> dict[str, list[str]]:
        return result.setdefault(
            shot_id, {"characters": [], "scene": [], "props": [], "costumes": []}
        )

    char_rows = (
        await db.execute(
            select(ShotCharacterLink.shot_id, Character.name)
            .join(Character, Character.id == ShotCharacterLink.character_id)
            .where(ShotCharacterLink.shot_id.in_(shot_ids))
        )
    ).all()
    for shot_id, name in char_rows:
        if name and str(name) not in bucket(str(shot_id))["characters"]:
            bucket(str(shot_id))["characters"].append(str(name))

    scene_rows = (
        await db.execute(
            select(ProjectSceneLink.shot_id, Scene.name)
            .join(Scene, Scene.id == ProjectSceneLink.scene_id)
            .where(ProjectSceneLink.shot_id.in_(shot_ids))
        )
    ).all()
    for shot_id, name in scene_rows:
        if name and str(name) not in bucket(str(shot_id))["scene"]:
            bucket(str(shot_id))["scene"].append(str(name))

    prop_rows = (
        await db.execute(
            select(ProjectPropLink.shot_id, Prop.name)
            .join(Prop, Prop.id == ProjectPropLink.prop_id)
            .where(ProjectPropLink.shot_id.in_(shot_ids))
        )
    ).all()
    for shot_id, name in prop_rows:
        if name and str(name) not in bucket(str(shot_id))["props"]:
            bucket(str(shot_id))["props"].append(str(name))

    costume_rows = (
        await db.execute(
            select(ProjectCostumeLink.shot_id, Costume.name)
            .join(Costume, Costume.id == ProjectCostumeLink.costume_id)
            .where(ProjectCostumeLink.shot_id.in_(shot_ids))
        )
    ).all()
    for shot_id, name in costume_rows:
        if name and str(name) not in bucket(str(shot_id))["costumes"]:
            bucket(str(shot_id))["costumes"].append(str(name))

    return result


async def build_prompt_only_delivery(
    db: AsyncSession,
    *,
    project_id: str,
    chapter_id: str | None = None,
    shot_id: str | None = None,
    shot_ids: list[str] | None = None,
    scope: str = SCOPE_EPISODES,
    sources: list[str] | None = None,
    include_bindings: bool = True,
) -> dict[str, Any]:
    """出口 A 主编排：给范围，返回清单 + 预览文本。

    返回字段
      - ``rows``：范围内全部镜头行（含不可交付的），供前端把「缺提示词」置灰
      - ``exportable_count`` / ``skipped_count``：可交付 / 缺提示词计数
      - ``text``：实际交付文本（无内容时为空串）
      - ``has_content``：文本是否非空
    """
    resolved_scope = scope if scope in SCOPE_LABELS else SCOPE_EPISODES
    rows = await fetch_delivery_rows(
        db,
        project_id=project_id,
        chapter_id=chapter_id,
        shot_id=shot_id,
        shot_ids=shot_ids,
    )
    allowed_sources = tuple(sources) if sources else EXPORT_SOURCES
    text = build_jurilu_prompt_export_document(
        rows,
        multi_episode=(resolved_scope == SCOPE_EPISODES),
        sources=allowed_sources,
        include_bindings=include_bindings,
    )
    exportable = [row for row in rows if has_exportable_prompt(row, sources=allowed_sources)]
    return {
        "project_id": project_id,
        "scope": resolved_scope,
        "scope_label": SCOPE_LABELS[resolved_scope],
        "rows": rows,
        "exportable_count": len(exportable),
        "skipped_count": len(rows) - len(exportable),
        "text": text,
        "has_content": bool(text.strip()),
        "export_source": EXPORT_SOURCE,
        "export_sources": list(allowed_sources),
        "include_bindings": include_bindings,
    }
