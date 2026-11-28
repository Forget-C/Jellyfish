import { useEffect, useRef, useState } from 'react'
import { applyReply, bindChatSession } from '../../../../services/chatSession'
import { observeChatSession } from '../../../../services/chatSessionObservation'
import type { ChatEvent, ChatTurnReceipt } from '../../../../services/generated'
import type { ExperimentHistoryState } from './useExperimentHistory'

export type TextTrialRun = {
  text: string
  status: 'running' | 'succeeded' | 'failed' | 'cancelled' | 'unknown'
  userId?: string
  error?: string
}

function projectRun(events: Record<string, TextTrialRun>, event: ChatEvent) {
  const id = event.turn_id
  if (!id) return events
  const previous = events[id] ?? {text: '', status: 'running'}
  let run: TextTrialRun
  if (event.category === 'message') {
    run = {...previous, text: applyReply(previous.text, event.payload), status: 'running'}
  } else if (event.category === 'turn') {
    if (event.type === 'turn.accepted') {
      run = {text: '', status: 'running', userId: event.payload.message?.id}
    } else if (event.type === 'turn.completed') {
      run = {...previous, status: 'succeeded', text: event.payload.text || previous.text}
    } else if (event.type === 'turn.stopped') {
      run = {...previous, status: 'cancelled'}
    } else {
      run = {...previous, status: event.payload.error_code === 'stream_result_unknown' ? 'unknown' : 'failed',
        error: event.payload.error ?? undefined}
    }
  } else return events
  return {...events, [id]: run}
}

function reconcileSnapshot(checkpoint: ExperimentHistoryState, previous: Record<string, TextTrialRun>) {
  const active = new Set(checkpoint.activeTurnIds)
  const finished = new Set(checkpoint.messages.filter(row => row.role === 'assistant').map(row => row.payload?.interaction_run_id))
  const runs = {...previous}
  for (const id of Object.keys(runs)) {
    if (finished.has(id)) delete runs[id]
    else if (checkpoint.activeTurnIds && !active.has(id) && runs[id].status === 'running') {
      runs[id] = {...runs[id], status: 'unknown'}
    }
  }
  for (const row of checkpoint.messages) {
    const turnId = row.payload?.interaction_run_id
    if (row.role !== 'user' || typeof turnId !== 'string' || finished.has(turnId)) continue
    const running = active.delete(turnId)
    const text = typeof row.payload?.partial_text === 'string' ? row.payload.partial_text : previous[turnId]?.text ?? ''
    if (running || text) {
      runs[turnId] = {...runs[turnId], text, status: running ? 'running' : runs[turnId]?.status ?? 'unknown', userId: row.id}
    }
  }
  for (const turnId of active) {
    if (!finished.has(turnId)) runs[turnId] = {...runs[turnId], text: runs[turnId]?.text ?? '', status: 'running'}
  }
  return runs
}

/** Observe the same text trial from its checkpoint, including turns sent by another view. */
export function useTextTrialObservation(
  sessionId: string | undefined, history: ExperimentHistoryState, firstAdmission?: ChatTurnReceipt,
) {
  const [observation, setObservation] = useState<{sessionId: string; epoch: number; runs: Record<string, TextTrialRun>}>()
  const [disconnected, setDisconnected] = useState(false)
  const historyRef = useRef(history)
  const adopt = useRef<() => void>()
  historyRef.current = history
  const {eventCursor, checkpointEpoch} = history
  // A newly created session may already have a committed turn before its first snapshot succeeds.
  const admissionCursor = useRef<number>()
  admissionCursor.current = firstAdmission?.session_id === sessionId ? firstAdmission?.cursor : undefined
  const ready = eventCursor !== undefined || admissionCursor.current !== undefined

  useEffect(() => {
    if (!sessionId || !ready) return
    const abort = new AbortController()
    const session = bindChatSession('text', sessionId)
    const checkpoint = historyRef.current
    let cursor = checkpoint.eventCursor ?? admissionCursor.current
    let lastRecovery: number | undefined
    let runs = reconcileSnapshot(checkpoint, {})
    const publish = () => setObservation({sessionId, epoch: checkpointEpoch, runs})
    adopt.current = () => {
      const latest = historyRef.current
      if (latest.eventCursor === undefined || latest.checkpointEpoch !== checkpointEpoch ||
          latest.eventCursor <= (cursor ?? -1)) return
      runs = reconcileSnapshot(latest, runs)
      cursor = latest.eventCursor
      publish()
    }
    setDisconnected(false)
    publish()
    void observeChatSession({
      signal: abort.signal,
      cursor: () => cursor,
      load: async () => {}, // History or the first admission supplies the initial cursor.
      events: session.events,
      apply(event) {
        if (event.category === 'turn' && event.payload.message?.session_id === sessionId) {
          historyRef.current.adoptCanonicalMessages(sessionId, [event.payload.message])
        } else if (event.type === 'turn.failed' || event.type === 'turn.stopped') {
          void historyRef.current.refresh()
        }
        runs = projectRun(runs, event)
        cursor = event.cursor
        publish()
      },
      connected: () => setDisconnected(false),
      disconnected: () => {
        setDisconnected(true)
        if (lastRecovery !== cursor && Object.values(runs).some(run => run.status === 'running')) {
          lastRecovery = cursor
          void historyRef.current.refresh()
        }
      },
    })
    return () => {
      abort.abort()
      adopt.current = undefined
    }
  }, [checkpointEpoch, ready, sessionId])

  useEffect(() => { adopt.current?.() }, [checkpointEpoch, eventCursor, sessionId])

  return {
    runs: observation?.sessionId === sessionId && observation?.epoch === checkpointEpoch ? observation?.runs : undefined,
    disconnected,
  }
}
