import { WorkbenchReadingContext } from './ui/WorkbenchReadingContext'
import { Button, Image } from 'antd'
import { useContext, useState } from 'react'
import type { ReferenceBinding_Input } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'

/** 按真实媒体类型预览固定参考，声音和视频不冒充参考图。 */
export function ReferencePreview({ reference }: { reference: ReferenceBinding_Input }) {
  const withinReader = useContext(WorkbenchReadingContext)
  const [expanded, setExpanded] = useState(false)
  const [failedFile, setFailedFile] = useState<string>()
  const src = buildFileDownloadUrl(reference.file_id)
  const onError = () => setFailedFile(reference.file_id)
  const media = reference.media_kind === 'video' ? <video controls preload="metadata" src={src} onError={onError} style={{ width: 200, maxWidth: '100%' }} aria-label={`视频参考 ${reference.ordinal + 1}`} /> : reference.media_kind === 'audio' ? <audio controls preload="metadata" src={src} onError={onError} style={{ maxWidth: '100%' }} aria-label={`声音参考 ${reference.ordinal + 1}`} /> : <Image preview={!withinReader} width={expanded ? '100%' : 96} src={src} onError={onError} alt={`参考图 ${reference.ordinal + 1}`} />
  return <>{media}{withinReader && reference.media_kind === 'image' && <Button onClick={() => setExpanded(value => !value)}>{expanded ? '收起参考图' : '展开参考图'}</Button>}{failedFile === reference.file_id && <p role="status" style={{ overflowWrap: 'anywhere' }}>参考 {reference.ordinal + 1} 读取失败；固定文件 {reference.file_id} 保留，请在拍摄准备核对文件。</p>}</>
}
