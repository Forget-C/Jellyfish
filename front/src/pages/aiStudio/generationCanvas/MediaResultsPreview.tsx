import { useState } from 'react'
import { Button, Space } from 'antd'
import { ExpandOutlined, LeftOutlined, RightOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { WorkbenchModal } from '../directing/ui/WorkbenchModal'
import { buildFileDownloadUrl } from '../assets/utils'
import type { CanvasResolvedOutput } from '../../../services/generated'
import { MediaPreview } from './MediaContentEditor'

/** Preview selection is local display state; the complete ordered output stays published. */
export function MediaResultsPreview({ outputs, showBasisStatus = true, cardPreview = false }: { outputs: CanvasResolvedOutput[]; showBasisStatus?: boolean; cardPreview?: boolean }) {
  const [position, setPosition] = useState(0)
  const [fullImage, setFullImage] = useState(false)
  const selectedIndex = Math.min(position, outputs.length - 1)
  const selected = outputs[selectedIndex]
  if (!selected?.file_id) return null
  if (cardPreview && selected.modality === 'image') return <section className="generation-image-result" aria-label="媒体成果预览">
    <img alt="图片预览" src={buildFileDownloadUrl(selected.file_id)} />
    <div className="generation-image-result-actions">
      {outputs.length > 1 && <div className="generation-image-result-switch" aria-label="图片结果选择"><WorkbenchIconButton label="预览上一张图片" icon={<LeftOutlined />} variant="quiet" disabled={selectedIndex === 0} onClick={() => setPosition(selectedIndex - 1)} /><span>{selectedIndex + 1} / {outputs.length}</span><WorkbenchIconButton label="预览下一张图片" icon={<RightOutlined />} variant="quiet" disabled={selectedIndex === outputs.length - 1} onClick={() => setPosition(selectedIndex + 1)} /></div>}
      <WorkbenchIconButton label="打开完整图片" icon={<ExpandOutlined />} variant="quiet" onClick={() => setFullImage(true)} />
    </div>
    <div onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}>
      <WorkbenchModal title="图片预览" open={fullImage} onCancel={() => setFullImage(false)} footer={null}>
        <img alt="完整图片" src={buildFileDownloadUrl(selected.file_id)} style={{ display: 'block', maxWidth: '100%', maxHeight: '65dvh', margin: 'auto', objectFit: 'contain' }} />
      </WorkbenchModal>
    </div>
  </section>
  if (cardPreview) return <section className="generation-video-result" aria-label="媒体成果预览">
    <MediaPreview fileId={selected.file_id} type={selected.modality} />
    {outputs.length > 1 && <Space className="generation-video-result-switch" wrap>{outputs.map((output, index) => <Button key={output.source.position} aria-label={`预览输出 ${index + 1}`} aria-pressed={output === selected} onClick={() => setPosition(index)}>{index + 1}</Button>)}</Space>}
  </section>
  return <section aria-label="媒体成果预览">
    <Space wrap>{outputs.map((output, index) => <Button key={output.source.position} aria-label={`预览输出 ${index + 1}`}
      aria-pressed={output === selected} onClick={() => setPosition(index)}>{index + 1}</Button>)}</Space>
    <p>输出 {selected.source.position + 1} / {outputs.length}</p>
    <MediaPreview fileId={selected.file_id} type={selected.modality} />
    {showBasisStatus && selected.basis_current === false && <small>依据已变，旧正式输出仍保留</small>}
  </section>
}
