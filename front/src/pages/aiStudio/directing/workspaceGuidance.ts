import type { DirectingTaskRead, ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import type { WorkspaceStage } from './workspaceNavigation'

export type WorkspaceGuidance = { title: string; description: string; label: string; view: string; target: string; taskId?: string; takeId?: string }
export type SubmittedWorkspaceTask = { taskId: string; planId?: string; unitId?: string; promptId?: string }
export type GuidanceInput = {
  workspace: WorkspaceRead
  stage: WorkspaceStage
  view?: string
  design?: WorkspaceRead['designs'][number]
  plan?: WorkspaceRead['plans'][number]
  editingPlan?: ProductionPlan_Input
  unitId?: string
  promptId?: string
  reviewId?: string
  designStale: boolean
  planStale: boolean
  tasks: DirectingTaskRead[]
  tasksState?: 'loading' | 'ready' | 'error'
  pending?: SubmittedWorkspaceTask[]
  issue?: { message: string; stage: WorkspaceStage; target: string; planId?: string; unitId?: string }
}

/** 正式六岗结论必须完整，空清单与其他提示词的报告不能提示可执行。 */
export function reviewCanExecute(review: WorkspaceRead['reviews'][number] | undefined, promptId: string | undefined): boolean {
  if (!review?.confirmed_at || review.content.mode !== 'formal' || !review.content.occurrences.length || review.content.occurrences.some(row => row.prompt_revision_id !== promptId)) return false
  const roles = ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'prompt']
  return review.content.rows.length === review.content.occurrences.length * roles.length && review.content.occurrences.every(occurrence => roles.every(role => review.content.rows.some(row => row.occurrence_id === occurrence.id && row.role === role && row.verdict === 'pass')))
}

/** 提示只使用当前对象和已知结果；不会把其他单元的失败或运行状态升级为全场阻碍。 */
export function workspaceGuidance(input: GuidanceInput): WorkspaceGuidance {
  const { workspace, stage, design, plan, editingPlan, unitId, promptId, reviewId, tasks, pending, issue } = input
  const step = (title: string, description: string, label: string, view: string, target: string): WorkspaceGuidance => ({ title, description, label, view, target })
  if (stage === 'design' && input.designStale) return step('设计版本已更新', '请核对服务端版本；本地修改仍然保留。', '核对设计版本', 'design', 'design-version')
  if (stage === 'shoot' && input.planStale) return step('生产计划已更新', '请核对版本后再准备生成指令。', '核对计划版本', 'shoot', 'plan-version')
  if (stage !== 'cut' && workspace.sequence.source_changed) return step('先核对变化后的原文', '原文或场次范围已变化。已有素材仍可审片，新的生成需先核对来源。', '回场次列表核对原文', 'source', 'source')
  if (issue?.stage === stage && (stage !== 'shoot' || issue.planId === plan?.id && issue.unitId === unitId)) return step('先处理本次操作的问题', issue.message, '定位本次输入与问题', stage, issue.target)
  const toolSteps: Record<string, WorkspaceGuidance> = {
    visual: step('按需验证参考画面', '明确本次要验证的关系或构图，产出候选图后再决定是否加入参考。', '填写验证画面要求', 'visual', 'visual'),
    batch: step('组织本次批量生成', '明确选择各条指令及匹配审稿，检查本批次输入后再提交。', '选择本批次内容', 'batch', 'batch'),
    continuity: step('检查实际片段的衔接', '以当前采用的真实区间提取边界帧，再记录人工接缝结论。', '查看实际连续性', 'continuity', 'continuity'),
    feedback: step('核对本场效果并安排局部返工', '记录本场已成立的内容、缺口与最小调整；声音完成度单独表达。', '查看验收与返工', 'feedback', 'feedback'),
    ledger: step('查看依据与历史记录', '按连续性、提示词和素材追溯原始版本；查看不会产生采用。', '查看来源与版本', 'ledger', 'ledger'),
  }
  if (input.view && toolSteps[input.view]) return toolSteps[input.view]
  if (stage === 'design') {
    if (workspace.task_ids.length && input.tasksState && input.tasksState !== 'ready') return step('先核对已有任务状态', '任务状态尚未读回或暂不可用，请先查看记录，避免重复生成。', '查看任务状态', 'design', 'tasks')
    const running = tasks.find(task => task.kind === 'directing_design' && ['queued', 'running'].includes(task.status))
    if (running) return { ...step('拍摄方案正在生成', '完成后先查看建议，再决定是否写入草稿。', '查看进度或取消任务', 'design', 'tasks'), taskId: running.task_id }
    if (!design) {
      const result = tasks.slice().reverse().find(task => task.status === 'succeeded' && task.design)
      if (result) return { ...step('已有可查看的拍摄建议', '查看后可明确写入草稿；不会自动确认方案。', '查看拍摄建议', 'design', 'result'), taskId: result.task_id }
      return step('从这场戏的原文开始', '可补充创作想法，也可以直接生成一份可修改的拍摄方案草稿。', '生成拍摄方案草稿', 'design', 'generate-design')
    }
    if (!design.source_current) return step('核对拍摄方案的来源', '此设计依据的范围已变化，请核对内容后保存为当前来源的设计。', '核对并保存设计', 'design', 'design-editor')
    if (!design.confirmed_at) return step('核对并确认拍摄方案', '检查六岗设计后确认已保存的版本，下一步再准备单元与参考。', '去确认拍摄方案', 'design', 'design-confirm')
    return step('拍摄方案已确认', '接下来明确本次生成的动作范围、模型与参考。', '去准备视频素材', 'shoot', 'plan-version')
  }
  if (stage === 'shoot') {
    if (!editingPlan) return step('先选定拍摄方案', '从已确认设计创建生产计划，明确本次要生成什么。', '选择已确认设计', 'shoot', 'plan-version')
    if (!editingPlan.units.length) return step('添加本次要拍的内容', '为一个明确的动作准备生成单元，再选择模型与参考。', '添加生成单元', 'shoot', 'plan-editor')
    const editingUnit = editingPlan.units.find(row => row.id === unitId) || editingPlan.units[0]
    if (!editingUnit.model_id) return step('下一步：选择视频模型', '模型决定实际生成时长和参考输入要求；镜头预计时长不代表模型支持的时长。', '选择视频模型', 'shoot', `unit-model:${editingUnit.id}`)
    if (plan?.confirmed_at && JSON.stringify(editingPlan) !== JSON.stringify(plan.content)) return step('拍摄准备已修改', '保存并确认新的计划版本后再准备指令，旧版本引用保持不变。', '保存并确认修改', 'shoot', 'plan-confirm')
    if (!plan?.confirmed_at) return step('核对本次范围与参考', '保存并确认生产计划后，才能生成固定的执行指令。', '去确认单元与参考', 'shoot', 'plan-confirm')
    const unit = plan.content.units.find(row => row.id === unitId)
    if (!unit) return step('选择本次生成单元', '选择一个单元后继续；不会替你切换到另一个版本。', '选择生成单元', 'shoot', 'unit-select')
    if (input.tasksState && input.tasksState !== 'ready' && pending?.some(item => workspace.task_ids.includes(item.taskId) && item.planId === plan.id && item.unitId === unitId)) return step('先核对本次任务状态', '本单元已有提交记录，等待状态读回后再决定下一步；其他独立单元仍可操作。', '查看本次任务状态', 'shoot', 'tasks')
    const running = tasks.find(task => ['queued', 'running'].includes(task.status) && pending?.some(item => item.taskId === task.task_id && item.planId === plan.id && item.unitId === unitId))
    if (running) return { ...step('本次任务正在执行', '可查看进度或取消；其他独立单元仍可准备和生成。', '查看本次任务', 'shoot', 'tasks'), taskId: running.task_id }
    const take = workspace.takes.find(row => row.plan_revision_id === plan.id && row.unit_id === unitId && row.annotation.review_status === 'unreviewed')
    if (take) return { ...step('这个单元有视频待审片', '先查看真实画面，再决定可用区间；生成成功不代表已经采用。', '查看待审视频', 'cut', 'take-review'), takeId: take.id }
    const prompt = workspace.prompts.find(row => row.id === promptId && row.content.plan_revision_id === plan.id && row.content.unit_id === unitId)
    if (!prompt && workspace.prompts.some(row => row.content.plan_revision_id === plan.id && row.content.unit_id === unitId)) return step('选择本次生成指令版本', '本单元已有指令，请明确选择要检查的版本；不会自动使用最新记录。', '选择生成指令', 'shoot', 'prompt-review')
    if (!prompt) return step('准备本次生成指令', '编译会检查当前单元的模型、时长、参考及依赖；不支持的输入需先修正。', '去准备生成指令', 'shoot', 'compile')
    const result = tasks.slice().reverse().find(task => task.status === 'succeeded' && task.review?.occurrences.length && task.review.occurrences.every(row => row.prompt_revision_id === prompt.id) && !workspace.reviews.some(row => JSON.stringify(row.content) === JSON.stringify(task.review)))
    if (result) return { ...step('本次指令已有检查结果', '查看六岗结论，再明确保存本次审稿。', '查看指令检查结果', 'shoot', 'result'), taskId: result.task_id }
    const review = workspace.reviews.find(row => row.id === reviewId && row.content.occurrences.length && row.content.occurrences.every(item => item.prompt_revision_id === prompt.id))
    if (!review) return step('检查本次生成指令', '审稿必须匹配当前提示词版本；可选择已有检查结果或发起检查。', '去检查生成指令', 'shoot', 'prompt-review')
    if (!reviewCanExecute(review, prompt.id)) return step('处理指令检查中的问题', '查看需修改项；艺术取舍可记录理由，模型与结构校验仍须通过。', '查看检查问题', 'shoot', 'review')
    return step('本次输入已准备好', '核对固定模型、范围和参考后明确开始；服务端仍会校验能力与依赖。', '核对并开始生成', 'shoot', 'shoot-confirm')
  }
  const unreviewed = workspace.takes.find(row => row.annotation.review_status === 'unreviewed')
  if (unreviewed) return { ...step('先查看待审视频', '观察实际拍到的内容，再选取可用区间加入剪辑草稿。', '去审片并选择区间', 'cut', 'take-review'), takeId: unreviewed.id }
  if (!workspace.cuts.length && !workspace.takes.length) return step('这里会得到本场粗剪', '有素材后可选取片段；已确认设计也可先组成节奏预演。', '查看预演与剪辑区', 'cut', 'cut-editor')
  return step('核对剪辑草稿与当前采用', '保存草稿后再确认采用；已有确认版本可继续检查接缝与整场效果。', '去核对剪辑', 'cut', 'cut-editor')
}
