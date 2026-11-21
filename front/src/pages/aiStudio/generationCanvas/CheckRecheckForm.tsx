import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { Alert, Input } from 'antd'
import { ApiError, StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import type { CanvasCheckReportRead } from '../../../services/generated'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'

export type RecheckContext = {
  projectId: string
  canvasId: string
  disabled?: boolean
  onReport: (report: CanvasCheckReportRead) => void
}

/** Ask for a one-time lead and submit only the original report and item identities. */
export function CheckRecheckForm({ projectId, canvasId, disabled, onReport, cardId, reportId, itemId }: RecheckContext & {
  cardId: string; reportId: string; itemId: string
}) {
  const uiText = useUiText()
  const [open, setOpen] = useState(false)
  const [clarification, setClarification] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const submit = async () => {
    const lead = clarification.trim()
    if (!lead || running || disabled) return
    setRunning(true)
    setError('')
    try {
      const response = await Canvases.canvasCheckRecheck({ projectId, canvasId, cardId, reportId,
        requestBody: { item_id: itemId, clarification: lead } })
      if (response.data) {
        setOpen(false)
        setClarification('')
        onReport(response.data)
      }
    } catch (issue) {
      setError(issue instanceof ApiError && issue.body?.data?.message || uiText("复核未受理，请刷新原报告后重试"))
    } finally {
      setRunning(false)
    }
  }
  if (!open) return <Button size="small" variant="quiet" disabled={disabled} onClick={() => setOpen(true)}>{uiText("补充说明后重新检查")}</Button>
  return <div className="generation-check-item" aria-label={uiText("原报告复核")}>
    <p>{uiText("按原报告的目标、要求和依据复核。本次说明用于定位证据。")}</p>
    <label>{uiText("本次复核说明")}
      <Input.TextArea aria-label={uiText("本次复核说明")} rows={2} maxLength={500} disabled={running || disabled}
        value={clarification} onChange={event => setClarification(event.currentTarget.value)} />
    </label>
    {error && <Alert type="warning" showIcon message={error} />}
    <Button size="small" variant="primary" loading={running} disabled={!clarification.trim() || disabled}
      onClick={() => void submit()}>{uiText("按原报告复核")}</Button>
    <Button size="small" variant="quiet" disabled={running}
      onClick={() => { setOpen(false); setClarification(''); setError('') }}>{uiText("取消补充")}</Button>
  </div>
}
