import { useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Spin } from 'antd'
import { Link } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { ChapterDeliveriesRead, SceneDeliveryRead } from '../../../services/generated'
import { directingError } from './common'
import { SceneTimelinePreview } from './SceneTimelinePreview'

/** 缺口来自固定交付和当时适用审片，不从当前编辑或素材数量猜测通过。 */
function DeliveryNotes({ delivery }: { delivery: SceneDeliveryRead }) {
  let cursor = 0
  const gaps: string[] = []
  for (const item of [...delivery.content.timeline.items].sort((a, b) => a.timeline_start_ms - b.timeline_start_ms)) {
    if (item.timeline_start_ms > cursor) gaps.push(`${cursor}–${item.timeline_start_ms} 毫秒为时间线空白`)
    if ('estimated_duration_ms' in item) gaps.push(`待拍占位 ${item.id}：预计 ${item.estimated_duration_ms} 毫秒，不代表真实覆盖`)
    cursor = item.timeline_start_ms + ('media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms)
  }
  const review = delivery.review
  return <><p>{review?.verdict === 'pass' ? '交付画面验收通过' : review?.verdict === 'revise' ? '交付画面需修改' : '交付画面未验收'}</p>
    <p>{review?.coverage_status === 'verified' ? '实际覆盖已核对' : review?.coverage_status === 'gaps' ? '实际覆盖存在缺口' : '实际覆盖尚未核对'}</p>
    {review?.coverage_notes && <p>{review.coverage_notes}</p>}
    <p>{!review || review.sound_status === 'pending_postproduction' ? '声音待后期处理' : review.sound_status === 'reviewed' ? '声音已审查' : '声音不适用'}</p>
    {gaps.map(gap => <p key={gap}>{gap}</p>)}</>
}

/** 章节播放固定交付，读取失败停止播放，后续场次编辑不会改变本轮输入。 */
export function ChapterDeliveryPanel({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const [data, setData] = useState<ChapterDeliveriesRead>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [playing, setPlaying] = useState<number>()
  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setPlaying(undefined)
    void StudioDirectingService.directingChapterDeliveries({ projectId, chapterId }).then(result => {
      if (!result.data) throw new Error('章节使用内容尚未核实')
      if (active) setData(result.data)
    }).catch(cause => { if (active) setError(directingError(cause)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, chapterId, attempt])
  const rows = data?.sequences || []
  const current = playing == null ? undefined : rows[playing]
  return <Card title="章节已使用内容"><Space direction="vertical" className="w-full">
    <p>章节使用各场明确交付的固定内容。后续编辑和版本切换不会改变预演，只有明确更新到章节才会替换。</p>
    {error && <Alert type="warning" message="章节使用内容读取失败" description={error} />}
    {loading && <Spin />}
    <Space><Button onClick={() => setAttempt(value => value + 1)}>刷新章节使用</Button>
      <Button disabled={loading || !!error || !rows.length || rows.some(row => !row.delivery)} onClick={() => setPlaying(0)}>按场次顺序播放</Button>
      <Button onClick={() => setPlaying(undefined)}>停止章节播放</Button></Space>
    {!loading && !error && current?.delivery && <Card title={`正在预演：${current.title}`}>
      <SceneTimelinePreview key={`${current.delivery.id}:${attempt}`} autoStart onFinish={() => setPlaying(index => index != null && index + 1 < rows.length ? index + 1 : undefined)}
        outputAspectRatio={current.delivery.content.output_aspect_ratio} items={current.delivery.content.timeline.items} takes={current.delivery.takes} onStart={() => {}} />
    </Card>}
    {!loading && !error && rows.map(row => <Card key={row.sequence_id} size="small" title={`${row.position + 1}. ${row.title}`}>
      {row.delivery ? <><p>交付来源：{row.delivery.version_title}</p><p>更新时间：{new Date(row.delivery.created_at).toLocaleString()}</p>
        <p>交付画幅：{row.delivery.content.output_aspect_ratio}</p><DeliveryNotes delivery={row.delivery} />
        <details><summary>查看本次交付固定依据</summary><pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(row.delivery.content, null, 2)}</pre></details></>
        : <p>尚未明确用于章节，无可播放的交付内容。</p>}
      <Link to={`/projects/${projectId}/chapters/${chapterId}/sequences/${row.sequence_id}`}>继续场次创作</Link>
    </Card>)}
    <p>交付用于顺序预演，不代表验收通过或成片导出。</p>
  </Space></Card>
}
