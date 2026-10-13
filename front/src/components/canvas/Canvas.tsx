import { useEffect, useId, useRef, useState } from 'react'
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react'
import { canvasConnection, fitCanvas } from './geometry'
import type { CanvasPoint, CanvasTransform } from './geometry'
import './canvas.css'

type TransformUpdate = CanvasTransform | ((previous: CanvasTransform) => CanvasTransform)

/** 自然排布的节点在尺寸稳定后测量连线；身份和布局上下文均由调用方提供。 */
export function useCanvasConnections(contextKey: string, edges: Array<{ id: string; from: string; to: string }>, layoutKey: string) {
  const container = useRef<HTMLDivElement>(null)
  const [lines, setLines] = useState<Array<{ id: string; from: string; to: string; d: string }>>([])
  const identity = JSON.stringify(edges)
  useEffect(() => {
    const root = container.current
    if (!root) return
    const measure = () => {
      const box = root.getBoundingClientRect()
      const positions = new Map([...root.querySelectorAll<HTMLElement>('[data-canvas-node]')].map(node => [node.dataset.canvasNode, node.getBoundingClientRect()]))
      setLines(edges.flatMap(edge => {
        const from = positions.get(edge.from), to = positions.get(edge.to)
        if (!from || !to) return []
        return [{ ...edge, ...canvasConnection({ left: from.left - box.left, top: from.top - box.top, width: from.width, height: from.height }, { left: to.left - box.left, top: to.top - box.top, width: to.width, height: to.height }) }]
      }))
    }
    const observer = new ResizeObserver(measure)
    observer.observe(root); root.querySelectorAll('[data-canvas-node]').forEach(node => observer.observe(node)); measure()
    return () => observer.disconnect()
  }, [contextKey, identity, layoutKey])
  return { container, lines }
}

/** 受控视口只回传浏览状态，调用方负责按精确上下文存取；不执行任何业务操作。 */
export function useCanvasViewport(contextKey: string, transform: CanvasTransform, onChange: (next: TransformUpdate) => void, content: CanvasPoint) {
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number }>()
  useEffect(() => { drag.current = undefined }, [contextKey])
  const fit = () => {
    const element = surface.current
    if (!element) return false
    const next = fitCanvas({ x: element.clientWidth, y: element.clientHeight }, content)
    if (next) onChange(next)
    return !!next
  }
  // 隐藏的初始画布等到有尺寸再适应；成功后停止观察，避免覆盖用户保存的视角。
  const fitWhenVisible = (onFit?: () => void) => {
    if (fit()) { onFit?.(); return }
    const element = surface.current
    if (!element) return
    const observer = new ResizeObserver(() => { if (fit()) { observer.disconnect(); onFit?.() } })
    observer.observe(element)
    return () => observer.disconnect()
  }
  const surfaceProps: HTMLAttributes<HTMLDivElement> = {
    tabIndex: 0,
    onKeyDown: event => {
      if (event.target !== event.currentTarget || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      event.preventDefault()
      onChange(previous => ({ ...previous, x: previous.x + (event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0), y: previous.y + (event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0) }))
    },
    onPointerDown: event => {
      // Portal 内弹窗/下拉框仍沿 React 树冒泡，不能把其选择动作当作画布平移。
      if (!event.currentTarget.contains(event.target as Node)) return
      if (event.button !== 0 || (event.target as Element).closest('button, [role=button], [data-canvas-node], input, select, textarea, a, audio, video')) return
      event.currentTarget.setPointerCapture(event.pointerId)
      drag.current = { x: event.clientX, y: event.clientY, left: transform.x, top: transform.y }
    },
    onPointerMove: event => {
      const current = drag.current
      if (current && event.currentTarget.hasPointerCapture(event.pointerId)) onChange(previous => ({ ...previous, x: current.left + event.clientX - current.x, y: current.top + event.clientY - current.y }))
    },
    onPointerUp: () => { drag.current = undefined },
    onPointerCancel: () => { drag.current = undefined },
    onLostPointerCapture: () => { drag.current = undefined },
  }
  return { surface, surfaceProps, fit, fitWhenVisible, zoom: (delta: number) => onChange(previous => ({ ...previous, scale: Math.max(.15, Math.min(2, previous.scale + delta)) })) }
}

export type CanvasTone = 'blue' | 'green' | 'rose' | 'violet' | 'amber' | 'neutral'
type NodeState = { nodeId: string; nodeType: string; tone?: CanvasTone; selected?: boolean; muted?: boolean; missing?: boolean; stale?: boolean }
const nodeClass = (state: NodeState, className = '') => `canvas-node ${className}${state.selected ? ' is-selected' : ''}${state.muted ? ' is-muted' : ''}${state.missing ? ' is-missing' : ''}${state.stale ? ' is-stale' : ''}`

/** 节点身份、类型和呈现状态分开；内容与合法动作由调用方提供。 */
export function CanvasNodeFrame({ nodeId, nodeType, tone = 'neutral', selected, muted, missing, stale, className, ...props }: NodeState & HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-canvas-node={nodeId} data-canvas-type={nodeType} data-canvas-tone={tone} className={nodeClass({ nodeId, nodeType, selected, muted, missing, stale }, `canvas-node-frame ${className || ''}`)} />
}

export function CanvasNodeButton({ nodeId, nodeType, tone = 'neutral', selected, muted, missing, stale, className, ...props }: NodeState & ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button {...props} type="button" data-canvas-node={nodeId} data-canvas-type={nodeType} data-canvas-tone={tone} aria-pressed={!!selected} className={nodeClass({ nodeId, nodeType, selected, muted, missing, stale }, className)} />
}

/** 布局移动有键盘替代；位移以内容坐标回传，不改对象顺序或引用。 */
export function CanvasDragHandle({ contextKey, label, offset, scale, onMove, className }: { contextKey: string; label: string; offset: CanvasPoint; scale: number; onMove: (point: CanvasPoint) => void; className?: string }) {
  const drag = useRef<{ x: number; y: number; left: number; top: number }>()
  useEffect(() => { drag.current = undefined }, [contextKey])
  return <button type="button" className={className} aria-label={`移动布局：${label}`} title="拖动调整布局，或用方向键移动" onPointerDown={event => {
    if (event.button !== 0) return
    event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, y: event.clientY, left: offset.x, top: offset.y }
  }} onPointerMove={event => {
    const current = drag.current
    if (current && event.currentTarget.hasPointerCapture(event.pointerId)) onMove({ x: current.left + (event.clientX - current.x) / scale, y: current.top + (event.clientY - current.y) / scale })
  }} onPointerUp={() => { drag.current = undefined }} onPointerCancel={() => { drag.current = undefined }} onLostPointerCapture={() => { drag.current = undefined }} onKeyDown={event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
    event.preventDefault(); event.stopPropagation()
    onMove({ x: offset.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), y: offset.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0) })
  }}>⠿</button>
}

/** 实线为直接关系，虚线仅为经真实路径的间接关系；问题与候选使用独立样式。 */
export function CanvasEdge({ d, label, indirect = false, selected = false, muted = false, onInspect, className, caption, tone = 'neutral' }: { d: string; label: string; indirect?: boolean; selected?: boolean; muted?: boolean; onInspect?: () => void; className?: string; tone?: CanvasTone; caption?: CanvasPoint & { text: string } }) {
  const markerId = useId().replace(/:/g, '')
  return <g className={`canvas-edge ${className || ''}`} data-canvas-tone={tone} data-selected={selected} opacity={muted ? .35 : 1} data-canvas-relation={indirect ? 'indirect' : 'direct'}>
    <path className="canvas-edge-line" d={d} fill="none" stroke="var(--canvas-edge-color)" strokeWidth={selected ? 2.5 : 1.5} strokeDasharray={indirect ? '5 4' : undefined} markerEnd={`url(#${markerId})`} />
    {onInspect && <path d={d} fill="none" stroke="transparent" strokeWidth={12} className="canvas-edge-hit" role="button" tabIndex={0} aria-label={label} onClick={onInspect} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onInspect() } }} />}
    <defs><marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" style={{ fill: 'var(--canvas-edge-color)', stroke: 'none' }} /></marker></defs>
    {caption && <text x={caption.x} y={caption.y} textAnchor="middle" fill="#667085" fontSize={12}>{caption.text}{indirect ? ' · 间接' : ''}</text>}
  </g>
}
