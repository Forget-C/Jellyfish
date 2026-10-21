import { useEffect, useState } from 'react'
import type { CanvasView, DirectorCanvasGraph } from '../../../services/generated'
import { arrangeDirector, directorDesignNodeSize } from './directorLayout'
import { readStoredDirectorView } from './directorLayoutAdapter'
import { GraphSubgraphPreview } from './GraphSubgraphPreview'

/** 导演预览直接消费同一后端子图，业务计数不在浏览器重新聚合。 */
export function DirectorShotEntry({ authority, view, storageKey }: {
  authority: DirectorCanvasGraph; view: CanvasView; storageKey: string
}) {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const metadata = new Map(authority.nodes.map(node => [node.id, node]))
  const nodes = view.members.map(member => {
    const node = metadata.get(member.node_id)!
    const size = directorDesignNodeSize({ key: node.object.id, label: node.title,
      kind: member.presentation === 'reference' ? 'reference' : node.kind === 'design' ? node.editor_kind : node.kind,
      path: node.object.path || [] })
    return { id: member.node_id, group: member.group, size }
  })
  const sizes = Object.fromEntries(nodes.map(node => [node.id, node.size]))
  const stored = readStoredDirectorView(`${storageKey}:view:${view.id}`)
  const retained = Object.fromEntries(nodes.flatMap(node => stored?.positions[node.id] ? [[node.id, stored.positions[node.id]]] : []))
  const positions = arrangeDirector(nodes, sizes, width, view.anchor_id!, retained, stored?.sizes)
  const ids = new Set(view.edge_ids)
  return <GraphSubgraphPreview nodes={nodes} positions={positions}
    edges={authority.edges.filter(edge => ids.has(edge.id) && edge.kind === 'business')}
    purpose="逐镜设计与全部岗位工作单"
    status={`设计对象 ${view.card_count} · 共享引用 ${view.reference_count} · 待处理 ${view.issue_count}`} />
}
