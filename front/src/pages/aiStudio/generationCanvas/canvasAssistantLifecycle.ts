import { bindChatSession, canvasPayload, chatClient } from '../../../services/chatSession'
import { observeChatRequest, type ChatTurnAdapter } from '../../../services/chatTurnLifecycle'
import type { CanvasAssistantExchange, CanvasAssistantFieldRevision, CanvasAssistantHistory } from '../../../services/generated'

function appendExchange(turns: CanvasAssistantExchange[], incoming: CanvasAssistantExchange) {
  if (turns.some(turn => turn.request_id === incoming.request_id)) return turns
  const combined = [...turns, incoming]
  const revisions = new Map<string, (CanvasAssistantFieldRevision | null)[]>()
  for (const turn of combined) {
    if (!turn.proposal || !turn.revises) continue
    const changes = revisions.get(turn.revises) ?? []
    revisions.set(turn.revises, [...changes, turn.revises_field ?? null])
  }
  return combined.map(turn => {
    const revisionsForTurn = revisions.get(turn.request_id)
    if (!turn.proposal || !revisionsForTurn || turn.proposal.state === 'superseded') return turn
    const whole = revisionsForTurn.includes(null)
    const groups = turn.proposal.groups?.map(group => (group.state ?? 'pending') === 'pending' &&
      (whole || revisionsForTurn.some(revision => revision?.group_id === group.id))
      ? { ...group, state: 'superseded' as const } : group)
    return { ...turn, proposal: { ...turn.proposal,
      state: groups?.some(group => (group.state ?? 'pending') === 'pending') ? 'pending' as const : 'superseded' as const,
      groups } }
  }).sort((left, right) => left.sequence - right.sequence)
}

async function read(sessionId: string, signal: AbortSignal) {
  const {data} = await observeChatRequest(bindChatSession('canvas', sessionId).snapshot(), signal)
  if (data?.kind !== 'canvas' || !('turns' in data.history)) throw new Error('Invalid canvas conversation snapshot')
  return data.history
}

/** Project canvas-specific progress and approvals within the shared session lifecycle. */
export function canvasAssistantLifecycle(projectId: string): ChatTurnAdapter<CanvasAssistantHistory> {
  return {
    read,
    events: (sessionId, cursor, signal, connected) => bindChatSession('canvas', sessionId).events(cursor, signal, connected),
    async apply(snapshot, event, signal) {
      const next = {...snapshot, cursor: event.cursor}
      const change = canvasPayload(event)
      if (!('reply' in change)) return next
      if (event.type === 'question.asked') {
        // The immutable stream can replay an already-answered question.
        const current = await read(snapshot.session_id, signal)
        if (current.cursor < event.cursor) throw new Error('Canvas conversation snapshot is behind the question')
        return current
      }
      if (event.type === 'turn.accepted' || event.type === 'turn.progress' ||
          event.type === 'message.updated' || event.category === 'tool') {
        if (change.progress) {
          if (snapshot.pending_request?.request_id !== change.request_id) {
            next.pending_request = {request_id: change.request_id, text: change.text}
          }
          next.pending_progress = change.progress
        }
        if (change.question_answers?.some(answer => answer.question_id === snapshot.pending_question?.id)) {
          next.pending_question = null
        }
        return next
      }
      if (event.type === 'turn.steered') {
        next.pending_instructions = change.instructions ?? []
        if (next.pending_progress?.request_id === change.request_id) next.pending_progress = null
        return next
      }
      if (event.type === 'turn.interrupted' || event.type === 'turn.failed') {
        next.pending_progress = {...(change.progress ?? snapshot.pending_progress ?? {
          request_id: change.request_id, model_id: change.model_id,
        }), streaming: false, error_code: change.error_code}
        return next
      }
      if (event.type === 'turn.completed' || event.type === 'turn.stopped' || event.type === 'turn.archived') {
        if (snapshot.pending_request?.request_id === change.request_id) {
          next.pending_request = null
          next.pending_question = null
          next.pending_progress = null
          next.pending_instructions = []
        }
      }
      const existing = snapshot.turns.find(turn => turn.request_id === change.request_id)
      next.turns = existing ? snapshot.turns.map(turn => turn === existing ? {
        ...turn, ...change, generation: change.generation ?? turn.generation,
      } : turn) : appendExchange(snapshot.turns, change)
      return next
    },
    active(snapshot) {
      if (!snapshot.pending_request || !(snapshot.pending_question || snapshot.pending_progress?.streaming)) return
      return {id: snapshot.pending_request.request_id, questionId: snapshot.pending_question?.id}
    },
    outcome(snapshot, turnId) {
      const saved = snapshot.turns.find(turn => turn.request_id === turnId)
      if (saved) return saved.stopped ? 'stopped' : saved.error_code && !saved.proposal ? 'failed' : 'completed'
      if (snapshot.pending_progress?.request_id === turnId && !snapshot.pending_progress.streaming &&
          snapshot.pending_progress.error_code) return 'interrupted'
    },
    async stop(canvasId, sourceId, signal) {
      const {data} = await observeChatRequest(chatClient.canvasStopSnapshot({canvasId, projectId, sourceId}), signal)
      if (!data) throw new Error('Missing canvas stop snapshot')
      return data
    },
  }
}
