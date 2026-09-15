import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, Select, Space, Spin, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { OpenAPI, StudioDirectingService } from '../../../services/generated'
import type { ChapterAssemblyRead, ChapterSequenceRead, CutFrameRead, MediaRead, TransitionWrite_Input } from '../../../services/generated'
import { directingError, humanNote } from './common'
import { FeedbackNote } from './FeedbackFields'
import { buildFileDownloadUrl } from '../assets/utils'

type Playback = { sequenceId: string; title: string; takeId?: string; start: number; end: number }

/** 保留场内留白和未完成预演的时间，不把素材拼接成虚假的完整章节。 */
function chapterPlaylist(data: ChapterAssemblyRead): Playback[] {
  return data.sequences.flatMap(scene => {
    const items: Playback[] = []
    let cursor = 0
    scene.items.forEach((item, index) => {
      const start = scene.timeline_starts_ms[index]
      if (start > cursor) items.push({ sequenceId: scene.sequence_id, title: `${scene.title} · 空白或待拍覆盖`, start: 0, end: start - cursor })
      items.push({ sequenceId: scene.sequence_id, title: scene.title, takeId: item.take_id, start: item.media_range.source_in_ms, end: item.media_range.source_out_ms })
      cursor = start + item.media_range.source_out_ms - item.media_range.source_in_ms
    })
    if (scene.duration_ms > cursor) items.push({ sequenceId: scene.sequence_id, title: `${scene.title} · 空白或待拍覆盖`, start: 0, end: scene.duration_ms - cursor })
    return items
  })
}

/** 一处跨场审查明确选择两端证据和转换意图，保存不触发补拍。 */
function TransitionEditor({ projectId, chapterId, left, right, onSaved }: { projectId: string; chapterId: string; left: ChapterSequenceRead; right: ChapterSequenceRead; onSaved: () => Promise<void> }) {
  const [frames, setFrames] = useState<[CutFrameRead[], CutFrameRead[]]>([[], []])
  const [leftId, setLeftId] = useState<string>()
  const [rightId, setRightId] = useState<string>()
  const [intent, setIntent] = useState('')
  const [observation, setObservation] = useState('')
  const [sound, setSound] = useState<TransitionWrite_Input['sound']>({})
  const [verdict, setVerdict] = useState<'pass' | 'revise'>('revise')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void Promise.all([left.sequence_id, right.sequence_id].map(sequenceId => StudioDirectingService.directingContinuity({ projectId, sequenceId }))).then(results => {
      if (live) setFrames([results[0].data?.frames.filter(frame => frame.current && frame.edge === 'end') || [], results[1].data?.frames.filter(frame => frame.current && frame.edge === 'start') || []])
    }).catch(cause => { if (live) setError(directingError(cause)) })
    return () => { live = false }
  }, [projectId, left.sequence_id, right.sequence_id, left.cut_revision_id, right.cut_revision_id])
  /** 服务端再次核验顺序、采用及整场边界，防止旧页面保存假通过。 */
  const save = async () => {
    if (!left.cut_revision_id || !right.cut_revision_id || !leftId || !rightId) return
    setBusy(true); setError('')
    try {
      await StudioDirectingService.directingReviewTransition({ projectId, chapterId, requestBody: { left_sequence_id: left.sequence_id, right_sequence_id: right.sequence_id,
        left_cut_revision_id: left.cut_revision_id, right_cut_revision_id: right.cut_revision_id, left_frame_id: leftId, right_frame_id: rightId,
        intent, observation: humanNote(observation), sound, verdict } }); await onSaved()
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  return <Card size="small" title={`${left.title} → ${right.title}`}><Space direction="vertical" className="w-full">
    {error && <Alert type="error" message={error} />}
    {[left, right].map((scene, index) => <Space direction="vertical" className="w-full" key={scene.sequence_id}>
      <Link to={`/projects/${projectId}/chapters/${chapterId}/sequences/${scene.sequence_id}?view=continuity`}>{index ? '后场' : '前场'}：查看并提取实际边界</Link>
      <Select aria-label={index ? '跨场后段入幅' : '跨场前段落幅'} placeholder={index ? '选择整场实际入幅' : '选择整场实际落幅'} className="w-full" value={index ? rightId : leftId} options={frames[index].map(frame => ({ value: frame.id, label: `${frame.item_id} · ${frame.at_ms / 1000} 秒` }))} onChange={id => index ? setRightId(id) : setLeftId(id)} />
      {(index ? rightId : leftId) && <img alt={index ? '后场入幅' : '前场落幅'} width={240} src={buildFileDownloadUrl(frames[index].find(frame => frame.id === (index ? rightId : leftId))?.file_id || '')} />}
    </Space>)}
    <Input.TextArea aria-label="跨场转换意图" placeholder="连续时空 / 跳时 / 插叙等转换意图" value={intent} onChange={event => setIntent(event.target.value)} />
    <Input.TextArea aria-label="跨场实际观察" placeholder="人物、物件、空间、动作与节奏的实际观察" value={observation} onChange={event => setObservation(event.target.value)} />
    <FeedbackNote label="跨场声音与后期" value={sound} onChange={setSound} />
    <Select aria-label="跨场结论" value={verdict} options={[{ value: 'revise', label: '需要调整' }, { value: 'pass', label: '转换通过' }]} onChange={setVerdict} />
    <Button loading={busy} disabled={!leftId || !rightId || !intent.trim() || !observation.trim()} onClick={save}>保存跨场检查</Button>
  </Space></Card>
}

/** 章节播放直接使用各场已确认采用，显示验收缺口及版本变化。 */
export function ChapterAssemblyPanel({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const [data, setData] = useState<ChapterAssemblyRead>()
  const [media, setMedia] = useState<Record<string, MediaRead>>({})
  const [index, setIndex] = useState<number>()
  const [error, setError] = useState('')
  const advanced = useRef<number>()
  /** 刷新时停止旧播放，固定本轮读取的媒体与顺序。 */
  const reload = useCallback(async () => {
    setIndex(undefined)
    try {
      const response = await StudioDirectingService.directingChapterAssembly({ projectId, chapterId })
      if (!response.data) return
      setData(response.data)
      const rows = await Promise.all(response.data.sequences.flatMap(scene => scene.items.map(item => StudioDirectingService.directingTakeMedia({ projectId, sequenceId: scene.sequence_id, takeId: item.take_id }))))
      setMedia(Object.fromEntries(rows.flatMap(row => row.data ? [[row.data.take_id, row.data]] : [])))
    } catch (cause) { setError(directingError(cause)) }
  }, [projectId, chapterId])
  useEffect(() => { void reload() }, [reload])
  const playlist = data ? chapterPlaylist(data) : []
  const playing = index === undefined ? undefined : playlist[index]
  /** 双重 ended/timeupdate 只推进一次，防止跳过片段。 */
  const advance = useCallback(() => {
    if (index === undefined || advanced.current === index) return
    advanced.current = index
    setIndex(index + 1 < playlist.length ? index + 1 : undefined)
  }, [index, playlist.length])
  useEffect(() => { advanced.current = undefined }, [index])
  const gapDuration = playing && !playing.takeId ? playing.end - playing.start : undefined
  useEffect(() => {
    if (gapDuration === undefined) return
    const timer = window.setTimeout(advance, gapDuration)
    return () => window.clearTimeout(timer)
  }, [gapDuration, advance])
  if (!data) return <Space><Spin />{error && <Alert type="error" message={error} />}</Space>
  return <Card title="章节组合与跨场检查"><Space direction="vertical" className="w-full" size="large">
    {error && <Alert type="error" message={error} />}
    <Typography.Paragraph>播放顺序来自场次顺序，内容来自各场已确认粗剪。未验收画面可供检查，声音待后期和预演缺口仍需单独处理。</Typography.Paragraph>
    {!!data.gaps.length && <Alert type="warning" message="章节尚有待处理事项" description={data.gaps.map((gap, i) => <p key={i}>{gap}</p>)} />}
    <Space><Button onClick={reload}>刷新章节采用</Button><Button disabled={!playlist.length || playlist.some(item => item.takeId && !media[item.takeId])} onClick={() => { advanced.current = undefined; setIndex(0) }}>按场次顺序播放</Button><Button onClick={() => setIndex(undefined)}>停止章节播放</Button></Space>
    {playing && <Card size="small" title={playing.title}>{playing.takeId && media[playing.takeId] ? <video key={index} controls autoPlay className="w-full" src={OpenAPI.BASE + media[playing.takeId].url}
      onLoadedMetadata={event => { event.currentTarget.currentTime = playing.start / 1000 }} onEnded={advance} onError={() => { setError('章节媒体加载失败，请刷新或检查源素材'); setIndex(undefined) }}
      onTimeUpdate={event => { if (event.currentTarget.currentTime * 1000 >= playing.end - 30) { event.currentTarget.pause(); advance() } }} /> : <Alert type="warning" message={`此处为留白或待拍覆盖，时长 ${(playing.end - playing.start) / 1000} 秒`} />}</Card>}
    {data.sequences.map(scene => <Card size="small" key={scene.sequence_id} title={`${scene.position + 1}. ${scene.title}`}>
      <p>{scene.verdict === 'pass' ? '画面验收通过' : scene.verdict === 'revise' ? '需调整' : '尚未验收'} · {scene.sound_status === 'pending_postproduction' ? '声音待后期' : '声音已有记录'} · {scene.duration_ms / 1000} 秒</p>
      <Link to={`/projects/${projectId}/chapters/${chapterId}/sequences/${scene.sequence_id}?view=feedback`}>查看场次验收与返工</Link>
    </Card>)}
    {data.sequences.slice(0, -1).map((left, i) => <TransitionEditor key={`${left.sequence_id}:${left.cut_revision_id}:${data.sequences[i + 1].sequence_id}:${data.sequences[i + 1].cut_revision_id}`} projectId={projectId} chapterId={chapterId} left={left} right={data.sequences[i + 1]} onSaved={reload} />)}
    {data.transitions.map(row => <Card size="small" key={row.id} title={row.current ? '当前相邻版本的检查记录' : '历史检查 · 顺序或采用已变化'}><p>{row.content.intent} · {row.content.verdict === 'pass' ? '通过' : '需调整'}</p><p>{row.content.observation.text}</p><p>声音：{row.content.sound.text || row.content.sound.reason || '待检查'}</p></Card>)}
  </Space></Card>
}
