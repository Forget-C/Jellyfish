/** 画布入口、历史定位与任务回跳共享同一独立页面地址。 */
export function generationCanvasLocation(canvasId: string, parameters = new URLSearchParams()) {
  const query = new URLSearchParams(parameters)
  query.delete('tab')
  return `/canvases/${encodeURIComponent(canvasId)}${query.size ? `?${query}` : ''}`
}
