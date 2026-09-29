import { useCallback, useEffect, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { Alert, Button, Card, Drawer, Input, Modal, Select, Space, Spin, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { StudioDirectingService, type ChapterSequences, type DirectingTaskRead } from '../../../services/generated'
import { directingError, excerptMatches, excerptSpan } from './common'
import { DirectingTasks } from './DirectingTasks'
import { sequenceLocation } from './chapterNavigation'
import { useWorkspaceDraft, WorkspaceWriteBoundary } from './WorkspaceDrafts'

/** 原文划场和分析建议独立于主列表；确认一场后可继续处理本章。 */
export function ChapterSourcePanel({ projectId, chapterId, onChanged, onEdit, refreshKey }: {
  projectId: string; chapterId: string; onChanged: () => void; onEdit: () => void; refreshKey: number
}) {
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [formChapter, setFormChapter] = useState<ChapterSequences>()
  const [error, setError] = useState('')
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [selectedStart, setSelectedStart] = useState<number>()
  const [result, setResult] = useState<DirectingTaskRead>()
  const [tasks, setTasks] = useState<DirectingTaskRead[]>([])
  const [activities, setActivities] = useState(false)
  const identity = useRef('')
  identity.current = `${projectId}:${chapterId}`
  const reload = useCallback(async () => {
    const key = `${projectId}:${chapterId}`
    try {
      const response = await StudioDirectingService.directingChapter({ projectId, chapterId })
      if (!response.data) throw new Error('章节原文读取失败')
      if (identity.current === key) { setChapter(response.data); setLoadError('') }
    } catch (cause) { if (identity.current === key) setLoadError(directingError(cause)) }
  }, [projectId, chapterId])
  useEffect(() => { identity.current = `${projectId}:${chapterId}`; void reload(); return () => { identity.current = '' } }, [reload, refreshKey, projectId, chapterId])
  const create = async (enter = false) => {
    if (!formChapter || busy) return false
    setBusy(true); setError('')
    try {
      if (!title.trim()) throw new Error('请输入场次标题')
      const response = await StudioDirectingService.directingCreateSequence({ projectId, chapterId, requestBody: {
        title: title.trim(), position: Math.max(-1, ...formChapter.sequences.map(row => row.position)) + 1,
        source_version: formChapter.source_version, span: excerptSpan(formChapter.raw_text, excerpt, selectedStart),
      } })
      if (!response.data) throw new Error('创建未返回场次，请核对后重试')
      await reload()
      flushSync(() => { setOpen(false); setBusy(false) }); onChanged()
      if (enter) navigate(sequenceLocation(projectId, chapterId, response.data.id, 'design'))
      return true
    } catch (cause) { setError(directingError(cause)); return false }
    finally { setBusy(false) }
  }
  const guard = useWorkspaceDraft({ name: '待确认场次', dirty: open, busy, save: () => create(), discard: () => setOpen(false) })
  const readFailure = loadError && <Alert type="error" message={loadError} action={<Button onClick={() => { void reload() }}>重试</Button>} />
  if (!chapter) return <Space>{loadError ? readFailure : <Spin />}</Space>
  const matches = excerptMatches(formChapter?.raw_text || '', excerpt)
  const pending = tasks.filter(task => task.status === 'running' || task.status === 'queued').length
  const latest = [...tasks].reverse().find(task => task.division)
  const start = (name: string, text: string) => { setFormChapter(chapter); setTitle(name); setExcerpt(text); setSelectedStart(undefined); setOpen(true) }
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {readFailure}
    {error && <Alert type="error" message={error} />}
    <Card title="章节原文" extra={<Button onClick={() => guard(onEdit)}>编辑原文</Button>}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{chapter.raw_text || '请先添加章节原文。'}</Typography.Paragraph>
      <Space wrap>
        <Button loading={busy} disabled={!chapter.raw_text.trim()} onClick={async () => {
          setBusy(true); setError('')
          try { await StudioDirectingService.directingAnalyzeChapter({ projectId, chapterId, requestBody: {} }); await reload() }
          catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
        }}>AI 分析场次</Button>
        <Button type="primary" disabled={!chapter.raw_text.trim() || busy} onClick={() => start(chapter.title, chapter.raw_text)}>手动新建场次</Button>
      </Space>
    </Card>
    <Space wrap>
      {pending > 0 && <span role="status">{pending} 个分析任务进行中</span>}
      {tasks.some(task => task.status === 'failed') && <span>有失败记录待核对</span>}
      {latest && <Button onClick={() => setResult(latest)}>查看划场建议</Button>}
      <Button onClick={() => setActivities(true)}>章节活动</Button>
    </Space>
    <Drawer title="章节活动" open={activities} width={560} onClose={() => setActivities(false)} forceRender>
      <DirectingTasks projectId={projectId} taskIds={chapter.task_ids || []} onTasks={setTasks}
        onResult={task => { setResult(task); setActivities(false) }} onSettled={reload} />
    </Drawer>
    {result?.division && <Card title="场次建议">
      {result.source_version !== chapter.source_version && <Alert type="warning" message="原文已变化，请重新分析；旧建议保留供参考。" />}
      {result.division.scenes.map((scene, index) => <Card key={index} size="small" title={scene.title} style={{ marginBottom: 12 }}>
        <p>{scene.purpose}</p><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{scene.excerpt}</Typography.Paragraph>
        <Button disabled={result.source_version !== chapter.source_version} onClick={() => start(scene.title, scene.excerpt)}>核对并创建场次</Button>
      </Card>)}
    </Card>}
    <Modal title="确认场次原文" open={open} onCancel={() => guard(() => setOpen(false))} footer={<Space wrap>
      <Button disabled={busy} onClick={() => guard(() => setOpen(false))}>取消</Button>
      <Button disabled={busy} onClick={() => { void create(true) }}>创建并进入场次</Button>
      <Button type="primary" loading={busy} onClick={() => { void create() }}>创建并继续划场</Button>
    </Space>}>
      {error && <Alert type="error" message={error} />}
      <WorkspaceWriteBoundary busy={busy}><Space direction="vertical" style={{ width: '100%' }}>
        <Input aria-label="场次标题" placeholder="场次标题" value={title} onChange={event => setTitle(event.target.value)} />
        <Input.TextArea aria-label="场次原文摘录" autoSize={{ minRows: 5, maxRows: 14 }} value={excerpt} onChange={event => { setExcerpt(event.target.value); setSelectedStart(undefined) }} />
        {matches.length > 1 && <Select aria-label="原文出现位置" placeholder="原文重复出现，请指定本场对应的位置" value={selectedStart} style={{ width: '100%' }} options={matches.map((span, index) => ({ value: span.start, label: `第 ${index + 1} 次出现 · 原文第 ${span.start + 1} 字起` }))} onChange={setSelectedStart} />}
        <Typography.Text type="secondary">使用章节中连续的一段原文，可在创建前调整范围。</Typography.Text>
      </Space></WorkspaceWriteBoundary>
    </Modal>
  </Space>
}
