import { graphNodeAppearance, GraphNodeType } from './graphAppearance'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Empty, Space } from 'antd'
import type { AssetSummary, ContinuityRead, ProductionPlan_Input, VideoReferenceCapabilities, WorkspaceRead } from '../../../services/generated'
import { buildProductionGraph, productionRelationEvidence, type ProductionGraphEdge, type ProductionGraphNode } from './productionGraph'
import { ReferencePreview } from './ReferencePreview'
import { revisionName } from './workspaceUsage'
import { referenceIssues } from './referenceInput'
import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import { CanvasDragHandle, CanvasEdge, CanvasNodeFrame, useCanvasViewport } from '../../../components/canvas/Canvas'
import { readableContext, readablePath } from './readableText'
import { canvasConnection, validCanvasOffsets, validCanvasTransform } from '../../../components/canvas/geometry'

type View = { selected?: string; focus?: string; x: number; y: number; scale: number; offsets: Record<string, { x: number; y: number }> }
const initial: View = { x: 0, y: 0, scale: 1, offsets: {} }
const edgeKey = (edge: ProductionGraphEdge) => JSON.stringify([edge.kind, edge.from, edge.to])
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
        return validCanvasTransform(row) && (row.selected === undefined || typeof row.selected === 'string') && (row.focus === undefined || typeof row.focus === 'string') && validCanvasOffsets(row.offsets)
      })) as Record<string, View>
    } catch { return {} }
  })
  const view = views[identity] || initial
  const change = (update: Partial<View> | ((previous: View) => Partial<View>)) => setViews(current => { const previous = current[identity] || initial; return { ...current, [identity]: { ...previous, ...(typeof update === 'function' ? update(previous) : update) } } })
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
  const { surface, surfaceProps, fit, fitWhenVisible, zoom } = useCanvasViewport(identity, view, next => change(previous => typeof next === 'function' ? next(previous) : next), { x: 1120, y: height })
  useEffect(() => {
    if (!active) return
    const element = surface.current
    if (!element) return
    if (!views[identity]) return fitWhenVisible()
  }, [identity, active, height])
  const [relation, setRelation] = useState<{ context: string; id: string }>()
  const relationTrigger = useRef<HTMLElement | SVGElement>()
  const selectedRelation = relation?.context === identity ? graph.edges.find(edge => edgeKey(edge) === relation.id) : undefined
  const inspect = (edge: ProductionGraphEdge) => {
    const element = document.activeElement
    if (element instanceof HTMLElement || element instanceof SVGElement) relationTrigger.current = element
    setRelation({ context: identity, id: edgeKey(edge) })
  }
  const choose = (node: ProductionGraphNode) => { change({ selected: node.id }); onSelect(node) }
  const unit = plan.units.find(row => row.id === unitId)
  const issues = referenceIssues(unit?.references || [], capability)
  return <section className="production-relation-graph design-graph-workspace" aria-label={overview ? '生产计划总览图' : '试拍关系图'}>
    {assetError && <Alert type="warning" message={assetError} action={<Button onClick={onRetryAssets}>重试读取资产</Button>} />}
    {continuityError && <Alert type="warning" message={continuityError} action={<Button onClick={onRetryContinuity}>重试核实落幅</Button>} />}
    {!overview && !!unit?.references.length && !capability && <p className="design-secondary">模型参考能力待核实；已选输入保留，提交前仍需检查。</p>}
    {focus && <div className="design-graph-tools"><Button onClick={() => change({ focus: undefined })}>退出聚焦</Button><span>{graph.nodes.find(node => node.id === focus)?.label}</span></div>}
    {!nodes.length ? <Empty description={overview ? '先添加生产单元' : '请选择拍摄单元'} /> : <div className="design-graph-surface production-graph-surface" ref={surface} aria-label={overview ? '生产计划关系画布' : '拍摄准备关系画布'} {...surfaceProps}>
      <div className="design-graph-canvas production-graph-canvas" style={{ width: 1120, height, transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
        <svg width={1120} height={height} aria-label="生产准备关系边">{graph.edges.map(edge => {
          const from = positions.get(edge.from), to = positions.get(edge.to)
          if (!from || !to) return null
          const line = canvasConnection({ left: from.x, top: from.y, width: 200, height: 180 }, { left: to.x, top: to.y, width: 200, height: 180 })
          const selected = view.selected === edge.from || view.selected === edge.to
          return <g key={`${edge.kind}:${edge.from}:${edge.to}`} data-edge-kind={edge.kind}><CanvasEdge d={line.d} selected={selected} indirect={edge.indirect} label={`${edgeLabels[edge.kind]}：${graph.nodes.find(node => node.id === edge.from)?.label} → ${graph.nodes.find(node => node.id === edge.to)?.label}`} onInspect={() => inspect(edge)} caption={{ x: line.x, y: line.y, text: edgeLabels[edge.kind] }} /></g>
        })}</svg>
        {nodes.map(node => {
          const position = positions.get(node.id)!
          const owner = plan.units.find(row => row.id === node.unitId)
          const references = node.referenceIds?.flatMap(id => owner?.references.find(row => row.id === id) || []) || []
          const previewLimit = references.some(reference => reference.media_kind === 'audio') ? 1 : 3
          const sourcePlan = workspace.plans.find(row => row.id === node.sourcePlanId)
          const sourceIndex = sourcePlan?.content.units.findIndex(row => row.id === node.sourceUnitId) ?? -1
          const nodeIssues = node.kind === 'reference' ? referenceIssues(references, capability) : node.kind === 'unit' ? issues : []
          return <CanvasNodeFrame key={node.id} nodeId={node.id} nodeType={node.kind} tone={graphNodeAppearance(node.kind).tone} selected={view.selected === node.id} missing={node.missing || !!nodeIssues.length} data-node-kind={node.kind} data-node-id={node.objectId} data-node-action={node.action} className={`design-graph-node production-graph-node node-${node.kind}${node.action ? ' is-add' : ''}`} style={{ left: position.x, top: position.y }}>
            <button className="design-node-select" aria-pressed={view.selected === node.id} disabled={disabled && node.action === 'add'} onClick={() => choose(node)}><GraphNodeType type={node.kind} /><strong>{node.label}</strong><span>{node.kind === 'unit' && modelName && !overview ? node.detail.replace('已选择模型', modelName) : node.detail}</span>{!!nodeIssues.length && <small>输入待处理 · {nodeIssues.length} 项</small>}{node.external && <small>固定来源 · {revisionName(workspace.plans, node.sourcePlanId || '', '计划')} · {sourceIndex >= 0 ? `单元 ${String(sourceIndex + 1).padStart(2, '0')}` : '来源单元不可用'}</small>}</button>
            {active && !!references.length && <div className="production-node-media">{references.slice(0, previewLimit).map(reference => <ReferencePreview key={reference.id} reference={reference} />)}{references.length > previewLimit && <button onClick={() => choose(node)}>查看全部 {references.length} 份素材</button>}</div>}
            <div className="design-node-actions"><button onClick={() => { change({ focus: node.id }); }}>聚焦</button><CanvasDragHandle contextKey={identity} className="design-node-drag" label={node.label} offset={view.offsets[node.id] || { x: 0, y: 0 }} scale={view.scale} onMove={point => change(previous => ({ offsets: { ...previous.offsets, [node.id]: point } }))} /></div>
            <span className="production-graph-connections">{graph.edges.filter(edge => edge.to === node.id || edge.from === node.id).map(edge => `${edgeLabels[edge.kind]}${edge.indirect ? '（间接）' : ''}：${graph.nodes.find(row => row.id === (edge.from === node.id ? edge.to : edge.from))?.label}`).join('；')}</span>
          </CanvasNodeFrame>
        })}
      </div>
    </div>}
    {!!graph.edges.length && <details className="production-graph-relation-list"><summary>全部生产关系 · {graph.edges.length}</summary><ul>{graph.edges.map(edge => <li key={edgeKey(edge)}><Button type="link" onClick={() => inspect(edge)}>{graph.nodes.find(node => node.id === edge.from)?.label} → {edgeLabels[edge.kind]}{edge.indirect ? '（间接）' : ''} → {graph.nodes.find(node => node.id === edge.to)?.label}</Button></li>)}</ul></details>}
    {selectedRelation && <section className="instruction-relation-detail" aria-label="生产关系说明"><header><h3>{edgeLabels[selectedRelation.kind]}{selectedRelation.indirect ? ' · 间接' : ' · 直接'}</h3><Button onClick={() => { setRelation(undefined); if (relationTrigger.current?.isConnected) relationTrigger.current.focus() }}>关闭关系说明</Button></header><p>{graph.nodes.find(node => node.id === selectedRelation.from)?.label} → {graph.nodes.find(node => node.id === selectedRelation.to)?.label}</p><p>依据所选计划及其固定设计；查看关系不会修改输入或依赖。</p><ol>{productionRelationEvidence(workspace, plan, graph, selectedRelation).map(row => <li key={`${row.target}:${row.path}`}>{row.target === 'design' ? readablePath(row.path, readableContext(workspace.designs.find(item => item.id === plan.design_revision_id)?.content)) : `计划字段 ${row.path}`}</li>)}</ol><Button onClick={() => { const owner = graph.nodes.find(node => node.id === (selectedRelation.kind === 'binding' ? selectedRelation.to : selectedRelation.from)); if (owner) choose(owner) }}>查看关联对象</Button></section>}
    <div className="design-graph-footer"><span>实线：明确引用 · 虚线：间接设计关联 · 移动仅调整布局</span><Space.Compact className="production-graph-scale"><Button aria-label="缩小关系图" onClick={() => zoom(-.1)}>−</Button><Button onClick={fit}>{Math.round(view.scale * 100)}%</Button><Button aria-label="放大关系图" onClick={() => zoom(.1)}>＋</Button><Button onClick={fit}>适应画布</Button></Space.Compact></div>
  </section>
}
