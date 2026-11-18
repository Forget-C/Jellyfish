export type WorkbenchAssetTabParam = 'actors' | 'scenes' | 'props' | 'costumes'

export function encodeWorkbenchAssetEditReturnTo(projectId: string, tab: WorkbenchAssetTabParam): string {
  return encodeURIComponent(`/projects/${projectId}?tab=${tab}`)
}

/** 资产库返回保留已转义的查询，项目返回兼容既有编码。 */
export function decodeAssetEditReturnTo(searchReturnTo: string | null, fallback: string): string {
  if (!searchReturnTo?.trim()) return fallback
  if (searchReturnTo.startsWith('/assets?')) return searchReturnTo
  try {
    const decoded = decodeURIComponent(searchReturnTo.trim())
    if (decoded.startsWith('/projects/')) return decoded
  } catch {
    // ignore malformed encoding
  }
  return fallback
}
