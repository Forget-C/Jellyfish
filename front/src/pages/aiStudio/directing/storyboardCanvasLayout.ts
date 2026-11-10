import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { CanvasDocument, GenerationCanvasGroup } from '../../../services/generated'
import { generationGroupBounds, type GenerationCanvasLayoutPolicy } from '../generationCanvas/generationLayout'
import type { GraphSize } from './graphLayout'

const gap = 64
const narrowWidth = 700

const rowWidth = (row: string[], sizes: Record<string, GraphSize>) =>
  row.reduce((width, id) => width + sizes[id].width + gap, 0) - gap

function videoRows(shots: string[][], sizes: Record<string, GraphSize>, width: number) {
  const limit = width <= narrowWidth ? 0 : width - 160
  const rows: string[][] = []
  let row: string[] = []
  const nextRow = () => { if (row.length) rows.push(row); row = [] }
  for (const videos of shots) {
    // 放得下的同镜头片段一起换行，较长镜头仍按顺序分行。
    if (row.length && rowWidth(videos, sizes) <= limit && rowWidth([...row, ...videos], sizes) > limit) nextRow()
    for (const id of videos) {
      if (row.length && rowWidth([...row, id], sizes) > limit) nextRow()
      row.push(id)
    }
  }
  nextRow()
  return rows
}

function placeVideoRows(shots: string[][], sizes: Record<string, GraphSize>, width: number) {
  const positions: Record<string, CanvasPoint> = {}
  const rows = videoRows(shots, sizes, width)
  let top = 0
  for (const row of rows) {
    let left = 0
    for (const id of row) {
      positions[id] = { x: left, y: top }
      left += sizes[id].width + gap
    }
    top += Math.max(...row.map(id => sizes[id].height)) + gap
  }
  return { positions, mainWidth: Math.max(...rows.map(row => rowWidth(row, sizes))) }
}

/** 工作台按镜头关系组织视频，普通入口不使用该策略。 */
export function storyboardCanvasLayout(document: CanvasDocument, beforeApplication?: CanvasDocument): GenerationCanvasLayoutPolicy | undefined {
  if (!document.storyboard) return
  const hidden = new Set(document.groups?.filter(group => group.kind === 'stack' || group.collapsed).flatMap(group => group.card_ids || []))
  const videos = new Set(document.cards?.filter(card => card.type === 'model.video' && !hidden.has(card.id)).map(card => card.id))
  const shots = document.storyboard.shots.map(shot => shot.model_card_ids.filter(id => videos.has(id))).filter(row => row.length)
  const anchorId = shots[0]?.[0]
  if (!anchorId) return
  const focus = (sizes: Record<string, GraphSize>, width: number, height: number) => {
    const card = sizes[anchorId]
    if (width > narrowWidth) {
      const first = videoRows(shots, sizes, width)[0]
      return { left: Math.max(80, (width - rowWidth(first, sizes)) / 2), top: 180, scale: 1 }
    }
    // 窄屏为左侧添加栏、顶部工具栏和底部视图工具保留操作空间。
    const scale = Math.max(.15, Math.min(1, (width - 96) / card.width, (height - 300) / card.height))
    return { left: 80, top: Math.max(150, (height - card.height * scale) / 2), scale }
  }
  const firstApplication = beforeApplication && !beforeApplication.storyboard &&
    !beforeApplication.cards?.some(card => card.id !== beforeApplication.fixed_source?.card_id)
  return { initial: firstApplication ? {
    anchorId,
    arrange: (nodes, sizes, width) => {
      const { positions, mainWidth } = placeVideoRows(shots, sizes, width)
      const stacks = document.groups?.filter(group => group.kind === 'stack') || []
      let leftTop = 0, rightTop = 0
      for (const stack of stacks) {
        const members = (stack.card_ids || []).filter(id => sizes[id])
        if (!members.length) continue
        const shot = document.storyboard?.shots.find(item => members.includes(item.card_id))
        const cover = generationGroupBounds(stack, members, () => ({ x: 0, y: 0 }), sizes)
        const anchor = shot && positions[shot.model_card_ids[0]]
        const y = shot ? Math.max(rightTop, anchor?.y || 0) : leftTop
        const firstWidth = Math.max(cover.width, sizes[members[0]].width)
        let x = shot ? mainWidth + gap : -firstWidth - gap
        // 堆叠成员解除后在外围展开，封面和隐藏成员都不占用视频主区。
        members.forEach((id, index) => {
          if (!shot && index > 0) x -= sizes[id].width + gap
          positions[id] = { x, y }
          if (shot) x += (index === 0 ? firstWidth : sizes[id].width) + gap
        })
        const bottom = y + Math.max(cover.height, ...members.map(id => sizes[id].height)) + gap
        if (shot) rightTop = bottom
        else leftTop = bottom
      }
      const shotGroups = new Set(document.storyboard?.shots.map(shot => shot.group_id))
      const shotCards = new Set(document.groups?.filter(group => shotGroups.has(group.id)).flatMap(group => group.card_ids || []))
      for (const { id } of nodes) {
        if (positions[id]) continue
        if (shotCards.has(id)) {
          positions[id] = { x: mainWidth + gap, y: rightTop }
          rightTop += sizes[id].height + gap
        } else {
          positions[id] = { x: -sizes[id].width - gap, y: leftTop }
          leftTop += sizes[id].height + gap
        }
      }
      return positions
    },
    focus,
  } : undefined, explicit: {
    anchorId,
    focus,
    arrange: (nodes, sizes, width, _anchor, previous = {}) => {
      const { positions, mainWidth } = placeVideoRows(shots, sizes, width)
      const live = new Set(nodes.map(node => node.id))
      const shotGroups = new Set(document.storyboard?.shots.map(shot => shot.group_id))
      const shotCards = new Set(document.storyboard?.shots.map(shot => shot.card_id))
      const point = (id: string) => previous[id] ?? { x: 0, y: 0 }
      let leftTop = 0, rightTop = 0
      // 侧区按整个组织移动辅助成员，解除堆叠时保留原相对位置。
      const place = (members: string[], right: boolean, group?: GenerationCanvasGroup) => {
        const frames = members.map(id => ({ ...point(id), ...sizes[id] }))
        if (group) frames.push(generationGroupBounds(group, members, point, sizes))
        const minX = Math.min(...frames.map(frame => frame.x))
        const minY = Math.min(...frames.map(frame => frame.y))
        const maxX = Math.max(...frames.map(frame => frame.x + frame.width))
        const maxY = Math.max(...frames.map(frame => frame.y + frame.height))
        const x = right ? mainWidth + gap : minX - maxX - gap
        const y = right ? rightTop : leftTop
        for (const id of members) positions[id] = { x: x + point(id).x - minX, y: y + point(id).y - minY }
        if (right) rightTop += maxY - minY + gap
        else leftTop += maxY - minY + gap
      }
      for (const group of document.groups || []) {
        const members = (group.card_ids || []).filter(id => live.has(id) && !positions[id])
        if (members.length) place(members, shotGroups.has(group.id) || members.some(id => shotCards.has(id)), group)
      }
      for (const { id } of nodes) if (!positions[id]) place([id], false)
      return positions
    },
  } }
}
