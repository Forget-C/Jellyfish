import { AutoComplete, Input } from 'antd'
import { useState } from 'react'
import type { DesignScope } from '../../../services/generated'
import { designPhaseLabel } from './designScope'

function ScopeInput({ label, placeholder, options, value, disabled, onChange }: { label: string; placeholder: string; options: string[]; value: string; disabled?: boolean; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  return <div onFocusCapture={() => setOpen(true)} onClick={event => { if (event.target instanceof HTMLInputElement) setOpen(true) }} onKeyDownCapture={event => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
  }} onKeyDown={event => { if (event.key === 'Enter') { event.stopPropagation(); setOpen(false) } }}>
    <AutoComplete value={value} disabled={disabled} open={!disabled && open} onDropdownVisibleChange={setOpen} onBlur={() => setOpen(false)} defaultActiveFirstOption={false} allowClear options={options.map(option => ({ value: option }))} onChange={onChange} filterOption={(input, option) => String(option?.value).includes(input)} style={{ width: '100%' }}>
      <Input aria-label={label} placeholder={placeholder} />
    </AutoComplete>
  </div>
}

/** 用户选择或输入才更新限制；默认提示不写入数据，来源只读展示。 */
export function DesignScopeEditor<T extends { scope?: DesignScope; source_locator?: string }>({ card, onChange, disabled, labelPrefix = '设计' }: { card: T; onChange: (card: T) => void; disabled?: boolean; labelPrefix?: string }) {
  const update = (key: keyof DesignScope, value: string) => onChange({ ...card, scope: { ...card.scope, [key]: key === 'phase' && !value ? null : value } })
  return <section aria-label="范围与来源" className="design-preset-fields static-design-scope">
    <label>内容适用范围<ScopeInput label={`${labelPrefix}内容适用范围`} placeholder="不限定范围" options={['全部内容', '主体内容', '背景内容', '动作过程', '最终结果']} value={card.scope?.description || ''} disabled={disabled} onChange={value => update('description', value)} /></label>
    <label>制作阶段<ScopeInput label={`${labelPrefix}制作阶段`} placeholder="不限定阶段" options={['画面／视频', '声音', '后期']} value={designPhaseLabel(card.scope?.phase)} disabled={disabled} onChange={value => update('phase', value)} /></label>
    <label>适用条件<ScopeInput label={`${labelPrefix}适用条件`} placeholder="无额外条件" options={['全程适用', '对象出现时', '动作发生时', '动作结束后']} value={card.scope?.condition || ''} disabled={disabled} onChange={value => update('condition', value)} /></label>
    {card.source_locator?.trim() && <small className="design-field-metadata">卡片原始来源：{card.source_locator}</small>}
  </section>
}
