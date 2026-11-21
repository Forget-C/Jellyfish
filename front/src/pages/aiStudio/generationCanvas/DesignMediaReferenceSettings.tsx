import { useUiText } from '../../../uiText'
import { useEffect, useState } from 'react'
import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { DesignMediaExample } from '../../../services/generated'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'

/** Reference ranges are a local draft until both endpoints are explicitly applied. */
export function DesignMediaReferenceSettings({ example, fields, disabled, duration, onChange }: { example: DesignMediaExample; fields: { id: string; label: string }[]; disabled?: boolean; duration?: number; onChange: (patch: Partial<DesignMediaExample>) => void }) {
  const uiText = useUiText()
  const [start, setStart] = useState<number | null>((example.start_ms === null || example.start_ms === undefined) ? null : example.start_ms / 1000)
  const [end, setEnd] = useState<number | null>((example.end_ms === null || example.end_ms === undefined) ? null : example.end_ms / 1000)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setStart((example.start_ms === null || example.start_ms === undefined) ? null : example.start_ms / 1000); setEnd((example.end_ms === null || example.end_ms === undefined) ? null : example.end_ms / 1000); setDirty(false) }, [example.start_ms, example.end_ms])
  const valid = start !== null && end !== null && Number.isFinite(start) && Number.isFinite(end) && start >= 0 && Math.round(end * 1000) > Math.round(start * 1000) && (duration === undefined || end <= duration)
  const apply = () => { if (valid && !disabled) { onChange({ start_ms: Math.round(start! * 1000), end_ms: Math.round(end! * 1000) }); setDirty(false) } }
  return <div className="design-media-reference-settings">
    <Space wrap><Select aria-label={uiText("参考用途")} disabled={disabled} value={example.purpose} options={[{ value: 'positive', label: uiText("正向参考") }, { value: 'negative', label: uiText("反例") }]} onChange={purpose => onChange({ purpose })} />
      <Select aria-label={uiText("参考定位字段")} placeholder={uiText("对应字段")} disabled={disabled} allowClear value={example.field_id || undefined} options={fields.map(field => ({ value: field.id, label: field.label }))} onChange={field_id => onChange({ field_id: field_id ?? null })} /></Space>
    <Input aria-label={uiText("参考说明")} placeholder={uiText("参考说明")} disabled={disabled} value={example.description || ''} onChange={event => onChange({ description: event.target.value })} />
    {['audio', 'video'].includes(example.source.port_id) && <>
      <Space wrap onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); apply() } }}>
        <label>{uiText("起点（秒）")} <InputNumber aria-label={uiText("参考起点秒")} disabled={disabled} min={0} precision={3} value={start} onChange={value => { setStart(value); setDirty(true) }} /></label>
        <label>{uiText("终点（秒）")} <InputNumber aria-label={uiText("参考终点秒")} disabled={disabled} min={0} precision={3} value={end} onChange={value => { setEnd(value); setDirty(true) }} /></label>
        {dirty && <WorkbenchButton disabled={disabled || !valid} onClick={apply}>{uiText("应用区间")}</WorkbenchButton>}
        <WorkbenchButton variant="quiet" disabled={disabled || (example.start_ms === null || example.start_ms === undefined) && !dirty} onClick={() => { setStart(null); setEnd(null); setDirty(false); onChange({ start_ms: null, end_ms: null }) }}>{uiText("清除区间")}</WorkbenchButton>
      </Space>
      {dirty && !valid && <Alert type="warning" message={uiText("请填写完整区间：0 ≤ 起点 < 终点，且不超过已知素材时长。")} />}
      <small className="design-reference-hint">{uiText("区间仅用于参考定位")}</small>
    </>}
  </div>
}
