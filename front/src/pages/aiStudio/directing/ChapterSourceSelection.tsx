import { useUiText } from '../../../uiText'
import { useEffect, useLayoutEffect, useRef, useState, useId, type ReactNode } from 'react'
import { Button, Radio, Popover, Space, Tooltip } from 'antd'
import { SelectOutlined, InfoCircleOutlined, FontSizeOutlined } from '@ant-design/icons'
import type { SourceSpan } from '../../../services/generated'
import { readChapterBrowse, saveChapterBrowse } from './chapterNavigation'
import { readSourceSelection, textareaSpan } from './sourceSelection'

export type SourceMark = { id: string; label: string; span: SourceSpan; candidate?: boolean }

/** 只读原文与原生选区共用真实文本；边界标签用装饰层呈现，不进入复制或偏移。 */
export function ChapterSourceSelection({ projectId, chapterId, raw, marks, span, pendingSpan, focusId, onSelect, onScene, actions, preserveFocusScroll = false, readOnly = false }: {
  projectId: string; chapterId: string; raw: string; marks: SourceMark[]; span?: SourceSpan; pendingSpan?: SourceSpan; focusId?: string
  onSelect: (span?: SourceSpan) => void; onScene: (id: string) => void
  actions?: ReactNode; preserveFocusScroll?: boolean
  readOnly?: boolean
}) {
  const uiText = useUiText()
  const modeName = useId()
  const root = useRef<HTMLDivElement>(null)
  const plain = useRef<HTMLTextAreaElement>(null)
  const selectionToRestore = useRef({ span, pendingSpan })
  selectionToRestore.current = { span, pendingSpan }
  const [native, setNative] = useState(false)
  const dragging = useRef(false)
  const selectedByPointer = useRef(false)
  const selected = useRef(onSelect)
  selected.current = onSelect
  const chars = Array.from(raw)
  const scrollTop = useRef(readChapterBrowse(projectId, chapterId).sourceTop || 0)
  const lastFocus = useRef(scrollTop.current ? focusId : undefined)
  const cuts = [...new Set([0, chars.length, ...marks.flatMap(mark => [mark.span.start, mark.span.end]),
    ...(span ? [span.start, span.end] : [])])].filter(value => value >= 0 && value <= chars.length).sort((a, b) => a - b)
  useEffect(() => {
    const read = () => {
      if (readOnly || !root.current || dragging.current) return
      const value = readSourceSelection(root.current, true)
      if (value) {
        // 高亮切分会重建文本节点；先结束原生选区，避免 DOM 重排反向改写已确认的范围。
        document.getSelection()?.removeAllRanges()
        selected.current(value)
        return true
      }
      return false
    }
    const release = () => { const wasDragging = dragging.current; dragging.current = false; selectedByPointer.current = !!read() && wasDragging; if (wasDragging && !selectedByPointer.current && !readOnly) selected.current(undefined) }
    document.addEventListener('selectionchange', read)
    document.addEventListener('pointerup', release)
    return () => { document.removeEventListener('selectionchange', read); document.removeEventListener('pointerup', release) }
  }, [readOnly])
  useEffect(() => {
    if (lastFocus.current === focusId) return
    lastFocus.current = focusId
    if (focusId && root.current && !preserveFocusScroll) {
      const element = [...root.current.querySelectorAll<HTMLElement>('[data-mark-id]')].find(node => node.dataset.markId === focusId)
      element?.scrollIntoView({ block: 'center' })
    }
  }, [focusId, raw, marks.length, native, preserveFocusScroll])
  useLayoutEffect(() => {
    const element = native ? plain.current : root.current
    if (element) element.scrollTop = scrollTop.current
    if (native) {
      // 只在视图、原文或场次变化时恢复，不能在每次选区变化时重设方向。
      const { span, pendingSpan } = selectionToRestore.current
      const chars = Array.from(raw)
      plain.current?.setSelectionRange(chars.slice(0, pendingSpan?.start ?? span?.start ?? 0).join('').replace(/\r\n?/g, '\n').length, chars.slice(0, pendingSpan?.end ?? pendingSpan?.start ?? span?.start ?? 0).join('').replace(/\r\n?/g, '\n').length)
    }
  }, [native, raw, focusId])
  const previousPending = useRef(pendingSpan)
  useLayoutEffect(() => {
    if (!pendingSpan && previousPending.current && plain.current) {
      const input = plain.current
      input.setSelectionRange(input.selectionStart, input.selectionStart)
    }
    previousPending.current = pendingSpan
  }, [pendingSpan])
  const rememberScroll = (value: number) => { scrollTop.current = value; saveChapterBrowse(projectId, chapterId, { sourceTop: value }) }
  return <section className="chapter-source-reader" aria-label={uiText("完整章节原文")}>
    <div className="chapter-source-reader-tools">
      <Space wrap><strong>{uiText("章节原文")}</strong>{actions}</Space>
      <Space className="chapter-source-view-tools">
        <span role="radiogroup" aria-label={uiText("原文选择方式")}><Radio.Group name={modeName} className="chapter-selection-method" value={native ? 'native' : 'pointer'} onChange={event => setNative(event.target.value === 'native')}>
          <Tooltip title={uiText("鼠标框选")}><Radio.Button value="pointer" aria-label={uiText("鼠标框选")}><SelectOutlined aria-hidden /></Radio.Button></Tooltip>
          <Tooltip title={uiText("键盘／触屏选择")}><Radio.Button value="native" aria-label={uiText("键盘／触屏选择")}><FontSizeOutlined aria-hidden /></Radio.Button></Tooltip>
        </Radio.Group></span>
        <Popover trigger={['click']} content={<p style={{ maxWidth: 280 }}>{readOnly ? uiText("正在只读查看历史原文和场次范围。") : uiText("选择连续原文后执行操作。浅蓝为已划分，橙色为当前选区，红色表示重叠。键盘选择可使用方向键及 Shift。")}</p>}>
          <Button type="text" icon={<InfoCircleOutlined aria-hidden />} aria-label={uiText("选区说明")} />
        </Popover>
      </Space>
    </div>
    {native ? <>
      <textarea ref={plain} aria-label={uiText("键盘或触屏选择原文")} className="chapter-source-native" readOnly value={raw} onScroll={event => rememberScroll(event.currentTarget.scrollTop)} onKeyDown={event => {
        // 只读文本在部分平台上用方向键滚动；显式提供逐字符键盘选择，跳过 UTF-16 代理对。
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || event.altKey) return
        if (['ArrowLeft', 'ArrowRight'].includes(event.key) && (event.metaKey || event.ctrlKey)) return
        event.preventDefault()
        const input = event.currentTarget, backward = input.selectionDirection === 'backward'
        const anchor = backward ? input.selectionEnd : input.selectionStart
        const focus = backward ? input.selectionStart : input.selectionEnd
        const offsets = [0]
        for (const char of Array.from(input.value)) offsets.push(offsets[offsets.length - 1] + char.length)
        const cursor = offsets.indexOf(focus)
        let next = offsets[Math.max(0, Math.min(offsets.length - 1, cursor + (event.key === 'ArrowRight' ? 1 : -1)))]
        if (event.key === 'Home') next = event.metaKey || event.ctrlKey ? 0 : input.value.lastIndexOf('\n', Math.max(0, focus - 1)) + 1
        if (event.key === 'End') { const lineEnd = input.value.indexOf('\n', focus); next = event.metaKey || event.ctrlKey || lineEnd < 0 ? input.value.length : lineEnd }
        const start = event.shiftKey ? Math.min(anchor, next) : next, end = event.shiftKey ? Math.max(anchor, next) : next
        input.setSelectionRange(start, end, next < anchor ? 'backward' : 'forward')
        const value = textareaSpan(raw, start, end, true)
        if (!readOnly) onSelect(value)
      }} onSelect={event => {
        const input = event.currentTarget, value = textareaSpan(raw, input.selectionStart, input.selectionEnd, true)
        if (!readOnly && (value || document.activeElement === input)) onSelect(value)
      }} /></> : <div ref={root} className="chapter-source-text" onScroll={event => rememberScroll(event.currentTarget.scrollTop)} onPointerDown={() => { dragging.current = true }} onClick={event => {
        if (selectedByPointer.current) { selectedByPointer.current = false; return }
        if (!document.getSelection()?.isCollapsed) return
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-mark-id]')
        if (target?.dataset.markId) onScene(target.dataset.markId)
      }}>{cuts.slice(0, -1).map((start, index) => {
        const end = cuts[index + 1]
        const owners = marks.filter(mark => mark.span.start < end && start < mark.span.end)
        const active = span && span.start < end && start < span.end
        const confirmed = owners.filter(mark => !mark.candidate)
        const labels = marks.filter(mark => mark.span.start === start).map(mark => uiText("{{label}}开始", { label: mark.label }))
        const endings = marks.filter(mark => mark.span.end === end).map(mark => uiText("{{label}}结束", { label: mark.label }))
        return <span key={start} data-source-start={start} data-mark-id={owners[0]?.id}
          className={`${confirmed.length ? 'source-assigned' : ''} ${owners.some(mark => mark.candidate) ? 'source-candidate' : ''} ${confirmed.length > 1 ? 'source-conflict' : ''} ${active ? 'source-selection' : ''}`}
          title={owners.map(mark => mark.label).join(' / ')}>
          {!!labels.length && <i aria-hidden="true" className="source-boundary" data-label={labels.join(' · ')} />}
          {chars.slice(start, end).join('')}
          {!!endings.length && <i aria-hidden="true" className="source-boundary" data-label={endings.join(' · ')} />}
        </span>
      })}</div>}
  </section>
}
