import type { WorkspaceRead } from '../../../services/generated'

export type WorkspaceVersionsSelection = { design: string | null; plan: string | null; cut: string | null }
type RevisionIdentity = { project_id: string; chapter_id: string; sequence_id: string }
const belongs = (workspace: WorkspaceRead, row: RevisionIdentity) => row.project_id === workspace.sequence.project_id
  && row.chapter_id === workspace.sequence.chapter_id && row.sequence_id === workspace.sequence.id

/** 只推导弹窗待选值，不更新编辑器、确认状态或采用指针。未知身份保留供错误提示。 */
export function selectWorkspaceVersion(workspace: WorkspaceRead, current: WorkspaceVersionsSelection,
  kind: keyof WorkspaceVersionsSelection, id: string | null): WorkspaceVersionsSelection {
  const next = { ...current, [kind]: id }
  if (kind === 'plan' && id) {
    const plan = workspace.plans.find(row => row.id === id && belongs(workspace, row))
    if (plan) next.design = plan.content.design_revision_id
  }
  if (kind === 'design') {
    const plan = workspace.plans.find(row => row.id === next.plan && belongs(workspace, row))
    if (!plan || plan.content.design_revision_id !== id) next.plan = null
  }
  return next
}

/** 选择可包含草稿和空项，但不能把失效身份或不一致的固定依据当成合法组合。 */
export function workspaceVersionErrors(workspace: WorkspaceRead, selection: WorkspaceVersionsSelection): string[] {
  const errors: string[] = []
  const design = workspace.designs.find(row => row.id === selection.design && belongs(workspace, row))
  const plan = workspace.plans.find(row => row.id === selection.plan && belongs(workspace, row))
  const cut = workspace.cuts.find(row => row.id === selection.cut && belongs(workspace, row))
  if (selection.design && !design) errors.push('所选设计不存在或不属于本场')
  if (selection.plan && !plan) errors.push('所选计划不存在或不属于本场')
  if (selection.cut && !cut) errors.push('所选剪辑不存在或不属于本场')
  if (plan && plan.content.design_revision_id !== selection.design) errors.push('计划依据另一设计，请核对固定设计')
  if (plan && design && !design.confirmed_at) errors.push('计划的固定设计尚未确认')
  return errors
}
