import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Space, Tag } from 'antd'
import { FilmService, StudioDirectingService } from '../../../services/generated'
import type { DirectingTaskRead, WorkspaceRead } from '../../../services/generated'
import { designResultRecorded } from './workspaceProduction'
import { candidateName } from './workspaceUsage'
import { directingError } from './common'

const titles: Record<string, string> = { directing_divide: '场次分析', directing_design: '导演设计', directing_review: '六部门审稿', directing_review_revision: '检查修改方案', image_generation: '验证图', video_generation: '单元试拍' }
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 业务内任务结果面板；刷新可以恢复，成功结果由用户显式采用。 */
export function DirectingTasks({ retryKey = 0, projectId, taskIds, onResult, onSettled, onTasks, selectedTaskId, onState, workspace, onTake }: {
  retryKey?: number; onTake?: (id: string) => void; projectId: string; taskIds: string[]; workspace?: WorkspaceRead; onResult?: (task: DirectingTaskRead) => void; onSettled?: () => void; onTasks?: (tasks: DirectingTaskRead[]) => void; selectedTaskId?: string | null; onState?: (state: 'loading' | 'ready' | 'error') => void
}) {
  const [tasks, setTasks] = useState<DirectingTaskRead[]>([])
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const key = taskIds.join(',')
  const settledCallback = useRef(onSettled)
  settledCallback.current = onSettled
  const tasksCallback = useRef(onTasks)
  tasksCallback.current = onTasks
  const stateCallback = useRef(onState)
  stateCallback.current = onState
  useEffect(() => {
    let active = true
    let previous = ''
    let timer: ReturnType<typeof window.setTimeout> | undefined
    stateCallback.current?.(key ? 'loading' : 'ready')
    /** 按固定任务身份轮询状态，避免保存业务正文到任务中心。 */
    const load = async () => {
      try {
        const rows = await Promise.all((key ? key.split(',') : []).map(taskId => StudioDirectingService.directingTask({ projectId, taskId })))
        if (!active) return
        if (rows.some(row => !row.data)) throw new Error('部分任务状态暂不可用，请稍后重试。')
        const next = rows.flatMap(row => row.data ? [row.data] : [])
        setTasks(next); setError('')
        tasksCallback.current?.(next)
        stateCallback.current?.('ready')
        const signature = next.map(row => row.status).join(',')
        const running = next.some(row => ['queued', 'running'].includes(row.status))
        if ((previous && signature !== previous) || (!previous && next.length && !running)) settledCallback.current?.()
        previous = signature
        if (running) timer = window.setTimeout(() => { void load() }, 2500)
      } catch (cause) { if (active) { setError(directingError(cause)); stateCallback.current?.('error'); timer = window.setTimeout(() => { void load() }, 5000) } }
    }
    void load()
    return () => { active = false; window.clearTimeout(timer) }
  }, [projectId, key, retryKey, attempt])
  if (!taskIds.length) return null
  const needsAttention = (task: DirectingTaskRead) => {
    if (['queued', 'running', 'failed'].includes(task.status) || task.task_id === selectedTaskId) return true
    if (task.status !== 'succeeded' || !workspace) return !workspace && task.status === 'succeeded'
    if (task.design) return !designResultRecorded(task.design, workspace.designs)
    if (task.review) return !workspace.reviews.some(row => row.source_task_id === task.task_id)
    return workspace.takes.some(take => take.task_id === task.task_id && take.annotation.review_status === 'unreviewed')
  }
  const renderTask = (task: DirectingTaskRead) => <Card key={task.task_id} size="small" data-task-id={task.task_id}>
      <Space wrap>
        {selectedTaskId === task.task_id && <Tag>当前定位任务</Tag>}
        <strong>{titles[task.kind] || '任务'}</strong><Tag>{statuses[task.status] || task.status}</Tag>
        {['queued', 'running'].includes(task.status) && <Button size="small" onClick={async () => {
          try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: task.task_id, requestBody: { reason: '用户取消' } }) }
          catch (cause) { setError(directingError(cause)) }
        }}>取消</Button>}
        {workspace?.takes.filter(take => take.task_id === task.task_id).map(take => <Button key={take.id} size="small" onClick={() => onTake?.(take.id)}>查看{candidateName(workspace, take.id, true)}{take.annotation.review_status === 'unreviewed' ? ' · 待审片' : ''}</Button>)}
        {task.status === 'succeeded' && (task.division || task.design || task.review || !!task.image_file_ids?.length) && <Button size="small" onClick={() => onResult?.(task)}>查看结果</Button>}
      </Space>
      {task.error && <Alert type="error" message={task.error} style={{ marginTop: 8 }} />}
    </Card>
  return <Space direction="vertical" style={{ width: '100%' }} data-workspace-target="tasks" tabIndex={-1}>
    {error && <Alert type="error" message={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试读取状态</Button>} />}
    <strong>进行中与需要处理的任务</strong>
    {tasks.slice().reverse().filter(needsAttention).map(renderTask)}
    <details><summary>完整任务记录 · {tasks.length} 项（含已完成与已取消）</summary>
      <Space direction="vertical" style={{ width: '100%' }}>{tasks.slice().reverse().filter(task => !needsAttention(task)).map(renderTask)}</Space>
      <p>进行中、失败及待处理记录已列在上方；查看结果不会确认或采用。</p>
    </details>
  </Space>
}
