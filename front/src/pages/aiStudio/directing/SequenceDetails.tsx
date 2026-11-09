import { useEffect, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Input, InputNumber, Modal, Space, Spin } from 'antd'
import { StudioDirectingService, type ChapterSequences, type SequenceRead } from '../../../services/generated'
import { directingError } from './common'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'

/** 场次管理容器内的编辑区；保存保留当前场次，离开沿用统一草稿保护。 */
export function SequenceDetails({ projectId, chapterId, sequenceId, onClose, onSaved, onRange }: {
  projectId: string; chapterId: string; sequenceId?: string; onClose: () => void; onSaved: () => void; onRange: () => void
}) {
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
  const guard = useWorkspaceDraft({ name: '场次详情', dirty, busy, save, discard: () => { if (sequence) apply(sequence) } })
  const fields = <>
    <label>场次名称<Input aria-label="场次标题" value={title} onChange={event => setTitle(event.target.value)} /></label>
    <Space>场次顺序<InputNumber aria-label="场次顺序" min={1} precision={0} value={position + 1} onChange={value => setPosition((value || 1) - 1)} /></Space>
  </>
  const failure = error && <Alert type="error" showIcon message={error} action={!sequence && <Button onClick={() => setRetry(value => value + 1)}>重试</Button>} />
  return <Modal open title="编辑场次名称与顺序" width={480} onCancel={() => guard(onClose)}
    closable={!busy} keyboard={!busy} maskClosable={!busy} footer={<Space wrap>
      <Button disabled={busy} onClick={() => guard(onClose)}>取消</Button>
      <Button type="primary" loading={busy} disabled={!dirty || sequence?.is_current === false} onClick={() => void save()}>保存</Button>
    </Space>}>
    {failure}
    {loading ? <Spin /> : sequence?.is_current === false ? <Alert type="warning" message="历史场次不能修改名称或顺序" />
      : sequence && <WorkspaceWriteBoundary busy={busy}><Space direction="vertical" style={{ width: '100%' }}>
        {fields}
        <Button type="link" onClick={() => guard(onRange)}>在原文中调整范围</Button>
      </Space></WorkspaceWriteBoundary>}
  </Modal>
}
