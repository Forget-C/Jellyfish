import type { CanvasResolvedOutput } from '../../../services/generated'
import { ImageContentReader } from './ImageContentReader'
import { TextContentEditor } from './TextContentEditor'

export function canReadLinkedResult(output: CanvasResolvedOutput) {
  return output.modality === 'text' || output.modality === 'image'
}

/** 只读投影直接读取正式输出，不接收画布文档写入回调。 */
export function LinkedResultReader({ id, output }: { id: string; output: CanvasResolvedOutput }) {
  if (output.available === false) return <p role="status">当前输出缺失</p>
  if (output.modality === 'image') return output.file_id
    ? <ImageContentReader key={output.file_id} fileId={output.file_id} generatedResult />
    : <p role="status">当前输出缺失</p>
  return <TextContentEditor card={{ id, type: 'content.text', text: output.text ?? undefined }} />
}
