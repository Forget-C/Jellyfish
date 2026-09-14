import { useCallback, useEffect, useState } from 'react'
import { Alert, Button, Card, Empty, Input, InputNumber, Modal, Select, Space, Spin, Typography } from 'antd'
import { useNavigate, useParams } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { ChapterSequences, DirectingTaskRead, SequenceRead } from '../../../services/generated'
import { directingError, excerptMatches, excerptSpan } from './common'
import { DirectingTasks } from './DirectingTasks'

/** 章节先确认叙事场次，允许 AI 分析失败后继续人工划场。 */
export default function ChapterSequencesPage() {
  const { projectId = '', chapterId = '' } = useParams()
  const navigate = useNavigate()
  const [chapter, setChapter] = useState<ChapterSequences>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<SequenceRead>()
  const [position, setPosition] = useState(0)
  const [title, setTitle] = useState('')
  const [excerpt, setExcerpt] = useState('')
  const [selectedStart, setSelectedStart] = useState<number>()
  const [result, setResult] = useState<DirectingTaskRead>()
  /** 重新读取服务端原文版本，避免页面缓存形成旧范围提交。 */
  const reload = useCallback(async () => {
    try {
      const response = await StudioDirectingService.directingChapter({ projectId, chapterId })
      if (response.data) setChapter(response.data)
    } catch (cause) { setError(directingError(cause)) }
  }, [projectId, chapterId])
  useEffect(() => { void reload() }, [reload])
  /** 保存明确选中的连续摘录并进入场次工作区。 */
  const create = async () => {
    if (!chapter) return
    setBusy(true); setError('')
    try {
      const requestBody = { title, position: editing ? position : Math.max(-1, ...chapter.sequences.map(row => row.position)) + 1,
        source_version: chapter.source_version, span: excerptSpan(chapter.raw_text, excerpt, selectedStart) }
      const response = editing
        ? await StudioDirectingService.directingUpdateSequence({ projectId, chapterId, sequenceId: editing.id, requestBody: { ...requestBody, expected_version: editing.version } })
        : await StudioDirectingService.directingCreateSequence({ projectId, chapterId, requestBody })
      if (response.data) navigate(`/projects/${projectId}/chapters/${chapterId}/sequences/${response.data.id}`)
    } catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
  }
  if (!chapter) return <Space><Spin />{error && <Alert type="error" message={error} />}</Space>
  return <Space direction="vertical" size="large" style={{ width: '100%', padding: 24 }}>
    <Space><Button onClick={() => navigate(`/projects/${projectId}?tab=chapters`)}>返回章节</Button><Typography.Title level={3} style={{ margin: 0 }}>{chapter.title} · 场次</Typography.Title></Space>
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    <Card title="章节原文" extra={<Button onClick={() => navigate(`/projects/${projectId}?tab=chapters&edit=${chapterId}`)}>编辑原文</Button>}>
      <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', maxHeight: 280, overflow: 'auto' }}>{chapter.raw_text || '请先添加章节原文。'}</Typography.Paragraph>
      <Space>
        <Button type="primary" loading={busy} disabled={!chapter.raw_text.trim()} onClick={async () => {
          setBusy(true); setError('')
          try { await StudioDirectingService.directingAnalyzeChapter({ projectId, chapterId, requestBody: {} }); await reload() }
          catch (cause) { setError(directingError(cause)) } finally { setBusy(false) }
        }}>AI 分析场次</Button>
        <Button disabled={!chapter.raw_text.trim()} onClick={() => { setEditing(undefined); setSelectedStart(undefined); setTitle(chapter.title); setExcerpt(chapter.raw_text); setOpen(true) }}>手动新建场次</Button>
      </Space>
    </Card>
    <DirectingTasks projectId={projectId} taskIds={chapter.task_ids || []} onResult={setResult} onSettled={reload} />
    {result?.division && <Card title="场次建议">
      {result.source_version !== chapter.source_version && <Alert type="warning" message="原文已变化，请重新分析；旧建议保留供参考。" />}
      {result.division.scenes.map((scene, index) => <Card key={index} size="small" title={scene.title} style={{ marginBottom: 12 }}>
        <p>{scene.purpose}</p><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{scene.excerpt}</Typography.Paragraph>
        <Button disabled={result.source_version !== chapter.source_version} onClick={() => { setEditing(undefined); setSelectedStart(undefined); setTitle(scene.title); setExcerpt(scene.excerpt); setOpen(true) }}>核对并创建场次</Button>
      </Card>)}
    </Card>}
    {chapter.sequences.length ? chapter.sequences.map(scene => <Card key={scene.id} title={`${scene.position + 1}. ${scene.title}`} extra={<Button type="primary" onClick={() => navigate(`/projects/${projectId}/chapters/${chapterId}/sequences/${scene.id}`)}>进入场次</Button>}>
      {scene.source_changed && <Alert type="warning" message="章节原文已变化，场次范围需要核对。" />}
      <Typography.Paragraph ellipsis={{ rows: 3 }}>{scene.source_text}</Typography.Paragraph>
      <Button onClick={() => { setEditing(scene); setSelectedStart(scene.span?.start); setTitle(scene.title); setPosition(scene.position); setExcerpt(scene.source_text); setOpen(true) }}>核对原文、名称与顺序</Button>
    </Card>) : <Empty description="先确认一场戏，再进入设计与试拍" />}
    <Modal title="确认场次原文" open={open} onCancel={() => setOpen(false)} onOk={create} confirmLoading={busy} okText={editing ? "保存并进入场次" : "创建并进入场次"}>
      <Space direction="vertical" style={{ width: '100%' }}><Input aria-label="场次标题" placeholder="场次标题" value={title} onChange={event => setTitle(event.target.value)} />
        {editing && <Space>场次顺序<InputNumber min={1} value={position + 1} onChange={value => setPosition((value || 1) - 1)} /></Space>}
        <Input.TextArea aria-label="场次原文摘录" autoSize={{ minRows: 5, maxRows: 14 }} value={excerpt} onChange={event => { setExcerpt(event.target.value); setSelectedStart(undefined) }} />
        {excerptMatches(chapter.raw_text, excerpt).length > 1 && <Select aria-label="原文出现位置" placeholder="原文重复出现，请指定本场对应的位置" value={selectedStart} className="w-full" options={excerptMatches(chapter.raw_text, excerpt).map((span, index) => ({ value: span.start, label: `第 ${index + 1} 次出现 · 原文第 ${span.start + 1} 字起` }))} onChange={setSelectedStart} />}
        <Typography.Text type="secondary">使用章节中连续的一段原文，可在创建前调整范围。</Typography.Text></Space>
    </Modal>
  </Space>
}
