import { useEffect, useState } from 'react'
import type { SceneDesign_Input } from '../../../services/generated'
import { canvasConnection } from '../../../components/canvas/geometry'
import { designCard } from './designCard'
import { designObjectLayoutId } from './designWorkspace'
import type { shotCanvasGraph } from './designWorkspace'
import { arrangeDirector, shotDesignGroup } from './directorLayout'
import { directorDesignNodeSize } from './directorLayout'
import { readStoredDirectorView } from './useDirectorLayout'

/** 镜头入口预览实际子图卡片与关系，不读取或写入业务数据。 */
export function DirectorShotEntry({ value, saved, shotId, storageKey, graph }: {
  value: SceneDesign_Input; saved: SceneDesign_Input; shotId: string; storageKey: string; graph: ReturnType<typeof shotCanvasGraph>
}) {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const cards = graph.nodes.filter(node => node.kind !== 'reference' && node.kind !== 'missing').map(node => designCard(value, node, saved))
  const nodes = graph.nodes.map(node => ({ id: designObjectLayoutId(value, node), group: shotDesignGroup(node.key, node.kind, shotId), size: directorDesignNodeSize(node) }))
  const sizes = Object.fromEntries(nodes.map(node => [node.id, node.size]))
  const stored = readStoredDirectorView(`${storageKey}:view:shot:${shotId}`)
  const retained = Object.fromEntries(nodes.flatMap(node => stored?.positions[node.id] ? [[node.id, stored.positions[node.id]]] : []))
  const positions = arrangeDirector(nodes, sizes, width, designObjectLayoutId(value, graph.nodes.find(node => node.key === `shot:${shotId}`)!), retained, stored?.sizes)
  const boxes = nodes.map(node => ({ ...positions[node.id], ...node.size, id: node.id }))
  const left = boxes.length ? Math.min(...boxes.map(box => box.x)) : 0, top = boxes.length ? Math.min(...boxes.map(box => box.y)) : 0
  const right = boxes.length ? Math.max(...boxes.map(box => box.x + box.width)) : 360, bottom = boxes.length ? Math.max(...boxes.map(box => box.y + box.height)) : 152
  const box = (key: string) => {
    const node = graph.nodes.find(node => node.key === key)
    return node && boxes.find(box => box.id === designObjectLayoutId(value, node))
  }
  return <section className="canvas-workbench-card director-subgraph-card">
    <p className="director-subgraph-purpose">逐镜设计与全部岗位工作单</p>
    <p className="director-subgraph-status">设计对象 {cards.length} · 共享引用 {graph.nodes.filter(node => node.kind === 'reference').length} · 待处理 {cards.reduce((count, card) => count + card.issues.length, 0)}{cards.some(card => card.dirty) && ' · 有未保存修改'}</p>
    <svg className="director-subgraph-preview" aria-hidden="true" focusable="false" viewBox={`${left - 24} ${top - 24} ${right - left + 48} ${bottom - top + 48}`} preserveAspectRatio="xMidYMid meet">
      {graph.edges.map((edge, index) => {
        const from = box(edge.from), to = box(edge.to)
        return from && to ? <path key={index} d={canvasConnection({ ...from, left: from.x, top: from.y }, { ...to, left: to.x, top: to.y }).d} /> : null
      })}
      {boxes.map(box => <rect key={box.id} x={box.x} y={box.y} width={box.width} height={box.height} rx="16" />)}
    </svg>
  </section>
}
