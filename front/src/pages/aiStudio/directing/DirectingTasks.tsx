import { useEffect, useState } from 'react'
import { Alert, Button, Card, Space, Tag } from 'antd'
import { FilmService, StudioDirectingService } from '../../../services/generated'
import type { DirectingTaskRead } from '../../../services/generated'
import { directingError } from './common'

const titles: Record<string, string> = { directing_divide: '场次分析', directing_design: '导演设计', directing_review: '六部门审稿', video_generation: '单元试拍' }
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 业务内任务结果面板；刷新可以恢复，成功结果由用户显式采用。 */
export function DirectingTasks({ projectId, taskIds, onResult, onSettled }: {
  projectId: string; taskIds: string[]; onResult?: (task: DirectingTaskRead) => void; onSettled?: () => void
}) {
  const [tasks, setTasks] = useState<DirectingTaskRead[]>([])
  const [error, setError] = useState('')
  const key = taskIds.join(',')
  useEffect(() => {
    let active = true
    let previous = ''
    /** 按固定任务身份轮询状态，避免保存业务正文到任务中心。 */
    const load = async () => {
      try {
        const rows = await Promise.all(taskIds.map(taskId => StudioDirectingService.directingTask({ projectId, taskId })))
        if (!active) return
        const next = rows.flatMap(row => row.data ? [row.data] : [])
        setTasks(next)
        const signature = next.map(row => row.status).join(',')
        if (previous && signature !== previous) onSettled?.()
        previous = signature
      } catch (cause) { if (active) setError(directingError(cause)) }
    }
    void load()
    const timer = window.setInterval(() => { void load() }, 2500)
    return () => { active = false; window.clearInterval(timer) }
  }, [projectId, key])
  if (!taskIds.length) return null
  return <Space direction="vertical" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} />}
    {tasks.slice().reverse().map(task => <Card key={task.task_id} size="small">
      <Space wrap>
        <strong>{titles[task.kind] || '任务'}</strong><Tag>{statuses[task.status] || task.status}</Tag>
        {['queued', 'running'].includes(task.status) && <Button size="small" onClick={async () => {
          try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: task.task_id, requestBody: { reason: '用户取消' } }) }
          catch (cause) { setError(directingError(cause)) }
        }}>取消</Button>}
        {task.status === 'succeeded' && (task.division || task.design || task.review) && <Button size="small" onClick={() => onResult?.(task)}>查看结果</Button>}
      </Space>
      {task.error && <Alert type="error" message={task.error} style={{ marginTop: 8 }} />}
    </Card>)}
  </Space>
}
