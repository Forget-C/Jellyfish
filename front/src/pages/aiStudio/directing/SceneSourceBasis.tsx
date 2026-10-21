import { WorkbenchModal as Modal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space, Spin, Tag } from 'antd'
import { CanvasTextPreview } from './CanvasTextPreview'
import { StudioDirectingService } from '../../../services/generated'
import type { ChapterSequences, SceneVersionSource_Output, SourceCanvasNode, SourceSpan } from '../../../services/generated'
import { directingError } from './common'
import { sourceSlice, textareaSpan } from './sourceSelection'

/** 明确选择真实段落后才改变当前版本依据；比较读取失败不妨碍继续使用旧依据。 */
export function SceneSourceBasis({ projectId, chapterId, basis, disabled, onChange, open, onOpenChange: setOpen, compact = false, dirty = false, summary }: {
  projectId: string; chapterId: string; basis: SceneVersionSource_Output; disabled: boolean
  onChange: (value: SceneVersionSource_Output) => void
  open: boolean; onOpenChange: (open: boolean) => void; compact?: boolean; dirty?: boolean
  summary?: SourceCanvasNode
}) {
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [span, setSpan] = useState<SourceSpan>()
  const [continued, setContinued] = useState(false)
  const generation = useRef(0)
  const read = async () => {
    const request = ++generation.current
    setLoading(true); setError(''); setChapter(undefined); setSpan(undefined)
    try {
      const result = await StudioDirectingService.directingChapter({ projectId, chapterId })
      if (!result.data) throw new Error('最新原文尚未核实')
      if (generation.current === request) setChapter(result.data)
    } catch (cause) { if (generation.current === request) setError(directingError(cause)) }
    finally { if (generation.current === request) setLoading(false) }
  }
  useEffect(() => {
    void read()
    return () => { generation.current++ }
  }, [projectId, chapterId])
  useEffect(() => { setContinued(false) }, [basis.source.version])
  useEffect(() => { if (open) void read() }, [open])
  const changed = chapter && chapter.source_version !== basis.source.version
  const display = summary || basis
  const selected = chapter && span ? sourceSlice(chapter.raw_text, span) : ''
  const before = Array.from(basis.text), after = Array.from(selected)
  let start = 0, end = 0
  while (start < before.length && start < after.length && before[start] === after[start]) start++
  while (end < before.length - start && end < after.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) end++
  const comparison = (chars: string[], current: boolean) => <p>
    {chars.slice(0, start).join('')}
    {current ? <del>{chars.slice(start, chars.length - end).join('')}</del> : <ins>{chars.slice(start, chars.length - end).join('')}</ins>}
    {end ? chars.slice(-end).join('') : ''}
  </p>
  return <>
    {compact ? <div className="director-source-summary">
      <p title={display.text}>{display.text || '原文尚未填写'}</p>
      <div className="design-compact-status"><span>采用版本 {display.source.version}</span>{dirty && <span title="有未保存修改" aria-label="有未保存修改" tabIndex={0}>✎</span>}</div>
    </div> : <CanvasTextPreview text={basis.text} label="原文" />}
    {loading && <p><Spin size="small" /> 正在核对最新原文</p>}
    {error && (compact ? <p className="director-source-state">原文差异读取失败，当前依据保留 <Button onClick={() => void read()}>重试原文读取</Button></p>
      : <Alert type="warning" message="原文差异读取失败，当前依据保留" description={error} action={<Button onClick={() => void read()}>重试原文读取</Button>} />)}
    {changed && !continued && (compact ? <p className="director-source-state">章节原文有更新 · 当前仍使用旧依据</p> : <Alert type="warning" message="内容有修改" description="章节原文已有修订。本版本仍使用上述原文，不表示有未保存编辑。" />)}
    {changed && continued && <Tag color="warning">继续使用旧原文</Tag>}
    <Space wrap style={{ marginTop: 12 }}>
      <Button onClick={() => setOpen(true)}>查看原文差异</Button>
      {changed && !continued && <Button onClick={() => setContinued(true)}>继续使用旧依据</Button>}
    </Space>
    <Modal rootClassName="canvas-workbench-dialog" title="核对当前版本原文依据" open={open} width={900} onCancel={() => setOpen(false)}
      footer={<WorkbenchDialogActions secondary={<Button onClick={() => setOpen(false)}>取消</Button>}>
        <Button type="primary" disabled={disabled || loading || !chapter || !span || !selected.trim()} onClick={() => {
          if (!chapter || !span || disabled) return
          onChange({ source: { kind: 'chapter', reference: chapterId, version: chapter.source_version }, ...span, text: selected })
          setOpen(false)
        }}>更新当前版本原文依据</Button></WorkbenchDialogActions>}>
      <p>在最新原文中选中属于本场的连续段落，再确认更新。仅修改当前版本，保留其他版本和已交付内容。</p>
      <p>更新后请核对已有设计、指令及素材判断；不会自动重写内容或生成下游数据。</p>
      {loading && <Spin />}
      {error && <Alert type="error" message={error} action={<Button onClick={() => void read()}>重试原文读取</Button>} />}
      <div className="canvas-source-comparison">
        <section><h3>当前使用的原文</h3>{span ? comparison(before, true) : <p>{basis.text}</p>}</section>
        <section><h3>最新章节原文</h3>
          <textarea aria-label="最新章节原文" readOnly value={chapter?.raw_text || ''} disabled={!chapter || loading}
            onSelect={event => { const input = event.currentTarget; if (chapter) setSpan(textareaSpan(chapter.raw_text, input.selectionStart, input.selectionEnd)) }} />
          {span && <><h3>选中段落与当前依据的差异</h3>{comparison(after, false)}</>}
        </section>
      </div>
    </Modal>
  </>
}
