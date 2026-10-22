import { useEffect, useLayoutEffect, useMemo } from 'react'
import { Alert, Select } from 'antd'
import { useSearchParams } from 'react-router-dom'
import type { SceneVersionContent_Output, UnitCanvasGraph } from '../../../services/generated'
import { GraphCanvas } from './GraphCanvas'
import { ReferencePreview } from './ReferencePreview'
import { SourceLinks } from './Sources'
import { GraphSubgraphPreview } from './GraphSubgraphPreview'
import { CanvasBrowse } from './CanvasBrowse'
import { readStoredGraphView } from './useGraphLayout'
import { arrangeUnitGraph } from './unitLayout'
import { WorkbenchButton } from './ui/WorkbenchButton'

type UnitNode = UnitCanvasGraph['nodes'][number]

/** 服务端决定成员、摘要与入口；当前编辑器由稳定业务 ID 单独打开。 */
export function UnitGraphCanvas({ graph, content, unitId, versionId, revision, storageKey, pending, updating, error, onRetry, onInspect, onReference, onBrowseShotChange }: {
  graph: UnitCanvasGraph; content: SceneVersionContent_Output; unitId?: string; versionId: string; revision: number; storageKey: string
  updating: boolean; pending: boolean; error: string; onRetry: () => void
  onBrowseShotChange: (id?: string) => void
  onInspect: (node: UnitNode) => void; onReference: (node: Extract<UnitNode, { kind: 'unit_references' }>) => void
}) {
  const [params, setParams] = useSearchParams()
  const filter = params.get('unitShot') || ''
  const shots = content.design.direction.shots
  const unit = content.units.find(row => row.id === unitId)
  const shotView = (id: string) => graph.nodes.find(node => node.kind === 'shot_basis' && node.shot_id === id)?.home_view_id
  const rootViewId = graph.views.find(view => view.parent_id === null)?.id || ''
  const filterView = filter ? shotView(filter) : rootViewId
  const viewId = unitId ? graph.nodes.find(node => node.kind === 'unit' && node.unit_id === unitId)?.home_view_id : params.get('unitView') || filterView
  const unavailable = !!unitId && !unit || !!filter && !shots.some(shot => shot.id === filter)
  const view = unavailable ? undefined : graph.views.find(candidate => candidate.id === viewId)
  const byId = useMemo(() => new Map(graph.nodes.map(node => [node.id, node])), [graph])
  const valid = graph.kind === 'units' && graph.version_id === versionId && graph.revision === revision && !!rootViewId
  const go = (id = '', nextFilter = filter) => {
    const target = content.units.find(row => row.id === id)
    const next = new URLSearchParams(params)
    next.set('canvas', 'units')
    next.set('unitShot', id && !target?.coverage.some(item => item.shot_id === nextFilter) ? '' : nextFilter)
    next.set('browseUnit', id)
    next.delete('unitView')
    setParams(next)
  }
  useEffect(() => { onBrowseShotChange(filter || undefined) }, [filter, onBrowseShotChange])
  useLayoutEffect(() => {
    const outsideShot = !!unit && !!filter && !unit.coverage.some(item => item.shot_id === filter)
    const resolvedView = !!unitId && !params.has('browseUnit')
    if (!outsideShot && !resolvedView && params.get('canvas') === 'units') return
    const next = new URLSearchParams(params)
    next.set('canvas', 'units')
    if (outsideShot) next.set('unitShot', '')
    if (resolvedView) { next.set('browseUnit', unitId); next.delete('unitView') }
    setParams(next, { replace: true })
  }, [unit, unitId, filter, params, setParams])
  if (!valid) return <Alert type="error" message="单元图数据与当前版本不一致；当前编辑内容已保留" />
  const preview = (node: UnitNode, target: string) => {
    const child = graph.views.find(candidate => candidate.id === target)
    if (!child || node.kind !== 'unit') return <p>子图不可用</p>
    const layoutNodes = child.members.map(member => ({ id: member.node_id, group: member.group, size: { width: 360, height: 320 } }))
    const sizes = Object.fromEntries(layoutNodes.map(item => [item.id, item.size]))
    const stored = readStoredGraphView(`${storageKey}:view:${child.id}`)
    const positions = arrangeUnitGraph(layoutNodes, sizes, 1440, child.anchor_id || '', stored?.positions)
    return <GraphSubgraphPreview nodes={layoutNodes} positions={positions}
      edges={graph.edges.filter(edge => child.edge_ids.includes(edge.id))} purpose={node.preview_title}
      status={<>{node.summary.filter(field => field.field === 'references').map(field =>
        <span key={field.field}>{field.label}：{field.text}<br /></span>)}
        {child.node_count} 张卡片 · {child.issue_count} 项待核对</>} />
  }
  const objects = view?.members.flatMap(member => {
    const node = byId.get(member.node_id)
    if (!node) return []
    return [{ id: node.id, label: member.title || node.title, title: member.title || node.title,
      group: member.group, entry: member.presentation === 'entry', related: member.presentation === 'reference',
      size: { width: 360, height: member.presentation === 'entry' ? 360 : 320 },
      onInspect: member.presentation === 'entry' && member.entry_view_id ? () => go('unit_id' in node ? node.unit_id : '') : node.kind === 'unit_references' ? () => onReference(node) : node.edit_target || node.kind === 'unit_basis' ? () => onInspect(node) : undefined,
      content: member.presentation === 'entry' && member.entry_view_id ? preview(node, member.entry_view_id) : <section className="canvas-workbench-card unit-graph-card">
        <div className="design-compact-summary">
          <div className="design-compact-fields">{node.summary.map(field => <p key={field.field} title={`${field.label}：${field.text}`}><span>{field.label}：</span><strong>{field.text}</strong></p>)}
            {node.kind === 'unit_config' && node.config_kind === 'dependencies' && node.dependency_evidence.map((evidence, index) => evidence.source && <SourceLinks key={index} sources={[evidence.source]} />)}
            {node.kind === 'unit_references' && <div className="unit-graph-reference-previews">{node.bindings.map(binding => {
              const preview = node.previews.find(item => item.binding_id === binding.id)
              return <section key={binding.id}>{preview ? <><p title={preview.display_name}>{preview.display_name}</p><ReferencePreview reference={binding} preview={preview} /></> : <p role="status">固定参考预览尚未核实</p>}</section>
            })}</div>}
          </div>
          {!!node.issues.length && <div className="unit-graph-issues" role="status" title={node.issues.map(issue => issue.message).join('；')}>
            <strong>待处理 {node.issues.length} 项</strong><p>{node.issues[0].message}</p>
          </div>}
        </div>
        <div className="unit-graph-actions">
          {node.kind === 'unit_references' && <WorkbenchButton onClick={() => onReference(node)}>{node.binding_count ? '编辑参考' : `添加${node.title}`}</WorkbenchButton>}
          {node.kind === 'unit_basis' && <WorkbenchButton onClick={() => onInspect(node)}>查看执行依据</WorkbenchButton>}
          {node.edit_target && node.kind !== 'unit_references' && <WorkbenchButton onClick={() => onInspect(node)}>查看详情</WorkbenchButton>}
        </div>
      </section> }]
  }) || []
  const edgeIds = new Set(view?.edge_ids)
  const relations = graph.edges.filter(edge => edgeIds.has(edge.id) && edge.kind === 'business' && edge.target)
    .map(edge => ({ from: edge.source, to: edge.target!, label: edge.label, category: edge.category }))
  const unavailableView = !updating && !view
  const unknownView = !unitId ? params.get('unitView') || '' : ''
  const candidates = content.units.filter(row => !filter || row.coverage.some(item => item.shot_id === filter))
  return <>
    <CanvasBrowse storageKey={storageKey} label="单元画布位置" filtered={!!filter || !!unitId} filters={<>
      <label><Select aria-label="单元镜头筛选" value={filter} onChange={id => go('', id)}
        options={[{ value: '', label: '全部镜头' }, ...shots.map((shot, index) => ({ value: shot.id, label: `镜头 ${index + 1}` })),
          ...(filter && !shots.some(shot => shot.id === filter) ? [{ value: filter, label: '原镜头不可用' }] : [])]} /></label>
      <label>单元<Select aria-label="当前单元" value={unitId || unknownView || ''} onChange={id => go(id)}
        options={[{ value: '', label: '全部单元' }, ...candidates.map(row => ({ value: row.id, label: `单元 ${content.units.indexOf(row) + 1}` })),
          ...(unitId && !unit ? [{ value: unitId, label: '原单元不可用' }] : []), ...(unknownView ? [{ value: unknownView, label: '原浏览目标不可用', disabled: true }] : [])]} /></label>
    </>} status={<>
      {pending && <span>图待同步</span>}
      {updating && !error && <span>正在更新单元卡片</span>}
    </>} notice={<>
      {error && <Alert type="error" message="单元卡片更新失败，当前编辑已保留" description={error} action={<WorkbenchButton onClick={onRetry}>重试单元卡片</WorkbenchButton>} />}
      {(unavailable || unavailableView) && <Alert type="warning" message="原浏览目标已不可用" action={<WorkbenchButton onClick={() => go('', '')}>返回全部镜头</WorkbenchButton>} />}
    </>}>
      <WorkbenchButton variant="quiet" onClick={() => go('', '')}>单元画布</WorkbenchButton>
      {filter && <WorkbenchButton variant="quiet" onClick={() => go()}>{`› ${shots.some(shot => shot.id === filter) ? `镜头 ${shots.findIndex(shot => shot.id === filter) + 1}` : '原镜头不可用'}`}</WorkbenchButton>}
      {unitId && <span>{unit ? `› 单元 ${content.units.indexOf(unit) + 1}` : '› 原单元不可用'}</span>}
      {unknownView && <span>› 原单元不可用</span>}
    </CanvasBrowse>
    <div style={{ visibility: updating ? 'hidden' : undefined }} aria-hidden={updating}>{view &&
      <GraphCanvas contextKey={storageKey} ariaLabel="单元画布视口" objects={objects} relations={relations}
        groups={view.groups} layoutScope={{ storageKey, viewId: view.id, anchorId: view.anchor_id || '',
          validIds: graph.nodes.map(node => node.id), validViewIds: graph.views.map(candidate => candidate.id), arrange: arrangeUnitGraph, initialTop: window.innerWidth <= 700 ? 112 : 64 }} />}</div>
  </>
}
