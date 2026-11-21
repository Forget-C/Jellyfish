import { useUiText } from '../../../uiText'
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { StudioFilesService } from '../../../services/generated'
import { GenerationCardFrame } from './GenerationCardFrame'
import { PlaybackContent } from './MediaContentEditor'

/** 音视频内容与结果卡共用播放区，外层以文件身份隔离时长与文件名。 */
export function PlaybackCardPreview({ type, fileId, label, status, empty = '未选择媒体' }: {
  type: 'audio' | 'video'; fileId?: string; label: string; status: ReactNode; empty?: string
}) {
  const uiText = useUiText()
  const [name, setName] = useState<string>()
  const [duration, setDuration] = useState<number>()
  useEffect(() => {
    if (type !== 'audio' || !fileId) return
    let active = true
    StudioFilesService.getFileDetailApiV1StudioFilesFileIdGet({ fileId }).then(response => {
      if (active) setName(response.data?.name)
    }).catch(() => {})
    return () => { active = false }
  }, [fileId, type])

  return <GenerationCardFrame label={label} status={<>
    {type === 'audio' && duration !== undefined && <span>{Number(duration.toFixed(1))} {uiText("秒")}</span>}
    {status}
  </>}>
    <div className="generation-playback-card-preview">
      {name && <small title={name}>{name}</small>}
      {fileId ? <PlaybackContent fileId={fileId} type={type} onDuration={setDuration} /> : <p>{empty}</p>}
    </div>
  </GenerationCardFrame>
}
