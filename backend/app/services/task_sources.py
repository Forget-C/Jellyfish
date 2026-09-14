"""批量解析任务来源；只提供轻量导航信息，不复制业务详情或任务状态。"""

from sqlalchemy import select

from app.models.experiment_sessions import ExperimentSession
from app.models.studio import Actor, Character, Scene, Prop, Costume, Shot, Chapter, Project
from app.schemas.task import TaskSourceRead

_ASSETS = {"actor": Actor, "character": Character, "scene": Scene, "prop": Prop, "costume": Costume}
_SCRIPT_TARGETS = {
    "chapter_division", "script_extraction", "consistency_check", "script_optimization", "script_simplification",
    "entity_merge", "variant_analysis", "character_portrait_analysis", "prop_info_analysis", "scene_info_analysis", "costume_info_analysis",
    "script_processing",
}


async def resolve_task_sources(db, rows) -> dict[str, TaskSourceRead]:
    """每类来源最多一次批量查询，来源删除后保留任务历史且不返回失效导航。"""
    grouped: dict[str, dict[str, str]] = {}
    for row in rows:
        kind, identity = row.target_type, row.target_id
        if kind == "shot_frame_slot":
            kind, identity = "shot", row.target_parent_id
        elif kind == "shot_video":
            kind = "shot"
        elif kind and kind.endswith("_image_slot"):
            kind, identity = kind.removesuffix("_image_slot"), row.target_parent_id
        elif kind in _SCRIPT_TARGETS:
            if identity and ":" in identity:
                prefix, identity = identity.split(":", 1)
                kind = prefix.removesuffix("_image")
            else:
                kind = "script"
        if identity:
            grouped.setdefault(kind, {})[row.id] = identity
    result = {}
    for kind, identities in grouped.items():
        ids = set(identities.values())
        found = {}
        if kind in _ASSETS:
            model = _ASSETS[kind]
            columns = [model.id, model.name]
            if kind == "character":
                columns.append(model.project_id)
            for row in (await db.execute(select(*columns).where(model.id.in_(ids)))).all():
                found[row.id] = TaskSourceRead(kind=kind, id=row.id, title=row.name,
                                               project_id=row.project_id if kind == "character" else None)
        elif kind == "shot":
            query = select(Shot.id, Shot.title, Shot.chapter_id, Chapter.project_id).join(Chapter, Chapter.id == Shot.chapter_id).where(Shot.id.in_(ids))
            for row in (await db.execute(query)).all():
                found[row.id] = TaskSourceRead(kind="shot", id=row.id, title=row.title, chapter_id=row.chapter_id, project_id=row.project_id)
        elif kind == "experiment_session":
            for row in (await db.execute(select(ExperimentSession.id, ExperimentSession.title).where(ExperimentSession.id.in_(ids)))).all():
                found[row.id] = TaskSourceRead(kind=kind, id=row.id, title=row.title)
        elif kind == "script":
            for row in (await db.execute(select(Chapter.id, Chapter.title, Chapter.project_id).where(Chapter.id.in_(ids)))).all():
                found[row.id] = TaskSourceRead(kind="chapter", id=row.id, title=row.title, chapter_id=row.id, project_id=row.project_id)
            remaining = ids - found.keys()
            if remaining:
                for row in (await db.execute(select(Project.id, Project.name).where(Project.id.in_(remaining)))).all():
                    found[row.id] = TaskSourceRead(kind="project", id=row.id, title=row.name, project_id=row.id)
        result.update({task_id: found[identity] for task_id, identity in identities.items() if identity in found})
    return result
