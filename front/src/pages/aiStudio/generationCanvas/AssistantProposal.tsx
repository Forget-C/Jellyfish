import { useState } from 'react'
import { Alert, Checkbox } from 'antd'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'
import type { CanvasAssistantChange, CanvasAssistantEditGroup, CanvasAssistantProposal, CanvasDocument } from '../../../services/generated'
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
  const field = fieldLabel(proposal.target, uiText)

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
  const [firstGroupId] = useState(() => groups.find(group => (group.state ?? 'pending') === 'pending')?.id)
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
    <header className="canvas-assistant-proposal-heading">
      <strong>{uiText('修改建议')}</strong>
      {!!pending.length && <small>{uiText('{{count}} 组待审批', { count: pending.length })}</small>}
    </header>
    {groups.map(group => {
      const isPending = pending.includes(group)
      const conflict = isPending && group.edits.some(edit => {
        const { target } = edit
        return (target.kind === 'card_text' || 'movement_card_id' in target || 'field' in target || 'field_name' in target || 'segment_id' in target)
          && currentText(currentDraft, edit) !== edit.before
      })
      return <div key={group.id} className="canvas-assistant-edit-group">
        {isPending && <Checkbox disabled={!!busy} checked={selectedPending.includes(group.id)}
          onChange={event => setSelected(ids => event.target.checked ? [...ids, group.id] : ids.filter(id => id !== group.id))}>
          {uiText(group.title)}
        </Checkbox>}
        <details open={isPending && (group.id === firstGroupId || conflict)}>
          <summary>{isPending ? conflict ? uiText('与当前画布冲突') : uiText('查看差异')
            : <>{uiText(group.title)} · <span>{uiText(group.state === 'applied' ? '已写入画布'
              : group.state === 'rejected' ? '建议已拒绝' : '建议已被修订替代')}</span></>}</summary>
          {group.edits.map(edit => {
            const { target } = edit
            if ('movement_card_id' in target) return <dl key={target.connection_id}>
              <dt>{uiText('已采用运镜')} · {uiText(movementFields[target.movement_field])}</dt>
              <dd title={target.movement_card_id}>{target.movement_card_id}</dd>
              <dt>{uiText('连线目标')}</dt><dd title={edit.card_id}>{edit.card_id} · {target.binding_id}</dd>
              {target.copy_card_id && <>
                <dt>{uiText('新建专属运镜')}</dt><dd title={target.copy_card_id}>{target.copy_card_id.slice(0, 8)}</dd>
                <dt>{uiText('保留原运镜的卡片')}</dt><dd>{target.other_consumer_ids.join('、')}</dd>
              </>}
              <dt>{uiText('原值')}</dt><dd>{edit.before || '—'}</dd>
              {isPending && currentText(currentDraft, edit) !== edit.before &&
                <><dt>{uiText('当前值')}</dt><dd>{currentText(currentDraft, edit) ?? '—'}</dd></>}
              <dt>{uiText('拟议值')}</dt><dd>{edit.after}</dd>
            </dl>
            if ('edge_id' in target) return <dl key={target.edge_id}>
              <dt>{uiText('参考素材')}</dt><dd>{target.file_name}</dd>
              <dt>{uiText('新建卡片')}</dt><dd>{uiText('图片内容卡')} · {target.reference_card_id.slice(0, 8)}</dd>
              <dt>{uiText('连线目标')}</dt><dd>{uiText(edit.card_name)} · <span title={edit.card_id}>{edit.card_id.slice(0, 8)}</span></dd>
              <dt>{uiText('采用用途')}</dt><dd>{uiText('首帧')}</dd>
              {edit.before && <><dt>{uiText('原参考卡')}</dt><dd title={edit.before}>{edit.before.slice(0, 8)}</dd></>}
            </dl>
            if ('source_card' in target) return <dl key={target.connection_id}>
              <dt>{uiText('连接卡片')}</dt>
              <dd>{target.source_card} · {target.source_port} → {target.target_card} · {target.target_port}</dd>
            </dl>
            if ('card' in target) return <dl key={edit.card_id}>
              <dt>{uiText('新建卡片')}</dt><dd>{uiText(edit.card_name)} · {edit.card_id.slice(0, 8)}</dd>
              {edit.after && <><dt>{uiText('拟议值')}</dt><dd>{edit.after}</dd></>}
            </dl>
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
        </details>
      </div>
    })}
    {!!pending.length && <div className="canvas-assistant-edit-actions">
      <WorkbenchButton variant="primary" loading={busy === 'approve'} disabled={editDisabled || !!busy || !selectedPending.length}
        onClick={() => void confirm('approve')}>{uiText('写入所选 {{count}} 组', { count: selectedPending.length })}</WorkbenchButton>
      <WorkbenchButton variant="secondary" disabled={!!busy} onClick={revise}>{uiText('修订建议')}</WorkbenchButton>
      <WorkbenchButton variant="quiet" loading={busy === 'reject'} disabled={!!busy || !selectedPending.length}
        onClick={() => void confirm('reject')}>{uiText('拒绝所选')}</WorkbenchButton>
    </div>}
    {!!pending.length && editDisabled && <small>{uiText('请完成当前编辑并取得画布编辑权后再确认。')}</small>}
    {error && <Alert type="warning" message={uiText('未能完成审批，请核对画布状态后重试。')} />}
  </section>
}

function fieldLabel(target: CanvasAssistantChange['target'], uiText: ReturnType<typeof useUiText>) {
  if ('field' in target) return uiText(movementFields[target.field])
  if ('field_name' in target) return target.field_name
  return target.kind === 'card_text' ? uiText('文本内容') : uiText('提示词')
}

function currentText(draft: Record<string, unknown>, edit: CanvasAssistantChange) {
  const { target } = edit
  const document = draft as CanvasDocument
  const cardId = 'movement_card_id' in target ? target.movement_card_id : edit.card_id
  const card = document.cards?.find(item => item.id === cardId)
  if ('movement_card_id' in target) return card?.type === 'direction.movement' && 'fields' in card
    ? card.fields?.[target.movement_field]?.text : undefined
  if (target.kind === 'card_text') return card && 'text' in card ? card.text : undefined
  if ('field' in target || 'field_name' in target) {
    if (!card) return undefined
    const fields = ('fields' in card ? card.fields : card) as Record<string, { text?: string }> | undefined
    return fields?.['field' in target ? target.field : target.field_name]?.text
  }
  if ('segment_id' in target && card && 'prompt' in card) {
    const part = card.prompt?.segments?.find(item => 'id' in item && item.id === target.segment_id)
    return part && 'text' in part ? part.text : undefined
  }
}
