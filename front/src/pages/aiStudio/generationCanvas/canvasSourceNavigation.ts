import type { CanvasDocument, CanvasSourceIndex } from '../../../services/generated'
import { designFieldEntries } from './designFieldReferences'

type TextRange = { start: number; end: number; excerpt: string }
export type CanvasSourceFocus = { cardId: string; serial: number; selector?: string; fieldId?: string; segmentId?: string; range?: TextRange }

/** 用稳定身份和原始证据核对区间。Python 偏移按码点，浏览器选择按 UTF-16。 */
export function sourceDestination(document: CanvasDocument, source: CanvasSourceIndex) {
  const card = document.cards?.find(value => value.id === source.card_id)
  if (!card) return { issue: '来源卡片已删除或不可用' }
  const fieldId = source.source_field_id || undefined
  const field = fieldId ? designFieldEntries(card).find(([id]) => id === fieldId)?.[1] : undefined
  const segmentId = source.segment_id || undefined
  const segments = field?.document?.segments || ('prompt' in card ? card.prompt?.segments : undefined)
  const segment = segmentId ? segments?.find(item => item.id === segmentId) : undefined
  const selector = field ? `[data-design-field="${CSS.escape(fieldId!)}"]`
    : fieldId ? undefined : 'text' in card ? '.generation-text-content-editor textarea, .generation-description-input'
      : 'prompt' in card ? '[data-diagnostic-control="prompt"]' : undefined
  const hasRange = typeof source.start === 'number' || typeof source.end === 'number' || !!source.excerpt
  const focus = (selector && (fieldId || segmentId || hasRange)) ? { cardId: card.id, selector, fieldId, segmentId } : { cardId: card.id }
  if (fieldId && !field) return { focus, issue: '原位置已失效，仅定位卡片' }
  if (segmentId && !segment) return { focus: { ...focus, segmentId: undefined }, issue: '原位置已失效，仅定位卡片或字段' }
  if (!hasRange) return { focus }
  const text = segment ? segment.kind === 'text' ? segment.text : undefined
    : field ? field.text : 'text' in card ? card.text : undefined
  const points = Array.from(text || '')
  const { start, end, excerpt, source_version: version } = source
  const fixed = document.fixed_source
  if (!selector || !excerpt || typeof start !== 'number' || typeof end !== 'number' || !Number.isInteger(start) || !Number.isInteger(end)
      || start < 0 || end <= start || end > points.length || points.slice(start, end).join('') !== excerpt
      || fixed?.card_id === card.id && version && fixed.chapter_version !== version) {
    return { focus, issue: '来源文本已变化，仅定位卡片或字段' }
  }
  const prefix = points.slice(0, start).join('')
  const textarea = !fieldId && !segmentId && 'text' in card
  const offset = textarea ? prefix.replace(/\r\n?/g, '\n').length : prefix.length
  const quote = textarea ? excerpt.replace(/\r\n?/g, '\n') : excerpt
  return { focus: { ...focus, range: { start: offset, end: offset + quote.length, excerpt: quote } } }
}

/** 原生选区不会把长正文滚到选中处，按当前输入框的实际换行测量目标行。 */
function revealTextareaRange(control: HTMLTextAreaElement, start: number) {
  if (control.scrollHeight <= control.clientHeight) return
  const owner = control.ownerDocument
  const style = owner.defaultView!.getComputedStyle(control)
  const mirror = owner.createElement('div')
  Object.assign(mirror.style, {
    position: 'fixed', left: '-10000px', top: '0', visibility: 'hidden', boxSizing: 'border-box',
    width: `${control.clientWidth}px`, padding: style.padding, font: style.font, lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing, tabSize: style.tabSize, whiteSpace: control.wrap === 'off' ? 'pre' : 'pre-wrap',
    overflowWrap: 'break-word',
  })
  const marker = owner.createElement('span')
  const character = String.fromCodePoint(control.value.codePointAt(start)!)
  marker.textContent = character
  mirror.append(control.value.slice(0, start), marker, control.value.slice(start + character.length))
  owner.body.append(mirror)
  const row = marker.getBoundingClientRect(), box = mirror.getBoundingClientRect()
  const top = row.top - box.top, bottom = row.bottom - box.top
  mirror.remove()
  if (top < control.scrollTop || bottom > control.scrollTop + control.clientHeight) control.scrollTop = top - control.clientHeight / 3
}

/** 在实际卡片详情中定位，控件内容与保存证据不符时不选中其他文字。 */
export function focusSourcePosition(panel: HTMLElement, target: CanvasSourceFocus): 'located' | 'waiting' | 'changed' {
  const field = target.selector && panel.querySelector<HTMLElement>(target.selector)
  if (!field || field.closest('[inert]')) return 'waiting'
  const control = field.matches('textarea, [role="textbox"]') ? field
    : field.querySelector<HTMLElement>('textarea, [role="textbox"]') || field
  const part = target.segmentId ? control.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(target.segmentId)}"]`) : control
  if (!part || !part.getClientRects().length) return 'waiting'
  const { range } = target
  const destination = (target.segmentId && !range ? part : control).matches(':disabled') ? field : target.segmentId && !range ? part : control
  if (destination.tabIndex < 0) destination.tabIndex = -1
  destination.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  destination.focus({ preventScroll: true })
  if (!range) return 'located'
  const text = part instanceof HTMLTextAreaElement ? part.value : part.textContent || ''
  if (text.slice(range.start, range.end) !== range.excerpt) return 'changed'
  if (part instanceof HTMLTextAreaElement) {
    part.setSelectionRange(range.start, range.end)
    revealTextareaRange(part, range.start)
    return 'located'
  }
  const owner = part.ownerDocument
  const walker = owner.createTreeWalker(part, NodeFilter.SHOW_TEXT)
  const selection = owner.getSelection(), selected = owner.createRange()
  let offset = 0, started = false
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const limit = offset + (node.textContent?.length || 0)
    if (!started && range.start < limit) { selected.setStart(node, range.start - offset); started = true }
    if (started && range.end <= limit) {
      selected.setEnd(node, range.end - offset)
      selection?.removeAllRanges(); selection?.addRange(selected)
      for (let ancestor: HTMLElement | null = part; ancestor && panel.contains(ancestor); ancestor = ancestor.parentElement) {
        if (ancestor.scrollHeight <= ancestor.clientHeight || !/^(auto|scroll)$/.test(getComputedStyle(ancestor).overflowY)) continue
        const box = ancestor.getBoundingClientRect(), row = selected.getBoundingClientRect()
        if (row.top < box.top || row.bottom > box.bottom) ancestor.scrollTop += row.top - box.top - 8
      }
      return 'located'
    }
    offset = limit
  }
  return 'changed'
}
