import { useEffect, useRef, useState } from 'react'
import { Alert, Button } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { MediaRead } from '../../../services/generated'
import { resolveAssetUrl } from '../assets/utils'
import { directingError } from './common'

/** 候选播放仅使用服务端核对归属后的地址；播放失败不更换或采用其他素材。 */
export function SceneTakePreview({ projectId, sequenceId, versionId, unitId, takeId, number }: {
  projectId: string; sequenceId: string; versionId: string; unitId: string; takeId: string; number: number
}) {
  const [media, setMedia] = useState<MediaRead>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const read = async () => {
    setBusy(true); setError(''); setMedia(undefined)
    try {
      const response = await StudioDirectingService.directingSceneTakeMedia({ projectId, sequenceId, versionId, unitId, takeId })
      if (!response.data) throw new Error('候选媒体尚未核实')
      if (mounted.current) { setMedia(response.data); setAttempt(value => value + 1) }
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  return <div>
    <Button loading={busy} onClick={() => void read()}>{error ? `重试候选视频 ${number}` : `查看候选视频 ${number}`}</Button>
    {error && <Alert type="warning" message="候选视频读取失败" description={error} />}
    {media && <>
      <p>{media.duration_ms == null ? '实际媒体时长尚未核实' : `实际媒体时长：${media.duration_ms / 1000} 秒`}</p>
      <video key={attempt} controls preload="metadata" aria-label={`候选视频 ${number}`} src={resolveAssetUrl(media.url)}
        style={{ width: '100%', maxHeight: 360 }} onError={() => setError('原候选媒体无法加载或解码，请重试核实；素材身份保留。')} />
    </>}
  </div>
}
