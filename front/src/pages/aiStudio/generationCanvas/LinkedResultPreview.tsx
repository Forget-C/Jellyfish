import type { CanvasResolvedOutput } from '../../../services/generated'
import { GenerationCardFrame } from './GenerationCardFrame'
import { MediaResultsPreview } from './MediaResultsPreview'

const modalityLabels = { text: '文本', image: '图片', video: '视频', audio: '音频' }

export const linkedResultTitle = (output: CanvasResolvedOutput) =>
  `${modalityLabels[output.modality]}生成结果 ${output.source.position + 1}`

/** 预览读取正式结果，不提供内容编辑或素材替换。 */
export function LinkedResultPreview({ output }: { output: CanvasResolvedOutput }) {
  return <GenerationCardFrame label="生成结果预览"
    status={<><span>随生成更新</span>{output.basis_current === false && <span>依据已变</span>}</>}>
    {output.available === false ? <p className="generation-output-text">当前输出缺失</p>
      : output.modality === 'text' ? <div className="generation-output-text generation-linked-text" tabIndex={0} onPointerDown={event => event.stopPropagation()}><p className="canvas-card-summary">{output.text}</p></div>
        : <MediaResultsPreview outputs={[output]} cardPreview />}
  </GenerationCardFrame>
}
