import { Tooltip } from 'antd'
import type { Note_Input } from '../../../services/generated'
import { DesignNote } from './DesignNote'
import type { ReadableContext, ReadableSegment } from './readableText'
import { readableSegments } from './readableText'
import { designLabels } from './designLabels'
import { ReferencePreview } from './ReferencePreview'

/** 易读文本与编译高亮共用原文坐标，交互元素保持同级，避免嵌套按钮。 */
export function ReadableText({ text, context, compiled = false, raw = false, ranges = [], selection, onInspect }: {
  text: string; context: ReadableContext; compiled?: boolean; raw?: boolean;
  ranges?: Array<{ start: number; end: number; index: number }>; selection?: number[];
  onInspect?: (part: ReadableSegment, decisions: number[]) => void;
}) {
  const parts = raw ? [{ start: 0, end: text.length, label: text }] : readableSegments(text, context, { compiled })
  return <>{parts.flatMap(part => {
    const changed = part.label !== text.slice(part.start, part.end) || part.entity || part.unresolved
    const points = changed ? [part.start, part.end] : [...new Set([part.start, part.end, ...ranges.flatMap(range => [range.start, range.end]).filter(point => point > part.start && point < part.end)])].sort((a, b) => a - b)
    return points.slice(0, -1).map((start, index) => {
      const end = points[index + 1]
      const label = changed ? part.label : text.slice(start, end)
      const decisions = [...new Set(ranges.filter(range => range.start < end && range.end > start).map(range => range.index))]
      const highlighted = selection?.some(item => decisions.includes(item))
      const description = part.entity ? `${part.entity.kind}：${part.entity.label} · ${part.entity.id}` : part.unresolved ? `暂未识别：${label}` : changed ? `原文：${text.slice(start, end)}` : '查看编译依据'
      if (!onInspect || !(part.entity || part.unresolved || changed || decisions.length)) return <span className={highlighted ? 'is-highlighted' : undefined} key={start}>{label}</span>
      const name = part.entity ? `查看${part.entity.kind}：${part.entity.label}` : part.unresolved ? `查看未识别内容：${label}` : '查看编译依据'
      return <Tooltip key={start} title={description} trigger={['hover', 'focus']}><button type="button" className={`readable-term${highlighted ? ' is-highlighted' : ''}`} aria-label={name} onClick={event => { event.stopPropagation(); onInspect({ ...part, start, end, label }, decisions) }}>{label}</button></Tooltip>
    })
  })}</>
}

/** 只读固定对象详情；完整原始对象折叠保存，参考图来自该次单元绑定。 */
export function ReadableDetails({ part, context }: { part: ReadableSegment; context: ReadableContext }) {
  const entity = part.entity
  if (!entity) return <p>{part.unresolved ? '暂未识别此内容；可能缺少历史对象或存在歧义，请核对模型原文。' : '此处仅转换字段名称或业务词汇，不改变原始含义。'}</p>
  const value = entity.value && typeof entity.value === 'object' && !Array.isArray(entity.value) ? entity.value as Record<string, unknown> : undefined
  return <section className="readable-entity">
    <h3>{entity.label}</h3><p>{entity.kind}</p><p>原始标识：{entity.id}</p>
    {entity.path && <p>原始字段路径：<code>{entity.path}</code></p>}
    {value && 'state' in value && <p><DesignNote note={value as Note_Input} /></p>}
    {value && Object.entries(value).flatMap(([key, child]) => {
      if (!child || typeof child !== 'object' || !('state' in child)) return []
      const note = child as { text?: string; reason?: string }
      const text = note.text || note.reason
      return text ? <p key={key}><strong>{designLabels[key] || key}：</strong><ReadableText text={text} context={context} /></p> : []
    })}
    {entity.references?.map(reference => <ReferencePreview key={reference.id} reference={reference} />)}
    <details><summary>原始对象数据</summary><pre>{JSON.stringify(entity.value, null, 2)}</pre></details>
  </section>
}
