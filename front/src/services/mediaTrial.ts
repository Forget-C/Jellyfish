import { ChatService, type MediaTaskReceipt } from './generated'
import { sessionEvents } from './chatSession'

export type MediaTaskEvent = {
  session_id: string
  turn_id: string
  cursor: number
  type: 'task.accepted' | 'task.progress' | 'artifact.created' | 'task.completed' | 'task.failed' | 'task.cancelled'
  payload: MediaTaskReceipt
}

/** Direct image/video trials share the same transport and receipts as chat tools. */
export const mediaTrial = {
  snapshot: ChatService.chatMediaSnapshot,
  send: ChatService.chatMediaSend,
  events(sessionId: string, cursor: number, signal: AbortSignal) {
    return sessionEvents<MediaTaskEvent>(ChatService.chatMediaEvents({sessionId, after: cursor}), sessionId, cursor, signal)
  },
}
