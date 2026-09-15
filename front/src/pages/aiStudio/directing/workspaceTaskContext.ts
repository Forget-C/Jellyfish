import type { SubmittedWorkspaceTask } from './workspaceGuidance'
import type { DirectingTaskRead, WorkspaceRead } from '../../../services/generated'

const key = (projectId: string, sequenceId: string) => `directing-submitted-tasks:${projectId}:${sequenceId}`

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
