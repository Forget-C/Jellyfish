import type { SubmittedWorkspaceTask } from './workspaceGuidance'
import type { DirectingTaskRead, WorkspaceRead } from '../../../services/generated'

const key = (projectId: string, sequenceId: string) => `directing-submitted-tasks:${projectId}:${sequenceId}`

export type ShootRequest = { prompt: string; review: string; request: string }
export type ReviewSubmission = { prompt: string; request: string }
const reviewKey = (projectId: string, sequenceId: string) => `directing-review-requests:${projectId}:${sequenceId}`

/** 检查受理尚未核实前保留身份，刷新后不能改为一次新的模型检查。 */
export function readReviewRequests(projectId: string, sequenceId: string): ReviewSubmission[] {
  const raw = sessionStorage.getItem(reviewKey(projectId, sequenceId))
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.some(item => !item || ['prompt', 'request'].some(field => typeof item[field] !== 'string' || !item[field]))) throw new Error('无法读取检查提交记录，请先核对任务记录。')
  return value
}

export function saveReviewRequest(projectId: string, sequenceId: string, request: ReviewSubmission, remove = false): ReviewSubmission[] {
  const next = readReviewRequests(projectId, sequenceId).filter(item => item.request !== request.request)
  if (!remove) next.push(request)
  sessionStorage.setItem(reviewKey(projectId, sequenceId), JSON.stringify(next))
  return next
}
export type CompileSubmission = { plan: string; unit: string; request: string }
const compileKey = (projectId: string, sequenceId: string) => `directing-compile-requests:${projectId}:${sequenceId}`

/** 编译未核实记录按计划与单元恢复，不能以新增版本数量替代本次请求身份。 */
export function readCompileRequests(projectId: string, sequenceId: string): CompileSubmission[] {
  const raw = sessionStorage.getItem(compileKey(projectId, sequenceId))
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.some(item => !item || ['plan', 'unit', 'request'].some(field => typeof item[field] !== 'string' || !item[field]))) throw new Error('无法读取指令生成记录，请先核对已有版本。')
  return value
}

export function saveCompileRequest(projectId: string, sequenceId: string, request: CompileSubmission, remove = false): CompileSubmission[] {
  const next = readCompileRequests(projectId, sequenceId).filter(item => item.request !== request.request)
  if (!remove) next.push(request)
  sessionStorage.setItem(compileKey(projectId, sequenceId), JSON.stringify(next))
  return next
}
const shootKey = (projectId: string, sequenceId: string) => `directing-shoot-requests:${projectId}:${sequenceId}`

/** 未核实提交按指令与审稿保留请求身份；刷新或切换单元后仍重试同一次授权。 */
export function readShootRequests(projectId: string, sequenceId: string): ShootRequest[] {
  const raw = sessionStorage.getItem(shootKey(projectId, sequenceId))
  if (!raw) return []
  const value: unknown = JSON.parse(raw)
  if (!Array.isArray(value) || value.some(item => !item || ['prompt', 'review', 'request'].some(field => typeof item[field] !== 'string' || !item[field]))) throw new Error('无法读取本次试拍提交记录，请先核对任务记录。')
  return value
}

/** 保存失败必须先停止提交，不能丢失幂等身份后继续创建视频任务。 */
export function saveShootRequest(projectId: string, sequenceId: string, request: ShootRequest, remove = false): ShootRequest[] {
  const previous = readShootRequests(projectId, sequenceId)
  const next = previous.filter(item => item.request !== request.request)
  if (!remove) next.push(request)
  sessionStorage.setItem(shootKey(projectId, sequenceId), JSON.stringify(next))
  return next
}

/** 检查和视频执行分别计数；已有候选数量由素材事实独立展示。 */
export function unitTaskSummary(tasks: DirectingTaskRead[]): string {
  return ['directing_review', 'video_generation'].flatMap(kind => {
    const name = kind === 'directing_review' ? '检查' : '视频生成'
    return (['queued', 'running', 'failed', 'cancelled'] as const).flatMap(status => {
      const count = tasks.filter(task => task.kind === kind && task.status === status).length
      const label = { queued: '排队中', running: '中', failed: '失败', cancelled: '已取消' }[status]
      return count ? [`${name}${label} ${count}`] : []
    })
  }).join(' · ')
}

/** 仅记住本浏览器提交时明确知道的任务范围，用于刷新后定位；不是运行状态或执行授权。 */
export function readSubmittedTasks(projectId: string, sequenceId: string): SubmittedWorkspaceTask[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(key(projectId, sequenceId)) || '[]')
    if (!Array.isArray(value)) return []
    return value.filter((item): item is SubmittedWorkspaceTask => !!item && typeof item === 'object' && typeof item.taskId === 'string' && ['planId', 'unitId', 'promptId'].every(field => item[field] === undefined || typeof item[field] === 'string'))
  } catch { return [] }
}

export function rememberSubmittedTask(projectId: string, sequenceId: string, task: SubmittedWorkspaceTask, previous: SubmittedWorkspaceTask[] = []): SubmittedWorkspaceTask[] {
  const tasks = [...new Map([...readSubmittedTasks(projectId, sequenceId), ...previous, task].map(item => [item.taskId, item])).values()]
  try { sessionStorage.setItem(key(projectId, sequenceId), JSON.stringify(tasks)) } catch { /* 存储受限时仅保留本次内存状态。 */ }
  return tasks
}

/** 任务回跳只恢复真实产出、提交记录或固定审稿清单中的身份；未知时不选最新计划。 */
export function taskWorkspaceContext(workspace: WorkspaceRead, taskId: string, submitted: SubmittedWorkspaceTask[], task?: DirectingTaskRead): SubmittedWorkspaceTask | undefined {
  const take = workspace.takes.find(row => row.task_id === taskId)
  if (take) return { taskId, planId: take.plan_revision_id, unitId: take.unit_id, promptId: take.prompt_revision_id }
  const known = submitted.find(row => row.taskId === taskId && row.planId && row.unitId)
  if (known) return known
  const occurrences = task?.task_id === taskId ? task.review?.occurrences : undefined
  const first = occurrences?.[0]
  if (first && occurrences?.every(row => row.plan_revision_id === first.plan_revision_id && row.unit_id === first.unit_id && row.prompt_revision_id === first.prompt_revision_id)) return { taskId, planId: first.plan_revision_id, unitId: first.unit_id, promptId: first.prompt_revision_id }
  return undefined
}

/** 摘要只归入有真实产出、提交范围或审稿出现项依据的计划与单元。 */
export function tasksForUnit(workspace: WorkspaceRead, tasks: DirectingTaskRead[], submitted: SubmittedWorkspaceTask[], planId?: string, unitId?: string): DirectingTaskRead[] {
  if (!planId || !unitId) return []
  return tasks.filter(task => {
    const context = taskWorkspaceContext(workspace, task.task_id, submitted, task)
    if (context) return context.planId === planId && context.unitId === unitId
    return task.review?.occurrences.some(row => row.plan_revision_id === planId && row.unit_id === unitId) || false
  })
}
