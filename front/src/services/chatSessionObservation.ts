import type { ChatEvent } from './generated'

type ObserveSession = {
  signal: AbortSignal
  cursor(): number | undefined
  load(): Promise<void>
  events(cursor: number, signal: AbortSignal, connected: () => void): AsyncIterable<ChatEvent>
  apply(event: ChatEvent, signal: AbortSignal): void | Promise<void>
  connected?(): void
  disconnected?(error?: unknown): void
}

function retryDelay(signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, 1000)
    signal.addEventListener('abort', finish, {once: true})
    if (signal.aborted) finish()
  })
}

/** Start at a committed snapshot and reconnect after the last event applied by the view. */
export async function observeChatSession(observer: ObserveSession) {
  const {signal} = observer
  while (!signal.aborted) {
    try {
      if (observer.cursor() === undefined) await observer.load()
      if (signal.aborted) return
      const cursor = observer.cursor()
      if (cursor === undefined) throw new Error('Chat snapshot is unavailable')
      for await (const event of observer.events(cursor, signal, () => {
        if (!signal.aborted) observer.connected?.()
      })) {
        if (signal.aborted) return
        if (event.cursor > (observer.cursor() ?? -1)) await observer.apply(event, signal)
      }
      if (!signal.aborted) observer.disconnected?.()
    } catch (error) {
      if (!signal.aborted) observer.disconnected?.(error)
    }
    await retryDelay(signal)
  }
}

export {retryDelay as waitForChatReconnect}
