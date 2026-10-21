import { CanvasCard } from '../../../components/canvas/Canvas'
import { WorkbenchDetails } from './ui/WorkbenchDetails'
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
import { EditGraphCanvas } from './EditGraphCanvas'
import type { EditCanvasGraph } from '../../../services/generated'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'

const identity = (take: { take_kind: string; take_id: string }) => `${take.take_kind}:${take.take_id}`

const editingSessions = new Map<string, { selected: string; navigationSerial?: number; focusClipId?: string; workspace?: boolean; graphNavigation?: number; library?: boolean }>()

/** 素材来源只读；人工判断属于当前版本，统一交给工作台保存与撤销。 */
export function SceneEditCanvas({ graph, evidenceError, onRefreshGraph, projectId, sequenceId, versionId, revision, content, disabled, dirty, onChange, onOpenUnit, onOpenVersion, focusClipId, navigation }: {
  graph: EditCanvasGraph; evidenceError: string; onRefreshGraph: () => void
  navigation?: { target: SceneMediaNavigationTarget; serial: number }
  onOpenVersion: (target: { versionId: string; unitId: string }) => Promise<void>
  onOpenUnit: (unitId: string, coverageId?: string) => void; focusClipId?: string
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; disabled: boolean; dirty: boolean
  onChange: (content: SceneVersionContent_Output) => void
}) {
  const [unavailableCoverage, setUnavailableCoverage] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [cutNavigation, setCutNavigation] = useState<string>()
  const [frameNavigation, setFrameNavigation] = useState<string>()
  const [seamNavigation, setSeamNavigation] = useState<{ leftClipId: string; rightClipId: string; serial: number }>()
  const [unavailableClip, setUnavailableClip] = useState('')
  const [takes, setTakes] = useState<SceneTakeLibraryRead[]>([])
  const contextKey = `${projectId}:${sequenceId}:${versionId}`
  const [session] = useState(() => {
    const value = editingSessions.get(contextKey) || { selected: '' }
    editingSessions.set(contextKey, value)
    return value
  })
  const [graphNavigation, setGraphNavigation] = useState<number | undefined>(session.graphNavigation)
  useEffect(() => { session.graphNavigation = graphNavigation }, [session, graphNavigation])
  const [library, setLibrary] = useState(session.library || false)
  useEffect(() => { session.library = library }, [library, session])
  const [reviewFocus, setReviewFocus] = useState<string>()
  const [workspace, setWorkspace] = useState(session.workspace || false)
  useEffect(() => { session.workspace = workspace }, [workspace, session])
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
    setLoading(true)
    void StudioDirectingService.directingSceneTakeLibrary({ projectId, sequenceId, versionId }).then(response => {
      if (!response.data) throw new Error('素材列表尚未核实')
      if (active) { setTakes(response.data); setError('') }
    }).catch(cause => { if (active) setError(directingError(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, versionId, attempt, graph])
  useEffect(() => {
    if (!focusClipId || session.focusClipId === focusClipId) return
    setWorkspace(true)
    session.focusClipId = focusClipId
    setFocusTarget({ nodeId: '时间线', fieldId: `scene-end-frame-${focusClipId}`, serial: Date.now() })
  }, [focusClipId])
  useEffect(() => {
    if (!navigation || session.navigationSerial === navigation.serial) return
    setWorkspace(true)
    setGraphNavigation(undefined)
    session.navigationSerial = navigation.serial
    setPreview(false); setPreviewError(''); setPreviewStop(value => value + 1); setSeamStop(value => value + 1)
    const target = navigation.target
    if (target.kind === 'take') {
      setSelected(`${target.takeKind}:${target.takeId}`)
      setFocusTarget({ nodeId: target.focusCoverage ? '方案判断' : '当前素材', fieldId: target.focusCoverage ? 'scene-take-coverage-editor' : 'scene-current-take', serial: navigation.serial })
    } else {
      setSelected('')
      setFocusTarget({ nodeId: '时间线', fieldId: `scene-clip-${target.clipId}`, serial: navigation.serial })
    }
  }, [navigation?.serial])
  const navigationClipId = navigation?.target.kind === 'clip' ? navigation.target.clipId : undefined
  // 后台证据刷新不阻断已核实素材的本地编辑；保存仍由服务端复核真实输入。
  const libraryBlocked = loading && takes.length === 0 || !!error
  const take = takes.find(row => identity(row) === selected)
  const annotation = content.take_judgments?.find(row => identity(row) === selected)?.annotation || {
    coverage: [], review_status: 'unreviewed', rationale: {}, retained_ranges: [],
  } satisfies SceneTakeAnnotation_Output
  const change = (next: SceneTakeAnnotation_Output) => {
    if (disabled || !take || libraryBlocked) return
    const judgment = { take_kind: take.take_kind, take_id: take.take_id, file_id: take.file_id, annotation: next }
    const existing = content.take_judgments || []
    onChange({ ...content, take_judgments: existing.some(row => identity(row) === selected)
      ? existing.map(row => identity(row) === selected ? judgment : row) : [...existing, judgment] })
  }
  const [takeDetails, setTakeDetails] = useState(false)
  const stopLivePreview = () => { setPreview(false); setPreviewStop(value => value + 1); setSeamStop(value => value + 1) }
  const editDisabled = disabled || libraryBlocked || !take?.available
  const takeInformation = take && <>
        <p>素材：{take.take_id}</p><p>文件：{take.file_id}</p><p>原所属{take.take_kind === 'scene_video' ? '场次版本' : '生产计划'}：{take.origin_id}</p>
        {take.take_kind === 'scene_video' && <OpenTakeVersion key={selected} disabled={loading || !!error} onOpen={() => onOpenVersion({ versionId: take.origin_id, unitId: take.unit_id })} />}
        <p>实际媒体时长：{take.duration_ms == null ? '尚未核实' : `${take.duration_ms / 1000} 秒`}</p>
        <SceneTakeBasis key={selected} projectId={projectId} sequenceId={sequenceId} versionId={versionId} take={take} content={content} />
        <details><summary>查看固定生产依据</summary><p>原单元：{take.unit_id}</p><p>原任务：{take.task_id}</p>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(take.video_preparation || { prompt: take.prompt, production_plan: take.production_plan }, null, 2)}</pre></details>
  </>
  return <><div className="scene-edit-navigation" aria-label="剪辑浏览">
    <WorkbenchButton variant="secondary" onClick={() => setWorkspace(value => !value)}>{workspace ? '浏览整场剪辑' : '打开剪辑工作区'}</WorkbenchButton>
    <WorkbenchButton variant="secondary" onClick={() => { setWorkspace(true); setFocusTarget({ nodeId: '同场次素材', fieldId: '', serial: Date.now() }) }}>浏览同场次素材</WorkbenchButton>
    <WorkbenchButton variant="secondary" onClick={() => { setLibrary(!(library && !workspace)); setWorkspace(false) }}>{library && !workspace ? '返回整场剪辑图' : '浏览同场素材图'}</WorkbenchButton>
    <WorkbenchButton variant="secondary" onClick={onRefreshGraph}>刷新图证据</WorkbenchButton>
    {loading && takes.length > 0 && <span role="status">正在刷新素材证据；已核实素材及当前输入保留。</span>}
    {dirty && <span aria-label="剪辑图同步状态">图待同步：总览展示已保存内容，工作区保留当前输入。</span>}
    {evidenceError && <p role="alert">图证据读取失败，保留旧摘要：{evidenceError}。请刷新图证据重试。</p>}
    {unavailableCoverage && <p role="alert">原覆盖目标在当前编辑中已不可用，请明确核对；未选择替代对象。</p>}
    {unavailableClip && <p role="alert">原片段 {unavailableClip} 在当前编辑中已不可用，请保存后重新核对。</p>}
  </div><div className="scene-edit-overview" hidden={workspace}><EditGraphCanvas graph={graph} versionId={versionId} revision={revision} contextKey={contextKey} viewId={library ? graph.library_view_id || undefined : undefined} onRetry={onRefreshGraph} onLocateCoverage={node => {
    const unit = content.units.find(row => row.id === node.coverage.unit_id)
    if (!unit?.coverage.some(row => row.id === node.coverage.coverage_item_id)) { setUnavailableCoverage(true); return }
    setUnavailableCoverage(false); onOpenUnit(unit.id, node.coverage.coverage_item_id)
  }} onLocate={(node, recordId) => {
    if (node.kind === 'edit_downstream') {
      if (!content.units.some(unit => unit.id === node.unit_id)) { setUnavailableCoverage(true); return }
      setUnavailableCoverage(false); onOpenUnit(node.unit_id); return
    }
    if (node.kind === 'edit_cut_review' || node.kind === 'edit_end_frame') {
      setWorkspace(true)
      if (node.kind === 'edit_cut_review') setCutNavigation(node.record_id)
      else setFrameNavigation(node.frame.id)
      setFocusTarget({ nodeId: '时间线', fieldId: node.kind === 'edit_cut_review' ? `scene-cut-review-${node.record_id}` : `scene-end-frame-${node.frame.id}`, serial: Date.now() }); return
    }
    if (node.kind === 'edit_coverage') {
      const judgment = content.take_judgments.find(row => identity(row) === identity(node))
      if (!judgment?.annotation.coverage.some(row => row.id === node.coverage.id)) { setUnavailableCoverage(true); return }
      setReviewFocus(undefined); setUnavailableCoverage(false); if (selected !== identity(node)) setPreview(false)
      setSelected(identity(node)); setWorkspace(true)
      setFocusTarget({ nodeId: '方案判断', fieldId: `scene-actual-coverage-${node.coverage.id}`, serial: Date.now() }); return
    }
    if (node.kind === 'edit_take') {
      if (selected !== identity(node)) setPreview(false)
      setSelected(`${node.take_kind}:${node.take_id}`); setWorkspace(true); setReviewFocus(recordId)
      setFocusTarget({ nodeId: recordId ? '方案判断' : '当前素材', fieldId: recordId ? `scene-take-review-${recordId}` : 'scene-current-take', serial: Date.now() }); return
    }
    if (node.kind === 'edit_seam') {
      const missing = [node.left_clip_id, node.right_clip_id].find(id => !content.timeline.items.some(item => item.id === id && item.kind === 'media'))
      if (missing) { setUnavailableClip(missing); return }
      const serial = Date.now()
      setUnavailableClip(''); setWorkspace(true)
      setSeamNavigation({ leftClipId: node.left_clip_id, rightClipId: node.right_clip_id, serial })
      setFocusTarget({ nodeId: '时间线', fieldId: 'scene-seam-review', serial }); return
    }
    const clip = content.timeline.items.find(item => item.id === node.clip_id)
    if (!clip) { setUnavailableClip(node.clip_id); return }
    setUnavailableClip(''); setWorkspace(true)
    if ('media_range' in clip) setSelected(`${clip.take_kind}:${clip.take_id}`)
    const serial = Date.now(); setGraphNavigation(serial)
    setFocusTarget({ nodeId: '时间线', fieldId: `scene-clip-${clip.id}`, serial })
  }} /></div><div hidden={!workspace}><DirectorCanvasSurface focusTarget={focusTarget} contextKey={`${versionId}:edit`} inspectors={{ 当前素材: take ? () => setTakeDetails(true) : undefined }} ariaLabel="编辑画布视口" labels={['同场次素材', '当前素材', '方案判断', '时间线']} initialPositions={{ 方案判断: { x: 800, y: 0 }, 时间线: { x: 0, y: 740 } }}>
    <section className="canvas-workbench-card">
      <Button loading={loading} onClick={() => setAttempt(value => value + 1)}>刷新素材库</Button>
      {error && <Alert type="warning" message="素材库读取失败" description={error} />}
      {!loading && !error && !takes.length && <p>本场暂无已登记素材。</p>}
      {takes.map((row, index) => {
        const judgment = content.take_judgments.find(item => identity(item) === identity(row))
        const issues = !loading && !error && judgment ? sceneTakeIssues(judgment, row, content) : []
        return <CanvasCard key={identity(row)} aria-label={`素材 ${index + 1}`} onActivate={() => { setSelected(identity(row)); setPreview(false); setPreviewError(''); setTakeDetails(true) }}><Button onClick={() => {
          setSelected(identity(row)); setPreview(false); setPreviewError('')
        }}>选择素材 {index + 1}</Button><p>{row.take_kind === 'scene_video' ? '场次版本素材' : '生产计划素材'} · {row.available ? '已登记' : '文件不可用'}</p>
          {issues.map(issue => <p key={issue.label}><Button danger onClick={() => {
            setSelected(identity(row)); setPreview(false); setPreviewError('')
            setFocusTarget(previous => ({ nodeId: '方案判断', fieldId: issue.fieldId, serial: (previous?.serial || 0) + 1 }))
          }}>定位素材 {index + 1}：{issue.label}</Button></p>)}
        </CanvasCard>
      })}
    </section>
    <section className="canvas-workbench-card" id="scene-current-take" tabIndex={-1} aria-label="当前源素材">
      {!take ? <p>{selected ? loading || error ? '原素材仍待核实，请重试读取；未选择替代素材。' : '原素材已不可用，请重新选择；未选择替代素材。' : '明确选择素材后查看来源与预览。'}</p> : <>
        <p className="canvas-card-summary">素材：{take.take_id} · {take.take_kind === 'scene_video' ? '场次版本素材' : '生产计划素材'}</p>
        <p>实际媒体时长：{take.duration_ms == null ? '尚未核实' : `${take.duration_ms / 1000} 秒`}</p>
        <Button onClick={() => setTakeDetails(true)}>查看素材固定依据</Button>
        <Button disabled={!take.available || !take.media_url || loading || !!error} onClick={() => {
          setPreviewStop(value => value + 1); setSeamStop(value => value + 1); setPreview(true); setPreviewUrl(resolveAssetUrl(take.media_url || '') || ''); setPreviewError(''); setPreviewAttempt(value => value + 1)
        }}>{previewError ? '重试当前素材预览' : '预览当前素材'}</Button>
        {!take.available && <Alert type="warning" message="原素材文件不可用，请恢复后刷新素材库" />}
        {previewError && <Alert type="warning" message={previewError} />}
        {preview && take.media_url && <video key={`${selected}:${previewAttempt}`} aria-label="当前素材视频" controls preload="metadata"
          src={previewUrl} style={{ width: '100%', maxHeight: 320 }}
          onError={() => setPreviewError('原素材无法读取或解码，请重试；素材身份和当前判断保留。')} />}
        <p>预览不自动播放，也不代表剪辑采用。旧版本素材需人工核对当前适用性。</p>
      </>}
    </section>
    <section className="canvas-workbench-card" id="scene-take-judgment" tabIndex={-1}>
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
        <SceneTakeReviews key={selected} evidence={graph} onEvidenceChanged={onRefreshGraph} focusRecordId={reviewFocus} focusSerial={focusTarget?.serial} dirty={dirty} disabled={editDisabled} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} take={take} content={content} />
      </>}
    </section>
    <SceneTimelineEditor contextKey={contextKey} selectionKey={selected} navigationSerial={graphNavigation || navigation?.serial} previewStop={previewStop} onPreviewStart={() => { setPreview(false); setSeamStop(value => value + 1) }} take={take} takes={takes} content={content} disabled={disabled || libraryBlocked} onChange={onChange}>
      {navigationClipId && !content.timeline.items.some(item => item.id === navigationClipId) && <Alert type="warning" message="原片段已不可用，请重新选择；未选择其他片段。" />}
      {focusClipId && !content.timeline.items.some(item => item.id === focusClipId) && <Alert type="warning" message={`原采用 ${focusClipId} 已不存在，请核对原依赖；未选择其他片段。`} />}
      <SceneEndFrames navigation={frameNavigation} onRecorded={onRefreshGraph} onOpenUnit={onOpenUnit} key={versionId} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content}
        dirty={dirty} disabled={disabled || loading || !!error} />
      <SceneSeamReviews navigation={seamNavigation} onRecorded={onRefreshGraph} onHistoryPreviewStart={stopLivePreview} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content} takes={takes}
        dirty={dirty} disabled={disabled || loading || !!error} previewStop={seamStop} onPreviewStart={() => { setPreview(false); setPreviewStop(value => value + 1) }} />
      <SceneCutReviews navigation={cutNavigation} onRecorded={onRefreshGraph} takes={takes} onHistoryPreviewStart={stopLivePreview} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content}
        dirty={dirty} disabled={disabled || loading || !!error} />
    </SceneTimelineEditor>
  </DirectorCanvasSurface></div><WorkbenchDetails title="素材固定依据 · 只读" status="只读" open={takeDetails && !!take} onClose={() => setTakeDetails(false)}>{takeInformation}</WorkbenchDetails></>
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
