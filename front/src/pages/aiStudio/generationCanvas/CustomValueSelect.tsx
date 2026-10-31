import { useState } from 'react'
import { Select } from 'antd'

/** 单选兼容已有身份选项和自定义文本；仅确认选项时提交，搜索与中文输入不修改文档。 */
export function CustomValueSelect({ label, value, options, disabled, onChange }: {
  label: string; value?: string; options: { value: string; label: string; disabled?: boolean }[]; disabled?: boolean; onChange: (value: string) => void
}) {
  const [search, setSearch] = useState('')
  const query = search.trim()
  const choices = options.filter(option => option.label.includes(query))
  const custom = query && !options.some(option => option.label === query || option.value === query)
  return <Select aria-label={label} placeholder={label} showSearch value={value || undefined} searchValue={search} disabled={disabled} filterOption={false}
    onSearch={setSearch} onBlur={() => setSearch('')} onChange={next => { onChange(next); setSearch('') }}
    options={[...choices, ...(custom ? [{ value: query, label: `使用“${query}”` }] : [])]} />
}
