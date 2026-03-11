import { OpenAPI } from './generated'

/**
 * 初始化由 OpenAPI 生成的请求客户端。
 *
 * 说明：
 * - 默认使用同源的 `/api`，与现有 `services/http.ts` 的 baseURL 保持一致。
 * - 如需直连本地后端，可在应用启动时调用 `initOpenAPI('http://127.0.0.1:8000')`。
 */
export function initOpenAPI(base: string = '/api') {
  OpenAPI.BASE = base
}

// 默认值：同源反向代理路径
initOpenAPI()

