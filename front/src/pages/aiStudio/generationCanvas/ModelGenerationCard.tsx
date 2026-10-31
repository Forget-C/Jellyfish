import { FileTextOutlined, PictureOutlined, VideoCameraOutlined } from '@ant-design/icons'
import type { CanvasNodeRead, CanvasResolvedOutput } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { CardStatusSummary } from './CardStatusSummary'
import { MediaResultsPreview } from './MediaResultsPreview'
import './modelGenerationCard.css'

const previewHeight = 185
const statusHeight = 32
/** 沿用图片模型卡：300 宽，185 预览＋32 状态＋2 边框＋32 标题；缓存和连线共用此几何。 */
export const MODEL_CARD_SIZE = { width: 300, height: previewHeight + statusHeight + 2 + 32 }

/** 三类模型的只读展示：预览限于固定区域，状态独立靠底；所有画布交互仍由 CardShell 管理。 */
export function ModelGenerationCard({ card, node, outputs, readonly }: {
  card: GenerationCard; node?: CanvasNodeRead; outputs: CanvasResolvedOutput[]; readonly: boolean
}) {
  const temporary = node?.status !== 'succeeded' ? node?.text : undefined
  const media = outputs.filter(output => output.file_id)
  const text = outputs.filter(output => output.text)
  return <div className="generation-model-card" style={{ height: previewHeight + statusHeight }}>
    <section className="generation-model-preview" aria-label="模型输出预览">
      {!outputs.length && !temporary && <div className="generation-model-empty">
        {card.type === 'model.image' ? <PictureOutlined aria-hidden /> : card.type === 'model.video' ? <VideoCameraOutlined aria-hidden /> : <FileTextOutlined aria-hidden />}
        <span>尚未生成</span>
      </div>}
      {media.length > 0 && <MediaResultsPreview outputs={media} showBasisStatus={false} cardPreview />}
      {(text.length > 0 || temporary) && <div className="generation-model-text">
        {text.map(output => <p key={output.source.position} className="canvas-card-summary">{output.text}</p>)}
        {temporary && <section aria-label="临时生成预览"><small>临时生成内容 · 未成为正式输出</small><p className="canvas-card-summary">{temporary}</p></section>}
      </div>}
    </section>
    <footer className="generation-card-footer" style={{ height: statusHeight }}>
      <CardStatusSummary card={card} node={node} outputs={outputs} readonly={readonly} missingImage={false} />
    </footer>
  </div>
}
