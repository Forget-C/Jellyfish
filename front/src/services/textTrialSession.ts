import { ApiError, type ChatTurnReceipt } from './generated'
import type { bindChatSession } from './chatSession'

export async function* followTextTrial(
  session: ReturnType<typeof bindChatSession>, send: () => Promise<ChatTurnReceipt>, signal: AbortSignal,
) {
  const receipt = await send().catch(error => {
    if (error instanceof ApiError || signal.aborted) throw error
    return send()
  })
  let cursor = receipt.cursor
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      for await (const event of session.events(cursor, signal)) {
        cursor = event.cursor
        if (event.turn_id !== receipt.turn_id || (event.category !== 'turn' && event.category !== 'message')) continue
        yield event
        if (['turn.completed', 'turn.failed', 'turn.stopped'].includes(event.type)) return
      }
    } catch (error) {
      if (signal.aborted || attempt === 1) throw error
    }
    if (signal.aborted) return
  }
  throw new Error('Text trial disconnected before terminal event')
}
