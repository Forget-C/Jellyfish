import { ChatService, CancelablePromise, type ChatEvent, type ChatTurnReceipt, type ReplyUpdate } from './generated'

export function applyReply(previous: string, update: ReplyUpdate) {
  return update.mode === 'append' ? previous + update.text : update.text
}

export function canvasPayload(event: ChatEvent) {
  const scene = event.detail
  if (!scene || !('request_id' in scene)) throw new Error('Missing canvas event details')
  if (!('reply' in scene)) return scene
  if (event.category === 'message') {
    const reply = applyReply(scene.reply, event.payload)
    return {...scene, reply, progress: scene.progress ? {...scene.progress, reply} : scene.progress}
  }
  if (event.category === 'tool' && scene.progress) {
    const call = event.payload
    return {...scene, progress: {...scene.progress, tool_call: {
      id: call.tool_call_id, name: call.tool, state: call.state, parameters: call.parameters,
    }}}
  }
  if (event.category === 'turn') return {...scene, reply: event.payload.text || scene.reply, error_code: event.payload.error ?? scene.error_code}
  return scene
}

/** Consume committed SSE records with the same authentication as generated requests. */
async function* sessionEvents(
  request: ReturnType<typeof ChatService.chatSessionEvents>, sessionId: string, after: number, signal: AbortSignal,
): AsyncGenerator<ChatEvent> {
  const cancel = () => request.cancel()
  signal.addEventListener('abort', cancel, {once: true})
  if (signal.aborted) cancel()
  let response: unknown
  try { response = await request } finally { signal.removeEventListener('abort', cancel) }
  if (!(response instanceof Response) || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
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
        const event: ChatEvent = JSON.parse(data)
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


function receiveTurn(
  request: ReturnType<typeof ChatService.chatSessionSend>, sessionId: string, turnId?: string,
): CancelablePromise<ChatTurnReceipt> {
  return new CancelablePromise((resolve, reject, onCancel) => {
    onCancel(() => request.cancel())
    request.then(({data}) => {
      if (!data || data.session_id !== sessionId || !data.turn_id ||
          (turnId && data.turn_id !== turnId) || !Number.isSafeInteger(data.cursor)) {
        throw new Error('Invalid chat turn receipt')
      }
      resolve(data)
    }).catch(reject)
  })
}

export const chatClient = {
  send(command: Parameters<typeof ChatService.chatSessionSend>[0]) {
    return receiveTurn(ChatService.chatSessionSend(command), command.sessionId)
  },
  answer(command: Parameters<typeof ChatService.chatSessionAnswer>[0]) {
    return receiveTurn(ChatService.chatSessionAnswer(command), command.sessionId, command.turnId)
  },
  events(sessionId: string, after = 0, signal = new AbortController().signal) {
    return sessionEvents(ChatService.chatSessionEvents({sessionId, after}), sessionId, after, signal)
  },
  canvasSnapshot: ChatService.chatCanvasSnapshot,
  canvasStop: ChatService.chatCanvasStop,
  canvasDecide: ChatService.chatCanvasDecide,
  canvasLayout: ChatService.chatCanvasLayout,
  canvasGeneration: ChatService.chatCanvasGeneration,
  labSnapshot: ChatService.chatLabSnapshot,
  labModels: ChatService.chatLabModels,
  labStop: ChatService.chatLabStop,
  textSnapshot: ChatService.chatTextSnapshot,
  textStop: ChatService.chatTextStop,
  mediaSnapshot: ChatService.chatMediaSnapshot,
}

type BoundSend = Parameters<typeof ChatService.chatBoundSend>[0]
type BoundAnswer = Parameters<typeof ChatService.chatBoundAnswer>[0]
type BoundSnapshot = Parameters<typeof ChatService.chatBoundSnapshot>[0]

/** Keep all public chat operations addressed to the same resolved session. */
export function bindChatSession(kind: BoundSend['kind'], sessionId: string) {
  return {
    kind,
    sessionId,
    send(command: Omit<BoundSend, 'kind' | 'sessionId'>) {
      return receiveTurn(ChatService.chatBoundSend({...command, kind, sessionId}), sessionId)
    },
    answer(command: Omit<BoundAnswer, 'kind' | 'sessionId'>) {
      return receiveTurn(ChatService.chatBoundAnswer({...command, kind, sessionId}), sessionId, command.turnId)
    },
    events(after = 0, signal = new AbortController().signal) {
      return sessionEvents(ChatService.chatBoundEvents({kind, sessionId, after}), sessionId, after, signal)
    },
    snapshot(paging: Omit<BoundSnapshot, 'kind' | 'sessionId'> = {}) {
      return ChatService.chatBoundSnapshot({...paging, kind, sessionId})
    },
  }
}

/** Follow one admitted turn, resuming after the last event if the connection drops. */
export async function waitForTurnEvent<T>(
  receipt: ChatTurnReceipt, select: (event: ChatEvent) => T | undefined | Promise<T | undefined>,
  signal = new AbortController().signal,
): Promise<T> {
  let cursor = receipt.cursor
  for (let attempt = 0; attempt < 3 && !signal.aborted; attempt++) {
    try {
      for await (const event of chatClient.events(receipt.session_id, cursor, signal)) {
        const result = event.turn_id === receipt.turn_id ? await select(event) : undefined
        if (signal.aborted) signal.throwIfAborted()
        cursor = event.cursor
        if (result !== undefined) return result
      }
    } catch (error) {
      if (signal.aborted || attempt === 2) throw error
    }
  }
  throw new Error('Chat turn event stream closed before the expected event')
}

export function waitForMediaAdmission(receipt: ChatTurnReceipt) {
  return waitForTurnEvent(receipt, event => {
    if (event.category !== 'task' || event.type !== 'task.accepted') return
    const {task_id, messages} = event.payload
    return {task_id, messages: messages ?? []}
  }, AbortSignal.timeout(8000))
}
