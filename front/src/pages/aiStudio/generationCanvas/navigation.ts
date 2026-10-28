/** 画布入口、历史定位与任务回跳共享同一独立页面地址。 */
export function generationCanvasLocation(projectId: string, parameters = new URLSearchParams()) {
  const query = new URLSearchParams(parameters)
  query.delete('tab')
  return `/projects/${encodeURIComponent(projectId)}/generation-canvas${query.size ? `?${query}` : ''}`
}
