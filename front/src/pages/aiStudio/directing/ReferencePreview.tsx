import { WorkbenchReadingContext } from './ui/WorkbenchReadingContext'
import { Button, Image } from 'antd'
import { useContext, useState } from 'react'
import type { CanvasReferencePreview, ReferenceBinding_Input } from '../../../services/generated'
import { buildFileDownloadUrl, resolveAssetUrl } from '../assets/utils'

/** 按真实媒体类型预览固定参考，声音和视频不冒充参考图。 */
export function ReferencePreview({ reference, preview }: { reference: ReferenceBinding_Input; preview?: CanvasReferencePreview }) {
  const withinReader = useContext(WorkbenchReadingContext)
  const [expanded, setExpanded] = useState(false)
  const [failedFile, setFailedFile] = useState<string>()
  const supplied = preview && (reference.media_kind === 'image' ? preview.thumbnail_url || preview.media_url : preview.media_url)
  const src = preview ? resolveAssetUrl(supplied) : buildFileDownloadUrl(reference.file_id)
  const onError = () => setFailedFile(src)
  if (preview && preview.status !== 'available') return <p role="status">{preview.display_name} · {({ deleted: '文件已删除', unavailable: '文件不可用或不属于当前项目', wrong_media_kind: '文件类型与绑定不一致' })[preview.status]}；固定绑定保留。</p>
  const media = reference.media_kind === 'video' ? <video controls preload="metadata" src={src} onError={onError} style={{ width: 200, maxWidth: '100%' }} aria-label={`视频参考 ${reference.ordinal + 1}`} /> : reference.media_kind === 'audio' ? <audio controls preload="metadata" src={src} onError={onError} style={{ maxWidth: '100%' }} aria-label={`声音参考 ${reference.ordinal + 1}`} /> : <Image preview={!withinReader} width={expanded ? '100%' : 96} src={src} onError={onError} alt={preview ? `参考素材：${preview.display_name}` : `参考图 ${reference.ordinal + 1}`} />
  return <>{preview?.preview_issue && <p role="status">{preview.preview_issue}</p>}{media}{withinReader && reference.media_kind === 'image' && <Button onClick={() => setExpanded(value => !value)}>{expanded ? '收起参考图' : '展开参考图'}</Button>}{!!src && failedFile === src && <p role="status" style={{ overflowWrap: 'anywhere' }}>参考 {reference.ordinal + 1} 读取失败；固定文件 {reference.file_id} 保留，请在拍摄准备核对文件。</p>}</>
}
