import { useState, type ReactNode } from 'react'
import { FileTextOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons'
import type { CanvasNodeRead, CanvasResolvedOutput } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { CardStatusSummary } from './CardStatusSummary'
import { MediaResultsPreview } from './MediaResultsPreview'
import './modelGenerationCard.css'

import { GenerationCardFrame } from './GenerationCardFrame'

/** 三类模型的只读展示：预览限于固定区域，状态独立靠底；所有画布交互仍由 CardShell 管理。 */
export function ModelGenerationCard({ card, node, outputs, readonly, action }: {
  card: GenerationCard; node?: CanvasNodeRead; outputs: CanvasResolvedOutput[]; readonly: boolean; action?: ReactNode
}) {
  const [imageActionHost, setImageActionHost] = useState<HTMLSpanElement | null>(null)
  const temporary = node?.status !== 'succeeded' ? node?.text : undefined
  const media = outputs.filter(output => output.file_id)
  const text = outputs.filter(output => output.text)
  // 节点总高扣除 32px 标题及 2px 边框，底部状态仍由公共骨架固定。
  return <GenerationCardFrame label="模型输出预览" status={<><CardStatusSummary card={card} node={node} outputs={outputs} readonly={readonly} missingImage={false} />{media.some(output => output.modality === 'image') && <span className="generation-model-image-action" ref={setImageActionHost} />}{action && <span className="generation-model-card-action">{action}</span>}</>}>
      {!outputs.length && !temporary && <div className="generation-model-empty">
        {card.type === 'model.image' ? <PictureOutlined aria-hidden /> : card.type === 'model.video' ? <VideoCameraOutlined aria-hidden /> : <FileTextOutlined aria-hidden />}
        <span>尚未生成</span>
      </div>}
      {media.length > 0 && <MediaResultsPreview outputs={media} showBasisStatus={false} cardPreview imageActionHost={imageActionHost} />}
      {(text.length > 0 || temporary) && <div className="generation-output-text">
        {text.map(output => <p key={output.source.position} className="canvas-card-summary">{output.text}</p>)}
        {temporary && <section aria-label="临时生成预览"><small>临时生成内容 · 未成为正式输出</small><p className="canvas-card-summary">{temporary}</p></section>}
      </div>}
  </GenerationCardFrame>
}
