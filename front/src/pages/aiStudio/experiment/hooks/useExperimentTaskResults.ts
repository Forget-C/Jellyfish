import { useEffect, useState } from 'react'
import { FilmService, type TaskResultRead } from '../../../../services/generated'

type TaskMessage = { taskId?: string; status?: string }
type TaskRead = { result?: TaskResultRead; unavailable: boolean }

/** 仅轮询已知仍在执行的任务，读取错误保留最后一次可靠状态。 */
export function useExperimentTaskResults(messages: TaskMessage[], refreshHistory: () => Promise<void>) {
  const [reads, setReads] = useState<Record<string, TaskRead>>({})
  const [retry, setRetry] = useState(0)
  const runningTaskId = messages.find((message) => {
    if (!message.taskId) return false
    const status = reads[message.taskId]?.result?.status ?? message.status
    return status === 'queued' || status === 'running' || status === 'pending'
  })?.taskId

  useEffect(() => {
    if (!runningTaskId) return
    const taskId = runningTaskId
    let cancelled = false
    let timer: number | undefined
    let request: ReturnType<typeof FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet> | undefined

    const poll = async () => {
      try {
        request = FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
        const { data } = await request
        if (cancelled) return
        if (!data || data.task_id !== taskId) throw new Error('任务状态不可用')
        setReads((current) => ({ ...current, [taskId]: { result: data, unavailable: false } }))
        if (data.status === 'succeeded' || data.status === 'failed' || data.status === 'cancelled') {
          void refreshHistory()
          return
        }
      } catch {
        if (cancelled) return
        setReads((current) => ({ ...current, [taskId]: { result: current[taskId]?.result, unavailable: true } }))
      }
      // 上一次读取结束后再调度，避免慢响应覆盖更新的任务状态。
      if (!cancelled) timer = window.setTimeout(() => void poll(), 1500)
    }
    void poll()
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      request?.cancel()
    }
  }, [refreshHistory, retry, runningTaskId])

  return { reads, runningTaskId, retryStatus: () => setRetry((current) => current + 1) }
}
