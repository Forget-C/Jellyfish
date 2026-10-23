import { useState } from 'react'
import { Button, Space } from 'antd'
import type { CanvasResolvedOutput } from '../../../services/generated'
import { MediaPreview } from './MediaContentEditor'

/** Preview selection is local display state; the complete ordered output stays published. */
export function MediaResultsPreview({ outputs }: { outputs: CanvasResolvedOutput[] }) {
  const [position, setPosition] = useState(0)
  const selected = outputs[Math.min(position, outputs.length - 1)]
  if (!selected?.file_id) return null
  return <section aria-label="媒体成果预览">
    <Space wrap>{outputs.map((output, index) => <Button key={output.source.position} aria-label={`预览输出 ${index + 1}`}
      aria-pressed={output === selected} onClick={() => setPosition(index)}>{index + 1}</Button>)}</Space>
    <p>输出 {selected.source.position + 1} / {outputs.length}</p>
    <MediaPreview fileId={selected.file_id} type={selected.modality} />
    {selected.basis_current === false && <small>依据已变，旧正式输出仍保留</small>}
  </section>
}
