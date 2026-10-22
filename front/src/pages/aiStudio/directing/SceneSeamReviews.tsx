import { WorkbenchButton } from './ui/WorkbenchButton'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneMediaCutItem_Output, SceneSeamReviewCreate, SceneSeamReviewDecision, SceneSeamReviewRead, SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { directingError } from './common'
import { SceneReviewPreview } from './SceneReviewPreview'
import { SceneTimelinePreview } from './SceneTimelinePreview'

type Pair = { left: SceneMediaCutItem_Output; right: SceneMediaCutItem_Output; index: number }
type DraftState = { selected?: [string, string]; drafts: Record<string, SceneSeamReviewDecision>; pending?: SceneSeamReviewCreate }
const emptyDecision: SceneSeamReviewDecision = { verdict: 'revise', observation: '', established: '', issues: '' }
const pairs = (content: SceneVersionContent_Output) => {
  const items = [...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms)
  const result: Pair[] = []
  for (let index = 0; index + 1 < items.length; index++) {
    const left = items[index], right = items[index + 1]
    if ('media_range' in left && 'media_range' in right && left.timeline_start_ms + left.media_range.source_out_ms - left.media_range.source_in_ms === right.timeline_start_ms) result.push({ left, right, index })
  }
  return result
}
const canonical = (value: unknown) => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right))) : item)
const basis = (content: SceneVersionContent_Output, leftId: string, rightId: string) => {
  const pair = pairs(content).find(row => row.left.id === leftId && row.right.id === rightId)
  if (!pair) return undefined
  const { timeline_start_ms: leftPosition, ...left } = pair.left
  const { timeline_start_ms: rightPosition, ...right } = pair.right
  return canonical({ output_aspect_ratio: content.output_aspect_ratio, left, right })
}

function Boundary({ clip, source, side, ratio, onReady }: {
  clip: SceneMediaCutItem_Output; source?: SceneTakeLibraryRead; side: 'left' | 'right'; ratio: string; onReady: (ready: boolean) => void
}) {
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [width, height] = ratio.split(':').map(Number)
  const time = side === 'left' ? clip.media_range.source_out_ms - 1 : clip.media_range.source_in_ms
  const label = side === 'left' ? '接缝前段落幅' : '接缝后段入幅'
  const ready = (node: HTMLVideoElement) => { if (node.readyState >= 2 && Math.abs(node.currentTime * 1000 - time) < 2) onReady(true) }
  return <div><p>{label} · 片段 {clip.id} · 原文件 {clip.file_id} · {time} 毫秒</p>
    {source?.available && source.media_url ? <div style={{ width: '100%', maxWidth: 200 * width / height, aspectRatio: `${width} / ${height}`, background: '#000', position: 'relative', marginInline: 'auto' }}>
      <video key={attempt} aria-label={label} preload="auto" playsInline muted src={resolveAssetUrl(source.media_url)}
        style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, objectFit: clip.fit, objectPosition: 'center' }}
        onLoadedMetadata={event => {
          if (!Number.isFinite(event.currentTarget.duration) || event.currentTarget.duration * 1000 < clip.media_range.source_out_ms) { setError(true); onReady(false); return }
          event.currentTarget.currentTime = time / 1000
        }} onLoadedData={event => ready(event.currentTarget)} onSeeked={event => ready(event.currentTarget)} onError={() => { setError(true); onReady(false) }} />
    </div> : <Alert type="warning" message={`${label}原文件不可用，请恢复后刷新素材库`} />}
    {error && <Alert type="warning" message={`${label}无法读取或定位，暂不能记录新结论`} action={<Button onClick={() => { setError(false); onReady(false); setAttempt(value => value + 1) }}>重试{label}</Button>} />}
  </div>
}

/** 每条接缝以两个采用身份定位；未知响应绑定原对象，历史结论不被新输入覆盖。 */
export function SceneSeamReviews({ projectId, sequenceId, versionId, revision, content, takes, dirty, disabled, previewStop, onPreviewStart, onHistoryPreviewStart, navigation, onRecorded }: {
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; takes: SceneTakeLibraryRead[]; dirty: boolean; disabled: boolean
  navigation?: { leftClipId: string; rightClipId: string; serial: number }; onRecorded?: () => void
  previewStop: number; onPreviewStart: () => void; onHistoryPreviewStart: () => void
}) {
  const storageKey = `scene-seam-review:${projectId}:${sequenceId}:${versionId}`
  const readStored = (): DraftState => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return { drafts: {} }
    const stored = JSON.parse(raw) as DraftState
    const validDecision = (value: SceneSeamReviewDecision) => value && typeof value.observation === 'string' && ['pass', 'revise'].includes(value.verdict)
      && (value.established == null || typeof value.established === 'string') && (value.issues == null || typeof value.issues === 'string')
    if (!stored.drafts || typeof stored.drafts !== 'object' || Array.isArray(stored.drafts) || Object.values(stored.drafts).some(value => !validDecision(value))
      || (stored.selected && (!Array.isArray(stored.selected) || stored.selected.length !== 2 || stored.selected.some(value => typeof value !== 'string')))
      || (stored.pending && (typeof stored.pending.request_id !== 'string' || !Number.isInteger(stored.pending.expected_revision) || stored.pending.expected_revision < 1
        || typeof stored.pending.left_clip_id !== 'string' || typeof stored.pending.right_clip_id !== 'string' || !validDecision(stored.pending.decision)))) throw new Error('本地接缝凭据无法解析')
    return stored
  }
  const [initial] = useState(() => { try { return { state: readStored(), error: '' } } catch { return { state: { drafts: {} } as DraftState, error: '本地接缝凭据无法读取，暂不提交新审查。' } } })
  const [state, setState] = useState(initial.state)
  const cache = useRef(state)
  const [storageError, setStorageError] = useState(initial.error)
  const [storageBlocked, setStorageBlocked] = useState(!!initial.error)
  const [history, setHistory] = useState<SceneSeamReviewRead>()
  const [records, setRecords] = useState<SceneSeamReviewRead[]>([])
  const [loading, setLoading] = useState(false)
  const [historyRequested, setHistoryRequested] = useState(false)
  useEffect(() => { if (navigation) { setHistoryRequested(true); setAttempt(value => value + 1) } }, [navigation])
  const [readError, setReadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState({ left: false, right: false })
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const persist = (next: DraftState) => localStorage.setItem(storageKey, JSON.stringify(next))
  const change = (next: DraftState) => {
    cache.current = next; setState(next)
    if (storageBlocked) return
    try { persist(next); setStorageError('') } catch { setStorageError('接缝输入未能保存在本地，当前输入保留；请恢复存储。') }
  }
  const navigationState = useRef({ navigation, change })
  navigationState.current = { navigation, change }
  const navigationSerial = navigation?.serial
  useEffect(() => {
    const { navigation: target, change: update } = navigationState.current
    if (target) update({ ...cache.current, selected: [target.leftClipId, target.rightClipId] })
  }, [navigationSerial])
  const currentPairs = pairs(content)
  const selected = currentPairs.find(row => row.left.id === state.selected?.[0] && row.right.id === state.selected?.[1])
  const selectedKey = state.selected?.join('|') || ''
  const selectedBasis = state.selected ? basis(content, ...state.selected) : undefined
  const decision = state.drafts[selectedKey] || emptyDecision
  const editDecision = (next: SceneSeamReviewDecision) => change({ ...state, drafts: { ...state.drafts, [selectedKey]: next } })
  const source = (clip: SceneMediaCutItem_Output) => takes.find(take => take.take_kind === clip.take_kind && take.take_id === clip.take_id && take.file_id === clip.file_id)
  const mediaIdentity = selected ? JSON.stringify([source(selected.left)?.available, source(selected.left)?.media_url, source(selected.right)?.available, source(selected.right)?.media_url]) : ''
  useEffect(() => { setReady({ left: false, right: false }) }, [selectedBasis, mediaIdentity])
  useEffect(() => {
    if (!historyRequested) return
    let active = true
    setLoading(true); setReadError('')
    void StudioDirectingService.directingSceneSeamReviews({ projectId, sequenceId, versionId }).then(response => {
      if (active) setRecords(response.data || [])
    }).catch(error => { if (active) setReadError(directingError(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, attempt, historyRequested])
  const clearPending = (requestId: string) => {
    const latest = mounted.current ? cache.current : readStored()
    if (latest.pending?.request_id !== requestId) return
    const next = { ...latest, pending: undefined }
    persist(next)
    if (mounted.current) { cache.current = next; setState(next) }
  }
  const submit = async (request: SceneSeamReviewCreate) => {
    if (busy || storageBlocked) return
    const next = { ...cache.current, pending: request }
    try { persist(next) } catch { setStorageError('无法保存接缝核实凭据，本次未提交。'); return }
    cache.current = next; setState(next); setBusy(true); setSubmitError('')
    try {
      const response = await StudioDirectingService.directingCreateSceneSeamReview({ projectId, sequenceId, versionId, requestBody: request })
      if (!response.data) throw new Error('接缝结果尚未核实')
      clearPending(request.request_id)
      if (mounted.current) { setHistoryRequested(true); setAttempt(value => value + 1); onRecorded?.() }
    } catch (error) {
      if (mounted.current) {
        setSubmitError(directingError(error))
        if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
          try { clearPending(request.request_id) } catch { setStorageError('接缝核实凭据未能清理，请恢复本地存储。') }
        }
      }
    } finally { if (mounted.current) setBusy(false) }
  }
  const matching = (left: string, right: string) => [...records].reverse().find(row => row.left_clip_id === left && row.right_clip_id === right
    && basis(row.content, left, right) === basis(content, left, right))
  const current = selected ? matching(selected.left.id, selected.right.id) : undefined
  const hadReview = records.some(row => row.left_clip_id === state.selected?.[0] && row.right_clip_id === state.selected?.[1])
  return <section id="scene-seam-review" tabIndex={-1} aria-label="接缝审查"><h3>接缝审查</h3>
    <p>只检查直接相接的两个真实采用片段；空白和待拍占位不是接缝。</p>
    {!currentPairs.length && <p>当前没有可审查的真实接缝。</p>}
    {currentPairs.map((pair, index) => <div key={`${pair.left.id}:${pair.right.id}`}>
      <Button disabled={busy} onClick={() => { onPreviewStart(); setHistoryRequested(true); change({ ...state, selected: [pair.left.id, pair.right.id] }) }}>审查接缝：片段 {pair.index + 1} → {pair.index + 2}</Button>
      {historyRequested && !loading && !readError && <p>接缝 {index + 1}：{matching(pair.left.id, pair.right.id)?.decision.verdict === 'pass' ? '已通过' : matching(pair.left.id, pair.right.id) ? '需修改' : '待核对'}</p>}
    </div>)}
    <WorkbenchButton variant="secondary" onClick={() => { setHistoryRequested(true); setAttempt(value => value + 1) }}>查看完整接缝审查历史</WorkbenchButton>
    {loading && <p>正在读取接缝记录</p>}
    {readError && <Alert type="warning" message="接缝记录读取失败" description={readError} action={<Button onClick={() => { setHistoryRequested(true); setAttempt(value => value + 1) }}>重读接缝记录</Button>} />}
    {state.selected && <>
      {!selected && <Alert type="warning" message="原接缝已不再直接相接或包含占位，请明确重新选择；原观察保留。" />}
      {historyRequested && !loading && !readError && selected && <p>{current ? current.decision.verdict === 'pass' ? '所选接缝当前通过' : '所选接缝当前需修改' : hadReview ? '所选接缝依据已变，请重新核对' : '所选接缝尚未审查'}</p>}
      {historyRequested && !loading && !readError && current && current.version_id !== versionId && <p>引用原版本接缝审查：{current.version_id}</p>}
      {selected && <>
        <Boundary key={`left:${selectedBasis}:${source(selected.left)?.media_url}`} clip={selected.left} source={source(selected.left)} side="left" ratio={content.output_aspect_ratio} onReady={value => setReady(previous => ({ ...previous, left: value }))} />
        <Boundary key={`right:${selectedBasis}:${source(selected.right)?.media_url}`} clip={selected.right} source={source(selected.right)} side="right" ratio={content.output_aspect_ratio} onReady={value => setReady(previous => ({ ...previous, right: value }))} />
        <SceneTimelinePreview scope="seam" key={JSON.stringify([content.timeline, content.output_aspect_ratio, state.selected, previewStop])}
          outputAspectRatio={content.output_aspect_ratio} takes={takes} onStart={onPreviewStart}
          items={[{ ...selected.left, timeline_start_ms: 0 }, { ...selected.right, timeline_start_ms: selected.left.media_range.source_out_ms - selected.left.media_range.source_in_ms }]} />
      </>}
      <Input.TextArea aria-label="接缝观察依据" placeholder="实际落幅、入幅及衔接观察" disabled={disabled || busy} value={decision.observation} onChange={event => editDecision({ ...decision, observation: event.target.value })} />
      <Input.TextArea aria-label="接缝成立内容" placeholder="成立内容" disabled={disabled || busy} value={decision.established} onChange={event => editDecision({ ...decision, established: event.target.value })} />
      <Input.TextArea aria-label="接缝待处理问题" placeholder="待处理问题" disabled={disabled || busy} value={decision.issues} onChange={event => editDecision({ ...decision, issues: event.target.value })} />
      <Select aria-label="接缝结论" style={{ width: '100%' }} disabled={disabled || busy} value={decision.verdict} options={[{ value: 'revise', label: '接缝需修改' }, { value: 'pass', label: '接缝通过' }]} onChange={verdict => editDecision({ ...decision, verdict })} />
      {dirty && <p>先保存当前剪辑，再记录原接缝审查。</p>}
      {selected && (!ready.left || !ready.right) && <p>先核实两侧实际边界画面，再记录新结论。</p>}
      <Button loading={busy} disabled={disabled || dirty || busy || loading || !!readError || !!storageError || !!state.pending || !selected || !source(selected.left)?.available || !source(selected.right)?.available || !ready.left || !ready.right || !decision.observation.trim()}
        onClick={() => { if (selected) void submit({ request_id: crypto.randomUUID(), expected_revision: revision, left_clip_id: selected.left.id, right_clip_id: selected.right.id, decision: structuredClone(decision) }) }}>记录本次接缝审查</Button>
    </>}
    {storageError && <Alert type="warning" message={storageError} action={<Button onClick={() => {
      try { const stored = readStored(); const next = { ...cache.current, pending: stored.pending }; persist(next); cache.current = next; setState(next); setStorageBlocked(false); setStorageError('') } catch { setStorageError('本地接缝凭据仍不可读，请恢复存储后重试。') }
    }}>重读本地接缝凭据</Button>} />}
    {state.pending && <Alert type="warning" message="接缝审查结果待核实" description={submitError || `原片段 ${state.pending.left_clip_id} → ${state.pending.right_clip_id}；核实不覆盖当前观察。`}
      action={<Button disabled={busy} onClick={() => { if (state.pending) void submit(state.pending) }}>核实原接缝审查</Button>} />}
    {!state.pending && submitError && <Alert type="error" message="接缝审查未完成" description={submitError} />}
    {records.map((row, index) => <details key={row.id}><summary>查看接缝记录 {index + 1}</summary>
      <p>实际审查版本：{row.version_id}{row.version_id !== versionId ? '（另存时保留的历史依据）' : ''}</p>
      <p>{new Date(row.created_at).toLocaleString()} · {row.left_clip_id} → {row.right_clip_id} · {row.decision.verdict === 'pass' ? '通过' : '需修改'}</p>
      <p>{row.decision.observation}</p><p>成立内容：{row.decision.established || '未填写'}</p><p>待处理问题：{row.decision.issues || '未填写'}</p>
      <Button onClick={() => { onHistoryPreviewStart(); setHistory(row) }}>预览历史接缝 {index + 1}</Button>
      <details><summary>查看接缝固定依据</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.content, null, 2)}</pre></details>
    </details>)}
    {history && <SceneReviewPreview key={history.id} content={history.content} takes={takes} seam={[history.left_clip_id, history.right_clip_id]} onClose={() => setHistory(undefined)} onStart={onHistoryPreviewStart} />}
    <p>接缝结论独立于整场验收；记录不自动采用或生成。</p>
  </section>
}
