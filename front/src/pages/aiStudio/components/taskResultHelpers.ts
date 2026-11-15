import { FilmService } from '../../../services/generated'

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
      const errorMessage = data.error || options.failedFallbackMessage
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
