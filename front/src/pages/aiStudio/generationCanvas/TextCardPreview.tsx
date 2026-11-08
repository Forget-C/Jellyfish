import type { ReactNode } from 'react'
import { GenerationCardFrame } from './GenerationCardFrame'

/** 文本内容、描述与生成结果都把全文阅读留在详情。 */
export function TextCardPreview({ text, label, status }: { text: string; label: string; status: ReactNode }) {
  return <GenerationCardFrame label={label} status={status}>
    <div className="generation-output-text generation-text-card-preview"><p className="canvas-card-summary">{text}</p></div>
  </GenerationCardFrame>
}
