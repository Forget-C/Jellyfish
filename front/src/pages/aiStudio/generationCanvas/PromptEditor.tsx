import { useUiText } from '../../../uiText'
import { promptInputPort } from './inputBindings'
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { Ref } from 'react'
import { FileTextOutlined, PictureOutlined } from '@ant-design/icons'
import { buildFileDownloadUrl } from '../assets/utils'
import { createPortal, flushSync } from 'react-dom'
import { Button, Input, Popover, Select, Space } from 'antd'
import type { CanvasDocument, OutputIdentity, PromptText } from '../../../services/generated'
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
  return JSON.stringify((document.segments || []).map(segment => segment.kind === 'reference' ? reference(segment) : segment.kind === 'instruction' ? { ...segment, references: (segment.references || []).map(reference) } : { id: segment.id, kind: segment.kind, text: segment.text || '', ...(segment.literal ? { literal: true } : {}) }))
}

/** 关联区与正文候选共用引用插入入口；模型通过绑定保存来源，设计宿主通过字段文档保存来源。 */
export type PromptEditorHandle = { insertReference: (source: OutputIdentity) => void; readVisible: () => PromptDocument }

/** DOM 仅作为输入表面；持久值是有稳定身份的片段，组合输入期间不重建 DOM。 */
export function PromptEditor({ compact = false, onSubmit, submitDisabled, toolsHost, document, card, value, onChange, disabled, candidates: incomingCandidates = [], referenceActionsRef, fieldLabel, fieldDescriptionId, fieldPlaceholder, allReferences = false }: { fieldLabel?: string; fieldDescriptionId?: string; fieldPlaceholder?: string; allReferences?: boolean; referenceActionsRef?: Ref<PromptEditorHandle>; compact?: boolean; onSubmit?: () => void; submitDisabled?: boolean; toolsHost?: HTMLElement | null; document: CanvasDocument; card: GenerationCard; value: PromptDocument; onChange: (value: PromptDocument) => void; disabled?: boolean; candidates?: Candidate[] }) {
  const uiText = useUiText()
  const root = useRef<HTMLDivElement>(null), composing = useRef(false), local = useRef(value), renderedContent = useRef('')
  const [category, setCategory] = useState('text'), [query, setQuery] = useState(''), [activeKey, setActiveKey] = useState<string | null>()
  const stableCandidates = useRef(incomingCandidates)
  if (!composing.current) stableCandidates.current = incomingCandidates
  const candidates = stableCandidates.current
  const [, refreshLabels] = useState(0)
  local.current = value
  const imageMentions = card.type === 'model.image' || allReferences
  const [popupAnchor, setPopupAnchor] = useState({ left: 0, top: 0, height: 24, width: 320 })
  const listId = useId(), list = useRef<HTMLDivElement>(null), savedRange = useRef<Range>()
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform)
  const placeholder = fieldPlaceholder || uiText("描述你想生成的内容，关联参考用于补充上下文。回车发送，{{key}}＋回车换行", { key: isMac ? 'Command' : 'Ctrl' })
  const matching = (text: string) => candidates.filter(item => (imageMentions || item.available && (item.source.port_id === category || !!item.displayLabel && item.displayLabel !== item.token)) &&
    (text === '@' || item.token.startsWith(text) || item.displayLabel?.toLocaleLowerCase().includes(text.slice(1).toLocaleLowerCase()) || imageMentions && item.name?.toLocaleLowerCase().includes(text.slice(1).toLocaleLowerCase())))
  const matches = matching(query).sort((left, right) => Number(right.token === query) - Number(left.token === query))
  const selectable = matches.filter(item => item.available && !item.disabledReason)
  const active = activeKey === undefined ? selectable[0] : selectable.find(item => sourceKey(item.source) === activeKey)
  useLayoutEffect(() => {
    if (!query) return
    if (activeKey === undefined) setActiveKey(selectable[0] ? sourceKey(selectable[0].source) : null)
    else if (activeKey !== null && !active) setActiveKey(null)
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [query, activeKey, selectable, active])
  const positionPopup = () => {
    if (!root.current) return
    const field = root.current.getBoundingClientRect(), selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
    const caret = range && root.current.contains(range.commonAncestorContainer) ? range.getBoundingClientRect() : undefined
    setPopupAnchor({ left: field.left, top: caret?.height ? caret.top : field.top, height: caret?.height || 24, width: Math.min(field.width, 480) })
  }
  useEffect(() => {
    if (!imageMentions || !query || !root.current) return
    const scroll = (event: Event) => { if (!(event.target instanceof Node) || !list.current?.contains(event.target)) positionPopup() }
    const observer = new ResizeObserver(positionPopup); observer.observe(root.current)
    window.addEventListener('resize', positionPopup); window.addEventListener('scroll', scroll, true)
    return () => { observer.disconnect(); window.removeEventListener('resize', positionPopup); window.removeEventListener('scroll', scroll, true) }
  }, [imageMentions, query])
  const rememberSelection = () => {
    const selection = window.getSelection()
    if (selection?.rangeCount && root.current?.contains(selection.getRangeAt(0).commonAncestorContainer)) savedRange.current = selection.getRangeAt(0).cloneRange()
  }
  const textBeforeCaret = () => {
    const selection = window.getSelection(), node = selection?.anchorNode
    return node?.nodeType === Node.TEXT_NODE && root.current?.contains(node) && selection?.isCollapsed && node.parentElement?.contentEditable !== 'false' ? (node.textContent || '').slice(0, selection.anchorOffset) : ''
  }
  const updateQuery = () => {
    rememberSelection()
    if (composing.current) return
    const text = textBeforeCaret()
    const nextQuery = text.match(/(?<!\\)@[^@\s,;:()，。；：、（）!?！？]*$/)?.[0] || ''
    setQuery(nextQuery); if (nextQuery !== query) setActiveKey(undefined)
    if (imageMentions && nextQuery) positionPopup()
    const label = nextQuery.match(/^@(文本|图片|视频|音频)/)?.[1]
    if (label) setCategory(({ 文本: 'text', 图片: 'image', 视频: 'video', 音频: 'audio' } as Record<string, string>)[label])
  }
  const label = (reference: PromptReference) => {
    const candidate = candidates.find(item => sourceKey(item.source) === sourceKey(reference.source))
    return candidate?.displayLabel || candidate?.token || uiText("@缺失({{card_id}}:{{value2}})", { card_id: reference.source.card_id, value2: reference.source.position + 1 })
  }
  const draw = (next: PromptDocument) => {
    if (!root.current) return
    root.current.replaceChildren(...(next.segments || []).map(segment => {
      if (segment.kind === 'text') { const node = window.document.createElement('span'); node.dataset.textId = segment.id; node.dataset.segmentId = segment.id; if (segment.literal) node.dataset.literalText = 'true'; node.textContent = segment.text || ''; return node }
      const node = window.document.createElement('span'); node.contentEditable = 'false'; node.dataset.segment = JSON.stringify(segment); node.dataset.segmentId = segment.id
      node.className = 'generation-prompt-token'
      node.textContent = segment.kind === 'reference' ? label(segment) : `/${segment.command}`
      if (segment.kind === 'reference') { node.title = uiText(referenceIssue(document, card, segment.source, candidates)); node.dataset.invalid = String(!!node.title) }
      return node
    }))
    renderedContent.current = contentKey(next)
  }
  useLayoutEffect(() => {
    if (composing.current) return
    if (contentKey(value) !== renderedContent.current) draw(value)
    const segments = new Map((value.segments || []).map(segment => [segment.id, segment]))
    root.current?.querySelectorAll<HTMLElement>('[data-segment]').forEach(node => {
      const previous = JSON.parse(node.dataset.segment!)
      const segment = segments.get(previous.id) || previous
      node.dataset.segment = JSON.stringify(segment)
      node.dataset.segmentId = segment.id
      if (segment.kind === 'reference') { const text = label(segment); if (node.textContent !== text) node.textContent = text; node.title = uiText(referenceIssue(document, card, segment.source, candidates)); node.dataset.invalid = String(!!node.title) }
    })
  })
  const textIds = useRef(new WeakMap<Node, string>())
  const readNodes = (container: Node): PromptDocument => {
    const segments: NonNullable<PromptDocument['segments']> = []
    const appendText = (node: Node, text: string) => {
      if (!text) return
      let id = textIds.current.get(node)
      if (!id) { id = node.parentElement?.dataset.textId || crypto.randomUUID(); if (segments.some(segment => segment.id === id)) id = crypto.randomUUID(); textIds.current.set(node, id) }
      const literal = node.parentElement?.closest('[data-literal-text="true"]') || local.current.segments?.some(segment => segment.kind === 'text' && segment.id === id && segment.literal)
      segments.push({ kind: 'text', id, text, ...(literal ? { literal: true } : {}) })
    }
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) { appendText(node, node.textContent || ''); return }
      if (!(node instanceof HTMLElement) && !(node instanceof DocumentFragment)) return
      if (node instanceof HTMLElement && node.dataset.promptCaret) return
      if (node instanceof HTMLElement && node.dataset.segment) { segments.push(JSON.parse(node.dataset.segment)); return }
      if (node instanceof HTMLElement && node.tagName === 'BR') { appendText(node, '\n'); return }
      if (node instanceof HTMLElement && ['DIV', 'P'].includes(node.tagName) && segments.length) appendText(node, '\n')
      node.childNodes.forEach(visit)
    }
    container.childNodes.forEach(visit)
    return { segments }
  }
  const read = () => root.current ? readNodes(root.current) : { segments: [] }
  const publish = (next: PromptDocument, redraw = false) => {
    const changed = contentKey(next) !== contentKey(local.current)
    local.current = next; renderedContent.current = contentKey(next)
    // 键盘打开预检后的失焦不应以相同正文再次触发保存／预检失效。
    if (changed) onChange(next)
    if (redraw) draw(next)
  }
  // 组合输入结束时用最新候选确认；冻结快照仅用于输入期间的展示。
  const confirm = (finalize = false, currentCandidates = candidates) => {
    if (composing.current) return false
    const selection = window.getSelection()
    let caret: number | undefined
    if (root.current && selection?.rangeCount && root.current.contains(selection.anchorNode)) { const before = selection.getRangeAt(0).cloneRange(); before.selectNodeContents(root.current); before.setEnd(selection.anchorNode!, selection.anchorOffset); caret = before.toString().length }
    const next = read(), segments: NonNullable<PromptDocument['segments']> = []; let changed = false
    const inputSegments = next.segments || []
    let textRun = '', offset = 0, nameRanges: [number, number][] = []
    for (const [index, segment] of inputSegments.entries()) {
      if (segment.kind !== 'text') { segments.push(segment); continue }
      // 连续文字可分布在多个 DOM 节点中；只合并读取，不重建片段或跨过结构化引用。
      if (!index || inputSegments[index - 1].kind !== 'text') {
        textRun = ''; offset = 0; nameRanges = []
        for (const following of inputSegments.slice(index)) {
          if (following.kind !== 'text') break
          textRun += following.text || ''
        }
        for (const item of currentCandidates) {
          const name = item.displayLabel
          if (!name || name === item.token) continue
          for (let start = textRun.indexOf('@'); start >= 0; start = textRun.indexOf('@', start + 1)) {
            const remaining = textRun.slice(start)
            if (remaining.startsWith(name)) nameRanges.push([start, start + name.length])
            else if (name.startsWith(remaining) && !/^@(?:文本|图片|视频|音频)\d+\s*$/.test(remaining)) nameRanges.push([start, textRun.length])
          }
        }
      }
      const text = segment.text || '', expression = /(?<!\\)@(?:文本|图片|视频|音频)\d+(?=$|[\s,;:()，。；：、（）!?！？])/g
      if (segment.literal) { segments.push(segment); offset += text.length; continue }
      let start = 0
      for (const match of text.matchAll(expression)) {
        // 全角限定括号属于名称标签语法；即使当前候选中没有该名称，也不解释其编号前缀。
        const position = offset + match.index!
        if (textRun[position + match[0].length] === '（' || nameRanges.some(([from, to]) => position >= from && position < to)) continue
        // Consecutive space-separated references still belong to the same command until prose resumes.
        const command = card.type === 'model.video' ? textRun.slice(0, position).match(/(?<!\\)\/(首帧参考|尾帧参考|关键帧参考|主体参考)(?:[ \t]+"[^"]*")?(?:[ \t]+@(?:文本|图片|视频|音频)\d+)*[ \t]*$/)?.[1] : undefined
        if (command && !finalize) continue
        const candidate = currentCandidates.find(item => item.token === match[0] && item.available &&
          (command ? item.inputPorts?.includes(promptInputPort(card, item.source, command)) : !item.disabledReason))
        if (!candidate) continue
        if (match.index! > start) segments.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start, match.index) })
        segments.push({ id: crypto.randomUUID(), kind: 'reference', source: candidate.source }); start = match.index! + match[0].length; changed = true
      }
      if (start < text.length) segments.push({ ...segment, id: start ? crypto.randomUUID() : segment.id, text: text.slice(start) })
      offset += text.length
    }
    // 仅解释本地显式指令，连续结构化引用构成参数；遇到正文结束。
    if (finalize) {
      const split: NonNullable<PromptDocument['segments']> = []
      for (const segment of segments) {
        if (segment.kind !== 'text' || segment.literal) { split.push(segment); continue }
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
      const match = segment.kind === 'text' && !segment.literal ? (segment.text || '').match(/(?<!\\)\/(首帧参考|尾帧参考|关键帧参考|主体参考)(?:\s+"([^"]*)")?\s*$/) : null
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
    rememberSelection()
    return changed
  }
  const insert = (reference: PromptReference) => {
    if (disabled || composing.current) return
    const selection = window.getSelection()
    const current = selection?.rangeCount ? selection.getRangeAt(0) : undefined
    let range = current && root.current?.contains(current.commonAncestorContainer) ? current.cloneRange() : savedRange.current?.cloneRange()
    if (!root.current) return
    const append = !range || !root.current.contains(range.commonAncestorContainer)
    if (append) { range = window.document.createRange(); range.selectNodeContents(root.current); range.collapse(false) }
    if (!range) return
    if (query && range.startContainer.nodeType === Node.TEXT_NODE && (range.startContainer.textContent || '').slice(0, range.startOffset).endsWith(query)) range.setStart(range.startContainer, range.startOffset - query.length)
    range.deleteContents(); setQuery('')
    const node = window.document.createElement('span'); node.contentEditable = 'false'; node.dataset.segment = JSON.stringify(reference); node.className = 'generation-prompt-token'; node.textContent = label(reference)
    range.insertNode(node)
    const trailing = append && !imageMentions ? window.document.createTextNode(' ') : undefined
    if (trailing) node.after(trailing)
    range.setStartAfter(trailing || node); range.collapse(true)
    root.current.focus(); selection?.removeAllRanges(); selection?.addRange(range)
    publish(read()); rememberSelection()
  }
  useImperativeHandle(referenceActionsRef, () => ({ readVisible: read, insertReference: source => {
    const candidate = candidates.find(item => sourceKey(item.source) === sourceKey(source))
    if (candidate?.available && !candidate.disabledReason) insert({ id: crypto.randomUUID(), kind: 'reference', source: candidate.source })
  } }))
  const tools = <Space wrap>
      {card.type === 'model.video' && <Select<string> disabled={disabled} aria-label={uiText("系统指令")} placeholder={uiText("添加系统指令")} value={undefined} options={['首帧参考', '尾帧参考', '关键帧参考', '主体参考'].map(command => ({ value: command, label: `/${uiText(command)}` }))}
        onChange={command => { if (command) publish({ segments: [...(read().segments || []), { id: crypto.randomUUID(), kind: 'instruction', command, parameters: {}, references: [] }] }, true) }} />}
      <Select aria-label={uiText("引用分类")} value={category} onChange={setCategory} options={Object.entries({ text: '文本', image: '图片', video: '视频', audio: '音频' }).map(([value, label]) => ({ value, label: uiText(label) }))} />
      {candidates.filter(item => item.source.port_id === category).map(item => <Button key={sourceKey(item.source)} size="small" disabled={disabled || !item.available || !!item.disabledReason} onClick={() => insert({ id: crypto.randomUUID(), kind: 'reference', source: item.source })}>{item.displayLabel || item.token}{!item.available && uiText(" 缺失")}</Button>)}
      {query && <small role="status">{uiText("匹配")} {query}{uiText("；完整代号确认后绑定")}</small>}
    </Space>
  const candidateList = query && <div ref={list} id={listId} role="listbox" aria-label={uiText("引用候选")} className={imageMentions ? 'generation-prompt-candidates' : undefined} onMouseDown={event => event.preventDefault()}>
      {matches.map((item, index) => <button type="button" id={`${listId}-${index}`} key={sourceKey(item.source)} className="generation-prompt-option" role="option" aria-label={item.displayLabel || item.token} aria-description={imageMentions ? [item.name, item.disabledReason || (!item.available ? uiText("来源输出缺失") : item.adopted ? uiText("已采用") : uiText("候选"))].filter(Boolean).join(' · ') : undefined} aria-selected={item === active} disabled={disabled || !item.available || !!item.disabledReason} onClick={() => insert({ id: crypto.randomUUID(), kind: 'reference', source: item.source })}>
        {imageMentions ? <><span className="generation-prompt-candidate-preview">{item.fileId ? <img alt="" src={buildFileDownloadUrl(item.fileId)} /> : item.source.port_id === 'image' ? <PictureOutlined /> : <FileTextOutlined />}</span><span className="generation-prompt-candidate-text"><strong title={item.displayLabel || item.token}>{item.displayLabel || item.token}</strong><small>{item.name}</small></span><small>{item.disabledReason || (!item.available ? uiText("来源输出缺失") : item.adopted ? uiText("已采用") : uiText("候选"))}</small></> : item.displayLabel || item.token}
      </button>)}
      {!matches.length && <small>{imageMentions ? uiText("没有匹配候选，将保留为普通文本") : uiText("没有匹配的实际输出；可切换引用分类")}</small>}
    </div>
  return <>
    {compact ? toolsHost && createPortal(<details className="generation-material-reference-tools"><summary>{uiText("＠ 引用与指令")}</summary>{tools}</details>, toolsHost) : tools}
    {(value.segments || []).filter((segment): segment is PromptInstruction => segment.kind === 'instruction').map(instruction => <section key={instruction.id} aria-label={uiText("指令 {{command}}", { command: instruction.command })} data-instruction-id={instruction.id} data-segment-id={instruction.id}>
      <strong>/{instruction.command}</strong>
      {instruction.command === '主体参考' && <Input disabled={disabled} aria-label={uiText("主体名称")} value={instruction.parameters?.name || ''} onChange={event => publish({ segments: (value.segments || []).map(segment => segment.id === instruction.id ? { ...instruction, parameters: { ...instruction.parameters, name: event.target.value } } : segment) }, true)} />}
      <Select<string[]> disabled={disabled} aria-label={uiText("指令引用 {{command}}", { command: instruction.command })} mode="multiple" value={(instruction.references || []).map(reference => sourceKey(reference.source))}
        options={candidates.filter(candidate => candidate.available && (!candidate.inputPorts || candidate.inputPorts.includes(promptInputPort(card, candidate.source, instruction.command)))).map(candidate => ({ value: sourceKey(candidate.source), label: candidate.displayLabel || candidate.token }))}
        onChange={keys => publish({ segments: (value.segments || []).map(segment => segment.id === instruction.id ? { ...instruction, references: keys.map(key => instruction.references?.find(reference => sourceKey(reference.source) === key) || { id: crypto.randomUUID(), kind: 'reference', source: candidates.find(candidate => sourceKey(candidate.source) === key)!.source }) } : segment) }, true)} />
      <Button disabled={disabled} size="small" onClick={() => publish({ segments: (value.segments || []).filter(segment => segment.id !== instruction.id) }, true)}>{uiText("删除指令")}</Button>
      {!instruction.references?.length && <small role="alert">{uiText("指令缺少引用，可继续编辑保存")}</small>}
    </section>)}
    {!imageMentions && candidateList}
    {imageMentions && query && createPortal(<Popover open placement="topLeft" arrow={false} trigger={[]} overlayClassName="canvas-workbench-dialog generation-prompt-popup" content={candidateList} overlayStyle={{ width: popupAnchor.width }}>
      <span aria-hidden="true" style={{ position: 'fixed', pointerEvents: 'none', left: popupAnchor.left, top: popupAnchor.top, height: popupAnchor.height, width: 1 }} />
    </Popover>, window.document.body)}
    <div ref={root} data-diagnostic-control="prompt" role="textbox" aria-label={fieldLabel || uiText("模型正文")} aria-describedby={fieldDescriptionId} aria-multiline="true" aria-readonly={disabled} aria-disabled={disabled} aria-autocomplete="list" aria-controls={query ? listId : undefined} aria-activedescendant={query && active ? `${listId}-${matches.indexOf(active)}` : undefined} contentEditable={!disabled} suppressContentEditableWarning className="generation-prompt-editor" aria-placeholder={compact ? placeholder : undefined} data-placeholder={placeholder} data-empty={!(value.segments || []).some(segment => segment.kind !== 'text' || segment.text?.trim())}
      onCompositionStart={() => { composing.current = true }} onCompositionEnd={() => { composing.current = false; publish(read()); refreshLabels(previous => previous + 1); updateQuery(); if (/[\s,;:()，。；：、（）!?！？]$/.test(textBeforeCaret())) confirm(false, incomingCandidates) }}
      onInput={() => {
        root.current?.querySelectorAll('[data-prompt-caret]').forEach(node => node.remove())
        const next = read(); publish(next)
        if (composing.current) return
        updateQuery()
        if (/[\s,;:()，。；：、（）!?！？]$/.test(textBeforeCaret())) confirm()
      }} onMouseUp={updateQuery} onKeyUp={event => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) updateQuery() }}
      onKeyDown={event => {
        if (disabled || composing.current || event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return
        if (query && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setQuery(''); return }
        if (query && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); const index = active ? selectable.indexOf(active) : event.key === 'ArrowDown' ? -1 : 0; const next = selectable[(index + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, selectable.length)) % Math.max(1, selectable.length)]; setActiveKey(next ? sourceKey(next.source) : null); return }
        if (event.key === 'Enter' && (isMac ? event.metaKey : event.ctrlKey)) {
          event.preventDefault()
          const selection = window.getSelection(), range = selection?.rangeCount ? selection.getRangeAt(0) : undefined
          if (range && root.current?.contains(range.commonAncestorContainer)) {
            range.deleteContents()
            const newline = window.document.createTextNode('\n')
            range.insertNode(newline)
            // 尾部换行需要可见行盒承载光标；占位 BR 不进入持久片段。
            const caret = window.document.createElement('br'); caret.dataset.promptCaret = 'true'
            newline.after(caret)
            range.setStartAfter(newline); range.collapse(true)
            selection?.removeAllRanges(); selection?.addRange(range)
            publish(read()); setQuery('')
          }
          return
        }
        if (event.key === 'Enter' && onSubmit && !event.shiftKey && !event.altKey && !event.metaKey && !event.ctrlKey) {
          event.preventDefault()
          if (event.repeat) return
          if (query) { if (active) insert({ id: crypto.randomUUID(), kind: 'reference', source: active.source }); return }
          // 引用／指令确认先消费回车；普通发送先同步最新正文，再由宿主保存并预检。
          let changed = false
          flushSync(() => { changed = confirm(true) })
          if (changed) setQuery('')
          else if (!submitDisabled) onSubmit()
          return
        }
        if (query && event.key === 'Enter' && !active) { event.preventDefault(); return }
        if (['Enter', 'Tab'].includes(event.key)) {
          if (query && active) { event.preventDefault(); insert({ id: crypto.randomUUID(), kind: 'reference', source: active.source }); return }
          if (confirm(true)) { event.preventDefault(); setQuery('') }
        }
      }} onBlur={() => { if (!disabled) confirm(true); requestAnimationFrame(() => { if (!root.current?.contains(window.document.activeElement)) setQuery('') }) }}
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
          if (segments) for (const segment of segments) { const span = window.document.createElement('span'); if (segment.kind !== 'text') { span.contentEditable = 'false'; span.dataset.segment = JSON.stringify(segment); span.className = 'generation-prompt-token'; span.textContent = segment.kind === 'reference' ? label(segment) : `/${segment.command}` } else { span.textContent = segment.text || ''; if (segment.literal) span.dataset.literalText = 'true' } fragment.append(span) }
          else fragment.append(window.document.createTextNode(event.clipboardData.getData('text/plain')))
          range.insertNode(fragment); publish(read()); if (!segments) confirm()
        }
      }} />
    {(value.segments || []).filter(segment => segment.kind === 'text' && (!imageMentions || allReferences || segment.text?.includes('〔引用失效：')) && /(?<!\\)@(?:文本|图片|视频|音频)\d*/.test(segment.text || '')).map(segment => <small role="alert" key={segment.id}>{uiText("代号尚未确认或不存在；按完整代号选择实际输出")}</small>)}
    {referencesIn(value).map(segment => referenceIssue(document, card, segment.source, candidates) && <small role="alert" key={segment.id} data-diagnostic-segment={segment.id}>{label(segment)}：{uiText(referenceIssue(document, card, segment.source, candidates))}</small>)}
  </>
}
