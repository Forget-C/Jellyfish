import { useState } from 'react'
import { Alert, Checkbox } from 'antd'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import type { CanvasAssistantChange, CanvasAssistantEditGroup, CanvasAssistantProposal, CanvasDocument, MovementCard, VideoModelCard } from '../../../services/generated'
import { useUiText } from '../../../uiText'

type Decision = 'approve' | 'reject'

const movementFields = {
  movement_type: '运镜类型', movement_start: '运动起点', movement_trigger: '运动触发',
  movement_path: '运动路径', movement_speed: '运动速度', end_frame: '结束画面',
} as const

/** A stored edit preview with explicit apply and reject actions. */
export function AssistantProposal({ proposal, current, editDisabled, revise, decide }: {
  proposal: CanvasAssistantProposal
  current: () => Record<string, unknown>
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
  const latest = currentText(current(), proposal)
  const field = 'field' in proposal.target
    ? uiText(movementFields[proposal.target.field]) : uiText('视频提示词')

  return <section className="canvas-assistant-proposal" aria-label={uiText('修改建议')}>
    <strong>{uiText('修改建议')} · {uiText(proposal.card_name)} · <span title={proposal.card_id}>{proposal.card_id.slice(0, 8)}</span> · {field}</strong>
    <dl>
      <dt>{uiText('原值')}</dt><dd>{proposal.before || '—'}</dd>
      {pending && latest !== proposal.before && <><dt>{uiText('当前值')}</dt><dd>{latest ?? '—'}</dd></>}
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

/** Select independent groups while preserving a single save and undo for the chosen set. */
export function AssistantEditGroups({ groups, current, editDisabled, revise, decide }: {
  groups: CanvasAssistantEditGroup[]
  current: () => Record<string, unknown>
  editDisabled: boolean
  revise: () => void
  decide: (action: Decision, groupIds: string[]) => Promise<boolean>
}) {
  const uiText = useUiText()
  const [selected, setSelected] = useState<string[]>([])
  const [busy, setBusy] = useState<Decision>()
  const [error, setError] = useState(false)
  const currentDraft = current()
  const pending = groups.filter(group => (group.state ?? 'pending') === 'pending')
  const selectedPending = pending.filter(group => selected.includes(group.id)).map(group => group.id)

  async function confirm(action: Decision) {
    setBusy(action)
    setError(false)
    try {
      if (await decide(action, selectedPending)) setSelected([])
      else setError(true)
    } catch {
      setError(true)
    } finally {
      setBusy(undefined)
    }
  }

  return <section className="canvas-assistant-proposal" aria-label={uiText('修改建议')}>
    <strong>{uiText('修改建议')}</strong>
    {groups.map(group => <div key={group.id}>
      <Checkbox disabled={!!busy || !pending.includes(group)} checked={selectedPending.includes(group.id)}
        onChange={event => setSelected(ids => event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id))}>
        {group.title}
      </Checkbox>
      {group.edits.map(edit => {
        const currentValue = currentText(currentDraft, edit)
        const removal = edit.target.kind === 'delete_card' || edit.target.kind === 'release_binding'
        const changed = !removal && pending.includes(group) && currentValue !== edit.before
        return <dl key={edit.card_id + JSON.stringify(edit.target)}>
          <dt>{uiText(edit.card_name)} · {edit.card_id.slice(0, 8)} · {removal ? uiText(edit.after)
            : 'field' in edit.target ? uiText(movementFields[edit.target.field]) : uiText('视频提示词')}</dt>
          <dt>{uiText(removal ? '影响范围' : '原值')}</dt><dd>{edit.before || '—'}</dd>
          {changed && <><dt>{uiText('当前值')}</dt><dd>{currentValue ?? '—'}</dd></>}
          {!removal && <><dt>{uiText('拟议值')}</dt><dd>{edit.after}</dd></>}
        </dl>
      })}
      {group.state === 'applied' && <small>{uiText('已写入画布')}</small>}
      {group.state === 'rejected' && <small>{uiText('建议已拒绝')}</small>}
      {group.state === 'superseded' && <small>{uiText('建议已被修订替代')}</small>}
    </div>)}
    {!!pending.length && <div className="canvas-assistant-edit-actions">
      <WorkbenchButton variant="primary" loading={busy === 'approve'} disabled={editDisabled || !!busy || !selectedPending.length}
        onClick={() => void confirm('approve')}>{uiText('确认写入')}</WorkbenchButton>
      <WorkbenchButton variant="secondary" disabled={!!busy} onClick={revise}>{uiText('修订建议')}</WorkbenchButton>
      <WorkbenchButton variant="quiet" loading={busy === 'reject'} disabled={!!busy || !selectedPending.length}
        onClick={() => void confirm('reject')}>{uiText('拒绝建议')}</WorkbenchButton>
    </div>}
    {error && <Alert type="warning" message={uiText('未能完成审批，请核对画布状态后重试。')} />}
  </section>
}

function currentText(draft: Record<string, unknown>, edit: CanvasAssistantChange) {
  const { target } = edit
  const document = draft as CanvasDocument
  const card = document.cards?.find(item => item.id === edit.card_id)
  if ('field' in target && card?.type === 'direction.movement') {
    return (card as MovementCard).fields?.[target.field]?.text
  }
  if ('segment_id' in target && card?.type === 'model.video') {
    const part = (card as VideoModelCard).prompt?.segments?.find(item => 'id' in item && item.id === target.segment_id)
    return part && 'text' in part ? part.text : undefined
  }
}
