import type { CanvasResolvedOutput } from '../../../services/generated'
import { GenerationCardFrame } from './GenerationCardFrame'
import { MediaResultsPreview } from './MediaResultsPreview'
import { PlaybackCardPreview } from './PlaybackCardPreview'
import { TextCardPreview } from './TextCardPreview'

const modalityLabels = { text: '文本', image: '图片', video: '视频', audio: '音频' }

export const linkedResultTitle = (output: CanvasResolvedOutput) =>
  `${modalityLabels[output.modality]}生成结果 ${output.source.position + 1}`

/** 预览读取正式结果，不提供内容编辑或素材替换。 */
export function LinkedResultPreview({ output }: { output: CanvasResolvedOutput }) {
  const missing = output.available === false
  const status = <><span>随生成更新</span>{output.basis_current === false && <span>依据已变</span>}</>
  if (output.modality === 'text') return <TextCardPreview label="生成结果预览"
    text={missing ? '当前输出缺失' : output.text || ''}
    status={<>{!missing && <span>{output.text?.length || 0} 字</span>}{status}</>} />
  if (output.modality === 'audio' || output.modality === 'video') {
    const fileId = missing ? undefined : output.file_id ?? undefined
    return <PlaybackCardPreview key={fileId} type={output.modality} fileId={fileId} label="生成结果预览"
      status={status} empty="当前输出缺失" />
  }
  return <GenerationCardFrame label="生成结果预览" status={status}>
    {missing ? <p className="generation-output-text">当前输出缺失</p> : <MediaResultsPreview outputs={[output]} cardPreview />}
  </GenerationCardFrame>
}
