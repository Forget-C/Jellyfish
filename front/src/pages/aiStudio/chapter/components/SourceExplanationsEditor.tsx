import { Button, Card, Input, Select, Space, Tag } from 'antd'
import type { SourceExplanation } from '../../../../services/generated'

export const SOURCE_POLICY_VERSION = 2

export async function sourceVersion(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function SourceExplanationsEditor({ items, version, rawText, disabled, onChange }: {
  items: SourceExplanation[]; version: string; rawText: string; disabled: boolean; onChange: (items: SourceExplanation[]) => void
}) {
  const patch = (index: number, update: Partial<SourceExplanation>) => onChange(items.map((item, i) => i === index ? { ...item, ...update, source_version: '', policy_version: undefined } : item))
  const occurrences = (excerpt: string) => {
    const source = Array.from(rawText), needle = Array.from(excerpt)
    if (!needle.length) return []
    return source.flatMap((_, start) => source.slice(start, start + needle.length).join('') === excerpt ? [{ start, end: start + needle.length }] : [])
  }
  const canConfirm = (item: SourceExplanation) => {
    if (!item.text.trim()) return false
    if (!item.excerpt) return item.start == null && item.end == null
    if (item.start != null && item.end != null) return item.end > item.start && Array.from(rawText).slice(item.start, item.end).join('') === item.excerpt
    return occurrences(item.excerpt).length === 1
  }
  return <Card size="small" title="原文补充解释" extra={<Button disabled={disabled} onClick={() => onChange([...items, { id: crypto.randomUUID(), excerpt: '', text: '', source_version: '' }])}>添加解释</Button>}>
    <p>用于澄清原意，不新增剧情或指定拍摄方案。待复核解释不会被生成任务采用。仅澄清文字原意，不填写站位、路线或机位等拍摄选择。</p>
    {items.map((item, index) => <Space key={item.id} direction="vertical" style={{ display: 'flex', marginBottom: 12 }}>
      <Tag>{item.kind === 'normal' ? '正常表述确认 · ' : ''}{item.source_version === version && version && item.policy_version === SOURCE_POLICY_VERSION ? '已确认' : item.source_version === version && version && item.policy_version !== SOURCE_POLICY_VERSION ? '需按文字表达边界复核' : '待复核'}</Tag>
      <Input aria-label={`解释${index + 1}原文摘录`} placeholder="原文摘录；留空表示全章" value={item.excerpt} disabled={disabled} onChange={event => patch(index, { excerpt: event.target.value, start: undefined, end: undefined })} />
      {occurrences(item.excerpt ?? '').length > 1 && <Select aria-label={`解释${index + 1}原文位置`} placeholder="选择这条解释对应的原文位置" value={item.start} style={{ width: '100%' }}
        options={occurrences(item.excerpt ?? '').map((span, i) => ({ value: span.start, label: `第${i + 1}处：${Array.from(rawText).slice(Math.max(0, span.start - 12), span.end + 12).join('')}` }))}
        onChange={value => patch(index, occurrences(item.excerpt ?? '').find(span => span.start === value) ?? {})} />}
      <Input.TextArea aria-label={`解释${index + 1}内容`} placeholder="补充解释" value={item.text} disabled={disabled} onChange={event => patch(index, { text: event.target.value })} />
      <Space><Button disabled={disabled || !version || !canConfirm(item)} onClick={() => onChange(items.map((row, i) => i === index ? { ...row, source_version: version, policy_version: SOURCE_POLICY_VERSION } : row))}>确认此解释</Button>
        <Button disabled={disabled} onClick={() => patch(index, { policy_version: undefined })}>退出采用，保留待调整</Button>
        <Button disabled={disabled} onClick={() => onChange(items.filter((_, i) => i !== index))}>删除解释</Button></Space>
    </Space>)}
    {items.length > 1 && <Button disabled={disabled || !version || items.some(item => !canConfirm(item))} onClick={() => onChange(items.map(item => ({ ...item, source_version: version, policy_version: SOURCE_POLICY_VERSION })))}>已查看，全部确认</Button>}
  </Card>
}
