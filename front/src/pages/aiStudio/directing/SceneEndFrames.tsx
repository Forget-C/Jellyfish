import { WorkbenchButton } from './ui/WorkbenchButton'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneEndFrameCreate, SceneEndFrameRead, SceneMediaCutItem_Output, SceneVersionContent_Output } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { sceneDependencyIssue } from './SceneFrameDependencies'
import { directingError } from './common'

const sameSource = (left: SceneMediaCutItem_Output, right?: SceneVersionContent_Output['timeline']['items'][number]) => !!right && 'media_range' in right
  && left.id === right.id && left.take_kind === right.take_kind && left.take_id === right.take_id && left.file_id === right.file_id
  && left.media_range.source_in_ms === right.media_range.source_in_ms && left.media_range.source_out_ms === right.media_range.source_out_ms

/** 提帧固定原采用和请求；参考选择与依赖更新由用户另行执行。 */
export function SceneEndFrames({ projectId, sequenceId, versionId, revision, content, dirty, disabled, onOpenUnit, navigation, onRecorded }: {
  navigation?: string; onRecorded?: () => void
  onOpenUnit: (unitId: string) => void
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; dirty: boolean; disabled: boolean
}) {
  const storageKey = `scene-end-frame:${projectId}:${sequenceId}:${versionId}`
  const readStored = (): SceneEndFrameCreate | undefined => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const value = JSON.parse(raw) as SceneEndFrameCreate
    if (!value || typeof value.request_id !== 'string' || !value.request_id || typeof value.clip_id !== 'string' || !value.clip_id
      || !Number.isInteger(value.expected_revision) || value.expected_revision < 1) throw new Error('提帧凭据无法解析')
    return value
  }
  const [initial] = useState(() => { try { return { pending: readStored(), error: '' } } catch { return { pending: undefined, error: '本地提帧凭据无法读取，请恢复后重读。' } } })
  const [pending, setPending] = useState(initial.pending)
  const [storageError, setStorageError] = useState(initial.error)
  const [records, setRecords] = useState<SceneEndFrameRead[]>([])
  const [loading, setLoading] = useState(false)
  const [historyRequested, setHistoryRequested] = useState(false)
  useEffect(() => { if (navigation) { setHistoryRequested(true); setAttempt(value => value + 1) } }, [navigation])
  const [readError, setReadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!historyRequested) return
    let active = true
    setLoading(true); setReadError('')
    void StudioDirectingService.directingSceneEndFrames({ projectId, sequenceId, versionId }).then(response => {
      if (active) setRecords(response.data || [])
    }).catch(error => { if (active) setReadError(directingError(error)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, attempt, historyRequested])
  const clearPending = (request: SceneEndFrameCreate) => {
    if (readStored()?.request_id !== request.request_id) return
    localStorage.removeItem(storageKey)
    if (mounted.current) setPending(undefined)
  }
  const submit = async (request: SceneEndFrameCreate) => {
    if (busy || disabled || storageError) return
    try { localStorage.setItem(storageKey, JSON.stringify(request)) }
    catch { setStorageError('无法保存提帧核实凭据，本次未提交。'); return }
    setPending(request); setBusy(true); setSubmitError('')
    try {
      const response = await StudioDirectingService.directingCreateSceneEndFrame({ projectId, sequenceId, versionId, requestBody: request })
      if (!response.data) throw new Error('提帧结果尚未核实，请核实原请求')
      clearPending(request)
      if (mounted.current) { setHistoryRequested(true); setAttempt(value => value + 1); onRecorded?.() }
    } catch (error) {
      if (error instanceof ApiError && [400, 409, 422].includes(error.status)) {
        try { clearPending(request) } catch { if (mounted.current) setStorageError('原请求已被拒绝，但本地凭据尚未清理，请重读后核实。') }
      }
      if (mounted.current) setSubmitError(directingError(error))
    } finally { if (mounted.current) setBusy(false) }
  }
  const items = [...content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms || a.id.localeCompare(b.id))
  return <section aria-label="实际落幅参考">
    <h3>实际落幅参考</h3>
    <p>从已保存的真实采用区间提取最后一帧，保留原素材构图。提取后需明确选择参考并更新后段依赖。</p>
    {dirty && <p>先保存当前方案，再提取新的实际落幅。</p>}
    {storageError && <Alert type="warning" message={storageError} action={<Button onClick={() => {
      try { setPending(readStored()); setStorageError('') } catch { setStorageError('本地提帧凭据仍无法读取，请恢复后重读。') }
    }}>重读提帧凭据</Button>} />}
    <WorkbenchButton variant="secondary" onClick={() => { setHistoryRequested(true); setAttempt(value => value + 1) }}>查看完整落幅记录历史</WorkbenchButton>
    {readError && <Alert type="warning" message="落幅记录读取失败，当前适用性尚未核实" description={readError} />}
    {historyRequested && <WorkbenchButton variant="secondary" loading={loading} onClick={() => setAttempt(value => value + 1)}>重读落幅记录</WorkbenchButton>}
    {submitError && <Alert type="warning" message={submitError} />}
    {pending && <Alert type="warning" message="原提帧请求待核实；后续编辑不会改变该请求的采用区间。"
      action={<Button loading={busy} disabled={disabled || !!storageError} onClick={() => void submit(pending)}>核实原提帧请求</Button>} />}
    {items.map((clip, index) => clip.kind === 'media' && <Button id={`scene-end-frame-${clip.id}`} key={clip.id} disabled={disabled || dirty || busy || loading || !!readError || !!storageError || !!pending}
      onClick={() => void submit({ request_id: crypto.randomUUID(), expected_revision: revision, clip_id: clip.id })}>提取片段 {index + 1} 实际落幅</Button>)}
    {historyRequested && !loading && !readError && content.units.flatMap((unit, unitIndex) => (unit.scene_dependencies || []).filter(link => link.version_id === versionId).map(link => {
      const issue = sceneDependencyIssue(link, unit, records, content, versionId)
      return issue ? <Alert key={`${unit.id}:${link.clip_id}`} type="warning" message={`后段单元 ${unitIndex + 1}：${issue}`} description={`原采用：${link.clip_id}；原落幅：${link.frame_id || '尚未绑定'}`}
        action={<Button onClick={() => onOpenUnit(unit.id)}>定位后段单元 {unitIndex + 1}</Button>} /> : null
    }))}
    {historyRequested && !loading && !readError && records.map((row, index) => <div key={row.id} id={`scene-end-frame-${row.id}`} tabIndex={-1} aria-current={navigation === row.id ? true : undefined}>
      <p>落幅 {index + 1}：{sameSource(row.clip, items.find(item => item.id === row.clip.id)) ? '当前采用适用' : '依据已变，原图保留'}</p>
      <p>实际帧：{row.at_ms} 毫秒；原区间：{row.clip.media_range.source_in_ms}–{row.clip.media_range.source_out_ms} 毫秒</p>
      <p>原素材：{row.clip.take_id}；采用：{row.clip.id}</p>
      {row.available && row.image_url ? <FrameImage key={`${row.file_id}:${attempt}`} url={row.image_url} index={index + 1} /> : <Alert type="warning" message="落幅文件不可用，恢复后重读记录" />}
    </div>)}
  </section>
}

function FrameImage({ url, index }: { url: string; index: number }) {
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  return <>{failed && <Alert type="warning" message="落幅图读取失败，原来源保留" action={<Button onClick={() => { setFailed(false); setAttempt(value => value + 1) }}>重试落幅 {index}</Button>} />}
    {!failed && <img key={attempt} src={resolveAssetUrl(url)} alt={`原素材落幅 ${index}`} style={{ maxWidth: '100%', maxHeight: 240 }} onError={() => setFailed(true)} />}</>
}
