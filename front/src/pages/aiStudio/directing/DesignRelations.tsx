import { graphNodeAppearance, GraphNodeType } from './graphAppearance'
import { createPortal } from 'react-dom'
import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import { useEffect, useMemo, useState } from 'react'
import { Button, Empty, Segmented, Space } from 'antd'
import type { SceneDesign_Input } from '../../../services/generated'
import { designObjects, scopeGraph, shotGraph, shotIssues } from './designWorkspace'
import type { DesignEdge, DesignScope } from './designWorkspace'
import { DesignSceneOverview } from './DesignSceneOverview'
import { CanvasDragHandle, CanvasEdge, CanvasNodeFrame, useCanvasViewport } from '../../../components/canvas/Canvas'
import { canvasConnection, validCanvasOffsets, validCanvasTransform } from '../../../components/canvas/geometry'

type Transform = { x: number; y: number; scale: number }
type GraphPosition = { focus?: string; transform: Transform; layoutKey?: string }
type GraphView = GraphPosition & { previous: GraphPosition[]; offsets: Record<string, { x: number; y: number }> }
/** 范围决定图内容，选择只更新详情；聚焦和画布位置不写入设计版本。 */
export function DesignRelations({ settingsTarget, value, emptyDescription, onClearFilters, scope = 'all', visibleShotIds, active = true, selected, onSelect, onBeatSelect, onUnassigned, onReturn, onLocate, onRelation, onEditRelations, rememberContext, revisionId, onIssue }: { settingsTarget?: HTMLElement;  emptyDescription?: string; onClearFilters?: () => void; value: SceneDesign_Input; onIssue?: (id: string, issue: string) => void; rememberContext?: { projectId: string; sequenceId: string }; revisionId?: string; scope?: DesignScope; visibleShotIds?: string[]; active?: boolean; selected?: string; onSelect: (key: string) => void; onBeatSelect: (id?: string) => void; onUnassigned: () => void; onReturn?: () => void; onLocate?: (id: string) => void; onRelation?: (edge: DesignEdge) => void; onEditRelations?: (key: string) => void }) {
  const [filter, setFilter] = useState(() => {
    if (rememberContext) try {
      const saved = JSON.parse(readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId).designGraph || '{}')
      if (saved.revisionId === revisionId && ['镜头关联', '人物调度', '完整关联'].includes(saved.filter)) return saved.filter as string
    } catch { /* 无效记录使用默认关系类型。 */ }
    return '镜头关联'
  })
  const [views, setViews] = useState<Record<string, GraphView>>(() => {
    if (!rememberContext) return {}
    try {
      const saved = JSON.parse(readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId).designGraph || '{}')
      if (saved.revisionId !== revisionId || !saved.views || typeof saved.views !== 'object') return {}
      const position = (row: GraphPosition) => row && (row.focus === undefined || typeof row.focus === 'string') && validCanvasTransform(row.transform) && (row.layoutKey === undefined || typeof row.layoutKey === 'string')
      return Object.fromEntries(Object.entries(saved.views).filter(([key, raw]) => {
        const row = raw as GraphView
        return (key === 'all' || key === 'unassigned' || key.startsWith('beat:')) && position(row) && Array.isArray(row.previous) && row.previous.every(position) && validCanvasOffsets(row.offsets)
      })) as Record<string, GraphView>
    } catch { return {} }
  })
  useEffect(() => { if (rememberContext) saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, { designGraph: JSON.stringify({ revisionId, filter, views }) }) }, [views, filter, revisionId, rememberContext?.projectId, rememberContext?.sequenceId])
  const initial: GraphView = { transform: { x: 0, y: 0, scale: 1 }, previous: [], offsets: {} }
  const current = views[scope] || initial
  const { focus, transform, offsets } = current
  const changeGraph = (update: (previous: GraphView) => GraphView) => setViews(previous => ({ ...previous, [scope]: update(previous[scope] || initial) }))
  const setTransform = (next: Transform | ((previous: Transform) => Transform)) => changeGraph(previous => ({ ...previous, transform: typeof next === 'function' ? next(previous.transform) : next }))
  const registry = useMemo(() => designObjects(value), [value])
  const scoped = useMemo(() => scopeGraph(value, scope, visibleShotIds), [value, scope, visibleShotIds])
  useEffect(() => { if (focus && !scoped.nodes.some(row => row.key === focus)) changeGraph(previous => ({ ...previous, focus: undefined, previous: [] })) }, [focus, scoped])
  const graph = useMemo(() => {
    if (!focus) return scoped
    if (focus.startsWith('shot:')) return shotGraph(value, focus.slice(5))
    const edges = scoped.edges.filter(edge => edge.from === focus || edge.to === focus)
    const keys = new Set([focus, ...edges.flatMap(edge => [edge.from, edge.to])])
    return { nodes: scoped.nodes.filter(node => keys.has(node.key)), edges }
  }, [focus, scoped, value])
  const aggregate = scope === 'all'
  const visible = graph.nodes.filter(node => node.key === focus || node.key.startsWith('shot:') || (filter === '镜头关联' ? !['camera', 'performance', 'dialogue', 'continuity', 'situation'].includes(node.key.split(':')[0]) : filter === '人物调度' ? ['blocking', 'participant', 'anchor', 'event'].includes(node.key.split(':')[0]) : true))
  const centers = visible.filter(node => focus ? node.key === focus : node.key.startsWith('shot:'))
  const left = visible.filter(node => !centers.includes(node) && ['beat', 'event'].includes(node.key.split(':')[0]))
  const outer = visible.filter(node => !centers.includes(node) && ['participant', 'anchor'].includes(node.key.split(':')[0]))
  const right = visible.filter(node => !centers.includes(node) && !left.includes(node) && !outer.includes(node))
  const canvasHeight = Math.max(580, Math.max(centers.length, left.length, right.length, outer.length) * 150 + 60)
  const positions = new Map<string, { x: number; y: number }>()
  for (const [nodes, x] of [[left, 30], [centers, 330], [right, 630], [outer, 920]] as const) nodes.forEach((node, i) => positions.set(node.key, { x, y: (i + 1) * canvasHeight / (nodes.length + 1) - 54 }))
  for (const [key, position] of positions) { const offset = offsets[key]; if (offset) positions.set(key, { x: position.x + offset.x, y: position.y + offset.y }) }
  const moveNode = (key: string, x: number, y: number) => changeGraph(previous => ({ ...previous, offsets: { ...previous.offsets, [key]: { x, y } } }))
  const { surface, surfaceProps, fit, fitWhenVisible, zoom } = useCanvasViewport(JSON.stringify([revisionId, scope]), transform, setTransform, { x: 1160, y: canvasHeight })
  const layoutKey = `${scope}:${focus || ''}:${filter}:${canvasHeight}`
  useEffect(() => {
    if (!active || aggregate) return
    if (current.layoutKey !== layoutKey) return fitWhenVisible(() => changeGraph(previous => ({ ...previous, layoutKey })))
  }, [active, aggregate, layoutKey])
  const focusOn = (key: string) => { if (key !== focus) changeGraph(previous => ({ ...previous, focus: key, previous: [...previous.previous, { focus, transform, layoutKey: previous.layoutKey }] })) }
  const unfocus = () => changeGraph(previous => ({ ...previous, ...(previous.previous[previous.previous.length - 1] || { focus: undefined, layoutKey: undefined }), previous: previous.previous.slice(0, -1) }))
  const controls = (!aggregate || onReturn) && <div className="design-graph-tools">{onReturn && <Button onClick={onReturn}>返回上一范围</Button>}{!aggregate && <Segmented value={filter} onChange={next => setFilter(String(next))} options={['镜头关联', '人物调度', '完整关联']} />}{!aggregate && selected?.startsWith('shot:') && focus !== selected && scoped.nodes.some(node => node.key === selected) && <Button onClick={() => focusOn(selected)}>聚焦所选镜头</Button>}{!aggregate && focus && <Button onClick={unfocus}>退出聚焦 · {registry.find(row => row.key === focus)?.label}</Button>}</div>
  return <div className="design-graph-workspace">
    {settingsTarget ? active && createPortal(controls, settingsTarget) : controls}
    {aggregate ? <DesignSceneOverview emptyDescription={emptyDescription} onClearFilters={onClearFilters} active={active} value={value} visibleShotIds={visibleShotIds} selected={selected} onSelect={onSelect} onEnter={next => next === 'unassigned' ? onUnassigned() : onBeatSelect(next.slice(5))} onIssue={onIssue} revisionId={revisionId} rememberContext={rememberContext} /> : <div ref={surface} className="design-graph-surface" aria-label="镜头关系画布" {...surfaceProps}>
      {!visible.length && <Empty description={emptyDescription || '当前范围没有关联镜头'}>{onClearFilters && <Button onClick={onClearFilters}>清除筛选</Button>}</Empty>}
      <div className="design-graph-canvas" style={{ width: 1160, height: canvasHeight, transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }}>
        <svg width={1160} height={canvasHeight} aria-label="对象关联边">{graph.edges.map(edge => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null
          const line = canvasConnection({ left: a.x, top: a.y, width: 200, height: 108 }, { left: b.x, top: b.y, width: 200, height: 108 })
          return <g key={JSON.stringify([edge.from, edge.to, edge.label, edge.indirect])} data-relation={edge.label}><CanvasEdge d={line.d} indirect={edge.indirect} label={`${edge.label}：${graph.nodes.find(node => node.key === edge.from)?.label || '缺失对象'} → ${graph.nodes.find(node => node.key === edge.to)?.label || '缺失对象'}`} onInspect={() => onRelation?.(edge)} caption={{ x: line.x, y: line.y, text: edge.label }} /></g>
        })}</svg>
        {visible.map(node => { const position = positions.get(node.key); if (!position) return null
          const issues = node.key.startsWith('shot:') ? shotIssues(value, node.key.slice(5)) : []
          const outside = scope.startsWith('beat:') && node.key.startsWith('beat:') && node.key !== scope
          return <CanvasNodeFrame key={node.key} nodeId={node.key} nodeType={node.key.split(':')[0]} tone={graphNodeAppearance(node.key.split(':')[0]).tone} selected={selected === node.key} missing={node.kind === 'missing'} data-graph-node={node.key} className={`design-graph-node node-${node.key.split(':')[0]}`} style={{ left: position.x, top: position.y }}>
            <button className="design-node-select" aria-pressed={selected === node.key} onClick={() => { const edge = node.kind === 'missing' ? graph.edges.find(row => row.to === node.key || row.from === node.key) : undefined; if (edge) onRelation?.(edge); else onSelect(node.key) }}><GraphNodeType type={node.key.split(':')[0]} /><strong>{node.label}</strong>{outside && <small>跨节拍关联</small>}</button>
            <div className="design-node-actions">{!!issues.length && onIssue && <button aria-label={`查看问题：${issues[0]}`} onClick={() => onIssue(node.key.slice(5), issues[0])}>问题 {issues.length}</button>}<CanvasDragHandle contextKey={JSON.stringify([revisionId, scope])} className="design-node-drag" label={node.label} offset={offsets[node.key] || { x: 0, y: 0 }} scale={transform.scale} onMove={point => moveNode(node.key, point.x, point.y)} />{node.kind !== 'missing' && <button onClick={() => focusOn(node.key)}>聚焦</button>}{node.key.startsWith('shot:') && <button onClick={() => onLocate?.(node.key.slice(5))}>定位镜头</button>}{node.kind !== 'missing' && <button onClick={() => onEditRelations?.(node.key)}>关联…</button>}{outside && <button onClick={() => onBeatSelect(node.key.slice(5))}>进入节拍</button>}</div>
          </CanvasNodeFrame>
        })}
      </div>
    </div>}
    {!aggregate && <div className="design-graph-footer"><span>实线：直接引用 · 虚线：间接关联</span><Space.Compact><Button aria-label="缩小关系图" onClick={() => zoom(-.1)}>−</Button><Button onClick={fit}>{Math.round(transform.scale * 100)}%</Button><Button aria-label="放大关系图" onClick={() => zoom(.1)}>＋</Button><Button onClick={fit}>适应画布</Button></Space.Compact></div>}
  </div>
}
