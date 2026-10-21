"""已鉴权场次快照的整场采用投影；不调用高层版本读取或读取媒体字节。"""

from types import SimpleNamespace

from sqlalchemy import select, tuple_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.canvas_graph import (
    CanvasEdge, CanvasGroup, CanvasIssue, CanvasMember, CanvasObject, CanvasSummaryField,
    CanvasTarget, CanvasView, EditCoverageCanvasNode, EditTakeReviewSummary, EditCanvasGraph, EditClipCanvasNode, EditPlannedCanvasNode, EditTakeCanvasNode,
    EditSeamCanvasNode, EditSeamReviewSummary,
)
from app.models.directing import Take, SceneTakeRecord, SceneVideoExecution, SceneVersionRecord
from app.models.studio import FileItem
from app.core.contracts.directing.scene_timeline import SceneTimeline
from app.core.contracts.directing.scene_seam_review import SceneSeamReviewCreate
from app.models.directing import SceneSeamReviewRecord
from app.services.directing.seam_basis import scene_seam_bases, seam_review_query
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler
from app.services.directing.scene_take_evidence import latest_take_reviews


async def edit_graph(context: CanvasReadContext, db: AsyncSession, sequence_id: str, inherited_seams: list[str]) -> EditCanvasGraph:
    """按真实时间排序片段并关联固定源 Take；同源重复采用保持独立节点。"""
    graph = GraphAssembler('edit', context.version_id, context.revision)
    items = sorted(context.content.timeline.items, key=lambda item: (item.timeline_start_ms, item.id))
    adopted = {(item.take_kind, item.take_id) for item in items if item.kind == 'media'}
    sources = {}
    # 仅查询轻量身份列；不加载 SceneVideoPreparation 等完整固定输入。
    rows = await db.execute(select(Take.id, Take.file_id, Take.plan_revision_id, Take.unit_id, Take.task_id).where(
        Take.sequence_id == sequence_id).order_by(Take.created_at, Take.id))
    sources.update({('production_plan', row.id): row for row in rows})
    rows = await db.execute(select(SceneTakeRecord.id, SceneTakeRecord.file_id,
        SceneVideoExecution.version_id, SceneVideoExecution.unit_id, SceneTakeRecord.task_id).join(
            SceneVideoExecution, SceneVideoExecution.id == SceneTakeRecord.execution_id).join(
            SceneVersionRecord, SceneVersionRecord.id == SceneVideoExecution.version_id).where(
            SceneVersionRecord.sequence_id == sequence_id).order_by(SceneTakeRecord.created_at, SceneTakeRecord.id))
    sources.update({('scene_video', row.id): row for row in rows})
    file_ids = {row[1] for row in sources.values()}
    files = {file.id: file for file in await db.scalars(select(FileItem).where(
        FileItem.id.in_(file_ids)))} if file_ids else {}
    reviews = await latest_take_reviews(db, context.version_id, context.content)
    judgments = {(item.take_kind, item.take_id): item.annotation for item in context.content.take_judgments}
    judgment_indexes = {(item.take_kind, item.take_id): index for index, item in enumerate(context.content.take_judgments)}
    members = []
    item_indexes = {item.id: index for index, item in enumerate(context.content.timeline.items)}
    shots = {shot.id: shot for shot in context.content.design.direction.shots}
    def obj(kind, key, path):
        return CanvasObject(version_id=context.version_id, revision=context.revision, kind=kind, id=key, path=path)
    def field(key, label, text):
        return CanvasSummaryField(field=key, label=label, text=str(text))
    for (take_kind, take_id), row in sources.items():
        source_id = f'edit:take:{take_kind}:{take_id}'
        source_object = obj('take', f'{take_kind}:{take_id}', [])
        source_target = CanvasTarget(node_id=source_id, object=source_object)
        file = files.get(row[1])
        available = bool(file and file.type == 'video' and file.deleted_at is None and file.delete_requested_at is None)
        issues = [] if available else [CanvasIssue(code='take-unavailable', message='原素材文件不可用或待核实',
            severity='warning', target=source_target)]
        annotation = judgments.get((take_kind, take_id))
        summaries = [EditTakeReviewSummary(id=record.id, version_id=record.version_id, revision=record.revision,
            matches_current=matches) for record, matches in reviews.get((take_kind, take_id), [])]
        graph.add_node(EditTakeCanvasNode(id=source_id, title='源 Take', object=source_object,
            home_view_id='edit:library', take_kind=take_kind, take_id=take_id, file_id=row[1],
            origin_id=row[2], unit_id=row[3], task_id=row[4], available=available,
            duration_ms=file.duration_ms if file else None, issues=issues, annotation=annotation, reviews=summaries,
            summary=[field('origin', '固定来源', row[2]),
                field('judgment', '当前方案判断',
                    f"{ {'pass': '通过', 'retain': '保留', 'repair': '需修复', 'discard': '弃用'}.get(annotation.verdict, '未审查') if annotation else '未审查'}；"
                    f"可用区间 {len(annotation.retained_ranges) if annotation else 0}；"
                    f"实际覆盖登记 {len(annotation.coverage) if annotation else 0}；"
                    f"剪辑采用 {sum(item.kind == 'media' and (item.take_kind, item.take_id) == (take_kind, take_id) for item in items)}")]))
        for coverage_index, coverage in enumerate(annotation.coverage if annotation else []):
            coverage_id = f'{source_id}:coverage:{coverage.id}'
            identity = obj('coverage', f'{take_kind}:{take_id}:{coverage.id}',
                ['take_judgments', judgment_indexes[(take_kind, take_id)], 'annotation', 'coverage', coverage_index])
            graph.add_node(EditCoverageCanvasNode(id=coverage_id, title='实际覆盖', object=identity,
                home_view_id='edit:library', take_kind=take_kind, take_id=take_id, coverage=coverage,
                sources=[source_target], summary=[field('observation', '观察', coverage.observation),
                    field('target', '当前目标／真实源区间', f'{coverage.unit_id} / {coverage.coverage_item_id}；{coverage.media_range.source_in_ms}–{coverage.media_range.source_out_ms} 毫秒')]))
            graph.add_edge(CanvasEdge(id=f'{coverage_id}:source', source=source_id, target=coverage_id,
                kind='business', label='人工登记覆盖', sources=[source_target]))
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
            source_id = f'edit:take:{item.take_kind}:{item.take_id}'
            source_object = obj('take', f'{item.take_kind}:{item.take_id}', [])
            source_target = CanvasTarget(node_id=source_id, object=source_object)
            graph.add_node(EditClipCanvasNode(**shared, take_kind=item.take_kind, take_id=item.take_id,
                file_id=item.file_id, media_range=item.media_range, fit=item.fit, sources=[source_target], summary=[
                    field('position', '时间位置', f'{item.timeline_start_ms} 毫秒'),
                    field('range', '源区间', f'{item.media_range.source_in_ms}–{item.media_range.source_out_ms} 毫秒')]))
            graph.add_edge(CanvasEdge(id=f'edit:source:{item.id}', source=source_id, target=node_id,
                kind='business', label='真实取材', sources=[target]))
        members.append(CanvasMember(node_id=node_id, group='timeline'))
    bases = scene_seam_bases(context.content)
    reviews, failures = {}, {}
    if bases:
        # 只取局部比较所需时间线和输出比例，完整历史正文留在原按需入口。
        rows = await db.execute(seam_review_query(context.version_id, inherited_seams).with_only_columns(
            SceneSeamReviewRecord.id, SceneSeamReviewRecord.version_id, SceneSeamReviewRecord.review,
            SceneSeamReviewRecord.content['timeline'], SceneSeamReviewRecord.content['output_aspect_ratio']).where(
                tuple_(SceneSeamReviewRecord.review['left_clip_id'].as_string(),
                    SceneSeamReviewRecord.review['right_clip_id'].as_string()).in_(list(bases))))
        for record_id, version_id, review, timeline, ratio in rows:
            pair = (review.get('left_clip_id'), review.get('right_clip_id'))
            if pair not in bases:
                continue
            try:
                request = SceneSeamReviewCreate.model_validate(review)
                original = scene_seam_bases(SimpleNamespace(timeline=SceneTimeline.model_validate(timeline),
                    output_aspect_ratio=ratio)).get(pair)
                if original is None:
                    raise ValueError('固定接缝依据无效，请核对原记录')
                summary = EditSeamReviewSummary(id=record_id, version_id=version_id,
                    revision=request.expected_revision, **request.decision.model_dump())
                applicable = original == bases[pair]
                if pair not in reviews or applicable or not reviews[pair][1]:
                    reviews[pair] = (summary, applicable)
            except ValueError:
                failures[pair] = '接缝审查依据读取失败，请从原记录核对并重试'
    for left_id, right_id in bases:
        pair_id = f'{len(left_id)}:{left_id}:{right_id}'
        node_id = f'edit:seam:{pair_id}'
        identity = obj('seam', pair_id, [])
        target = CanvasTarget(node_id=node_id, object=identity)
        review, applicable = reviews.get((left_id, right_id), (None, False))
        issue = failures.get((left_id, right_id))
        status = 'failed' if issue else 'applicable' if applicable else 'needs_review' if review else 'unreviewed'
        message = issue or {'applicable': '当前适用', 'needs_review': '片段来源、区间或构图已变，请重新核对',
            'unreviewed': '尚未审查'}[status]
        sources = [CanvasTarget(node_id=f'edit:clip:{key}', object=graph.nodes[f'edit:clip:{key}'].object)
            for key in (left_id, right_id)]
        graph.add_node(EditSeamCanvasNode(id=node_id, title='真实接缝', object=identity,
            home_view_id='edit:scene', left_clip_id=left_id, right_clip_id=right_id, sources=sources,
            review_status=status, review=review, review_issue=issue,
            issues=[CanvasIssue(code='seam-review-failed', message=issue, severity='warning', target=target)] if issue else [],
            summary=[field('pair', '采用片段', f'{left_id} → {right_id}'), field('review', '接缝审查', message),
                *([field('verdict', '原结论', '通过' if review.verdict == 'pass' else '需修改'),
                    field('observation', '观察依据', review.observation)] if review else [])]))
        members.append(CanvasMember(node_id=node_id, group='seams'))
        for side, source in zip(('left', 'right'), sources):
            graph.add_edge(CanvasEdge(id=f'{node_id}:{side}', source=source.node_id, target=node_id,
                kind='business', label='前段落幅' if side == 'left' else '后段入幅', sources=[source]))
    members.extend(CanvasMember(node_id=node.id, group='sources', presentation='reference')
        for node in graph.nodes.values() if node.kind == 'edit_take' and (node.take_kind, node.take_id) in adopted)
    graph.add_view(CanvasView(id='edit:scene', title='整场剪辑', members=members,
        edge_ids=[edge.id for edge in graph.edges.values() if edge.label != '人工登记覆盖'], groups=[CanvasGroup(id='timeline', label='时间顺序'), CanvasGroup(id='sources', label='源 Take'), CanvasGroup(id='seams', label='真实接缝')]))
    graph.add_view(CanvasView(id='edit:library', title='同场次素材', parent_id='edit:scene',
        members=[CanvasMember(node_id=node.id, group='takes' if node.kind == 'edit_take' else 'coverage')
            for node in graph.nodes.values() if node.kind in ('edit_take', 'edit_coverage')],
        edge_ids=[edge.id for edge in graph.edges.values() if edge.label == '人工登记覆盖'],
        groups=[CanvasGroup(id='takes', label='全部同场候选'), CanvasGroup(id='coverage', label='人工实际覆盖')]))
    return EditCanvasGraph.model_validate({**graph.finish().model_dump(), 'library_view_id': 'edit:library'})
