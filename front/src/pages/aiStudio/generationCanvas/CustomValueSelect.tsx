import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { Select } from 'antd'

/** 单选兼容已有身份选项和自定义文本；仅确认选项时提交，搜索与中文输入不修改文档。 */
export function CustomValueSelect({ label, value, options, disabled, onChange, allowClear, maxLength, status, required, id, describedBy, placeholder }: {
  id?: string; describedBy?: string; placeholder?: string; label: string; value?: string; options: { value: string; label: string; disabled?: boolean }[]; disabled?: boolean; onChange: (value: string, custom?: boolean) => void; allowClear?: boolean; maxLength?: number; status?: 'error' | 'warning'; required?: boolean
}) {
  const uiText = useUiText()
  const [search, setSearch] = useState('')
  const query = search.trim()
  const choices = options.filter(option => option.label.includes(query))
  const custom = query && !options.some(option => option.label === query || option.value === query)
  return <Select id={id} aria-describedby={describedBy} aria-label={label} placeholder={placeholder || label} showSearch allowClear={allowClear} status={status} aria-required={required || undefined} aria-invalid={status === 'error' || undefined} value={value || undefined} searchValue={search} disabled={disabled} filterOption={false}
    onSearch={next => setSearch(maxLength ? next.slice(0, maxLength) : next)} onBlur={() => setSearch('')} onChange={(next, option) => { onChange(next || '', !Array.isArray(option) && !!option && 'custom' in option && !!option.custom); setSearch('') }}
    options={[...choices, ...(custom ? [{ value: query, label: uiText("使用“{{query}}”", { query }), custom: true }] : [])]} />
}
