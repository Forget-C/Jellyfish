import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckItem, CanvasCheckPreview, CanvasCheckReportRead, CheckCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useGraphRules } from './CanvasCatalogContext'
import { designFieldEntries, isReferenceDesign } from './designFieldReferences'
import type { CanvasInspectTarget } from './canvasDiagnosticNavigation'

export const checkOutcomes = { conforming: '符合', nonconforming: '明确问题', risk: '风险建议', indeterminate: '无法判断' }
export const checkExecutions = { queued: '排队中', running: '检查中', succeeded: '已完成', failed: '执行失败', cancelled: '已取消' }
const priority: Record<string, number> = { '明确问题': 0, '无法判断': 1, '执行失败': 1, '待重查': 2, '风险建议': 3, '未检查': 4, '暂不可执行': 4, '已取消': 4, '符合': 5 }
export const reportPending = (report: CanvasCheckReportRead) => report.executions?.some(item => item.status === 'queued' || item.status === 'running')
const orderedReports = (reports: CanvasCheckReportRead[]) => [...reports].sort((a, b) => b.created_at.localeCompare(a.created_at))

export function checkApplicability(previous: CanvasCheckItem | undefined, current: CanvasCheckItem | undefined, sameTarget: boolean) {
  if (!sameTarget) return '原生成目标已变更或断开'
  if (!current) return '此项已不在当前检查范围'
  if (!previous?.input_stamp || !current.input_stamp) return '缺少逐项比较依据，可重新检查'
  if (current.availability === 'unavailable') return '依据已变化，当前暂不可执行'
  return previous.input_stamp === current.input_stamp ? '仍适用于当前输入' : '依据已变化，请重新检查'
}

/** 一张卡只有一个保留会话；详情关闭、编组隐藏不影响已受理检查的观察。 */
type CheckSessionProps = CardRendererProps & { reportTarget?: CanvasInspectTarget }

function useCheckSession(props: CheckSessionProps) {
  const { card: raw, document, savedRevision, documentPending, disabled, modelOutputs, automaticCheckRunId, reportTarget, editorOpen } = props
  const card = raw as CheckCard
  const { cardTitles, cardDefinitions } = useGraphRules()
  const [preview, setPreview] = useState<CanvasCheckPreview>()
  const [reports, setReports] = useState<CanvasCheckReportRead[]>([])
  const [reportSelection, setReportSelection] = useState<{ id: string; itemId?: string }>()
  const selectedReportId = reportSelection?.id
  const setSelectedReportId = useCallback((id?: string) => setReportSelection(id ? { id } : undefined), [])
  const [tab, setTab] = useState('pre')
  const [reportFilter, setReportFilter] = useState('all')
  const [itemTarget, setItemTarget] = useState<{ id: string; serial: number }>()
  const [postTarget, setPostTarget] = useState<{ reportId: string; serial: number }>()
  const [running, setRunning] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refresh, setRefresh] = useState(0)
  const [error, setError] = useState('')
  const [automaticWaitExpired, setAutomaticWaitExpired] = useState(false)
  const submitting = useRef(false)
  const { project_id: projectId, id: canvasId } = document
  const cardId = card.id
  const saved = props.savedCard?.type === 'review.check'
  const observedIds = preview?.basis?.observed_model_inputs || []
  const observedKey = JSON.stringify(observedIds)
  const observedStamp = JSON.stringify(observedIds.map(id => modelOutputs?.[id]?.map(output =>
    [output.result_set_id, output.basis_current, output.available, output.source.position, output.file_id])))
  const observed = useRef<{ key: string; stamp: string }>()
  const outputChanged = observed.current?.key === observedKey && observed.current.stamp !== observedStamp
  useEffect(() => {
    observed.current = { key: observedKey, stamp: observedStamp }
    if (outputChanged) { setPreview(undefined); setRefresh(value => value + 1) }
  }, [observedKey, observedStamp, outputChanged])
  useEffect(() => {
    const target = reportTarget?.diagnostic
    const reportId = reportTarget?.reportId || (typeof target?.report_id === 'string' ? target.report_id : undefined)
    const itemId = typeof target?.item_id === 'string' && target.item_id ? target.item_id : undefined
    if (reportId) { setReportSelection({ id: reportId, itemId }); setReportFilter('all'); setTab('history') }
    else if (itemId && reportTarget) { setTab('pre'); setItemTarget({ id: itemId, serial: reportTarget.serial }) }
  }, [reportTarget])
  const mergeReports = (history: CanvasCheckReportRead[]) => setReports(previous => orderedReports([
    ...history, ...previous.filter(entry => !history.some(row => row.id === entry.id)),
  ]))
  useEffect(() => {
    if (!saved || savedRevision === undefined) { setLoading(false); return }
    let active = true
    setLoading(true)
    Promise.all([Canvases.canvasCheckPreview({ projectId, canvasId, cardId }), Canvases.canvasCheckReports({ projectId, canvasId, cardId })])
      .then(([basis, history]) => {
        if (active) {
          setError(''); setPreview(basis.data || undefined)
          mergeReports(history.data || [])
        }
      })
      .catch(() => { if (active) { setPreview(undefined); setError('读取检查依据或报告失败，请重试') } })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, canvasId, cardId, savedRevision, saved, refresh, editorOpen])

  const checking = reports.some(reportPending)
  const targetId = document.edges?.find(edge => edge.target_card === card.id && edge.target_port === 'check_basis')?.source_card
  const expectedProducts = Math.max(1, targetId ? modelOutputs?.[targetId]?.length || 0 : 0)
  // 等待本轮全部产物的自动报告，避免第一份报告完成后漏掉其余产物。
  const awaitingAutomatic = !!automaticCheckRunId && new Set(reports.filter(entry => entry.automatic && entry.product?.run_id === automaticCheckRunId).map(entry => entry.product!.position)).size < expectedProducts
  useEffect(() => {
    setAutomaticWaitExpired(false)
    if (!saved || cancelling || (!checking && !awaitingAutomatic)) return
    let active = true
    let attempts = 0
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await Canvases.canvasCheckReports({ projectId, canvasId, cardId })
        if (active && response.data) mergeReports(response.data)
      } catch { /* 保留已有报告，下一轮恢复读取。 */ }
      finally {
        if (active) {
          if (checking || ++attempts < 24) timer = setTimeout(() => void poll(), 1200)
          else setAutomaticWaitExpired(true)
        }
      }
    }
    timer = setTimeout(() => void poll(), 1200)
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, canvasId, cardId, saved, checking, awaitingAutomatic, automaticCheckRunId, cancelling, refresh])

  const basis = preview?.basis
  const items = preview?.items || []
  const categories = preview?.categories || []
  const selectedCategories = card.enabled_categories || categories.filter(entry => entry.enabled).map(entry => entry.id)
  const included = (id: string) => !card.disabled_items?.includes(id)
  const enabledItems = items.filter(item => selectedCategories.includes(item.category) && included(item.id))
  const basisCurrent = !documentPending && !outputChanged && !!basis && basis.revision === savedRevision
  const comparable = !loading && basisCurrent
  const blocked = !!disabled || running || cancelling || !comparable
  const ready = enabledItems.some(item => item.availability !== 'unavailable')
  const reason = disabled ? '当前只读' : documentPending || !saved ? '保存修改后可检查' : loading ? '正在读取检查依据'
    : error || preview?.reason || (!basis ? '请连接模型生成卡的生成检查依据' : !ready ? '没有可执行的已启用检查项，请检查配置' : '')
  const showReport = (accepted: CanvasCheckReportRead) => {
    mergeReports([accepted])
  }
  const run = async (itemId?: string) => {
    if (blocked || submitting.current || !basis) return
    submitting.current = true; setRunning(true); setError('')
    try {
      const response = await Canvases.canvasCheckRun({ projectId, canvasId, cardId, requestBody: {
        expected_revision: basis.revision, basis_hash: basis.basis_hash, item_id: itemId,
      } })
      if (response.data) showReport(response.data)
    } catch (issue) {
      setError(issue instanceof ApiError && issue.status === 409 ? '检查依据已变，请核对更新后的内容再重查' : '本次检查未完成，历史报告保留')
      setRefresh(value => value + 1)
    } finally { submitting.current = false; setRunning(false) }
  }
  const cancel = async (reportId: string) => {
    if (cancelling || disabled) return
    setCancelling(true); setError('')
    try {
      const response = await Canvases.canvasCheckCancel({ projectId, canvasId, cardId, reportId })
      if (response.data) mergeReports([response.data])
    } catch { setError('取消请求结果待核实，请查看刷新后的检查状态'); setRefresh(value => value + 1) }
    finally { setCancelling(false) }
  }
  // 批量报告里的关闭记录不覆盖该项已执行的报告。
  const latest = (id: string) => reports.find(report => !report.product && (report.results.some(result => result.item_id === id)
    || report.executions?.some(item => item.item_id === id) || report.omitted?.some(item => item.item_id === id && item.status !== 'disabled')))
  const itemState = (item: CanvasCheckItem) => {
    const report = latest(item.id)
    const execution = report?.executions?.find(row => row.item_id === item.id)
    const result = report?.results.find(row => row.item_id === item.id)
    if (report && !basisCurrent) return '待核对'
    if (report && checkApplicability(report.items.find(row => row.id === item.id), item, report.basis.target_card_id === basis?.target_card_id) !== '仍适用于当前输入') return '待重查'
    if (execution && ['queued', 'running'].includes(execution.status)) return execution.cancel_requested ? '正在取消' : checkExecutions[execution.status]
    if (execution && ['failed', 'cancelled'].includes(execution.status)) return checkExecutions[execution.status]
    if (result) return checkOutcomes[result.outcome]
    return item.availability === 'unavailable' ? '暂不可执行' : '未检查'
  }
  const currentExecution = (report: CanvasCheckReportRead, id: string) => basisCurrent && report.basis.target_card_id === basis?.target_card_id
    && checkApplicability(report.items.find(item => item.id === id), items.find(item => item.id === id), true) === '仍适用于当前输入'
    && report.executions?.some(execution => execution.item_id === id && ['queued', 'running'].includes(execution.status))
  const itemChecking = (item: CanvasCheckItem) => reports.some(report => !report.product && currentExecution(report, item.id))
  const currentPending = reports.find(report => !report.product && report.executions?.some(execution => currentExecution(report, execution.item_id)))
  const order = useRef<string[]>([])
  const busy = running || !!currentPending
  const sorted = [...enabledItems].sort((a, b) => (priority[itemState(a)] ?? 4) - (priority[itemState(b)] ?? 4))
  if (!busy || !order.current.length) order.current = sorted.map(item => item.id)
  const faceItems = busy ? [...enabledItems].sort((a, b) => {
    const index = (id: string) => { const found = order.current.indexOf(id); return found < 0 ? order.current.length : found }
    return index(a.id) - index(b.id)
  }) : sorted
  const cardName = (id?: string) => {
    const source = document.cards?.find(row => row.id === id)
    return source ? ('name' in source && source.name) || cardTitles[source.type || ''] || '未命名卡片' : '未连接生成目标'
  }
  const itemName = (item: CanvasCheckItem) => {
    const source = document.cards?.find(row => row.id === item.source.card_id)
    const field = source && cardDefinitions[source.type || '']?.fields.find(row => row.id === item.field_id)
    return `${cardName(item.source.card_id)} · ${field?.label || item.label}`
  }
  const canLocateSource = (item: CanvasCheckItem) => {
    const source = item.source.canvas_id === canvasId && document.cards?.find(row => row.id === item.source.card_id)
    return !!props.onLocateDesign && !!source && isReferenceDesign(source)
      && (cardDefinitions[source.type || '']?.fields.some(field => field.id === item.field_id)
        || designFieldEntries(source).some(([field]) => field === item.field_id))
  }
  const openItem = (id: string) => { setTab('pre'); setItemTarget({ id, serial: Date.now() }) }
  const openReport = (id: string, itemId?: string) => { setReportFilter('all'); setReportSelection({ id, itemId }); setTab('history') }
  const report = reports.find(row => row.id === selectedReportId) || reports[0]
  return { ...props, card, projectId, canvasId, cardId, preview, basis, reports, report, items, categories, selectedCategories,
    enabledItems, included, comparable, blocked, ready, reason, running, cancelling, checking, loading, error, run, cancel, showReport,
    refresh: () => setRefresh(value => value + 1), tab, setTab, itemTarget, openItem, postTarget, setPostTarget,
    selectedReportId, reportSelection, setSelectedReportId, automaticWaitExpired, currentPending, itemChecking, reportFilter, setReportFilter, latest, itemState, faceItems, cardName, itemName, targetId, openReport, canLocateSource }
}

const CheckContext = createContext<ReturnType<typeof useCheckSession> | undefined>(undefined)
export function CheckCardSession({ children, ...props }: CheckSessionProps & { children: ReactNode }) {
  const session = useCheckSession(props)
  return <CheckContext.Provider value={session}>{children}</CheckContext.Provider>
}
export function useCheckCard() {
  const state = useContext(CheckContext)
  if (!state) throw new Error('检查卡必须位于自己的保留会话中')
  return state
}
