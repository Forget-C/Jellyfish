import { useRef, useState } from 'react'
import { Alert } from 'antd'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { buildFileDownloadUrl } from '../assets/utils'

/** 仅预览并选定时间，调用方决定何时提取及如何采用。按文件身份重建。 */
export function VideoFramePicker({ fileId, disabled, onPosition, onUseTail }: {
  fileId: string
  disabled?: boolean
  onPosition: (atMs: number | undefined) => void
  onUseTail?: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [duration, setDuration] = useState(0)
  const [position, setPosition] = useState(0)
  const [error, setError] = useState(false)
  const update = (element: HTMLVideoElement) => {
    const atMs = Math.min(Math.max(0, Math.ceil(element.duration * 1000) - 1), Math.round(element.currentTime * 1000))
    if (Number.isFinite(atMs)) { setPosition(atMs); onPosition(atMs) }
  }
  const seek = (atMs: number) => {
    if (video.current) { video.current.pause(); video.current.currentTime = atMs / 1000 }
    setPosition(atMs); onPosition(atMs)
  }
  return <section aria-label="视频选帧">
    <video ref={video} aria-label="待选帧视频" controls playsInline preload="auto" src={buildFileDownloadUrl(fileId)}
      onLoadedMetadata={event => {
        const seconds = event.currentTarget.duration
        if (Number.isFinite(seconds) && seconds > 0) { setDuration(Math.ceil(seconds * 1000)); update(event.currentTarget) }
      }} onTimeUpdate={event => { if (!event.currentTarget.seeking) update(event.currentTarget) }}
      onSeeked={event => update(event.currentTarget)}
      onError={() => { setError(true); onPosition(undefined) }} style={{ display: 'block', width: '100%', maxHeight: 320 }} />
    {error && <Alert type="error" message="视频暂不可播放，无法选帧" />}
    <label>视频时间位置 <output>{(position / 1000).toFixed(3)} 秒</output>
      <input type="range" aria-label="视频时间位置" min={0} max={Math.max(0, duration - 1)} step={1} value={position}
        disabled={disabled || !duration || error} onChange={event => seek(Number(event.currentTarget.value))}
        style={{ display: 'block', width: '100%' }} />
    </label>
    {onUseTail && <Button disabled={disabled || !duration || error} onClick={() => {
      seek(duration - 1); onUseTail()
    }}>定位尾帧并用作首帧</Button>}
  </section>
}
