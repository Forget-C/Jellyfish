import { Input, Select } from 'antd'
import type { DesignScope } from '../../../services/generated'

/** One scope/source layout; editing remains owned by the individual design card. */
export function DesignScopeEditor<T extends { scope?: DesignScope; source_locator?: string }>({ card, onChange, disabled, labelPrefix = '设计' }: { card: T; onChange: (card: T) => void; disabled?: boolean; labelPrefix?: string }) {
  return <section aria-label="范围与来源" className="design-preset-fields static-design-scope">
    <label>适用范围<Input aria-label={`${labelPrefix}适用范围`} disabled={disabled} value={card.scope?.description} onChange={event => onChange({ ...card, scope: { ...card.scope, description: event.target.value } })} /></label>
    <label>制作阶段<Select aria-label={`${labelPrefix}制作阶段`} disabled={disabled} allowClear value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => onChange({ ...card, scope: { ...card.scope, phase: phase ?? null } })} /></label>
    <label>适用条件<Input aria-label={`${labelPrefix}适用条件`} disabled={disabled} value={card.scope?.condition} onChange={event => onChange({ ...card, scope: { ...card.scope, condition: event.target.value } })} /></label>
    <label>来源<Input aria-label={`${labelPrefix}来源`} disabled={disabled} value={card.source_locator} onChange={event => onChange({ ...card, source_locator: event.target.value })} /></label>
  </section>
}
