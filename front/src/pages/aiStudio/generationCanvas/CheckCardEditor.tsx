import { useEffect, useState } from 'react'
import { Alert, Input, Select } from 'antd'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckItem, CanvasCheckPreview, CanvasCheckReportRead, CheckCard } from '../../../services/generated'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { PostCheckPanel } from './PostCheckPanel'
import type { CardRendererProps } from './rendererRegistry'
import { BasisDetails, CheckReportDetails } from './CheckReportDetails'
import './checkCard.css'

function applicability(previous: CanvasCheckItem | undefined, current: CanvasCheckItem | undefined, sameTarget: boolean) {
  if (!sameTarget) return '原生成目标已变更或断开'
  if (!current) return '此项已不在当前检查范围'
  if (!previous?.input_stamp) return '缺少逐项比较依据，可重新检查'
  if (current.availability === 'unavailable') return '依据已变化，当前暂不可执行'
  if (!current.input_stamp) return '缺少逐项比较依据，可重新检查'
  return previous.input_stamp === current.input_stamp ? '仍适用于当前输入' : '依据已变化，请重新检查'
}

/** 保存后的依据用于检查；卡片选择与执行报告分别管理。 */
export function CheckCardEditor({ card: raw, document, savedRevision, documentPending, disabled, editorOpen, models, onChange }: CardRendererProps) {
  const card = raw as CheckCard
  const [preview, setPreview] = useState<CanvasCheckPreview>()
  const [reports, setReports] = useState<CanvasCheckReportRead[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string>()
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const { project_id: projectId, id: canvasId } = document
  const cardId = card.id
  useEffect(() => {
    if (!editorOpen || savedRevision === undefined) return
    let active = true
    setLoading(true)
    const options = { projectId, canvasId, cardId }
    Promise.all([Canvases.canvasCheckPreview(options), Canvases.canvasCheckReports(options)])
      .then(([basis, history]) => {
        if (active) {
          setPreview(basis.data || undefined)
          setReports(previous => {
            const fetched = history.data || []
            return [...previous.filter(entry => !fetched.some(row => row.id === entry.id)), ...fetched]
          })
        }
      })
      .catch(() => { if (active) { setPreview(undefined); setError('读取检查依据或报告失败，请重试') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, canvasId, cardId, savedRevision, editorOpen, refresh])

  const checking = reports.some(entry => entry.executions?.some(item => item.status === 'queued' || item.status === 'running'))
  useEffect(() => {
    if (!editorOpen || !checking || cancelling) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await Canvases.canvasCheckReports({ projectId, canvasId, cardId })
        if (active && response.data) {
          const history = response.data
          setReports(previous => [...previous.filter(entry => !history.some(row => row.id === entry.id)), ...history])
        }
      } catch {
        // An interrupted read leaves the last known report and tries reading again.
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1200)
      }
    }
    timer = setTimeout(() => void poll(), 1200)
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, canvasId, cardId, editorOpen, checking, cancelling])

  const basis = preview?.basis
  const report = reports.find(item => item.id === selectedReportId) || reports[0]
  const items = preview?.items || []
  const categories = preview?.categories || []
  const selectedCategories = card.enabled_categories || categories.filter(entry => entry.enabled).map(entry => entry.id)
  const included = (itemId: string) => !card.disabled_items?.includes(itemId)
  const textModels = (models || []).filter(model => model.category === 'text')
  const modelOptions = textModels.map(model => ({ value: model.id, label: model.name }))
  if (card.check_model_id && !textModels.some(model => model.id === card.check_model_id)) {
    modelOptions.push({ value: card.check_model_id, label: '已保存的模型暂不可用' })
  }
  const ready = items.some(item => selectedCategories.includes(item.category) && included(item.id) && item.availability !== 'unavailable')
  const updateScope = (id: string, value: string) => {
    const scopeNotes = { ...card.scope_notes }
    if (value.trim()) scopeNotes[id] = value
    else delete scopeNotes[id]
    onChange({ ...card, scope_notes: scopeNotes })
  }
  const comparable = !loading && !documentPending && !!preview && (!basis || basis.revision === savedRevision)
  const sameTarget = !!basis && basis.target_card_id === report?.basis.target_card_id
  const currentEnabled = items.filter(item => item.enabled).map(item => item.id)
  const originalEnabled = report?.enabled_item_ids
  const selectionChanged = !report?.product && comparable && sameTarget && originalEnabled != null
    && (originalEnabled.length !== currentEnabled.length || originalEnabled.some(id => !currentEnabled.includes(id)))
  const blocked = disabled || running || cancelling || !comparable || !basis
  const showReport = (accepted: CanvasCheckReportRead) => {
    setReports(previous => [accepted, ...previous.filter(item => item.id !== accepted.id)])
    setSelectedReportId(accepted.id)
  }
  const run = async (itemId?: string) => {
    if (blocked || !basis) return
    setRunning(true)
    setError('')
    try {
      const response = await Canvases.canvasCheckRun({ projectId, canvasId, cardId, requestBody: {
        expected_revision: basis.revision, basis_hash: basis.basis_hash, item_id: itemId,
      } })
      if (response.data) showReport(response.data)
    } catch (issue) {
      setError(issue instanceof ApiError && issue.status === 409 ? '检查依据已变，请核对更新后的内容再重查' : '本次检查未完成，历史报告保留')
      setRefresh(value => value + 1)
    } finally {
      setRunning(false)
    }
  }

  const cancel = async (reportId: string) => {
    if (cancelling || disabled) return
    setCancelling(true)
    setError('')
    try {
      const response = await Canvases.canvasCheckCancel({ projectId, canvasId, cardId, reportId })
      const updated = response.data
      if (updated) setReports(previous => previous.map(entry => entry.id === updated.id ? updated : entry))
    } catch {
      setError('取消请求结果待核实，请查看刷新后的检查状态')
      setRefresh(value => value + 1)
    } finally {
      setCancelling(false)
    }
  }

  return <section className="generation-check-editor" aria-label="生成前检查">
    <p>仅核对本次采用的要求。检查结论供生成决策参考。</p>
    {error && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={() => setRefresh(value => value + 1)}>刷新</Button>} />}
    {loading && <p role="status">正在读取检查依据</p>}
    {documentPending && <p role="status">保存修改后可检查</p>}
    {!loading && preview?.reason && <p>{preview.reason}</p>}
    {basis && <BasisDetails basis={basis} label="生成检查依据" />}
    <label>文字检查模型
      <Select aria-label="文字检查模型" placeholder="请选择独立的检查模型" allowClear disabled={disabled || running}
        value={card.check_model_id ?? undefined} options={modelOptions}
        onChange={value => onChange({ ...card, check_model_id: value ?? null })} />
    </label>
    {report && <Button size="small" variant="quiet" disabled={loading || running || documentPending}
      onClick={() => { setError(''); setRefresh(value => value + 1) }}>刷新检查依据</Button>}
    {categories.map(category => <section key={category.id} className="generation-check-category" aria-label={category.label}>
      <label><input type="checkbox" aria-label={`启用类别：${category.label}`} checked={selectedCategories.includes(category.id)} disabled={disabled || running}
        onChange={event => onChange({ ...card, enabled_categories: event.currentTarget.checked
          ? [...new Set([...selectedCategories, category.id])] : selectedCategories.filter(id => id !== category.id) })} />
        {category.label}
      </label>
      {category.availability !== 'ready' && <p>{category.availability === 'not_applicable' ? '不适用' : '暂不可执行'} · {category.reason}</p>}
      {items.filter(item => item.category === category.id).map(item => {
        const action = reports.some(entry => (entry.results.some(result => result.item_id === item.id) || entry.executions?.some(execution => execution.item_id === item.id))) ? '重新检查此项' : '检查此项'
        return <div className="generation-check-item" key={item.id}>
          <label><input type="checkbox" aria-label={`纳入整卡检查：${item.source.card_id}`} checked={included(item.id)} disabled={disabled || running}
            onChange={event => onChange({ ...card, disabled_items: event.currentTarget.checked
              ? (card.disabled_items || []).filter(id => id !== item.id) : [...(card.disabled_items || []), item.id] })} />
            来源 {item.source.card_id}/{item.field_id} · {item.requirement}
          </label>
          {item.availability === 'unavailable' && <p>{item.reason}</p>}
          {item.scope_editable && <label>检查范围说明
            <Input.TextArea rows={2} maxLength={500} disabled={disabled || running} value={card.scope_notes?.[item.id] || ''}
              onChange={event => updateScope(item.id, event.currentTarget.value)} />
          </label>}
          <Button size="small" disabled={blocked || item.availability === 'unavailable'} aria-label={`${action}：${item.label}`} onClick={() => void run(item.id)}>{action}</Button>
        </div>
      })}
    </section>)}
    <Button variant="primary" loading={running} disabled={blocked || !ready} onClick={() => void run()}>
      {reports.some(row => !row.product) ? '重新检查' : '检查'}
    </Button>
    <PostCheckPanel projectId={projectId} canvasId={canvasId} cardId={cardId} savedRevision={savedRevision}
      active={!!editorOpen} disabled={!!disabled || !!documentPending || cancelling} reports={reports} onReport={showReport} />
    {report && <section className="generation-check-report" aria-label="检查报告">
      <label>检查报告 <Select aria-label="选择检查报告" disabled={false} value={report.id} onChange={setSelectedReportId}
        options={reports.map((entry, index) => ({ value: entry.id, label: `报告 ${reports.length - index} · ${entry.product ? '生成后' : '生成前'} · 修订 ${entry.basis.revision}` }))} /></label>
      {selectionChanged && <p role="status">当前启用项目与报告生成时不同。此报告只覆盖当时执行的项目。</p>}
      {report.executions?.some(item => (item.status === 'queued' || item.status === 'running') && !item.cancel_requested)
        && <Button size="small" variant="quiet" loading={cancelling} disabled={disabled || loading || running}
          onClick={() => void cancel(report.id)}>取消本轮检查</Button>}
      <CheckReportDetails report={report}
        applicability={report.product ? undefined : item => comparable ? applicability(item, items.find(row => row.id === item?.id), sameTarget) : '待核对当前检查依据'}
        retry={itemId => !report.product && items.some(item => item.id === itemId && item.availability === 'ready')
          && <Button size="small" disabled={blocked} onClick={() => void run(itemId)}>重新检查此项</Button>} />
    </section>}
  </section>
}
