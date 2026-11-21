import { useUiText } from '../../../uiText'
import type { CanvasResolvedOutput } from '../../../services/generated'
import { ImageContentReader } from './ImageContentReader'
import { PlaybackContent } from './MediaContentEditor'
import { TextContentEditor } from './TextContentEditor'

/** 只读投影直接读取正式输出，不接收画布文档写入回调。 */
export function LinkedResultReader({ id, output }: { id: string; output: CanvasResolvedOutput }) {
  const uiText = useUiText()
  if (output.available === false) return <p role="status">{uiText("当前输出缺失")}</p>
  if (output.modality === 'audio' || output.modality === 'video') return output.file_id
    ? <section aria-label={output.modality === 'audio' ? uiText("音频内容阅读") : uiText("视频内容阅读")}>
      <PlaybackContent key={output.file_id} fileId={output.file_id} type={output.modality} />
      <small>{uiText("生成结果")}</small>
    </section>
    : <p role="status">{uiText("当前输出缺失")}</p>
  if (output.modality === 'image') return output.file_id
    ? <ImageContentReader key={output.file_id} fileId={output.file_id} generatedResult />
    : <p role="status">{uiText("当前输出缺失")}</p>
  return <TextContentEditor card={{ id, type: 'content.text', text: output.text ?? undefined }} />
}
