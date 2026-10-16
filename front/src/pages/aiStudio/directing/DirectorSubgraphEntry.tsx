import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { SceneDesign_Input } from '../../../services/generated'
import { canvasConnection } from '../../../components/canvas/geometry'
import { designCard } from './designCard'
import { designAt } from './designValue'
import { departmentNames, designDomain, designObjectLayoutId, directorDesignGraph } from './designWorkspace'
import type { DesignDomain, DesignObject } from './designWorkspace'
import { arrangeDirector, fixedDirectorSize } from './directorLayout'
import { readStoredDirectorView } from './useDirectorLayout'

const descriptions: Record<DesignDomain, string> = {
  direction: '叙事、空间与镜头设计', performance: '人物情境与节拍表演', staging: '环境活动、留白与镜内执行',
  cinematography: '构图、机位、运动与光线', continuity: '空间、造型、道具与声画连续性', sound: '声音安排与对白', prompt: '提示词编译要求与约束',
}

/** 正式卡与预览共用尺寸、分区，避免缩略图使用另一套假布局。 */
export function directorDesignNodeSize(node: DesignObject) {
  if (node.kind === 'summary' || node.kind === 'reference' && designDomain(node.key)) return { width: 360, height: 276 }
  if (node.kind === 'reference') return { width: 360, height: 152 }
  if (!node.key.includes(':') || node.key.startsWith('participant:')) return { width: 360, height: 276 }
  if (/^(dialogue|criterion):/.test(node.key)) return { width: 360, height: 232 }
  return fixedDirectorSize(node.key) || { width: 360, height: 216 }
}
export const directorDesignNodeGroup = (value: SceneDesign_Input, node: DesignObject) => node.kind === 'reference' ? 'references'
  : node.key.startsWith('continuity:') ? `continuity_${designAt(value, node.path)?.domain}` : undefined

/** 入口只展示真实目标的用途、状态与模糊布局；整卡进入与明确的快捷操作分别处理。 */
export function DirectorSubgraphEntry({ value, saved, domain, scope, shotId, storageKey, purpose, temporaryKey, children }: {
  value: SceneDesign_Input; saved: SceneDesign_Input; domain: DesignDomain; scope: 'all' | 'shot'; shotId?: string
  storageKey: string; purpose?: string; temporaryKey?: string; children?: ReactNode
}) {
  const [width, setWidth] = useState(window.innerWidth)
  useEffect(() => {
    const resize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const graph = directorDesignGraph(value, { domain, scope, shotId, temporaryKey })
  const members = graph.groups.find(group => group.domain === domain)!.members
  const cards = members.map(member => designCard(value, member, saved))
  const issues = cards.reduce((count, card) => count + card.issues.length, 0)
  const viewId = `${domain}:${scope === 'shot' ? `shot:${shotId}` : 'all'}`
  const stored = readStoredDirectorView(`${storageKey}:view:${viewId}`)
  const nodes = graph.nodes.map(node => ({ id: designObjectLayoutId(value, node), group: directorDesignNodeGroup(value, node), size: directorDesignNodeSize(node) }))
  const sizes = Object.fromEntries(nodes.map(node => [node.id, node.size]))
  const retained = Object.fromEntries(nodes.flatMap(node => stored?.positions[node.id] ? [[node.id, stored.positions[node.id]]] : []))
  const positions = arrangeDirector(nodes, sizes, width, members[0] ? designObjectLayoutId(value, members[0]) : '', retained, stored?.sizes)
  const boxes = nodes.map(node => ({ ...positions[node.id], ...node.size, id: node.id }))
  const left = boxes.length ? Math.min(...boxes.map(box => box.x)) : 0, top = boxes.length ? Math.min(...boxes.map(box => box.y)) : 0
  const right = boxes.length ? Math.max(...boxes.map(box => box.x + box.width)) : 360, bottom = boxes.length ? Math.max(...boxes.map(box => box.y + box.height)) : 152
  const box = (key: string) => {
    const node = graph.nodes.find(node => node.key === key)
    return node && boxes.find(box => box.id === designObjectLayoutId(value, node))
  }
  return <section className="canvas-workbench-card director-subgraph-card">
    <p className="director-subgraph-purpose">{purpose || descriptions[domain]}{purpose && <span> · 归属：{departmentNames[domain]}</span>}</p>
    <p className="director-subgraph-status">{scope === 'shot' ? '当前镜头' : '整场'} · 子图成员 {members.length} · 待处理 {issues}{cards.some(card => card.dirty) && ' · 有未保存修改'}</p>
    {children}
    {!members.length && <p>尚无工作单</p>}
    <svg className="director-subgraph-preview" aria-hidden="true" focusable="false" viewBox={`${left - 24} ${top - 24} ${right - left + 48} ${bottom - top + 48}`} preserveAspectRatio="xMidYMid meet">
      {graph.edges.map((edge, index) => {
        const from = box(edge.from), to = box(edge.to)
        return from && to ? <path key={index} d={canvasConnection({ ...from, left: from.x, top: from.y }, { ...to, left: to.x, top: to.y }).d} /> : null
      })}
      {boxes.map(box => <rect key={box.id} x={box.x} y={box.y} width={box.width} height={box.height} rx="16" />)}
    </svg>
  </section>
}
