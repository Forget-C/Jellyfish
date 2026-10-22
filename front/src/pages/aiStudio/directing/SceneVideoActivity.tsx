import { useEffect, useRef, useState } from 'react'
import { Alert, Space } from 'antd'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneVideoRead } from '../../../services/generated'
import { directingError } from './common'

export type VideoActivityTarget = {
  projectId: string; sequenceId: string; versionId: string; unitId: string
  taskId: string; unitLabel: string; versionTitle: string
}

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 跨画布读取原任务并刷新证据；查看候选由用户明确触发，不改写当前编辑或采用。 */
export function SceneVideoActivity({ target, hidden, onLocate, onDismiss, onEvidenceChanged, onLocateCandidate }: {
  target: VideoActivityTarget; hidden: boolean; onLocate: () => Promise<void>; onDismiss: () => void
  onEvidenceChanged?: () => void
  onLocateCandidate?: (takeId: string) => Promise<void>
}) {
  const [record, setRecord] = useState<SceneVideoRead>()
  const [error, setError] = useState('')
  const [locateError, setLocateError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [locating, setLocating] = useState(false)
  const evidence = useRef('')
  const evidenceCallback = useRef(onEvidenceChanged)
  evidenceCallback.current = onEvidenceChanged
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = await StudioDirectingService.directingSceneVideos(target)
        if (!active) return
        const row = result.data?.find(item => item.task_id === target.taskId)
        if (!row) throw new Error('原视频任务记录尚未核实')
        setRecord(row); setError('')
        const fingerprint = JSON.stringify([row.status, row.takes.map(take => [take.id, take.file_id])])
        if (fingerprint !== evidence.current) {
          evidence.current = fingerprint
          evidenceCallback.current?.()
        }
        if (!terminal.includes(row.status) || row.status === 'succeeded' && !row.takes.length) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [target.taskId, attempt])
  useEffect(() => {
    if (hidden && record && (record.status === 'succeeded' ? record.takes.length > 0 : terminal.includes(record.status))) onDismiss()
  }, [hidden, record, onDismiss])
  const locate = async (action: () => Promise<void>) => {
    setLocating(true); setLocateError('')
    try { await action() } catch (cause) { setLocateError(directingError(cause)) }
    finally { setLocating(false) }
  }
  if (hidden) return null
  return <section aria-label={`${target.unitLabel} 视频任务 ${target.taskId} 通知`}>
    <Alert type={error || locateError || record?.status === 'failed' ? 'warning' : 'info'}
      message={error ? '视频任务状态读取失败' : record?.status === 'succeeded' && !record.takes.length ? '视频结果保存待核实' : `视频任务${record ? record.cancel_requested && !terminal.includes(record.status) ? '取消处理中' : statuses[record.status] || record.status : '正在核实'}`}
      description={<><p>{target.versionTitle} · {target.unitLabel} · 任务 {target.taskId}</p><p>{error || locateError || record?.error || '任务和候选保留在原单元，尚未采用。'}</p></>}
      action={<Space direction="vertical">
        {error && <WorkbenchButton onClick={() => setAttempt(value => value + 1)}>重试视频通知</WorkbenchButton>}
        {record?.takes[0] && onLocateCandidate && <WorkbenchButton loading={locating} onClick={() => void locate(() => onLocateCandidate(record.takes[0].id))}>查看候选视频</WorkbenchButton>}
        <WorkbenchButton loading={locating} onClick={() => void locate(onLocate)}>返回视频任务</WorkbenchButton>
        <WorkbenchButton onClick={onDismiss}>关闭通知</WorkbenchButton>
      </Space>} />
  </section>
}
