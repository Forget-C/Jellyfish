import type { FeedbackRead, SequenceCut_Input, WorkspaceRead } from '../../../services/generated'

export type CutRevision = WorkspaceRead['cuts'][number]
export type ActiveCutState = { status: 'loading' | 'error' } | { status: 'ready'; cut?: CutRevision; feedback?: FeedbackRead }

/** 当前采用只认服务端指针；上下文缺失或版本未确认时保持未知，不能猜测为未采用。 */
export function resolveActiveCut(workspace: WorkspaceRead, id: string | null | undefined): ActiveCutState {
  if (id === null) return { status: 'ready' }
  const cut = workspace.cuts.find(row => row.id === id && row.sequence_id === workspace.sequence.id && row.confirmed_at)
  return cut ? { status: 'ready', cut } : { status: 'error' }
}

export function revisionName(rows: Array<{ id: string }>, id: string, kind: string): string {
  const index = rows.findIndex(row => row.id === id)
  return index < 0 ? `${kind} ${id}` : `${kind} ${index + 1}`
}

export function takeRanges(cut: SequenceCut_Input | undefined, takeId: string): string[] {
  return (cut?.items || []).flatMap((item, index) => 'media_range' in item && item.take_id === takeId
    ? [`片段 ${index + 1} · ${(item.media_range.source_in_ms / 1000).toFixed(3)}–${(item.media_range.source_out_ms / 1000).toFixed(3)} 秒`]
    : [])
}

export function takeUsage(active: ActiveCutState, takeId: string): string {
  if (active.status !== 'ready') return active.status === 'loading' ? '采用状态加载中' : '采用状态暂不可用'
  return takeRanges(active.cut?.content, takeId).length ? '当前采用（指定区间）' : '当前未采用'
}

/** 确认状态与采用关系分开；本地变更永远标为草稿，不借用基线版本的已确认标签。 */
export function cutStatus(row: CutRevision, active: ActiveCutState): string {
  if (!row.confirmed_at) return '草稿'
  if (active.status !== 'ready') return '已确认 · 采用状态待核对'
  return active.cut?.id === row.id ? '已确认 · 当前采用' : '已确认 · 历史版本'
}

/** 由当前剪辑的真实素材和预演引用追溯设计/计划，不按新旧顺序决定“在用”。 */
export function revisionReferences(workspace: WorkspaceRead, active: ActiveCutState, kind: 'design' | 'plan', id: string): string[] {
  const activeItems = active.status === 'ready' ? active.cut?.content.items || [] : []
  const activeTakeIds = new Set(activeItems.flatMap(item => 'take_id' in item ? [item.take_id] : []))
  const usedPlans = new Set(workspace.takes.filter(take => activeTakeIds.has(take.id)).map(take => take.plan_revision_id))
  if (kind === 'plan') return [
    ...workspace.prompts.filter(row => row.content.plan_revision_id === id).map(row => revisionName(workspace.prompts, row.id, '提示词')),
    ...workspace.takes.filter(row => row.plan_revision_id === id).map(row => `${revisionName(workspace.takes, row.id, 'Take')}${activeTakeIds.has(row.id) ? '（当前采用仍在引用）' : ''}`),
  ]
  return [
    ...workspace.plans.filter(row => row.content.design_revision_id === id).map(row => `${revisionName(workspace.plans, row.id, '计划')} · ${row.confirmed_at ? '已确认' : '草稿'}${usedPlans.has(row.id) ? '（当前采用仍在引用）' : ''}`),
    ...workspace.cuts.filter(row => row.content.items.some(item => 'design_revision_id' in item && item.design_revision_id === id)).map(row => `${revisionName(workspace.cuts, row.id, '剪辑')} · 预演依据${active.status === 'ready' && active.cut?.id === row.id ? '（当前采用仍在引用）' : ''}`),
  ]
}
