import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Space } from 'antd'
import type { SceneTakeLibraryRead, SceneTimeline_Output } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { invalidTakeRange } from './sceneTakeIssues'

type Item = SceneTimeline_Output['items'][number]
type Segment = { start: number; duration: number; item?: Item; source?: SceneTakeLibraryRead }

/** 播放时间以媒体时钟或空白计时为准；加载与暂停不消耗时间线，失败不跳过片段。 */
export function SceneTimelinePreview({ items, takes, onStart, outputAspectRatio, scope = 'scene', autoStart = false, onFinish }: {
  autoStart?: boolean; onFinish?: () => void
  scope?: 'scene' | 'seam'
  outputAspectRatio: '16:9' | '9:16' | '1:1'; items: Item[]; takes: SceneTakeLibraryRead[]; onStart: () => void
}) {
  const name = scope === 'seam' ? '接缝' : '时间线'
  const [frameWidth, frameHeight] = outputAspectRatio.split(':').map(Number)
  const frameStyle = { width: '100%', maxWidth: 320 * frameWidth / frameHeight, aspectRatio: `${frameWidth} / ${frameHeight}`, background: '#000', marginInline: 'auto' }
  // 一次明确播放固定源URL；后台候选／签名刷新只供下一次播放使用。
  const [playbackSources, setPlaybackSources] = useState<SceneTakeLibraryRead[]>()
  const sources = playbackSources || takes
  const segments = useMemo(() => {
    const result: Segment[] = []
    let cursor = 0
    for (const item of [...items].sort((left, right) => left.timeline_start_ms - right.timeline_start_ms)) {
      if (item.timeline_start_ms > cursor) result.push({ start: cursor, duration: item.timeline_start_ms - cursor })
      const duration = 'media_range' in item ? item.media_range.source_out_ms - item.media_range.source_in_ms : item.estimated_duration_ms
      result.push({ start: item.timeline_start_ms, duration, item,
        source: 'media_range' in item ? sources.find(take => take.take_kind === item.take_kind && take.take_id === item.take_id && take.file_id === item.file_id) : undefined })
      cursor = item.timeline_start_ms + duration
    }
    return result
  }, [items, sources])
  const [index, setIndex] = useState<number>()
  const [running, setRunning] = useState(false)
  const [ready, setReady] = useState(false)
  const [finished, setFinished] = useState(false)
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [position, setPosition] = useState(0)
  const elapsed = useRef(0)
  const video = useRef<HTMLVideoElement>(null)
  const segment = index == null ? undefined : segments[index]
  const media = segment?.item && 'media_range' in segment.item ? segment.item : undefined
  const total = segments.length ? segments[segments.length - 1].start + segments[segments.length - 1].duration : 0
  const fail = (message: string) => { video.current?.pause(); setRunning(false); setError(message) }
  const advance = () => {
    video.current?.pause(); elapsed.current = 0; setReady(false)
    if (index == null || index + 1 >= segments.length) { setIndex(undefined); setRunning(false); setFinished(true); setPosition(total); onFinish?.() }
    else { setIndex(index + 1); setPosition(segments[index + 1].start) }
  }
  useEffect(() => {
    if (!running || !segment) { video.current?.pause(); return }
    let active = true
    let frame = 0
    let previous = performance.now()
    if (media && ready && video.current) {
      void video.current.play().catch(() => { if (active) fail('播放未能开始，请重试当前片段。') })
    }
    const tick = (now: number) => {
      if (media) {
        const node = video.current
        if (ready && node && !node.seeking) {
          elapsed.current = Math.max(0, node.currentTime * 1000 - media.media_range.source_in_ms)
          if (node.currentTime * 1000 >= media.media_range.source_out_ms) { advance(); return }
        }
      } else elapsed.current += now - previous
      previous = now
      if (!media && elapsed.current >= segment.duration) { advance(); return }
      setPosition(Math.round(segment.start + Math.min(elapsed.current, segment.duration)))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => { active = false; cancelAnimationFrame(frame); video.current?.pause() }
  // 每段的固定源与时长由父组件的预览身份保护；位置更新不能重启播放时钟。
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, running, ready, segments])
  const startPlayback = () => {
    const invalid = segments.find(row => {
      if (!row.item || !('media_range' in row.item)) return false
      const item = row.item
      const source = takes.find(take => take.take_kind === item.take_kind && take.take_id === item.take_id && take.file_id === item.file_id)
      return !source?.available || !source.media_url || invalidTakeRange(item.media_range, source.duration_ms)
    })
    if (invalid) { fail(`片段 ${invalid.item?.id} 的素材或源区间不可用，请修正后播放。`); return }
    setPlaybackSources(takes)
    onStart(); video.current?.pause(); elapsed.current = 0; setReady(false); setFinished(false); setError(''); setAttempt(value => value + 1); setPosition(0); setIndex(0); setRunning(true)
  }
  useEffect(() => {
    if (autoStart) startPlayback()
    // 章节显式播放才启用；父级以固定交付身份重新挂载，后续渲染不重启。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return <section aria-label={scope === 'seam' ? '接缝片段预览' : '整场时间线预览'}>
    <h3>{scope === 'seam' ? '接缝预览' : '整场预览'}</h3>
    <Space wrap>
      <Button disabled={!items.length} onClick={startPlayback}>{scope === 'seam' ? '播放接缝片段' : '播放整场时间线'}</Button>
      {segment && <Button disabled={!!error} onClick={() => setRunning(value => !value)}>{running ? `暂停${name}` : `继续${name}`}</Button>}
      {segment && <Button onClick={() => { video.current?.pause(); setRunning(false); setIndex(undefined); setPosition(0); elapsed.current = 0; setError('') }}>停止{name}</Button>}
    </Space>
    <p aria-label={`${name}播放位置`}>{position} / {total} 毫秒</p>
    {segment && (media ? <>
      <p>正在预览片段：{media.id} · 源区间 {media.media_range.source_in_ms}–{media.media_range.source_out_ms} 毫秒</p>
      <div aria-label={`${name}输出画面`} style={{ ...frameStyle, position: 'relative' }}>
      <video ref={video} key={`${index}:${attempt}`} aria-label={`${name}媒体`} playsInline preload="auto"
        src={segment.source?.media_url ? resolveAssetUrl(segment.source.media_url) : undefined} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0, objectFit: media.fit, objectPosition: 'center' }}
        onLoadedMetadata={event => {
          const node = event.currentTarget
          if (!Number.isFinite(node.duration) || node.duration * 1000 + 1 < media.media_range.source_out_ms) { fail('原素材实测时长不足，当前片段无法播放，请核对源区间。'); return }
          node.currentTime = media.media_range.source_in_ms / 1000
          if (media.media_range.source_in_ms === 0) setReady(true)
        }} onSeeked={() => setReady(true)} onEnded={advance}
        onError={() => fail(`片段 ${media.id} 无法读取或解码，播放已停止；可重试原片段。`)} />
      </div>
      {!ready && !error && <p>正在加载原片段，时间线等待媒体就绪。</p>}
    </> : <div aria-label={segment.item ? '时间线待拍占位' : '时间线黑场'} style={{ ...frameStyle, color: '#fff', display: 'grid', placeItems: 'center' }}>
      {segment.item ? `待拍占位 · 预计 ${segment.duration} 毫秒，不代表真实覆盖` : '空白 · 黑场静音'}
    </div>)}
    {error && <Alert type="error" message={error} action={media && <Button onClick={() => { setPlaybackSources(takes); setError(''); elapsed.current = 0; setPosition(segment!.start); setReady(false); setAttempt(value => value + 1); setRunning(true) }}>重试当前片段</Button>} />}
    {finished && <p>{name}播放完毕</p>}
    <p>按真实源区间播放原声；无音轨素材及时间线空白保持静音。编辑时间线或切换素材预览会停止本次播放。</p>
  </section>
}
