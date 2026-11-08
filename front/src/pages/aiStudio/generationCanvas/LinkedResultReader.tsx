import type { CanvasResolvedOutput } from '../../../services/generated'
import { TextContentEditor } from './TextContentEditor'

export function canReadLinkedResult(output: CanvasResolvedOutput) {
  return output.modality === 'text'
}

/** 只读投影直接读取正式输出，不接收画布文档写入回调。 */
export function LinkedResultReader({ id, output }: { id: string; output: CanvasResolvedOutput }) {
  if (output.available === false) return <p role="status">当前输出缺失</p>
  return <TextContentEditor card={{ id, type: 'content.text', text: output.text ?? undefined }} />
}
