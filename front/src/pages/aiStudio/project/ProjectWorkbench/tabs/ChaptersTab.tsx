import { useEffect, useState } from 'react'
import { Button, Card, Empty, Input, Modal, Space, Table, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StudioChaptersService } from '../../../../../services/generated'
import { useChapters, newId, type Chapter } from '../hooks/useProjectData'
import { ChapterRawTextEditorModal } from '../../../chapter/components/ChapterRawTextEditorModal'
import { directingError } from '../../../directing/common'

/** 章节只维护原文，后续创作统一进入场次工作区。 */
export function ChaptersTab() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { chapters, loading, refresh, patchChapterLocal } = useChapters(projectId)
  const [editing, setEditing] = useState<Chapter>()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  useEffect(() => {
    const edit = chapters.find(chapter => chapter.id === params.get('edit'))
    if (params.get('create') !== '1' && !edit) return
    if (edit) setEditing(edit)
    else setCreating(true)
    setParams(previous => { const next = new URLSearchParams(previous); next.delete('edit'); next.delete('create'); return next }, { replace: true })
  }, [chapters, params, setParams])
  /** 创建后直接进入划场；没有原文时先打开原文编辑器。 */
  const create = async () => {
    if (!title.trim()) { message.warning('请输入章节标题'); return }
    setBusy(true)
    try {
      const id = newId('c')
      await StudioChaptersService.createChapterApiV1StudioChaptersPost({ requestBody: {
        id, project_id: projectId, index: Math.max(0, ...chapters.map(chapter => chapter.index)) + 1,
        title: title.trim(), summary: '', raw_text: content, storyboard_count: 0, status: 'draft',
      } })
      setCreating(false); setTitle(''); setContent('')
      await refresh()
      navigate(`/projects/${projectId}/chapters/${id}/sequences`)
    } catch (cause) { message.error(directingError(cause)) } finally { setBusy(false) }
  }
  return <>
    <Card title="章节与场次" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建章节</Button>}>
      <p className="text-gray-500">添加章节原文，确认场次，再完成设计、试拍与剪辑。</p>
      <Table<Chapter> rowKey="id" loading={loading} dataSource={chapters} pagination={{ pageSize: 10 }} locale={{ emptyText: <Empty description="添加第一章，开始划分场次" /> }} columns={[
        { title: '顺序', dataIndex: 'index', width: 80 },
        { title: '章节', dataIndex: 'title' },
        { title: '原文', render: (_, chapter) => chapter.rawText?.trim() ? '已添加' : '待添加' },
        { title: '操作', render: (_, chapter) => <Space>
          <Button type="primary" onClick={() => navigate(`/projects/${projectId}/chapters/${chapter.id}/sequences`)}>进入场次</Button>
          <Button onClick={() => setEditing(chapter)}>编辑原文</Button>
        </Space> },
      ]} />
    </Card>
    <ChapterRawTextEditorModal open={!!editing} chapterId={editing?.id} onClose={() => setEditing(undefined)} onSaved={next => {
      if (editing && typeof next.rawText === 'string') patchChapterLocal(editing.id, { rawText: next.rawText })
      void refresh()
    }} />
    <Modal title="新建章节" open={creating} confirmLoading={busy} onCancel={() => setCreating(false)} onOk={create} okText="创建并划分场次">
      <Space direction="vertical" className="w-full">
        <Input aria-label="章节标题" placeholder="章节标题" value={title} onChange={event => setTitle(event.target.value)} />
        <Input.TextArea aria-label="章节原文" placeholder="粘贴章节原文" rows={8} value={content} onChange={event => setContent(event.target.value)} />
      </Space>
    </Modal>
  </>
}
