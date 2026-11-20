import { useState } from 'react'
import type { CanvasCheckProduct } from '../../../services/generated'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'
import { ImageContentReader } from './ImageContentReader'
import { PlaybackContent } from './MediaContentEditor'

const productLabels = { text: '文字', image: '图片', video: '视频' }
const statuses = { succeeded: '完整交付', failed: '生成失败 · 保留片段', cancelled: '生成取消 · 保留片段' }

export function historicalProductOptionLabel(product: CanvasCheckProduct) {
  return `${productLabels[product.modality ?? 'text']} · 修订 ${product.revision} · ${statuses[product.generation_status]} · 运行 ${product.run_id.slice(0, 8)} · 位置 ${product.position + 1}`
}

/** 报告只读取当时固定的产物，展开且可见时才加载媒体。 */
export function HistoricalCheckProduct({ product, active = true }: { product: CanvasCheckProduct; active?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  const modality = product.modality ?? 'text'
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>固定{productLabels[modality]}产物 · 原生成修订 {product.revision} · {statuses[product.generation_status]}</summary>
    <p>运行 {product.run_id} · 节点 {product.node_id} · 位置 {product.position + 1}</p>
    {product.result_set_id && <p>结果集 {product.result_set_id}</p>}
    {modality === 'text' && typeof product.text === 'string'
      ? <section aria-label="固定文字产物正文"><CanvasTextPreview text={product.text} label="固定文字产物" /></section>
      : modality !== 'text' && product.file_id ? <>
        <p>固定文件 {product.file_id}</p>
        {active && expanded && (modality === 'image'
          ? <ImageContentReader key={product.file_id} fileId={product.file_id} generatedResult />
          : <PlaybackContent key={product.file_id} fileId={product.file_id} type="video" />)}
      </> : <p role="status">固定历史产物暂不可用</p>}
  </details>
}
