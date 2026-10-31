import { PictureOutlined, UploadOutlined } from '@ant-design/icons'
import { useState } from 'react'
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

/** 参考图空态共用拖放与可聚焦浏览入口；文件校验和上传仍交给既有媒体流程。 */
export function ReferenceImageUpload({ onBrowse, onUpload, disabled, uploading, sources }: {
  onBrowse: () => void; onUpload: (file: File) => void; disabled?: boolean; uploading: boolean; sources: ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  return <div className="generation-reference-upload" data-dragging={dragging && !disabled && !uploading}
    onDragOver={event => { event.preventDefault(); event.stopPropagation(); if (!disabled && !uploading) setDragging(true) }}
    onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false) }}
    onDrop={event => { event.preventDefault(); event.stopPropagation(); setDragging(false); const file = event.dataTransfer.files[0]; if (file && !disabled && !uploading) onUpload(file) }}>
    <WorkbenchButton variant="quiet" className="generation-reference-upload-target" disabled={disabled || uploading} onClick={onBrowse} aria-label="浏览并上传参考图">
      <span className="generation-reference-upload-icon"><UploadOutlined aria-hidden /></span>
      <strong>{uploading ? '正在上传参考图…' : '拖拽图片到此处，或浏览文件'}</strong>
      <small>{disabled ? '只读，无法上传图片' : '支持图片文件'}</small>
    </WorkbenchButton>
    <div className="generation-reference-upload-sources">{sources}</div>
  </div>
}
