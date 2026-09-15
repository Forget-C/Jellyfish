import { useCallback, useEffect, useRef, useState } from 'react'
import { FilmService } from '../../../../services/generated'
import type { TaskStatus, TaskStatusRead } from '../../../../services/generated'

export const CONSISTENCY_CHECK_RELATION_TYPE = 'consistency_check'
export const SCRIPT_OPTIMIZATION_RELATION_TYPE = 'script_optimization'
export const SCRIPT_SIMPLIFICATION_RELATION_TYPE = 'script_simplification'
export const CHARACTER_PORTRAIT_ANALYSIS_RELATION_TYPE = 'character_portrait_analysis'
export const PROP_INFO_ANALYSIS_RELATION_TYPE = 'prop_info_analysis'
export const SCENE_INFO_ANALYSIS_RELATION_TYPE = 'scene_info_analysis'
export const COSTUME_INFO_ANALYSIS_RELATION_TYPE = 'costume_info_analysis'

export type RelationTaskState = {
  taskId: string
  status: TaskStatus
  progress: number
  cancelRequested: boolean
  startedAtTs?: number | null
  finishedAtTs?: number | null
  elapsedMs?: number | null
}


type AsyncTaskCreateLike = {
  task_id: string
  status: TaskStatus
}

type TaskCancelLike = {
  task_id?: string | null
  status?: TaskStatus | null
  cancel_requested?: boolean | null
}

type UseRelationTaskPollingOptions = {
  enabled?: boolean
  relationType: string
  relationEntityId?: string | null
  pollIntervalMs?: number
  onTaskSettled?: (taskId: string, finalTask?: RelationTaskState | null) => Promise<void> | void
}


export const RELATION_TASK_POLL_INTERVAL_MS = 2000

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['queued', 'running']

export function isActiveTaskStatus(status?: TaskStatus | null): boolean {
  return !!status && ACTIVE_TASK_STATUSES.includes(status)
}

export function createRelationTaskState(
  data: AsyncTaskCreateLike,
  options?: { cancelRequested?: boolean },
): RelationTaskState {
  return {
    taskId: data.task_id,
    status: data.status,
    progress: 0,
    cancelRequested: options?.cancelRequested ?? false,
  }
}

export function toRelationTaskStateFromStatusRead(
  data: Pick<
    TaskStatusRead,
    | 'task_id'
    | 'status'
    | 'progress'
    | 'cancel_requested'
    | 'started_at_ts'
    | 'finished_at_ts'
    | 'elapsed_ms'
  >,
): RelationTaskState {
  return {
    taskId: data.task_id,
    status: data.status,
    progress: data.progress ?? 0,
    cancelRequested: !!data.cancel_requested,
    startedAtTs: data.started_at_ts,
    finishedAtTs: data.finished_at_ts,
    elapsedMs: data.elapsed_ms,
  }
}

export function applyCancelToRelationTaskState(
  currentTask: RelationTaskState,
  data?: TaskCancelLike | null,
): RelationTaskState {
  return {
    taskId: data?.task_id || currentTask.taskId,
    status: (data?.status ?? currentTask.status) as TaskStatus,
    progress: currentTask.progress,
    cancelRequested: data?.cancel_requested ?? true,
    startedAtTs: currentTask.startedAtTs,
    finishedAtTs: currentTask.finishedAtTs,
    elapsedMs: currentTask.elapsedMs,
  }
}

export async function loadActiveRelationTask(
  relationType: string,
  relationEntityId: string,
): Promise<RelationTaskState | null> {
  const response = await FilmService.listTasksApiV1FilmTasksGet({
    targetType: relationType,
    targetId: relationEntityId,
    statuses: ['queued', 'running'],
    limit: 1,
  })
  const task = response.data?.items[0]
  return task ? toRelationTaskStateFromStatusRead(task) : null
}

async function loadTaskState(taskId: string): Promise<RelationTaskState | null> {
  const statusRes = await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId })
  const data = statusRes.data
  if (!data) return null
  const taskState = toRelationTaskStateFromStatusRead(data)
  if (!isActiveTaskStatus(data.status)) return taskState
  return taskState
}

export function useRelationTaskPolling({
  enabled = true,
  relationType,
  relationEntityId,
  pollIntervalMs = RELATION_TASK_POLL_INTERVAL_MS,
  onTaskSettled,
}: UseRelationTaskPollingOptions) {
  const [task, setTask] = useState<RelationTaskState | null>(null)
  const [settledTask, setSettledTask] = useState<RelationTaskState | null>(null)
  const previousTaskIdRef = useRef<string | null>(null)
  const onTaskSettledRef = useRef<UseRelationTaskPollingOptions['onTaskSettled']>(onTaskSettled)
  const taskRef = useRef<RelationTaskState | null>(null)

  useEffect(() => {
    onTaskSettledRef.current = onTaskSettled
  }, [onTaskSettled])

  const setTrackedTask = useCallback((next: RelationTaskState | null) => {
    setTask(next)
    setSettledTask(null)
    taskRef.current = next
    previousTaskIdRef.current = next?.taskId ?? null
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!enabled || !relationEntityId) {
      setTask(null)
      setSettledTask(null)
      taskRef.current = null
      previousTaskIdRef.current = null
      return () => {
        cancelled = true
      }
    }

    const load = async () => {
      try {
        const nextTask = await loadActiveRelationTask(relationType, relationEntityId)
        if (cancelled) return
        setTask(nextTask)
        setSettledTask(null)
        taskRef.current = nextTask
        const previousTaskId = previousTaskIdRef.current
        if (previousTaskId && !nextTask) {
          await onTaskSettledRef.current?.(previousTaskId, null)
        }
        previousTaskIdRef.current = nextTask?.taskId ?? null
      } catch {
        if (!cancelled) {
          setTask(null)
          setSettledTask(null)
          taskRef.current = null
          previousTaskIdRef.current = null
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [enabled, relationEntityId, relationType])

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    if (!enabled || !task?.taskId || !isActiveTaskStatus(task.status)) {
      return () => {
        cancelled = true
      }
    }

    const poll = async () => {
      try {
        const currentTask = taskRef.current
        if (!currentTask?.taskId) return
        const nextTask = await loadTaskState(currentTask.taskId)
        if (cancelled) return
        if (nextTask && isActiveTaskStatus(nextTask.status)) {
          setTask(nextTask)
          setSettledTask(null)
          taskRef.current = nextTask
          previousTaskIdRef.current = nextTask.taskId
          timer = window.setTimeout(() => {
            void poll()
          }, pollIntervalMs)
          return
        }
        const settledTaskId = previousTaskIdRef.current
        setTask(null)
        setSettledTask(nextTask)
        taskRef.current = null
        previousTaskIdRef.current = null
        if (settledTaskId) {
          await onTaskSettledRef.current?.(settledTaskId, nextTask)
        }
      } catch {
        if (!cancelled) {
          timer = window.setTimeout(() => {
            void poll()
          }, pollIntervalMs)
        }
      }
    }

    timer = window.setTimeout(() => {
      void poll()
    }, pollIntervalMs)

    return () => {
      cancelled = true
      if (timer !== null) window.clearTimeout(timer)
    }
  }, [enabled, pollIntervalMs, task?.taskId, task?.status])

  return { task, settledTask, setTrackedTask, previousTaskIdRef }
}

export function useCancelableRelationTask(options: UseRelationTaskPollingOptions) {
  const relationTask = useRelationTaskPolling(options)

  const trackTaskData = useCallback(
    (data: AsyncTaskCreateLike | null | undefined, taskOptions?: { cancelRequested?: boolean }) => {
      if (!data) return null
      const nextTask = createRelationTaskState(data, taskOptions)
      relationTask.setTrackedTask(nextTask)
      return nextTask
    },
    [relationTask],
  )

  const applyCancelData = useCallback(
    (data?: TaskCancelLike | null) => {
      if (!relationTask.task) return null
      const nextTask = applyCancelToRelationTaskState(relationTask.task, data)
      relationTask.setTrackedTask(nextTask)
      return nextTask
    },
    [relationTask],
  )

  return {
    ...relationTask,
    trackTaskData,
    applyCancelData,
  }
}
