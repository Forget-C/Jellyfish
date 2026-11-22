import { useState } from 'react'
import type { CanvasAssistantGenerationRead } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { useUiText } from '../../../uiText'
import { CanvasAssistantEvidence } from './CanvasAssistantAttachments'

/** Present the authorization and its existing canvas run receipts. */
export function AssistantGeneration({ generation, openRun, cancelRun }: {
  generation: CanvasAssistantGenerationRead
  openRun: (runId: string) => void
  cancelRun: (runId: string) => Promise<void>
}) {
  const uiText = useUiText()
  const [cancelling, setCancelling] = useState<string>()
  const [cancelError, setCancelError] = useState(false)
  const cancel = async (runId: string) => {
    setCancelling(runId)
    setCancelError(false)
    try { await cancelRun(runId) }
    catch { setCancelError(true) }
    finally { setCancelling(undefined) }
  }
  const states: Record<CanvasAssistantGenerationRead['state'], string> = {
    waiting_approval: uiText("批准修改后生成"),
    queued: uiText("已排队，等待提交"),
    running: uiText("生成进行中"),
    completed: uiText("已生成"),
    failed: uiText("生成未完成"),
    rejected: uiText("修改未获批准，未生成"),
    stopped: uiText("尚未提交的生成已停止"),
  }
  const versionStates: Record<string, string> = {
    succeeded: uiText("已生成"),
    queued: uiText("已排队，等待提交"),
    running: uiText("生成进行中"),
    failed: uiText("生成未完成"),
    cancelled: uiText("已取消"),
  }
  return <div className="canvas-assistant-generation" role="status">
    <div>{uiText("已授权生成版本数")} {generation.requested_count} · {states[generation.state]}</div>
    {(generation.versions ?? []).map(version => <div key={version.request_id}>
      {uiText("版本")} {version.version} · {versionStates[version.state] ?? version.state}
      <WorkbenchButton variant="quiet" onClick={() => openRun(version.run_id)}>{uiText("查看运行")}</WorkbenchButton>
      {['queued', 'running'].includes(version.state) && <WorkbenchButton variant="quiet"
        disabled={Boolean(cancelling)} loading={cancelling === version.run_id}
        onClick={() => { void cancel(version.run_id) }}>{uiText("取消生成")}</WorkbenchButton>}
      {version.error && <small>{version.error}</small>}
    </div>)}
    {cancelError && <p role="alert">{uiText("暂时无法取消生成")}</p>}
    {generation.error && generation.state !== 'rejected' && <small>{generation.error}</small>}
    {generation.review?.state === 'waiting' && <div>{uiText("等待生成结果以审看")}</div>}
    {generation.review?.state === 'reviewing' && <div>{uiText("正在审看生成结果")}</div>}
    {generation.review?.state === 'stopped' && <div>{uiText("已停止后续审看")}</div>}
    {generation.review?.results?.map(result => <div key={result.run_id}>
      <span>{uiText("审看结果")} · {uiText("版本")} {result.version}</span>
      <WorkbenchButton variant="quiet" onClick={() => openRun(result.run_id)}>{uiText("查看审看的运行")}</WorkbenchButton>
      {!!result.evidence?.length && <CanvasAssistantEvidence attachments={result.evidence} />}
      {!!result.skills?.length && <small>{result.skills.map(skill => skill.name + ' · ' + skill.version).join('、')}</small>}
      <p>{result.reply}</p>
    </div>)}
  </div>
}
