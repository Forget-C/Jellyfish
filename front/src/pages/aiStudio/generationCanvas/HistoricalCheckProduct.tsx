import { uiText, useUiText } from '../../../uiText'
import { useState } from 'react'
import type { CanvasCheckProduct } from '../../../services/generated'
import { CanvasTextPreview } from '../../../components/workbench/CanvasTextPreview'
import { ImageContentReader } from './ImageContentReader'
import { PlaybackContent } from './MediaContentEditor'

const productLabels = { text: '文字', image: '图片', video: '视频' }
const statuses = { succeeded: '完整交付', failed: '生成失败 · 保留片段', cancelled: '生成取消 · 保留片段' }

export function historicalProductOptionLabel(product: CanvasCheckProduct) {
  return uiText("{{value1}} · 修订 {{revision}} · {{value3}} · 运行 {{value4}} · 位置 {{value5}}", { value1: uiText(productLabels[product.modality ?? 'text']), revision: product.revision, value3: uiText(statuses[product.generation_status]), value4: product.run_id.slice(0, 8), value5: product.position + 1 })
}

/** 报告只读取当时固定的产物，展开且可见时才加载媒体。 */
export function HistoricalCheckProduct({ product, active = true }: { product: CanvasCheckProduct; active?: boolean }) {
  useUiText()
  const [expanded, setExpanded] = useState(false)
  const modality = product.modality ?? 'text'
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>{uiText("固定")}{uiText(productLabels[modality])}{uiText("产物 · 原生成修订")} {product.revision} · {uiText(statuses[product.generation_status])}</summary>
    <p>{uiText("运行")} {product.run_id} {uiText("· 节点")} {product.node_id} {uiText("· 位置")} {product.position + 1}</p>
    {product.result_set_id && <p>{uiText("结果集")} {product.result_set_id}</p>}
    {modality === 'text' && typeof product.text === 'string'
      ? <section aria-label={uiText("固定文字产物正文")}><CanvasTextPreview text={product.text} label={uiText("固定文字产物")} /></section>
      : modality !== 'text' && product.file_id ? <>
        <p>{uiText("固定文件")} {product.file_id}</p>
        {active && expanded && (modality === 'image'
          ? <ImageContentReader key={product.file_id} fileId={product.file_id} generatedResult />
          : <PlaybackContent key={product.file_id} fileId={product.file_id} type="video" />)}
      </> : <p role="status">{uiText("固定历史产物暂不可用")}</p>}
  </details>
}
