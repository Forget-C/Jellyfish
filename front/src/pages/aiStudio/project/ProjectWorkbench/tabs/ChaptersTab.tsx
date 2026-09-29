import { useEffect, useState } from 'react'
import { Button, Card, Drawer, Empty, Input, Modal, Select, Space, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StudioChaptersService } from '../../../../../services/generated'
import { useChapters, newId, type Chapter } from '../hooks/useProjectData'
import { ChapterRawTextEditorModal } from '../../../chapter/components/ChapterRawTextEditorModal'
import { directingError } from '../../../directing/common'
import { ChapterSceneList } from '../../../directing/ChapterSceneList'
import { chapterLocation, readChapterBrowse, saveChapterBrowse } from '../../../directing/chapterNavigation'
import { SequenceDetails } from '../../../directing/SequenceDetails'
import { WorkspaceDrafts } from '../../../directing/WorkspaceDrafts'
import { ChapterSourcePanel } from '../../../directing/ChapterSourcePanel'
import { ChapterAssemblyPanel } from '../../../directing/ChapterAssemblyPanel'

/** 章节只维护原文，后续创作统一进入场次工作区。 */
export function ChaptersTab() {
  return <WorkspaceDrafts><ChaptersContent /></WorkspaceDrafts>
}

function ChaptersContent() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const { chapters, loading, refresh, patchChapterLocal } = useChapters(projectId)
  const [editing, setEditing] = useState<Chapter>()
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [revision, setRevision] = useState(0)
  const selectedChapter = chapters.find(chapter => chapter.id === params.get('chapter'))
    || (params.has('chapter') ? undefined : chapters.find(chapter => chapter.id === readChapterBrowse(projectId).chapter) || [...chapters].sort((a, b) => a.index - b.index)[0])
  useEffect(() => { if (selectedChapter) saveChapterBrowse(projectId, '', { chapter: selectedChapter.id }) }, [projectId, selectedChapter?.id])
  const panel = params.get('panel')
  const showPanel = (value?: string) => setParams(previous => {
    const next = new URLSearchParams(previous)
    next.delete('sequence')
    if (selectedChapter) next.set('chapter', selectedChapter.id)
    if (value) next.set('panel', value); else next.delete('panel')
    return next
  }, { replace: true })
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
        title: title.trim(), summary: '', raw_text: content, status: 'draft',
      } })
      setCreating(false); setTitle(''); setContent('')
      await refresh()
      navigate(`${chapterLocation(projectId, id)}&panel=source`)
    } catch (cause) { message.error(directingError(cause)) } finally { setBusy(false) }
  }
  return <>
    <Card title="章节与场次" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建章节</Button>}>
      <p className="text-gray-500">添加章节原文，确认场次，再完成设计、试拍与剪辑。</p>
      <Space wrap style={{ marginBottom: 16 }}>
        <Select aria-label="选择章节" loading={loading} value={selectedChapter?.id} style={{ width: 240, maxWidth: '100%' }}
          showSearch optionFilterProp="label" placeholder="选择章节"
          options={[...chapters].sort((a, b) => a.index - b.index).map(chapter => ({ value: chapter.id, label: `${chapter.index}. ${chapter.title}` }))}
          onChange={id => navigate(chapterLocation(projectId, id))} />
        {selectedChapter && <>
          <Button onClick={() => showPanel('source')}>原文与划场</Button>
          <Button onClick={() => showPanel('assembly')}>章节组合</Button>
          <Button onClick={() => setEditing(selectedChapter)}>编辑原文</Button>
        </>}
      </Space>
      {selectedChapter ? <ChapterSceneList key={`${selectedChapter.id}:${revision}`} projectId={projectId} chapterId={selectedChapter.id}
        onDetails={id => navigate(chapterLocation(projectId, selectedChapter.id, id))} />
        : !loading && <Empty description={params.has('chapter') ? '章节不存在，请重新选择' : '添加第一章，开始划分场次'} />}
    </Card>
    <Drawer title={panel === 'assembly' ? '章节组合' : '原文与划场'} width={880} open={!!selectedChapter && (panel === 'source' || panel === 'assembly')} onClose={() => showPanel()} destroyOnClose>
      {selectedChapter && panel === 'source' && <ChapterSourcePanel key={selectedChapter.id} projectId={projectId} chapterId={selectedChapter.id}
        refreshKey={revision} onChanged={() => setRevision(value => value + 1)} onEdit={() => setEditing(selectedChapter)} />}
      {selectedChapter && panel === 'assembly' && <ChapterAssemblyPanel projectId={projectId} chapterId={selectedChapter.id} />}
    </Drawer>
    {selectedChapter && <SequenceDetails projectId={projectId} chapterId={selectedChapter.id}
      onSaved={() => setRevision(value => value + 1)}
      sequenceId={params.get('sequence') || undefined}
      onClose={() => setParams(previous => { const next = new URLSearchParams(previous); next.delete('sequence'); return next }, { replace: true })} />}
    <ChapterRawTextEditorModal open={!!editing} chapterId={editing?.id} onClose={() => setEditing(undefined)} onSaved={next => {
      if (editing && typeof next.rawText === 'string') patchChapterLocal(editing.id, { rawText: next.rawText })
      setRevision(value => value + 1)
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
