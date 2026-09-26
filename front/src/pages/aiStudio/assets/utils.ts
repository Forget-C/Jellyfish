import { OpenAPI } from '../../../services/generated'

function tryExtractFileIdFromUrl(value: string): string | null {
  try {
    const url = new URL(value)
    const m = url.pathname.match(/\/api\/v1\/studio\/files\/([^/]+)\/download\/?$/)
    if (m?.[1]) return decodeURIComponent(m[1])
  } catch {
    // ignore parse error
  }
  return null
}

export function resolveAssetUrl(value?: string | null): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined

  if (/^(?:[a-z][a-z\d+\-.]*:)?\/\//i.test(trimmed) || trimmed.startsWith('data:') || trimmed.startsWith('blob:')) {
    const fileId = tryExtractFileIdFromUrl(trimmed)
    if (fileId) return buildFileDownloadUrl(fileId)
    return trimmed
  }

  // 后端有些缩略图字段可能直接返回 file_id（不包含 / 或 :）。
  // 这种情况下需要拼接下载地址，否则 new URL 会生成错误路径。
  if (!trimmed.includes('/') && !trimmed.includes(':')) {
    return buildFileDownloadUrl(trimmed)
  }

  try {
    const fallbackBase =
      window.__ENV?.BACKEND_URL ||
      import.meta.env.VITE_BACKEND_URL ||
      import.meta.env.VITE_API_BASE_URL ||
      'http://localhost:8000'
    return new URL(trimmed, OpenAPI.BASE || fallbackBase).toString()
  } catch {
    return trimmed
  }
}

export function buildFileDownloadUrl(fileId?: string | null): string | undefined {
  if (!fileId) return undefined
  return resolveAssetUrl(`/api/v1/studio/files/${encodeURIComponent(fileId)}/download`)
}

/**
 * 这个地址是不是「只在本机 / 本次会话可用」的地址（审计 §4.6 模式 4）。
 *
 * 为什么需要它：`resolveAssetUrl` 会给「相对路径」拼一个本机兜底基址，
 * 拼出来的地址能显示但**不长期可用**（换机器 / 给别人看就是死链）。
 * 地址本身不上屏（它只进 `src` / `href`），所以兜底基址不算泄漏；
 * 但页面上要说清楚「长期地址还没就绪」，不能让用户以为自己拿到了长期图。
 *
 * 判定口径只有两种，都是「一定不是长期地址」的形态：
 *   1. 本机 / 内网地址（`localhost` / `127.0.0.1` / `192.168.*` / `10.*` / `*.local`）；
 *   2. 站内相对路径（`/api/v1/...`、`/images/...`）—— 离开本机就打不开。
 */
export function isLocalAssetAddress(value?: string | null): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3})(?::\d+)?(?:[/?#]|$)/i.test(text)) {
    return true
  }
  if (/^(?:https?:\/\/)?[^/]*\.local(?::\d+)?(?:[/?#]|$)/i.test(text)) return true
  return text.startsWith('/') && !text.startsWith('//')
}
