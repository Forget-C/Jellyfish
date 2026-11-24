import { useState } from 'react'
import { Checkbox } from 'antd'
import type { CanvasAssistantExchange } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import { useUiText } from '../../../uiText'
import { groupIsPending } from './AssistantProposal'

export function AssistantActionSummary({ turn, canApprove, approve, locate }: {
  turn: CanvasAssistantExchange
  canApprove: boolean
  approve: (layout: boolean) => Promise<void>
  locate: (label: string) => void
}) {
  const uiText = useUiText()
  const [includeLayout, setIncludeLayout] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { proposal, layout, generation } = turn
  const count = Number(!!proposal) + Number(!!layout) + Number(!!generation)
  if (count < 2) return null
  const edits = proposal?.groups ?? (proposal ? [{ id: '', state: proposal.state }] : [])
  const written = edits.filter(group => group.state === 'applied').length
  const pending = edits.filter(group => groupIsPending(group, turn.approval_audit)).length
  const layoutState = layout?.state === 'applied' ? uiText('布局已执行')
    : layout?.state === 'waiting' || layout?.state === 'executing' ? uiText('等待画布执行布局')
      : layout?.state === 'proposed' ? uiText('待审批') :
        layout?.state === 'stale' ? uiText('布局未执行，请核对当前卡片和位置') : uiText('建议已拒绝')
  const generationState = generation?.state === 'reapproval_required' ? uiText('生成输入已变化，待重新批准')
    : generation?.state === 'completed' ? uiText('已生成')
    : generation?.versions?.length ? uiText('已提交 {{count}} 版', { count: generation.versions.length })
      : generation?.state === 'waiting_approval' ? uiText('批准修改后生成')
        : generation?.state === 'failed' ? uiText('生成未完成')
          : generation?.state === 'stopped' ? uiText('尚未提交的生成已停止')
            : generation?.state === 'rejected' ? uiText('修改未获批准，未生成') : uiText('已排队，等待提交')
  const submit = async () => {
    setBusy(true)
    setError(false)
    try { await approve(includeLayout); setIncludeLayout(false) }
    catch { setError(true) }
    finally { setBusy(false) }
  }

  return <section aria-label={uiText('本轮执行摘要')} className="canvas-assistant-proposal">
    <strong>{uiText('本轮执行摘要')}</strong>
    <ul>
      {proposal && <li>
        <WorkbenchButton variant="quiet" onClick={() => locate(uiText('修改建议'))}>{uiText('修改建议')}</WorkbenchButton>
        <span>{uiText('已写入 {{written}} 组 · 待审 {{pending}} 组', { written, pending })}</span>
      </li>}
      {layout && <li>
        <WorkbenchButton variant="quiet" onClick={() => locate(uiText('布局建议'))}>{uiText('布局建议')}</WorkbenchButton>
        <span>{layoutState}</span>
      </li>}
      {generation && <li>
        <WorkbenchButton variant="quiet" onClick={() => locate(uiText('生成回执'))}>{uiText('生成回执')}</WorkbenchButton>
        <span>{generationState}</span>
      </li>}
    </ul>
    {layout?.state === 'proposed' && pending > 0 && <div className="canvas-assistant-edit-actions">
      <Checkbox checked={includeLayout} disabled={busy}
        onChange={event => setIncludeLayout(event.target.checked)}>{uiText('一并批准布局')}</Checkbox>
      <WorkbenchButton variant="primary" loading={busy} disabled={!canApprove || !includeLayout}
        onClick={() => { void submit() }}>{uiText('批准所选动作')}</WorkbenchButton>
    </div>}
    {error && <div role="alert">{uiText('未能完成审批，请核对画布状态后重试。')}</div>}
  </section>
}
