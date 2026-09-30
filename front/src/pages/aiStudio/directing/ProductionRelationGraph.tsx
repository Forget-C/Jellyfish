import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Space } from 'antd'
import type { AssetSummary, ContinuityRead, ProductionPlan_Input, VideoReferenceCapabilities, WorkspaceRead } from '../../../services/generated'
import { buildProductionGraph, type ProductionGraphNode } from './productionGraph'
import { ReferencePreview } from './ReferencePreview'
import { revisionName } from './workspaceUsage'
import { referenceIssues } from './referenceInput'
import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'

type View = { selected?: string; focus?: string; x: number; y: number; scale: number; offsets: Record<string, { x: number; y: number }> }
const initial: View = { x: 0, y: 0, scale: 1, offsets: {} }
const edgeLabels = { coverage: '覆盖', reference: '本次输入', dependency: '实际落幅依赖', context: '设计关联', binding: '主体／场所绑定' }

/** 当前单元的输入图与计划只读总览共用画布；节点选择与布局不修改业务关系。 */
export function ProductionRelationGraph({ workspace, planId, plan, unitId, assets, assetError, onRetryAssets, continuity, continuityError, onRetryContinuity, capability, modelName, overview = false, active = true, disabled = false, onSelect }: {
  workspace: WorkspaceRead; planId: string; plan: ProductionPlan_Input; unitId?: string;
  assets?: AssetSummary[]; assetError?: string; onRetryAssets?: () => void;
  continuity?: ContinuityRead; continuityError?: string; onRetryContinuity?: () => void;
  capability?: VideoReferenceCapabilities; modelName?: string; overview?: boolean; active?: boolean; disabled?: boolean;
  onSelect: (node: ProductionGraphNode) => void
}) {
  const identity = JSON.stringify([planId, overview ? 'overview' : unitId])
  const [views, setViews] = useState<Record<string, View>>(() => {
    try {
      const saved = JSON.parse(readWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id).productionGraph || '{}')
      return Object.fromEntries(Object.entries(saved).filter(([, value]) => {
        const row = value as View
        return row && [row.x, row.y, row.scale].every(Number.isFinite) && row.scale >= .15 && row.scale <= 2 && row.offsets && Object.values(row.offsets).every(offset => offset && Number.isFinite(offset.x) && Number.isFinite(offset.y))
      })) as Record<string, View>
    } catch { return {} }
  })
  const view = views[identity] || initial
  const change = (update: Partial<View>) => setViews(current => ({ ...current, [identity]: { ...current[identity] || initial, ...update } }))
  useEffect(() => {
    if (!views[identity]) return
    let saved = {}
    try { saved = JSON.parse(readWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id).productionGraph || '{}') } catch { /* 损坏的浏览记录不阻止操作。 */ }
    saveWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id, { productionGraph: JSON.stringify({ ...saved, [identity]: views[identity] }) })
  }, [views, identity, workspace.sequence.project_id, workspace.sequence.id])
  const graph = useMemo(() => overview || unitId ? buildProductionGraph(workspace, planId, plan, overview ? undefined : unitId, assets, continuity) : { nodes: [], edges: [] }, [workspace, planId, plan, unitId, overview, assets, continuity])
  const focus = graph.nodes.some(node => node.id === view.focus) ? view.focus : undefined
  const keys = focus ? new Set([focus, ...graph.edges.filter(edge => edge.from === focus || edge.to === focus).flatMap(edge => [edge.from, edge.to])]) : undefined
  const nodes = graph.nodes.filter(node => !keys || keys.has(node.id))
  const columns = [nodes.filter(node => node.kind === 'coverage'), nodes.filter(node => node.kind === 'unit'), nodes.filter(node => ['participant', 'location', 'dependency'].includes(node.kind)), nodes.filter(node => node.kind === 'reference')]
  const height = Math.max(540, ...columns.map(column => column.length * 220 + 50))
  const positions = new Map(columns.flatMap((column, index) => column.map((node, row) => [node.id, { x: index * 280 + 20 + (view.offsets[node.id]?.x || 0), y: row * 220 + 30 + (view.offsets[node.id]?.y || 0) }] as const)))
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number; node?: string }>()
  const fit = () => {
    const element = surface.current
    if (!element?.clientWidth || !element.clientHeight) return
    const scale = Math.max(.15, Math.min(1.2, element.clientWidth / 1120, element.clientHeight / height))
    change({ x: Math.max(0, (element.clientWidth - 1120 * scale) / 2), y: Math.max(0, (element.clientHeight - height * scale) / 2), scale })
  }
  useEffect(() => {
    if (!active) return
    const element = surface.current
    if (!element) return
    if (!views[identity]) fit()
    let width = element.clientWidth
    const observer = new ResizeObserver(() => { if (element.clientWidth && element.clientWidth !== width) { width = element.clientWidth; fit() } })
    observer.observe(element)
    return () => observer.disconnect()
  }, [identity, active, height])
  const choose = (node: ProductionGraphNode) => { change({ selected: node.id }); onSelect(node) }
  const unit = plan.units.find(row => row.id === unitId)
  const issues = referenceIssues(unit?.references || [], capability)
  return <section className="production-relation-graph design-graph-workspace" aria-label={overview ? '生产计划总览图' : '试拍关系图'}>
    {assetError && <Alert type="warning" message={assetError} action={<Button onClick={onRetryAssets}>重试读取资产</Button>} />}
    {continuityError && <Alert type="warning" message={continuityError} action={<Button onClick={onRetryContinuity}>重试核实落幅</Button>} />}
    {!overview && !!unit?.references.length && !capability && <p className="design-secondary">模型参考能力待核实；已选输入保留，提交前仍需检查。</p>}
    {focus && <div className="design-graph-tools"><Button onClick={() => change({ focus: undefined })}>退出聚焦</Button><span>{graph.nodes.find(node => node.id === focus)?.label}</span></div>}
    {!nodes.length ? <Empty description={overview ? '先添加生产单元' : '请选择拍摄单元'} /> : <div className="design-graph-surface production-graph-surface" ref={surface} tabIndex={0} aria-label={overview ? '生产计划关系画布' : '拍摄准备关系画布'} onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault(); change({ x: view.x + (event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0), y: view.y + (event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0) })
    }} onPointerDown={event => {
      if ((event.target as Element).closest('button, .production-graph-node, [role=button]')) return
      event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: view.x, top: view.y }
    }} onPointerMove={event => {
      const d = drag.current
      if (d && !d.node && event.currentTarget.hasPointerCapture(event.pointerId)) change({ x: d.left + event.clientX - d.x, y: d.top + event.clientY - d.y })
    }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }}>
      <div className="design-graph-canvas production-graph-canvas" style={{ width: 1120, height, transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
        <svg width={1120} height={height} aria-label="生产准备关系边">{graph.edges.map(edge => {
          const from = positions.get(edge.from), to = positions.get(edge.to)
          if (!from || !to) return null
          const reverse = from.x > to.x, x1 = from.x + (reverse ? 0 : 200), x2 = to.x + (reverse ? 200 : 0), y1 = from.y + 90, y2 = to.y + 90
          const d = `M${x1},${y1} C${(x1 + x2) / 2},${y1} ${(x1 + x2) / 2},${y2} ${x2},${y2}`
          const selected = view.selected === edge.from || view.selected === edge.to
          return <g key={`${edge.kind}:${edge.from}:${edge.to}`} data-edge-kind={edge.kind}><path d={d} stroke={selected ? '#1677ff' : '#8a99ad'} strokeWidth={selected ? 2.5 : 1.5} fill="none" strokeDasharray={edge.indirect ? '5 4' : undefined} /><path d={d} stroke="transparent" strokeWidth={12} fill="none" className="design-edge-hit" role="button" tabIndex={0} aria-label={`${edgeLabels[edge.kind]}：${graph.nodes.find(node => node.id === edge.from)?.label} → ${graph.nodes.find(node => node.id === edge.to)?.label}`} onClick={() => choose(graph.nodes.find(node => node.id === (edge.kind === 'binding' ? edge.to : edge.from))!)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(graph.nodes.find(node => node.id === (edge.kind === 'binding' ? edge.to : edge.from))!) } }} /><text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 8} textAnchor="middle" fill="#667085" fontSize={12}>{edgeLabels[edge.kind]}{edge.indirect ? ' · 间接' : ''}</text></g>
        })}</svg>
        {nodes.map(node => {
          const position = positions.get(node.id)!
          const owner = plan.units.find(row => row.id === node.unitId)
          const references = node.referenceIds?.flatMap(id => owner?.references.find(row => row.id === id) || []) || []
          const previewLimit = references.some(reference => reference.media_kind === 'audio') ? 1 : 3
          const sourcePlan = workspace.plans.find(row => row.id === node.sourcePlanId)
          const sourceIndex = sourcePlan?.content.units.findIndex(row => row.id === node.sourceUnitId) ?? -1
          const nodeIssues = node.kind === 'reference' ? referenceIssues(references, capability) : node.kind === 'unit' ? issues : []
          return <div key={node.id} data-node-kind={node.kind} data-node-id={node.objectId} data-node-action={node.action} className={`design-graph-node production-graph-node node-${node.kind === 'unit' ? 'shot' : node.kind === 'coverage' ? 'beat' : node.kind === 'dependency' ? 'anchor' : node.kind}${view.selected === node.id ? ' is-selected' : ''}${node.missing || nodeIssues.length ? ' is-missing' : ''}${node.action ? ' is-add' : ''}`} style={{ left: position.x, top: position.y }}>
            <button className="design-node-select" aria-pressed={view.selected === node.id} disabled={disabled && node.action === 'add'} onClick={() => choose(node)}><strong>{node.label}</strong><span>{node.kind === 'unit' && modelName && !overview ? node.detail.replace('已选择模型', modelName) : node.detail}</span>{!!nodeIssues.length && <small>输入待处理 · {nodeIssues.length} 项</small>}{node.external && <small>固定来源 · {revisionName(workspace.plans, node.sourcePlanId || '', '计划')} · {sourceIndex >= 0 ? `单元 ${String(sourceIndex + 1).padStart(2, '0')}` : '来源单元不可用'}</small>}</button>
            {active && !!references.length && <div className="production-node-media">{references.slice(0, previewLimit).map(reference => <ReferencePreview key={reference.id} reference={reference} />)}{references.length > previewLimit && <button onClick={() => choose(node)}>查看全部 {references.length} 份素材</button>}</div>}
            <div className="design-node-actions"><button onClick={() => { change({ focus: node.id }); }}>聚焦</button><button className="design-node-drag" aria-label={`移动布局：${node.label}`} onPointerDown={event => {
              event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const offset = view.offsets[node.id] || { x: 0, y: 0 }; drag.current = { node: node.id, x: event.clientX, y: event.clientY, left: offset.x, top: offset.y }
            }} onPointerMove={event => {
              const d = drag.current
              if (d?.node === node.id && event.currentTarget.hasPointerCapture(event.pointerId)) change({ offsets: { ...view.offsets, [node.id]: { x: d.left + (event.clientX - d.x) / view.scale, y: d.top + (event.clientY - d.y) / view.scale } } })
            }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }} onKeyDown={event => {
              if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
              event.preventDefault(); event.stopPropagation(); const offset = view.offsets[node.id] || { x: 0, y: 0 }; change({ offsets: { ...view.offsets, [node.id]: { x: offset.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), y: offset.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0) } } })
            }}>⠿</button></div>
            <span className="production-graph-connections">{graph.edges.filter(edge => edge.to === node.id || edge.from === node.id).map(edge => `${edgeLabels[edge.kind]}${edge.indirect ? '（间接）' : ''}：${graph.nodes.find(row => row.id === (edge.from === node.id ? edge.to : edge.from))?.label}`).join('；')}</span>
          </div>
        })}
      </div>
    </div>}
    <div className="design-graph-footer"><span>实线：明确引用 · 虚线：间接设计关联 · 移动仅调整布局</span><Space.Compact className="production-graph-scale"><Button aria-label="缩小关系图" onClick={() => change({ scale: Math.max(.15, view.scale - .1) })}>−</Button><Button onClick={fit}>{Math.round(view.scale * 100)}%</Button><Button aria-label="放大关系图" onClick={() => change({ scale: Math.min(2, view.scale + .1) })}>＋</Button><Button onClick={fit}>适应画布</Button></Space.Compact></div>
  </section>
}
