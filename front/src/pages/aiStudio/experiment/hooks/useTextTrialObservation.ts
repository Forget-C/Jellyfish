import { useEffect, useRef, useState } from 'react'
import { applyReply, bindChatSession } from '../../../../services/chatSession'
import { observeChatSession } from '../../../../services/chatSessionObservation'
import type { ChatEvent } from '../../../../services/generated'
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

/** Observe the same text trial from its checkpoint, including turns sent by another view. */
export function useTextTrialObservation(sessionId: string | undefined, history: ExperimentHistoryState) {
  const [observation, setObservation] = useState<{sessionId: string; runs: Record<string, TextTrialRun>}>()
  const [disconnected, setDisconnected] = useState(false)
  const historyRef = useRef(history)
  historyRef.current = history
  const ready = history.eventCursor !== undefined

  useEffect(() => {
    if (!sessionId || !ready) return
    const abort = new AbortController()
    const session = bindChatSession('text', sessionId)
    const checkpoint = historyRef.current
    let cursor = checkpoint.eventCursor
    let lastRecovery: number | undefined
    const activeTurns = new Set(checkpoint.activeTurnIds)
    let runs: Record<string, TextTrialRun> = {}
    const finishedTurns = new Set(checkpoint.messages.filter(row => row.role === 'assistant').map(row => row.payload?.interaction_run_id))
    for (const row of checkpoint.messages) {
      const turnId = row.payload?.interaction_run_id
      if (row.role !== 'user' || typeof turnId !== 'string' || finishedTurns.has(turnId)) continue
      const active = activeTurns.delete(turnId)
      const text = typeof row.payload?.partial_text === 'string' ? row.payload.partial_text : ''
      if (active || text) runs[turnId] = {text, status: active ? 'running' : 'unknown', userId: row.id}

    }
    for (const turnId of activeTurns) runs[turnId] = {text: '', status: 'running'}
    setObservation({sessionId, runs})
    void observeChatSession({
      signal: abort.signal,
      cursor: () => cursor,
      load: async () => {}, // history already supplies the initial checkpoint
      events: session.events,
      apply(event) {
        if (event.category === 'turn' && event.payload.message?.session_id === sessionId) {
          historyRef.current.adoptCanonicalMessages(sessionId, [event.payload.message])
        } else if (event.type === 'turn.failed' || event.type === 'turn.stopped') {
          void historyRef.current.refresh()
        }
        runs = projectRun(runs, event)
        cursor = event.cursor
        setObservation({sessionId, runs})
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
    return () => abort.abort()
  }, [ready, sessionId])

  return {runs: observation?.sessionId === sessionId ? observation?.runs : undefined, disconnected}
}
