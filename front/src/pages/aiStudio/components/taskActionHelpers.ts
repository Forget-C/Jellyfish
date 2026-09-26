import { message } from 'antd'
import { FilmService } from '../../../services/generated'
import type { TaskStatus } from '../../../services/generated'
import type { RelationTaskState } from '../project/ProjectWorkbench/chapterDivisionTasks'
import { rememberTechnicalDetail, toUserFacingText } from './userFacingMessage.ts'

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

/**
 * 从任意异常里取出**后端原文**（不做任何面向用户的加工）。
 *
 * 单独抽出来的目的：原文有两个去处 —— ① 进默认收起的「技术详情」；
 * ② 兜底时作为业务化改写的输入。两者都不能直接 `message.error`。
 */
export function readRawErrorMessage(error: unknown): string {
  if (!error) return ''
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
  if (error instanceof Error && error.message.trim()) return error.message
  return ''
}

/**
 * 任务类操作的**统一错误出口**（审计 §4.4 模式 6 的第 1 条）。
 *
 * 旧实现是「后端原文 → 用户可见」的直通管道：裸字符串异常、`body.detail`、`message`
 * 全部原样返回，调用点再 `message.error(...)` 打到主区。现在统一过三级管道
 * （`maskInternalIds` → `sanitizeUserText` → 业务化改写），三步都过完仍不干净时
 * 用调用点自己的中文兜底（`fallbackErrorMessage`），**绝不把原文摆上主区**。
 *
 * 改这一处覆盖全仓多个调用点（`ChapterShotEditPage.tsx:856,912`、
 * `AssetEditPageBase.tsx:696`、`ChapterShotAssetBindingSection.tsx:186` 等）。
 */
export function defaultTaskActionErrorMessage(error: unknown, fallbackErrorMessage: string): string {
  if (!error) return fallbackErrorMessage
  const raw = readRawErrorMessage(error)
  if (!raw) return fallbackErrorMessage
  return toUserFacingText(raw, fallbackErrorMessage)
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

/**
 * 失败时的唯一出口：**主区只出中文结论 + 原文进技术详情**。
 *
 * 调用点可能自带 `getErrorMessage`（历史上确实有），所以这里在出口处**再过一次**
 * 三级管道 —— 否则「换个调用点就漏一次原文」。管道对干净的中文是幂等的。
 */
function emitTaskActionError(
  error: unknown,
  fallbackErrorMessage: string,
  getErrorMessage: (error: unknown, fallbackErrorMessage: string) => string,
  scope: string,
): void {
  const candidate = getErrorMessage(error, fallbackErrorMessage)
  const title = toUserFacingText(candidate, fallbackErrorMessage)
  const raw = readRawErrorMessage(error)
  if (raw && raw !== title) {
    rememberTechnicalDetail({ title, detail: raw, scope })
  }
  message.error(title)
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
      /* 审计 §7.1-8：主区那一句必须是产品自己写死的中文常量，不许是后端句子的改写结果。
         后端信封的 `message` 在这个仓里恒为 `success`（见 `ApiResponse` 构造），
         直接上屏就是「一句英文上主区」；所以它只进技术详情。 */
      const fallback = emptyDataErrorMessage || fallbackErrorMessage
      if (res.message) {
        rememberTechnicalDetail({ title: fallback, detail: String(res.message), scope: '任务提交' })
      }
      message.error(fallback)
      return null
    }
    trackTaskData({ task_id: data.task_id, status: data.status })
    message.success(data.reused ? reusedMessage : startedMessage)
    return data
  } catch (error) {
    emitTaskActionError(error, fallbackErrorMessage, getErrorMessage, '任务提交')
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
    emitTaskActionError(error, fallbackErrorMessage, getErrorMessage, '取消任务')
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
