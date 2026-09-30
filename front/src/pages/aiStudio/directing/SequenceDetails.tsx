import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Input, InputNumber, Space, Spin } from 'antd'
import { useNavigate } from 'react-router-dom'
import { StudioDirectingService, type ChapterSequences, type SequenceRead } from '../../../services/generated'
import { directingError } from './common'
import { sequenceLocation } from './chapterNavigation'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'

/** 场次管理容器内的编辑区；保存保留当前场次，离开沿用统一草稿保护。 */
export function SequenceDetails({ projectId, chapterId, sequenceId, onClose, onSaved, onRange }: {
  projectId: string; chapterId: string; sequenceId?: string; onClose: () => void; onSaved: () => void; onRange: () => void
}) {
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [sequence, setSequence] = useState<SequenceRead>()
  const [title, setTitle] = useState('')
  const [position, setPosition] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const apply = (row: SequenceRead) => {
    setSequence(row); setTitle(row.title); setPosition(row.position)
  }
  useEffect(() => {
    let active = true
    setSequence(undefined); setChapter(undefined); setError('')
    if (!sequenceId) return
    setLoading(true)
    StudioDirectingService.directingChapter({ projectId, chapterId }).then(async response => {
      let found = response.data?.sequences.find(item => item.id === sequenceId)
      if (!found) { const history = await StudioDirectingService.directingChapterHistory({ projectId, chapterId }); found = history.data?.find(row => row.id === sequenceId) }
      if (!found || !response.data) throw new Error('场次不存在或不属于当前章节')
      if (active) { setChapter(response.data); apply(found) }
    }).catch(cause => { if (active) setError(directingError(cause)) })
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [projectId, chapterId, sequenceId, retry])
  const dirty = !!sequence && (title !== sequence.title || position !== sequence.position)
  /** 使用打开时的原文与场次版本提交；冲突保留输入，不能用刷新悄悄覆盖编辑基线。 */
  const save = async () => {
    if (!sequence || !chapter || busy) return false
    setBusy(true); setError('')
    try {
      if (!title.trim()) throw new Error('请输入场次标题')
      const response = await StudioDirectingService.directingUpdateSequence({ projectId, chapterId, sequenceId: sequence.id,
        requestBody: { title: title.trim(), position, expected_version: sequence.version,
          source_version: chapter.source_version, span: null } })
      if (!response.data) throw new Error('保存未返回场次，请核对后重试')
      const saved = response.data
      flushSync(() => { apply(saved); setBusy(false) })
      onSaved()
      return true
    } catch (cause) { setError(directingError(cause)); return false }
    finally { setBusy(false) }
  }
  useWorkspaceDraft({ name: '场次详情', dirty, busy, save, discard: () => { if (sequence) apply(sequence) } })
  return <section aria-label="场次详情" className="chapter-sequence-details">
    <Button className="chapter-scenes-back" onClick={onClose}>返回场次列表</Button>
    <h3>{sequence?.title || '场次详情'}</h3>
    {error && <Alert type="error" showIcon message={error} action={!sequence && <Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />}
    {sequence?.is_current === false && <><Alert type="info" message="场次已退出当前划分，历史成果保留；不能发起新的生产写入。" /><p className="chapter-source-excerpt">{sequence.source_text}</p><Button onClick={() => navigate(sequenceLocation(projectId, chapterId, sequence.id, 'design'))}>查看历史成果</Button></>}
    {loading ? <Spin /> : sequence && sequence.is_current !== false && <WorkspaceWriteBoundary busy={busy}><Space direction="vertical" size="large" style={{ width: '100%' }}>
      {sequence.source_changed && <Alert type="warning" message="章节原文已变化，请在原文中重新核对范围；修改名称或顺序不会更新来源" />}
      <label>场次名称<Input aria-label="场次标题" value={title} onChange={event => setTitle(event.target.value)} /></label>
      <Space>场次顺序<InputNumber aria-label="场次顺序" min={1} precision={0} value={position + 1} onChange={value => setPosition((value || 1) - 1)} /></Space>
      <section aria-label="场次原文范围"><strong>原文范围</strong><p className="chapter-source-excerpt">{sequence.source_text}</p>
        <Button onClick={onRange}>在原文中调整范围</Button></section>
      <Space wrap>
        <Button type="primary" loading={busy} disabled={!dirty} onClick={() => { void save() }}>保存</Button>
        <Button onClick={async () => { if (await save()) navigate(sequenceLocation(projectId, chapterId, sequence.id, 'design')) }}>保存并打开工作台</Button>
      </Space>
      <Space wrap>{(['design', 'shoot', 'cut'] as const).map((view, index) => <Button key={view}
        onClick={() => navigate(sequenceLocation(projectId, chapterId, sequence.id, view))}>{['导演设计', '单元试拍', '剪辑与验收'][index]}</Button>)}</Space>
    </Space></WorkspaceWriteBoundary>}
  </section>
}
