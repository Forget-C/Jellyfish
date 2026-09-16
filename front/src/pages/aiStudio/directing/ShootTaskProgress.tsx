import { useState } from 'react'
import { Alert, Button, Tag } from 'antd'
import { FilmService } from '../../../services/generated'
import type { DirectingTaskRead } from '../../../services/generated'
import { directingError } from './common'

/** 原工作区显示精确任务反馈；取消只发出请求，终态由业务轮询确认。 */
export function ShootTaskProgress({ tasks, state, kind }: {
  tasks: DirectingTaskRead[]; state: 'loading' | 'ready' | 'error'; kind: 'review' | 'video';
}) {
  const [requested, setRequested] = useState<string[]>([])
  const [error, setError] = useState('')
  const rows = tasks.filter(task => task.kind === (kind === 'review' ? 'directing_review' : 'video_generation'))
  if (!rows.length && state === 'ready') return null
  const name = kind === 'review' ? '检查' : '视频生成'
  const running = rows.filter(row => ['queued', 'running'].includes(row.status))
  const failed = rows.filter(row => ['failed', 'cancelled'].includes(row.status))
  if (!running.length && !failed.length && state === 'ready') return null
  const render = (task: DirectingTaskRead) => <div className="shoot-task-row" key={task.task_id} data-inline-task-id={task.task_id}>
    <strong>{name} {rows.indexOf(task) + 1}</strong><Tag>{({ queued: '排队中', running: '进行中', failed: '失败', cancelled: '已取消' } as Record<string, string>)[task.status]}</Tag>
    {task.error && <p>{task.error}</p>}
    {requested.includes(task.task_id) && ['queued', 'running'].includes(task.status) ? <span>已请求取消，等待确认</span> : ['queued', 'running'].includes(task.status) && <Button size="small" disabled={state !== 'ready'} onClick={async () => {
      setError(''); setRequested(value => [...value, task.task_id])
      try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: task.task_id, requestBody: { reason: '用户取消' } }) }
      catch (cause) { setError(directingError(cause)); setRequested(value => value.filter(id => id !== task.task_id)) }
    }}>取消{name}</Button>}
  </div>
  return <section className="shoot-task-progress" aria-label={`${name}进度`}>
    {state !== 'ready' && <Alert type="warning" message={state === 'loading' ? '正在核对任务状态' : '状态读取失败，正在重试；核实前请勿重复提交。'} />}
    {running.map(render)}
    {!!failed.length && <details open={!running.length && !rows.some(row => row.status === 'succeeded')}><summary>失败与取消记录 · {failed.length}</summary>{failed.map(render)}<p className="design-secondary">已有内容仍保留。核对原因后，可通过上方主操作重新提交。</p></details>}
    {error && <Alert type="error" message={error} />}
  </section>
}
