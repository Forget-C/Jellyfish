import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Segmented, Space } from 'antd'
import type { SceneDesign_Input } from '../../../services/generated'
import { shotGraph } from './designWorkspace'
import { noteText } from './DesignFields'

/** 关系图是设计引用的只读投影；缩放和平移不进入业务版本。 */
export function DesignRelations({ value, shotId, onSelect }: { value: SceneDesign_Input; shotId?: string; onSelect: (key: string) => void }) {
  const [filter, setFilter] = useState('镜头关联')
  const [all, setAll] = useState(false)
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const surface = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; left: number; top: number }>()
  const graph = useMemo(() => shotGraph(value, shotId || value.direction.shots[0]?.id), [value, shotId])
  const visible = graph.nodes.filter(node => node.key.startsWith('shot:') || (filter === '镜头关联' ? !['camera', 'performance', 'dialogue', 'continuity', 'situation'].includes(node.key.split(':')[0]) : filter === '人物调度' ? ['blocking', 'participant', 'anchor', 'event'].includes(node.key.split(':')[0]) : true))
  const center = visible.find(node => node.key.startsWith('shot:'))
  const left = visible.filter(node => ['beat', 'event'].includes(node.key.split(':')[0]))
  const right = visible.filter(node => !node.key.startsWith('shot:') && !left.includes(node) && !['participant', 'anchor'].includes(node.key.split(':')[0])).sort((a, b) => Number(b.key.startsWith('blocking:')) - Number(a.key.startsWith('blocking:')))
  const outer = visible.filter(node => ['participant', 'anchor'].includes(node.key.split(':')[0]))
  const positions = new Map<string, { x: number; y: number }>()
  const canvasHeight = Math.max(620, Math.max(left.length, right.length, outer.length) * 140 + 80)
  if (center) positions.set(center.key, { x: 360, y: canvasHeight / 2 - 44 })
  for (const [nodes, x] of [[left, 60], [right, 650], [outer, 910]] as const) nodes.forEach((node, i) => positions.set(node.key, { x, y: (i + 1) * canvasHeight / (nodes.length + 1) - 44 }))
  const fit = () => { if (surface.current) { const scale = Math.min(1.2, surface.current.clientWidth / 1140, surface.current.clientHeight / canvasHeight); setTransform({ x: Math.max(0, (surface.current.clientWidth - 1140 * scale) / 2), y: Math.max(0, (surface.current.clientHeight - canvasHeight * scale) / 2), scale }) } }
  useEffect(() => { fit() }, [shotId, filter, all, canvasHeight])
  useEffect(() => { const observer = new ResizeObserver(fit); if (surface.current) observer.observe(surface.current); return () => observer.disconnect() }, [canvasHeight])
  return <div className="design-graph-workspace">
    <div className="design-graph-tools"><Segmented value={filter} onChange={value => setFilter(String(value))} options={['镜头关联', '人物调度', '完整关联']} /><Button onClick={() => setAll(!all)}>{all ? '聚焦当前镜头' : '全场节拍'}</Button></div>
    {all ? <div className="design-beat-map">{value.direction.beats.map((beat, index) => <section key={beat.id}><h3>节拍 {index + 1} · {noteText(beat.objective) || '待明确'}</h3><p>{value.direction.shots.filter(s => s.beat_ids.includes(beat.id)).length} 个关联镜头</p>{value.direction.shots.filter(s => s.beat_ids.includes(beat.id)).map(shot => <Button key={shot.id} onClick={() => { onSelect(`shot:${shot.id}`); setAll(false) }}>镜头 {value.direction.shots.indexOf(shot) + 1} · {noteText(shot.visible_result)}</Button>)}</section>)}</div> : <div ref={surface} className="design-graph-surface" tabIndex={0} aria-label="镜头关系画布" onKeyDown={event => {
      if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) { event.preventDefault(); setTransform(t => ({ ...t, x: t.x + (event.key === 'ArrowLeft' ? 30 : event.key === 'ArrowRight' ? -30 : 0), y: t.y + (event.key === 'ArrowUp' ? 30 : event.key === 'ArrowDown' ? -30 : 0) })) }
    }} onPointerDown={event => { if ((event.target as Element).closest('button')) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, left: transform.x, top: transform.y } }} onPointerMove={event => { if (drag.current && event.currentTarget.hasPointerCapture(event.pointerId)) { const d = drag.current; setTransform(t => ({ ...t, x: d.left + event.clientX - d.x, y: d.top + event.clientY - d.y })) } }} onPointerUp={() => { drag.current = undefined }}>
      <div className="design-graph-canvas" style={{ width: 1140, height: canvasHeight, transform: `translate(${transform.x}px,${transform.y}px) scale(${transform.scale})` }}>
        <svg width={1140} height={canvasHeight} aria-label="对象关联边"><defs><marker id="design-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#8a99ad" /></marker></defs>{graph.edges.map((edge, index) => {
          const a = positions.get(edge.from), b = positions.get(edge.to); if (!a || !b) return null
          const reverse = a.x > b.x; const x1 = a.x + (reverse ? 0 : 170), x2 = b.x + (reverse ? 170 : 0), y1 = a.y + 44, y2 = b.y + 44
          return <g key={index} data-relation={edge.label}><path d={`M${x1},${y1} C${(x1+x2)/2},${y1} ${(x1+x2)/2},${y2} ${x2},${y2}`} fill="none" stroke="#8a99ad" strokeWidth="1.5" strokeDasharray={edge.indirect ? '5 4' : undefined} markerEnd="url(#design-arrow)" /><text x={(x1+x2)/2} y={(y1+y2)/2-10} textAnchor="middle" fill="#667085" fontSize="13">{edge.label}{edge.indirect ? ' · 间接' : ''}</text></g>
        })}</svg>
        {visible.map(node => { const p = positions.get(node.key); return p && <button key={node.key} data-graph-node={node.key} className={`design-graph-node node-${node.key.split(':')[0]}${node.kind === 'missing' ? ' is-missing' : ''}`} style={{ left: p.x, top: p.y }} title={node.label} onClick={() => { if (node.path.length) onSelect(node.key) }}><span className="design-node-symbol">{node.key.startsWith('shot:') ? '▣' : node.key.startsWith('beat:') ? '▤' : node.key.startsWith('participant:') ? '●' : '◇'}</span><strong>{node.label}</strong></button> })}
      </div>
    </div>}
    <div className="design-graph-footer"><span>实线：直接引用 · 虚线：经节拍或事件的间接关联</span><Space.Compact><Button aria-label="缩小关系图" onClick={() => setTransform(t => ({ ...t, scale: Math.max(.2, t.scale - .1) }))}>−</Button><Button onClick={fit}>{Math.round(transform.scale * 100)}%</Button><Button aria-label="放大关系图" onClick={() => setTransform(t => ({ ...t, scale: Math.min(2, t.scale + .1) }))}>＋</Button><Button onClick={fit}>适应画布</Button></Space.Compact></div>
  </div>
}
