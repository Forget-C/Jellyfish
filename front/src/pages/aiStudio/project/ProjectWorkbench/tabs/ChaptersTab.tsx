import { useUiText } from '../../../../../uiText'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Empty, Input, Space, Table } from 'antd'
import { PlusOutlined } from '@ant-design/icons'
import { flushSync } from 'react-dom'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { StudioChaptersService } from '../../../../../services/generated'
import { useChapters, newId } from '../hooks/useProjectData'
import { ChapterRawTextEditorDrawer, type ChapterDraft } from '../../../chapter/components/ChapterRawTextEditorDrawer'
import { chapterAction, chapterActionLocation, chapterLocation, readChapterBrowse, saveChapterBrowse, workbenchManagementLocation } from '../../../directing/chapterNavigation'
import { WorkspaceDrafts } from '../../../directing/WorkspaceDrafts'
import { chapterProduction } from '../../chapterProduction'
import { ProjectContentToolbar } from '../ProjectContentToolbar'
import '../project-production.css'
import '../../../directing/workspace.css'

/** 章节表格负责章节管理和正文编辑，场次操作进入独立管理页。 */
export function ChaptersTab() {
  const { projectId = '' } = useParams()
  return <WorkspaceDrafts><ChaptersContent key={projectId} /></WorkspaceDrafts>
}

function ChaptersContent() {
  const uiText = useUiText()
  const { projectId = '' } = useParams()
  const navigate = useNavigate()
  const { state, key: locationKey } = useLocation()
  const [params, setParams] = useSearchParams()
  const [page, setPage] = useState(() => readChapterBrowse(projectId).page || 1)
  const [query, setQuery] = useState(() => readChapterBrowse(projectId).query || '')
  const { chapters, loading, total, totalKnown, error, refresh } = useChapters(projectId, { page, pageSize: 10, query })
  const [creating, setCreating] = useState(false)
  const editingId = params.get('edit') || undefined
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const lastEditing = useRef(editingId)
  useEffect(() => {
    if (lastEditing.current && !editingId) restoreFocus()
    lastEditing.current = editingId
  }, [editingId])
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
  const returnedChapter = typeof state?.chapterReturn === 'string' ? state.chapterReturn : undefined
  const focusedReturn = useRef<string>()
  const [offPageChapter, setOffPageChapter] = useState<{ id: string; title: string }>()
  const returnIsListed = chapters.some(chapter => chapter.id === returnedChapter)
  const showOffPageChapter = !loading && !returnIsListed && offPageChapter?.id === returnedChapter && offPageChapter
  useEffect(() => {
    if (loading || !returnedChapter || returnIsListed || focusedReturn.current === locationKey) return
    const request = StudioChaptersService.getChapterApiV1StudioChaptersChapterIdGet({ chapterId: returnedChapter })
    void request.then(({ data }) => {
      if (data?.project_id === projectId) setOffPageChapter({ id: data.id, title: data.title })
    }).catch(() => { /* The chapter list remains usable if the return target is unavailable. */ })
    return () => request.cancel()
  }, [loading, projectId, returnedChapter, returnIsListed, locationKey])
  useEffect(() => {
    if (loading || !returnedChapter || !root.current || focusedReturn.current === locationKey) return
    const button = Array.from(root.current.querySelectorAll<HTMLButtonElement>('button[data-chapter-workbench]'))
      .find(item => item.dataset.chapterWorkbench === returnedChapter)
    if (!button) return
    focusedReturn.current = locationKey
    if (!root.current.contains(document.activeElement)) button.focus()
  }, [loading, returnedChapter, returnIsListed, showOffPageChapter, locationKey])
  useEffect(() => {
    if (params.get('create') === '1') {
      setCreating(true)
      setParams(previous => { const next = new URLSearchParams(previous); next.delete('create'); return next }, { replace: true })
    }
  }, [params, setParams])
  const openEditor = (id: string) => {
    trigger.current = document.activeElement as HTMLElement
    navigate(`${chapterLocation(projectId)}&edit=${encodeURIComponent(id)}`)
  }
  const openAction = (chapter: { id: string; rawText?: string; sequenceCount?: number }) => {
    trigger.current = document.activeElement as HTMLElement
    navigate(chapterActionLocation(projectId, chapter.id, chapterAction(chapter).target))
  }
  const openManagement = (id: string) => navigate(workbenchManagementLocation(projectId, id))
  const closeEditor = () => setParams(previous => {
    const next = new URLSearchParams(previous)
    for (const key of ['chapter', 'sequence', 'panel', 'edit', 'mode']) next.delete(key)
    return next
  }, { replace: true })
  const restoreFocus = () => {
    if (trigger.current?.isConnected) trigger.current.focus({ preventScroll: true })
    else root.current?.querySelector<HTMLInputElement>('input[data-chapter-search]')?.focus({ preventScroll: true })
  }
  /** 分页列表不能推算最后一章序号；沿现有接口按序号倒序读取一条。 */
  const create = async (draft: ChapterDraft, enter: boolean) => {
    const last = await StudioChaptersService.listChaptersApiV1StudioChaptersGet({ projectId, page: 1, pageSize: 1, order: 'index', isDesc: true })
    if (!last.data) throw new Error(uiText("章节顺序读取失败，请重试"))
    const id = newId('c')
    await StudioChaptersService.createChapterApiV1StudioChaptersPost({ requestBody: {
      ...draft, id, project_id: projectId, index: (last.data.items[0]?.index || 0) + 1, summary: '', status: 'draft',
    } })
    flushSync(() => setCreating(false))
    void refresh()
    if (enter) {
      navigate(draft.raw_text?.trim()
        ? workbenchManagementLocation(projectId, id, undefined, 'division')
        : `${chapterLocation(projectId)}&edit=${id}`)
    }
  }
  const changePage = (nextPage: number, nextQuery = query) => {
    saveChapterBrowse(projectId, '', { page: nextPage, query: nextQuery, top: 0 })
    setPage(nextPage); setQuery(nextQuery)
  }
  return <div ref={root} className="project-chapter-list">
    <ProjectContentToolbar>
      <div className="project-content-toolbar-leading">
        <h1 className="app-page-title">{uiText("章节场次")}</h1>
        <span className="project-toolbar-count">{loading || error || !totalKnown ? uiText("数量未确认") : uiText("共 {{total}} 章", { total })}</span>
        <Input.Search data-chapter-search aria-label={uiText("搜索章节")} placeholder={uiText("搜索章节标题或摘要")} allowClear value={query}
          onChange={event => changePage(1, event.target.value)} />
      </div>
      <Button type="primary" icon={<PlusOutlined />} onClick={event => { trigger.current = event.currentTarget; setCreating(true) }}>{uiText("新建章节")}</Button>
    </ProjectContentToolbar>
    <div className="project-production-surface">
      {showOffPageChapter && <Alert type="info" message={uiText("返回章节：{{title}}", { title: showOffPageChapter.title })} action={<Space wrap>
        <Button onClick={() => openEditor(showOffPageChapter.id)}>{uiText("编辑章节")}</Button>
        <Button data-chapter-workbench={showOffPageChapter.id} onClick={() => openManagement(showOffPageChapter.id)}>{uiText("工作台管理")}</Button>
      </Space>} />}
      {error ? <Alert type="error" showIcon message={error} action={<Button onClick={() => void refresh()}>{uiText("重试")}</Button>} />
        : <Table rowKey="id" className="chapter-table" dataSource={chapters} loading={loading}
          pagination={{ current: page, pageSize: 10, total, showSizeChanger: false, onChange: next => changePage(next) }}
          locale={{ emptyText: <Empty description={query ? uiText("没有匹配的章节") : uiText("添加第一章，开始划分场次")} /> }} columns={[
            { title: uiText("章节名称"), key: 'title', width: '38%', render: (_, chapter) => {
              const production = chapterProduction(chapter)
              return <div className="chapter-list-production">
                <Button type="link" className="chapter-title-link" aria-label={uiText("{{index}}. {{title}} · 编辑章节", { index: chapter.index, title: chapter.title })} onClick={() => openEditor(chapter.id)}>{chapter.index}. {chapter.title}</Button>
                <div className="chapter-list-state">
                  <span className="chapter-production-state" data-tone={production.tone}>{production.state}</span>
                </div>
              </div>
            } },
            { title: uiText("原文预览"), key: 'preview', responsive: ['lg'], render: (_, chapter) => <p className="chapter-table-preview">{chapter.rawText || uiText("未填写原文")}</p> },
            { title: uiText("原文字数"), key: 'words', width: 100, responsive: ['md'], render: (_, chapter) => chapter.rawText?.length ?? 0 },
            { title: uiText("场次数量"), key: 'count', width: 100, render: (_, chapter) => chapter.sequenceCount === undefined ? '—' : uiText("{{count}} 场", { count: chapter.sequenceCount }) },
            { title: uiText("操作"), key: 'actions', width: 200, render: (_, chapter) => {
              const action = chapterAction(chapter)
              return <Space size={8} wrap>
                {action.target === 'edit' && <Button type="link" onClick={() => openEditor(chapter.id)}>{uiText("编辑原文")}</Button>}
                <Button type="link" data-chapter-workbench={chapter.id}
                  onClick={() => action.target === 'source' ? openAction(chapter) : openManagement(chapter.id)}>
                  {action.target === 'source' ? uiText("划分场次") : uiText("工作台管理")}
                </Button>
              </Space>
            } },
          ]} />}
    </div>
    {editingId && <ChapterRawTextEditorDrawer key={editingId} open chapterId={editingId} projectId={projectId} onClose={closeEditor}
      onReviewSequences={() => navigate(workbenchManagementLocation(projectId, editingId, undefined, 'division'), { replace: true })}
      onSaved={() => void refresh()} />}
    {creating && <ChapterRawTextEditorDrawer open projectId={projectId} onClose={() => setCreating(false)} onCreate={create} />}
  </div>
}
