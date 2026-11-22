import type { CanvasAssistantGenerationRead } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { useUiText } from '../../../uiText'

/** Present the authorization and its existing canvas run receipts. */
export function AssistantGeneration({ generation, openRun }: {
  generation: CanvasAssistantGenerationRead
  openRun: (runId: string) => void
}) {
  const uiText = useUiText()
  const states: Record<CanvasAssistantGenerationRead['state'], string> = {
    waiting_approval: uiText("批准修改后生成"),
    queued: uiText("已排队，等待提交"),
    running: uiText("生成进行中"),
    completed: uiText("已生成"),
    failed: uiText("生成未完成"),
    rejected: uiText("修改未获批准，未生成"),
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
      {version.error && <small>{version.error}</small>}
    </div>)}
    {generation.error && generation.state !== 'rejected' && <small>{generation.error}</small>}
  </div>
}
