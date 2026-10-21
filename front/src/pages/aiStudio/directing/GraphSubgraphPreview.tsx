import type { ReactNode } from 'react'
import { canvasConnection } from '../../../components/canvas/geometry'
import type { CanvasPoint } from '../../../components/canvas/geometry'

/** 只读聚合预览使用实际视图几何，不读取业务正文或写入浏览缓存。 */
export function GraphSubgraphPreview({ nodes, edges, positions, purpose, status }: {
  nodes: { id: string; size: { width: number; height: number } }[]
  edges: { source: string; target?: string | null }[]
  positions: Record<string, CanvasPoint>
  purpose: ReactNode
  status: ReactNode
}) {
  const boxes = nodes.map(node => ({ ...(positions[node.id] || { x: 0, y: 0 }), ...node.size, id: node.id }))
  const left = boxes.length ? Math.min(...boxes.map(box => box.x)) : 0
  const top = boxes.length ? Math.min(...boxes.map(box => box.y)) : 0
  const right = boxes.length ? Math.max(...boxes.map(box => box.x + box.width)) : 360
  const bottom = boxes.length ? Math.max(...boxes.map(box => box.y + box.height)) : 152
  const byId = new Map(boxes.map(box => [box.id, box]))
  return <section className="canvas-workbench-card director-subgraph-card">
    <p className="director-subgraph-purpose" title={typeof purpose === 'string' ? purpose : undefined}>{purpose}</p>
    <p className="director-subgraph-status">{status}</p>
    <svg className="director-subgraph-preview" aria-hidden="true" focusable="false"
      viewBox={`${left - 24} ${top - 24} ${right - left + 48} ${bottom - top + 48}`} preserveAspectRatio="xMidYMid meet">
      {edges.map((edge, index) => {
        const from = byId.get(edge.source), to = edge.target && byId.get(edge.target)
        return from && to ? <path key={index} d={canvasConnection({ ...from, left: from.x, top: from.y }, { ...to, left: to.x, top: to.y }).d} /> : null
      })}
      {boxes.map(box => <rect key={box.id} x={box.x} y={box.y} width={box.width} height={box.height} rx="16" />)}
    </svg>
  </section>
}
