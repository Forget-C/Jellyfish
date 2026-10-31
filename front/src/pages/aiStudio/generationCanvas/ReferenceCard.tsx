import { PictureOutlined } from '@ant-design/icons'
import type { ReactNode } from 'react'
import type { NamedImageReferenceCard } from '../../../services/generated'
import { buildFileDownloadUrl } from '../assets/utils'
import { GenerationCardFrame } from './GenerationCardFrame'
import { ReferenceCardSummary } from './ReferenceCardSummary'
import { CardComposer } from './CardComposer'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import './referenceCard.css'

/** 四类参考卡共用显示基础；摘要展示本卡名称及角度，图片独立固定。 */
export function ReferenceCard({ card, readonly, error }: {
  card: NamedImageReferenceCard; readonly: boolean; error?: string
}) {
  return <GenerationCardFrame label="参考图片预览" status={<>{readonly && <span>只读</span>}<ReferenceCardSummary card={card} /><span>{error || (card.image_binding ? '1 张参考图' : '缺少主图')}</span></>}>
    <div className="generation-reference-preview">{card.image_binding ? <img alt="参考图片" src={buildFileDownloadUrl(card.image_binding.file_id)} /> : <div><PictureOutlined aria-hidden /><span>未选择参考图</span></div>}</div>
  </GenerationCardFrame>
}

/** 四类参考编辑器共用顶部参数、图片内容和固定状态；沿用模型编辑容器与公共骨架。 */
export function ReferenceCardEditor({ parameters, children, status }: { parameters: ReactNode; children: ReactNode; status: ReactNode }) {
  return <div className="generation-reference-editor"><CardComposer parametersPosition="top" parameters={parameters} status={status}>{children}</CardComposer></div>
}

/** 四类参考共用画布选择空态，不导入文件或承担素材库操作。 */
export function ReferenceImagePlaceholder({ onChoose, disabled }: { onChoose: () => void; disabled?: boolean }) {
  return <WorkbenchButton variant="quiet" className="generation-reference-empty" disabled={disabled} onClick={onChoose} onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'none' }} onDrop={event => event.preventDefault()} aria-label="从当前画布选择">
    <span className="generation-reference-empty-icon"><PictureOutlined aria-hidden /></span>
    <strong>从当前画布选择</strong>
    <small>选择图片内容卡作为参考图</small>
  </WorkbenchButton>
}
