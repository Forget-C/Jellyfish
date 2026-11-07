import { useState } from 'react'
import { PictureOutlined } from '@ant-design/icons'
import type { ImageContentCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { CardStatusSummary } from './CardStatusSummary'
import { GenerationCardFrame } from './GenerationCardFrame'

/** 卡面在固定区域完整等比预览；尺寸仍取自原图，不改写文件或发布输出。 */
export function ImageContentCardSummary({ card, readonly }: { card: ImageContentCard; readonly: boolean }) {
  const [size, setSize] = useState<{ fileId: string; width: number; height: number }>()
  const dimensions = size && size.fileId === card.file_id ? `${size.width} × ${size.height}` : undefined
  return <GenerationCardFrame label="图片内容预览" status={<CardStatusSummary card={card} outputs={[]} readonly={readonly} missingImage={false} imageDimensions={dimensions} />}>
    {card.file_id ? <img className="generation-basic-image-preview" alt="图片预览" src={buildFileDownloadUrl(card.file_id)} onLoad={event => {
      const image = event.currentTarget
      setSize({ fileId: card.file_id!, width: image.naturalWidth, height: image.naturalHeight })
    }} /> : <div className="generation-basic-image-empty"><PictureOutlined aria-hidden /><span>尚未选择图片</span></div>}
  </GenerationCardFrame>
}
