export type CanvasPoint = { x: number; y: number }
export type CanvasTransform = CanvasPoint & { scale: number }

/** 视口和布局都是浏览状态；恢复时拒绝无穷值和不支持的缩放。 */
export function validCanvasTransform(value: CanvasTransform | undefined): value is CanvasTransform {
  return !!value && [value.x, value.y, value.scale].every(Number.isFinite) && value.scale >= .15 && value.scale <= 2
}

export function validCanvasOffsets(value: unknown): value is Record<string, CanvasPoint> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))
}

export function fitCanvas(viewport: CanvasPoint, content: CanvasPoint): CanvasTransform | undefined {
  if (![viewport.x, viewport.y, content.x, content.y].every(value => Number.isFinite(value) && value > 0)) return undefined
  const scale = Math.max(.15, Math.min(1.2, viewport.x / content.x, viewport.y / content.y))
  return { x: Math.max(0, (viewport.x - content.x * scale) / 2), y: Math.max(0, (viewport.y - content.y * scale) / 2), scale }
}

/** 同列和反向关系均按真实端点路由，布局方向不被解释为执行顺序。 */
export function canvasConnection(from: { left: number; top: number; width: number; height: number }, to: { left: number; top: number; width: number; height: number }) {
  const sameColumn = Math.abs(from.left - to.left) < 20, reverse = from.left > to.left
  const x1 = sameColumn || reverse ? from.left : from.left + from.width
  const x2 = sameColumn || !reverse ? to.left : to.left + to.width
  const y1 = from.top + from.height / 2, y2 = to.top + to.height / 2
  const control = sameColumn ? Math.min(x1, x2) - 14 : (x1 + x2) / 2
  return { d: `M${x1},${y1} C${control},${y1} ${control},${y2} ${x2},${y2}`, x: (x1 + x2) / 2, y: (y1 + y2) / 2 - 8 }
}
