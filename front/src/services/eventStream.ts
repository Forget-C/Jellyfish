import { OpenAPI } from './generated/core/OpenAPI'
import type { OpenAPIConfig } from './generated/core/OpenAPI'
import { getHeaders } from './generated/core/request'

export type StreamConnection = 'connecting' | 'connected' | 'reconnecting'
type CursorEvent = { cursor: number; type?: string }

/** Shared incremental SSE transport. HTTP discovery stays in generated operations;
 * reconnect only resumes observation, and commits a cursor after the consumer accepts it. */
export function connectEventStream<T extends CursorEvent>({ url, onEvent, onConnection, config = OpenAPI, reconnectMs = 1000 }: {
  url: () => Promise<string>; onEvent: (event: T) => void; onConnection?: (state: StreamConnection) => void;
  config?: OpenAPIConfig; reconnectMs?: number;
}) {
  const controller = new AbortController()
  let cursor: number | undefined, retry: ReturnType<typeof setTimeout> | undefined
  const run = async () => {
    let reconnecting = false
    while (!controller.signal.aborted) {
      onConnection?.(reconnecting ? 'reconnecting' : 'connecting')
      try {
        const endpoint = await url()
        if (controller.signal.aborted) break
        const base = config.BASE || (typeof window !== 'undefined' ? window.location.origin : undefined)
        const target = new URL(endpoint, base)
        if (cursor !== undefined) target.searchParams.set('cursor', String(cursor))
        const headers = await getHeaders(config, { method: 'GET', url: target.href, headers: { Accept: 'text/event-stream' } })
        const response = await fetch(target, { headers, signal: controller.signal,
          credentials: config.WITH_CREDENTIALS ? config.CREDENTIALS : undefined })
        if (!response.ok || !response.body) throw new Error(`Stream HTTP ${response.status}`)
        onConnection?.('connected')
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let buffer = '', data: string[] = []
        const line = (value: string) => {
          if (!value) {
            if (data.length) {
              const event = JSON.parse(data.join('\n')) as T
              if (!Number.isSafeInteger(event.cursor) || event.cursor < 0) throw new Error('Invalid stream cursor')
              if (event.type === 'snapshot' || cursor === undefined || event.cursor > cursor) { onEvent(event); cursor = event.cursor }
              data = []
            }
          } else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''))
        }
        try {
          while (!controller.signal.aborted) {
            const chunk = await reader.read()
            if (chunk.done) break
            buffer += decoder.decode(chunk.value, { stream: true })
            // Retain a trailing CR: the next chunk may begin with LF.
            let end: number
            while ((end = buffer.search(/[\r\n]/)) >= 0) {
              if (buffer[end] === '\r' && end === buffer.length - 1) break
              const size = buffer[end] === '\r' && buffer[end + 1] === '\n' ? 2 : 1
              line(buffer.slice(0, end)); buffer = buffer.slice(end + size)
            }
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
      } catch { /* Preserve the last confirmed projection and resume from its cursor. */ }
      if (controller.signal.aborted) break
      reconnecting = true
      onConnection?.('reconnecting')
      await new Promise<void>(resolve => {
        const done = () => { if (retry) clearTimeout(retry); controller.signal.removeEventListener('abort', done); resolve() }
        controller.signal.addEventListener('abort', done, { once: true }); retry = setTimeout(done, reconnectMs)
      })
    }
  }
  void run()
  return { close: () => controller.abort() }
}
