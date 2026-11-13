import type { SequenceRead, SourceSpan } from '../../../services/generated'

/** 范围以 Unicode 字符计数，不能直接使用 DOM/textarea 的 UTF-16 偏移。 */
export function sourceSlice(raw: string, span: SourceSpan) {
  return Array.from(raw).slice(span.start, span.end).join('')
}

export function selectionSpan(raw: string, start: number, end: number, allowWhitespace = false): SourceSpan | undefined {
  const low = Math.min(start, end), high = Math.max(start, end)
  if (low < 0 || high > raw.length || low === high) return undefined
  // 原生光标不得将代理对拆成半个字符。
  const boundary = (offset: number) => offset === 0 || offset === raw.length
    || !(raw.charCodeAt(offset) >= 0xDC00 && raw.charCodeAt(offset) <= 0xDFFF)
  if (!boundary(low) || !boundary(high)) return undefined
  const span = { start: Array.from(raw.slice(0, low)).length, end: Array.from(raw.slice(0, high)).length }
  return allowWhitespace || sourceSlice(raw, span).trim() ? span : undefined
}

export function sameSpan(a?: SourceSpan | null, b?: SourceSpan | null) {
  return a?.start === b?.start && a?.end === b?.end
}

/** textarea 将 CRLF/CR 显示为 LF；将其原生偏移还原到未经改写的原文。 */
export function textareaSpan(raw: string, start: number, end: number, allowWhitespace = false) {
  const offsets = [0]
  for (let index = 0; index < raw.length;) {
    index += raw[index] === '\r' && raw[index + 1] === '\n' ? 2 : 1
    offsets.push(index)
  }
  if (offsets[start] === undefined || offsets[end] === undefined) return undefined
  return selectionSpan(raw, offsets[start], offsets[end], allowWhitespace)
}

export function rangeConflicts(rows: SequenceRead[], span?: SourceSpan, selectedId?: string) {
  return span ? rows.filter(row => row.id !== selectedId && !row.source_changed && row.span
    && span.start < row.span.end && row.span.start < span.end) : []
}

/** 装饰标签不含文本；跨节点选区的前缀因此与原文逐字对应。 */
export function readSourceSelection(root: HTMLElement, allowWhitespace = false): SourceSpan | undefined {
  const selection = root.ownerDocument.getSelection()
  if (!selection || selection.rangeCount !== 1 || selection.isCollapsed) return undefined
  const range = selection.getRangeAt(0)
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return undefined
  const prefix = range.cloneRange()
  prefix.selectNodeContents(root)
  prefix.setEnd(range.startContainer, range.startOffset)
  return selectionSpan(root.textContent || '', prefix.toString().length, prefix.toString().length + range.toString().length, allowWhitespace)
}
