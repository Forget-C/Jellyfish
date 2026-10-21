"""已鉴权场次快照的整场采用投影；不调用高层版本读取或读取媒体字节。"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.canvas_graph import (
    CanvasEdge, CanvasGroup, CanvasIssue, CanvasMember, CanvasObject, CanvasSummaryField,
    CanvasTarget, CanvasView, EditCanvasGraph, EditClipCanvasNode, EditPlannedCanvasNode, EditTakeCanvasNode,
)
from app.models.directing import Take, SceneTakeRecord, SceneVideoExecution, SceneVersionRecord
from app.models.studio import FileItem
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler


async def edit_graph(context: CanvasReadContext, db: AsyncSession, sequence_id: str) -> EditCanvasGraph:
    """按真实时间排序片段并关联固定源 Take；同源重复采用保持独立节点。"""
    graph = GraphAssembler('edit', context.version_id, context.revision)
    items = sorted(context.content.timeline.items, key=lambda item: (item.timeline_start_ms, item.id))
    adopted = {(item.take_kind, item.take_id) for item in items if item.kind == 'media'}
    sources = {}
    # 仅查询轻量身份列；不加载 SceneVideoPreparation 等完整固定输入。
    legacy_ids = [key for kind, key in adopted if kind == 'production_plan']
    if legacy_ids:
        rows = await db.execute(select(Take.id, Take.file_id, Take.plan_revision_id, Take.unit_id, Take.task_id).where(
            Take.sequence_id == sequence_id, Take.id.in_(legacy_ids)))
        sources.update({('production_plan', row.id): row for row in rows})
    current_ids = [key for kind, key in adopted if kind == 'scene_video']
    if current_ids:
        rows = await db.execute(select(SceneTakeRecord.id, SceneTakeRecord.file_id,
            SceneVideoExecution.version_id, SceneVideoExecution.unit_id, SceneTakeRecord.task_id).join(
                SceneVideoExecution, SceneVideoExecution.id == SceneTakeRecord.execution_id).join(
                SceneVersionRecord, SceneVersionRecord.id == SceneVideoExecution.version_id).where(
                SceneVersionRecord.sequence_id == sequence_id, SceneTakeRecord.id.in_(current_ids)))
        sources.update({('scene_video', row.id): row for row in rows})
    file_ids = {row[1] for row in sources.values()}
    files = {file.id: file for file in await db.scalars(select(FileItem).where(
        FileItem.id.in_(file_ids)))} if file_ids else {}
    members = []
    item_indexes = {item.id: index for index, item in enumerate(context.content.timeline.items)}
    shots = {shot.id: shot for shot in context.content.design.direction.shots}
    def obj(kind, key, path):
        return CanvasObject(version_id=context.version_id, revision=context.revision, kind=kind, id=key, path=path)
    def field(key, label, text):
        return CanvasSummaryField(field=key, label=label, text=str(text))
    for index, item in enumerate(items):
        node_id = f'edit:clip:{item.id}'
        identity = obj('clip' if item.kind == 'media' else 'planned', item.id, ['timeline', 'items',
            item_indexes[item.id]])
        target = CanvasTarget(node_id=node_id, object=identity)
        shared = dict(id=node_id, title=f'片段 {index + 1} · {"真实媒体" if item.kind == "media" else "待拍占位"}',
            object=identity, edit_target=target, home_view_id='edit:scene', clip_id=item.id,
            timeline_start_ms=item.timeline_start_ms)
        if item.kind == 'planned':
            shot = shots.get(item.shot_id)
            expected = shot.visible_result.text or '' if shot else ''
            graph.add_node(EditPlannedCanvasNode(**shared, shot_id=item.shot_id, expected_content=expected,
                estimated_duration_ms=item.estimated_duration_ms, summary=[
                    field('expected', '预期内容', expected or '动作待填写'),
                    field('position', '预计位置／时长', f'{item.timeline_start_ms} / {item.estimated_duration_ms} 毫秒')]))
        else:
            source_key = (item.take_kind, item.take_id)
            source_id = f'edit:take:{item.take_kind}:{item.take_id}'
            source_object = obj('take', f'{item.take_kind}:{item.take_id}', [])
            source_target = CanvasTarget(node_id=source_id, object=source_object)
            if source_id not in graph.nodes:
                row = sources.get(source_key)
                file = files.get(row[1]) if row else None
                available = bool(file and file.type == 'video' and file.deleted_at is None and file.delete_requested_at is None)
                issues = [] if available else [CanvasIssue(code='take-unavailable', message='原素材文件不可用或待核实',
                    severity='warning', target=source_target)]
                graph.add_node(EditTakeCanvasNode(id=source_id, title='源 Take', object=source_object,
                    home_view_id='edit:scene', take_kind=item.take_kind, take_id=item.take_id, file_id=item.file_id,
                    origin_id=row[2] if row else None, unit_id=row[3] if row else None,
                    task_id=row[4] if row else None, available=available,
                    duration_ms=file.duration_ms if file else None, issues=issues,
                    summary=[field('take', '原素材', item.take_id), field('origin', '固定来源', row[2] if row else '来源不可用')]))
            graph.add_node(EditClipCanvasNode(**shared, take_kind=item.take_kind, take_id=item.take_id,
                file_id=item.file_id, media_range=item.media_range, fit=item.fit, sources=[source_target], summary=[
                    field('position', '时间位置', f'{item.timeline_start_ms} 毫秒'),
                    field('range', '源区间', f'{item.media_range.source_in_ms}–{item.media_range.source_out_ms} 毫秒')]))
            graph.add_edge(CanvasEdge(id=f'edit:source:{item.id}', source=source_id, target=node_id,
                kind='business', label='真实取材', sources=[target]))
        members.append(CanvasMember(node_id=node_id, group='timeline'))
    members.extend(CanvasMember(node_id=node.id, group='sources', presentation='reference')
        for node in graph.nodes.values() if node.kind == 'edit_take')
    graph.add_view(CanvasView(id='edit:scene', title='整场剪辑', members=members,
        edge_ids=list(graph.edges), groups=[CanvasGroup(id='timeline', label='时间顺序'), CanvasGroup(id='sources', label='源 Take')]))
    return EditCanvasGraph.model_validate(graph.finish().model_dump())
