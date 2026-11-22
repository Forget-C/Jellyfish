import { useState } from 'react'
import { Alert } from 'antd'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import type { CanvasAssistantProposal } from '../../../services/generated'
import { useUiText } from '../../../uiText'

type Decision = 'approve' | 'reject'

const movementFields = {
  movement_type: '运镜类型', movement_start: '运动起点', movement_trigger: '运动触发',
  movement_path: '运动路径', movement_speed: '运动速度', end_frame: '结束画面',
} as const

/** A stored edit preview with explicit apply and reject actions. */
export function AssistantProposal({ proposal, editDisabled, revise, decide }: {
  proposal: CanvasAssistantProposal
  editDisabled: boolean
  revise: () => void
  decide: (action: Decision) => Promise<boolean>
}) {
  const uiText = useUiText()
  const [busy, setBusy] = useState<Decision>()
  const [error, setError] = useState(false)
  const pending = (proposal.state ?? 'pending') === 'pending'
  const confirm = async (action: Decision) => {
    setBusy(action)
    setError(false)
    try {
      setError(!await decide(action))
    } catch {
      setError(true)
    } finally {
      setBusy(undefined)
    }
  }
  const field = 'field' in proposal.target
    ? uiText(movementFields[proposal.target.field]) : uiText('视频提示词')

  return <section className="canvas-assistant-proposal" aria-label={uiText('修改建议')}>
    <strong>{uiText('修改建议')} · {uiText(proposal.card_name)} · <span title={proposal.card_id}>{proposal.card_id.slice(0, 8)}</span> · {field}</strong>
    <dl>
      <dt>{uiText('原值')}</dt><dd>{proposal.before || '—'}</dd>
      <dt>{uiText('拟议值')}</dt><dd>{proposal.after}</dd>
    </dl>
    {pending && <div className="canvas-assistant-edit-actions">
      <WorkbenchButton variant="primary" loading={busy === 'approve'} disabled={editDisabled || !!busy}
        onClick={() => void confirm('approve')}>{uiText('确认写入')}</WorkbenchButton>
      <WorkbenchButton variant="secondary" disabled={!!busy} onClick={revise}>{uiText('修订建议')}</WorkbenchButton>
      <WorkbenchButton variant="quiet" loading={busy === 'reject'} disabled={!!busy}
        onClick={() => void confirm('reject')}>{uiText('拒绝建议')}</WorkbenchButton>
    </div>}
    {pending && editDisabled && <small>{uiText('请完成当前编辑并取得画布编辑权后再确认。')}</small>}
    {pending && error && <Alert type="warning" message={uiText('未能完成审批，请核对画布状态后重试。')} />}
    {!pending && <small>{proposal.state === 'applied' ? uiText('已写入画布') :
      proposal.state === 'rejected' ? uiText('建议已拒绝') : uiText('建议已被修订替代')}</small>}
  </section>
}
