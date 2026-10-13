import { useEffect, useState } from 'react'
import { Alert, Button, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneVideoRead } from '../../../services/generated'
import { directingError } from './common'

export type VideoActivityTarget = {
  projectId: string; sequenceId: string; versionId: string; unitId: string
  taskId: string; unitLabel: string; versionTitle: string
}

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 跨画布读取原视频任务；通知和返回都不改写当前编辑或采用候选。 */
export function SceneVideoActivity({ target, hidden, onLocate, onDismiss }: {
  target: VideoActivityTarget; hidden: boolean; onLocate: () => Promise<void>; onDismiss: () => void
}) {
  const [record, setRecord] = useState<SceneVideoRead>()
  const [error, setError] = useState('')
  const [locateError, setLocateError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [locating, setLocating] = useState(false)
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = await StudioDirectingService.directingSceneVideos(target)
        if (!active) return
        const row = result.data?.find(item => item.task_id === target.taskId)
        if (!row) throw new Error('原视频任务记录尚未核实')
        setRecord(row); setError('')
        if (!terminal.includes(row.status)) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [target.taskId, attempt])
  useEffect(() => {
    if (hidden && record && terminal.includes(record.status)) onDismiss()
  }, [hidden, record?.status])
  if (hidden) return null
  return <section aria-label={`${target.unitLabel} 视频任务 ${target.taskId} 通知`}>
    <Alert type={error || locateError || record?.status === 'failed' ? 'warning' : 'info'}
      message={error ? '视频任务状态读取失败' : `视频任务${record ? record.cancel_requested && !terminal.includes(record.status) ? '取消处理中' : statuses[record.status] || record.status : '正在核实'}`}
      description={<><p>{target.versionTitle} · {target.unitLabel} · 任务 {target.taskId}</p><p>{error || locateError || record?.error || '任务和候选保留在原单元，尚未采用。'}</p></>}
      action={<Space direction="vertical">
        {error && <Button onClick={() => setAttempt(value => value + 1)}>重试视频通知</Button>}
        <Button loading={locating} onClick={async () => {
          setLocating(true); setLocateError('')
          try { await onLocate() } catch (cause) { setLocateError(directingError(cause)) }
          finally { setLocating(false) }
        }}>返回视频任务</Button>
        <Button onClick={onDismiss}>关闭通知</Button>
      </Space>} />
  </section>
}
