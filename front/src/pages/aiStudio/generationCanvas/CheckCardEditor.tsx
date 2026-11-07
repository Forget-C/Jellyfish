import { useEffect, useState } from 'react'
import { Alert, Input, Select } from 'antd'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckBasis, CanvasCheckItem, CanvasCheckPreview, CanvasCheckReportRead, CheckCard } from '../../../services/generated'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import type { CardRendererProps } from './rendererRegistry'
import './checkCard.css'

const outcomes = { conforming: '符合', nonconforming: '明确问题', risk: '风险建议', indeterminate: '无法判断' }
const parameterLabels: Record<string, string> = {
  seconds: '时长（秒）', ratio: '画幅', target_ratio: '画幅', count: '数量', seed: '种子', resolution_profile: '分辨率',
}

function BasisDetails({ basis, label }: { basis: CanvasCheckBasis; label: string }) {
  return <details className="generation-check-basis"><summary>{label}</summary>
    <p>生成目标 {basis.target_card_id} · 修订 {basis.revision}{basis.model_id && ` · 模型 ${basis.model_id}`}</p>
    <dl>{Object.entries(basis.parameters).filter(([, value]) => value !== null).map(([key, value]) =>
      <div key={key}><dt>{parameterLabels[key] || key}</dt><dd>{String(value)}</dd></div>)}</dl>
    {basis.capability && <p>已接入输入：{basis.capability.input_ports.join('、') || '无'}</p>}
    <pre aria-label="实际提交文本">{basis.input.text || '尚未填写生成文本'}</pre>
    <p>已采用来源：{basis.input.used?.map(item => item.source.card_id).join('、') || '无'}</p>
    {!!basis.input.mapping?.length && <ul aria-label="实际参考素材及用途">{basis.input.mapping.map((item, index) =>
      <li key={index}>{'source' in item ? `${item.source.card_id} · ${item.media_position === null ? '文本' : `素材 ${item.media_position}`}`
        : `${item.name || item.object_id} · ${item.input_port || '参考图片'} · 素材 ${item.media_position}`}</li>)}</ul>}
    {basis.input.video_media && <details><summary>实际视频素材用途</summary><pre>{JSON.stringify(basis.input.video_media, null, 2)}</pre></details>}
    {!!basis.input.diagnostics?.length && <ul aria-label="默认技术诊断">{basis.input.diagnostics.map((issue, index) =>
      <li key={index}>{issue.message}</li>)}</ul>}
  </details>
}

function applicability(previous: CanvasCheckItem | undefined, current: CanvasCheckItem | undefined, sameTarget: boolean) {
  if (!sameTarget) return '原生成目标已变更或断开'
  if (!current) return '此项已不在当前检查范围'
  if (!previous?.input_stamp) return '缺少逐项比较依据，可重新检查'
  if (current.availability === 'unavailable') return '依据已变化，当前暂不可执行'
  if (!current.input_stamp) return '缺少逐项比较依据，可重新检查'
  return previous.input_stamp === current.input_stamp ? '仍适用于当前输入' : '依据已变化，请重新检查'
}

/** 保存后的依据用于检查；卡片选择与执行报告分别管理。 */
export function CheckCardEditor({ card: raw, document, savedRevision, documentPending, disabled, editorOpen, onChange }: CardRendererProps) {
  const card = raw as CheckCard
  const [preview, setPreview] = useState<CanvasCheckPreview>()
  const [reports, setReports] = useState<CanvasCheckReportRead[]>([])
  const [selectedReportId, setSelectedReportId] = useState<string>()
  const [running, setRunning] = useState(false)
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

  const basis = preview?.basis
  const report = reports.find(item => item.id === selectedReportId) || reports[0]
  const items = preview?.items || []
  const categories = preview?.categories || []
  const selectedCategories = card.enabled_categories || categories.filter(entry => entry.enabled).map(entry => entry.id)
  const included = (itemId: string) => !card.disabled_items?.includes(itemId)
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
  const selectionChanged = comparable && sameTarget && originalEnabled != null
    && (originalEnabled.length !== currentEnabled.length || originalEnabled.some(id => !currentEnabled.includes(id)))
  const blocked = disabled || running || !comparable || !basis
  const run = async (itemId?: string) => {
    if (blocked || !basis) return
    setRunning(true)
    setError('')
    try {
      const response = await Canvases.canvasCheckRun({ projectId, canvasId, cardId, requestBody: {
        expected_revision: basis.revision, basis_hash: basis.basis_hash, item_id: itemId,
      } })
      if (response.data) {
        const completed = response.data
        setReports(previous => [completed, ...previous.filter(item => item.id !== completed.id)])
        setSelectedReportId(completed.id)
      }
    } catch (issue) {
      setError(issue instanceof ApiError && issue.status === 409 ? '检查依据已变，请核对更新后的内容再重查' : '本次检查未完成，历史报告保留')
      setRefresh(value => value + 1)
    } finally {
      setRunning(false)
    }
  }

  return <section className="generation-check-editor" aria-label="生成前检查">
    <p>仅核对本次采用的要求。检查结论供生成决策参考。</p>
    {error && <Alert type="warning" showIcon message={error} action={<Button size="small" onClick={() => setRefresh(value => value + 1)}>刷新</Button>} />}
    {loading && <p role="status">正在读取检查依据</p>}
    {documentPending && <p role="status">保存修改后可检查</p>}
    {!loading && preview?.reason && <p>{preview.reason}</p>}
    {basis && <BasisDetails basis={basis} label="生成检查依据" />}
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
        const action = reports.some(entry => entry.results.some(result => result.item_id === item.id)) ? '重新检查此项' : '检查此项'
        return <div className="generation-check-item" key={item.id}>
          <label><input type="checkbox" aria-label={`纳入整卡检查：${item.source.card_id}`} checked={included(item.id)} disabled={disabled || running}
            onChange={event => onChange({ ...card, disabled_items: event.currentTarget.checked
              ? (card.disabled_items || []).filter(id => id !== item.id) : [...(card.disabled_items || []), item.id] })} />
            来源 {item.source.card_id} · {item.requirement}
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
      {reports.length ? '重新检查' : '检查'}
    </Button>
    {report && <section className="generation-check-report" aria-label="检查报告">
      <label>检查报告 <Select aria-label="选择检查报告" disabled={false} value={report.id} onChange={setSelectedReportId}
        options={reports.map((entry, index) => ({ value: entry.id, label: `报告 ${reports.length - index} · 修订 ${entry.basis.revision}` }))} /></label>
      <p>{report.scope === 'item' ? '单项检查' : '整卡检查'} · 本轮执行 {report.results.length} 项
        {originalEnabled != null && ` · 执行时启用 ${originalEnabled.length} 项`}</p>
      {selectionChanged && <p role="status">当前启用项目与报告生成时不同。此报告只覆盖当时执行的项目。</p>}
      {report.results.map(result => {
        const item = report.items.find(row => row.id === result.item_id)
        const current = items.find(row => row.id === result.item_id)
        return <article key={result.item_id}><strong>{outcomes[result.outcome]}</strong>
          <p role="status">{comparable ? applicability(item, current, sameTarget) : '待核对当前检查依据'}</p>
          {item && <p>{item.label} · 来源 {item.source.card_id} · {item.requirement}</p>}
          {item?.scope_editable && item.scope_note && <p>本轮检查范围：{item.scope_note}</p>}
          <p>{result.message}</p><small>{result.boundary}</small>
        </article>
      })}
      {!!report.omitted?.length && <ul aria-label="本轮未执行">
        {report.omitted.map(item => <li key={item.item_id}>{item.label} · {item.source_card_id} · {item.reason}</li>)}
      </ul>}
      <BasisDetails basis={report.basis} label="本报告固定依据" />
    </section>}
  </section>
}
