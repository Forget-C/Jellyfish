import type { WorkspaceRead } from '../../../services/generated'

export type WorkspaceVersionsSelection = { design: string | null; plan: string | null; cut: string | null }
export type WorkspaceVersionKind = keyof WorkspaceVersionsSelection
type RevisionIdentity = { project_id: string; chapter_id: string; sequence_id: string }
/** 查看和编辑共用完整归属校验，不能仅凭 revision ID 认领其他场次的版本。 */
export const workspaceRevisionBelongs = (workspace: WorkspaceRead, row: RevisionIdentity) => row.project_id === workspace.sequence.project_id
  && row.chapter_id === workspace.sequence.chapter_id && row.sequence_id === workspace.sequence.id

/** 排序仅用于展示；名称仍从原始完整集合取得，缺失时间保持输入顺序。 */
export function orderedWorkspaceVersions<T extends { created_at?: string | null }>(rows: T[]): T[] {
  const time = (row: T) => row.created_at && !Number.isNaN(Date.parse(row.created_at)) ? Date.parse(row.created_at) : -Infinity
  return [...rows].sort((a, b) => time(b) - time(a))
}

/** 编辑只校验目标及其固定依据；其他类别的失效链接保留，允许逐项明确恢复。 */
export function workspaceVersionEditErrors(workspace: WorkspaceRead, next: WorkspaceVersionsSelection, kind: WorkspaceVersionKind): string[] {
  if (workspace.sequence.is_current === false) return ['历史场次仅可查看版本']
  return workspaceVersionErrors(workspace, kind === 'cut' ? { design: null, plan: null, cut: next.cut } : { ...next, cut: null })
}

/** 只推导弹窗待选值，不更新编辑器、确认状态或采用指针。未知身份保留供错误提示。 */
export function selectWorkspaceVersion(workspace: WorkspaceRead, current: WorkspaceVersionsSelection,
  kind: keyof WorkspaceVersionsSelection, id: string | null): WorkspaceVersionsSelection {
  const next = { ...current, [kind]: id }
  if (kind === 'plan' && id) {
    const plan = workspace.plans.find(row => row.id === id && workspaceRevisionBelongs(workspace, row))
    if (plan) next.design = plan.content.design_revision_id
  }
  if (kind === 'design') {
    const plan = workspace.plans.find(row => row.id === next.plan && workspaceRevisionBelongs(workspace, row))
    if (!plan || plan.content.design_revision_id !== id) next.plan = null
  }
  return next
}

/** 选择可包含草稿和空项，但不能把失效身份或不一致的固定依据当成合法组合。 */
export function workspaceVersionErrors(workspace: WorkspaceRead, selection: WorkspaceVersionsSelection): string[] {
  const errors: string[] = []
  const design = workspace.designs.find(row => row.id === selection.design && workspaceRevisionBelongs(workspace, row))
  const plan = workspace.plans.find(row => row.id === selection.plan && workspaceRevisionBelongs(workspace, row))
  const cut = workspace.cuts.find(row => row.id === selection.cut && workspaceRevisionBelongs(workspace, row))
  if (selection.design && !design) errors.push('所选设计不存在或不属于本场')
  if (selection.plan && !plan) errors.push('所选计划不存在或不属于本场')
  if (selection.cut && !cut) errors.push('所选剪辑不存在或不属于本场')
  if (plan && plan.content.design_revision_id !== selection.design) errors.push('计划依据另一设计，请核对固定设计')
  if (plan && design && !design.confirmed_at) errors.push('计划的固定设计尚未确认')
  return errors
}
