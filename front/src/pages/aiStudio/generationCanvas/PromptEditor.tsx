import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Select, Space } from 'antd'
import type { CanvasDocument, PromptDocument, PromptReference, PromptText } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { promptCandidates, referenceIssue, sourceKey } from './promptRules'

const MIME = 'application/x-jellyfish-prompt+json'
/** DOM 仅作为输入表面；持久值是有稳定身份的片段，组合输入期间不重建 DOM。 */
export function PromptEditor({ document, card, value, onChange, disabled }: { document: CanvasDocument; card: GenerationCard; value: PromptDocument; onChange: (value: PromptDocument) => void; disabled?: boolean }) {
  const root = useRef<HTMLDivElement>(null), composing = useRef(false), local = useRef(value), last = useRef('')
  const [category, setCategory] = useState('text'), [query, setQuery] = useState('')
  const candidates = promptCandidates(document, card)
  local.current = value
  const label = (reference: PromptReference) => candidates.find(item => sourceKey(item.source) === sourceKey(reference.source))?.token || `@缺失(${reference.source.card_id}:${reference.source.position + 1})`
  const draw = (next: PromptDocument) => {
    if (!root.current) return
    root.current.replaceChildren(...(next.segments || []).map(segment => {
      if (segment.kind === 'text') { const node = window.document.createElement('span'); node.dataset.textId = segment.id; node.textContent = segment.text || ''; return node }
      const node = window.document.createElement('span'); node.contentEditable = 'false'; node.dataset.segment = JSON.stringify(segment); node.dataset.segmentId = segment.id
      node.className = 'generation-prompt-token'
      node.textContent = segment.kind === 'reference' ? label(segment) : `/${segment.command}`
      if (segment.kind === 'reference') { node.title = referenceIssue(document, card, segment.source); node.dataset.invalid = String(!!node.title) }
      return node
    }))
    last.current = JSON.stringify(next)
  }
  useLayoutEffect(() => {
    if (!composing.current && JSON.stringify(value) !== last.current) draw(value)
    root.current?.querySelectorAll<HTMLElement>('[data-segment]').forEach(node => {
      const segment = JSON.parse(node.dataset.segment!)
      if (segment.kind === 'reference') { node.textContent = label(segment); node.title = referenceIssue(document, card, segment.source); node.dataset.invalid = String(!!node.title) }
    })
  })
  const read = (): PromptDocument => {
    const segments: NonNullable<PromptDocument['segments']> = []
    root.current?.childNodes.forEach(node => {
      const element = node instanceof HTMLElement ? node : undefined
      if (element?.dataset.segment) segments.push(JSON.parse(element.dataset.segment))
      else {
        const text = node.textContent || ''
        if (text) segments.push({ kind: 'text', id: element?.dataset.textId || crypto.randomUUID(), text })
      }
    })
    return { segments }
  }
  const publish = (next: PromptDocument, redraw = false) => { local.current = next; last.current = JSON.stringify(next); onChange(next); if (redraw) draw(next) }
  const confirm = () => {
    if (composing.current) return false
    const next = read(), segments: NonNullable<PromptDocument['segments']> = []; let changed = false
    for (const segment of next.segments || []) {
      if (segment.kind !== 'text') { segments.push(segment); continue }
      const text = segment.text || '', expression = /(?<!\\)@(?:文本|图片|视频|音频)\d+(?=$|[\s，。；、!?！？])/g
      let start = 0
      for (const match of text.matchAll(expression)) {
        const candidate = candidates.find(item => item.token === match[0] && item.available)
        if (!candidate) continue
        if (match.index! > start) segments.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start, match.index) })
        segments.push({ id: crypto.randomUUID(), kind: 'reference', source: candidate.source }); start = match.index! + match[0].length; changed = true
      }
      if (start < text.length) segments.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start) })
    }
    publish({ segments }, changed)
    if (changed && root.current && window.document.activeElement === root.current) { const range = window.document.createRange(); range.selectNodeContents(root.current); range.collapse(false); const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range) }
    return changed
  }
  const insert = (reference: PromptReference) => {
    const next = read(); next.segments = [...(next.segments || []), reference, { id: crypto.randomUUID(), kind: 'text', text: ' ' }]; publish(next, true); root.current?.focus()
  }
  return <>
    <Space wrap><Select aria-label="引用分类" value={category} onChange={setCategory} options={Object.entries({ text: '文本', image: '图片', video: '视频', audio: '音频' }).map(([value, label]) => ({ value, label }))} />
      {candidates.filter(item => item.source.port_id === category).map(item => <Button key={sourceKey(item.source)} size="small" disabled={disabled || !item.available} onClick={() => insert({ id: crypto.randomUUID(), kind: 'reference', source: item.source })}>{item.token}{!item.available && ' 缺失'}</Button>)}
      {query && <small role="status">匹配 {query}；完整代号确认后绑定</small>}
    </Space>
    <div ref={root} role="textbox" aria-label="模型正文" aria-multiline="true" contentEditable={!disabled} suppressContentEditableWarning className="generation-prompt-editor"
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; publish(read()) }}
      onInput={() => { const next = read(); publish(next); const text = root.current?.textContent || ''; setQuery(text.match(/@[^\s]*$/)?.[0] || ''); if (!composing.current && /[\s，。；、!?！？]$/.test(text)) confirm() }}
      onKeyDown={event => { if (!composing.current && !event.nativeEvent.isComposing && ['Enter', 'Tab'].includes(event.key) && confirm()) event.preventDefault() }} onBlur={confirm}
      onCopy={event => {
        const selection = window.getSelection(); if (!selection?.rangeCount) return
        const fragment = selection.getRangeAt(0).cloneContents(), box = window.document.createElement('div'); box.append(fragment)
        const segments: NonNullable<PromptDocument['segments']> = []
        box.childNodes.forEach(node => {
          if (node instanceof HTMLElement && node.dataset.segment) segments.push(JSON.parse(node.dataset.segment))
          else if (node.textContent) segments.push({ id: crypto.randomUUID(), kind: 'text', text: node.textContent })
        })
        event.clipboardData.setData(MIME, JSON.stringify({ canvas_id: document.id, segments })); event.clipboardData.setData('text/plain', selection.toString()); event.preventDefault()
      }}
      onPaste={event => {
        const payload = event.clipboardData.getData(MIME); event.preventDefault()
        let segments: NonNullable<PromptDocument['segments']> | undefined
        if (payload && payload.length < 1000000) try {
          const parsed = JSON.parse(payload)
          if (Array.isArray(parsed.segments) && parsed.segments.every((segment: PromptText | PromptReference) => typeof segment.id === 'string' && (segment.kind === 'text' && typeof segment.text === 'string' || segment.kind === 'reference' && typeof segment.source?.canvas_id === 'string' && typeof segment.source.card_id === 'string' && typeof segment.source.port_id === 'string' && Number.isInteger(segment.source.position) && segment.source.position >= 0))) segments = parsed.segments.map((segment: PromptText | PromptReference) => ({ ...segment, id: crypto.randomUUID() }))
        } catch { /* Invalid clipboard data falls back to literal text. */ }
        const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
        if (range && root.current?.contains(range.commonAncestorContainer)) {
          range.deleteContents(); const fragment = window.document.createDocumentFragment()
          if (segments) for (const segment of segments) { const span = window.document.createElement('span'); if (segment.kind === 'reference') { span.contentEditable = 'false'; span.dataset.segment = JSON.stringify(segment); span.textContent = label(segment) } else span.textContent = segment.kind === 'text' ? segment.text || '' : ''; fragment.append(span) }
          else fragment.append(window.document.createTextNode(event.clipboardData.getData('text/plain')))
          range.insertNode(fragment); publish(read()); if (!segments) confirm()
        }
      }} />
    {(value.segments || []).filter(segment => segment.kind === 'reference').map(segment => segment.kind === 'reference' && referenceIssue(document, card, segment.source) && <small role="alert" key={segment.id} data-diagnostic-segment={segment.id}>{label(segment)}：{referenceIssue(document, card, segment.source)}</small>)}
  </>
}
