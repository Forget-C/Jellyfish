import { message } from 'antd'
import { ApiError, FilmService } from '../../../services/generated'
import type { TaskStatus } from '../../../services/generated'
import type { RelationTaskState } from '../project/ProjectWorkbench/chapterDivisionTasks'

type AsyncTaskCreateLike = {
  task_id: string
  status: TaskStatus
  reused?: boolean | null
}

type AsyncTaskCreateResponse<T extends AsyncTaskCreateLike> = {
  data?: T | null
  message?: string | null
}

type ExecuteAsyncTaskCreateOptions<T extends AsyncTaskCreateLike> = {
  request: () => Promise<AsyncTaskCreateResponse<T>>
  trackTaskData: (
    data: { task_id: string; status: TaskStatus },
    options?: { cancelRequested?: boolean }
  ) => RelationTaskState | null
  startedMessage: string
  reusedMessage: string
  fallbackErrorMessage: string
  emptyDataErrorMessage?: string
  getErrorMessage?: (error: unknown, fallbackErrorMessage: string) => string
}

export function defaultTaskActionErrorMessage(error: unknown, fallbackErrorMessage: string): string {
  if (!error) return fallbackErrorMessage
  if (error instanceof ApiError && error.body && typeof error.body === 'object') {
    const msg = (error.body as { message?: unknown }).message
    if (typeof msg === 'string' && msg.trim()) return msg.trim()
  }
  if (typeof error === 'string' && error.trim()) return error
  if (typeof error === 'object') {
    const maybeAny = error as {
      body?: { detail?: unknown }
      detail?: unknown
      message?: unknown
    }
    const detail = maybeAny.body?.detail ?? maybeAny.detail
    if (typeof detail === 'string' && detail.trim()) return detail
    if (typeof maybeAny.message === 'string' && maybeAny.message.trim()) return maybeAny.message
  }
  return fallbackErrorMessage
}

type TaskCancelReadLike = {
  task_id?: string | null
  status?: TaskStatus | null
  cancel_requested?: boolean | null
  effective_immediately?: boolean | null
}

type TaskCancelResponse<T extends TaskCancelReadLike> = {
  data?: T | null
  message?: string | null
}

type ExecuteTaskCancelOptions<T extends TaskCancelReadLike> = {
  taskId: string
  reason?: string
  applyCancelData: (data?: T | null) => RelationTaskState | null
  cancelledImmediatelyMessage: string
  cancelRequestedMessage: string
  fallbackErrorMessage: string
  getErrorMessage?: (error: unknown, fallbackErrorMessage: string) => string
}

type NotifyExistingTaskOptions = {
  runningMessage: string
  cancellingMessage: string
}

export async function executeAsyncTaskCreate<T extends AsyncTaskCreateLike>({
  request,
  trackTaskData,
  startedMessage,
  reusedMessage,
  fallbackErrorMessage,
  emptyDataErrorMessage,
  getErrorMessage = defaultTaskActionErrorMessage,
}: ExecuteAsyncTaskCreateOptions<T>): Promise<T | null> {
  try {
    const res = await request()
    const data = res.data
    if (!data) {
      message.error(res.message || emptyDataErrorMessage || fallbackErrorMessage)
      return null
    }
    trackTaskData({ task_id: data.task_id, status: data.status })
    message.success(data.reused ? reusedMessage : startedMessage)
    return data
  } catch (error) {
    message.error(getErrorMessage(error, fallbackErrorMessage))
    return null
  }
}

export async function executeTaskCancel<T extends TaskCancelReadLike>({
  taskId,
  reason,
  applyCancelData,
  cancelledImmediatelyMessage,
  cancelRequestedMessage,
  fallbackErrorMessage,
  getErrorMessage = defaultTaskActionErrorMessage,
}: ExecuteTaskCancelOptions<T>): Promise<T | null> {
  try {
    const res = (await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({
      taskId,
      requestBody: { reason },
    })) as TaskCancelResponse<T>
    const data = res.data
    applyCancelData(data)
    message.success(data?.effective_immediately ? cancelledImmediatelyMessage : cancelRequestedMessage)
    return data ?? null
  } catch (error) {
    message.error(getErrorMessage(error, fallbackErrorMessage))
    return null
  }
}

export function notifyExistingTask(
  task: Pick<RelationTaskState, 'cancelRequested'> | null | undefined,
  options: NotifyExistingTaskOptions,
): boolean {
  if (!task) return false
  message.info(task.cancelRequested ? options.cancellingMessage : options.runningMessage)
  return true
}

/**
 * 从统一 ApiResponse 信封或扁平结构中读取 task_id（兼容代理剥离 Content-Type、字段别名等）。
 */
export function extractTaskIdFromApiEnvelope(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null
  const o = body as Record<string, unknown>
  const nested = o.data
  if (nested && typeof nested === 'object') {
    const d = nested as Record<string, unknown>
    const id = d.task_id ?? d.taskId
    if (typeof id === 'string' && id.trim().length > 0) return id.trim()
  }
  const flat = o.task_id ?? o.taskId
  if (typeof flat === 'string' && flat.trim().length > 0) return flat.trim()
  return null
}
