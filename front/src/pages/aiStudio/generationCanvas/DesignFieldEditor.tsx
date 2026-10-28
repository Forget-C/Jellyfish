import { Input, Select, Space } from 'antd'
import type { DesignField } from '../../../services/generated'

const states = [{ value: 'empty', label: '未填写' }, { value: 'not_applicable', label: '不适用' }, { value: 'absent', label: '明确没有' }, { value: 'undecided', label: '待确定' }, { value: 'proposal', label: '提议' }, { value: 'fact', label: '事实' }]

/** 同语义字段共享状态控件；各类设计保留自己的编辑布局。 */
export function DesignFieldEditor({ label, value, purpose = 'design', onChange }: { label: string; value?: DesignField; purpose?: DesignField['purpose']; onChange: (field: DesignField) => void }) {
  const field = value || { state: 'empty', text: '', purpose }
  return <section aria-label={label}><strong>{label}</strong><Space wrap>
    <Select aria-label={`${label}状态`} value={field.state} options={states} style={{ width: 110 }} onChange={state => onChange({ ...field, state })} />
    <Select aria-label={`${label}用途`} value={field.purpose} options={[{ value: 'background', label: '背景' }, { value: 'design', label: '设计' }, { value: 'constraint', label: '约束' }]} style={{ width: 100 }} onChange={next => onChange({ ...field, purpose: next })} />
  </Space><Input.TextArea aria-label={`${label}内容`} value={field.text} autoSize={{ minRows: 2, maxRows: 7 }} onChange={event => onChange({ ...field, text: event.target.value, state: field.state === 'empty' ? 'proposal' : field.state })} />
    <Input aria-label={`${label}来源`} placeholder="来源定位（可选）" value={field.source_locator} onChange={event => onChange({ ...field, source_locator: event.target.value })} />
  </section>
}

