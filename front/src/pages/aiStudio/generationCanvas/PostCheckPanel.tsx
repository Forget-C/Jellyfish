import { createPortal } from 'react-dom'
import { CanvasEditorFooter } from './CanvasCardEditor'
import { CheckReportDetails } from './CheckReportDetails'
import { reportPending } from './CheckCardSession'
import { useContext, useEffect, useRef, useState } from 'react'
import { Alert, Switch, Select } from 'antd'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckProduct, CanvasCheckReportRead, CanvasPostCheckPreview, CheckCard } from '../../../services/generated'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'

const postCategories = [
  { id: 'R01', label: '明确内容与结果落实' },
  { id: 'R02', label: '对象与外观落实' },
  { id: 'R03', label: '静态摄影与风格落实' },
  { id: 'R04', label: '表演、行动与调度落实' },
  { id: 'R05', label: '运镜过程与落幅落实' },
  { id: 'R06', label: '片段内连续性落实' },
]
const productLabels = { text: '文字', image: '图片', video: '视频' }
const observationLabels = {
  text: '文字模型检查', image: '图片模型检查', video_frame: '视频静帧检查',
  video_sequence: '视频序列检查', video_mixed: '视频序列与静帧检查',
}
const statuses = { succeeded: '完整交付', failed: '生成失败 · 保留片段', cancelled: '生成取消 · 保留片段' }
const productKey = (product: CanvasCheckProduct) => `${product.node_id}:${product.position}`

export function HistoricalCheckProduct({ product }: { product: CanvasCheckProduct }) {
  return <details>
    <summary>固定{productLabels[product.modality ?? 'text']}产物 · 原生成修订 {product.revision} · {statuses[product.generation_status]}</summary>
    <p>运行 {product.run_id} · 节点 {product.node_id} · 位置 {product.position + 1}</p>
    {product.result_set_id && <p>结果集 {product.result_set_id}</p>}
    {product.file_id ? <p>固定文件 {product.file_id}</p> : <section aria-label="固定文字产物正文"><CanvasTextPreview text={product.text || ''} label="固定文字产物" /></section>}
  </details>
}

type Props = {
  projectId: string
  canvasId: string
  cardId: string
  savedRevision?: number
  active: boolean
  disabled: boolean
  card: CheckCard
  updateCard: (card: CheckCard) => void
  configDisabled: boolean
  automaticCheckRunId?: string
  onRefreshReports: () => void
  automaticWaitExpired: boolean
  targetReportId?: string
  targetSerial?: number
  onOpenReport: (id: string) => void
  onCancel: (id: string) => Promise<void>
  cancelling: boolean
  reports: CanvasCheckReportRead[]
  onReport: (report: CanvasCheckReportRead) => void
}

/** Preview the chosen product before any provider work, with the call count visible. */
export function PostCheckPanel({ projectId, canvasId, cardId, savedRevision, active, disabled, reports, onReport, card, updateCard, configDisabled, automaticCheckRunId, onRefreshReports, automaticWaitExpired, targetReportId, targetSerial, onOpenReport, onCancel, cancelling }: Props) {
  const footer = useContext(CanvasEditorFooter)
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
  }, [projectId, canvasId, cardId, savedRevision, refresh, active, automaticCheckRunId])

  const handledTarget = useRef<number>()
  useEffect(() => {
    if (!targetReportId || handledTarget.current === targetSerial || !products) return
    const report = reports.find(row => row.id === targetReportId)
    if (report?.product) { setSelected(productKey(report.product)); handledTarget.current = targetSerial }
  }, [targetReportId, targetSerial, reports, products])
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

  const report = reports.find(row => row.product && productKey(row.product) === selected)
  const pending = reports.find(row => row.product && productKey(row.product) === selected && reportPending(row))
  const selectedCategories = card.post_check_categories ?? postCategories.map(item => item.id)
  return <section className="generation-check-page generation-check-report" aria-label="生成后检查">
    <label className="generation-check-category-toggle">完整交付后自动检查<Switch aria-label="完整交付后自动检查" checked={!!card.auto_post_check} disabled={configDisabled || running}
      onChange={checked => updateCard({ ...card, auto_post_check: checked })} /></label>
    {automaticWaitExpired && <p role="status">自动检查报告尚未到达，请刷新历史产物和报告。此状态不代表检查已完成。</p>}
    <p>自动检查仅适用于启用后提交且完整交付的生成。项目范围用于整份产物检查和自动检查。</p>
    <fieldset className="generation-check-post-scope" aria-label="生成后检查项目范围">{postCategories.map(category => <label key={category.id}>{category.label}<Switch size="small" aria-label={category.label} checked={selectedCategories.includes(category.id)} disabled={configDisabled || running}
      onChange={checked => updateCard({ ...card, post_check_categories: checked ? [...new Set([...selectedCategories, category.id])] : selectedCategories.filter(id => id !== category.id) })} /></label>)}</fieldset>
    <p>手动选择一个历史产物，按其原生成依据检查。</p>
    {error && <Alert type="warning" showIcon message={error} />}
    <label>历史产物
      <Select aria-label="历史产物" placeholder="请选择要检查的具体产物" value={selected} allowClear
        disabled={running} onChange={value => { setSelected(value); setPreview(undefined); setError('') }}
        options={products?.map(row => ({ value: productKey(row),
          label: `${productLabels[row.modality ?? 'text']} · 修订 ${row.revision} · ${statuses[row.generation_status]} · 运行 ${row.run_id.slice(0, 8)} · 位置 ${row.position + 1}` }))} />
    </label>
    <Button size="small" variant="quiet" disabled={running}
      onClick={() => { setPreview(undefined); setError(''); setRefresh(value => value + 1); onRefreshReports() }}>刷新历史产物和报告</Button>
    {products?.length === 0 && <p>暂无此生成目标的历史产物</p>}
    {selected && !fixed && !error && <p role="status">正在读取所选产物</p>}
    {fixed && <>
      <HistoricalCheckProduct product={fixed.product} />
      <p>产物 1 份 · {observationLabels[fixed.observation_method ?? 'text']} · 预计调用 {fixed.estimated_calls} 次</p>
      {fixed.observation_method === 'video_frame' && <p>只观察实际解码的静帧。其他时刻、动作过程和音轨未核验。</p>}
      {(fixed.observation_method === 'video_sequence' || fixed.observation_method === 'video_mixed')
        && <p>视频序列按采样画面核对可见过程，证据时间为模型估计。音轨和声画同步未核验。</p>}
      {fixed.reason && <p>{fixed.reason}</p>}
      {fixed.items.map(item => <div className="generation-check-item" key={item.id}>
        <div className="generation-check-item-heading"><Switch size="small" aria-label={`纳入生成后检查：${item.source.card_id}/${item.field_id}`} checked={!card.disabled_items?.includes(item.id)} disabled={configDisabled || running}
          onChange={checked => updateCard({ ...card, disabled_items: checked ? (card.disabled_items || []).filter(id => id !== item.id) : [...(card.disabled_items || []), item.id] })} /><span>{item.label}</span></div>
        <details><summary>{item.requirement}</summary><p>原要求：{item.requirement}</p><details><summary>历史来源身份</summary><p>{item.source.card_id} / {item.field_id}</p></details>
        {(() => {
          const latest = reports.find(row => row.product && productKey(row.product) === selected && (row.results.some(result => result.item_id === item.id) || row.executions?.some(execution => execution.item_id === item.id)))
          return latest && <><CheckReportDetails report={latest} itemId={item.id} recheck={{ projectId, canvasId, disabled: configDisabled || cancelling, onReport }} /><Button variant="quiet" size="small" onClick={() => onOpenReport(latest.id)}>查看对应报告</Button></>
        })()}</details>
        {!item.enabled && <p>未纳入整份产物检查，可单项执行</p>}
        {item.availability === 'ready' ? <small>单项预计调用 1 次</small> : <p>无法判断 · {item.reason}</p>}
        <Button size="small" disabled={disabled || running || !!pending || item.availability !== 'ready'}
          onClick={() => void submit(item.id)}>{alreadyChecked ? '重新检查此项' : '检查此项'}</Button>
      </div>)}

    </>}
    {report && <section aria-label="所选产物检查结果" className="generation-check-item-result">
      <p>最近一次{report.scope === 'item' ? '单项' : '整份产物'}检查 · {report.results.length} 项结论，仅适用于所选固定产物</p>
      <Button variant="quiet" onClick={() => onOpenReport(report.id)}>查看对应报告</Button>
    </section>}
    {active && footer && createPortal(<div className="generation-check-actions">
      <div role="status">{pending ? '正在检查所选产物' : fixed ? `产物 1 份 · ${observationLabels[fixed.observation_method ?? 'text']} · 预计调用 ${fixed.estimated_calls} 次` : '请选择具体产物'}{fixed?.reason && <small>{fixed.reason}</small>}</div>
      {pending ? <Button loading={cancelling} disabled={configDisabled || cancelling || pending.executions?.every(row => !['queued', 'running'].includes(row.status) || row.cancel_requested)} onClick={() => void onCancel(pending.id)}>取消本轮检查</Button>
        : <Button variant="primary" disabled={disabled || running || !fixed} loading={running} onClick={() => void submit()}>{fixed && !fixed.estimated_calls ? '记录未执行原因' : alreadyChecked ? '重新检查所选产物' : '检查所选产物'}</Button>}
    </div>, footer)}
  </section>
}
