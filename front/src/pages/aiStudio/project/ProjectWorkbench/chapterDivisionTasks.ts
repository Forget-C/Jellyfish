import { useCallback, useEffect, useRef, useState } from 'react'
import { FilmService } from '../../../../services/generated'
import type { TaskStatus, TaskStatusRead } from '../../../../services/generated'

export const CHAPTER_DIVISION_RELATION_TYPE = 'chapter_division'
export const SCRIPT_EXTRACTION_RELATION_TYPE = 'script_extraction'
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
  /** 任务失败时由轮询接口返回，便于直接展示给用户 */
  error?: string | null
}

export type ChapterDivisionTaskState = RelationTaskState

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

type UseChapterDivisionTaskMapPollingOptions = {
  enabled?: boolean
  chapterIds: string[]
  pollIntervalMs?: number
  onTasksSettled?: (chapterIds: string[]) => Promise<void> | void
}

export const RELATION_TASK_POLL_INTERVAL_MS = 2000

const ACTIVE_TASK_STATUSES: TaskStatus[] = ['pending', 'running', 'streaming']

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
    | 'error'
  >,
): RelationTaskState {
  return {
    taskId: data.task_id,
    status: data.status,
    progress: data.progress,
    cancelRequested: !!data.cancel_requested,
    startedAtTs: data.started_at_ts,
    finishedAtTs: data.finished_at_ts,
    elapsedMs: data.elapsed_ms,
    error: data.error?.trim() ? data.error.trim() : null,
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
    error: currentTask.error,
  }
}

export function upsertRelationTaskStateInMap(
  currentMap: Record<string, RelationTaskState>,
  entityId: string,
  nextTask: RelationTaskState,
): Record<string, RelationTaskState> {
  return {
    ...currentMap,
    [entityId]: nextTask,
  }
}

export async function loadActiveRelationTask(
  relationType: string,
  relationEntityId: string,
): Promise<RelationTaskState | null> {
  const linksRes = await FilmService.listTaskLinksApiV1FilmTaskLinksGet({
    relationType,
    relationEntityId,
    page: 1,
    pageSize: 20,
    order: 'updated_at',
    isDesc: true,
  })
  const links = linksRes.data?.items ?? []
  for (const link of links) {
    const statusRes = await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId: link.task_id })
    const data = statusRes.data
    if (!data) continue
    if (!isActiveTaskStatus(data.status)) continue
    return toRelationTaskStateFromStatusRead(data)
  }
  return null
}

async function loadTaskState(taskId: string): Promise<RelationTaskState | null> {
  const statusRes = await FilmService.getTaskStatusApiV1FilmTasksTaskIdStatusGet({ taskId })
  const data = statusRes.data
  if (!data) return null
  const taskState = toRelationTaskStateFromStatusRead(data)
  if (!isActiveTaskStatus(data.status)) return taskState
  return taskState
}

async function findLatestActiveTaskForChapter(chapterId: string): Promise<ChapterDivisionTaskState | null> {
  return loadActiveRelationTask(CHAPTER_DIVISION_RELATION_TYPE, chapterId)
}

export async function loadActiveChapterDivisionTasks(
  chapterIds: string[],
): Promise<Record<string, ChapterDivisionTaskState>> {
  const entries = await Promise.all(
    chapterIds.map(async (chapterId) => [chapterId, await findLatestActiveTaskForChapter(chapterId)] as const),
  )
  return Object.fromEntries(entries.filter(([, task]) => !!task)) as Record<string, ChapterDivisionTaskState>
}

export async function loadActiveChapterDivisionTask(
  chapterId: string,
): Promise<ChapterDivisionTaskState | null> {
  return findLatestActiveTaskForChapter(chapterId)
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

export function useChapterDivisionTaskMapPolling({
  enabled = true,
  chapterIds,
  pollIntervalMs = RELATION_TASK_POLL_INTERVAL_MS,
  onTasksSettled,
}: UseChapterDivisionTaskMapPollingOptions) {
  const [taskMap, setTaskMap] = useState<Record<string, ChapterDivisionTaskState>>({})
  const previousActiveChapterIdsRef = useRef<string[]>([])
  const onTasksSettledRef = useRef<UseChapterDivisionTaskMapPollingOptions['onTasksSettled']>(onTasksSettled)

  useEffect(() => {
    onTasksSettledRef.current = onTasksSettled
  }, [onTasksSettled])

  const setTrackedTaskMap = useCallback((next: Record<string, ChapterDivisionTaskState>) => {
    setTaskMap(next)
    previousActiveChapterIdsRef.current = Object.keys(next)
  }, [])

  useEffect(() => {
    let cancelled = false
    if (!enabled || chapterIds.length === 0) {
      setTaskMap({})
      previousActiveChapterIdsRef.current = []
      return () => {
        cancelled = true
      }
    }

    const load = async () => {
      try {
        const nextMap = await loadActiveChapterDivisionTasks(chapterIds)
        if (cancelled) return
        setTaskMap(nextMap)
        const previousIds = previousActiveChapterIdsRef.current
        const currentIds = Object.keys(nextMap)
        const finishedIds = previousIds.filter((id) => !currentIds.includes(id))
        if (finishedIds.length > 0) {
          await onTasksSettledRef.current?.(finishedIds)
        }
        previousActiveChapterIdsRef.current = currentIds
      } catch {
        if (!cancelled) {
          setTaskMap({})
          previousActiveChapterIdsRef.current = []
        }
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [chapterIds, enabled])

  useEffect(() => {
    let cancelled = false
    let timer: number | null = null

    if (!enabled || chapterIds.length === 0 || Object.keys(taskMap).length === 0) {
      return () => {
        cancelled = true
      }
    }

    const poll = async () => {
      try {
        const nextMap = await loadActiveChapterDivisionTasks(chapterIds)
        if (cancelled) return
        setTaskMap(nextMap)
        const previousIds = previousActiveChapterIdsRef.current
        const currentIds = Object.keys(nextMap)
        const finishedIds = previousIds.filter((id) => !currentIds.includes(id))
        previousActiveChapterIdsRef.current = currentIds
        if (finishedIds.length > 0) {
          await onTasksSettledRef.current?.(finishedIds)
        }
        if (currentIds.length > 0) {
          timer = window.setTimeout(() => {
            void poll()
          }, pollIntervalMs)
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
  }, [chapterIds, enabled, pollIntervalMs, taskMap])

  return { taskMap, setTrackedTaskMap }
}
