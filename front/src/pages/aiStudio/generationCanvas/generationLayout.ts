import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { GenerationCanvasGroup } from '../../../services/generated'
import type { GraphSize } from '../directing/graphLayout'

/** 编组和堆叠的可见外框同时用于绘制、连线和主动整理。 */
export function generationGroupBounds(group: GenerationCanvasGroup, members: readonly string[], point: (id: string) => CanvasPoint, sizes: Record<string, GraphSize>): CanvasPoint & GraphSize {
  if (group.kind === 'stack') return { ...point(members[0]), width: 400, height: 300 }
  const positions = members.map(point)
  const x = positions.length ? Math.min(...positions.map(pos => pos.x)) - 16 : 0
  const y = positions.length ? Math.min(...positions.map(pos => pos.y)) - 48 : 0
  if (group.collapsed) return { x, y, width: 300, height: 110 }
  return {
    x, y,
    width: Math.max(400, ...members.map(id => point(id).x + (sizes[id]?.width || 400) - x + 16)),
    height: Math.max(140, ...members.map(id => point(id).y + (sizes[id]?.height || 350) - y + 16)),
  }
}

/** 先纵排可见组织外框，再以真实行高、列宽整理普通卡。成员只做整体平移。 */
export function arrangeGenerationCards(ids: string[], groups: GenerationCanvasGroup[], previous: Record<string, CanvasPoint>, sizes: Record<string, GraphSize>) {
  const positions: Record<string, CanvasPoint> = {}
  const point = (id: string) => previous[id] || { x: 0, y: 0 }
  const live = new Set(ids)
  const left = 200, gap = 64, columnCount = 3
  let top = 0
  for (const group of groups) {
    const members = (group.card_ids || []).filter(id => live.has(id))
    if (!members.length) continue
    const bounds = generationGroupBounds(group, members, point, sizes)
    for (const id of members) {
      const origin = point(id)
      positions[id] = { x: left + origin.x - bounds.x, y: top + origin.y - bounds.y }
    }
    top += bounds.height + gap
  }

  const ordinary = ids.filter(id => !positions[id])
  const widths = [0, 0, 0], heights: number[] = []
  ordinary.forEach((id, index) => {
    const column = index % columnCount, row = Math.floor(index / columnCount)
    widths[column] = Math.max(widths[column], sizes[id].width)
    heights[row] = Math.max(heights[row] || 0, sizes[id].height)
  })
  const starts = (lengths: number[], start: number) => lengths.map(length => {
    const origin = start
    start += length + gap
    return origin
  })
  const columns = starts(widths, left), rows = starts(heights, top)
  ordinary.forEach((id, index) => {
    positions[id] = { x: columns[index % columnCount], y: rows[Math.floor(index / columnCount)] }
  })
  return positions
}
