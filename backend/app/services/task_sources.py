"""批量解析任务来源；只提供轻量导航信息，不复制业务详情或任务状态。"""

from sqlalchemy import select

from app.models.experiment_sessions import ExperimentSession
from app.models.directing import Sequence, DirectingRevision
from app.models.studio import Actor, Character, Scene, Prop, Costume, Chapter, Project
from app.schemas.task import TaskSourceRead

_ASSETS = {"actor": Actor, "character": Character, "scene": Scene, "prop": Prop, "costume": Costume}
_SCRIPT_TARGETS = {
    "consistency_check", "script_optimization", "script_simplification",
    "character_portrait_analysis", "prop_info_analysis", "scene_info_analysis", "costume_info_analysis",
    "script_processing",
}


async def resolve_task_sources(db, rows) -> dict[str, TaskSourceRead]:
    """按来源类型批量核实；来源失效不猜测替代编辑对象。"""
    grouped: dict[str, dict[str, str]] = {}
    for row in rows:
        kind, identity = row.target_type, row.target_id
        if kind and kind.endswith("_image_slot"):
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
        elif kind in {"directing_sequence", "directing_unit", "directing_image"}:
            query = select(Sequence.id, Sequence.title, Sequence.chapter_id, Chapter.project_id).join(Chapter, Chapter.id == Sequence.chapter_id)
            if kind in {"directing_unit", "directing_image"}:
                query = query.add_columns(DirectingRevision.id.label("lookup_id")).join(DirectingRevision, DirectingRevision.sequence_id == Sequence.id).where(DirectingRevision.id.in_(ids))
            else:
                query = query.add_columns(Sequence.id.label("lookup_id")).where(Sequence.id.in_(ids))
            for row in (await db.execute(query)).all():
                found[row.lookup_id] = TaskSourceRead(kind="sequence", id=row.id, title=row.title,
                                                     chapter_id=row.chapter_id, project_id=row.project_id)
        elif kind == "directing_chapter":
            for row in (await db.execute(select(Chapter.id, Chapter.title, Chapter.project_id).where(Chapter.id.in_(ids)))).all():
                found[row.id] = TaskSourceRead(kind="chapter", id=row.id, title=row.title, chapter_id=row.id, project_id=row.project_id)
        elif kind == "canvas_node":
            from app.models.generation_canvas import CanvasRunNode, GenerationCanvas
            query = select(CanvasRunNode, GenerationCanvas, Sequence.chapter_id).join(GenerationCanvas, GenerationCanvas.id == CanvasRunNode.canvas_id).outerjoin(Sequence, Sequence.id == GenerationCanvas.sequence_id).where(CanvasRunNode.id.in_(ids))
            for node, canvas, chapter_id in (await db.execute(query)).all():
                found[node.id] = TaskSourceRead(kind="generation_canvas", id=canvas.id, title=canvas.document["name"],
                    project_id=canvas.project_id, canvas_id=canvas.id, run_id=node.run_id, node_id=node.id,
                    chapter_id=chapter_id,
                    sequence_id=canvas.sequence_id)
        elif kind == 'canvas_check_report':
            from app.models.generation_canvas import CanvasCheckReport, GenerationCanvas
            query = select(CanvasCheckReport.id, CanvasCheckReport.check_card_id, GenerationCanvas.id.label('canvas_id'),
                           GenerationCanvas.project_id, GenerationCanvas.sequence_id, Sequence.chapter_id, GenerationCanvas.document['name'].as_string().label('title')).join(
                               GenerationCanvas, GenerationCanvas.id == CanvasCheckReport.canvas_id
                           ).outerjoin(Sequence, Sequence.id == GenerationCanvas.sequence_id).where(CanvasCheckReport.id.in_(ids))
            for row in (await db.execute(query)).all():
                found[row.id] = TaskSourceRead(kind='generation_canvas', id=row.canvas_id, title=row.title,
                    project_id=row.project_id, canvas_id=row.canvas_id, check_card_id=row.check_card_id, check_report_id=row.id,
                    chapter_id=row.chapter_id, sequence_id=row.sequence_id)
            for task in rows:
                source = found.get(identities.get(task.id))
                if source and source.project_id == task.project_id:
                    result[task.id] = source
            continue
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
    for task in rows:
        if task.target_type in ('canvas_node', 'canvas_check_report') and task.id not in result:
            result[task.id] = TaskSourceRead(kind='deleted_canvas', id=task.target_id or task.id, title='画布已删除')
    return result
