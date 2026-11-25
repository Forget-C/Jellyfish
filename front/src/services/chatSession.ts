import { ChatService, OpenAPI } from './generated'
import { getHeaders } from './generated/core/request'
import type { InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem__ as CanvasEvent } from './generated'

/** Share session transport while each profile owns its snapshot and command payload types. */
export const canvasChat = {
  snapshot: ChatService.chatCanvasSnapshot,
  send: ChatService.chatCanvasSend,
  stop: ChatService.chatCanvasStop,
  answer: ChatService.chatCanvasAnswer,
  decide: ChatService.chatCanvasDecide,
  layout: ChatService.chatCanvasLayout,
  generation: ChatService.chatCanvasGeneration,

  events(canvasId: string, projectId: string | undefined, after: number, signal: AbortSignal) {
    return sessionEvents<CanvasEvent>('canvas', canvasId, after, signal, projectId)
  },
}

type SessionEvent = { type: string; cursor: number; session_id: string }

/** Consume committed SSE records with the same authentication as generated requests. */
export async function* sessionEvents<E extends SessionEvent>(
  profile: string, sessionId: string, after: number, signal: AbortSignal, projectId?: string,
): AsyncGenerator<E> {
  const path = '/api/v1/studio/chat/sessions/' + encodeURIComponent(profile) + '/' + encodeURIComponent(sessionId) + '/events'
  const query = new URLSearchParams({ after: String(after) })
  if (projectId) query.set('project_id', projectId)
  const headers = await getHeaders(OpenAPI, { method: 'GET', url: path, headers: { Accept: 'text/event-stream' } })
  const response = await fetch(OpenAPI.BASE.replace(/\/$/, '') + path + '?' + query, {
    headers, signal, credentials: OpenAPI.WITH_CREDENTIALS ? OpenAPI.CREDENTIALS : undefined,
  })
  if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('Session event stream unavailable')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let separator: RegExpExecArray | null
      while ((separator = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, separator.index)
        buffer = buffer.slice(separator.index + separator[0].length)
        const lines = frame.split(/\r?\n/)
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n')
        if (!data) continue
        const event: E = JSON.parse(data)
        const id = lines.find(line => line.startsWith('id:'))?.slice(3).trim()
        const kind = lines.find(line => line.startsWith('event:'))?.slice(6).trim()
        if (event.session_id !== sessionId || !Number.isSafeInteger(event.cursor) ||
            id !== String(event.cursor) || event.type !== kind) throw new Error('Invalid session event')
        if (event.cursor <= after) continue
        after = event.cursor
        yield event
      }
    }
  } finally {
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export const laboratoryChat = {
  snapshot: ChatService.chatLabSnapshot,
  send: ChatService.chatLabSend,
  answer: ChatService.chatLabAnswer,
  models: ChatService.chatLabModels,
  stop: ChatService.chatLabStop,
  events(sessionId: string, after: number, signal: AbortSignal) {
    return sessionEvents<SessionEvent & {turn_id: string; payload: {text?: string}}>('lab', sessionId, after, signal)
  },
}
