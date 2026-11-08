import type { CanvasDiagnostic } from '../../../services/generated'
import { CardIssueIndicator } from './CardIssueIndicator'
import { checkOutcomes, useCheckCard } from './CheckCardSession'

const attention = new Set(['明确问题', '无法判断', '执行失败', '待重查', '风险建议'])

/** 检查问题只使用已有结论与逐项有效性，跳转不参与技术预检。 */
export function CheckCardIssues({ diagnostics, onOpen }: { diagnostics: CanvasDiagnostic[]; onOpen: (trigger: HTMLElement) => void }) {
  const state = useCheckCard()
  const { cardId, enabledItems, reports, latest, itemName, itemState, openItem, openReport } = state
  const issues = [...diagnostics]
  const add = (name: string, status: string, itemId: string, reportId?: string) => {
    issues.push({ code: 'CHECK_ATTENTION', severity: status === '明确问题' || status === '执行失败' ? 'error' : 'warning',
      message: `${name} · ${status}`, target: { card_id: cardId, report_id: reportId, item_id: itemId }, blocks: [] })
  }
  for (const item of enabledItems) {
    const status = itemState(item)
    if (attention.has(status)) add(itemName(item), status, item.id, latest(item.id)?.id)
  }
  // 每条问题保留原报告，单项复核只替代同一产物的同一项。
  const recentProduct = reports.find(report => report.product)?.product
  const observed = new Set<string>()
  for (const report of reports) {
    const product = report.product
    if (!product || product.run_id !== recentProduct?.run_id) continue
    for (const item of report.items) {
      const key = JSON.stringify([product.node_id, product.position, item.id])
      if (observed.has(key)) continue
      observed.add(key)
      const name = `历史产物 ${product.position + 1} · ${item.label}`
      const result = report.results.find(row => row.item_id === item.id)
      const execution = report.executions?.find(row => row.item_id === item.id)
      if (result && result.outcome !== 'conforming') add(name, checkOutcomes[result.outcome], item.id, report.id)
      else if (execution?.status === 'failed') add(name, '执行失败', item.id, report.id)
    }
  }
  if (!issues.length) return null
  return <CardIssueIndicator issues={issues} actionFor={({ target }) =>
    typeof target.report_id === 'string' && target.report_id ? '查看检查报告'
      : typeof target.item_id === 'string' && target.item_id ? '查看检查项' : undefined}
    onLocate={({ target }, trigger) => {
      const itemId = typeof target.item_id === 'string' && target.item_id ? target.item_id : undefined
      if (typeof target.report_id === 'string' && target.report_id) openReport(target.report_id, itemId)
      else if (itemId) openItem(itemId)
      onOpen(trigger)
    }} />
}
