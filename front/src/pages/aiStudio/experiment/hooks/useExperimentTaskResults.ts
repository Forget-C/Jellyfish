import { useEffect, useRef, useState } from 'react'
import type { bindChatSession } from '../../../../services/chatSession'
import { observeChatSession } from '../../../../services/chatSessionObservation'
import type { ChatTurnReceipt, MediaTaskReceipt } from '../../../../services/generated'
import type { ExperimentHistoryState } from './useExperimentHistory'

type TaskMessage = { taskId?: string; status?: string; receipt?: MediaTaskReceipt }
type Observation = {
  sessionId: string
  cursor: number
  tasks: Record<string, {receipt: MediaTaskReceipt; cursor: number}>
  unavailable: boolean
}
const isTerminal = (status?: string) => status === 'succeeded' || status === 'failed' || status === 'cancelled'

/** Observe one media session and overlay its live task receipts on paginated history. */
export function useExperimentTaskResults<T extends TaskMessage>(
  session: ReturnType<typeof bindChatSession> | undefined, history: ExperimentHistoryState, messages: T[],
  projectMedia: (message: T, receipt: MediaTaskReceipt) => T,
) {
  const [observation, setObservation] = useState<Observation>()
  const [admission, observeAdmission] = useState<ChatTurnReceipt>()
  const [retry, setRetry] = useState(0)
  const checkpointRef = useRef<Observation>()
  const historyRef = useRef(history)
  historyRef.current = history
  const admissionRef = useRef(admission)
  admissionRef.current = admission
  const current = observation?.sessionId === session?.sessionId ? observation : undefined
  const accepted = admission?.session_id === session?.sessionId ? admission : undefined
  const ready = history.eventCursor !== undefined || Boolean(accepted)

  useEffect(() => {
    if (!session || !ready) return
    const sessionId = session.sessionId
    const abort = new AbortController()
    const previous = checkpointRef.current?.sessionId === sessionId ? checkpointRef.current : undefined
    const receipt = admissionRef.current?.session_id === sessionId ? admissionRef.current : undefined
    // If history is temporarily unavailable, an admitted command can still be replayed.
    const start = previous?.cursor ?? historyRef.current.eventCursor ?? receipt?.cursor
    if (start === undefined) return
    let observed: Observation = previous ?? {sessionId, cursor: start, unavailable: false, tasks: {}}
    const publish = (next: Observation) => {
      observed = next
      checkpointRef.current = next
      setObservation(next)
    }
    publish(observed)
    void observeChatSession({
      signal: abort.signal,
      cursor: () => observed.cursor,
      load: async () => {},
      events: session.events,
      apply(event) {
        if (event.category !== 'task' || event.cursor <= (historyRef.current.eventCursor ?? -1)) {
          publish({...observed, cursor: event.cursor})
          return
        }
        const {task_id, status, messages: rows} = event.payload
        if (rows?.length) {
          historyRef.current.adoptCanonicalMessages(sessionId, rows.filter(row => row.session_id === sessionId))
        } else if (event.type === 'task.accepted') {
          void historyRef.current.refresh()
        }
        publish({...observed, cursor: event.cursor, unavailable: false, tasks: {...observed.tasks, [task_id]: {receipt: event.payload, cursor: event.cursor}}})
        if (isTerminal(status)) void historyRef.current.refresh()
      },
      disconnected: error => {
        if (error) publish({...observed, unavailable: true})
      },
    })
    return () => abort.abort()
  }, [ready, retry, session])

  const currentMessages = messages.map(item => {
    const observed = item.taskId ? current?.tasks[item.taskId] : undefined
    const recent = observed && observed.cursor > (history.eventCursor ?? -1) ? observed.receipt : undefined
    const receipt = isTerminal(item.status) ? item.receipt : recent ?? item.receipt
    const status = receipt?.status ?? item.status
    return {
      ...(receipt ? projectMedia(item, receipt) : item),
      ...(receipt ? { receipt, status, progress: receipt.progress, error: receipt.error } : {}),
      unavailable: Boolean(item.taskId && !isTerminal(status) && current?.unavailable),
    }
  })
  const applied = Math.max(current?.cursor ?? -1, history.eventCursor ?? -1)
  const pending = accepted && applied <= accepted.cursor
  const visibleTaskIds = new Set(currentMessages.map(item => item.taskId))
  const unprojected = Object.values(current?.tasks ?? {}).find(({receipt, cursor}) =>
    cursor > (history.eventCursor ?? -1) && !isTerminal(receipt.status) && !visibleTaskIds.has(receipt.task_id))
  const runningTaskId = currentMessages.find(item => item.taskId && !isTerminal(item.status))?.taskId
    ?? unprojected?.receipt.task_id ?? (pending ? accepted.turn_id : undefined)
  return { messages: currentMessages, runningTaskId, observeAdmission, retryStatus: () => setRetry(value => value + 1) }
}
