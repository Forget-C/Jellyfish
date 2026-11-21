import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Space } from 'antd'
import { ExpandOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { buildFileDownloadUrl } from '../assets/utils'
import type { CanvasResolvedOutput } from '../../../services/generated'
import { ImageCardPreview } from './ImageContentCardSummary'
import { MediaPreview } from './MediaContentEditor'

/** 预览选择仅保留本地状态；卡面可将完整图片按钮放到独立的底栏容器。 */
export function MediaResultsPreview({ outputs, showBasisStatus = true, cardPreview = false, imageActionHost }: { outputs: CanvasResolvedOutput[]; showBasisStatus?: boolean; cardPreview?: boolean; imageActionHost?: HTMLElement | null }) {
  const uiText = useUiText()
  const [position, setPosition] = useState(0)
  const [fullImage, setFullImage] = useState(false)
  const selectedIndex = Math.min(position, outputs.length - 1)
  const selected = outputs[selectedIndex]
  if (!selected?.file_id) return null
  const fullImageAction = <WorkbenchIconButton label={uiText("打开完整图片")} icon={<ExpandOutlined />} variant="quiet" onClick={() => setFullImage(true)} />
  if (cardPreview && selected.modality === 'image') return <section className="generation-image-result" aria-label={uiText("媒体成果预览")}>
    <ImageCardPreview fileId={selected.file_id} />
    <div className="generation-image-result-actions">
      {outputs.length > 1 && <div className="generation-image-result-switch" aria-label={uiText("图片结果选择")}><WorkbenchIconButton label={uiText("预览上一张图片")} icon={<LeftOutlined />} variant="quiet" disabled={selectedIndex === 0} onClick={() => setPosition(selectedIndex - 1)} /><span>{selectedIndex + 1} / {outputs.length}</span><WorkbenchIconButton label={uiText("预览下一张图片")} icon={<RightOutlined />} variant="quiet" disabled={selectedIndex === outputs.length - 1} onClick={() => setPosition(selectedIndex + 1)} /></div>}
      {!imageActionHost && fullImageAction}
    </div>
    {imageActionHost && createPortal(fullImageAction, imageActionHost)}
    <div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <WorkbenchModal title={uiText("图片预览")} open={fullImage} onCancel={() => setFullImage(false)} footer={null}>
        <img alt={uiText("完整图片")} src={buildFileDownloadUrl(selected.file_id)} style={{ display: 'block', maxWidth: '100%', maxHeight: '65dvh', margin: 'auto', objectFit: 'contain' }} />
      </WorkbenchModal>
    </div>
  </section>
  if (cardPreview) return <section className="generation-video-result" aria-label={uiText("媒体成果预览")}>
    <MediaPreview fileId={selected.file_id} type={selected.modality} />
    {outputs.length > 1 && <Space className="generation-video-result-switch" wrap>{outputs.map((output, index) => <Button key={output.source.position} aria-label={uiText("预览输出 {{value1}}", { value1: index + 1 })} aria-pressed={output === selected} onClick={() => setPosition(index)}>{index + 1}</Button>)}</Space>}
  </section>
  return <section aria-label={uiText("媒体成果预览")}>
    <Space wrap>{outputs.map((output, index) => <Button key={output.source.position} aria-label={uiText("预览输出 {{value1}}", { value1: index + 1 })}
      aria-pressed={output === selected} onClick={() => setPosition(index)}>{index + 1}</Button>)}</Space>
    <p>{uiText("输出")} {selected.source.position + 1} / {outputs.length}</p>
    <MediaPreview fileId={selected.file_id} type={selected.modality} />
    {showBasisStatus && selected.basis_current === false && <small>{uiText("依据已变，旧正式输出仍保留")}</small>}
  </section>
}
