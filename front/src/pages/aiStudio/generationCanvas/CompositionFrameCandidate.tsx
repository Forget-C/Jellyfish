import { Alert, Select, Space } from 'antd'
import type { CompositionCard, MovementCard, ReferenceDesignField } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'

/** Stable frame identities remain independent of names and candidate connections. */
export function movementFrameOptions(card?: MovementCard) {
  const available = (value?: ReferenceDesignField) => value && !['empty', 'not_applicable'].includes(value.state || 'empty') && (value.document ? value.document.segments?.some(segment => segment.kind === 'reference' || segment.text?.trim()) : value.text?.trim())
  return card ? [
    ...(available(card.fields?.movement_start) ? [{ value: 'field:movement_start', label: '起始画面' }] : []),
    ...(card.phases || []).filter(phase => available(phase.frame)).map(phase => ({ value: 'phase:' + phase.id, label: phase.name || '未命名画面' })),
    ...(available(card.fields?.end_frame) ? [{ value: 'field:end_frame', label: '结束画面' }] : []),
  ] : []
}

export function CompositionFrameCandidate({ card, movement, sourceId, disabled, onChange, onLocate, reference }: { card: CompositionCard; movement?: MovementCard; sourceId: string; disabled?: boolean; onChange: (card: CompositionCard) => void; onLocate?: (id: string, field: string) => void; reference: React.ReactNode }) {
  const options = movementFrameOptions(movement), target = card.frame_target?.card_id === sourceId ? card.frame_target : undefined
  const missing = !!target && !options.some(option => option.value === target.state_id)
  return <Space direction="vertical" style={{ width: '100%' }}>
    {reference}
    <Select aria-label="定位到画面" placeholder="定位到画面" style={{ width: '100%' }} disabled={disabled || !movement} value={target?.state_id || undefined} options={[...options, ...(missing ? [{ value: target!.state_id, label: '失效画面', disabled: true }] : [])]} onChange={state_id => onChange({ ...card, frame_target: { card_id: sourceId, state_id } })} />
    {target && <Space><WorkbenchButton variant="quiet" disabled={disabled} onClick={() => onChange({ ...card, frame_target: null })}>解除定位</WorkbenchButton><WorkbenchButton variant="quiet" disabled={missing} onClick={() => onLocate?.(sourceId, target.state_id?.startsWith('field:') ? target.state_id.slice(6) : target.state_id || '')}>查看画面</WorkbenchButton></Space>}
    {missing && <Alert type="warning" message="定位画面已失效，请重新选择或解除定位" />}
  </Space>
}
