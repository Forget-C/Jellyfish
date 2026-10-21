import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { EditCanvasGraph, SceneCutReviewCreate, SceneCutReviewDecision, SceneCutReviewRead, SceneVersionContent_Output, SceneTakeLibraryRead } from '../../../services/generated'
import { SceneReviewPreview } from './SceneReviewPreview'
import { directingError } from './common'

const emptyDecision: SceneCutReviewDecision = { verdict: 'revise', overall: '', established: '', coverage_status: 'unknown', coverage_notes: '', issues: [], sound_status: 'pending_postproduction', sound_notes: '' }
const canonical = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)
const basis = (content: SceneVersionContent_Output) => {
  const adopted = new Set(content.timeline.items.flatMap(item => 'media_range' in item ? [`${item.take_kind}:${item.take_id}`] : []))
  return canonical({ ...content, units: content.units.map(unit => ({ id: unit.id, coverage: unit.coverage })).sort((a, b) => a.id.localeCompare(b.id)),
    timeline: { items: [...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms || a.id.localeCompare(b.id)) },
    take_judgments: content.take_judgments.filter(item => adopted.has(`${item.take_kind}:${item.take_id}`)).sort((a, b) => `${a.take_kind}:${a.take_id}`.localeCompare(`${b.take_kind}:${b.take_id}`)) })
}
const soundLabel = { pending_postproduction: '待后期', reviewed: '已审查', not_applicable: '不适用' }

/** 整场审片是独立固定记录；先持久化原请求，再提交，未知响应不改用后来输入。 */
export function SceneCutReviews({ projectId, sequenceId, versionId, revision, content, dirty, disabled, takes, onHistoryPreviewStart, evidence, navigation, onRecorded }: {
  evidence?: EditCanvasGraph; navigation?: string; onRecorded?: () => void
  takes: SceneTakeLibraryRead[]; onHistoryPreviewStart: () => void
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; dirty: boolean; disabled: boolean
}) {
  const storageKey = `scene-cut-review:${projectId}:${sequenceId}:${versionId}`
  const readStored = () => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { decision: emptyDecision, pending: undefined as SceneCutReviewCreate | undefined }
    const value = JSON.parse(raw) as { decision: SceneCutReviewDecision; pending?: SceneCutReviewCreate }
    if (!value.decision || typeof value.decision.overall !== 'string' || !Array.isArray(value.decision.issues)
      || (value.pending && (typeof value.pending.request_id !== 'string' || !Number.isInteger(value.pending.expected_revision) || !value.pending.decision))) throw new Error('本地验收凭据无法解析')
    return value
  }
  const [initial] = useState(() => { try { return { ...readStored(), error: '' } } catch { return { decision: emptyDecision, pending: undefined, error: '本地验收凭据无法读取，请恢复存储后重读；暂不提交新验收。' } } })
  const [decision, setDecision] = useState<SceneCutReviewDecision>(initial.decision)
  const [pending, setPending] = useState<SceneCutReviewCreate | undefined>(initial.pending)
  const [storageError, setStorageError] = useState(initial.error)
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error)
  const [history, setHistory] = useState<SceneCutReviewRead>()
  const [records, setRecords] = useState<SceneCutReviewRead[]>([])
  const [loading, setLoading] = useState(true)
  const [readError, setReadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  const draft = useRef(decision)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const persist = (next: SceneCutReviewDecision, request?: SceneCutReviewCreate) => {
    localStorage.setItem(storageKey, JSON.stringify({ decision: next, pending: request }))
  }
  const change = (next: SceneCutReviewDecision) => {
    setDecision(next); draft.current = next
    if (storageBlocked) return
    try { persist(next, pending); setStorageError('') } catch { setStorageError('验收输入未能保存在本地，当前输入保留；恢复存储后再提交。') }
  }
  useEffect(() => {
    let active = true
    setLoading(true); setReadError('')
    void StudioDirectingService.directingSceneCutReviews({ projectId, sequenceId, versionId }).then(response => {
      if (active) setRecords(response.data || [])
    }).catch(error => { if (active) setReadError(directingError(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, revision, attempt, evidence])
  const submit = async (request: SceneCutReviewCreate) => {
    if (busy || storageBlocked) return
    try { persist(draft.current, request) } catch { setStorageError('无法保存核实凭据，本次未提交；请恢复本地存储后重试。'); return }
    setPending(request); setBusy(true); setSubmitError('')
    try {
      const response = await StudioDirectingService.directingCreateSceneCutReview({ projectId, sequenceId, versionId, requestBody: request })
      if (!response.data) throw new Error('整场验收结果尚未核实')
      const stored = readStored()
      if (stored.pending?.request_id === request.request_id) persist(stored.decision)
      if (mounted.current) { setPending(undefined); setAttempt(value => value + 1); onRecorded?.() }
    } catch (error) {
      if (mounted.current) {
        setSubmitError(directingError(error))
        if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
          try { const stored = readStored(); if (stored.pending?.request_id === request.request_id) persist(stored.decision); setPending(undefined) } catch { setStorageError('核实凭据未能清理，请恢复本地存储。') }
        }
      }
    } finally { if (mounted.current) setBusy(false) }
  }
  const matching = [...records].reverse().find(row => basis(row.content) === basis(content))
  const issues = decision.issues || []
  const planned = content.timeline.items.filter(item => !('media_range' in item)).length
  const observations = content.take_judgments.reduce((sum, item) => sum + item.annotation.coverage.length, 0)
  const invalid = !decision.overall.trim() || (decision.coverage_status !== 'unknown' && !decision.coverage_notes?.trim())
    || (decision.sound_status !== 'pending_postproduction' && !decision.sound_notes?.trim())
    || issues.some(issue => !issue.observation.trim() || !issue.acceptance.trim())
    || (decision.coverage_status === 'verified' && planned > 0)
    || (decision.verdict === 'pass' && (decision.coverage_status !== 'verified' || issues.some(issue => issue.severity === 'required')))
  return <section aria-label="整场验收">
    <h3>整场验收</h3>
    <p>已采用 {content.timeline.items.length - planned} 个真实片段，待拍占位 {planned} 个；已记录 {observations} 条实际覆盖观察。观察数量不代表完整覆盖。</p>
    {loading && <p>正在读取整场验收记录</p>}
    {readError && <Alert type="warning" message="整场验收记录读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重读整场验收</Button>} />}
    {!loading && !readError && (matching ? <>
      <Alert type={matching.decision.verdict === 'pass' ? 'success' : 'warning'} message={matching.decision.verdict === 'pass' ? '当前画面验收通过' : '当前画面仍需修改'} />
      {matching.version_id !== versionId && <p>引用原版本审片：{matching.version_id}</p>}
      <p>当前覆盖核对：{{ unknown: '覆盖尚未核实', gaps: '存在覆盖缺口', verified: '已核对无覆盖缺口' }[matching.decision.coverage_status]}</p>
      <p>覆盖依据：{matching.decision.coverage_notes || '待核实'}</p>
      <p>当前声音：{soundLabel[matching.decision.sound_status]}</p>
    </> : <p>{records.length ? '整场验收依据已变，请重新审阅当前内容' : '当前整场尚未验收'}</p>)}
    <p>以下为本次审片输入，明确记录后形成固定结论。</p>
    <Input.TextArea aria-label="整场画面判断" placeholder="整体判断与观察依据" rows={2} disabled={disabled || busy} value={decision.overall} onChange={event => change({ ...decision, overall: event.target.value })} />
    <Input.TextArea aria-label="整场成立内容" placeholder="已经成立的内容" rows={2} disabled={disabled || busy} value={decision.established} onChange={event => change({ ...decision, established: event.target.value })} />
    <Select aria-label="整场覆盖核对" style={{ width: '100%' }} disabled={disabled || busy} value={decision.coverage_status}
      options={[{ value: 'unknown', label: '覆盖尚未核实' }, { value: 'gaps', label: '存在覆盖缺口' }, { value: 'verified', label: '已核对无覆盖缺口' }]}
      onChange={coverage_status => change({ ...decision, coverage_status })} />
    <Input.TextArea aria-label="整场覆盖依据" placeholder="实际覆盖核对依据、缺口或待核实内容" rows={2} disabled={disabled || busy} value={decision.coverage_notes} onChange={event => change({ ...decision, coverage_notes: event.target.value })} />
    <Select aria-label="整场画面结论" style={{ width: '100%' }} disabled={disabled || busy} value={decision.verdict}
      options={[{ value: 'revise', label: '画面需修改' }, { value: 'pass', label: '画面通过' }]} onChange={verdict => change({ ...decision, verdict })} />
    <Select aria-label="整场声音状态" style={{ width: '100%' }} disabled={disabled || busy} value={decision.sound_status}
      options={Object.entries(soundLabel).map(([value, label]) => ({ value, label }))} onChange={sound_status => change({ ...decision, sound_status })} />
    <Input.TextArea aria-label="整场声音依据" placeholder="声音观察或待后期事项" rows={2} disabled={disabled || busy} value={decision.sound_notes} onChange={event => change({ ...decision, sound_notes: event.target.value })} />
    {issues.map((issue, index) => <div key={issue.id}>
      <Select aria-label={`审片问题 ${index + 1} 程度`} style={{ width: '100%' }} disabled={disabled || busy} value={issue.severity}
        options={[{ value: 'required', label: '必须修复' }, { value: 'optional', label: '可优化' }, { value: 'postproduction', label: '待后期' }]}
        onChange={severity => change({ ...decision, issues: issues.map(row => row.id === issue.id ? { ...row, severity } : row) })} />
      <Input.TextArea aria-label={`审片问题 ${index + 1} 观察`} placeholder="具体问题与观察" disabled={disabled || busy} value={issue.observation}
        onChange={event => change({ ...decision, issues: issues.map(row => row.id === issue.id ? { ...row, observation: event.target.value } : row) })} />
      <Input aria-label={`审片问题 ${index + 1} 验收条件`} placeholder="修复后如何检查" disabled={disabled || busy} value={issue.acceptance}
        onChange={event => change({ ...decision, issues: issues.map(row => row.id === issue.id ? { ...row, acceptance: event.target.value } : row) })} />
      <Select mode="multiple" aria-label={`审片问题 ${index + 1} 片段`} style={{ width: '100%' }} disabled={disabled || busy} value={issue.clip_ids || []}
        options={[...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms).map((item, i) => ({ value: item.id, label: `片段 ${i + 1} · ${item.timeline_start_ms} 毫秒` }))}
        onChange={clip_ids => change({ ...decision, issues: issues.map(row => row.id === issue.id ? { ...row, clip_ids } : row) })} />
      <Button disabled={disabled || busy} onClick={() => change({ ...decision, issues: issues.filter(row => row.id !== issue.id) })}>删除审片问题 {index + 1}</Button>
    </div>)}
    <Button disabled={disabled || busy} onClick={() => change({ ...decision, issues: [...issues, { id: crypto.randomUUID(), severity: 'required', observation: '', acceptance: '', clip_ids: [] }] })}>添加审片问题</Button>
    {invalid && <p>填写判断及必要依据；占位不能标为无覆盖缺口，未核实覆盖或必修问题不能通过。</p>}
    {dirty && <p>先保存当前剪辑，再明确记录本次验收。</p>}
    {storageError && <Alert type="warning" message={storageError} action={<Button onClick={() => {
      try { const stored = readStored(); setPending(stored.pending); persist(draft.current, stored.pending); setStorageBlocked(false); setStorageError('') } catch { setStorageError('本地验收凭据仍无法读取，请恢复存储后重试。') }
    }}>重读本地验收凭据</Button>} />}
    <Button loading={busy} disabled={disabled || dirty || loading || !!readError || !!storageError || busy || !!pending || invalid || !content.timeline.items.length}
      onClick={() => void submit({ request_id: crypto.randomUUID(), expected_revision: revision, decision: structuredClone(decision) })}>记录本次整场验收</Button>
    {pending && <Alert type="warning" message="整场验收结果待核实" description={submitError || '将核实原保存修订与原结论，不覆盖当前输入。'}
      action={<Button disabled={busy} onClick={() => void submit(pending)}>核实原整场验收</Button>} />}
    {!pending && submitError && <Alert type="error" message="整场验收未完成" description={submitError} />}
    {records.map((row, index) => <details key={row.id} id={`scene-cut-review-${row.id}`} tabIndex={-1} open={navigation === row.id || undefined}><summary>查看整场验收记录 {index + 1}</summary>
      <p>实际审片版本：{row.version_id}{row.version_id !== versionId ? '（另存时保留的历史依据）' : ''}</p>
      <p>{new Date(row.created_at).toLocaleString()} · 画面{row.decision.verdict === 'pass' ? '通过' : '需修改'} · 声音{soundLabel[row.decision.sound_status]}</p>
      <p>{row.decision.overall}</p><p>成立内容：{row.decision.established || '未填写'}</p><p>覆盖依据：{row.decision.coverage_notes || '待核实'}</p>
      <p>当时输出画幅：{row.content.output_aspect_ratio}；历史结论及构图不会随当前编辑改写。</p>
      <Button onClick={() => { onHistoryPreviewStart(); setHistory(row) }}>预览历史整场验收 {index + 1}</Button>
      <details><summary>查看整场固定依据和问题</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify({ decision: row.decision, content: row.content }, null, 2)}</pre></details>
    </details>)}
    {history && <SceneReviewPreview key={history.id} content={history.content} takes={takes} onClose={() => setHistory(undefined)} onStart={onHistoryPreviewStart} />}
    <p>记录验收不自动采用、生成或交付；画面通过不代表声音完成。</p>
  </section>
}
