import { useEffect, useState } from 'react'
import { Alert, Select } from 'antd'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckProduct, CanvasCheckReportRead, CanvasPostCheckPreview } from '../../../services/generated'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'

const productLabels = { text: '文字', image: '图片', video: '视频' }
const observationLabels = { text: '文字模型检查', image: '图片模型检查', video_frame: '视频静帧检查' }
const statuses = { succeeded: '完整交付', failed: '生成失败 · 保留片段', cancelled: '生成取消 · 保留片段' }
const productKey = (product: CanvasCheckProduct) => `${product.node_id}:${product.position}`

export function HistoricalCheckProduct({ product }: { product: CanvasCheckProduct }) {
  return <details>
    <summary>固定{productLabels[product.modality ?? 'text']}产物 · 原生成修订 {product.revision} · {statuses[product.generation_status]}</summary>
    <p>运行 {product.run_id} · 节点 {product.node_id} · 位置 {product.position + 1}</p>
    {product.result_set_id && <p>结果集 {product.result_set_id}</p>}
    {product.file_id ? <p>固定文件 {product.file_id}</p> : <pre aria-label="固定文字产物正文">{product.text}</pre>}
  </details>
}

type Props = {
  projectId: string
  canvasId: string
  cardId: string
  savedRevision?: number
  active: boolean
  disabled: boolean
  reports: CanvasCheckReportRead[]
  onReport: (report: CanvasCheckReportRead) => void
}

/** Preview the chosen product before any provider work, with the call count visible. */
export function PostCheckPanel({ projectId, canvasId, cardId, savedRevision, active, disabled, reports, onReport }: Props) {
  const [products, setProducts] = useState<CanvasCheckProduct[]>()
  const [selected, setSelected] = useState<string>()
  const [preview, setPreview] = useState<CanvasPostCheckPreview>()
  const [refresh, setRefresh] = useState(0)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!active || savedRevision === undefined) return
    let current = true
    Canvases.canvasCheckProducts({ projectId, canvasId, cardId }).then(response => {
      if (!current) return
      const rows = response.data || []
      setProducts(rows)
      setSelected(previous => rows.some(row => productKey(row) === previous) ? previous : undefined)
    }).catch(() => {
      if (current) { setProducts(undefined); setError('读取历史产物失败') }
    })
    return () => { current = false }
  }, [projectId, canvasId, cardId, savedRevision, refresh, active])

  const product = products?.find(row => productKey(row) === selected)
  const runId = product?.run_id
  const nodeId = product?.node_id
  const position = product?.position
  useEffect(() => {
    if (!active || runId === undefined || nodeId === undefined || position === undefined) return
    let current = true
    Canvases.canvasPostCheckPreview({ projectId, canvasId, cardId, runId, nodeId, position }).then(response => {
      if (current) setPreview(response.data || undefined)
    }).catch(() => { if (current) setError('读取所选历史产物失败') })
    return () => { current = false }
  }, [projectId, canvasId, cardId, savedRevision, runId, nodeId, position, refresh, active])
  const fixed = preview && preview.revision === savedRevision && productKey(preview.product) === selected ? preview : undefined
  const alreadyChecked = reports.some(report => report.product && productKey(report.product) === selected)
  const submit = async (itemId?: string) => {
    if (disabled || running || !fixed) return
    setRunning(true)
    setError('')
    try {
      const { run_id: selectedRun, node_id: selectedNode, position: selectedPosition } = fixed.product
      const response = await Canvases.canvasPostCheckRun({ projectId, canvasId, cardId, runId: selectedRun, nodeId: selectedNode,
        position: selectedPosition, requestBody: { expected_revision: fixed.revision, basis_hash: fixed.basis.basis_hash,
          expected_calls: itemId ? 1 : fixed.estimated_calls, item_id: itemId } })
      if (response.data) onReport(response.data)
    } catch (issue) {
      setError(issue instanceof ApiError && issue.status === 409 ? '检查依据或预计调用已变化，请重新确认' : '历史产物检查未受理')
      setPreview(undefined)
      setRefresh(value => value + 1)
    } finally {
      setRunning(false)
    }
  }

  return <section className="generation-check-category" aria-label="生成后检查">
    <p>手动选择一个历史产物，按其原生成依据检查。</p>
    {error && <Alert type="warning" showIcon message={error} />}
    <label>历史产物
      <Select aria-label="历史产物" placeholder="请选择要检查的具体产物" value={selected} allowClear
        disabled={disabled || running} onChange={value => { setSelected(value); setPreview(undefined); setError('') }}
        options={products?.map(row => ({ value: productKey(row),
          label: `${productLabels[row.modality ?? 'text']} · 修订 ${row.revision} · ${statuses[row.generation_status]} · 运行 ${row.run_id.slice(0, 8)} · 位置 ${row.position + 1}` }))} />
    </label>
    <Button size="small" variant="quiet" disabled={disabled || running}
      onClick={() => { setPreview(undefined); setError(''); setRefresh(value => value + 1) }}>刷新历史产物</Button>
    {products?.length === 0 && <p>暂无此生成目标的历史产物</p>}
    {selected && !fixed && !error && <p role="status">正在读取所选产物</p>}
    {fixed && <>
      <HistoricalCheckProduct product={fixed.product} />
      <p>产物 1 份 · {observationLabels[fixed.observation_method ?? 'text']} · 预计调用 {fixed.estimated_calls} 次</p>
      {fixed.observation_method === 'video_frame' && <p>只观察实际解码的静帧。其他时刻、动作过程和音轨未核验。</p>}
      {fixed.reason && <p>{fixed.reason}</p>}
      {fixed.items.map(item => <div className="generation-check-item" key={item.id}>
        <p>{item.label} · 来源 {item.source.card_id}/{item.field_id} · {item.requirement}</p>
        {item.availability !== 'ready' && <p>无法判断 · {item.reason}</p>}
        <Button size="small" disabled={disabled || running || item.availability !== 'ready'}
          onClick={() => void submit(item.id)}>{alreadyChecked ? '重新检查此项' : '检查此项'}</Button>
      </div>)}
      <Button variant="primary" disabled={disabled || running} loading={running} onClick={() => void submit()}>
        {fixed.estimated_calls ? alreadyChecked ? '重新检查所选产物' : '检查所选产物' : '记录未执行原因'}
      </Button>
    </>}
  </section>
}
