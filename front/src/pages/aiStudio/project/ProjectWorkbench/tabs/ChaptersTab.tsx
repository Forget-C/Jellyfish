import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Drawer, Empty, Input, Modal, Space, Spin, Table, message } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { flushSync } from 'react-dom'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StudioChaptersService, type ChapterRead } from '../../../../../services/generated'
import { useChapters, newId } from '../hooks/useProjectData'
import { ChapterRawTextEditorModal } from '../../../chapter/components/ChapterRawTextEditorModal'
import { directingError } from '../../../directing/common'
import { ChapterSceneList } from '../../../directing/ChapterSceneList'
import { chapterAction, chapterLocation, readChapterBrowse, saveChapterBrowse } from '../../../directing/chapterNavigation'
import { SequenceDetails } from '../../../directing/SequenceDetails'
import { WorkspaceDrafts, useWorkspaceDraft } from '../../../directing/WorkspaceDrafts'
import { ChapterSourcePanel } from '../../../directing/ChapterSourcePanel'
import { ChapterAssemblyPanel } from '../../../directing/ChapterAssemblyPanel'
import '../../../directing/workspace.css'

/** 章节表格负责总览；仅打开指定章节后加载场次管理内容。 */
export function ChaptersTab() {
  const { projectId = '' } = useParams()
  return <WorkspaceDrafts><ChaptersContent key={projectId} /></WorkspaceDrafts>
}

function ChaptersContent() {
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(() => readChapterBrowse(projectId).page || 1)
  const [query, setQuery] = useState(() => readChapterBrowse(projectId).query || '')
  const { chapters, loading, total, error, refresh } = useChapters(projectId, { page, pageSize: 10, query })
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [revision, setRevision] = useState(0)
  const [linkedChapter, setLinkedChapter] = useState<ChapterRead>()
  const [chapterError, setChapterError] = useState('')
  const [chapterRetry, setChapterRetry] = useState(0)
  const chapterId = params.get('chapter') || ''
  const editingId = params.get('edit') || undefined
  const sequenceId = params.get('sequence') || undefined
  const panel = params.get('panel')
  const fromPage = chapters.find(chapter => chapter.id === chapterId)
  const selectedChapter = fromPage || (linkedChapter?.id === chapterId ? linkedChapter : undefined)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const lastEditing = useRef(editingId)
  useEffect(() => {
    if (lastEditing.current && !editingId) restoreFocus()
    lastEditing.current = editingId
  }, [editingId])
  const previousSelection = useRef({ chapterId, sequenceId })
  useEffect(() => {
    if (sequenceId || (previousSelection.current.chapterId === chapterId && previousSelection.current.sequenceId)) {
      saveChapterBrowse(projectId, chapterId, { sequence: sequenceId })
    }
    previousSelection.current = { chapterId, sequenceId }
  }, [projectId, chapterId, sequenceId])
  useEffect(() => {
    let active = true
    setLinkedChapter(undefined); setChapterError('')
    if (!chapterId || fromPage || loading) return
    StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId }).then(response => {
      if (!response.data || response.data.project_id !== projectId) throw new Error('章节不存在或不属于当前项目')
      if (active) setLinkedChapter(response.data)
    }).catch(cause => { if (active) setChapterError(directingError(cause)) })
    return () => { active = false }
  }, [chapterId, !!fromPage, loading, projectId, chapterRetry])
  useEffect(() => {
    if (loading || !root.current) return
    let element = root.current.parentElement
    while (element && !['auto', 'scroll'].includes(getComputedStyle(element).overflowY)) element = element.parentElement
    if (!element) return
    const scroll = element
    scroll.scrollTop = readChapterBrowse(projectId).top || 0
    const save = () => saveChapterBrowse(projectId, '', { top: scroll.scrollTop })
    scroll.addEventListener('scroll', save)
    return () => scroll.removeEventListener('scroll', save)
  }, [projectId, loading, page, query])
  useEffect(() => {
    if (params.get('create') === '1') {
      setCreating(true)
      setParams(previous => { const next = new URLSearchParams(previous); next.delete('create'); return next }, { replace: true })
    }
  }, [params, setParams])
  const closePanel = () => setParams(previous => {
    const next = new URLSearchParams(previous)
    for (const key of ['chapter', 'sequence', 'panel', 'edit', 'mode']) next.delete(key)
    return next
  }, { replace: true })
  const showSource = (manual = false) => setParams(previous => {
    const next = new URLSearchParams(previous)
    next.set('panel', 'source')
    if (manual) next.set('mode', 'manual'); else next.delete('mode')
    return next
  }, { replace: true })
  const selectSequence = (id?: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (id) next.set('sequence', id); else next.delete('sequence')
      return next
    }, { replace: true })
  }
  const openEditor = (id: string) => {
    trigger.current = document.activeElement as HTMLElement
    navigate(`${chapterLocation(projectId)}&edit=${encodeURIComponent(id)}`)
  }
  const openAction = (chapter: { id: string; rawText?: string; sequenceCount?: number }, count = false) => {
    const action = chapterAction(chapter, count)
    trigger.current = document.activeElement as HTMLElement
    navigate(action.target === 'edit' ? `${chapterLocation(projectId)}&edit=${encodeURIComponent(chapter.id)}`
      : `${chapterLocation(projectId, chapter.id)}${action.target === 'source' ? '&panel=source' : ''}`)
  }
  const editCurrent = () => setParams(previous => {
    const next = new URLSearchParams(previous); next.set('edit', chapterId); return next
  }, { replace: true })
  const closeEditor = () => setParams(previous => {
    const next = new URLSearchParams(previous); next.delete('edit'); return next
  }, { replace: true })
  const restoreFocus = () => {
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
    else root.current?.querySelector<HTMLInputElement>('input[aria-label="搜索章节"]')?.focus({ preventScroll: true })
  }
  /** 分页列表不能推算最后一章序号；沿现有接口按序号倒序读取一条。 */
  const create = async (enter = true) => {
    if (busy) return false
    if (!title.trim()) { message.warning('请输入章节标题'); return false }
    setBusy(true)
    try {
      const last = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({ projectId, page: 1, pageSize: 1, order: 'index', isDesc: true })
      if (!last.data) throw new Error('章节顺序读取失败，请重试')
      const id = newId('c')
      await StudioChaptersService.createChapterApiV1StudioChaptersPost({ requestBody: {
        id, project_id: projectId, index: (last.data.items[0]?.index || 0) + 1,
        title: title.trim(), summary: '', raw_text: content, status: 'draft',
      } })
      const hasText = !!content.trim()
      flushSync(() => { setCreating(false); setTitle(''); setContent(''); setBusy(false) })
      void refresh()
      if (enter) navigate(hasText ? `${chapterLocation(projectId, id)}&panel=source` : `${chapterLocation(projectId)}&edit=${id}`)
      return true
    } catch (cause) { message.error(directingError(cause)); return false } finally { setBusy(false) }
  }
  const guardCreate = useWorkspaceDraft({ name: '新建章节', dirty: creating && !!(title || content), busy, save: () => create(false),
    discard: () => { setTitle(''); setContent('') } })
  const changePage = (nextPage: number, nextQuery = query) => {
    saveChapterBrowse(projectId, '', { page: nextPage, query: nextQuery, top: 0 })
    setPage(nextPage); setQuery(nextQuery)
  }
  return <div ref={root}>
    <Card title="章节" extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>新建章节</Button>}>
      <Input.Search aria-label="搜索章节" placeholder="搜索章节标题或摘要" allowClear value={query}
        onChange={event => changePage(1, event.target.value)} style={{ marginBottom: 16, maxWidth: 360 }} />
      {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => void refresh()}>重试</Button>} />
        : <Table rowKey="id" className="chapter-table" dataSource={chapters} loading={loading}
          pagination={{ current: page, pageSize: 10, total, showSizeChanger: false, onChange: next => changePage(next) }}
          locale={{ emptyText: <Empty description={query ? '没有匹配的章节' : '添加第一章，开始划分场次'} /> }} columns={[
            { title: '章节名称', key: 'title', width: '24%', render: (_, chapter) => <><Button type="link" className="chapter-title-link" aria-label={`${chapter.index}. ${chapter.title} · 编辑章节`} onClick={() => openEditor(chapter.id)}>{chapter.index}. {chapter.title}</Button><div className="text-gray-500">编辑章节</div></> },
            { title: '原文预览', key: 'preview', responsive: ['lg'], render: (_, chapter) => <p className="chapter-table-preview">{chapter.rawText || '未填写原文'}</p> },
            { title: '原文字数', key: 'words', width: 100, responsive: ['md'], render: (_, chapter) => chapter.rawText?.length ?? 0 },
            { title: '场次数量', key: 'count', width: 100, render: (_, chapter) => <Button type="link" aria-label={`${chapter.title} · ${chapter.sequenceCount === undefined ? '查看场次' : `${chapter.sequenceCount} 场`}`} onClick={() => openAction(chapter, true)}>{chapter.sequenceCount === undefined ? '查看场次' : `${chapter.sequenceCount} 场`}</Button> },
            { title: '操作', key: 'actions', width: 160, render: (_, chapter) => <Space wrap size={4}><Button type="primary" onClick={() => openAction(chapter)}>{chapterAction(chapter).label}</Button><Button onClick={() => {
              trigger.current = document.activeElement as HTMLElement
              navigate(`${chapterLocation(projectId, chapter.id)}&panel=assembly`)
            }}>章节组合</Button></Space> },
          ]} />}
    </Card>
    <Drawer title={`${panel === 'source' ? '划分场次' : panel === 'assembly' ? '章节组合' : '场次管理'}${selectedChapter ? ` · ${selectedChapter.title}` : ''}`}
      width={panel === 'source' ? '100vw' : 'min(1180px, 96vw)'} rootClassName="chapter-manager" open={!!chapterId && !editingId} onClose={closePanel} destroyOnClose
      afterOpenChange={open => { if (!open && !editingId) restoreFocus() }}>
      {chapterError ? <Alert type="error" message={chapterError} action={<Button onClick={() => setChapterRetry(value => value + 1)}>重试</Button>} />
        : !selectedChapter ? <Spin /> : <>
          {!panel && <Space wrap style={{ marginBottom: 16 }}><Button onClick={() => showSource()}>调整划分</Button></Space>}
          {panel === 'source' ? <ChapterSourcePanel key={chapterId} projectId={projectId} chapterId={chapterId} refreshKey={revision} sequenceId={params.get('mode') === 'manual' ? sequenceId : undefined}
            onChanged={id => { saveChapterBrowse(projectId, chapterId, { sequence: id }); setRevision(value => value + 1); void refresh() }} onEdit={editCurrent} />
            : panel === 'assembly' ? <ChapterAssemblyPanel projectId={projectId} chapterId={chapterId} />
              : <div className={`chapter-scenes-layout${sequenceId ? ' has-selection' : ''}`}>
                <div className="chapter-scenes-list"><ChapterSceneList key={chapterId} projectId={projectId} chapterId={chapterId}
                  selectedId={sequenceId} refreshKey={revision} onDetails={selectSequence} onRestore={selectSequence} onSource={() => showSource()} /></div>
                {sequenceId ? <SequenceDetails projectId={projectId} chapterId={chapterId} sequenceId={sequenceId}
                  onSaved={() => setRevision(value => value + 1)} onClose={() => selectSequence()} onRange={() => showSource(true)} />
                  : <Empty className="chapter-scenes-placeholder" description="选择场次，查看详情或编辑原文范围" />}
              </div>}
        </>}
    </Drawer>
    {editingId && <ChapterRawTextEditorModal open chapterId={editingId} projectId={projectId} onClose={closeEditor}
      onReviewSequences={() => navigate(chapterLocation(projectId, editingId), { replace: true })}
      onSaved={() => { setRevision(value => value + 1); void refresh() }} />}
    <Modal title="新建章节" open={creating} confirmLoading={busy} onCancel={() => guardCreate(() => setCreating(false))} onOk={() => void create()} okText="创建并继续" closable={!busy} maskClosable={!busy} keyboard={!busy}>
      <Space direction="vertical" className="w-full">
        <Input aria-label="章节标题" placeholder="章节标题" value={title} disabled={busy} onChange={event => setTitle(event.target.value)} />
        <Input.TextArea aria-label="章节原文" placeholder="粘贴章节原文" rows={8} value={content} disabled={busy} onChange={event => setContent(event.target.value)} />
      </Space>
    </Modal>
  </div>
}
