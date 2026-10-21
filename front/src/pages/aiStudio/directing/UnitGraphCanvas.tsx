import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Select } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { UnitCanvasGraph } from '../../../services/generated'
import { GraphCanvas } from './GraphCanvas'
import { ReferencePreview } from './ReferencePreview'
import { SourceLinks } from './Sources'
import { GraphSubgraphPreview } from './GraphSubgraphPreview'
import { useGraphBrowse } from './useGraphBrowse'
import { readStoredGraphView } from './useGraphLayout'
import { arrangeUnitGraph } from './unitLayout'
import { WorkbenchButton, WorkbenchIconButton } from './ui/WorkbenchButton'

type UnitNode = UnitCanvasGraph['nodes'][number]

/** 服务端决定成员、摘要与入口；当前编辑器由稳定业务 ID 单独打开。 */
export function UnitGraphCanvas({ graph, versionId, revision, storageKey, navigationHost, pending, focusUnitId, onSelectUnit, onSelectShot, onInspect, onReference, onBrowseShotChange }: {
  graph: UnitCanvasGraph; versionId: string; revision: number; storageKey: string; navigationHost: HTMLElement | null
  pending: boolean; focusUnitId?: string
  onSelectUnit: (id: string) => void; onSelectShot: (id: string) => void
  onBrowseShotChange: (id?: string) => void
  onInspect: (node: UnitNode) => void; onReference: (id: string) => void
}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation(), navigate = useNavigate()
  const { canBrowse } = useGraphBrowse(storageKey)
  const [remembered] = useState<string>(() => {
    try { return localStorage.getItem(`${storageKey}:filter`) || '' } catch { return '' }
  })
  const filter = params.has('unitShot') ? params.get('unitShot') || '' : remembered
  const shotView = (id: string) => graph?.nodes.find(node => node.kind === 'shot_basis' && node.shot_id === id)?.home_view_id
  const rootViewId = graph?.views.find(view => view.parent_id == null)?.id || ''
  const filterView = filter ? shotView(filter) : rootViewId
  const [unavailableFocus, setUnavailableFocus] = useState(false)
  const focusView = graph?.nodes.find(node => node.kind === 'unit' && node.unit_id === focusUnitId)?.home_view_id
  const viewId = params.get('unitView') || filterView
  const view = unavailableFocus ? undefined : graph?.views.find(candidate => candidate.id === viewId)
  const byId = useMemo(() => new Map(graph?.nodes.map(node => [node.id, node])), [graph])
  const valid = graph?.kind === 'units' && graph.version_id === versionId && graph.revision === revision && !!rootViewId
  const go = (nextView: string, nextFilter = filter, replace = false) => {
    setUnavailableFocus(false)
    const next = new URLSearchParams(params)
    next.set('unitShot', nextFilter)
    if (nextView === rootViewId || graph?.nodes.some(node => node.kind === 'shot_basis' && node.home_view_id === nextView)) next.delete('unitView')
    else next.set('unitView', nextView)
    setParams(next, { replace })
  }
  useEffect(() => {
    onBrowseShotChange(filter || undefined)
    try { localStorage.setItem(`${storageKey}:filter`, filter) } catch { /* 会话筛选仍可使用。 */ }
  }, [filter, storageKey])
  useEffect(() => {
    if (!focusUnitId) { setUnavailableFocus(false); return }
    if (focusView) go(focusView)
    else setUnavailableFocus(true)
  }, [focusUnitId, focusView])
  useEffect(() => {
    const node = byId.get(view?.anchor_id || '')
    if (node?.kind === 'unit') onSelectUnit(node.unit_id)
  }, [view?.anchor_id, location.key])
  if (!valid) return <Alert type="error" message="单元图数据与当前版本不一致；当前编辑内容已保留" />
  const select = (id: string) => {
    const nextView = id ? shotView(id) : rootViewId
    if (!nextView) return
    if (id) onSelectShot(id)
    go(nextView, id)
  }
  const preview = (node: UnitNode, target: string) => {
    const child = graph.views.find(candidate => candidate.id === target)
    if (!child) return <p>子图不可用</p>
    const layoutNodes = child.members.map(member => ({ id: member.node_id, group: member.group, size: { width: 360, height: 320 } }))
    const sizes = Object.fromEntries(layoutNodes.map(item => [item.id, item.size]))
    const stored = readStoredGraphView(`${storageKey}:view:${child.id}`)
    const positions = arrangeUnitGraph(layoutNodes, sizes, 1440, child.anchor_id || '', stored?.positions)
    return <GraphSubgraphPreview nodes={layoutNodes} positions={positions}
      edges={graph.edges.filter(edge => child.edge_ids.includes(edge.id))} purpose={node.summary.map(field => field.text).join(' · ')}
      status={`${child.node_count} 张卡片 · ${child.issue_count} 项待核对`} />
  }
  const objects = view?.members.flatMap(member => {
    const node = byId.get(member.node_id)
    if (!node) return []
    return [{ id: node.id, label: member.title || node.title, title: member.title || node.title,
      group: member.group, entry: member.presentation === 'entry', related: member.presentation === 'reference',
      size: { width: 360, height: member.presentation === 'entry' ? 360 : 320 },
      onInspect: member.presentation === 'entry' && member.entry_view_id ? () => go(member.entry_view_id!) : node.edit_target || node.kind === 'unit_basis' ? () => onInspect(node) : undefined,
      content: member.presentation === 'entry' && member.entry_view_id ? preview(node, member.entry_view_id) : <section className="canvas-workbench-card">
        {node.summary.map(field => <p key={field.field}><strong>{field.label}</strong>：{field.text}</p>)}
        {node.kind === 'unit_config' && node.config_kind === 'dependencies' && node.dependency_evidence.map((evidence, index) => evidence.source && <SourceLinks key={index} sources={[evidence.source]} />)}
        {node.issues.map((issue, index) => <p role="status" key={`${issue.code}:${index}`}>{issue.message}</p>)}
        {node.kind === 'unit_references' && node.bindings.map(binding => {
          const preview = node.previews.find(item => item.binding_id === binding.id)
          return <section key={binding.id}>{preview ? <><p>{preview.display_name}</p><ReferencePreview reference={binding} preview={preview} /></> : <p role="status">固定参考预览尚未核实</p>}</section>
        })}
        {node.kind === 'unit_references' && <WorkbenchButton onClick={() => onReference(node.unit_id)}>编辑本单元参考</WorkbenchButton>}
        {node.kind === 'unit_basis' && <WorkbenchButton onClick={() => onInspect(node)}>查看执行依据</WorkbenchButton>}
        {node.edit_target && <WorkbenchButton onClick={() => onInspect(node)}>查看详情</WorkbenchButton>}
      </section> }]
  }) || []
  const edgeIds = new Set(view?.edge_ids)
  const relations = graph.edges.filter(edge => edgeIds.has(edge.id) && edge.kind === 'business' && edge.target)
    .map(edge => ({ from: edge.source, to: edge.target!, label: edge.label, category: edge.category }))
  const navigation = <nav className="canvas-director-browse canvas-unit-browse" aria-label="单元画布位置" data-graph-navigation>
    <WorkbenchIconButton label="后退" variant="quiet" icon={<ArrowLeftOutlined />} disabled={!canBrowse(-1)} onClick={() => navigate(-1)} />
    <WorkbenchIconButton label="前进" variant="quiet" icon={<ArrowRightOutlined />} disabled={!canBrowse(1)} onClick={() => navigate(1)} />
    <WorkbenchButton variant="quiet" onClick={() => go(filterView || rootViewId, filterView ? filter : '')}>单元画布</WorkbenchButton>
    {(!!params.get('unitView') || byId.get(view?.anchor_id || '')?.kind === 'unit') && <span className="canvas-director-location">› {view?.title || '单元不可用'}</span>}
    <Select aria-label="单元镜头筛选" value={filter} style={{ minWidth: 160 }} onChange={select}
      options={[{ value: '', label: '全部镜头' }, ...graph.nodes.flatMap(node => node.kind === 'shot_basis' ? [{ value: node.shot_id, label: node.title }] : [])]} />
    {pending && <span role="status">修改待同步</span>}
  </nav>
  return <>
    {navigationHost ? createPortal(navigation, navigationHost) : navigation}
    {!view ? <Alert type="warning" message="原浏览目标已不可用" action={<WorkbenchButton onClick={() => go(rootViewId, '')}>返回全部镜头</WorkbenchButton>} /> :
      <GraphCanvas contextKey={storageKey} ariaLabel="单元画布视口" objects={objects} relations={relations}
        groups={view.groups} layoutScope={{ storageKey, viewId: view.id, anchorId: view.anchor_id || '',
          validIds: graph.nodes.map(node => node.id), validViewIds: graph.views.map(candidate => candidate.id), arrange: arrangeUnitGraph, initialTop: window.innerWidth <= 700 ? 112 : 64 }} />}
  </>
}
