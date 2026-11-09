import { useEffect, useRef, useState } from 'react'
import { MoreOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Descriptions, Dropdown, Empty, Input, Modal, Spin, Tag, message } from 'antd'
import { useNavigate } from 'react-router-dom'
import { ApiError, StudioDirectingService, type SceneCanvasSummary, type StoryboardTaskSummary } from '../../../services/generated'
import { readChapterBrowse, saveChapterBrowse, scenePreparationLocation } from './chapterNavigation'
import { directingError } from './common'
import { SceneCanvasDeletion } from './SceneCanvasDeletion'
import { WorkbenchCanvasCreation } from './WorkbenchCanvasCreation'
import { useWorkspaceDraftStatus } from './WorkspaceDrafts'
import './workbench-canvas-cards.css'

type Scope = { projectId: string; chapterId: string; sequenceId: string }

function activeTask(task?: StoryboardTaskSummary | null) {
  return task?.status === 'queued' || task?.status === 'running'
}

function taskLabel(task: StoryboardTaskSummary) {
  if (task.status === 'queued') return '分镜排队中'
  if (task.status === 'running') return task.stage === 'assembling_storyboard' ? '正在校验并组装画布' : '正在提取分镜'
  if (task.status === 'failed') return '分镜失败'
  if (task.status === 'cancelled') return '分镜已取消'
  return '分镜生成成功'
}

/** 按本场读取轻量画布卡；任务完成只更新卡片，打开画布仍由用户发起。 */
export function WorkbenchCanvasCards({ projectId, chapterId, sequenceId, historical, canCreate, actionHost, onChange }: Scope & {
  historical: boolean; canCreate: boolean; actionHost: HTMLDivElement | null; onChange: () => void
}) {
  const navigate = useNavigate()
  const [notices, noticeContext] = message.useMessage()
  const [canvases, setCanvases] = useState<SceneCanvasSummary[]>()
  const lastRead = useRef<SceneCanvasSummary[]>()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  const [query, setQuery] = useState('')
  const [detail, setDetail] = useState<string>()
  const [deleteTarget, setDeleteTarget] = useState<string>()
  const [deleteError, setDeleteError] = useState('')
  const drafts = useWorkspaceDraftStatus()
  const [created, setCreated] = useState<string>()
  const recentCanvas = readChapterBrowse(projectId, chapterId).managementCanvas
  const detailCard = canvases?.find(canvas => canvas.id === detail)
  const detailTask = detailCard?.latest_storyboard
  const hasActive = canvases?.some(canvas => activeTask(canvas.latest_storyboard))

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

  const openCanvas = (canvasId: string, taskId?: string) => {
    const params = new URLSearchParams({ canvas: canvasId })
    if (taskId) params.set('storyboardTask', taskId)
    saveChapterBrowse(projectId, chapterId, { managementCanvas: canvasId })
    navigate(scenePreparationLocation(projectId, chapterId, sequenceId) + '?' + params)
  }
  const keyword = query.trim().toLocaleLowerCase()
  const shown = canvases?.filter(canvas => canvas.name.toLocaleLowerCase().includes(keyword))
  return <section aria-labelledby="management-canvas-list-title" className="management-canvas-cards">
    {noticeContext}
    <WorkbenchCanvasCreation {...{ projectId, chapterId, sequenceId, actionHost }} editable={canCreate} onAccepted={id => {
      setCreated(id)
      setQuery('')
      setRevision(value => value + 1)
      onChange()
    }} />
    <div className="management-canvas-toolbar">
      <h3 id="management-canvas-list-title">本场画布</h3>
      {!!canvases?.length && <Input aria-label="搜索画布" placeholder="按名称搜索画布" allowClear value={query}
        onChange={event => setQuery(event.target.value)} />}
    </div>
    {error && <Alert showIcon type="error" message={error} action={<Button size="small"
      onClick={() => setRevision(value => value + 1)}>重试读取画布</Button>} />}
    {deleteError && <Alert showIcon type="warning" message={deleteError} />}
    {loading && !canvases && !error && <Spin aria-label="正在读取本场画布" />}
    {!error && canvases?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={historical ? '此历史场次没有画布' : '本场尚无画布，可生成新分镜画布开始设计'} />}
    {!error && !!canvases?.length && shown?.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的画布" />}
    {!!shown?.length && <ul className="management-canvas-list" aria-label="本场画布">
      {shown.map(canvas => {
        const task = canvas.latest_storyboard
        const candidateId = canvas.candidate_storyboard_task_id
        const adoptedId = canvas.applied_storyboard_task_id
        const currentTaskIsCandidate = candidateId && task?.task_id === candidateId
        return <li key={canvas.id}>
          <Card size="small" className={canvas.id === created ? 'management-canvas-created' : undefined}>
            <div className="management-canvas-card-heading">
              <h4>{canvas.name}</h4>
              <Dropdown trigger={['click']} menu={{ items: [
                ...(task ? [{ key: 'detail', label: '查看任务详情', onClick: () => setDetail(canvas.id) }] : []),
                { key: 'delete', label: '删除画布', danger: true, onClick: () => drafts.transition(() => {
                  setDeleteError('')
                  setDeleteTarget(canvas.id)
                }) },
              ] }}>
                <Button type="text" icon={<MoreOutlined />} aria-label={`${canvas.name}更多操作`} />
              </Dropdown>
            </div>
            <div className="management-canvas-status">
              {task && !currentTaskIsCandidate && task.task_id !== adoptedId && <Tag
                color={task.status === 'failed' ? 'error' : activeTask(task) ? 'processing' : undefined}>{taskLabel(task)}</Tag>}
              {candidateId && <Tag color={canvas.storyboard_review_required ? 'warning' : 'success'}>
                {canvas.storyboard_review_required ? '需要核对' : '分镜已就绪'}
              </Tag>}
              {adoptedId && <Tag color="success" title={`采用任务 ${adoptedId}`}>当前已采用</Tag>}
              {canvas.source_changed && <Tag color="warning">原文已变化</Tag>}
              {canvas.id === recentCanvas && <Tag>最近打开</Tag>}
              {canvas.id === created && <Tag color="processing">刚创建</Tag>}
            </div>
            {task?.status === 'failed' && task.error && <p className="management-canvas-error">{task.error}</p>}
            <div className="management-canvas-actions">
              <Button onClick={() => openCanvas(canvas.id)}>打开画布</Button>
              {candidateId && <Button type="link" onClick={() => openCanvas(canvas.id, candidateId)}>
                {canvas.storyboard_review_required ? '核对分镜' : '查看分镜'}
              </Button>}
            </div>
          </Card>
        </li>
      })}
    </ul>}
    <Modal title="分镜任务详情" open={!!detailTask} onCancel={() => setDetail(undefined)}
      footer={<Button aria-label="关闭分镜任务详情" onClick={() => setDetail(undefined)}>关闭</Button>}>
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
      onClose={() => setDeleteTarget(undefined)} onFailure={setDeleteError}
      onDeleted={() => {
        setCanvases(previous => previous?.filter(canvas => canvas.id !== deleteTarget))
        setRevision(value => value + 1)
        onChange()
      }} />}
  </section>
}
