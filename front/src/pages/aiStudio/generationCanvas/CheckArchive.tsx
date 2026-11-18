import { useEffect, useState } from 'react'
import { Alert, Empty } from 'antd'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckReportRead } from '../../../services/generated'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDetails } from '../../../components/workbench/WorkbenchDetails'
import { CheckReportDetails } from './CheckReportDetails'

/** A deleted check card's reports are reachable from the canvas that owns them. */
export function CheckArchive({ projectId, canvasId, revision, targetReportId }: { projectId: string; canvasId: string; revision: number; targetReportId?: string }) {
  const [open, setOpen] = useState(false)
  const [reports, setReports] = useState<CanvasCheckReportRead[]>([])
  const [newReportId, setNewReportId] = useState<string>()
  const [cancelling, setCancelling] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => { if (targetReportId) { setOpen(true); setNewReportId(targetReportId) } }, [targetReportId])
  useEffect(() => {
    if (!open) return
    let active = true
    setLoading(true)
    setError(false)
    Canvases.canvasCheckArchivedReports({ projectId, canvasId })
      .then(response => { if (active) setReports(response.data || []) })
      .catch(() => { if (active) setError(true) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [canvasId, projectId, revision, open, refresh])

  const activeReport = reports.some(report => report.executions?.some(execution => execution.status === 'queued' || execution.status === 'running'))
  useEffect(() => {
    if (!open || !activeReport || cancelling) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const response = await Canvases.canvasCheckArchivedReports({ projectId, canvasId })
        if (active && response.data) {
          const history = response.data
          setReports(previous => [...previous.filter(entry => !history.some(row => row.id === entry.id)), ...history])
        }
      } catch {
        // Keep the last report when the background read is interrupted.
      } finally {
        if (active) timer = setTimeout(() => void poll(), 1200)
      }
    }
    timer = setTimeout(() => void poll(), 1200)
    return () => { active = false; clearTimeout(timer) }
  }, [open, activeReport, projectId, canvasId, cancelling])
  const showReport = (report: CanvasCheckReportRead) => {
    setReports(previous => [report, ...previous.filter(row => row.id !== report.id)])
    setNewReportId(report.id)
  }
  const cancel = async (report: CanvasCheckReportRead) => {
    setCancelling(report.id)
    try {
      const response = await Canvases.canvasCheckCancel({ projectId, canvasId, cardId: report.check_card_id, reportId: report.id })
      const updated = response.data
      if (updated) setReports(previous => previous.map(row => row.id === updated.id ? updated : row))
    } catch {
      setRefresh(value => value + 1)
    } finally {
      setCancelling(undefined)
    }
  }

  return <>
    <Button aria-expanded={open} onClick={() => setOpen(!open)}>检查归档</Button>
    <WorkbenchDetails title="检查归档" open={open} onClose={() => setOpen(false)}>
      <section aria-label="已删检查卡报告" className="generation-check-report">
        <Button size="small" variant="quiet" loading={loading} onClick={() => setRefresh(value => value + 1)}>刷新检查归档</Button>
        {error && <Alert type="warning" message="读取检查归档失败，请刷新" />}
        {!loading && !error && (newReportId && !reports.some(report => report.id === newReportId)
          ? <p role="status">指定报告暂不可用</p> : !reports.length && <Empty description="暂无已删检查卡的报告" />)}
        {reports.map(report => <details key={report.id} open={report.id === newReportId || undefined} className="generation-check-basis">
          <summary>检查卡 {report.check_card_id} · 原目标 {report.basis.target_card_id} · 修订 {report.basis.revision}</summary>
          <div className="generation-check-report">
            {report.executions?.some(execution => (execution.status === 'queued' || execution.status === 'running') && !execution.cancel_requested)
              && <Button size="small" variant="quiet" loading={cancelling === report.id} disabled={!!cancelling}
                onClick={() => void cancel(report)}>取消本轮检查</Button>}
            <CheckReportDetails report={report} active={open} recheck={{ projectId, canvasId, disabled: !!cancelling, onReport: showReport }} />
          </div>
        </details>)}
      </section>
    </WorkbenchDetails>
  </>
}
