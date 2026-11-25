import { ApiError, ChatService, type ExperimentMessageRead, type TextLabRunRequest } from './generated'
import { sessionEvents, type ReplyUpdate } from './chatSession'

type TextTrialEvent = { session_id: string; turn_id: string; cursor: number } & (
  | { type: 'turn.accepted'; payload: { user_message: ExperimentMessageRead } }
  | { type: 'message.updated'; payload: ReplyUpdate }
  | { type: 'turn.completed'; payload: { assistant_message: ExperimentMessageRead } }
  | { type: 'turn.failed'; payload: { error: { code: string; message: string } } }
  | { type: 'turn.stopped'; payload: { reason?: string } }
)

export const textTrial = {
  snapshot: ChatService.chatTextSnapshot,
  stop: ChatService.chatTextStop,
  async *send(sessionId: string, requestBody: TextLabRunRequest, idempotencyKey: string, signal: AbortSignal) {
    const send = () => ChatService.chatTextSend({ sessionId, requestBody, idempotencyKey })
    const receipt = (await send().catch(error => {
      if (error instanceof ApiError || signal.aborted) throw error
      return send()
    })).data
    if (!receipt?.turn_id || !Number.isSafeInteger(receipt.cursor)) throw new Error('Invalid text trial receipt')
    let cursor = receipt.cursor
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        for await (const event of sessionEvents<TextTrialEvent & {receipt?: TextTrialEvent['payload']}>(ChatService.chatTextEvents({sessionId, after: cursor}), sessionId, cursor, signal)) {
          cursor = event.cursor
          if (event.turn_id !== receipt.turn_id) continue
          yield (event.receipt ? {...event, payload: event.receipt} : event) as TextTrialEvent
          if (['turn.completed', 'turn.failed', 'turn.stopped'].includes(event.type)) return
        }
      } catch (error) {
        if (signal.aborted || attempt === 1) throw error
      }
      if (signal.aborted) return
    }
    throw new Error('Text trial disconnected before terminal event')
  },
}
