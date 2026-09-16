import { useWorkspaceScroll } from './useWorkspaceScroll'
import { SourceLinks } from './Sources'
import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { useSearchParams } from 'react-router-dom'
import { readWorkspaceContext, restoreSelection, saveWorkspaceContext } from './workspaceContext'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspacePreparation } from './useWorkspacePreparation'
import { Alert, Button, Card, Drawer, Empty, Input, InputNumber, Select, Space, Tabs, Tag, Typography } from 'antd'
import { OpenAPI, StudioDirectingService, StudioFilesService } from '../../../services/generated'
import type { ContinuityRead, ExtractedFrame, FileRead, MediaRead, SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { directingError, humanNote } from './common'
import { sequentialCut as sequential, cutDurations, takeAction, cutDestination } from './workspaceCut'
import { uniqueNewRecord } from './workspaceProduction'
import { SequenceNavigation } from './SequenceLayout'
import { buildFileDownloadUrl } from '../assets/utils'
import { ContinuityPanel } from './ContinuityPanel'
import { AdoptedCutPanel } from './AdoptedCutPanel'
import { PlannedCard } from './PlannedCard'
import { cutStatus, revisionName, takeRanges, takeUsage } from './workspaceUsage'
import type { ActiveCutState, CutRevision } from './workspaceUsage'

/** 候选审片与主视频粗剪，保留完整 Take，采用和审查是独立操作。 */
export function CutEditor({ projectId, workspace, activeCut, onChange, onSelection }: { projectId: string; workspace: WorkspaceRead; activeCut: ActiveCutState; onChange: (workspace: WorkspaceRead) => void; onSelection?: (selection: { cut: string | null; take: string | null }) => void }) {
  const [search, setSearch] = useSearchParams()
  const [context] = useState(() => readWorkspaceContext(projectId, workspace.sequence.id))
  const [panel, setPanel] = useState<'adopted' | 'preview' | 'details' | 'seams'>()
  const [inspectorTab, setInspectorTab] = useState(search.get('item') ? 'clip' : ['review', 'clip', 'source'].includes(context.cutTab || '') ? context.cutTab! : 'review')
  const [clipId, setClipId] = useState<string>(() => {
    if (search.has('item')) return search.get('item') || ''
    try {
      const item = JSON.parse(context.cutItem || '{}')
      if (item.cut === (search.get('cut') ?? context.cut) && workspace.cuts.some(row => row.id === item.cut && row.content.items.some(clip => clip.id === item.item))) return item.item
    } catch { /* 过期条目不自动匹配其他采用片段。 */ }
    return ''
  })
  const currentView = search.get('view')
  useEffect(() => { if (currentView !== 'cut') setPanel(undefined) }, [currentView])
  const [timelineScale, setTimelineScale] = useState([60, 120, 240].includes(Number(context.cutScale)) ? Number(context.cutScale) : 120)
  const [seamPair, setSeamPair] = useState<[string, string]>()
  const [continuity, setContinuity] = useState<ContinuityRead>()
  const [takeFilter, setTakeFilter] = useState(['all', 'unreviewed', 'pass', 'retain', 'repair', 'discard'].includes(context.cutFilter || '') ? context.cutFilter! : 'all')
  const [unitFilter, setUnitFilter] = useState<string | undefined>(() => workspace.plans.some(plan => plan.content.units.some(unit => `${plan.id}/${unit.id}` === context.cutUnitFilter)) ? context.cutUnitFilter || undefined : undefined)
  const desktop = useWorkbenchDesktop()
  const [frame, setFrame] = useState<ExtractedFrame>()
  const [previewFiles, setPreviewFiles] = useState<FileRead[]>([])
  const [previewDesign, setPreviewDesign] = useState<string>()
  const [previewShot, setPreviewShot] = useState<string>()
  const [dragged, setDragged] = useState<number>()
  const [comparison, setComparison] = useState<string>()
  const [selected, setSelected] = useState(() => restoreSelection(workspace.takes, search.get('take'), context.take)?.id || '')
  const [media, setMedia] = useState<Record<string, MediaRead>>({})
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const rangeEdited = useRef(false)
  const rangePreparation = useWorkspacePreparation('素材选取区间', `${projectId}:${workspace.sequence.id}:range:${selected}`, { start: 0, end: 0 })
  const { start, end } = rangePreparation.value
  const updateRange = rangePreparation.update
  const initializeRange = rangePreparation.initialize
  const setStart = useCallback((start: number) => updateRange({ start }), [updateRange])
  const setEnd = useCallback((end: number) => updateRange({ end }), [updateRange])
  const rememberedRange = useRef(rangePreparation.value)
  rememberedRange.current = rangePreparation.value
  const [verdict, setVerdict] = useState<'pass' | 'retain' | 'repair' | 'discard'>('retain')
  const [observation, setObservation] = useState('')
  const [reviewDirty, setReviewDirty] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(true)
  const [coverageId, setCoverageId] = useState<string>()
  const [saved, setSaved] = useState<WorkspaceRead['cuts'][number] | undefined>(() => restoreSelection(workspace.cuts, search.get('cut'), context.cut))
  const initialItem = saved?.content.items.find(item => item.id === clipId)
  const [replaceId, setReplaceId] = useState<string | undefined>(() => initialItem && 'take_id' in initialItem && initialItem.take_id === selected ? initialItem.id : undefined)
  const pendingRange = useRef<{ takeId: string; start: number; end: number } | undefined>(initialItem && 'media_range' in initialItem && initialItem.take_id === selected ? { takeId: selected, start: initialItem.media_range.source_in_ms / 1000, end: initialItem.media_range.source_out_ms / 1000 } : undefined)
  const [cut, setCut] = useState<SequenceCut_Input>(saved?.content || { items: [] })
  useEffect(() => { saveWorkspaceContext(projectId, workspace.sequence.id, { cutItem: JSON.stringify({ cut: saved?.id, item: clipId }), cutTab: inspectorTab, cutFilter: takeFilter, cutUnitFilter: unitFilter ?? null, cutScale: String(timelineScale) }) }, [projectId, workspace.sequence.id, saved?.id, clipId, inspectorTab, takeFilter, unitFilter, timelineScale])
  const timelineScrolling = useWorkspaceScroll(projectId, workspace.sequence.id, 'cutTimelineScroll', JSON.stringify([saved?.id, timelineScale]))
  const viewerScrolling = useWorkspaceScroll(projectId, workspace.sequence.id, 'cutViewerScroll', selected)
  const inspectorScrolling = useWorkspaceScroll(projectId, workspace.sequence.id, 'cutInspectorScroll', JSON.stringify([selected, saved?.id, inspectorTab]))
  const [playIndex, setPlayIndex] = useState<number>()
  const advancingClip = useRef<string>()
  const video = useRef<HTMLVideoElement>(null)
  const take = workspace.takes.find(item => item.id === selected)
  const [reviewVersion, setReviewVersion] = useState(take?.version)
  const annotationVersion = useRef(take?.version)
  annotationVersion.current = take?.version
  const reviewStale = !!take && reviewVersion !== take.version
  const takeIds = workspace.takes.map(item => item.id).join(',')
  const duration = media[selected]?.duration_ms || 0
  const sequenceId = workspace.sequence.id
  useEffect(() => { let active = true; void StudioDirectingService.directingContinuity({ projectId, sequenceId }).then(response => { if (active) setContinuity(response.data || undefined) }).catch(() => { if (active) setContinuity(undefined) }); return () => { active = false } }, [projectId, sequenceId, workspace.cuts])
  const unit = workspace.plans.find(plan => plan.id === take?.plan_revision_id)?.content.units.find(item => item.id === take?.unit_id)
  useEffect(() => {
    let active = true
    void Promise.allSettled((takeIds ? takeIds.split(',') : []).map(takeId => StudioDirectingService.directingTakeMedia({ projectId, sequenceId, takeId }))).then(rows => {
      if (active) {
        setMedia(Object.fromEntries(rows.flatMap(row => row.status === 'fulfilled' && row.value.data ? [[row.value.data.take_id, row.value.data]] : [])))
        if (rows.some(row => row.status === 'rejected' || !row.value.data)) setError('部分素材暂时无法读取；其余素材仍可审片，缺失素材请在保存修改后重新加载页面重试。')
      }
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, sequenceId, takeIds])
  useEffect(() => {
    saveWorkspaceContext(projectId, sequenceId, { take: selected || null, cut: saved?.id ?? null })
    onSelection?.({ take: selected || null, cut: saved?.id ?? null })
  }, [projectId, sequenceId, selected, saved, onSelection])
  const annotation = useRef(take?.annotation)
  annotation.current = take?.annotation
  useEffect(() => {
    rangeEdited.current = rememberedRange.current.end > rememberedRange.current.start
    setReviewVersion(annotationVersion.current); setReviewDirty(false); setCoverageId(undefined); setObservation(annotation.current?.rationale.text || '')
    setVerdict(annotation.current?.verdict || 'retain')
  }, [selected])
  useEffect(() => {
    const pending = pendingRange.current
    if (pending?.takeId === selected) {
      setStart(pending.start); setEnd(pending.end)
      rangeEdited.current = true
      pendingRange.current = undefined
    } else if (!rangeEdited.current) initializeRange({ start: 0, end: duration / 1000 })
  }, [selected, duration, setStart, setEnd, initializeRange])
  const source = media[selected]
  const clips = cut.items
  const timing = cutDurations(cut)
  const dirty = JSON.stringify(cut) !== JSON.stringify(saved?.content || { items: [] })
  const latestSaved = workspace.cuts.find(row => row.id === saved?.id)
  const stale = !!saved && !!latestSaved && (saved.version !== latestSaved.version || saved.confirmed_at !== latestSaved.confirmed_at)
  const editingDraft = dirty || !saved?.confirmed_at
  const adoptedRanges = activeCut.status === 'ready' ? takeRanges(activeCut.cut?.content, selected) : []
  const draftRanges = editingDraft ? takeRanges(cut, selected) : []
  const takeOptions = workspace.takes.map(item => ({ value: item.id, label: `${revisionName(workspace.takes, item.id, 'Take')} · ${item.unit_id} · ${item.annotation.review_status === 'reviewed' && item.annotation.verdict ? ({ pass: '整体可用', retain: '局部保留', repair: '需修正', discard: '废弃' }[item.annotation.verdict]) : '未审片'} · ${takeUsage(activeCut, item.id)}` }))
  /** 载入只改变本地编辑对象；有修改时明确放弃，任何版本切换都不等于确认采用。 */
  const loadCut = (next?: CutRevision) => {
    const load = () => { setNotice(''); setPlayIndex(undefined); setReplaceId(undefined); setSaved(next); setCut(structuredClone(next?.content || { items: [] })) }
    guardCut(load)
  }
  const design = workspace.designs.find(row => row.id === previewDesign)
  const planImages = [...new Map(workspace.plans.flatMap(plan => plan.content.units.flatMap(unit => unit.references.filter(ref => ref.media_kind === 'image').map(ref => [ref.file_id, { value: ref.file_id, label: ref.purpose + ' · ' + ref.id }] as const)))).values()]
  const images = [...new Map([...planImages, ...previewFiles.map(file => ({ value: file.id, label: file.name }))].map(item => [item.value, item])).values()]
  /** 预演可直接复用项目图，不要求先建立生产计划。 */
  const searchPreviewImages = async (q: string) => {
    try { const response = await StudioFilesService.listFilesApiApiV1StudioFilesGet({ projectId, q, pageSize: 50 }); setPreviewFiles((response.data?.items || []).filter(file => file.type === 'image')) }
    catch (cause) { setError(directingError(cause)) }
  }
  const coveredShots = new Set(cut.items.filter(item => 'design_revision_id' in item && item.design_revision_id === previewDesign).map(item => 'design_revision_id' in item ? item.shot_id : ''))
  const playing = playIndex === undefined ? undefined : clips[playIndex]
  const playback = playing && 'media_range' in playing ? media[playing.take_id] : undefined
  useEffect(() => {
    if (!playing || !('design_revision_id' in playing)) return
    const timer = window.setTimeout(() => setPlayIndex(index => index !== undefined && index === playIndex ? (index + 1 < cut.items.length ? index + 1 : undefined) : index), playing.estimated_duration_ms)
    return () => window.clearTimeout(timer)
  }, [playing, playIndex, cut.items.length])
  /** 拖动与按钮共用同一条目重排，停止播放后重新计算主轨起点。 */
  const move = (from: number, to: number) => {
    if (from === to) return
    const items = [...cut.items]
    const [item] = items.splice(from, 1)
    items.splice(to, 0, item)
    setPlayIndex(undefined); setCut(sequential({ items }))
  }
  /** 同一片段只推进一次，避免出点和结束事件重复推进或暂停事件重入。 */
  const advancePlayback = (element: HTMLVideoElement) => {
    if (!playing || advancingClip.current === playing.id) return
    advancingClip.current = playing.id
    element.pause()
    setPlayIndex(playIndex !== undefined && playIndex + 1 < clips.length ? playIndex + 1 : undefined)
  }
  /** 保存真实观察区间及来源，未拍到计划内容时允许不声明覆盖。 */
  const review = async () => {
    if (!take) return false
    if (reviewStale) { setError('素材审片版本已更新，请先核对最新审片。'); return false }
    setBusy(true); setError('')
    const range = { source_in_ms: Math.round(start * 1000), source_out_ms: Math.round(end * 1000) }
    try {
      const response = await StudioDirectingService.directingAnnotateTake({ projectId, sequenceId, takeId: take.id, requestBody: {
        expected_version: reviewVersion!, annotation: { review_status: 'reviewed', verdict, rationale: humanNote(observation),
          retained_ranges: ['retain', 'repair'].includes(verdict) ? [range] : [],
          coverage: coverageId ? [{ id: 'observed-' + crypto.randomUUID().slice(0, 8), coverage_item_id: coverageId, media_range: range,
            observation, source: { kind: 'file', reference: take.id, version: '1', file_id: take.file_id, media_range: range } }] : [] },
      } })
      if (!response.data) throw new Error('保存审片未返回有效结果')
      const savedTake = response.data.takes.find(row => row.id === take.id)
      if (!savedTake) throw new Error('未找到已保存的素材审片')
      onChange(response.data); setReviewVersion(savedTake.version); setReviewDirty(false); return true
    } catch (cause) { setError(directingError(cause)); return false } finally { setBusy(false) }
  }
  /** 显式选取局部素材；替换只影响指定片段，不自动采用其他候选。 */
  const adopt = () => {
    if (!take || !source?.duration_ms || start < 0 || end <= start || end * 1000 > source.duration_ms) { setError('请选择文件真实时长内的有效区间'); return }
    if (replaceId && !cut.items.some(item => item.id === replaceId)) { setError('替换目标已移除，请重新选择片段。'); return }
    const item = { kind: 'media' as const, id: replaceId || 'clip-' + crypto.randomUUID().slice(0, 8), take_id: take.id,
      media_range: { source_in_ms: Math.round(start * 1000), source_out_ms: Math.round(end * 1000) }, timeline_start_ms: 0 }
    setPlayIndex(undefined)
    setCut(sequential({ items: replaceId ? cut.items.map(clip => clip.id === replaceId ? item : clip) : [...cut.items, item] }))
    setNotice(replaceId ? '已替换剪辑草稿中的片段，尚未保存；当前采用保持不变。' : '已把所选区间加入剪辑草稿，尚未保存；当前采用保持不变。')
    setReplaceId(undefined)
  }
  /** 保存粗剪版本，服务端再次校验范围和并发版本。 */
  const save = async () => {
    if (stale) { setError('剪辑编辑基线已过期，请核对服务端版本。'); return false }
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: {
        document: { kind: 'cut', content: cut },
        ...(saved?.confirmed_at ? { parent_id: saved.id } : saved ? { revision_id: saved.id, expected_version: saved.version } : {}),
      } })
      if (!response.data) throw new Error('保存剪辑未返回有效版本')
      if (response.data) {
        onChange(response.data)
        const next = saved && !saved.confirmed_at ? response.data.cuts.find(row => row.id === saved.id) : uniqueNewRecord(workspace.cuts, response.data.cuts)
        if (!next) throw new Error('未找到已保存的剪辑版本')
        setNotice(''); setSaved(next); setCut(next.content)
      }
      return true
    } catch (cause) { setError(directingError(cause)); return false } finally { setBusy(false) }
  }
  const guardCut = useWorkspaceDraft({ busy, name: '剪辑草稿', dirty, save, discard: () => { setPlayIndex(undefined); setCut(structuredClone(saved?.content || { items: [] })) } })
  const guardReview = useWorkspaceDraft({ busy, name: '素材审片', dirty: reviewDirty, save: review, discard: () => { setObservation(take?.annotation.rationale.text || ''); setVerdict(take?.annotation.verdict || 'retain'); setCoverageId(undefined); setReviewVersion(take?.version); setReviewDirty(false) } })
  const inspector = <div className="cut-inspector-content" ref={inspectorScrolling}><Tabs activeKey={inspectorTab} onChange={setInspectorTab} items={[
    { key: 'review', label: '审片', children: <>        <details open={reviewOpen || reviewStale} onToggle={event => setReviewOpen(event.currentTarget.open)}><summary>实际观察、覆盖与审片结论</summary>
        {reviewStale && <Alert type="warning" message="素材审片版本已有更新，本地输入仍保留。" action={<Button onClick={() => guardReview(() => { setObservation(take?.annotation.rationale.text || ''); setVerdict(take?.annotation.verdict || 'retain'); setCoverageId(undefined); setReviewVersion(take?.version); setReviewDirty(false) })}>核对并载入最新审片</Button>} />}
        <Select allowClear aria-label="实际覆盖内容" placeholder="未覆盖计划动作可留空，并在观察中说明" style={{ width: '100%' }} value={coverageId} options={unit?.coverage.map(item => ({ value: item.id, label: item.action_scope }))} onChange={id => { setReviewDirty(true); setCoverageId(id) }} />
        <Input.TextArea aria-label="实际观察" placeholder="实际拍到了什么？哪些成立，哪些需要修改？" value={observation} onChange={event => { setReviewDirty(true); setObservation(event.target.value) }} />
        <Space><Select value={verdict} options={[{ value: 'pass', label: '过 · 整体可用' }, { value: 'retain', label: '保 · 局部值得保留' }, { value: 'repair', label: '修 · 需要补拍/修正' }, { value: 'discard', label: '废 · 不采用' }]} onChange={value => { setReviewDirty(true); setVerdict(value) }} /><Button loading={busy} disabled={reviewStale} onClick={review}>保存审片</Button></Space>
        </details>
</> },
    { key: 'clip', label: '片段', children: <>        {cut.items.map((item, index) => (item.id === clipId || !cut.items.some(row => row.id === clipId) && index === 0) && <Card data-workspace-target={`cut-item:${item.id}`} tabIndex={-1} size="small" key={item.id} style={{ width: '100%', borderStyle: 'design_revision_id' in item ? 'dashed' : 'solid' }} draggable onDragStart={() => setDragged(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragged !== undefined) move(dragged, index); setDragged(undefined) }}>
          <Space wrap><strong>片段 {index + 1}</strong><Tag>{'media_range' in item ? '真实素材区间' : '预计预演 · 尚未拍到'}</Tag><span>时间线 {item.timeline_start_ms / 1000} 秒起 · </span><span>{'media_range' in item ? `${(item.media_range.source_in_ms / 1000).toFixed(2)}–${(item.media_range.source_out_ms / 1000).toFixed(2)} 秒` : `预演 ${item.estimated_duration_ms / 1000} 秒`}</span>
            <Button disabled={index === 0} onClick={() => { move(index, index - 1) }}>上移</Button>
            <Button disabled={index === cut.items.length - 1} onClick={() => { move(index, index + 1) }}>下移</Button>
            <Button disabled={'design_revision_id' in item} onClick={() => guardReview(() => { if ('media_range' in item) { rangeEdited.current = true; if (selected !== item.take_id) pendingRange.current = { takeId: item.take_id, start: item.media_range.source_in_ms / 1000, end: item.media_range.source_out_ms / 1000 }; setSelected(item.take_id); setStart(item.media_range.source_in_ms / 1000); setEnd(item.media_range.source_out_ms / 1000); setReplaceId(item.id) } })}>调整区间</Button>
            <Button danger onClick={() => { setPlayIndex(undefined); setCut(sequential({ items: cut.items.filter(row => row.id !== item.id) })); if (replaceId === item.id) setReplaceId(undefined) }}>移除</Button>
          </Space>
          {'media_range' in item && <Typography.Paragraph>{takeAction(workspace, item.take_id)} · {revisionName(workspace.takes, item.take_id, 'Take')} · 完整素材未裁删</Typography.Paragraph>}
          {'design_revision_id' in item && <PlannedCard item={item} design={workspace.designs.find(row => row.id === item.design_revision_id)?.content} images={images} onImageSearch={q => { void searchPreviewImages(q) }} onChange={next => { setPlayIndex(undefined); setCut(sequential({ items: cut.items.map(row => row.id === item.id ? next : row) })) }} />}
        </Card>)}
</> },
    { key: 'source', label: '来源', children: <>        {take && <Space direction="vertical" className="w-full">
          <Typography.Text>当前查看：{revisionName(workspace.takes, take.id, 'Take')} · {revisionName(workspace.plans, take.plan_revision_id, '计划')} / {take.unit_id} <Tag>{takeUsage(activeCut, take.id)}</Tag></Typography.Text>
          {adoptedRanges.map(range => <Typography.Text key={range}>当前采用：{range}</Typography.Text>)}
          {draftRanges.map(range => <Typography.Text key={range} type="warning">编辑草稿已选入：{range}（{dirty ? '未保存' : '已保存，未确认采用'}）</Typography.Text>)}
          <Typography.Text type="secondary">审片结论与采用分别记录。观看素材、保存审片或加入草稿不会改变当前采用。</Typography.Text>
          <details><summary>完整素材、实际观察与来源</summary>
            <p>素材身份：{take.id} · 文件：{take.file_id} · 任务：{take.task_id}</p>
            <p>固定提示词：{take.prompt_revision_id} · 计划：{take.plan_revision_id} · 单元：{take.unit_id}</p>
            {take.annotation.coverage.map(row => <section key={row.id}><p>实际观察 {row.media_range.source_in_ms / 1000}–{row.media_range.source_out_ms / 1000} 秒：{row.observation}</p><SourceLinks sources={[row.source]} /></section>)}
            {take.annotation.retained_ranges.map((range, index) => <p key={index}>审片保留区间 {range.source_in_ms / 1000}–{range.source_out_ms / 1000} 秒（不代表采用）</p>)}
            <Button onClick={() => setSearch(cutDestination(search, { view: 'ledger', take: take.id, ledgerTab: 'takes', returnView: 'cut' }))}>追溯本素材完整输入</Button>
          </details>
        </Space>}
</> },
  ]} /></div>
  return <WorkspaceWriteBoundary busy={busy}><div className="sequence-stage-workspace cut-workbench">
    {search.get('view') === 'cut' && <SequenceNavigation><div className="design-navigation"><h2>候选素材</h2><Select aria-label="候选审片筛选" value={takeFilter} onChange={setTakeFilter} options={[{ value: 'all', label: '全部结论' }, { value: 'unreviewed', label: '待审片' }, { value: 'pass', label: '整体可用' }, { value: 'retain', label: '局部保留' }, { value: 'repair', label: '需修正' }, { value: 'discard', label: '废弃' }]} /><Select aria-label="候选来源单元" allowClear placeholder="所有计划与单元" value={unitFilter} onChange={setUnitFilter} options={workspace.plans.flatMap((plan, pi) => plan.content.units.map((unit, ui) => ({ value: `${plan.id}/${unit.id}`, label: `计划 ${pi+1} / 单元 ${ui+1}` })))} />
      <div className="cut-take-library">{workspace.takes.filter(take => (takeFilter === 'all' || takeFilter === take.annotation.review_status || takeFilter === take.annotation.verdict) && (!unitFilter || `${take.plan_revision_id}/${take.unit_id}` === unitFilter)).map(take => <button key={take.id} aria-pressed={selected === take.id} onClick={() => guardReview(() => { setPlayIndex(undefined); setSelected(take.id) })}>
        {media[take.id] ? <video muted preload="metadata" src={`${OpenAPI.BASE + media[take.id].url}#t=0.001`} aria-hidden="true" /> : <div className="cut-thumbnail-empty">媒体待载入</div>}
        <strong>{revisionName(workspace.takes, take.id, 'Take')}</strong><span>{takeAction(workspace, take.id)}</span><small>{take.annotation.review_status === 'unreviewed' ? '待审片' : ({ pass: '整体可用', retain: '局部保留', repair: '需修正', discard: '废弃' }[take.annotation.verdict || 'retain'])} · {takeUsage(activeCut, take.id)}</small>
      </button>)}</div><Button onClick={() => setPanel('preview')}>添加节奏预演</Button></div></SequenceNavigation>}
    <div className="sequence-version-bar cut-version-bar"><div className="sequence-version-context">        <Select aria-label="查看或编辑剪辑版本" className="w-full" placeholder="新剪辑草稿" value={saved?.id} options={workspace.cuts.map(row => ({ value: row.id, label: `${revisionName(workspace.cuts, row.id, '剪辑')} · ${cutStatus(row, activeCut)}` }))} onChange={id => loadCut(workspace.cuts.find(row => row.id === id))} />
<span>{dirty ? '草稿 · 未保存' : saved?.confirmed_at ? '已确认版本' : '草稿 · 已保存'}</span></div><Button onClick={() => setPanel('adopted')}>{activeCut.status !== 'ready' ? '当前采用待核对' : activeCut.cut ? `当前采用：${revisionName(workspace.cuts, activeCut.cut.id, '剪辑')}` : '尚无当前采用'}</Button><div className="sequence-version-actions"><Button loading={busy} disabled={stale} onClick={save}>{saved?.confirmed_at ? '保存为新剪辑草稿' : '保存剪辑草稿'}</Button><Button disabled={!saved || !!saved.confirmed_at || dirty || stale} loading={busy} onClick={async () => {
        if (!saved) return
        setBusy(true); setError('')
        try { const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: saved.id, requestBody: { expected_version: saved.version } }); const next = response.data?.cuts.find(row => row.id === saved.id && row.confirmed_at); if (!response.data || !next) throw new Error('未取得已确认剪辑，请刷新核对；当前采用不由本地猜测。'); onChange(response.data); setNotice(''); setSaved(next); setCut(next.content) }
        catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
      }}>确认并设为当前采用</Button></div></div>
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}{rangePreparation.error && <Alert type="warning" message={rangePreparation.error} />}
    {notice && dirty && <Alert type="success" message={notice} closable onClose={() => setNotice('')} />}
    {stale && <Alert type="warning" message="剪辑编辑基线已过期，请核对服务端版本后继续。" action={<Button onClick={() => loadCut(latestSaved)}>载入服务端剪辑版本</Button>} />}
    {take && ((takeFilter !== 'all' && takeFilter !== take.annotation.review_status && takeFilter !== take.annotation.verdict) || (unitFilter && `${take.plan_revision_id}/${take.unit_id}` !== unitFilter)) && <Alert type="info" message="所选素材不在筛选结果中" action={<Button onClick={() => { setTakeFilter('all'); setUnitFilter(undefined) }}>清除筛选</Button>} />}
    <div className="cut-work-area"><section className="cut-monitor-area" data-workspace-target="take-review" tabIndex={-1}>
      <div className="cut-monitor-toolbar"><Typography.Text aria-label="当前候选素材">{takeOptions.find(item => item.value === selected)?.label || '从场次导航选择候选素材'}</Typography.Text>{!desktop && <Button onClick={() => setPanel('details')}>审片与片段详情</Button>}</div>
      <div className="cut-viewer-scroll" ref={viewerScrolling}>        {playing && 'design_revision_id' in playing && <Card data-playing-item={playing.id} key={`preview-playback-${playing.id}`} title="正在预演（预计时长）"><PlannedCard item={playing} design={workspace.designs.find(row => row.id === playing.design_revision_id)?.content} images={images} /></Card>}
        {playing && 'media_range' in playing && playback && <video data-playing-item={playing.id} aria-label="剪辑顺序播放器" key={`playback-${playing.id}`} controls autoPlay onEnded={event => advancePlayback(event.currentTarget)} src={OpenAPI.BASE + playback.url} style={{ width: '100%', maxHeight: 420 }} onLoadedMetadata={event => { advancingClip.current = undefined; event.currentTarget.currentTime = playing.media_range.source_in_ms / 1000 }} onTimeUpdate={event => {
          if (event.currentTarget.currentTime * 1000 >= playing.media_range.source_out_ms) {
            advancePlayback(event.currentTarget)
          }
        }} />}
<div style={{ display: playing ? 'none' : undefined }}>        {take && <Typography.Title level={5} style={{ margin: 0 }}>正在观看：{takeAction(workspace, take.id)} · {revisionName(workspace.takes, take.id, 'Take')}</Typography.Title>}
        {source && <video aria-label="当前候选播放器" ref={video} key={source.take_id} onPlay={() => setPlayIndex(undefined)} controls src={OpenAPI.BASE + source.url} style={{ width: '100%', maxHeight: 420, background: '#111' }} />}
        <Typography.Text>本次选取：{start.toFixed(3)}–{end.toFixed(3)} 秒 · 完整素材保留</Typography.Text>
        {!source?.duration_ms && <Alert type="warning" message="素材真实时长尚不可用，暂不能采用区间。" />}
        <Space wrap><span>入点（秒）</span><InputNumber aria-label="候选入点秒数" min={0} precision={3} value={start} onChange={value => { rangeEdited.current = true; setStart(value || 0) }} /><Button onClick={() => { rangeEdited.current = true; setStart(Math.round((video.current?.currentTime || 0) * 1000) / 1000) }}>取当前入点</Button>
          <Button disabled={!take || !source?.duration_ms} loading={busy} onClick={async () => {
            if (!take) return
            setBusy(true); setError('')
            try { const response = await StudioDirectingService.directingExtractFrame({ projectId, sequenceId, takeId: take.id, requestBody: { at_ms: Math.round((video.current?.currentTime || 0) * 1000) } }); setFrame(response.data || undefined) }
            catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
          }}>提取当前画面为参考</Button><span>出点（秒）</span><InputNumber aria-label="候选出点秒数" min={0} precision={3} value={end} onChange={value => { rangeEdited.current = true; setEnd(value || 0) }} /><Button onClick={() => { rangeEdited.current = true; setEnd(Math.round((video.current?.currentTime || 0) * 1000) / 1000) }}>取当前出点</Button></Space>
        {frame && <Alert type="success" message={`已保存参考图，来自所选素材 · ${(frame.source.media_range?.source_in_ms || 0) / 1000} 秒。可在预演或生产计划中选择。`} />}
</div>        <details><summary>对比另一条素材</summary><Select allowClear aria-label="对比候选素材" placeholder="选择另一条候选进行对比" className="w-full" value={comparison} options={workspace.takes.filter(item => item.id !== selected).map((item) => ({ value: item.id, label: `Take ${workspace.takes.findIndex(take => take.id === item.id) + 1} · ${item.unit_id}` }))} onChange={setComparison} />
        {comparison && comparison !== selected && media[comparison] && <Card size="small" title="对比素材（不会改变当前采用区间）"><video controls key={comparison} src={OpenAPI.BASE + media[comparison].url} className="w-full" style={{ maxHeight: 300, background: '#111' }} /></Card>}
        </details>
        <Space wrap><Select aria-label="替换草稿片段" allowClear placeholder="加入剪辑草稿，或选择要替换的草稿片段" style={{ minWidth: 280 }} value={replaceId} options={cut.items.map((item, index) => ({ value: item.id, label: `替换片段 ${index + 1}` }))} onChange={setReplaceId} /><Button disabled={!source?.duration_ms} onClick={adopt}>{replaceId ? '替换剪辑草稿中的此片段' : '把这一段加入剪辑草稿'}</Button></Space>
</div>
    </section>
    {desktop ? <aside className="cut-inspector">{inspector}</aside> : <Drawer title="审片与片段详情" open={panel === 'details'} onClose={() => setPanel(undefined)} width={344}>{inspector}</Drawer>}
    <section className="cut-timeline-area" data-workspace-target="cut-editor" tabIndex={-1}><div className="cut-timeline-heading"><strong>{editingDraft ? '剪辑草稿' : '已确认剪辑'}</strong><span>真实 {timing.media / 1000}s · 预演 {timing.planned / 1000}s · 总长 {timing.timeline / 1000}s</span><Button size="small" onClick={() => { setSeamPair(undefined); setPanel('seams') }}>接缝与连续性</Button><Select aria-label="时间线缩放" value={timelineScale} onChange={setTimelineScale} options={[{ value: 60, label: '50%' }, { value: 120, label: '100%' }, { value: 240, label: '200%' }]} /><Button size="small" onClick={() => setPanel('preview')}>＋ 预演</Button></div>
      <nav ref={timelineScrolling} aria-label="剪辑时间线" className="cut-timeline">{!!clips.length && <div className="cut-timeline-track" style={{ width: Math.max(480, timing.timeline / 1000 * timelineScale + 16) }}><div className="cut-time-ruler">{Array.from({ length: Math.ceil(timing.timeline / 1000) + 1 }, (_, second) => <span key={second} style={{ left: second * timelineScale }}>{second}s</span>)}</div>{clips.map((item, index) => <div className="cut-timeline-item-wrap" key={item.id} style={{ left: item.timeline_start_ms / 1000 * timelineScale, width: ('media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms) / 1000 * timelineScale }}>
        <button className={`cut-timeline-item${clipId === item.id ? ' is-selected' : ''}${'design_revision_id' in item ? ' is-planned' : ''}`} data-timeline-item={item.id} draggable onDragStart={() => setDragged(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragged !== undefined) move(dragged, index); setDragged(undefined) }} onClick={() => { setClipId(item.id); setInspectorTab('clip'); if (!desktop) setPanel('details') }}>
          {'media_range' in item ? <>{media[item.take_id] && <video muted preload="metadata" aria-hidden="true" src={`${OpenAPI.BASE + media[item.take_id].url}#t=${item.media_range.source_in_ms / 1000}`} />}<strong>片段 {index+1} · 真实区间</strong><span>{(item.media_range.source_in_ms / 1000).toFixed(3)}–{(item.media_range.source_out_ms / 1000).toFixed(3)}s</span></> : <>{item.preview_file_id ? <img src={buildFileDownloadUrl(item.preview_file_id)} alt="已绑定预演画面" /> : <div className="cut-thumbnail-empty">预计画面 · 尚未拍到</div>}<strong>片段 {index+1} · 预演</strong><span>预计 {item.estimated_duration_ms / 1000}s</span></>}
        </button>
        {index < clips.length - 1 && 'media_range' in item && 'media_range' in clips[index+1] && item.timeline_start_ms + item.media_range.source_out_ms - item.media_range.source_in_ms === clips[index+1].timeline_start_ms && <button className="cut-seam-marker" title={dirty || saved?.id !== continuity?.active_cut_revision_id ? '草稿边界预览；确认采用后核对实际接缝' : continuity?.seams.find(seam => seam.left_item_id === item.id && seam.right_item_id === clips[index+1].id)?.status === 'pass' ? '接缝已通过' : '接缝待核对'} aria-label={`检查片段 ${index+1} 与 ${index+2} 接缝`} onClick={() => { setSeamPair([item.id, clips[index+1].id]); setPanel('seams') }}>◇</button>}
      </div>)}</div>}</nav>
      {!clips.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="将选取的真实区间或预演加入草稿" />}
      <div className="cut-save-actions">      <Space wrap><Button onClick={() => loadCut(workspace.cuts.slice(-1)[0])}>载入最近保存的剪辑</Button><Button disabled={!clips.length} onClick={() => { document.querySelectorAll<HTMLVideoElement>('[data-workspace-target="take-review"] video').forEach(element => element.pause()); setPlayIndex(0) }}>顺序播放</Button><Button disabled={playIndex === undefined} onClick={() => setPlayIndex(undefined)}>停止播放</Button></Space>
</div>
    </section></div>
    <Drawer title="当前采用的粗剪" open={panel === 'adopted'} onClose={() => setPanel(undefined)} width={560}><AdoptedCutPanel projectId={projectId} workspace={workspace} active={activeCut} onOpen={(view, item, take) => setSearch(cutDestination(search, { view, cut: activeCut.status === 'ready' ? activeCut.cut?.id : undefined, item, take, returnView: 'cut' }))} /></Drawer>
    <Drawer title="添加节奏预演" open={panel === 'preview'} onClose={() => setPanel(undefined)} width={640}>    <Card title="添加节奏预演">
      <Space direction="vertical" className="w-full">
        <Typography.Text type="secondary">从已确认设计选择镜头；预演不代表已经拍到，采用真实素材时需要显式替换。</Typography.Text>
        <Space wrap><Select aria-label="预演设计版本" placeholder="选择已确认设计" className="min-w-64" value={previewDesign} options={workspace.designs.filter(row => row.confirmed_at).map(row => ({ value: row.id, label: `${revisionName(workspace.designs, row.id, '设计')} · 修订 ${row.version}` }))} onChange={id => { setPreviewDesign(id); setPreviewShot(undefined) }} />
          <Select aria-label="预演镜头" placeholder="选择镜头" className="min-w-64" value={previewShot} options={design?.content.direction.shots.map(shot => ({ value: shot.id, label: shot.id + ' · ' + (shot.narrative_function.text || '待说明') }))} onChange={setPreviewShot} />
          <Button disabled={busy || !design || !previewShot} onClick={() => {
            const shot = design?.content.direction.shots.find(row => row.id === previewShot)
            if (design && shot) setCut(sequential({ items: [...cut.items, { kind: 'planned', id: 'preview-' + crypto.randomUUID().slice(0, 8), design_revision_id: design.id, shot_id: shot.id, estimated_duration_ms: shot.estimated_duration_ms || 5000, timeline_start_ms: 0, dialogue_cues: [] }] }))
          }}>添加预演卡</Button></Space>
        {design && <Typography.Text>尚未安排预演的镜头：{design.content.direction.shots.filter(shot => !coveredShots.has(shot.id)).map(shot => shot.id).join('、') || '无'}（不代表真实素材覆盖结论）</Typography.Text>}
      </Space>
    </Card>

</Drawer>
    <Drawer title="实际接缝与连续性" open={panel === 'seams'} onClose={() => setPanel(undefined)} width={720}><>{seamPair && <><h3>所选相邻片段 · {dirty || saved?.id !== continuity?.active_cut_revision_id ? '草稿边界预览' : '当前采用边界'}</h3><div className="cut-boundary-compare">{seamPair.map((id, index) => { const item = clips.find(row => row.id === id); if (!item || !('media_range' in item)) return null; const range = item.media_range; const source = media[item.take_id]; return <section key={id}><strong>{index === 0 ? '前段落幅' : '后段入幅'} · 片段 {clips.indexOf(item)+1}</strong>{source && <video controls preload="metadata" src={`${OpenAPI.BASE + source.url}#t=${index === 0 ? Math.max(range.source_in_ms / 1000, range.source_out_ms / 1000 - .5) : range.source_in_ms / 1000},${range.source_out_ms / 1000}`} />}<p>源区间 {(range.source_in_ms / 1000).toFixed(3)}–{(range.source_out_ms / 1000).toFixed(3)} 秒</p></section> })}</div></>}{seamPair && (dirty || saved?.id !== continuity?.active_cut_revision_id) ? <Alert type="info" message="此处预览正在编辑的片段；当前采用未改变。确认采用后，才能提取并保存这对片段的实际接缝审查。" /> : <ContinuityPanel projectId={projectId} workspace={workspace} itemIds={seamPair} />}</></Drawer>
  </div></WorkspaceWriteBoundary>
}
