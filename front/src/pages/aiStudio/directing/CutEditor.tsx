import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, InputNumber, Select, Space, Typography } from 'antd'
import { OpenAPI, StudioDirectingService, StudioFilesService } from '../../../services/generated'
import type { ExtractedFrame, FileRead, MediaRead, SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { directingError, humanNote } from './common'
import { PlannedCard } from './PlannedCard'

/** 重排主轨并据真实区间重算起点，预计时长只用于 planned 项。 */
function sequential(cut: SequenceCut_Input): SequenceCut_Input {
  let start = 0
  return { items: cut.items.map(item => {
    const next = { ...item, timeline_start_ms: start }
    start += 'media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms
    return next
  }) }
}

/** 候选审片与主视频粗剪，保留完整 Take，采用和审查是独立操作。 */
export function CutEditor({ projectId, workspace, onChange }: { projectId: string; workspace: WorkspaceRead; onChange: (workspace: WorkspaceRead) => void }) {
  const [frame, setFrame] = useState<ExtractedFrame>()
  const [previewFiles, setPreviewFiles] = useState<FileRead[]>([])
  const [previewDesign, setPreviewDesign] = useState<string>()
  const [previewShot, setPreviewShot] = useState<string>()
  const [dragged, setDragged] = useState<number>()
  const [comparison, setComparison] = useState<string>()
  const [selected, setSelected] = useState(workspace.takes.slice(-1)[0]?.id || '')
  const [media, setMedia] = useState<Record<string, MediaRead>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(0)
  const [verdict, setVerdict] = useState<'pass' | 'retain' | 'repair' | 'discard'>('retain')
  const [observation, setObservation] = useState('')
  const [coverageId, setCoverageId] = useState<string>()
  const [replaceId, setReplaceId] = useState<string>()
  const [saved, setSaved] = useState<WorkspaceRead['cuts'][number] | undefined>(workspace.cuts.slice(-1)[0])
  const pendingRange = useRef<{ takeId: string; start: number; end: number }>()
  const [cut, setCut] = useState<SequenceCut_Input>(saved?.content || { items: [] })
  const [playIndex, setPlayIndex] = useState<number>()
  const advancingClip = useRef<string>()
  const video = useRef<HTMLVideoElement>(null)
  const take = workspace.takes.find(item => item.id === selected)
  const takeIds = workspace.takes.map(item => item.id).join(',')
  const duration = media[selected]?.duration_ms || 0
  const sequenceId = workspace.sequence.id
  const unit = workspace.plans.find(plan => plan.id === take?.plan_revision_id)?.content.units.find(item => item.id === take?.unit_id)
  useEffect(() => {
    let active = true
    void Promise.all((takeIds ? takeIds.split(',') : []).map(takeId => StudioDirectingService.directingTakeMedia({ projectId, sequenceId, takeId }))).then(rows => {
      if (active) setMedia(Object.fromEntries(rows.flatMap(row => row.data ? [[row.data.take_id, row.data]] : [])))
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, sequenceId, takeIds])
  useEffect(() => { if (!selected && workspace.takes.length) setSelected(workspace.takes.slice(-1)[0]!.id) }, [workspace.takes, selected])
  const annotation = useRef(take?.annotation)
  annotation.current = take?.annotation
  useEffect(() => {
    const pending = pendingRange.current
    if (pending?.takeId === selected) {
      setStart(pending.start); setEnd(pending.end)
      pendingRange.current = undefined
    } else { setStart(0); setEnd(duration / 1000) }
    setCoverageId(undefined); setObservation(annotation.current?.rationale.text || '')
    setVerdict(annotation.current?.verdict || 'retain')
  }, [selected, duration])
  const source = media[selected]
  const clips = cut.items
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
    if (!take) return
    setBusy(true); setError('')
    const range = { source_in_ms: Math.round(start * 1000), source_out_ms: Math.round(end * 1000) }
    try {
      const response = await StudioDirectingService.directingAnnotateTake({ projectId, sequenceId, takeId: take.id, requestBody: {
        expected_version: take.version, annotation: { review_status: 'reviewed', verdict, rationale: humanNote(observation),
          retained_ranges: ['retain', 'repair'].includes(verdict) ? [range] : [],
          coverage: coverageId ? [{ id: 'observed-' + crypto.randomUUID().slice(0, 8), coverage_item_id: coverageId, media_range: range,
            observation, source: { kind: 'file', reference: take.id, version: '1', file_id: take.file_id, media_range: range } }] : [] },
      } })
      if (response.data) onChange(response.data)
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  /** 显式选取局部素材；替换只影响指定片段，不自动采用其他候选。 */
  const adopt = () => {
    if (!take || !source?.duration_ms || start < 0 || end <= start || end * 1000 > source.duration_ms) { setError('请选择文件真实时长内的有效区间'); return }
    const item = { kind: 'media' as const, id: replaceId || 'clip-' + crypto.randomUUID().slice(0, 8), take_id: take.id,
      media_range: { source_in_ms: Math.round(start * 1000), source_out_ms: Math.round(end * 1000) }, timeline_start_ms: 0 }
    setPlayIndex(undefined)
    setCut(sequential({ items: replaceId ? cut.items.map(clip => clip.id === replaceId ? item : clip) : [...cut.items, item] }))
    setReplaceId(undefined)
  }
  /** 保存粗剪版本，服务端再次校验范围和并发版本。 */
  const save = async () => {
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: {
        document: { kind: 'cut', content: cut },
        ...(saved?.confirmed_at ? { parent_id: saved.id } : saved ? { revision_id: saved.id, expected_version: saved.version } : {}),
      } })
      if (response.data) {
        onChange(response.data)
        const next = saved && !saved.confirmed_at ? response.data.cuts.find(row => row.id === saved.id) : response.data.cuts.slice(-1)[0]
        setSaved(next); setCut(next?.content || cut)
      }
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  return <Space direction="vertical" style={{ width: '100%' }} size="large">
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    <Card title="候选素材与审片">
      {!workspace.takes.length ? <Typography.Text>试拍成功后，候选素材会出现在这里。</Typography.Text> : <Space direction="vertical" style={{ width: '100%' }}>
        <Select aria-label="选择候选 Take" style={{ width: '100%' }} value={selected} options={workspace.takes.map((item, index) => ({ value: item.id, label: `Take ${index + 1} · ${item.unit_id}${item.annotation.verdict ? ' · ' + ({ pass: '过', retain: '保', repair: '修', discard: '废' }[item.annotation.verdict]) : ' · 未审'}` }))} onChange={setSelected} />
        <Select allowClear aria-label="对比候选素材" placeholder="选择另一条候选进行对比" className="w-full" value={comparison} options={workspace.takes.filter(item => item.id !== selected).map((item) => ({ value: item.id, label: `Take ${workspace.takes.findIndex(take => take.id === item.id) + 1} · ${item.unit_id}` }))} onChange={setComparison} />
        {comparison && comparison !== selected && media[comparison] && <Card size="small" title="对比素材（不会改变当前采用区间）"><video controls key={comparison} src={OpenAPI.BASE + media[comparison].url} className="w-full" style={{ maxHeight: 300, background: '#111' }} /></Card>}
        {source && <video ref={video} key={source.take_id} controls src={OpenAPI.BASE + source.url} style={{ width: '100%', maxHeight: 420, background: '#111' }} />}
        {!source?.duration_ms && <Alert type="warning" message="素材真实时长尚不可用，暂不能采用区间。" />}
        <Space wrap><span>入点（秒）</span><InputNumber min={0} precision={3} value={start} onChange={value => setStart(value || 0)} /><Button onClick={() => setStart(Math.round((video.current?.currentTime || 0) * 1000) / 1000)}>取当前入点</Button>
          <Button disabled={!take || !source?.duration_ms} loading={busy} onClick={async () => {
            if (!take) return
            setBusy(true); setError('')
            try { const response = await StudioDirectingService.directingExtractFrame({ projectId, sequenceId, takeId: take.id, requestBody: { at_ms: Math.round((video.current?.currentTime || 0) * 1000) } }); setFrame(response.data || undefined) }
            catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
          }}>提取当前画面为参考</Button><span>出点（秒）</span><InputNumber min={0} precision={3} value={end} onChange={value => setEnd(value || 0)} /><Button onClick={() => setEnd(Math.round((video.current?.currentTime || 0) * 1000) / 1000)}>取当前出点</Button></Space>
        {frame && <Alert type="success" message={`已保存参考图，来源 Take ${frame.source.reference} · ${(frame.source.media_range?.source_in_ms || 0) / 1000} 秒。可在预演或生产计划中选择。`} />}
        <Select allowClear aria-label="实际覆盖内容" placeholder="未覆盖计划动作可留空，并在观察中说明" style={{ width: '100%' }} value={coverageId} options={unit?.coverage.map(item => ({ value: item.id, label: item.action_scope }))} onChange={setCoverageId} />
        <Input.TextArea aria-label="实际观察" placeholder="实际拍到了什么？哪些成立，哪些需要修改？" value={observation} onChange={event => setObservation(event.target.value)} />
        <Space><Select value={verdict} options={[{ value: 'pass', label: '过 · 整体可用' }, { value: 'retain', label: '保 · 局部值得保留' }, { value: 'repair', label: '修 · 需要补拍/修正' }, { value: 'discard', label: '废 · 不采用' }]} onChange={setVerdict} /><Button loading={busy} onClick={review}>保存审片</Button></Space>
        <Space wrap><Select allowClear placeholder="追加到粗剪，或选择要替换的片段" style={{ minWidth: 280 }} value={replaceId} options={cut.items.map((item, index) => ({ value: item.id, label: `替换片段 ${index + 1}` }))} onChange={setReplaceId} /><Button type="primary" disabled={!source?.duration_ms} onClick={adopt}>{replaceId ? '替换此片段' : '采用当前区间'}</Button></Space>
      </Space>}
    </Card>
    <Card title="添加节奏预演">
      <Space direction="vertical" className="w-full">
        <Typography.Text type="secondary">从已确认设计选择镜头；预演不代表已经拍到，采用真实素材时需要显式替换。</Typography.Text>
        <Space wrap><Select aria-label="预演设计版本" placeholder="选择已确认设计" className="min-w-64" value={previewDesign} options={workspace.designs.filter(row => row.confirmed_at).map((row, index) => ({ value: row.id, label: `设计 ${index + 1} · v${row.version}` }))} onChange={id => { setPreviewDesign(id); setPreviewShot(undefined) }} />
          <Select aria-label="预演镜头" placeholder="选择镜头" className="min-w-64" value={previewShot} options={design?.content.direction.shots.map(shot => ({ value: shot.id, label: shot.id + ' · ' + (shot.narrative_function.text || '待说明') }))} onChange={setPreviewShot} />
          <Button disabled={!design || !previewShot} onClick={() => {
            const shot = design?.content.direction.shots.find(row => row.id === previewShot)
            if (design && shot) setCut(sequential({ items: [...cut.items, { kind: 'planned', id: 'preview-' + crypto.randomUUID().slice(0, 8), design_revision_id: design.id, shot_id: shot.id, estimated_duration_ms: shot.estimated_duration_ms || 5000, timeline_start_ms: 0, dialogue_cues: [] }] }))
          }}>添加预演卡</Button></Space>
        {design && <Typography.Text>尚未安排预演的镜头：{design.content.direction.shots.filter(shot => !coveredShots.has(shot.id)).map(shot => shot.id).join('、') || '无'}（不代表真实素材覆盖结论）</Typography.Text>}
      </Space>
    </Card>
    <Card title="场次预演与粗剪">
      <Space wrap className="mb-4"><Button onClick={() => { setPlayIndex(undefined); const next = workspace.cuts.slice(-1)[0]; setSaved(next); setCut(next?.content || { items: [] }) }}>放弃本地修改，载入最新</Button><Button disabled={!clips.length} onClick={() => setPlayIndex(0)}>顺序播放</Button><Button type="primary" loading={busy} onClick={save}>保存粗剪</Button><Button disabled={!saved || !!saved.confirmed_at || JSON.stringify(saved.content) !== JSON.stringify(cut)} loading={busy} onClick={async () => {
        if (!saved) return
        setBusy(true); setError('')
        try { const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: saved.id, requestBody: { expected_version: saved.version } }); if (response.data) { onChange(response.data); const next = response.data.cuts.find(row => row.id === saved.id); setSaved(next); if (next) setCut(next.content) } }
        catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
      }}>确认此剪辑版本</Button><Button disabled={playIndex === undefined} onClick={() => setPlayIndex(undefined)}>停止播放</Button></Space>
      <Space direction="vertical" style={{ width: '100%' }}>
        {playing && 'design_revision_id' in playing && <Card key={`preview-playback-${playing.id}`} title="正在预演（预计时长）"><PlannedCard item={playing} design={workspace.designs.find(row => row.id === playing.design_revision_id)?.content} images={images} /></Card>}
        {playing && 'media_range' in playing && playback && <video key={`playback-${playing.id}`} controls autoPlay onEnded={event => advancePlayback(event.currentTarget)} src={OpenAPI.BASE + playback.url} style={{ width: '100%', maxHeight: 420 }} onLoadedMetadata={event => { advancingClip.current = undefined; event.currentTarget.currentTime = playing.media_range.source_in_ms / 1000 }} onTimeUpdate={event => {
          if (event.currentTarget.currentTime * 1000 >= playing.media_range.source_out_ms) {
            advancePlayback(event.currentTarget)
          }
        }} />}
        {!cut.items.length && <Typography.Text type="secondary">尚未采用素材；试拍成功不会自动进入粗剪。</Typography.Text>}
        {cut.items.map((item, index) => <Card size="small" key={item.id} style={{ width: '100%' }} draggable onDragStart={() => setDragged(index)} onDragOver={event => event.preventDefault()} onDrop={() => { if (dragged !== undefined) move(dragged, index); setDragged(undefined) }}>
          <Space wrap><strong>片段 {index + 1}</strong><span>{'media_range' in item ? `${(item.media_range.source_in_ms / 1000).toFixed(2)}–${(item.media_range.source_out_ms / 1000).toFixed(2)} 秒` : `预演 ${item.estimated_duration_ms / 1000} 秒`}</span>
            <Button disabled={index === 0} onClick={() => { move(index, index - 1) }}>上移</Button>
            <Button disabled={index === cut.items.length - 1} onClick={() => { move(index, index + 1) }}>下移</Button>
            <Button disabled={'design_revision_id' in item} onClick={() => { if ('media_range' in item) { if (selected !== item.take_id) pendingRange.current = { takeId: item.take_id, start: item.media_range.source_in_ms / 1000, end: item.media_range.source_out_ms / 1000 }; setSelected(item.take_id); setStart(item.media_range.source_in_ms / 1000); setEnd(item.media_range.source_out_ms / 1000); setReplaceId(item.id) } }}>调整区间</Button>
            <Button danger onClick={() => { setPlayIndex(undefined); setCut(sequential({ items: cut.items.filter(row => row.id !== item.id) })) }}>移除</Button>
          </Space>
          {'design_revision_id' in item && <PlannedCard item={item} design={workspace.designs.find(row => row.id === item.design_revision_id)?.content} images={images} onImageSearch={q => { void searchPreviewImages(q) }} onChange={next => { setPlayIndex(undefined); setCut(sequential({ items: cut.items.map(row => row.id === item.id ? next : row) })) }} />}
        </Card>)}
      </Space>
    </Card>
  </Space>
}
