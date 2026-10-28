import { useLayoutEffect, useRef, useState } from 'react'
import { Button, Input, Select, Space } from 'antd'
import type { CanvasDocument, PromptText } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import type { EditorPromptDocument as PromptDocument, EditorPromptReference as PromptReference, EditorPromptInstruction as PromptInstruction } from './inputBindings'
import { referenceIssue, sourceKey, referencesIn } from './promptRules'
import type { Candidate } from './promptRules'

const MIME = 'application/x-jellyfish-prompt+json'
function validClipboardSegment(segment: unknown): boolean {
  if (!segment || typeof segment !== 'object') return false
  const value = segment as Record<string, unknown>
  if (typeof value.id !== 'string' || !value.id || value.id.length > 128) return false
  if (value.kind === 'text') return typeof value.text === 'string'
  if (value.kind === 'reference') {
    const source = value.source as Record<string, unknown> | undefined
    return !!source && ['canvas_id', 'card_id', 'port_id'].every(key => typeof source[key] === 'string' && (source[key] as string).length > 0) && Number.isInteger(source.position) && (source.position as number) >= 0
  }
  return value.kind === 'instruction' && typeof value.command === 'string' && Array.isArray(value.references) && value.references.every(reference => validClipboardSegment(reference) && reference.kind === 'reference') && (!value.parameters || typeof value.parameters === 'object' && !Array.isArray(value.parameters))
}
function copyClipboardSegment(segment: NonNullable<PromptDocument['segments']>[number]): NonNullable<PromptDocument['segments']>[number] {
  return segment.kind === 'instruction' ? { ...segment, id: crypto.randomUUID(), references: segment.references?.map(reference => ({ ...reference, id: crypto.randomUUID() })) } : { ...segment, id: crypto.randomUUID() }
}
/** 绑定身份回填不改变编辑内容；避免仅元数据变化时重建 DOM、清空活动光标。 */
function contentKey(document: PromptDocument) {
  const reference = (item: PromptReference) => ({ id: item.id, kind: item.kind, source: item.source })
  return JSON.stringify((document.segments || []).map(segment => segment.kind === 'reference' ? reference(segment) : segment.kind === 'instruction' ? { ...segment, references: (segment.references || []).map(reference) } : segment))
}

/** DOM 仅作为输入表面；持久值是有稳定身份的片段，组合输入期间不重建 DOM。 */
export function PromptEditor({ document, card, value, onChange, disabled, candidates = [] }: { document: CanvasDocument; card: GenerationCard; value: PromptDocument; onChange: (value: PromptDocument) => void; disabled?: boolean; candidates?: Candidate[] }) {
  const root = useRef<HTMLDivElement>(null), composing = useRef(false), local = useRef(value), renderedContent = useRef('')
  const [category, setCategory] = useState('text'), [query, setQuery] = useState(''), [activeIndex, setActiveIndex] = useState(0)
  local.current = value
  const matches = candidates.filter(item => item.available && item.source.port_id === category && (query === '@' || item.token.startsWith(query)))
  const label = (reference: PromptReference) => candidates.find(item => sourceKey(item.source) === sourceKey(reference.source))?.token || `@缺失(${reference.source.card_id}:${reference.source.position + 1})`
  const draw = (next: PromptDocument) => {
    if (!root.current) return
    root.current.replaceChildren(...(next.segments || []).map(segment => {
      if (segment.kind === 'text') { const node = window.document.createElement('span'); node.dataset.textId = segment.id; node.textContent = segment.text || ''; return node }
      const node = window.document.createElement('span'); node.contentEditable = 'false'; node.dataset.segment = JSON.stringify(segment); node.dataset.segmentId = segment.id
      node.className = 'generation-prompt-token'
      node.textContent = segment.kind === 'reference' ? label(segment) : `/${segment.command}`
      if (segment.kind === 'reference') { node.title = referenceIssue(document, card, segment.source, candidates); node.dataset.invalid = String(!!node.title) }
      return node
    }))
    renderedContent.current = contentKey(next)
  }
  useLayoutEffect(() => {
    if (!composing.current && contentKey(value) !== renderedContent.current) draw(value)
    const segments = new Map((value.segments || []).map(segment => [segment.id, segment]))
    root.current?.querySelectorAll<HTMLElement>('[data-segment]').forEach(node => {
      const previous = JSON.parse(node.dataset.segment!)
      const segment = segments.get(previous.id) || previous
      node.dataset.segment = JSON.stringify(segment)
      node.dataset.segmentId = segment.id
      if (segment.kind === 'reference') { const text = label(segment); if (node.textContent !== text) node.textContent = text; node.title = referenceIssue(document, card, segment.source, candidates); node.dataset.invalid = String(!!node.title) }
    })
  })
  const textIds = useRef(new WeakMap<Node, string>())
  const readNodes = (container: Node): PromptDocument => {
    const segments: NonNullable<PromptDocument['segments']> = []
    const appendText = (node: Node, text: string) => {
      if (!text) return
      let id = textIds.current.get(node)
      if (!id) { id = node.parentElement?.dataset.textId || crypto.randomUUID(); if (segments.some(segment => segment.id === id)) id = crypto.randomUUID(); textIds.current.set(node, id) }
      segments.push({ kind: 'text', id, text })
    }
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { appendText(node, node.textContent || ''); return }
      if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return
      if (node instanceof HTMLElement && node.dataset.segment) { segments.push(JSON.parse(node.dataset.segment)); return }
      if (node instanceof HTMLElement && node.tagName === 'BR') { appendText(node, '\n'); return }
      if (node instanceof HTMLElement && ['DIV', 'P'].includes(node.tagName) && segments.length) appendText(node, '\n')
      node.childNodes.forEach(visit)
    }
    container.childNodes.forEach(visit)
    return { segments }
  }
  const read = () => root.current ? readNodes(root.current) : { segments: [] }
  const publish = (next: PromptDocument, redraw = false) => { local.current = next; renderedContent.current = contentKey(next); onChange(next); if (redraw) draw(next) }
  const confirm = (finalize = false) => {
    if (composing.current) return false
    const selection = window.getSelection()
    let caret: number | undefined
    if (root.current && selection?.rangeCount && root.current.contains(selection.anchorNode)) { const before = selection.getRangeAt(0).cloneRange(); before.selectNodeContents(root.current); before.setEnd(selection.anchorNode!, selection.anchorOffset); caret = before.toString().length }
    const next = read(), segments: NonNullable<PromptDocument['segments']> = []; let changed = false
    for (const segment of next.segments || []) {
      if (segment.kind !== 'text') { segments.push(segment); continue }
      const text = segment.text || '', expression = /(?<!\\)@(?:文本|图片|视频|音频)\d+(?=$|[\s,;:()，。；：、（）!?！？])/g
      let start = 0
      for (const match of text.matchAll(expression)) {
        const candidate = candidates.find(item => item.token === match[0] && item.available)
        if (!candidate) continue
        if (match.index! > start) segments.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start, match.index) })
        segments.push({ id: crypto.randomUUID(), kind: 'reference', source: candidate.source }); start = match.index! + match[0].length; changed = true
      }
      if (start < text.length) segments.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start) })
    }
    // 仅解释本地显式指令，连续结构化引用构成参数；遇到正文结束。
    if (finalize) {
      const split: NonNullable<PromptDocument['segments']> = []
      for (const segment of segments) {
        if (segment.kind !== 'text') { split.push(segment); continue }
        const text = segment.text || '', command = /(?<!\\)\/(首帧参考|尾帧参考|关键帧参考|主体参考)(?:[ \t]+"[^"]*")?[ \t]*/g
        let start = 0
        for (const match of text.matchAll(command)) {
          if (match.index! > start) split.push({ ...segment, id: crypto.randomUUID(), text: text.slice(start, match.index) })
          split.push({ ...segment, id: crypto.randomUUID(), text: match[0] }); start = match.index! + match[0].length
        }
        if (start < text.length) split.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start) })
      }
      segments.splice(0, segments.length, ...split)
    }
    const structured: NonNullable<PromptDocument['segments']> = []
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      const match = segment.kind === 'text' ? (segment.text || '').match(/(?<!\\)\/(首帧参考|尾帧参考|关键帧参考|主体参考)(?:\s+"([^"]*)")?\s*$/) : null
      if (!finalize || !match) { structured.push(segment); continue }
      const text = (segment as PromptText).text || '', prefix = text.slice(0, match.index)
      if (prefix) structured.push({ ...segment as PromptText, text: prefix })
      const instruction: PromptInstruction = { kind: 'instruction', id: crypto.randomUUID(), command: match[1], parameters: match[2] !== undefined ? { name: match[2] } : {}, references: [] }
      while (index + 1 < segments.length) {
        const nextSegment = segments[index + 1]
        if (nextSegment.kind === 'reference') { instruction.references!.push(nextSegment); index++; continue }
        if (nextSegment.kind === 'text' && /^\s+$/.test(nextSegment.text || '') && segments[index + 2]?.kind === 'reference') { index++; continue }
        break
      }
      structured.push(instruction); changed = true
    }
    publish({ segments: structured }, changed)
    if (changed && root.current && caret !== undefined) {
      const range = window.document.createRange(), walker = window.document.createTreeWalker(root.current, NodeFilter.SHOW_TEXT)
      let remaining = caret, node = walker.nextNode(), positioned = false
      while (node) {
        if (remaining <= (node.textContent?.length || 0)) {
          if (node.parentElement?.contentEditable === 'false') range.setStartAfter(node.parentElement)
          else range.setStart(node, remaining)
          positioned = true; break
        }
        remaining -= node.textContent?.length || 0; node = walker.nextNode()
      }
      if (!positioned) { range.selectNodeContents(root.current); range.collapse(false) } else range.collapse(true)
      selection?.removeAllRanges(); selection?.addRange(range)
    }
    return changed
  }
  const insert = (reference: PromptReference) => {
    const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
    if (range && root.current?.contains(range.commonAncestorContainer)) {
      if (query && range.startContainer.nodeType === Node.TEXT_NODE && (range.startContainer.textContent || '').slice(0, range.startOffset).endsWith(query)) range.setStart(range.startContainer, range.startOffset - query.length)
      range.deleteContents(); setQuery(''); const node = window.document.createElement('span'); node.contentEditable = 'false'; node.dataset.segment = JSON.stringify(reference); node.className = 'generation-prompt-token'; node.textContent = label(reference)
      range.insertNode(node); range.setStartAfter(node); range.collapse(true); selection?.removeAllRanges(); selection?.addRange(range); publish(read()); root.current?.focus()
    } else { const next = read(); next.segments = [...(next.segments || []), reference, { id: crypto.randomUUID(), kind: 'text', text: ' ' }]; publish(next, true); root.current?.focus() }
  }
  return <>
    <Space wrap>
      {card.type === 'model.video' && <Select<string> disabled={disabled} aria-label="系统指令" placeholder="添加系统指令" value={undefined} options={['首帧参考', '尾帧参考', '关键帧参考', '主体参考'].map(command => ({ value: command, label: `/${command}` }))}
        onChange={command => { if (command) publish({ segments: [...(read().segments || []), { id: crypto.randomUUID(), kind: 'instruction', command, parameters: {}, references: [] }] }, true) }} />}
      <Select aria-label="引用分类" value={category} onChange={setCategory} options={Object.entries({ text: '文本', image: '图片', video: '视频', audio: '音频' }).map(([value, label]) => ({ value, label }))} />
      {candidates.filter(item => item.source.port_id === category).map(item => <Button key={sourceKey(item.source)} size="small" disabled={disabled || !item.available} onClick={() => insert({ id: crypto.randomUUID(), kind: 'reference', source: item.source })}>{item.token}{!item.available && ' 缺失'}</Button>)}
      {query && <small role="status">匹配 {query}；完整代号确认后绑定</small>}
    </Space>
    {(value.segments || []).filter((segment): segment is PromptInstruction => segment.kind === 'instruction').map(instruction => <section key={instruction.id} aria-label={`指令 ${instruction.command}`} data-instruction-id={instruction.id} data-segment-id={instruction.id}>
      <strong>/{instruction.command}</strong>
      {instruction.command === '主体参考' && <Input disabled={disabled} aria-label="主体名称" value={instruction.parameters?.name || ''} onChange={event => publish({ segments: (value.segments || []).map(segment => segment.id === instruction.id ? { ...instruction, parameters: { ...instruction.parameters, name: event.target.value } } : segment) }, true)} />}
      <Select<string[]> disabled={disabled} aria-label={`指令引用 ${instruction.command}`} mode="multiple" value={(instruction.references || []).map(reference => sourceKey(reference.source))}
        options={candidates.filter(candidate => candidate.available).map(candidate => ({ value: sourceKey(candidate.source), label: candidate.token }))}
        onChange={keys => publish({ segments: (value.segments || []).map(segment => segment.id === instruction.id ? { ...instruction, references: keys.map(key => instruction.references?.find(reference => sourceKey(reference.source) === key) || { id: crypto.randomUUID(), kind: 'reference', source: candidates.find(candidate => sourceKey(candidate.source) === key)!.source }) } : segment) }, true)} />
      <Button disabled={disabled} size="small" onClick={() => publish({ segments: (value.segments || []).filter(segment => segment.id !== instruction.id) }, true)}>删除指令</Button>
      {!instruction.references?.length && <small role="alert">指令缺少引用，可继续编辑保存</small>}
    </section>)}
    {query && <div role="listbox" aria-label="引用候选" onMouseDown={event => event.preventDefault()}>
      {matches.map((item, index) => <button type="button" key={sourceKey(item.source)} role="option" aria-selected={index === activeIndex % Math.max(1, matches.length)} onClick={() => insert({ id: crypto.randomUUID(), kind: 'reference', source: item.source })}>{item.token}</button>)}
      {!matches.length && <small>没有匹配的实际输出；可切换引用分类</small>}
    </div>}
    <div ref={root} role="textbox" aria-label="模型正文" aria-multiline="true" contentEditable={!disabled} suppressContentEditableWarning className="generation-prompt-editor"
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; publish(read()); if (/[\s,;:()，。；：、（）!?！？]$/.test(root.current?.textContent || '')) confirm() }}
      onInput={() => {
        const next = read(); publish(next)
        if (composing.current) return
        const text = root.current?.textContent || '', nextQuery = text.match(/(?<!\\)@[^\s]*$/)?.[0] || ''
        setQuery(nextQuery); setActiveIndex(0)
        const label = nextQuery.match(/^@(文本|图片|视频|音频)/)?.[1]
        if (label) setCategory(({ 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' } as Record<string, string>)[label])
        if (/[\s,;:()，。；：、（）!?！？]$/.test(text)) confirm()
      }}
      onKeyDown={event => {
        if (composing.current || event.nativeEvent.isComposing) return
        if (query && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); setActiveIndex(previous => Math.max(0, previous + (event.key === 'ArrowDown' ? 1 : -1))); return }
        if (['Enter', 'Tab'].includes(event.key)) {
          if (query === '@' && matches.length) { event.preventDefault(); insert({ id: crypto.randomUUID(), kind: 'reference', source: matches[activeIndex % matches.length].source }); return }
          if (confirm(true)) { event.preventDefault(); setQuery('') }
        }
      }} onBlur={() => { confirm(true); requestAnimationFrame(() => { if (!root.current?.contains(window.document.activeElement)) setQuery('') }) }}
      onCopy={event => {
        const selection = window.getSelection(); if (!selection?.rangeCount) return
        const fragment = selection.getRangeAt(0).cloneContents(), box = window.document.createElement('div'); box.append(fragment)
        const segments = readNodes(box).segments || []
        event.clipboardData.setData(MIME, JSON.stringify({ canvas_id: document.id, segments })); event.clipboardData.setData('text/plain', selection.toString()); event.preventDefault()
      }}
      onPaste={event => {
        const payload = event.clipboardData.getData(MIME); event.preventDefault()
        let segments: NonNullable<PromptDocument['segments']> | undefined
        if (payload && payload.length < 1000000) try {
          const parsed = JSON.parse(payload)
          if (Array.isArray(parsed.segments) && parsed.segments.length <= 10000 && parsed.segments.every(validClipboardSegment)) segments = parsed.segments.map(copyClipboardSegment)
        } catch { /* Invalid clipboard data falls back to literal text. */ }
        const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
        if (range && root.current?.contains(range.commonAncestorContainer)) {
          range.deleteContents(); const fragment = window.document.createDocumentFragment()
          if (segments) for (const segment of segments) { const span = window.document.createElement('span'); if (segment.kind !== 'text') { span.contentEditable = 'false'; span.dataset.segment = JSON.stringify(segment); span.className = 'generation-prompt-token'; span.textContent = segment.kind === 'reference' ? label(segment) : `/${segment.command}` } else span.textContent = segment.text || ''; fragment.append(span) }
          else fragment.append(window.document.createTextNode(event.clipboardData.getData('text/plain')))
          range.insertNode(fragment); publish(read()); if (!segments) confirm()
        }
      }} />
    {(value.segments || []).filter(segment => segment.kind === 'text' && /(?<!\\)@(?:文本|图片|视频|音频)\d*/.test(segment.text || '')).map(segment => <small role="alert" key={segment.id}>代号尚未确认或不存在；按完整代号选择实际输出</small>)}
    {referencesIn(value).map(segment => referenceIssue(document, card, segment.source, candidates) && <small role="alert" key={segment.id} data-diagnostic-segment={segment.id}>{label(segment)}：{referenceIssue(document, card, segment.source, candidates)}</small>)}
  </>
}
