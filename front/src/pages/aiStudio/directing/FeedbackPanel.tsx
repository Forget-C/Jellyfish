import { useWorkspacePreparation } from './useWorkspacePreparation'
import { useWorkspaceDraft } from './WorkspaceDrafts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Select, Space, Spin, Typography } from 'antd'
import { useSearchParams } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { FeedbackRead, CutReview_Input, RepairItem_Input, KnowledgeCandidate_Input, WorkspaceRead } from '../../../services/generated'
import { cutDestination } from './workspaceCut'
import { directingError } from './common'
import { CutReviewForm, KnowledgeForm, RepairForm, RepairPlanFields } from './FeedbackForms'

type Document = { kind: 'cut_review'; content: CutReview_Input } | { kind: 'repair'; content: RepairItem_Input } | { kind: 'knowledge'; content: KnowledgeCandidate_Input }
const kinds = { cut_review: '整场验收', repair: '最小返工单', knowledge: '经验候选' }

/** 反馈只保存人工决定，确认版本不原地修改，拍摄仍从既有明确入口执行。 */
export function FeedbackPanel({ projectId, workspace, onRefresh }: { projectId: string; workspace: WorkspaceRead; onRefresh: () => Promise<void> }) {
  const sequenceId = workspace.sequence.id
  const [search, setSearch] = useSearchParams()
  const requestedFeedback = search.get('feedback')
  const restoredFeedback = useRef<string>()
  const rememberFeedback = (id: string) => { const next = new URLSearchParams(search); next.set('feedback', id); setSearch(next, { replace: true, state: { directingContextSync: true } }) }
  const [data, setData] = useState<FeedbackRead>()
  const [document, setDocument] = useState<Document>()
  const [base, setBase] = useState<{ id: string; version: number; confirmed: boolean; document: Document }>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const preparation = useWorkspacePreparation('局部补拍准备', `${projectId}:${sequenceId}:repair:${base?.id || 'new'}`, { coverageIds: [] as string[], action: '', duration: 3000 })
  const { coverageIds, action, duration } = preparation.value
  /** 刷新事实但不覆盖当前编辑，旧草稿写入由服务端 CAS 拒绝。 */
  const reload = useCallback(async () => {
    try { const response = await StudioDirectingService.directingFeedback({ projectId, sequenceId }); if (response.data) setData(response.data) }
    catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId])
  useEffect(() => { void reload() }, [reload, workspace.cuts])
  /** 统一操作反馈并保持失败时的用户输入。 */
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await action(); return true } catch (cause) { setError(directingError(cause)); return false } finally { setBusy(false) }
  }
  const rows = [
    ...(data?.reviews || []).map(row => ({ row, document: { kind: 'cut_review', content: row.content } as Document })),
    ...(data?.repairs || []).map(({ revision: row }) => ({ row, document: { kind: 'repair', content: row.content } as Document })),
    ...(data?.knowledge || []).map(row => ({ row, document: { kind: 'knowledge', content: row.content } as Document })),
  ]
  const activeCut = workspace.cuts.find(row => row.id === data?.active_cut_revision_id)
  const current = data?.reviews.find(row => row.id === data.current_review_id && row.confirmed_at && row.content.cut_revision_id === data.active_cut_revision_id)
  const dirty = JSON.stringify(document) !== JSON.stringify(base?.document)
  const live = rows.find(item => item.row.id === base?.id)?.row
  const stale = !!base && !!live && (live.version !== base.version || !!live.confirmed_at !== base.confirmed)
  useEffect(() => {
    if (!data || !requestedFeedback || restoredFeedback.current === requestedFeedback) return
    const review = data.reviews.find(row => row.id === requestedFeedback)
    const repair = data.repairs.find(row => row.revision.id === requestedFeedback)?.revision
    const knowledge = data.knowledge.find(row => row.id === requestedFeedback)
    const row = review || repair || knowledge
    if (!row) return
    const selected = { kind: review ? 'cut_review' : repair ? 'repair' : 'knowledge', content: row.content } as Document
    setDocument(structuredClone(selected)); setBase({ id: row.id, version: row.version, confirmed: !!row.confirmed_at, document: structuredClone(selected) })
    restoredFeedback.current = requestedFeedback
  }, [data, requestedFeedback])
  /** 新记录固定当前采用，返工后续可关联历史或新结果。 */
  const create = (kind: Document['kind']) => guard(() => {
    setBase(undefined); rememberFeedback('')
    if (kind === 'knowledge') setDocument({ kind, content: { category: 'O', role: 'direction', claim: {}, conditions: '', recommendation: '', counterexamples: {}, exceptions: {}, confidence: 'tentative', review_on: new Date().toISOString().slice(0, 10), evidence_revision_ids: [], evidence_take_ids: [] } })
    else if (activeCut && kind === 'cut_review') setDocument({ kind, content: { cut_revision_id: activeCut.id, verdict: 'revise', overall: {}, established: {}, missing_coverage: {}, usable_ranges: [], awaiting_evidence: {}, sound_status: 'pending_postproduction', sound_observation: {}, issues: [] } })
    else if (activeCut && kind === 'repair') {
      const item = activeCut.content.items.find(row => row.kind === 'media')
      if (item && 'media_range' in item) setDocument({ kind, content: { cut_revision_id: activeCut.id, item_id: item.id, problem_range: item.media_range, symptom: {}, root_cause_hypothesis: {}, retained_ranges: [], preferred_fix: 'trim', alternative_fix: {}, needs_new_media: false, primary_change: {}, acceptance: {}, comparison: {}, attribution: 'unproven' } })
    }
  })
  /** 保存成功后选中服务端快照，确认按钮不使用未保存表单。 */
  const save = () => run(async () => {
    if (!document) throw new Error('没有可保存的反馈')
    const response = await StudioDirectingService.directingSaveFeedback({ projectId, sequenceId, requestBody: { document,
      ...(base?.confirmed ? { parent_id: base.id } : base ? { revision_id: base.id, expected_version: base.version } : {}) } })
    if (!response.data) throw new Error('保存反馈未返回有效版本')
    setData(response.data)
    const group = document.kind === 'cut_review' ? response.data.reviews : document.kind === 'repair' ? response.data.repairs.map(row => row.revision) : response.data.knowledge
    const row = base && !base.confirmed ? group.find(row => row.id === base.id) : group.slice(-1)[0]
    if (!row) throw new Error('未找到已保存的反馈版本')
    if (row) { rememberFeedback(row.id); const saved = { kind: document.kind, content: row.content } as Document; setDocument(saved); setBase({ id: row.id, version: row.version, confirmed: !!row.confirmed_at, document: saved }) }
  })
  const guard = useWorkspaceDraft({ name: '验收与返工反馈', dirty, save, discard: () => setDocument(base?.document ? structuredClone(base.document) : undefined) })
  if (!data) return <Space><Spin />{error && <Alert type="error" message={error} />}</Space>
  return <Space data-workspace-target="feedback" tabIndex={-1} direction="vertical" className="w-full" size="large">
    {error && <Alert type="error" message={error} />}{notice && <Alert type="success" message={notice} />}
    <Alert type="info" message={current ? `当前采用验收：${current.content.verdict === 'pass' ? '画面通过' : '需调整'}；${current.content.sound_status === 'pending_postproduction' ? '声音待后期' : '声音有单独审查记录'}` : '当前采用尚无已确认场次验收；旧版结论保留在历史中。'} />
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
      <Card size="small" title="画面验收">{current ? current.content.verdict === 'pass' ? '当前采用画面已通过' : '当前采用画面需要调整' : '当前采用尚待验收'}</Card>
      <Card size="small" title="声音完成度">{current ? ({ pending_postproduction: '声音待后期', reviewed: '已实际审听', not_applicable: '声音不适用' }[current.content.sound_status]) : '尚无当前版本的确认声音记录'}</Card>
    </div>
    {current?.content.issues.map((issue, index) => <Card key={issue.id} size="small" title={`当前采用的问题 ${index + 1}`}>
      <Typography.Paragraph>{issue.observation.text || issue.observation.reason || '观察待补充'}</Typography.Paragraph>
      {issue.evidence?.map((evidence, i) => <Button key={i} onClick={() => {
        const matches = activeCut?.content.items.filter(item => 'take_id' in item && item.take_id === evidence.take_id && item.media_range.source_in_ms < evidence.media_range.source_out_ms && item.media_range.source_out_ms > evidence.media_range.source_in_ms) || []
        setSearch(cutDestination(search, { view: 'cut', cut: activeCut?.id, take: evidence.take_id, item: matches.length === 1 ? matches[0].id : '', feedback: current.id, returnView: 'feedback' }))
      }}>查看问题证据 {i + 1} · {evidence.media_range.source_in_ms / 1000}–{evidence.media_range.source_out_ms / 1000} 秒</Button>)}
    </Card>)}
    <Space wrap><Button disabled={!activeCut} onClick={() => create('cut_review')}>新建整场验收</Button><Button disabled={!activeCut?.content.items.some(item => item.kind === 'media')} onClick={() => create('repair')}>新建最小返工单</Button><Button onClick={() => create('knowledge')}>新建经验候选</Button><Button onClick={reload}>刷新反馈记录</Button></Space>
    <Select aria-label="选择反馈版本" placeholder="选择已保存的验收、返工或经验版本" className="w-full" value={base?.id} options={rows.map(({ row, document }, index) => ({ value: row.id, label: `${index + 1}. ${kinds[document.kind]} · ${row.confirmed_at ? '已确认' : '草稿'} · ${row.id}` }))} onChange={id => guard(() => {
      const selected = rows.find(item => item.row.id === id)!
      rememberFeedback(id); setDocument(structuredClone(selected.document)); setBase({ id, version: selected.row.version, confirmed: !!selected.row.confirmed_at, document: structuredClone(selected.document) })
    })} />
    {stale && <Alert type="warning" message="所选记录已变化，请重新选择版本核对，当前输入不会被自动覆盖。" />}
    {document && <Card title={kinds[document.kind]}>
      {'cut_revision_id' in document.content && <Typography.Paragraph>审查依据：{document.content.cut_revision_id}{document.content.cut_revision_id !== data.active_cut_revision_id ? ' · 历史采用，不能代表当前验收' : ' · 当前采用'}</Typography.Paragraph>}
      {document.kind === 'cut_review' && <CutReviewForm value={document.content} workspace={workspace} onChange={content => setDocument({ kind: 'cut_review', content })} />}
      {document.kind === 'repair' && <>{document.content.cut_revision_id !== data.active_cut_revision_id && <Alert type="warning" message="返工依据属于历史采用，可继续查看；准备补拍前须核对当前采用并新建返工记录。" action={<Button disabled={!activeCut} onClick={() => create('repair')}>为当前采用新建返工单</Button>} />}<RepairForm value={document.content} workspace={workspace} onChange={content => setDocument({ kind: 'repair', content })} />
        <Typography.Paragraph>实际输入变化：{data.repairs.find(row => row.revision.id === base?.id)?.changed_factors.join('、') || '尚无可比较新输入'}</Typography.Paragraph>
        {preparation.error && <Alert type="warning" message={preparation.error} />}
        <Typography.Text type="secondary">补拍准备自动暂存于本浏览器会话；创建计划仍需明确点击。</Typography.Text>
        <RepairPlanFields value={document.content} workspace={workspace} coverageIds={coverageIds} action={action} duration={duration} onCoverage={coverageIds => preparation.update({ coverageIds })} onAction={action => preparation.update({ action })} onDuration={duration => preparation.update({ duration })} />
        <Button loading={busy} disabled={document.content.cut_revision_id !== data.active_cut_revision_id || !document.content.needs_new_media || !base?.confirmed || dirty || stale || !coverageIds.length || !action.trim() || duration <= 0} onClick={() => run(async () => {
          await StudioDirectingService.directingPrepareRepairPlan({ projectId, sequenceId, revisionId: base!.id, requestBody: { coverage_item_ids: coverageIds, action_scope: action, duration_ms: duration } })
          await onRefresh(); await reload(); setNotice('已创建仅含所选覆盖项的补拍计划草稿；原采用保持不变，请去单元试拍核对并确认。')
        })}>从返工单准备局部计划草稿</Button>
        <Typography.Paragraph>关联的补拍草稿：{data.repairs.find(row => row.revision.id === base?.id)?.prepared_plan_ids?.join('、') || '暂无'}</Typography.Paragraph>
        <Space wrap><Button onClick={() => {
          const content = document.content
          const item = workspace.cuts.find(row => row.id === content.cut_revision_id)?.content.items.find(row => row.id === content.item_id)
          setSearch(cutDestination(search, { view: 'cut', cut: content.cut_revision_id, item: content.item_id, take: item && 'take_id' in item ? item.take_id : undefined, feedback: base?.id, returnView: 'feedback' }))
        }}>去调整采用区间 / 替换素材</Button>
        <Button onClick={() => {
          const content = document.content
          const item = workspace.cuts.find(row => row.id === content.cut_revision_id)?.content.items.find(row => row.id === content.item_id)
          const take = item && 'take_id' in item ? workspace.takes.find(row => row.id === item.take_id) : undefined
          setSearch(cutDestination(search, { view: 'shoot', plan: take?.plan_revision_id, unit: take?.unit_id, feedback: base?.id, returnView: 'feedback' }))
        }}>核对原片段的拍摄单元</Button>
        <Button onClick={() => setSearch(cutDestination(search, { view: 'design', feedback: base?.id, returnView: 'feedback' }))}>去修改设计</Button></Space>
        {data.repairs.find(row => row.revision.id === base?.id)?.prepared_plan_ids?.map(id => <Button key={id} onClick={() => setSearch(cutDestination(search, { view: 'shoot', plan: id, unit: workspace.plans.find(row => row.id === id)?.content.units[0]?.id, feedback: base?.id, returnView: 'feedback' }))}>核对补拍草稿 {id}</Button>)}
      </>}
      {document.kind === 'knowledge' && <><KnowledgeForm value={document.content} workspace={workspace} feedback={data} onChange={content => setDocument({ kind: 'knowledge', content })} />
        <Typography.Paragraph>确认仅将此候选标为人工核对，不写入全局规则，也不改变既有设计。</Typography.Paragraph>
        <Button disabled={!base?.confirmed || dirty || stale} loading={busy} onClick={() => run(async () => {
          await StudioDirectingService.directingKnowledgeStyle({ projectId, sequenceId, revisionId: base!.id }); setNotice('已创建本场适用的风格草稿；请到导演设计的项目风格中查看并显式确认。'); await onRefresh()
        })}>将经验准备为项目风格草稿</Button>
      </>}
      <Space wrap><Button type="primary" loading={busy} disabled={stale} onClick={save}>{base?.confirmed ? '保存为新版本' : '保存反馈草稿'}</Button>
        <Button loading={busy} disabled={!base || base.confirmed || dirty || stale} onClick={() => run(async () => {
          const response = await StudioDirectingService.directingConfirmFeedback({ projectId, sequenceId, revisionId: base!.id, requestBody: { expected_version: base!.version } })
          if (response.data) { setData(response.data); setBase({ ...base!, confirmed: true, version: base!.version + 1 }); setNotice('已确认，后续修改将派生新版本。') }
        })}>确认此反馈版本</Button></Space>
    </Card>}
  </Space>
}
