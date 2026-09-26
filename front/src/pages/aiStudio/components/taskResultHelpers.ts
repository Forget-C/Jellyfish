import { FilmService } from '../../../services/generated'
import { toUserFacingText } from './userFacingMessage.ts'

type TaskResultRead = {
  status?: string | null
  result?: unknown
  error?: string | null
}

type HandleTaskResultOptions = {
  readErrorMessage: string
  failedFallbackMessage: string
  onSucceeded: (result: unknown, data: TaskResultRead) => Promise<void> | void
  onFailed?: (errorMessage: string, data: TaskResultRead) => Promise<void> | void
  onEmpty?: (data: TaskResultRead) => Promise<void> | void
}

type SafeHandleTaskResultOptions = HandleTaskResultOptions & {
  onReadError?: (error: unknown) => Promise<void> | void
}

export async function loadTaskResult(taskId: string): Promise<TaskResultRead | null> {
  const res = await FilmService.getTaskResultApiV1FilmTasksTaskIdResultGet({ taskId })
  return (res.data as TaskResultRead | null) ?? null
}

export async function handleTaskResult(taskId: string, options: HandleTaskResultOptions): Promise<TaskResultRead | null> {
  try {
    const data = await loadTaskResult(taskId)
    if (!data) return null
    if (data.status === 'succeeded' && data.result !== undefined && data.result !== null) {
      await options.onSucceeded(data.result, data)
      return data
    }
    if (data.status === 'failed') {
      /* 审计 §4.4 模式 6 第 3 条：`data.error` 是后端原文，透传给 `onFailed` 前必须过管道
         （`onFailed` 的实参在多数调用点直接进 `message.error` / Alert 主区）。
         原文本身仍然留在 `data` 里 —— 需要排查的调用点从 `data.error` 读，不受影响。 */
      const errorMessage = toUserFacingText(data.error, options.failedFallbackMessage)
      await options.onFailed?.(errorMessage, data)
      return data
    }
    await options.onEmpty?.(data)
    return data
  } catch {
    throw new Error(options.readErrorMessage)
  }
}

export async function handleTaskResultSafely(
  taskId: string,
  options: SafeHandleTaskResultOptions,
): Promise<TaskResultRead | null> {
  try {
    return await handleTaskResult(taskId, options)
  } catch (error) {
    await options.onReadError?.(error)
    return null
  }
}

export function createTaskSettledReloader(...handlers: Array<() => Promise<void> | void>) {
  return async () => {
    await Promise.all(handlers.map((handler) => Promise.resolve(handler())))
  }
}
