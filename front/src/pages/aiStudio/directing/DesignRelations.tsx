import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Empty, Segmented, Space } from 'antd'
import type { SceneDesign_Input } from '../../../services/generated'
import { designObjects, scopeGraph, shotGraph, shotIssues } from './designWorkspace'
import type { DesignEdge, DesignScope } from './designWorkspace'
import { DesignSceneOverview } from './DesignSceneOverview'

type Transform = { x: number; y: number; scale: number }
type GraphPosition = { focus?: string; transform: Transform; layoutKey?: string }
type GraphView = GraphPosition & { previous: GraphPosition[]; offsets: Record<string, { x: number; y: number }> }
/** 范围决定图内容，选择只更新详情；聚焦和画布位置不写入设计版本。 */
export function DesignRelations({ value, emptyDescription, onClearFilters, scope = 'all', visibleShotIds, active = true, selected, onSelect, onBeatSelect, onUnassigned, onReturn, onLocate, onRelation, onEditRelations, rememberContext, revisionId, onIssue }: { emptyDescription?: string; onClearFilters?: () => void; value: SceneDesign_Input; onIssue?: (id: string, issue: string) => void; rememberContext?: { projectId: string; sequenceId: string }; revisionId?: string; scope?: DesignScope; visibleShotIds?: string[]; active?: boolean; selected?: string; onSelect: (key: string) => void; onBeatSelect: (id?: string) => void; onUnassigned: () => void; onReturn?: () => void; onLocate?: (id: string) => void; onRelation?: (edge: DesignEdge) => void; onEditRelations?: (key: string) => void }) {
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
      const position = (row: GraphPosition) => row && (row.focus === undefined || typeof row.focus === 'string') && row.transform && [row.transform.x, row.transform.y, row.transform.scale].every(Number.isFinite) && row.transform.scale > 0 && (row.layoutKey === undefined || typeof row.layoutKey === 'string')
      return Object.fromEntries(Object.entries(saved.views).filter(([key, raw]) => {
        const row = raw as GraphView
        return (key === 'all' || key === 'unassigned' || key.startsWith('beat:')) && position(row) && Array.isArray(row.previous) && row.previous.every(position) && row.offsets && typeof row.offsets === 'object' && Object.values(row.offsets).every(offset => offset && Number.isFinite(offset.x) && Number.isFinite(offset.y))
      })) as Record<string, GraphView>
    } catch { return {} }
  })
  useEffect(() => { if (rememberContext) saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, { designGraph: JSON.stringify({ revisionId, filter, views }) }) }, [views, filter, revisionId, rememberContext?.projectId, rememberContext?.sequenceId])
  const initial: GraphView = { transform: { x: 0, y: 0, scale: 1 }, previous: [], offsets: {} }
  const current = views[scope] || initial
  const { focus, transform, offsets } = current
  const changeGraph = (update: (previous: GraphView) => GraphView) => setViews(previous => ({ ...previous, [scope]: update(previous[scope] || initial) }))
  const setTransform = (next: Transform | ((previous: Transform) => Transform)) => changeGraph(previous => ({ ...previous, transform: typeof next === 'function' ? next(previous.transform) : next }))
  const nodeDrag = useRef<{ key: string; x: number; y: number; left: number; top: number }>()
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number }>()
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
  const fit = () => {
    const element = surface.current
    if (!element?.clientWidth || !element.clientHeight) return
    const scale = Math.min(1.2, element.clientWidth / 1160, element.clientHeight / canvasHeight)
    setTransform({ x: Math.max(0, (element.clientWidth - 1160 * scale) / 2), y: Math.max(0, (element.clientHeight - canvasHeight * scale) / 2), scale })
  }
  const layoutKey = `${scope}:${focus || ''}:${filter}:${canvasHeight}`
  useEffect(() => {
    if (!active || aggregate) return
    if (current.layoutKey !== layoutKey) { fit(); changeGraph(previous => ({ ...previous, layoutKey })) }
  }, [active, aggregate, layoutKey])
  useEffect(() => {
    const element = surface.current
    if (!element) return
    let width = element.clientWidth, height = element.clientHeight
    const observer = new ResizeObserver(() => { if (!element.clientWidth || !element.clientHeight) return; if (width !== element.clientWidth || height !== element.clientHeight) { width = element.clientWidth; height = element.clientHeight; fit() } })
    observer.observe(element); return () => observer.disconnect()
  }, [aggregate, canvasHeight, scope])
  const focusOn = (key: string) => { if (key !== focus) changeGraph(previous => ({ ...previous, focus: key, previous: [...previous.previous, { focus, transform, layoutKey: previous.layoutKey }] })) }
  const unfocus = () => changeGraph(previous => ({ ...previous, ...(previous.previous[previous.previous.length - 1] || { focus: undefined, layoutKey: undefined }), previous: previous.previous.slice(0, -1) }))
  return <div className="design-graph-workspace">
    {(!aggregate || onReturn) && <div className="design-graph-tools">{onReturn && <Button onClick={onReturn}>返回上一范围</Button>}{!aggregate && <Segmented value={filter} onChange={next => setFilter(String(next))} options={['镜头关联', '人物调度', '完整关联']} />}{!aggregate && selected?.startsWith('shot:') && focus !== selected && scoped.nodes.some(node => node.key === selected) && <Button onClick={() => focusOn(selected)}>聚焦所选镜头</Button>}{!aggregate && focus && <Button onClick={unfocus}>退出聚焦 · {registry.find(row => row.key === focus)?.label}</Button>}</div>}
    {aggregate ? <DesignSceneOverview emptyDescription={emptyDescription} onClearFilters={onClearFilters} active={active} value={value} visibleShotIds={visibleShotIds} selected={selected} onSelect={onSelect} onEnter={next => next === 'unassigned' ? onUnassigned() : onBeatSelect(next.slice(5))} onIssue={onIssue} revisionId={revisionId} rememberContext={rememberContext} /> : <div ref={surface} className="design-graph-surface" tabIndex={0} aria-label="镜头关系画布" onKeyDown={event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault(); setTransform(t => ({ ...t, x: t.x + (event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0), y: t.y + (event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0) }))
    }} onPointerDown={event => { if ((event.target as Element).closest('button, [role=button], .design-graph-node')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: transform.x, top: transform.y } }} onPointerMove={event => { if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) { const d = drag.current; setTransform(t => ({ ...t, x: d.left + event.clientX - d.x, y: d.top + event.clientY - d.y })) } }} onPointerUp={() => { drag.current = undefined }}>
      {!visible.length && <Empty description={emptyDescription || '当前范围没有关联镜头'}>{onClearFilters && <Button onClick={onClearFilters}>清除筛选</Button>}</Empty>}
      <div className="design-graph-canvas" style={{ width: 1160, height: canvasHeight, transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }}>
        <svg width={1160} height={canvasHeight} aria-label="对象关联边">{graph.edges.map((edge, index) => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null
          const reverse = a.x > b.x, x1 = a.x + (reverse ? 0 : 200), x2 = b.x + (reverse ? 200 : 0), y1 = a.y + 54, y2 = b.y + 54
          const path = `M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`
          return <g key={index} data-relation={edge.label}><path d={path} fill="none" stroke="#8a99ad" strokeWidth="1.5" strokeDasharray={edge.indirect ? '5 4' : undefined} /><path d={path} fill="none" stroke="transparent" strokeWidth="12" className="design-edge-hit" role="button" tabIndex={0} aria-label={`${edge.label}：${graph.nodes.find(node => node.key === edge.from)?.label || '缺失对象'} → ${graph.nodes.find(node => node.key === edge.to)?.label || '缺失对象'}`} onClick={() => onRelation?.(edge)} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onRelation?.(edge) } }} /><text x={(x1+x2)/2} y={(y1+y2)/2-8} textAnchor="middle" fill="#667085" fontSize="12">{edge.label}{edge.indirect ? ' · 间接' : ''}</text></g>
        })}</svg>
        {visible.map(node => { const position = positions.get(node.key); if (!position) return null
          const issues = node.key.startsWith('shot:') ? shotIssues(value, node.key.slice(5)) : []
          const outside = scope.startsWith('beat:') && node.key.startsWith('beat:') && node.key !== scope
          return <div key={node.key} data-graph-node={node.key} className={`design-graph-node node-${node.key.split(':')[0]}${node.kind === 'missing' ? ' is-missing' : ''}${selected === node.key ? ' is-selected' : ''}`} style={{ left: position.x, top: position.y }}>
            <button className="design-node-select" aria-pressed={selected === node.key} onClick={() => { const edge = node.kind === 'missing' ? graph.edges.find(row => row.to === node.key || row.from === node.key) : undefined; if (edge) onRelation?.(edge); else onSelect(node.key) }}><strong>{node.label}</strong>{outside && <small>跨节拍关联</small>}</button>
            <div className="design-node-actions">{!!issues.length && onIssue && <button aria-label={`查看问题：${issues[0]}`} onClick={() => onIssue(node.key.slice(5), issues[0])}>问题 {issues.length}</button>}<button className="design-node-drag" aria-label={`移动布局：${node.label}`} title="拖动调整布局，或用方向键移动" onPointerDown={event => { event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId); const offset = offsets[node.key] || { x: 0, y: 0 }; nodeDrag.current = { key: node.key, x: event.clientX, y: event.clientY, left: offset.x, top: offset.y } }} onPointerMove={event => { const d = nodeDrag.current; if (d && event.currentTarget.hasPointerCapture(event.pointerId)) moveNode(d.key, d.left + (event.clientX - d.x) / transform.scale, d.top + (event.clientY - d.y) / transform.scale) }} onPointerUp={() => { nodeDrag.current = undefined }} onPointerCancel={() => { nodeDrag.current = undefined }} onKeyDown={event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); event.stopPropagation(); const offset = offsets[node.key] || { x: 0, y: 0 }; moveNode(node.key, offset.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), offset.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0)) }}>⠿</button>{node.kind !== 'missing' && <button onClick={() => focusOn(node.key)}>聚焦</button>}{node.key.startsWith('shot:') && <button onClick={() => onLocate?.(node.key.slice(5))}>定位镜头</button>}{node.kind !== 'missing' && <button onClick={() => onEditRelations?.(node.key)}>关联…</button>}{outside && <button onClick={() => onBeatSelect(node.key.slice(5))}>进入节拍</button>}</div>
          </div>
        })}
      </div>
    </div>}
    {!aggregate && <div className="design-graph-footer"><span>实线：直接引用 · 虚线：间接关联</span><Space.Compact><Button aria-label="缩小关系图" onClick={() => setTransform(t => ({ ...t, scale: Math.max(.15, t.scale - .1) }))}>−</Button><Button onClick={fit}>{Math.round(transform.scale * 100)}%</Button><Button aria-label="放大关系图" onClick={() => setTransform(t => ({ ...t, scale: Math.min(2, t.scale + .1) }))}>＋</Button><Button onClick={fit}>适应画布</Button></Space.Compact></div>}
  </div>
}
