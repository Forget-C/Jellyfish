import type { CanvasPoint, CanvasTransform } from '../../../components/canvas/geometry'

export type GraphSize = { width: number; height: number }
export type GraphLayoutNode = { id: string; group?: string; size?: GraphSize }
export type GraphView = { transform: CanvasTransform; positions: Record<string, CanvasPoint>; sizes: Record<string, GraphSize>; layoutVersion?: number; manuallyPlaced?: string[] }
export type GraphArrange = (nodes: GraphLayoutNode[], sizes: Record<string, GraphSize>, viewportWidth: number,
  anchor: string, retained?: Record<string, CanvasPoint>, previousSizes?: Record<string, GraphSize>) => Record<string, CanvasPoint>

/** 本地浏览数据只承载有限几何，不影响业务内容或保存状态。 */
export function readGraphView(raw: string | null): GraphView | undefined {
  try {
    const value = JSON.parse(raw || 'null')
    if (!value || value.schema !== 1 || !value.transform || ![value.transform.x, value.transform.y, value.transform.scale].every(Number.isFinite) || value.transform.scale < .15 || value.transform.scale > 2) return
    if (!value.positions || typeof value.positions !== 'object' || Array.isArray(value.positions) || !value.sizes || typeof value.sizes !== 'object' || Array.isArray(value.sizes)) return
    if (!Object.values(value.positions).every((point: any) => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return
    if (!Object.values(value.sizes).every((size: any) => size && Number.isFinite(size.width) && size.width >= 32 && size.width <= 4000 && Number.isFinite(size.height) && size.height >= 32 && size.height <= 4000)) return
    return { transform: value.transform, positions: value.positions, sizes: value.sizes,
      layoutVersion: Number.isInteger(value.layoutVersion) && value.layoutVersion > 0 ? value.layoutVersion : undefined,
      manuallyPlaced: Array.isArray(value.manuallyPlaced) ? value.manuallyPlaced.filter((id: unknown) => typeof id === 'string') : [] }
  } catch { return }
}

/** 只清理失效显示身份；隐藏但仍属于图的节点保留个人位置。 */
export function pruneGraphView(view: GraphView, valid: Set<string>): GraphView {
  const retain = <T,>(items: Record<string, T>) => Object.fromEntries(Object.entries(items).filter(([id]) => valid.has(id)))
  return { ...view, positions: retain(view.positions), sizes: retain(view.sizes), manuallyPlaced: view.manuallyPlaced?.filter(id => valid.has(id)) }
}
