import { EditOutlined } from '@ant-design/icons'
import { Button, Card, Input, Select, Space, Tag } from 'antd'
import type { SourceExplanation, SourceSpan } from '../../../../services/generated'
import { selectionSpan, sourceSlice } from '../../directing/sourceSelection'

export const SOURCE_POLICY_VERSION = 2

export async function sourceVersion(text: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('')
}

function occurrences(raw: string, excerpt: string) {
  const matches: SourceSpan[] = []
  if (!excerpt) return matches
  for (let offset = raw.indexOf(excerpt); offset !== -1; offset = raw.indexOf(excerpt, offset + 1)) {
    const span = selectionSpan(raw, offset, offset + excerpt.length, true)
    if (span) matches.push(span)
  }
  return matches
}

function lineNumber(raw: string, offset: number) {
  return sourceSlice(raw, { start: 0, end: offset }).split(/\r\n?|\n/).length
}

export function SourceExplanationsEditor({ flat, editing, onEdit, items, savedItems, version, rawText, disabled, onChange, expanded, onExpand, onAdd, onLocate, onReselect }: {
  flat: boolean
  editing?: string
  onEdit: (id?: string) => void
  items: SourceExplanation[]
  savedItems: SourceExplanation[]
  version: string
  rawText: string
  disabled: boolean
  onChange: (items: SourceExplanation[]) => void
  expanded?: string
  onExpand: (id?: string, focus?: boolean) => void
  onAdd: () => void
  onLocate: (span: SourceSpan) => void
  onReselect: (id: string) => void
}) {
  const openEditor = (id: string) => {
    onEdit(id)
    onExpand(id, true)
  }
  const patch = (id: string, update: Partial<SourceExplanation>) =>
    onChange(items.map(item => item.id === id ? { ...item, policy_version: undefined, ...update } : item))
  const rows = items.map(item => {
    const excerpt = item.excerpt ?? ''
    const matches = occurrences(rawText, excerpt)
    const bound = version && item.source_version === version
      ? matches.find(span => span.start === item.start && span.end === item.end)
      : undefined
    const span = bound || (matches.length === 1 ? matches[0] : undefined)
    const confirmed = !!version && item.source_version === version && item.policy_version === SOURCE_POLICY_VERSION
    let location = excerpt ? '待定位' : '全章'
    if (span) {
      const first = lineNumber(rawText, span.start)
      const last = lineNumber(rawText, span.end - 1)
      location = `第 ${first === last ? first : `${first}–${last}`} 行`
      if (matches.length > 1) location += ` · 第 ${matches.findIndex(match => match.start === span.start) + 1} 处`
    }
    return { item, matches, span, confirmed, location, canConfirm: !!item.text.trim() && (!excerpt || !!span) }
  })
  const confirm = (one?: string) => onChange(rows.map(({ item, span }) => !one || item.id === one
    ? { ...item, start: span?.start, end: span?.end, source_version: version, policy_version: SOURCE_POLICY_VERSION }
    : item))

  const title = `原文补充解释（${items.length}）`
  const add = <Button disabled={disabled} onClick={onAdd}>添加解释</Button>
  const content = <>
    {!items.length && <p className="chapter-editor-meta">选段添加解释，或添加适用于全章的说明。</p>}
    {rows.map(({ item, matches, span, confirmed, location, canConfirm }, index) => {
      const open = expanded === item.id
      const status = confirmed ? '已确认' : version && item.source_version === version && typeof item.policy_version === 'number'
        ? '需按文字表达边界复核' : '待复核'
      const saved = savedItems.find(row => row.id === item.id)
      const comparison = saved && !confirmed && <dl className="chapter-explanation-comparison">
        <div><dt>保存时的摘录</dt><dd>{saved.excerpt || '全章'}</dd></div>
        <div><dt>当前选段</dt><dd>{span ? sourceSlice(rawText, span) : item.excerpt ? '请选择原文位置' : '全章'}</dd></div>
      </dl>
      return <div className="chapter-explanation-row" key={item.id}>
        <div className="chapter-explanation-actions">
          <button type="button" className="chapter-explanation-summary" aria-expanded={open}
            onClick={() => {
              onEdit(undefined)
              onExpand(open ? undefined : item.id)
            }}>
            <span><strong>{location}</strong><Tag>{item.kind === 'normal' ? '正常表述确认 · ' : ''}{status}</Tag></span>
            <span className="chapter-explanation-preview">{item.text.trim() || '待填写解释'}</span>
          </button>
          {flat && <Button aria-label={`编辑解释 ${index + 1}`} icon={<EditOutlined aria-hidden />}
            disabled={disabled} onClick={() => openEditor(item.id)} />}
        </div>
        {flat && open && editing !== item.id && <div className="chapter-explanation-details chapter-explanation-reading">
          {comparison || (item.excerpt && <blockquote>{item.excerpt}</blockquote>)}
          <p>{item.text}</p>
          {span && <Button type="link" disabled={disabled} onClick={() => onLocate(span)}>定位原文</Button>}
        </div>}
        {open && (!flat || editing === item.id) && <div className="chapter-explanation-details">
          {comparison}
          <label>原文摘录
            <Input.TextArea aria-label={`解释${index + 1}原文摘录`} placeholder="留空表示全章" value={item.excerpt}
              autoSize={{ minRows: 1, maxRows: 5 }} disabled={disabled}
              onChange={event => patch(item.id, { excerpt: event.target.value, start: undefined, end: undefined, source_version: '' })} />
          </label>
          {matches.length > 1 && <Select aria-label={`解释${index + 1}原文位置`} placeholder="选择这条解释对应的原文位置"
            value={span?.start} disabled={disabled}
            options={matches.map((match, i) => ({
              value: match.start,
              label: `第${i + 1}处：${sourceSlice(rawText, { start: Math.max(0, match.start - 12), end: match.end + 12 })}`,
            }))}
            onChange={value => patch(item.id, { ...matches.find(match => match.start === value), source_version: version })} />}
          <Space wrap>
            {span && <Button type="link" disabled={disabled} onClick={() => onLocate(span)}>定位原文</Button>}
            <Button type="link" disabled={disabled || !rawText.trim()} onClick={() => onReselect(item.id)}>重新选段</Button>
            {!!item.excerpt && <Button type="link" disabled={disabled} onClick={() => patch(item.id, {
              excerpt: '', start: undefined, end: undefined, source_version: '',
            })}>适用全章</Button>}
          </Space>
          <label>补充解释
            <Input.TextArea data-explanation-editor aria-label={`解释${index + 1}内容`} placeholder="说明这段原文的含义" value={item.text}
              autoSize={{ minRows: 2, maxRows: 8 }} disabled={disabled}
              onChange={event => patch(item.id, { text: event.target.value, source_version: item.excerpt ? item.source_version : '' })} />
          </label>
          <Space wrap>
            <Button disabled={disabled || !version || !canConfirm} onClick={() => confirm(item.id)}>确认此解释</Button>
            <Button disabled={disabled} onClick={() => patch(item.id, {})}>退出采用，保留待调整</Button>
            <Button disabled={disabled} onClick={() => { onChange(items.filter(row => row.id !== item.id)); onExpand(undefined) }}>删除解释</Button>
          </Space>
        </div>}
      </div>
    })}
    {items.length > 1 && <Button disabled={disabled || !version || rows.some(row => !row.canConfirm)}
      onClick={() => confirm()}>已查看，全部确认</Button>}
  </>
  return flat
    ? <><div className="chapter-explanation-heading"><h2>{title}</h2>{add}</div>{content}</>
    : <Card size="small" title={title} extra={add}>{content}</Card>
}
