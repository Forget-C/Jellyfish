/**
 * 守卫状态接口（只读，不写库、不触网、不花钱）。
 *
 * 为什么单独放一个模块（而不是塞进 `services/llmPipelineApi.ts`）：
 * 「演练 / 真实模式」标识是所有页面共用的**只读**能力，和生成链路的 API 不是一条线；
 * 独立文件也能避免几条并行功能线同时改同一个文件。
 *
 * 端点：`GET /api/v1/studio/llm/orchestration/status`
 * 返回值里与本模块相关的是 `data.guard`（模式开关）、`data.mode` / `data.mode_label`
 * （模式标识）、`data.outlet_states`（四个出口各自放行情况）、
 * `data.enable_steps` / `data.restore_steps`（中文操作步骤）、`data.dry_run_audit`（拦截审计）。
 *
 * 解析（纯逻辑）在 `pages/aiStudio/components/realRunModeCore.ts`，本文件只负责取数。
 */

/* 同 `llmPipelineApi`：显式指向 `core/OpenAPI`（目录导入在 Node ESM 下不可用）。 */
import { OpenAPI } from './generated/core/OpenAPI.ts'

export const ORCHESTRATION_STATUS_PATH = '/api/v1/studio/llm/orchestration/status'

/** 页面/组件可以派发这个事件，让角标立刻重新读取模式（不必等下一次轮询）。 */
export const ORCHESTRATION_REFRESH_EVENT = 'jellyfish:orchestration-status-refresh'

/** 取状态失败时抛出（带 HTTP 状态码，便于区分「后端没起」与「返回异常」）。 */
export class OrchestrationStatusError extends Error {
  status: number
  /**
   * **技术字段**（审计 §4.7「服务层」）：后端 `message` 原文与响应体前 200 字。
   *
   * 为什么不再拼进 `message`：本异常最终在 `RealRunModeBadge` 的默认收起折叠区里渲染
   * （`读取失败原文：`＋请求地址），而 `message` 一旦被别的出口（Alert 标题 / toast）
   * 取走就会把后端原文与响应体带上主区。现在 `message` 只留一句中文结论。
   */
  readonly backendMessage: string
  readonly responseText: string

  constructor(message: string, status: number, backendMessage = '', responseText = '') {
    super(message)
    this.name = 'OrchestrationStatusError'
    this.status = status
    this.backendMessage = backendMessage
    this.responseText = responseText
  }
}

export function orchestrationStatusUrl(): string {
  return `${OpenAPI.BASE}${ORCHESTRATION_STATUS_PATH}`
}

/** 读取守卫状态原始 data（不做任何猜测，字段口径见后端）。 */
export async function fetchOrchestrationStatusData(): Promise<Record<string, unknown>> {
  const response = await fetch(orchestrationStatusUrl())
  const text = await response.text()
  let payload: Record<string, unknown> | undefined
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    /* 审计 §4.7-535：改前把「后端 message / 响应体前 200 字」原样拼进 message
       （`读取守卫状态失败（HTTP xxx）：…`），最终在 `RealRunModeBadge` 主区直渲。
       现在 message = 中文结论，原文进 `backendMessage` / `responseText` 技术字段。 */
    const backendMessage = typeof payload?.message === 'string' ? payload.message : ''
    throw new OrchestrationStatusError(
      `读取运行模式状态失败，请稍后重试`,
      response.status,
      backendMessage,
      String(text ?? '').slice(0, 200),
    )
  }
  const data = payload?.data
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {}
}

/**
 * 解析（模式判定、出口放行、中文步骤、拦截错误）在
 * `pages/aiStudio/components/realRunModeCore.ts`，本文件只负责取数与通知刷新，
 * 以免 service 层反向依赖页面。
 */

/** 通知所有角标重新读取模式（可以在任何页面调用，无需改本文件）。 */
export function requestOrchestrationStatusRefresh(): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ORCHESTRATION_REFRESH_EVENT))
}
