import { useUiText } from '../../../uiText'
import { useState } from 'react'
import type { CSSProperties, ReactEventHandler } from 'react'
import { PictureOutlined } from '@ant-design/icons'
import type { ImageContentCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { CardStatusSummary } from './CardStatusSummary'
import { GenerationCardFrame } from './GenerationCardFrame'

/** 基础图片和生成图片均从同一文件下载接口完整预览。 */
export function ImageCardPreview({ fileId, onLoad, style }: {
  fileId: string; onLoad?: ReactEventHandler<HTMLImageElement>; style?: CSSProperties
}) {
  const uiText = useUiText()
  const [failedFile, setFailedFile] = useState<string>()
  if (failedFile === fileId) return <div className="generation-basic-image-empty" role="status">
    <PictureOutlined aria-hidden /><span>{uiText("图片暂不可预览")}</span>
  </div>
  return <img className="generation-basic-image-preview" alt={uiText("图片预览")} src={buildFileDownloadUrl(fileId)}
    style={style} onLoad={onLoad} onError={() => setFailedFile(fileId)} />
}

/** 卡面在固定区域完整等比预览；尺寸仍取自原图，不改写文件或发布输出。 */
export function ImageContentCardSummary({ card, readonly }: { card: ImageContentCard; readonly: boolean }) {
  const uiText = useUiText()
  const [size, setSize] = useState<{ fileId: string; width: number; height: number }>()
  const dimensions = size && size.fileId === card.file_id ? `${size.width} × ${size.height}` : undefined
  return <GenerationCardFrame label={uiText("图片内容预览")} status={<CardStatusSummary card={card} outputs={[]} readonly={readonly} missingImage={false} imageDimensions={dimensions} />}>
    {card.file_id ? <ImageCardPreview key={card.file_id} fileId={card.file_id} onLoad={event => {
      const image = event.currentTarget
      setSize({ fileId: card.file_id!, width: image.naturalWidth, height: image.naturalHeight })
    }} /> : <div className="generation-basic-image-empty"><PictureOutlined aria-hidden /><span>{uiText("尚未选择图片")}</span></div>}
  </GenerationCardFrame>
}
