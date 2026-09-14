import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, InputNumber, Select, Space, Typography } from 'antd'
import { OpenAPI, StudioDirectingService } from '../../../services/generated'
import type { MediaCutItem, MediaRead, SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { directingError, humanNote } from './common'

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
  const saved = workspace.cuts.slice(-1)[0]
  const [cut, setCut] = useState<SequenceCut_Input>(saved?.content || { items: [] })
  const [playIndex, setPlayIndex] = useState<number>()
  const video = useRef<HTMLVideoElement>(null)
  const take = workspace.takes.find(item => item.id === selected)
  const sequenceId = workspace.sequence.id
  const unit = workspace.plans.find(plan => plan.id === take?.plan_revision_id)?.content.units.find(item => item.id === take?.unit_id)
  useEffect(() => {
    let active = true
    void Promise.all(workspace.takes.map(item => StudioDirectingService.directingTakeMedia({ projectId, sequenceId, takeId: item.id }))).then(rows => {
      if (active) setMedia(Object.fromEntries(rows.flatMap(row => row.data ? [[row.data.take_id, row.data]] : [])))
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, sequenceId, workspace.takes.map(item => item.id).join(',')])
  useEffect(() => { if (!selected && workspace.takes.length) setSelected(workspace.takes.slice(-1)[0]!.id) }, [workspace.takes, selected])
  useEffect(() => {
    setStart(0); setEnd((media[selected]?.duration_ms || 0) / 1000)
    setCoverageId(undefined); setObservation(take?.annotation.rationale.text || '')
    setVerdict(take?.annotation.verdict || 'retain')
  }, [selected, media[selected]?.duration_ms])
  const source = media[selected]
  const clips = cut.items.filter((item): item is MediaCutItem => 'media_range' in item)
  const playing = playIndex == null ? undefined : clips[playIndex]
  const playback = playing ? media[playing.take_id] : undefined
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
      if (response.data) { onChange(response.data); setCut(response.data.cuts.slice(-1)[0]?.content || cut) }
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  return <Space direction="vertical" style={{ width: '100%' }} size="large">
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    <Card title="候选素材与审片">
      {!workspace.takes.length ? <Typography.Text>试拍成功后，候选素材会出现在这里。</Typography.Text> : <Space direction="vertical" style={{ width: '100%' }}>
        <Select aria-label="选择候选 Take" style={{ width: '100%' }} value={selected} options={workspace.takes.map((item, index) => ({ value: item.id, label: `Take ${index + 1} · ${item.unit_id}${item.annotation.verdict ? ' · ' + ({ pass: '过', retain: '保', repair: '修', discard: '废' }[item.annotation.verdict]) : ' · 未审'}` }))} onChange={setSelected} />
        {source && <video ref={video} key={source.take_id} controls src={OpenAPI.BASE + source.url} style={{ width: '100%', maxHeight: 420, background: '#111' }} />}
        {!source?.duration_ms && <Alert type="warning" message="素材真实时长尚不可用，暂不能采用区间。" />}
        <Space wrap><span>入点（秒）</span><InputNumber min={0} precision={3} value={start} onChange={value => setStart(value || 0)} /><Button onClick={() => setStart(Math.round((video.current?.currentTime || 0) * 1000) / 1000)}>取当前入点</Button>
          <span>出点（秒）</span><InputNumber min={0} precision={3} value={end} onChange={value => setEnd(value || 0)} /><Button onClick={() => setEnd(Math.round((video.current?.currentTime || 0) * 1000) / 1000)}>取当前出点</Button></Space>
        <Select allowClear aria-label="实际覆盖内容" placeholder="未覆盖计划动作可留空，并在观察中说明" style={{ width: '100%' }} value={coverageId} options={unit?.coverage.map(item => ({ value: item.id, label: item.action_scope }))} onChange={setCoverageId} />
        <Input.TextArea aria-label="实际观察" placeholder="实际拍到了什么？哪些成立，哪些需要修改？" value={observation} onChange={event => setObservation(event.target.value)} />
        <Space><Select value={verdict} options={[{ value: 'pass', label: '过 · 整体可用' }, { value: 'retain', label: '保 · 局部值得保留' }, { value: 'repair', label: '修 · 需要补拍/修正' }, { value: 'discard', label: '废 · 不采用' }]} onChange={setVerdict} /><Button loading={busy} onClick={review}>保存审片</Button></Space>
        <Space wrap><Select allowClear placeholder="追加到粗剪，或选择要替换的片段" style={{ minWidth: 280 }} value={replaceId} options={cut.items.map((item, index) => ({ value: item.id, label: `替换片段 ${index + 1}` }))} onChange={setReplaceId} /><Button type="primary" disabled={!source?.duration_ms} onClick={adopt}>{replaceId ? '替换此片段' : '采用当前区间'}</Button></Space>
      </Space>}
    </Card>
    <Card title="场次粗剪" extra={<Space><Button disabled={!clips.length} onClick={() => setPlayIndex(0)}>顺序播放</Button><Button type="primary" loading={busy} onClick={save}>保存粗剪</Button></Space>}>
      <Space direction="vertical" style={{ width: '100%' }}>
        {playing && playback && <video key={playing.id} controls autoPlay src={OpenAPI.BASE + playback.url} style={{ width: '100%', maxHeight: 420 }} onLoadedMetadata={event => { event.currentTarget.currentTime = playing.media_range.source_in_ms / 1000 }} onTimeUpdate={event => {
          if (event.currentTarget.currentTime * 1000 >= playing.media_range.source_out_ms) {
            event.currentTarget.pause(); setPlayIndex(index => index != null && index + 1 < clips.length ? index + 1 : undefined)
          }
        }} />}
        {!cut.items.length && <Typography.Text type="secondary">尚未采用素材；试拍成功不会自动进入粗剪。</Typography.Text>}
        {cut.items.map((item, index) => <Card size="small" key={item.id} style={{ width: '100%' }}>
          <Space wrap><strong>片段 {index + 1}</strong><span>{'media_range' in item ? `${(item.media_range.source_in_ms / 1000).toFixed(2)}–${(item.media_range.source_out_ms / 1000).toFixed(2)} 秒` : `预演 ${item.estimated_duration_ms / 1000} 秒`}</span>
            <Button disabled={index === 0} onClick={() => { const items = [...cut.items]; [items[index - 1], items[index]] = [items[index], items[index - 1]]; setCut(sequential({ items })) }}>上移</Button>
            <Button disabled={index === cut.items.length - 1} onClick={() => { const items = [...cut.items]; [items[index + 1], items[index]] = [items[index], items[index + 1]]; setCut(sequential({ items })) }}>下移</Button>
            <Button onClick={() => { if ('media_range' in item) { setSelected(item.take_id); setStart(item.media_range.source_in_ms / 1000); setEnd(item.media_range.source_out_ms / 1000); setReplaceId(item.id) } }}>调整区间</Button>
            <Button danger onClick={() => setCut(sequential({ items: cut.items.filter(row => row.id !== item.id) }))}>移除</Button>
          </Space>
        </Card>)}
      </Space>
    </Card>
  </Space>
}
