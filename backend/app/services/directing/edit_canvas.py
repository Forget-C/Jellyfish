"""已鉴权场次快照的整场采用投影；不调用高层版本读取或读取媒体字节。"""

from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.contracts.directing.canvas_graph import (
    CanvasEdge, CanvasGroup, CanvasIssue, CanvasMember, CanvasObject, CanvasSummaryField,
    CanvasTarget, CanvasView, EditCoverageCanvasNode, EditTakeReviewSummary, EditCanvasGraph, EditClipCanvasNode, EditPlannedCanvasNode, EditTakeCanvasNode,
    EditSeamCanvasNode, EditSeamReviewSummary, EditCutReviewCanvasNode, EditEndFrameCanvasNode, EditDownstreamCanvasNode,
)
from app.models.directing import Take, SceneTakeRecord, SceneVideoExecution, SceneVersionRecord
from app.models.studio import FileItem
from app.core.contracts.directing.scene_seam_review import SceneSeamReviewCreate
from app.services.directing.seam_basis import scene_seam_bases, latest_seam_reviews
from app.services.directing.review_basis_key import review_basis_key
from app.services.directing.canvas_graph import CanvasReadContext, GraphAssembler
from app.services.directing.scene_take_evidence import latest_take_reviews


async def edit_graph(context: CanvasReadContext, db: AsyncSession, sequence_id: str, inherited_seams: list[str], inherited_cuts: list[str]) -> EditCanvasGraph:
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
    # 当前保存的判断／采用仍保留已消失源的复合身份，不能让图读取形成悬空引用。
    for item in [*context.content.take_judgments, *(row for row in items if row.kind == 'media')]:
        sources.setdefault((item.take_kind, item.take_id), (item.take_id, item.file_id, None, None, None))
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
        file = files.get(row[1]) if row[2] is not None else None
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
            summary=[field('origin', '固定来源', row[2] or '来源不可用'),
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
        rows = await latest_seam_reviews(db, context.version_id, inherited_seams, bases)
        for record_id, version_id, review, basis_key in rows:
            pair = (review.get('left_clip_id'), review.get('right_clip_id'))
            if pair not in bases:
                continue
            try:
                request = SceneSeamReviewCreate.model_validate(review)
                summary = EditSeamReviewSummary(id=record_id, version_id=version_id,
                    revision=request.expected_revision, **request.decision.model_dump())
                applicable = basis_key == review_basis_key(bases[pair])
                if pair not in reviews or applicable and not reviews[pair][1]:
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
    await add_frame_evidence(graph, context, db, members, obj, field)
    await add_cut_evidence(graph, context, db, inherited_cuts, members, obj, field)
    for unit_id, links in context.dependencies.items():
        for link in links:
            origin = link.version_id if link.kind == 'scene' else link.plan_revision_id
            source_id = link.clip_id if link.kind == 'scene' else link.unit_id
            key = f'{len(unit_id)}:{unit_id}:{link.kind}:{len(origin)}:{origin}:{source_id}'
            node_id = f'edit:downstream:{key}'
            sources = []
            if link.kind == 'scene' and link.version_id == context.version_id:
                clip = graph.nodes.get(f'edit:clip:{link.clip_id}')
                if clip:
                    sources.append(CanvasTarget(node_id=clip.id, object=clip.object))
            if link.frame_id:
                frame_node = graph.nodes.get(f'edit:end-frame:{link.frame_id}')
                if frame_node:
                    sources.append(CanvasTarget(node_id=frame_node.id, object=frame_node.object))
            if link.kind == 'scene' and link.version_id == context.version_id:
                for seam_node in graph.nodes.values():
                    if seam_node.kind == 'edit_seam' and link.clip_id in (seam_node.left_clip_id, seam_node.right_clip_id):
                        sources.append(CanvasTarget(node_id=seam_node.id, object=seam_node.object))
            graph.add_node(EditDownstreamCanvasNode(id=node_id, title='受影响后段', object=obj('dependency', key, []),
                home_view_id='edit:scene', unit_id=unit_id, dependency=link, sources=sources,
                summary=[field('unit', '后段单元', unit_id), field('status', '固定依赖核对', link.message),
                    field('frame', '原落幅／参考', f'{link.frame_id or "尚未绑定"} / {link.reference_id or "尚未绑定"}')]))
            members.append(CanvasMember(node_id=node_id, group='evidence'))
            for target in sources:
                graph.add_edge(CanvasEdge(id=f'{node_id}:{target.node_id}', source=target.node_id, target=node_id,
                    kind='business', label='固定后段依赖', sources=[target]))
    members.extend(CanvasMember(node_id=node.id, group='sources', presentation='reference')
        for node in graph.nodes.values() if node.kind == 'edit_take' and (node.take_kind, node.take_id) in adopted)
    graph.add_view(CanvasView(id='edit:scene', title='整场剪辑', members=members,
        edge_ids=[edge.id for edge in graph.edges.values() if edge.label != '人工登记覆盖'], groups=[CanvasGroup(id='timeline', label='时间顺序'), CanvasGroup(id='sources', label='源 Take'), CanvasGroup(id='seams', label='真实接缝'), CanvasGroup(id='evidence', label='验收与后段依据')]))
    graph.add_view(CanvasView(id='edit:library', title='同场次素材', parent_id='edit:scene',
        members=[CanvasMember(node_id=node.id, group='takes' if node.kind == 'edit_take' else 'coverage')
            for node in graph.nodes.values() if node.kind in ('edit_take', 'edit_coverage')],
        edge_ids=[edge.id for edge in graph.edges.values() if edge.label == '人工登记覆盖'],
        groups=[CanvasGroup(id='takes', label='全部同场候选'), CanvasGroup(id='coverage', label='人工实际覆盖')]))
    return EditCanvasGraph.model_validate({**graph.finish().model_dump(), 'library_view_id': 'edit:library'})


async def add_cut_evidence(graph, context, db, inherited, members, obj, field):
    """索引预选最新和最近适用结论；完整历史仅由原阅读入口加载。"""
    from app.core.contracts.directing.scene_cut_review import SceneCutReviewCreate
    from app.services.directing.scene_cut_evidence import cut_review_basis_key, cut_review_query
    from app.models.directing import SceneCutReviewRecord
    current = cut_review_basis_key(context.content)
    query = cut_review_query(context.version_id, inherited)
    latest = query.with_only_columns(SceneCutReviewRecord.id).limit(1).scalar_subquery()
    matching = query.where(SceneCutReviewRecord.basis_key == current).with_only_columns(SceneCutReviewRecord.id).limit(1).scalar_subquery()
    rows = await db.scalars(query.where(or_(SceneCutReviewRecord.id == latest, SceneCutReviewRecord.id == matching)))
    selected = [(row, SceneCutReviewCreate.model_validate(row.review), row.basis_key == current) for row in rows]
    for row, request, matches in selected:
        node_id = f'edit:cut-review:{row.id}'
        original_clips = {item['id'] for item in row.content['timeline']['items']}
        original_coverage = {(item['take_kind'], item['take_id'], coverage['id'])
            for item in row.content.get('take_judgments', []) for coverage in item['annotation'].get('coverage', [])}
        sources = [CanvasTarget(node_id=node.id, object=node.object) for node in graph.nodes.values()
            if (node.kind in ('edit_clip', 'edit_planned') and node.clip_id in original_clips)
            or (node.kind == 'edit_seam' and node.left_clip_id in original_clips and node.right_clip_id in original_clips)
            or (node.kind == 'edit_coverage' and (node.take_kind, node.take_id, node.coverage.id) in original_coverage)]
        graph.add_node(EditCutReviewCanvasNode(id=node_id, title='整场验收', object=obj('cut_review', row.id, []),
            home_view_id='edit:scene', record_id=row.id, record_version_id=row.version_id,
            matches_current=matches, decision=request.decision, sources=sources,
            summary=[field('status', '固定依据', '当前适用' if matches else '剪辑或创作依据已变，请重新核对'),
                field('picture', '画面结论', '通过' if request.decision.verdict == 'pass' else '需修改'),
                field('coverage', '实际覆盖核对', {'unknown': '未核实', 'gaps': '有缺口', 'verified': '已核对无覆盖缺口'}[request.decision.coverage_status]),
                field('sound', '声音状态', {'pending_postproduction': '待后期', 'reviewed': '已审查', 'not_applicable': '不适用'}[request.decision.sound_status])]))
        members.append(CanvasMember(node_id=node_id, group='evidence'))
        for target in sources:
            graph.add_edge(CanvasEdge(id=f'{node_id}:{target.node_id}', source=target.node_id, target=node_id,
                kind='business', label='原验收对应对象', sources=[target]))


async def add_frame_evidence(graph, context, db, members, obj, field):
    """SQL预选当前片段最新落幅和明确绑定帧；不展开全部历史或解码媒体。"""
    from datetime import UTC
    from app.core.contracts.directing.scene_end_frame import SceneEndFrameRead, SceneEndFrameCreate
    from app.core.contracts.directing.scene_timeline import SceneMediaCutItem
    from app.core.contracts.directing.common import Source
    from app.models.directing import SceneEndFrameRecord
    from app.services.directing.scene_cut_evidence import scene_frame_basis
    bound = {link.frame_id for links in context.dependencies.values() for link in links if link.frame_id and link.kind == 'scene'}
    ranked = select(SceneEndFrameRecord.id, func.row_number().over(
        partition_by=SceneEndFrameRecord.clip['id'].as_string(),
        order_by=(SceneEndFrameRecord.created_at.desc(), SceneEndFrameRecord.id.desc())).label('rank')).where(
            SceneEndFrameRecord.version_id == context.version_id).subquery()
    rows = list(await db.scalars(select(SceneEndFrameRecord).where(or_(SceneEndFrameRecord.id.in_(bound),
        SceneEndFrameRecord.id.in_(select(ranked.c.id).where(ranked.c.rank == 1))))))
    files = {file.id: file for file in await db.scalars(select(FileItem).where(
        FileItem.id.in_([row.file_id for row in rows])))} if rows else {}
    current = {item.id: item for item in context.content.timeline.items}
    for row in rows:
        if row.clip['id'] not in current and row.id not in bound:
            continue
        request = SceneEndFrameCreate.model_validate(row.request)
        clip = SceneMediaCutItem.model_validate(row.clip)
        file = files.get(row.file_id)
        available = bool(file and file.type == 'image' and file.deleted_at is None and file.delete_requested_at is None)
        matches = row.version_id == context.version_id and scene_frame_basis(clip) == scene_frame_basis(current.get(clip.id))
        frame = SceneEndFrameRead(id=row.id, version_id=row.version_id, request_id=row.request_id,
            revision=request.expected_revision, clip=clip, file_id=row.file_id, at_ms=row.at_ms,
            source=Source(kind='file', reference=clip.take_id, version='1', file_id=clip.file_id,
                media_range={'source_in_ms': row.at_ms, 'source_out_ms': row.at_ms + 1}),
            created_at=row.created_at.replace(tzinfo=UTC) if row.created_at.tzinfo is None else row.created_at,
            matches_current=matches, available=available,
            image_url=f'/api/v1/studio/files/{row.file_id}/download' if available else None)
        node_id = f'edit:end-frame:{row.id}'
        sources = []
        source_node = graph.nodes.get(f'edit:clip:{clip.id}') if row.version_id == context.version_id else None
        if source_node:
            sources.append(CanvasTarget(node_id=source_node.id, object=source_node.object))
        graph.add_node(EditEndFrameCanvasNode(id=node_id, title='实际落幅', object=obj('end_frame', row.id, []),
            home_view_id='edit:scene', frame=frame, sources=sources,
            summary=[field('source', '原采用／素材', f'{clip.id} / {clip.take_kind}:{clip.take_id}'),
                field('range', '真实区间／解码帧', f'{clip.media_range.source_in_ms}–{clip.media_range.source_out_ms} / {row.at_ms} 毫秒'),
                field('state', '落幅依据', ('当前采用适用' if matches else '原采用依据已变或来自历史版本，请核对') + ('；文件不可用' if not available else ''))]))
        members.append(CanvasMember(node_id=node_id, group='evidence'))
        for target in sources:
            graph.add_edge(CanvasEdge(id=f'{node_id}:source', source=target.node_id, target=node_id,
                kind='business', label='原采用对应对象', sources=[target]))
