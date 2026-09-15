import { Image } from 'antd'
import type { ReferenceBinding_Input } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'

/** 按真实媒体类型预览固定参考，声音和视频不冒充参考图。 */
export function ReferencePreview({ reference }: { reference: ReferenceBinding_Input }) {
  const src = buildFileDownloadUrl(reference.file_id)
  if (reference.media_kind === 'video') return <video controls preload="metadata" src={src} style={{ width: 200, maxWidth: '100%' }} aria-label={`视频参考 ${reference.ordinal + 1}`} />
  if (reference.media_kind === 'audio') return <audio controls preload="metadata" src={src} style={{ maxWidth: '100%' }} aria-label={`声音参考 ${reference.ordinal + 1}`} />
  return <Image width={96} src={src} alt={`参考图 ${reference.ordinal + 1}`} />
}
