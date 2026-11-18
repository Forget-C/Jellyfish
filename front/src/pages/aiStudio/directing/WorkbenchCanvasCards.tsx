import { createPortal } from 'react-dom'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRightOutlined, MoreOutlined, PictureOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Dropdown, Empty, Input, Modal, Space, Spin, Tag, message } from 'antd'
import type { InputRef } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, StudioDirectingService, type SceneCanvasSummary, type StoryboardTaskSummary } from '../../../services/generated'
import { readChapterBrowse, sceneCanvasLocation, workbenchManagementLocation } from './chapterNavigation'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { SceneCanvasDeletion } from './SceneCanvasDeletion'
import { WorkbenchCanvasCreation } from './WorkbenchCanvasCreation'
import { WorkbenchCanvasRename } from './WorkbenchCanvasRename'
import { useWorkspaceDraftStatus } from './WorkspaceDrafts'
import './workbench-canvas-cards.css'
import { canOpenStoryboardCanvas } from './storyboardCanvasAccess'
import { managementBrowseKey, readManagementBrowse, saveManagementBrowse } from './managementBrowse'
import { WorkbenchStoryboardReview } from './WorkbenchStoryboardReview'
import { CardListPagination } from '../../../components/layout/CardListPagination'
import { WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { useCardPageSize } from '../../../components/layout/useCardPageSize'

type Scope = { projectId: string; chapterId: string; sequenceId: string }

function activeTask(task?: StoryboardTaskSummary | null) {
  return task?.status === 'queued' || task?.status === 'running'
}

function taskLabel(task: StoryboardTaskSummary) {
  if (task.status === 'queued') return '分镜排队中'
  if (task.stage === 'writing_video_prompts') return '正在编写视频提示词'
  if (task.stage === 'reviewing_storyboard') return '正在审查分镜连续性'
  if (task.stage === 'repairing_storyboard') return '正在定向修正分镜'
  if (task.stage === 'rechecking_storyboard') return '正在复核分镜连续性'
  if (task.review_state === 'incomplete') return '分镜审查未完成，草案已保留'
  if (task.review_state === 'conflict') return '分镜存在设计冲突'
  if (task.review_state === 'warning') return '部分连续性依据不足'
  if (task.status === 'running') return task.stage === 'assembling_storyboard' ? '正在校验并组装画布' : '正在提取分镜'
  if (task.status === 'failed') return '分镜失败'
  if (task.status === 'cancelled') return '分镜已取消'
  return '分镜生成成功'
}

/** 按本场读取轻量画布卡；任务完成只更新卡片，打开画布仍由用户发起。 */
export function WorkbenchCanvasCards({ projectId, chapterId, sequenceId, sceneName, historical, canCreate, actionHost, filterHost,
  sceneNotices, targetCanvas, targetTask, onCloseTask, onChange, onReviewSource }: Scope & {
  sceneName: string; filterHost: HTMLDivElement | null; historical: boolean; canCreate: boolean; actionHost: HTMLDivElement | null; onChange: () => void
  targetCanvas?: string | null; targetTask?: string | null; onCloseTask: (canvasId?: string) => void
  sceneNotices: ReactNode
  onReviewSource: (canvasId?: string) => void
}) {
  const navigate = useNavigate()
  const { state, key: locationKey } = useLocation()
  const [notices, noticeContext] = message.useMessage()
  const [canvases, setCanvases] = useState<SceneCanvasSummary[]>()
  const lastRead = useRef<SceneCanvasSummary[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const browseKey = managementBrowseKey(projectId, chapterId, sequenceId, 'storyboard')
  const returningCanvas = useMemo(() => {
    const { focus, focusEntry } = readManagementBrowse(browseKey)
    const editorBack = !targetTask && targetCanvas === focus && state?.sceneCanvasListOrigin === browseKey
    return focus && (focusEntry === locationKey || editorBack) ? focus : undefined
  }, [browseKey, locationKey, state?.sceneCanvasListOrigin, targetCanvas, targetTask])
  const taskTarget = returningCanvas ? undefined : targetTask
  const routeEntry = useMemo(() => ({ locationKey, targetCanvas, taskTarget }), [locationKey, targetCanvas, taskTarget])
  const [query, setQuery] = useState(() => readManagementBrowse(browseKey).query ?? '')
  const [page, setPage] = useState(() => readManagementBrowse(browseKey).page ?? 1)
  const [compact, setCompact] = useState(() => !matchMedia('(min-width: 1024px)').matches)
  const { panel, measureGrid, measureCard, pageSize } = useCardPageSize()
  const previousPage = useRef<{ size: number; start: number; firstId?: string }>()
  const restoredScroll = useRef(false)
  useEffect(() => { saveManagementBrowse(browseKey, { query }) }, [browseKey, query])
  const [quickEntry, setQuickEntry] = useState(false)
  const [reviewCanvas, setReviewCanvas] = useState<string>()
  const [acceptedReviewTask, setAcceptedReviewTask] = useState<string>()
  const [submittingReviewTask, setSubmittingReviewTask] = useState<StoryboardTaskSummary>()
  const currentEntry = useRef<typeof routeEntry>()
  const [detail, setDetail] = useState<string>()
  const [menuOpen, setMenuOpen] = useState<string>()
  const detailTrigger = useRef<HTMLElement>()
  const [linkedTask, setLinkedTask] = useState<{ id: string; entry: string; task?: StoryboardTaskSummary; error?: string }>()
  const [rename, setRename] = useState<Pick<SceneCanvasSummary, 'id' | 'name'>>()
  const menuButtons = useRef(new Map<string, HTMLElement>())
  const searchInput = useRef<InputRef>(null)
  const collection = useRef<HTMLUListElement>(null)
  const refreshFocus = useRef<Element>()
  const locatedRoute = useRef<string>()
  const [canvasToReveal, setCanvasToReveal] = useState<{ id: string; focus?: 'card' | 'name' }>()
  const [returnMissing, setReturnMissing] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<string>()
  const [deleteError, setDeleteError] = useState('')
  const drafts = useWorkspaceDraftStatus()
  const [created, setCreated] = useState<string>()
  const locatedCreation = useRef<string>()
  const recentCanvas = readChapterBrowse(projectId, chapterId).managementCanvas
  const linked = linkedTask?.id === taskTarget && linkedTask?.entry === locationKey ? linkedTask : undefined
  const mismatched = !!(targetCanvas && linked?.task && linked.task.canvas_id !== targetCanvas)
  const targetId = !mismatched && !linked?.error && (!taskTarget || linked) ? targetCanvas ?? linked?.task?.canvas_id : undefined
  const invalidCanvas = !!(targetId && canvases && !canvases.some(canvas => canvas.id === targetId))
  const targetWarning = linked?.error ?? (mismatched ? '此分镜任务不属于指定画布' :
    invalidCanvas && !returningCanvas ? '此画布不属于当前场次或已不可用' : undefined)
  const taskCard = canvases?.find(canvas => canvas.id === linked?.task?.canvas_id)
  const linkedSummary = taskCard?.latest_storyboard?.task_id === linked?.task?.task_id ? taskCard?.latest_storyboard : linked?.task
  const taskDetail = !mismatched && !invalidCanvas ? linkedSummary : undefined
  const detailCard = canvases?.find(canvas => canvas.id === (detail ?? taskDetail?.canvas_id))
  const detailTask = detail ? detailCard?.latest_storyboard : detailCard && taskDetail
  const reviewCard = canvases?.find(canvas => canvas.id === reviewCanvas)
  const linkedReviewTask = linked?.task?.canvas_id === reviewCard?.id ? linked?.task : undefined
  const latestReviewTaskId = reviewCard?.latest_storyboard?.task_id
  const reviewTaskChanged = linkedReviewTask && linkedReviewTask.task_id !== latestReviewTaskId &&
    (!acceptedReviewTask || acceptedReviewTask !== latestReviewTaskId)
  const activeReview = reviewCard && reviewTaskChanged
    ? submittingReviewTask ? { ...reviewCard, latest_storyboard: submittingReviewTask } : undefined
    : reviewCard
  const hasActive = canvases?.some(canvas => activeTask(canvas.latest_storyboard))

  useLayoutEffect(() => {
    currentEntry.current = routeEntry
    locatedRoute.current = undefined
    detailTrigger.current = undefined
    setDetail(undefined)
    setReviewCanvas(undefined)
    setAcceptedReviewTask(undefined)
    setSubmittingReviewTask(undefined)
    setReturnMissing(false)
    setCanvasToReveal(undefined)
    return () => { currentEntry.current = undefined }
  }, [routeEntry])

  useEffect(() => {
    if (!taskTarget) return
    let active = true
    const request = StudioDirectingService.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId: taskTarget })
    void request.then(response => {
      if (!response.data) throw new Error('分镜任务结果未返回')
      if (active) setLinkedTask({ id: taskTarget, entry: locationKey, task: response.data })
    }).catch(cause => {
      if (active) setLinkedTask({ id: taskTarget, entry: locationKey,
        error: cause instanceof ApiError && cause.status === 404 ? '此分镜任务或原画布已不可用' : apiErrorMessage(cause) })
    })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, taskTarget, locationKey])

  useEffect(() => {
    let current = true
    const request = StudioDirectingService.directingSceneCanvases({ projectId, chapterId, sequenceId })
    void request.then(response => {
      if (!current) return
      if (!response.data) throw new Error('无法读取本场画布')
      const previous = new Set(lastRead.current?.flatMap(canvas =>
        activeTask(canvas.latest_storyboard) ? [canvas.latest_storyboard?.task_id] : []))
      for (const canvas of response.data.canvases) {
        const task = canvas.latest_storyboard
        if (task && !activeTask(task) && previous.has(task.task_id)) {
          const label = canvas.candidate_storyboard_task_id === task.task_id
            ? canvas.storyboard_review_required ? '分镜需要核对' : '分镜已就绪'
            : taskLabel(task)
          void notices.info(`${canvas.name}：${label}`)
        }
      }
      lastRead.current = response.data.canvases
      const activeElement = document.activeElement
      if (activeElement && collection.current?.contains(activeElement)) refreshFocus.current = activeElement
      setCanvases(response.data.canvases)
      setError('')
    }).catch(cause => {
      if (!current) return
      if (cause instanceof ApiError && cause.status === 404) {
        lastRead.current = undefined
        setCanvases(undefined)
      }
      setError(apiErrorMessage(cause))
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, revision, notices])

  useEffect(() => {
    if (!hasActive) return
    const timer = window.setTimeout(() => setRevision(value => value + 1), 2000)
    return () => window.clearTimeout(timer)
  }, [hasActive, canvases, error, revision])

  useEffect(() => {
    const media = matchMedia('(min-width: 1024px)')
    const update = () => setCompact(!media.matches)
    media.addEventListener('change', update)
    update()
    return () => media.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  const openCanvas = (canvasId: string) => {
    saveManagementBrowse(browseKey, { focus: canvasId, focusEntry: locationKey })
    navigate(sceneCanvasLocation(projectId, chapterId, sequenceId, canvasId), {
      state: { ...state, sceneCanvasListOrigin: browseKey },
    })
  }
  const closeDetail = () => {
    if (detail) setDetail(undefined)
    else onCloseTask(taskDetail?.canvas_id)
  }
  const restoreDetailFocus = () => {
    const trigger = detailTrigger.current
    detailTrigger.current = undefined
    if (trigger?.isConnected) trigger.focus({ preventScroll: true })
    else if (trigger) searchInput.current?.focus()
  }
  const closeRename = (name?: string) => {
    if (!rename) return
    const id = rename.id
    setRename(undefined)
    if (name !== undefined) {
      setCanvases(previous => previous?.map(canvas => canvas.id === id ? { ...canvas, name } : canvas))
      setRevision(value => value + 1)
    }
    requestAnimationFrame(() => {
      const button = menuButtons.current.get(id)
      if (button) button.focus({ preventScroll: true })
      else searchInput.current?.focus({ preventScroll: true })
    })
  }
  const menuAction = (action: () => void) => {
    setMenuOpen(undefined)
    requestAnimationFrame(action)
  }
  const keyword = query.trim().toLocaleLowerCase()
  const matches = useMemo(() => canvases?.filter(canvas => canvas.name.toLocaleLowerCase().includes(keyword)), [canvases, keyword])
  const matchCount = matches?.length ?? 0
  const lastPage = Math.max(1, Math.ceil(matchCount / (pageSize || 1)))
  const currentPage = Math.min(page, lastPage)
  const start = (currentPage - 1) * pageSize
  const shown = matches?.slice(start, start + pageSize)
  const listReady = !!matches && pageSize > 0

  useLayoutEffect(() => {
    const activeElement = refreshFocus.current
    refreshFocus.current = undefined
    if (activeElement && !activeElement.isConnected && document.activeElement === document.body) {
      searchInput.current?.focus()
    }
  }, [canvases])

  useLayoutEffect(() => {
    if (!matches || !pageSize) return
    const previous = previousPage.current
    previousPage.current = { size: pageSize, start, firstId: matches[start]?.id }
    if (previous && previous.size !== pageSize) {
      const anchorIndex = matches.findIndex(canvas => canvas.id === previous.firstId)
      setPage(Math.min(lastPage, Math.floor((anchorIndex < 0 ? previous.start : anchorIndex) / pageSize) + 1))
    } else if (page > lastPage) setPage(lastPage)
  }, [matches, pageSize, start, lastPage, page])

  useLayoutEffect(() => {
    if (!listReady) return
    if (panel.current) panel.current.scrollTop = restoredScroll.current ? 0 : readManagementBrowse(browseKey).top ?? 0
    restoredScroll.current = true
    saveManagementBrowse(browseKey, { page: currentPage })
  }, [browseKey, currentPage, keyword, listReady, panel])

  useLayoutEffect(() => {
    const id = returningCanvas ?? targetId
    if ((!id && !targetWarning) || !matches || !canvases || !pageSize || !filterHost || locatedRoute.current === locationKey) return
    locatedRoute.current = locationKey
    if (targetWarning) {
      if (panel.current) panel.current.scrollTop = 0
      return
    }
    if (!id) return
    const matchIndex = matches.findIndex(canvas => canvas.id === id)
    if (returningCanvas) {
      saveManagementBrowse(browseKey, { focus: undefined, focusEntry: undefined })
      if (matchIndex < 0) {
        setReturnMissing(true)
        searchInput.current?.focus({ preventScroll: true })
        return
      }
    }
    const fullIndex = canvases.findIndex(canvas => canvas.id === id)
    if (fullIndex < 0) return
    if (matchIndex < 0) setQuery('')
    setPage(Math.floor((matchIndex < 0 ? fullIndex : matchIndex) / pageSize) + 1)
    setCanvasToReveal({ id, focus: returningCanvas ? 'name' : linked?.task ? undefined : 'card' })
    if (linked?.task && canvases[fullIndex].latest_storyboard?.task_id === linked.task.task_id) {
      setQuickEntry(false)
      setReviewCanvas(id)
    }
  }, [browseKey, canvases, filterHost, linked, locationKey, matches, pageSize, panel, returningCanvas, targetId, targetWarning])

  useLayoutEffect(() => {
    if (!created || !canvases || !matches || !pageSize || locatedCreation.current === created) return
    const index = canvases.findIndex(canvas => canvas.id === created)
    if (index < 0) return
    locatedCreation.current = created
    const matchIndex = matches.findIndex(canvas => canvas.id === created)
    if (matchIndex < 0) setQuery('')
    setPage(Math.floor((matchIndex < 0 ? index : matchIndex) / pageSize) + 1)
    setReturnMissing(false)
    setCanvasToReveal({ id: created })
  }, [canvases, created, matches, pageSize])

  useLayoutEffect(() => {
    if (!canvasToReveal || !shown?.some(canvas => canvas.id === canvasToReveal.id)) return
    const card = collection.current?.querySelector<HTMLElement>(`[data-canvas-id="${CSS.escape(canvasToReveal.id)}"]`)
    const trigger = (canvasToReveal.focus === 'name' ? card?.querySelector<HTMLElement>('.management-canvas-name') : card) ?? card
    trigger?.scrollIntoView({ block: 'nearest' })
    if (canvasToReveal.focus) trigger?.focus({ preventScroll: true })
    setCanvasToReveal(undefined)
  }, [canvasToReveal, shown])

  const changeQuery = (value: string) => {
    setPage(1)
    setQuery(value)
    setReturnMissing(false)
  }
  return <section aria-labelledby="management-canvas-list-title" className="management-canvas-cards">
    {noticeContext}
    <WorkbenchCanvasCreation {...{ projectId, chapterId, sequenceId, sceneName, actionHost, onReviewSource }} editable={canCreate} onAccepted={id => {
      setCreated(id)
      setRevision(value => value + 1)
      onChange()
    }} />
    {filterHost && createPortal(<div className="management-canvas-toolbar">
      <span id="management-canvas-list-title" className="management-list-count" role="status">{canvases ? `${keyword ? '匹配 ' : ''}${matchCount} 张画布` : '画布数量未确认'}</span>
      <Input disabled={!canvases} ref={searchInput} aria-label="搜索画布" placeholder="按名称搜索画布" allowClear value={query}
        onChange={event => changeQuery(event.target.value)} />
    </div>, filterHost)}
    <div className="management-canvas-page-body">
      <div ref={measureGrid} className="app-card-list-measure management-canvas-page-measure" aria-hidden="true">
        <div ref={measureCard} className="management-canvas-page-card" />
      </div>
      <WorkspaceScrollPanel ref={panel} className="management-canvas-scroll" onScroll={event => {
        if (restoredScroll.current) saveManagementBrowse(browseKey, { top: event.currentTarget.scrollTop })
      }}>
        {sceneNotices}
        {error && <Alert showIcon type="error" message={error} action={<Button size="small"
          onClick={() => setRevision(value => value + 1)}>重试读取画布</Button>} />}
        {returnMissing && <Alert showIcon type="info" message="原画布无法在当前列表中定位" />}
        {targetWarning && <Alert showIcon type="warning" message={targetWarning} />}
        {deleteError && <Alert showIcon type="warning" message={deleteError} />}
        {loading && !canvases && !error && <Spin aria-label="正在读取本场画布" />}
        {!error && !keyword && matchCount === 0 && canvases && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={historical ? '此历史场次没有画布' : '本场尚无画布，可生成新分镜画布开始设计'} />}
        {!error && keyword && matches?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的画布">
          <Button onClick={() => { changeQuery(''); searchInput.current?.focus() }}>清除搜索</Button>
        </Empty>}
        {!!shown?.length && <ul ref={collection} className="management-card-grid" aria-label="本场画布">
          {shown.map(canvas => {
            const task = canvas.latest_storyboard
            const candidateId = canvas.candidate_storyboard_task_id
            const adoptedId = canvas.applied_storyboard_task_id
            const currentTaskIsCandidate = candidateId && task?.task_id === candidateId
            const located = canvas.id === targetId
            const taskStatus = task && !currentTaskIsCandidate && task.task_id !== adoptedId && <Tag
              color={task.status === 'failed' ? 'error' : activeTask(task) ? 'processing' : undefined}>{taskLabel(task)}</Tag>
            const failed = task?.status === 'failed' || task?.status === 'cancelled'

            return <li key={canvas.id} data-canvas-id={canvas.id} tabIndex={-1}>
              <Card size="small" bordered={false} className={canvas.id === created || located ? 'management-canvas-surface management-canvas-created' : 'management-canvas-surface'}>
                <div className="management-canvas-cover" role="img" aria-label="画布默认封面"><PictureOutlined aria-hidden /></div>
                <div className="management-canvas-card-heading">
                  <h4>{canOpenStoryboardCanvas(canvas) ? <Button type="link" className="management-canvas-name" onClick={() => openCanvas(canvas.id)} title={canvas.name}>{canvas.name}<ArrowRightOutlined aria-hidden /></Button> : <span title={canvas.name}>{canvas.name}</span>}</h4>
                  <Dropdown trigger={['click']} open={menuOpen === canvas.id} onOpenChange={open => setMenuOpen(open ? canvas.id : undefined)} menu={{ items: [
                    { key: 'rename', label: '更名', onClick: () => menuAction(() => setRename({ id: canvas.id, name: canvas.name })) },
                    ...(task ? [{ key: 'detail', label: '查看任务详情', onClick: () => menuAction(() => { detailTrigger.current = menuButtons.current.get(canvas.id); setDetail(canvas.id) }) }] : []),
                    { key: 'delete', label: '删除画布', danger: true, onClick: () => menuAction(() => drafts.transition(() => {
                      setDeleteError('')
                      setDeleteTarget(canvas.id)
                    })) },
                  ] }}>
                    <Button type="text" icon={<MoreOutlined />} aria-label={`${canvas.name}更多操作`} ref={element => {
                      if (element) menuButtons.current.set(canvas.id, element)
                      else menuButtons.current.delete(canvas.id)
                    }} />
                  </Dropdown>
                </div>
                <div className="management-canvas-status">
                  {adoptedId ? <Tag color="success">当前已采用</Tag> : canOpenStoryboardCanvas(canvas) ? <Tag>可打开</Tag> : <Tag>{candidateId ? '待采用' : '尚不可打开'}</Tag>}
                  {failed || activeTask(task) ? taskStatus : candidateId ? <Tag color={canvas.storyboard_review_required ? 'warning' : 'success'}>{currentTaskIsCandidate && (task?.review_state === 'conflict' || task?.review_state === 'warning') ? taskLabel(task) : canvas.storyboard_review_required ? '需要核对' : '分镜已就绪'}</Tag>
                    : canvas.source_changed ? <Tag color="warning">原文已变化</Tag> : task?.review_state === 'warning' ? <Tag color="warning">{taskLabel(task)}</Tag> : taskStatus}
                </div>
                {canvas.source_changed && (failed || activeTask(task) || candidateId) && <details className="management-canvas-other"><summary>其他提示</summary><span>原文已变化</span></details>}
                <div className="management-canvas-metadata"><span title="镜头数量暂不可用">— 镜头</span><time dateTime={canvas.created_at}>创建于 {new Date(canvas.created_at).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}</time></div>
                <div className="management-canvas-markers">
                  {canvas.id === recentCanvas && <Tag>最近打开</Tag>}
                  {located && <Tag color="processing">当前定位</Tag>}
                  {canvas.id === created && <Tag color="processing">刚创建</Tag>}
                </div>

                <div className="management-canvas-actions">
                  {(candidateId || task && task.task_id !== adoptedId) && <Button type="link" onClick={() => { setQuickEntry(!canvas.storyboard_review_required); setReviewCanvas(canvas.id) }}>
                    {candidateId ? canvas.storyboard_review_required ? '核对分镜' : '查看并采用分镜' : activeTask(task) ? '查看提取进度' : task?.status === 'failed' || task?.status === 'cancelled' ? '处理提取问题' : '查看任务结果'}
                  </Button>}
                </div>
              </Card>
            </li>
          })}
        </ul>}
      </WorkspaceScrollPanel>
    </div>
    <CardListPagination label="本场画布分页" page={currentPage} pageSize={pageSize} total={matchCount}
      compact={compact} disabled={false} onChange={setPage} />
    {activeReview && <WorkbenchStoryboardReview key={activeReview.id}
      {...{ projectId, chapterId, sequenceId, historical }} quickEntry={quickEntry} canvas={activeReview}
      onClose={() => { setReviewCanvas(undefined); setRevision(value => value + 1); if (taskTarget) onCloseTask(activeReview.id) }}
      onChange={acceptedTaskId => {
        if (currentEntry.current !== routeEntry) return
        if (acceptedTaskId) setAcceptedReviewTask(acceptedTaskId)
        setRevision(value => value + 1)
        onChange()
      }}
      onSubmissionChange={submitting => {
        if (currentEntry.current === routeEntry) setSubmittingReviewTask(submitting ? activeReview.latest_storyboard ?? undefined : undefined)
      }}
      onEnter={() => openCanvas(activeReview.id)} onReviewSource={() => onReviewSource(activeReview.id)} />}
    {rename && <WorkbenchCanvasRename {...{ projectId, chapterId, sequenceId }} canvasId={rename.id}
      initialName={rename.name} onClose={closeRename} />}
    <Modal className="management-canvas-dialog" title="分镜任务详情" afterClose={restoreDetailFocus} open={!!detailTask && !activeReview && (!!detail || detailTask.task_id !== detailCard?.latest_storyboard?.task_id)} onCancel={closeDetail}
      footer={<Space wrap><Button aria-label="关闭分镜任务详情" onClick={closeDetail}>关闭</Button>
        {detailCard && <Button type="primary" onClick={() => navigate(workbenchManagementLocation(projectId, chapterId, sequenceId, 'storyboard', { canvas: detailCard.id, storyboardTask: detailCard.latest_storyboard?.task_id }), { state })}>查看最新处理结果</Button>}
      </Space>}>
      {detailTask && detailCard?.latest_storyboard?.task_id !== detailTask.task_id && <Alert type="info" message="已有后续处理结果；此历史任务仅供查看。" />}
      {detailTask && detailCard && <Descriptions column={1} size="small" items={[
        { key: 'canvas', label: '画布', children: detailCard.name },
        { key: 'status', label: '任务状态', children: taskLabel(detailTask) },
        { key: 'task', label: '任务身份', children: detailTask.task_id },
        ...(detailCard.applied_storyboard_task_id
          ? [{ key: 'adopted', label: '当前采用任务', children: detailCard.applied_storyboard_task_id }] : []),
        ...(detailTask.error ? [{ key: 'error', label: '原因', children: detailTask.error }] : []),
      ]} />}
    </Modal>
    {deleteTarget && <SceneCanvasDeletion key={deleteTarget} {...{ projectId }} canvasId={deleteTarget}
      onClose={() => setDeleteTarget(undefined)} onOpen={() => openCanvas(deleteTarget)} onFailure={setDeleteError}
      onDeleted={() => {
        setCanvases(previous => previous?.filter(canvas => canvas.id !== deleteTarget))
        setRevision(value => value + 1)
        onChange()
      }} />}
  </section>
}
