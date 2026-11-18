/** 画布入口、历史定位与任务回跳共享同一独立页面地址。 */
export function generationCanvasLocation(canvasId: string, parameters = new URLSearchParams()) {
  const query = new URLSearchParams(parameters)
  query.delete('tab')
  return `/canvases/${encodeURIComponent(canvasId)}${query.size ? `?${query}` : ''}`
}

/** 关闭运行历史只消费本次定位，保留宿主与其他面板参数。 */
export function withoutRunTarget(parameters: URLSearchParams) {
  const next = new URLSearchParams(parameters)
  next.delete('run')
  next.delete('node')
  return next
}
