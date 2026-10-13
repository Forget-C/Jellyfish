import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, InputNumber, Select, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneTakeAnnotation_Output, SceneTakeLibraryRead, SceneVersionContent_Output } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { directingError, humanNote } from './common'
import { invalidTakeRange, sceneTakeIssues } from './sceneTakeIssues'
import { SceneSeamReviews } from './SceneSeamReviews'
import { SceneEndFrames } from './SceneEndFrames'
import { SceneCutReviews } from './SceneCutReviews'
import { SceneTimelineEditor } from './SceneTimelineEditor'
import { SceneTakeBasis } from './SceneTakeBasis'
import { SceneTakeReviews } from './SceneTakeReviews'
import { SceneTakeCoverage } from './SceneTakeCoverage'
import type { SceneMediaNavigationTarget } from './SceneRelationsNavigation'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'

const identity = (take: { take_kind: string; take_id: string }) => `${take.take_kind}:${take.take_id}`

const editingSessions = new Map<string, { selected: string; navigationSerial?: number; focusClipId?: string }>()

/** 素材来源只读；人工判断属于当前版本，统一交给工作台保存与撤销。 */
export function SceneEditCanvas({ projectId, sequenceId, versionId, revision, content, disabled, dirty, onChange, onOpenUnit, onOpenVersion, focusClipId, navigation }: {
  navigation?: { target: SceneMediaNavigationTarget; serial: number }
  onOpenVersion: (target: { versionId: string; unitId: string }) => Promise<void>
  onOpenUnit: (unitId: string) => void; focusClipId?: string
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; disabled: boolean; dirty: boolean
  onChange: (content: SceneVersionContent_Output) => void
}) {
  const [takes, setTakes] = useState<SceneTakeLibraryRead[]>([])
  const contextKey = `${projectId}:${sequenceId}:${versionId}`
  const [session] = useState(() => {
    const value = editingSessions.get(contextKey) || { selected: '' }
    editingSessions.set(contextKey, value)
    return value
  })
  const [selected, setSelected] = useState(session.selected)
  useEffect(() => { session.selected = selected }, [session, selected])
  const [focusTarget, setFocusTarget] = useState<{ nodeId: string; fieldId: string; serial: number }>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [seamStop, setSeamStop] = useState(0)
  const [previewStop, setPreviewStop] = useState(0)
  const [preview, setPreview] = useState(false)
  const [previewError, setPreviewError] = useState('')
  const [previewAttempt, setPreviewAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setLoading(true); setError('')
    void StudioDirectingService.directingSceneTakeLibrary({ projectId, sequenceId, versionId }).then(response => {
      if (!response.data) throw new Error('素材列表尚未核实')
      if (active) setTakes(response.data)
    }).catch(cause => { if (active) setError(directingError(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, attempt])
  useEffect(() => {
    if (!focusClipId || session.focusClipId === focusClipId) return
    session.focusClipId = focusClipId
    setFocusTarget({ nodeId: '时间线', fieldId: `scene-end-frame-${focusClipId}`, serial: Date.now() })
  }, [focusClipId])
  useEffect(() => {
    if (!navigation || session.navigationSerial === navigation.serial) return
    session.navigationSerial = navigation.serial
    setPreview(false); setPreviewError(''); setPreviewStop(value => value + 1); setSeamStop(value => value + 1)
    const target = navigation.target
    if (target.kind === 'take') {
      setSelected(`${target.takeKind}:${target.takeId}`)
      setFocusTarget({ nodeId: '当前素材', fieldId: 'scene-current-take', serial: navigation.serial })
    } else {
      setSelected('')
      setFocusTarget({ nodeId: '时间线', fieldId: `scene-clip-${target.clipId}`, serial: navigation.serial })
    }
  }, [navigation?.serial])
  const navigationClipId = navigation?.target.kind === 'clip' ? navigation.target.clipId : undefined
  const take = takes.find(row => identity(row) === selected)
  const annotation = content.take_judgments?.find(row => identity(row) === selected)?.annotation || {
    coverage: [], review_status: 'unreviewed', rationale: {}, retained_ranges: [],
  } satisfies SceneTakeAnnotation_Output
  const change = (next: SceneTakeAnnotation_Output) => {
    if (disabled || !take || loading || error) return
    const judgment = { take_kind: take.take_kind, take_id: take.take_id, file_id: take.file_id, annotation: next }
    const existing = content.take_judgments || []
    onChange({ ...content, take_judgments: existing.some(row => identity(row) === selected)
      ? existing.map(row => identity(row) === selected ? judgment : row) : [...existing, judgment] })
  }
  const stopLivePreview = () => { setPreview(false); setPreviewStop(value => value + 1); setSeamStop(value => value + 1) }
  const editDisabled = disabled || loading || !!error || !take?.available
  return <DirectorCanvasSurface focusTarget={focusTarget} contextKey={`${versionId}:edit`} ariaLabel="编辑画布视口" labels={['同场次素材', '当前素材', '方案判断', '时间线']} initialPositions={{ 方案判断: { x: 800, y: 0 }, 时间线: { x: 0, y: 740 } }}>
    <section className="canvas-workbench-card">
      <h2>同场次素材</h2>
      <Button loading={loading} onClick={() => setAttempt(value => value + 1)}>刷新素材库</Button>
      {error && <Alert type="warning" message="素材库读取失败" description={error} />}
      {!loading && !error && !takes.length && <p>本场暂无已登记素材。</p>}
      {takes.map((row, index) => {
        const judgment = content.take_judgments.find(item => identity(item) === identity(row))
        const issues = !loading && !error && judgment ? sceneTakeIssues(judgment, row, content) : []
        return <div key={identity(row)}><Button onClick={() => {
          setSelected(identity(row)); setPreview(false); setPreviewError('')
        }}>选择素材 {index + 1}</Button><p>{row.take_kind === 'scene_video' ? '场次版本素材' : '生产计划素材'} · {row.available ? '已登记' : '文件不可用'}</p>
          {issues.map(issue => <p key={issue.label}><Button danger onClick={() => {
            setSelected(identity(row)); setPreview(false); setPreviewError('')
            setFocusTarget(previous => ({ nodeId: '方案判断', fieldId: issue.fieldId, serial: (previous?.serial || 0) + 1 }))
          }}>定位素材 {index + 1}：{issue.label}</Button></p>)}
        </div>
      })}
    </section>
    <section className="canvas-workbench-card" id="scene-current-take" tabIndex={-1} aria-label="当前源素材">
      <h2>当前素材</h2>
      {!take ? <p>{selected ? loading || error ? '原素材仍待核实，请重试读取；未选择替代素材。' : '原素材已不可用，请重新选择；未选择替代素材。' : '明确选择素材后查看来源与预览。'}</p> : <>
        <p>素材：{take.take_id}</p><p>文件：{take.file_id}</p><p>原所属{take.take_kind === 'scene_video' ? '场次版本' : '生产计划'}：{take.origin_id}</p>
        {take.take_kind === 'scene_video' && <OpenTakeVersion key={selected} disabled={loading || !!error} onOpen={() => onOpenVersion({ versionId: take.origin_id, unitId: take.unit_id })} />}
        <p>实际媒体时长：{take.duration_ms == null ? '尚未核实' : `${take.duration_ms / 1000} 秒`}</p>
        <SceneTakeBasis key={selected} projectId={projectId} sequenceId={sequenceId} versionId={versionId} take={take} content={content} />
        <details><summary>查看固定生产依据</summary><p>原单元：{take.unit_id}</p><p>原任务：{take.task_id}</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(take.video_preparation || { prompt: take.prompt, production_plan: take.production_plan }, null, 2)}</pre></details>
        <Button disabled={!take.available || !take.media_url || loading || !!error} onClick={() => {
          setPreviewStop(value => value + 1); setSeamStop(value => value + 1); setPreview(true); setPreviewError(''); setPreviewAttempt(value => value + 1)
        }}>{previewError ? '重试当前素材预览' : '预览当前素材'}</Button>
        {!take.available && <Alert type="warning" message="原素材文件不可用，请恢复后刷新素材库" />}
        {previewError && <Alert type="warning" message={previewError} />}
        {preview && take.media_url && <video key={`${selected}:${previewAttempt}`} aria-label="当前素材视频" controls preload="metadata"
          src={resolveAssetUrl(take.media_url)} style={{ width: '100%', maxHeight: 320 }}
          onError={() => setPreviewError('原素材无法读取或解码，请重试；素材身份和当前判断保留。')} />}
        <p>预览不自动播放，也不代表剪辑采用。旧版本素材需人工核对当前适用性。</p>
      </>}
    </section>
    <section className="canvas-workbench-card" id="scene-take-judgment" tabIndex={-1}>
      <h2>当前方案判断</h2>
      {!take ? <p>先明确选择素材。</p> : <>
        <p>判断仅属于当前场次版本，可撤销并沿工作台保存。</p>
        <Select aria-label="当前方案素材审查" style={{ width: '100%' }} disabled={editDisabled} value={annotation.verdict || 'unreviewed'}
          options={[{ value: 'unreviewed', label: '未审查' }, { value: 'pass', label: '通过' }, { value: 'retain', label: '保留' }, { value: 'repair', label: '需修复' }, { value: 'discard', label: '弃用' }]}
          onChange={value => change({ ...annotation, review_status: value === 'unreviewed' ? 'unreviewed' : 'reviewed', verdict: value === 'unreviewed' ? null : value as SceneTakeAnnotation_Output['verdict'] })} />
        <Input.TextArea aria-label="素材审查说明" disabled={editDisabled} rows={3} value={annotation.rationale.text || ''}
          onChange={event => change({ ...annotation, rationale: humanNote(event.target.value) })} />
        <SceneTakeCoverage key={selected} take={take} content={content} coverage={annotation.coverage} disabled={editDisabled}
          onChange={coverage => change({ ...annotation, coverage })} />
        <h3>可用区间</h3>
        {annotation.retained_ranges.map((range, index) => {
          const invalid = invalidTakeRange(range, take.duration_ms)
          const errorId = `retained-range-error-${index}`
          return <div key={index}><Space wrap>
            <InputNumber aria-label={`可用区间 ${index + 1} 入点毫秒`} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
              status={invalid ? 'error' : undefined} disabled={editDisabled} value={range.source_in_ms}
              onChange={value => { if (value != null) change({ ...annotation, retained_ranges: annotation.retained_ranges.map((row, i) => i === index ? { ...row, source_in_ms: value } : row) }) }} />
            <InputNumber id={`scene-take-range-${index}-out`} aria-label={`可用区间 ${index + 1} 出点毫秒`} aria-invalid={invalid} aria-describedby={invalid ? errorId : undefined}
              status={invalid ? 'error' : undefined} disabled={editDisabled || take.duration_ms == null} value={range.source_out_ms}
              onChange={value => { if (value != null) change({ ...annotation, retained_ranges: annotation.retained_ranges.map((row, i) => i === index ? { ...row, source_out_ms: value } : row) }) }} />
            <Button disabled={editDisabled} onClick={() => change({ ...annotation, retained_ranges: annotation.retained_ranges.filter((_, i) => i !== index) })}>删除区间 {index + 1}</Button>
          </Space>{invalid && <div id={errorId}><Alert type="error" message={`可用区间 ${index + 1} 无效：须满足 0 ≤ 入点 < 出点 ≤ ${take.duration_ms ?? '待核实'} 毫秒`}
            description="时间码必须为整数；请修正本区间后保存，错误输入不会写入服务器。" /></div>}</div>
        })}
        <Button disabled={editDisabled || !take.duration_ms} onClick={() => { if (take.duration_ms) change({ ...annotation, retained_ranges: [...annotation.retained_ranges, { source_in_ms: 0, source_out_ms: take.duration_ms }] }) }}>新增可用区间</Button>
        {take.duration_ms == null && <p>真实时长尚未核实，暂不能新增可用区间。</p>}
        <p>可用区间不等于实际覆盖或时间线采用。</p>
        <SceneTakeReviews key={selected} dirty={dirty} disabled={editDisabled} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} take={take} content={content} />
      </>}
    </section>
    <SceneTimelineEditor contextKey={contextKey} selectionKey={selected} navigationSerial={navigation?.serial} previewStop={previewStop} onPreviewStart={() => { setPreview(false); setSeamStop(value => value + 1) }} take={take} takes={takes} content={content} disabled={disabled || loading || !!error} onChange={onChange}>
      {navigationClipId && !content.timeline.items.some(item => item.id === navigationClipId) && <Alert type="warning" message="原片段已不可用，请重新选择；未选择其他片段。" />}
      {focusClipId && !content.timeline.items.some(item => item.id === focusClipId) && <Alert type="warning" message={`原采用 ${focusClipId} 已不存在，请核对原依赖；未选择其他片段。`} />}
      <SceneEndFrames onOpenUnit={onOpenUnit} key={versionId} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content}
        dirty={dirty} disabled={disabled || loading || !!error} />
      <SceneSeamReviews onHistoryPreviewStart={stopLivePreview} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content} takes={takes}
        dirty={dirty} disabled={disabled || loading || !!error} previewStop={seamStop} onPreviewStart={() => { setPreview(false); setPreviewStop(value => value + 1) }} />
      <SceneCutReviews takes={takes} onHistoryPreviewStart={stopLivePreview} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content}
        dirty={dirty} disabled={disabled || loading || !!error} />
    </SceneTimelineEditor>
  </DirectorCanvasSurface>
}

/** 明确打开原版本才执行切换保护；读取错误只归属当前素材入口。 */
function OpenTakeVersion({ disabled, onOpen }: { disabled: boolean; onOpen: () => Promise<void> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const open = async () => {
    if (busy || disabled) return
    setBusy(true); setError('')
    try { await onOpen() }
    catch (cause) { if (alive.current) setError(directingError(cause)) }
    finally { if (alive.current) setBusy(false) }
  }
  return <><Button disabled={disabled} loading={busy} onClick={() => void open()}>打开所属版本继续编辑</Button>
    {error && <Alert type="warning" message="所属版本打开失败" description={error} />}</>
}
