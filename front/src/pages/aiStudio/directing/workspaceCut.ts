import type { SequenceCut_Input, WorkspaceRead } from '../../../services/generated'

/** 重排主轨时以真实源区间计时，预演时长单独保留为预计值。 */
export function sequentialCut(cut: SequenceCut_Input): SequenceCut_Input {
  let start = 0
  return { items: cut.items.map(item => {
    const next = { ...item, timeline_start_ms: start }
    start += 'media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms
    return next
  }) }
}

export function cutDurations(cut: SequenceCut_Input) {
  let media = 0, planned = 0, timeline = 0
  for (const item of cut.items) {
    const duration = 'media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms
    if ('media_range' in item) media += duration
    else planned += duration
    timeline = Math.max(timeline, item.timeline_start_ms + duration)
  }
  return { media, planned, timeline }
}

/** 动作名称帮助识别素材，身份仍由 Take 与计划版本决定。 */
export function takeAction(workspace: WorkspaceRead, takeId: string): string {
  const take = workspace.takes.find(row => row.id === takeId)
  const unit = workspace.plans.find(row => row.id === take?.plan_revision_id)?.content.units.find(row => row.id === take?.unit_id)
  return unit?.coverage.map(row => row.action_scope).filter(Boolean).join('；') || '动作范围未注明'
}

/** 业务往返只携带当前页的查询参数；不跳转外部地址、不自动修改或采用。 */
export function cutDestination(search: URLSearchParams, options: { view: string; cut?: string; take?: string; item?: string; plan?: string; unit?: string; prompt?: string; design?: string; feedback?: string; ledgerTab?: string; returnView?: string }) {
  const next = new URLSearchParams(search)
  next.set('view', options.view)
  next.delete('focus')
  for (const key of ['cut', 'take', 'item', 'plan', 'unit', 'prompt', 'design', 'feedback', 'ledgerTab', 'returnView'] as const) if (options[key] !== undefined) next.set(key, options[key]!)
  if (options.view === 'cut') next.set('focus', options.item ? `cut-item:${options.item}` : options.take ? 'take-review' : 'cut-editor')
  if (options.view === 'shoot' && options.plan) { if (!options.prompt) next.set('prompt', ''); next.set('review', ''); next.set('focus', options.unit ? `unit:${options.unit}` : 'plan-version') }
  return next
}
