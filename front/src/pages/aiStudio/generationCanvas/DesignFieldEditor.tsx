import { countDesignFields } from './designSummary'
import { useContext } from 'react'
import { DesignMetadataVisible } from './DesignEditorFrame'
import { Input, Select, Space } from 'antd'
import type { DesignField } from '../../../services/generated'

const states = [{ value: 'empty', label: '未填写' }, { value: 'not_applicable', label: '不适用' }, { value: 'absent', label: '明确没有' }, { value: 'undecided', label: '待确定' }, { value: 'proposal', label: '提议' }, { value: 'fact', label: '事实' }]

/** 同语义字段共享状态控件；画面设计通过统一开关展示状态与来源，但不复制编辑值。 */
export function DesignFieldEditor({ label, value, purpose = 'design', compact = false, onChange }: { label: string; value?: DesignField; purpose?: DesignField['purpose']; compact?: boolean; onChange: (field: DesignField) => void }) {
  const metadataVisible = useContext(DesignMetadataVisible)
  const specialState = compact && value?.state && !['empty', 'proposal'].includes(value.state) ? states.find(item => item.value === value.state)?.label : undefined
  const field = value || { state: 'empty', text: '', purpose }
  const controls = <Space wrap>
    <Select aria-label={`${label}状态`} value={field.state} options={states} style={{ width: 110 }} onChange={state => onChange({ ...field, state })} />
    <Select aria-label={`${label}用途`} value={field.purpose} options={[{ value: 'background', label: '背景' }, { value: 'design', label: '设计' }, { value: 'constraint', label: '约束' }]} style={{ width: 100 }} onChange={next => onChange({ ...field, purpose: next })} />
  </Space>
  const source = <Input aria-label={`${label}来源`} placeholder="来源定位（可选）" value={field.source_locator} onChange={event => onChange({ ...field, source_locator: event.target.value })} />
  return <section aria-label={label}><strong>{label}{specialState && <span className="design-field-state">{specialState}</span>}</strong>{!compact && controls}
    <Input.TextArea aria-label={`${label}内容`} value={field.text} autoSize={{ minRows: 2, maxRows: 7 }} onChange={event => onChange({ ...field, text: event.target.value, state: field.state === 'empty' ? 'proposal' : field.state })} />
    {compact ? <div hidden={!metadataVisible} className="design-field-metadata">{controls}{source}</div> : source}
  </section>
}

/** 两类画面设计在同一个更多参数入口提示已有内容。 */
export function DesignMoreSummary({ fields, additional = 0 }: { fields: (DesignField | undefined)[]; additional?: number }) {
  const count = countDesignFields(fields) + additional
  return <summary>更多参数{count ? ` · 已填写 ${count} 项` : ''}</summary>
}
