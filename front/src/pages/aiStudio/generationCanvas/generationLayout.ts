import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { GenerationCanvasGroup } from '../../../services/generated'
import type { GraphArrange, GraphSize } from '../directing/graphLayout'

type CanvasLayoutPlacement = {
  anchorId: string
  arrange: GraphArrange
  focus: (sizes: Record<string, GraphSize>, width: number, height: number) => { left: number; top: number; scale: number }
}

/** 宿主可为首次布局和主动整理提供位置及视口，公共画布保存实际坐标。 */
export type GenerationCanvasLayoutPolicy = {
  initial?: CanvasLayoutPlacement
  explicit?: CanvasLayoutPlacement
}

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

/** 可见卡片和收纳外框共同参与适应全部、小地图与放置避让。 */
export function generationVisibleFrames(visibleIds: readonly string[], groups: GenerationCanvasGroup[], point: (id: string) => CanvasPoint, sizes: Record<string, GraphSize>) {
  const cardFrames = visibleIds.map(id => ({ id, ...point(id), ...sizes[id] }))
  const groupFrames = new Map(groups.flatMap(group => {
    const members = (group.card_ids || []).filter(id => sizes[id])
    if (group.kind === 'stack' && !members.length) return []
    return [[group.id, generationGroupBounds(group, members, point, sizes)] as const]
  }))
  return { cardFrames, groupFrames }
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

/** 新提取成员用实际尺寸分行。已有坐标仍由用户控制。 */
export function placeStoryboardCards(positions: Record<string, CanvasPoint>, retained: Record<string, CanvasPoint>,
  groups: GenerationCanvasGroup[], origins: Record<string, unknown>, sizes: Record<string, GraphSize>) {
  const generated = groups.filter(group => group.kind !== 'stack' && group.card_ids?.some(id => origins[id] && !retained[id] && sizes[id]))
  if (!generated.length) return positions
  const added = new Set(generated.flatMap(group => (group.card_ids || []).filter(id => origins[id] && !retained[id])))
  const next = { ...positions }
  const start = 200, gap = 64
  let top = Math.max(0, ...Object.entries(positions).filter(([id]) => !added.has(id) && sizes[id])
    .map(([id, point]) => point.y + sizes[id].height + gap))
  for (const group of generated) {
    const ids = (group.card_ids || []).filter(id => added.has(id) && sizes[id])
    for (let offset = 0; offset < ids.length; offset += 3) {
      const row = ids.slice(offset, offset + 3)
      let left = start
      for (const id of row) {
        next[id] = { x: left, y: top }
        left += sizes[id].width + gap
      }
      top += Math.max(...row.map(id => sizes[id].height)) + gap
    }
  }
  return next
}
