import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { ArrowRightOutlined, MoreOutlined, PictureOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Dropdown, Empty, Input, Modal, Space, Spin, Tag, message } from 'antd'
import type { InputRef } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { ApiError, StudioDirectingService, type SceneCanvasSummary, type StoryboardTaskSummary } from '../../../services/generated'
import { readChapterBrowse, sceneCanvasLocation, workbenchManagementLocation } from './chapterNavigation'
import { directingError } from './common'
import { SceneCanvasDeletion } from './SceneCanvasDeletion'
import { WorkbenchCanvasCreation } from './WorkbenchCanvasCreation'
import { WorkbenchCanvasRename } from './WorkbenchCanvasRename'
import { useWorkspaceDraftStatus } from './WorkspaceDrafts'
import './workbench-canvas-cards.css'
import { canOpenStoryboardCanvas } from './storyboardCanvasAccess'
import { managementBrowseKey, readManagementBrowse, saveManagementBrowse } from './managementBrowse'
import { WorkbenchStoryboardReview } from './WorkbenchStoryboardReview'

type Scope = { projectId: string; chapterId: string; sequenceId: string }

function activeTask(task?: StoryboardTaskSummary | null) {
  return task?.status === 'queued' || task?.status === 'running'
}

function taskLabel(task: StoryboardTaskSummary) {
  if (task.status === 'queued') return '分镜排队中'
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
export function WorkbenchCanvasCards({ projectId, chapterId, sequenceId, historical, canCreate, actionHost, filterHost,
  targetCanvas, targetTask, onCloseTask, onChange, onReviewSource }: Scope & {
  filterHost: HTMLDivElement | null; historical: boolean; canCreate: boolean; actionHost: HTMLDivElement | null; onChange: () => void
  targetCanvas?: string | null; targetTask?: string | null; onCloseTask: (canvasId?: string) => void
  onReviewSource: (canvasId?: string) => void
}) {
  const navigate = useNavigate()
  const { state } = useLocation()
  const [notices, noticeContext] = message.useMessage()
  const [canvases, setCanvases] = useState<SceneCanvasSummary[]>()
  const lastRead = useRef<SceneCanvasSummary[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const browseKey = managementBrowseKey(projectId, chapterId, sequenceId, 'storyboard')
  const [query, setQuery] = useState(() => targetCanvas || targetTask ? '' : readManagementBrowse(browseKey).query ?? '')
  useEffect(() => { saveManagementBrowse(browseKey, { query }) }, [browseKey, query])
  const [quickEntry, setQuickEntry] = useState(false)
  const [reviewCanvas, setReviewCanvas] = useState<string>()
  const [detail, setDetail] = useState<string>()
  const [menuOpen, setMenuOpen] = useState<string>()
  const detailTrigger = useRef<HTMLElement>()
  const [linkedTask, setLinkedTask] = useState<{ id: string; task?: StoryboardTaskSummary; error?: string }>()
  const targetElement = useRef<HTMLLIElement>(null)
  const focusedTarget = useRef<string>()
  const [rename, setRename] = useState<Pick<SceneCanvasSummary, 'id' | 'name'>>()
  const menuButtons = useRef(new Map<string, HTMLElement>())
  const searchInput = useRef<InputRef>(null)
  const collection = useRef<HTMLUListElement>(null)
  const focusRestored = useRef(false)
  useEffect(() => {
    if (!canvases || focusRestored.current || targetCanvas || targetTask) return
    focusRestored.current = true
    const id = readManagementBrowse(browseKey).focus
    if (id) collection.current?.querySelector<HTMLElement>(`[data-canvas-id="${CSS.escape(id)}"] .management-canvas-name`)?.focus({ preventScroll: true })
  }, [canvases, browseKey, targetCanvas, targetTask])
  const [deleteTarget, setDeleteTarget] = useState<string>()
  const [deleteError, setDeleteError] = useState('')
  const drafts = useWorkspaceDraftStatus()
  const [created, setCreated] = useState<string>()
  const recentCanvas = readChapterBrowse(projectId, chapterId).managementCanvas
  const linked = linkedTask?.id === targetTask ? linkedTask : undefined
  const mismatched = !!(targetCanvas && linked?.task && linked.task.canvas_id !== targetCanvas)
  const targetId = !mismatched && !linked?.error ? targetCanvas ?? linked?.task?.canvas_id : undefined
  const invalidCanvas = !!(targetId && canvases && !canvases.some(canvas => canvas.id === targetId))
  const taskCard = canvases?.find(canvas => canvas.id === linked?.task?.canvas_id)
  const linkedSummary = taskCard?.latest_storyboard?.task_id === linked?.task?.task_id ? taskCard?.latest_storyboard : linked?.task
  const taskDetail = !targetCanvas && !invalidCanvas ? linkedSummary : undefined
  const detailCard = canvases?.find(canvas => canvas.id === (detail ?? taskDetail?.canvas_id))
  const detailTask = detail ? detailCard?.latest_storyboard : detailCard && taskDetail
  const hasActive = canvases?.some(canvas => activeTask(canvas.latest_storyboard))

  useEffect(() => {
    if (targetCanvas || targetTask) setQuery('')
    setDetail(undefined)
    setReviewCanvas(undefined)
    focusedTarget.current = undefined
    if (!targetTask) return
    let active = true
    const request = StudioDirectingService.directingStoryboardGet({ projectId, chapterId, sequenceId, taskId: targetTask })
    void request.then(response => {
      if (!response.data) throw new Error('分镜任务结果未返回')
      if (active) setLinkedTask({ id: targetTask, task: response.data })
    }).catch(cause => {
      if (active) setLinkedTask({ id: targetTask,
        error: cause instanceof ApiError && cause.status === 404 ? '此分镜任务或原画布已不可用' : directingError(cause) })
    })
    return () => { active = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, targetTask, targetCanvas])

  useEffect(() => {
    if (!targetId || !targetElement.current || focusedTarget.current === targetId || targetTask && !linked) return
    focusedTarget.current = targetId
    targetElement.current.scrollIntoView({ block: 'nearest' })
    if (!taskDetail) targetElement.current.focus({ preventScroll: true })
  }, [canvases, targetId, targetTask, linked, taskDetail])

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
      setCanvases(response.data.canvases)
      setError('')
    }).catch(cause => {
      if (!current) return
      if (cause instanceof ApiError && cause.status === 404) {
        lastRead.current = undefined
        setCanvases(undefined)
      }
      setError(directingError(cause))
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false; request.cancel() }
  }, [projectId, chapterId, sequenceId, revision, notices])

  useEffect(() => {
    if (!hasActive) return
    const timer = window.setTimeout(() => setRevision(value => value + 1), 2000)
    return () => window.clearTimeout(timer)
  }, [hasActive, canvases, error, revision])

  useEffect(() => {
    const refresh = () => setRevision(value => value + 1)
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [])

  useEffect(() => {
    if (targetId && canvases && linked?.task && canvases.find(canvas => canvas.id === targetId)?.latest_storyboard?.task_id === linked.task.task_id) {
      setQuickEntry(false); setReviewCanvas(targetId)
    }
  }, [targetId, canvases, linked?.task])
  const openCanvas = (canvasId: string, taskId?: string) => {
    saveManagementBrowse(browseKey, { focus: canvasId })
    navigate(sceneCanvasLocation(projectId, chapterId, sequenceId, canvasId, taskId), { state })
  }
  const closeDetail = () => {
    if (detail) setDetail(undefined)
    else onCloseTask(taskDetail?.canvas_id)
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
  const shown = canvases?.filter(canvas => canvas.name.toLocaleLowerCase().includes(keyword))
  return <section aria-labelledby="management-canvas-list-title" className="management-canvas-cards">
    {noticeContext}
    <WorkbenchCanvasCreation {...{ projectId, chapterId, sequenceId, actionHost, onReviewSource }} editable={canCreate} onAccepted={id => {
      setCreated(id)
      setQuery('')
      setRevision(value => value + 1)
      onChange()
    }} />
    {filterHost && createPortal(<div className="management-canvas-toolbar">
      <span id="management-canvas-list-title" className="management-list-count">{canvases ? `${canvases.length} 张画布` : '画布数量未确认'}</span>
      {<Input disabled={!canvases?.length} ref={searchInput} aria-label="搜索画布" placeholder="按名称搜索画布" allowClear value={query}
        onChange={event => setQuery(event.target.value)} />}
    </div>, filterHost)}
    {error && <Alert showIcon type="error" message={error} action={<Button size="small"
      onClick={() => setRevision(value => value + 1)}>重试读取画布</Button>} />}
    {(linked?.error || mismatched || invalidCanvas) && <Alert showIcon type="warning"
      message={linked?.error ?? (mismatched ? '此分镜任务不属于指定画布' : '此画布不属于当前场次或已不可用')} />}
    {deleteError && <Alert showIcon type="warning" message={deleteError} />}
    {loading && !canvases && !error && <Spin aria-label="正在读取本场画布" />}
    {!error && canvases?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={historical ? '此历史场次没有画布' : '本场尚无画布，可生成新分镜画布开始设计'} />}
    {!error && !!canvases?.length && shown?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的画布" />}
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

        return <li key={canvas.id} data-canvas-id={canvas.id} ref={located ? targetElement : undefined} tabIndex={located ? -1 : undefined}>
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
    {reviewCanvas && canvases?.find(canvas => canvas.id === reviewCanvas) && <WorkbenchStoryboardReview key={reviewCanvas}
      {...{ projectId, chapterId, sequenceId, historical }} quickEntry={quickEntry} canvas={canvases.find(canvas => canvas.id === reviewCanvas)!}
      onClose={() => { setReviewCanvas(undefined); setRevision(value => value + 1); if (targetTask) onCloseTask(reviewCanvas) }} onChange={() => { setRevision(value => value + 1); onChange() }}
      onEnter={() => openCanvas(reviewCanvas)} onReviewSource={() => onReviewSource(reviewCanvas)} />}
    {rename && <WorkbenchCanvasRename {...{ projectId, chapterId, sequenceId }} canvasId={rename.id}
      initialName={rename.name} onClose={closeRename} />}
    <Modal className="management-canvas-dialog" title="分镜任务详情" afterClose={() => detailTrigger.current?.focus({ preventScroll: true })} open={!!detailTask && !reviewCanvas && (!!detail || detailTask.task_id !== detailCard?.latest_storyboard?.task_id)} onCancel={closeDetail}
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
