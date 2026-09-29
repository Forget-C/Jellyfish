import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Drawer, Input, InputNumber, Select, Space, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { StudioDirectingService, type ChapterSequences, type SequenceRead } from '../../../services/generated'
import { directingError, excerptMatches, excerptSpan } from './common'
import { sequenceLocation } from './chapterNavigation'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'

export function SequenceDetails({ projectId, chapterId, sequenceId, onClose, onSaved }: {
  projectId: string; chapterId: string; sequenceId?: string; onClose: () => void; onSaved: () => void
}) {
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [sequence, setSequence] = useState<SequenceRead>()
  const [title, setTitle] = useState('')
  const [position, setPosition] = useState(0)
  const [excerpt, setExcerpt] = useState('')
  const [selectedStart, setSelectedStart] = useState<number>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const apply = (row: SequenceRead) => {
    setSequence(row); setTitle(row.title); setPosition(row.position)
    setExcerpt(row.source_text); setSelectedStart(row.span?.start)
  }
  useEffect(() => {
    let active = true
    setSequence(undefined); setChapter(undefined); setError('')
    if (!sequenceId) return
    setLoading(true)
    StudioDirectingService.directingChapter({ projectId, chapterId }).then(response => {
      const found = response.data?.sequences.find(item => item.id === sequenceId)
      if (!found || !response.data) throw new Error('场次不存在或不属于当前章节')
      if (active) { setChapter(response.data); apply(found) }
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, chapterId, sequenceId, retry])
  const dirty = !!sequence && (title !== sequence.title || position !== sequence.position
    || excerpt !== sequence.source_text || selectedStart !== sequence.span?.start)
  /** 使用打开时的原文与场次版本提交；冲突保留输入，不能用刷新悄悄覆盖编辑基线。 */
  const save = async () => {
    if (!sequence || !chapter || busy) return false
    setBusy(true); setError('')
    try {
      if (!title.trim()) throw new Error('请输入场次标题')
      const response = await StudioDirectingService.directingUpdateSequence({ projectId, chapterId, sequenceId: sequence.id,
        requestBody: { title: title.trim(), position, expected_version: sequence.version,
          source_version: chapter.source_version, span: excerptSpan(chapter.raw_text, excerpt, selectedStart) } })
      if (!response.data) throw new Error('保存未返回场次，请核对后重试')
      const saved = response.data
      flushSync(() => { apply(saved); setBusy(false) })
      onSaved()
      return true
    } catch (cause) { setError(directingError(cause)); return false }
    finally { setBusy(false) }
  }
  useWorkspaceDraft({ name: '场次详情', dirty, busy, save, discard: () => { if (sequence) apply(sequence) } })
  const matches = chapter ? excerptMatches(chapter.raw_text, excerpt) : []
  return <Drawer open={!!sequenceId} title={sequence?.title || '场次详情'} width={560} onClose={onClose}>
    {error && <Alert type="error" showIcon message={error} action={!sequence && <Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
    {loading ? <Spin /> : sequence && <WorkspaceWriteBoundary busy={busy}><Space direction="vertical" size="large" style={{ width: '100%' }}>
      {sequence.source_changed && <Alert type="warning" message="章节原文已变化，请核对场次范围后保存" />}
      <label>场次名称<Input aria-label="场次标题" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <Space>场次顺序<InputNumber aria-label="场次顺序" min={1} precision={0} value={position + 1} onChange={value => setPosition((value || 1) - 1)} /></Space>
      <label>原文范围<Input.TextArea aria-label="场次原文摘录" autoSize={{ minRows: 6, maxRows: 16 }} value={excerpt}
        onChange={event => { setExcerpt(event.target.value); setSelectedStart(undefined) }} /></label>
      {matches.length > 1 && <Select aria-label="原文出现位置" style={{ width: '100%' }} placeholder="请选择本场对应的位置" value={selectedStart}
        options={matches.map((span, index) => ({ value: span.start, label: `第 ${index + 1} 次出现 · 原文第 ${span.start + 1} 字起` }))} onChange={setSelectedStart} />}
      <Space wrap>
        <Button type="primary" loading={busy} disabled={!dirty && !sequence.source_changed} onClick={() => { void save() }}>保存</Button>
        <Button onClick={async () => { if (await save()) navigate(sequenceLocation(projectId, chapterId, sequence.id, 'design')) }}>保存并打开工作台</Button>
      </Space>
      <Space wrap>{(['design', 'shoot', 'cut'] as const).map((view, index) => <Button key={view}
        onClick={() => navigate(sequenceLocation(projectId, chapterId, sequence.id, view))}>{['导演设计', '单元试拍', '剪辑与验收'][index]}</Button>)}</Space>
    </Space></WorkspaceWriteBoundary>}
  </Drawer>
}
