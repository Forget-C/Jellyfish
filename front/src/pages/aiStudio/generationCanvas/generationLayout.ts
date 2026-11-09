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
