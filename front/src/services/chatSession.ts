import { ChatService, type CancelablePromise, type CanvasAssistantExchange } from './generated'
import type { InteractionEvent_Union_CanvasAssistantExchange__CanvasAssistantQueueItem__ as CanvasEvent } from './generated'

export type ReplyUpdate = { text: string; mode: 'append' | 'replace' }
type ToolUpdate = { tool_call_id: string; tool: string; state: 'started' | 'completed' | 'failed';
  parameters: Record<string, string | number>; error: string | null; model_id: string | null }
type TurnUpdate = { text: string; error: string | null; reason: string | null }

export function applyReply(previous: string, update: ReplyUpdate) {
  return update.mode === 'append' ? previous + update.text : update.text
}

type CanvasWireEvent = Omit<CanvasEvent, 'payload'> & {
  payload: CanvasEvent['payload'] | ReplyUpdate | ToolUpdate | TurnUpdate
  canvas?: CanvasAssistantExchange
}

function canvasPayload(event: CanvasWireEvent): CanvasEvent['payload'] {
  const scene = event.canvas
  const fact = event.payload
  if (scene) {
    if ('mode' in fact) {
      const reply = applyReply(scene.reply, fact)
      return {...scene, reply, progress: scene.progress ? {...scene.progress, reply} : scene.progress}
    }
    if ('tool_call_id' in fact && scene.progress) {
      return {...scene, progress: {...scene.progress, tool_call: {
        id: fact.tool_call_id, name: fact.tool, state: fact.state, parameters: fact.parameters,
      }}}
    }
    if ('reason' in fact) return {...scene, reply: fact.text || scene.reply, error_code: fact.error ?? scene.error_code}
    return scene
  }
  if ('request_id' in fact) return fact
  throw new Error('Missing canvas event details')
}

/** Share session transport while each profile owns its snapshot and command payload types. */
export const canvasChat = {
  snapshot: ChatService.chatCanvasSnapshot,
  send: ChatService.chatCanvasSend,
  stop: ChatService.chatCanvasStop,
  answer: ChatService.chatCanvasAnswer,
  decide: ChatService.chatCanvasDecide,
  layout: ChatService.chatCanvasLayout,
  generation: ChatService.chatCanvasGeneration,

  async *events(canvasId: string, projectId: string | undefined, after: number, signal: AbortSignal) {
    for await (const event of sessionEvents<CanvasWireEvent>(
      ChatService.chatCanvasEvents({canvasId, projectId, after}), canvasId, after, signal)) {
      yield {...event, payload: canvasPayload(event)}
    }
  },
}

type SessionEvent = { type: string; cursor: number; session_id: string }

/** Consume committed SSE records with the same authentication as generated requests. */
export async function* sessionEvents<E extends SessionEvent>(
  request: CancelablePromise<Response>, sessionId: string, after: number, signal: AbortSignal,
): AsyncGenerator<E> {
  const cancel = () => request.cancel()
  signal.addEventListener('abort', cancel, {once: true})
  if (signal.aborted) cancel()
  let response: Response
  try { response = await request } finally { signal.removeEventListener('abort', cancel) }
  if (!response?.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new Error('Session event stream unavailable')
  }
  const reader = response.body.getReader()
  const close = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', close, {once: true})
  if (signal.aborted) close()
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
    signal.removeEventListener('abort', close)
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
    return sessionEvents<SessionEvent & {turn_id: string; payload: ReplyUpdate}>(ChatService.chatLabEvents({sessionId, after}), sessionId, after, signal)
  },
}

export const draftChat = {
  send: ChatService.chatDraftSend,
  snapshot: ChatService.chatDraftSnapshot,
  stop: ChatService.chatDraftStop,
  async *events(canvasId: string, sourceId: string, after: number, signal: AbortSignal) {
    for await (const event of sessionEvents<CanvasWireEvent>(
      ChatService.chatDraftEvents({canvasId, sourceId, after}), canvasId, after, signal)) {
      const turn = canvasPayload(event)
      if ('reply' in turn) yield {...event, canvas: turn}
    }
  },
}
