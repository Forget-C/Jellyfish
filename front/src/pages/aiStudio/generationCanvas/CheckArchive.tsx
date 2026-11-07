import { useEffect, useState } from 'react'
import { Alert, Empty } from 'antd'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckReportRead } from '../../../services/generated'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { WorkbenchDetails } from '../directing/ui/WorkbenchDetails'
import { CheckReportDetails } from './CheckReportDetails'

/** A deleted check card's reports are reachable from the canvas that owns them. */
export function CheckArchive({ projectId, canvasId, revision }: { projectId: string; canvasId: string; revision: number }) {
  const [open, setOpen] = useState(false)
  const [reports, setReports] = useState<CanvasCheckReportRead[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(false)
  const [refresh, setRefresh] = useState(0)
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

  return <>
    <Button aria-expanded={open} onClick={() => setOpen(!open)}>检查归档</Button>
    <WorkbenchDetails title="检查归档" open={open} onClose={() => setOpen(false)}>
      <section aria-label="已删检查卡报告" className="generation-check-report">
        <Button size="small" variant="quiet" loading={loading} onClick={() => setRefresh(value => value + 1)}>刷新检查归档</Button>
        {error && <Alert type="warning" message="读取检查归档失败，请刷新" />}
        {!loading && !error && !reports.length && <Empty description="暂无已删检查卡的报告" />}
        {reports.map(report => <details key={report.id} className="generation-check-basis">
          <summary>检查卡 {report.check_card_id} · 原目标 {report.basis.target_card_id} · 修订 {report.basis.revision}</summary>
          <div className="generation-check-report"><CheckReportDetails report={report} /></div>
        </details>)}
      </section>
    </WorkbenchDetails>
  </>
}
