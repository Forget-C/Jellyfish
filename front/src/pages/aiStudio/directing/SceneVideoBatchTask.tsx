import { useEffect, useState } from 'react'
import { Alert, Button } from 'antd'
import { FilmService, StudioDirectingService } from '../../../services/generated'
import type { SceneVideoRead } from '../../../services/generated'
import type { VideoActivityTarget } from './SceneVideoActivity'
import { directingError } from './common'

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 逐项读取原任务，取消意图和终态分别表达，不自动重试或采用结果。 */
export function SceneVideoBatchTask({ target, disabled }: { target: VideoActivityTarget; disabled: boolean }) {
  const [record, setRecord] = useState<SceneVideoRead>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const response = await StudioDirectingService.directingSceneVideos(target)
        const row = response.data?.find(item => item.task_id === target.taskId)
        if (!row) throw new Error('原任务记录尚未核实，请重试读取')
        if (!active) return
        setRecord(row); setError('')
        if (!terminal.includes(row.status)) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [target.taskId, attempt])
  return <section aria-label={`批量视频任务 ${target.taskId}`}>
    <p>任务 {target.taskId}</p>
    <p>任务状态：{record ? record.cancel_requested && !terminal.includes(record.status) ? '取消处理中' : statuses[record.status] || record.status : '正在核实'}</p>
    {error && <Alert type="error" message="此项任务状态未能核实" description={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重读此项任务</Button>} />}
    {record?.error && <Alert type="warning" message={record.error} />}
    {record && !terminal.includes(record.status) && <Button disabled={disabled || cancelling || record.cancel_requested || !!error} onClick={async () => {
      setCancelling(true)
      try {
        await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: target.taskId, requestBody: { reason: '用户取消批量中的此项视频任务' } })
        setAttempt(value => value + 1)
      } catch (cause) { setError(directingError(cause)) }
      finally { setCancelling(false) }
    }}>{record.cancel_requested ? '已请求取消，等待执行结束' : '取消此项任务'}</Button>}
    {!!record?.takes.length && <p>已登记 {record.takes.length} 份候选，尚未自动采用</p>}
  </section>
}
