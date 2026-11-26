import { useEffect, useState } from 'react'
import type { MediaTaskReceipt } from '../../../../services/generated'
import { bindChatSession } from '../../../../services/chatSession'

type TaskMessage = { taskId?: string; status?: string; receipt?: MediaTaskReceipt }
const isTerminal = (status?: string) => status === 'succeeded' || status === 'failed' || status === 'cancelled'

/** Replay committed receipts and overlay them on the paginated, authoritative history. */
export function useExperimentTaskResults<T extends TaskMessage>(
  session: ReturnType<typeof bindChatSession> | undefined, snapshotCursor: number | undefined, messages: T[],
  refreshHistory: () => Promise<void>, projectMedia: (message: T, receipt: MediaTaskReceipt) => T,
) {
  const [reads, setReads] = useState<Record<string, MediaTaskReceipt>>({})
  const [failed, setFailed] = useState(false)
  const [retry, setRetry] = useState(0)

  useEffect(() => {
    setReads({})
    setFailed(false)
    if (!session) return
    const abort = new AbortController()
    let timer: number | undefined
    let cursor = snapshotCursor ?? 0

    const consume = async () => {
      try {
        for await (const event of session.events(cursor, abort.signal)) {
          if (abort.signal.aborted) return
          cursor = event.cursor
          if (event.category !== 'task') continue
          setFailed(false)
          setReads(current => ({ ...current, [event.payload.task_id]: event.payload }))
          if (event.type === 'task.accepted' || isTerminal(event.payload.status)) void refreshHistory()
        }
      } catch {
        if (!abort.signal.aborted) setFailed(true)
      }
      if (!abort.signal.aborted) timer = window.setTimeout(() => void consume(), 1500)
    }
    void consume()
    return () => {
      abort.abort()
      window.clearTimeout(timer)
    }
  }, [session, snapshotCursor, refreshHistory, retry])

  const currentMessages = messages.map(item => {
    const observed = item.taskId ? reads[item.taskId] : undefined
    const receipt = isTerminal(item.status) ? item.receipt : observed ?? item.receipt
    const status = receipt?.status ?? item.status
    return {
      ...(receipt ? projectMedia(item, receipt) : item),
      ...(receipt ? { receipt, status, progress: receipt.progress, error: receipt.error } : {}),
      unavailable: Boolean(item.taskId && !isTerminal(status) && failed),
    }
  })
  const runningTaskId = currentMessages.find(item => item.taskId && !isTerminal(item.status))?.taskId
  return { messages: currentMessages, runningTaskId, retryStatus: () => setRetry(current => current + 1) }
}
