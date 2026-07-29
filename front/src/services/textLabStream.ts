import type { ApiRequestOptions } from './generated/core/ApiRequestOptions'
import { OpenAPI } from './generated/core/OpenAPI'
import { getHeaders } from './generated/core/request'
import type { TextLabRunRequest } from './generated/models/TextLabRunRequest'

/** 文本实验室 SSE 协议中已持久化的 canonical 消息快照。 */
export interface TextLabStreamMessage {
  id: string
  session_id: string
  role: 'user' | 'assistant'
  content: string
  sequence: number
  created_at: string
  updated_at: string
}

/** 文本生成成功后由服务端冻结的结果元数据。 */
export interface TextLabStreamResult {
  text: string
  model_id: string
  model_revision_id: string
  provider_request_id: string | null
  input_tokens: number | null
  output_tokens: number | null
}

/** 统一文本实验室 SSE 事件；与后端 GenerationStreamEvent 的 event/data 一一对应。 */
export type TextLabStreamEvent =
  | TextLabAcceptedEvent
  | TextLabDeltaEvent
  | TextLabProgressEvent
  | TextLabCompletedEvent
  | TextLabErrorEvent
  | TextLabCancelledEvent
  | TextLabHeartbeatEvent

export interface TextLabAcceptedEvent {
  version: 1
  event: 'accepted'
  sequence: number
  created_at: string
  data: { task_id: string; user_message: TextLabStreamMessage }
}

export interface TextLabDeltaEvent {
  version: 1
  event: 'delta'
  sequence: number
  created_at: string
  data: { task_id: string; text_delta: string }
}

export interface TextLabProgressEvent {
  version: 1
  event: 'progress'
  sequence: number
  created_at: string
  data: { task_id: string; progress: number }
}

export interface TextLabCompletedEvent {
  version: 1
  event: 'completed'
  sequence: number
  created_at: string
  data: { task_id: string; assistant_message: TextLabStreamMessage; result: TextLabStreamResult }
}

export interface TextLabErrorEvent {
  version: 1
  event: 'error'
  sequence: number
  created_at: string
  data: { task_id: string; error: { code: string; message: string; retryable: boolean } }
}

export interface TextLabCancelledEvent {
  version: 1
  event: 'cancelled'
  sequence: number
  created_at: string
  data: { task_id: string; reason: string | null }
}

export interface TextLabHeartbeatEvent {
  version: 1
  event: 'heartbeat'
  sequence: number
  created_at: string
  data: { task_id: string }
}

/** 启动固定 SSE 文本实验室运行所需的路径参数、输入和可选取消信号。 */
export interface TextLabStreamRequest {
  sessionId: string
  body: TextLabRunRequest
  signal?: AbortSignal
}

/** 非 2xx 或非 SSE 响应时抛出的稳定传输错误，供页面统一展示。 */
export class TextLabStreamTransportError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly responseBody?: string,
  ) {
    super(message)
    this.name = 'TextLabStreamTransportError'
  }
}

type JsonRecord = Record<string, unknown>

/**
 * 使用 OpenAPI 的 BASE、认证和凭据配置增量读取文本实验室 SSE。
 *
 * 生成客户端会完整缓冲 `response.text()`，因此此处仅复用其配置和 headers
 * 解析逻辑；调用方通过 `for await` 在每个服务端事件到达时更新界面。
 */
export async function* streamTextLab(
  request: TextLabStreamRequest,
): AsyncGenerator<TextLabStreamEvent, void, undefined> {
  const options: ApiRequestOptions = {
    method: 'POST',
    url: '/api/v1/studio/labs/text/sessions/{session_id}/stream',
    path: { session_id: request.sessionId },
    body: request.body,
    mediaType: 'application/json',
    headers: { Accept: 'text/event-stream' },
  }
  const headers = await getHeaders(OpenAPI, options)
  const response = await fetch(buildTextLabStreamUrl(request.sessionId), {
    method: options.method,
    headers,
    body: JSON.stringify(request.body),
    signal: request.signal,
    credentials: OpenAPI.WITH_CREDENTIALS ? OpenAPI.CREDENTIALS : undefined,
  })

  if (!response.ok) {
    throw new TextLabStreamTransportError(
      `Text lab stream request failed with HTTP ${response.status}`,
      response.status,
      await response.text(),
    )
  }
  if (!response.body) {
    throw new TextLabStreamTransportError('Text lab stream response has no readable body', response.status)
  }
  if (!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')) {
    throw new TextLabStreamTransportError('Text lab stream response is not text/event-stream', response.status)
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let receivedTerminalEvent = false
  try {
    let hasMoreChunks = true
    while (hasMoreChunks) {
      const { done, value } = await reader.read()
      buffer += decoder.decode(value, { stream: !done })
      const frames = takeSseFrames(buffer)
      buffer = frames.remainder
      for (const frame of frames.frames) {
        const event = parseTextLabSseFrame(frame)
        if (event) {
          receivedTerminalEvent ||= isTextLabTerminalEvent(event)
          yield event
        }
      }
      if (done) {
        hasMoreChunks = false
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const event = parseTextLabSseFrame(buffer)
      if (event) {
        receivedTerminalEvent ||= isTextLabTerminalEvent(event)
        yield event
      }
    }
    if (!receivedTerminalEvent) {
      throw new TextLabStreamTransportError('Text lab stream ended before a terminal event')
    }
  } finally {
    reader.releaseLock()
  }
}

/** 判断事件是否已明确收敛本次运行；正常 EOF 前必须收到且只能由服务端发出。 */
function isTextLabTerminalEvent(event: TextLabStreamEvent): boolean {
  return event.event === 'completed' || event.event === 'error' || event.event === 'cancelled'
}

/** 将当前 OpenAPI BASE 与固定 SSE 路径组合，避免页面重复拼接服务端地址。 */
function buildTextLabStreamUrl(sessionId: string): string {
  const base = OpenAPI.BASE.replace(/\/$/, '')
  return `${base}/api/v1/studio/labs/text/sessions/${encodeURIComponent(sessionId)}/stream`
}

/** 从跨网络分块的缓冲区取出完整 SSE 帧，并保留最后一个不完整帧。 */
function takeSseFrames(buffer: string): { frames: string[]; remainder: string } {
  const normalized = buffer.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const frames: string[] = []
  let cursor = 0
  let boundary = normalized.indexOf('\n\n', cursor)
  while (boundary !== -1) {
    frames.push(normalized.slice(cursor, boundary))
    cursor = boundary + 2
    boundary = normalized.indexOf('\n\n', cursor)
  }
  return { frames, remainder: normalized.slice(cursor) }
}

/** 解析一个 SSE 帧，忽略注释帧并拒绝缺少 id/event/data 的业务帧。 */
function parseTextLabSseFrame(frame: string): TextLabStreamEvent | undefined {
  const fields = new Map<string, string[]>()
  for (const line of frame.split('\n')) {
    if (!line || line.startsWith(':')) {
      continue
    }
    const separator = line.indexOf(':')
    const key = separator === -1 ? line : line.slice(0, separator)
    const rawValue = separator === -1 ? '' : line.slice(separator + 1)
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue
    fields.set(key, [...(fields.get(key) ?? []), value])
  }
  if (fields.size === 0) {
    return undefined
  }

  const id = requireSingleField(fields, 'id')
  const eventName = requireSingleField(fields, 'event')
  const payload = requireSingleField(fields, 'data')
  const event = parseTextLabEvent(eventName, payload)
  if (String(event.sequence) !== id) {
    throw new TextLabStreamTransportError('SSE id must match the event sequence')
  }
  return event
}

/** 读取严格单值 SSE 字段；data 的多行形式按 SSE 规范以换行拼接。 */
function requireSingleField(fields: Map<string, string[]>, key: string): string {
  const values = fields.get(key)
  if (!values?.length) {
    throw new TextLabStreamTransportError(`Malformed SSE frame: missing ${key}`)
  }
  if (key !== 'data' && values.length !== 1) {
    throw new TextLabStreamTransportError(`Malformed SSE frame: repeated ${key}`)
  }
  return values.join('\n')
}

/** 将服务端 JSON payload 校验为固定事件联合，拒绝 event 与 data 不匹配的帧。 */
function parseTextLabEvent(frameEvent: string, payload: string): TextLabStreamEvent {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new TextLabStreamTransportError('Malformed SSE frame: data is not JSON')
  }
  const root = requireRecord(parsed, 'event payload')
  if (root.version !== 1 || root.event !== frameEvent) {
    throw new TextLabStreamTransportError('Malformed SSE frame: event envelope is invalid')
  }
  const common = {
    version: 1 as const,
    event: frameEvent,
    sequence: requirePositiveInteger(root.sequence, 'sequence'),
    created_at: requireString(root.created_at, 'created_at'),
    data: requireRecord(root.data, 'data'),
  }

  switch (frameEvent) {
    case 'accepted':
      return { ...common, event: 'accepted', data: { task_id: requireTaskId(common.data), user_message: parseMessage(common.data.user_message, 'user') } }
    case 'delta':
      return { ...common, event: 'delta', data: { task_id: requireTaskId(common.data), text_delta: requireNonEmptyString(common.data.text_delta, 'text_delta') } }
    case 'progress': {
      const progress = requireNumber(common.data.progress, 'progress')
      if (progress < 0 || progress > 100) throw new TextLabStreamTransportError('Malformed SSE event: progress must be 0-100')
      return { ...common, event: 'progress', data: { task_id: requireTaskId(common.data), progress } }
    }
    case 'completed':
      return { ...common, event: 'completed', data: { task_id: requireTaskId(common.data), assistant_message: parseMessage(common.data.assistant_message, 'assistant'), result: parseResult(common.data.result) } }
    case 'error':
      return { ...common, event: 'error', data: { task_id: requireTaskId(common.data), error: parseError(common.data.error) } }
    case 'cancelled':
      return { ...common, event: 'cancelled', data: { task_id: requireTaskId(common.data), reason: requireNullableString(common.data.reason, 'reason') } }
    case 'heartbeat':
      return { ...common, event: 'heartbeat', data: { task_id: requireTaskId(common.data) } }
    default:
      throw new TextLabStreamTransportError(`Unsupported SSE event: ${frameEvent}`)
  }
}

/** 校验 canonical 消息，避免页面把未知 role 或临时消息视为已提交记录。 */
function parseMessage(value: unknown, expectedRole: 'user' | 'assistant'): TextLabStreamMessage {
  const message = requireRecord(value, 'message')
  const role = requireString(message.role, 'message.role')
  if (role !== expectedRole) throw new TextLabStreamTransportError(`Malformed SSE event: expected ${expectedRole} message`)
  return {
    id: requireNonEmptyString(message.id, 'message.id'),
    session_id: requireNonEmptyString(message.session_id, 'message.session_id'),
    role,
    content: requireString(message.content, 'message.content'),
    sequence: requirePositiveInteger(message.sequence, 'message.sequence'),
    created_at: requireString(message.created_at, 'message.created_at'),
    updated_at: requireString(message.updated_at, 'message.updated_at'),
  }
}

/** 校验完成事件的 provider 无关生成结果。 */
function parseResult(value: unknown): TextLabStreamResult {
  const result = requireRecord(value, 'result')
  return {
    text: requireString(result.text, 'result.text'),
    model_id: requireNonEmptyString(result.model_id, 'result.model_id'),
    model_revision_id: requireNonEmptyString(result.model_revision_id, 'result.model_revision_id'),
    provider_request_id: requireNullableString(result.provider_request_id, 'result.provider_request_id'),
    input_tokens: requireNullableNonNegativeInteger(result.input_tokens, 'result.input_tokens'),
    output_tokens: requireNullableNonNegativeInteger(result.output_tokens, 'result.output_tokens'),
  }
}

/** 校验服务端公开错误结构，避免把任意 provider 原文透传到页面。 */
function parseError(value: unknown): TextLabErrorEvent['data']['error'] {
  const error = requireRecord(value, 'error')
  if (typeof error.retryable !== 'boolean') throw new TextLabStreamTransportError('Malformed SSE event: error.retryable must be boolean')
  return { code: requireNonEmptyString(error.code, 'error.code'), message: requireNonEmptyString(error.message, 'error.message'), retryable: error.retryable }
}

/** 以下 primitives 集中拒绝协议字段的隐式类型转换。 */
function requireRecord(value: unknown, field: string): JsonRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TextLabStreamTransportError(`Malformed SSE event: ${field} must be an object`)
  return value as JsonRecord
}
function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new TextLabStreamTransportError(`Malformed SSE event: ${field} must be a string`)
  return value
}
function requireNonEmptyString(value: unknown, field: string): string {
  const text = requireString(value, field)
  if (!text) throw new TextLabStreamTransportError(`Malformed SSE event: ${field} must not be empty`)
  return text
}
function requirePositiveInteger(value: unknown, field: string): number {
  if (!Number.isInteger(value) || (value as number) < 1) throw new TextLabStreamTransportError(`Malformed SSE event: ${field} must be a positive integer`)
  return value as number
}
function requireNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TextLabStreamTransportError(`Malformed SSE event: ${field} must be a finite number`)
  return value
}
function requireNullableString(value: unknown, field: string): string | null {
  return value === null ? null : requireString(value, field)
}
function requireNullableNonNegativeInteger(value: unknown, field: string): number | null {
  if (value === null) return null
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new TextLabStreamTransportError(`Malformed SSE event: ${field} must be a non-negative integer`)
  }
  return value as number
}
function requireTaskId(data: JsonRecord): string {
  return requireNonEmptyString(data.task_id, 'data.task_id')
}
