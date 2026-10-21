import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Space } from 'antd'
import { StudioDirectingService } from '../../../services/generated'
import type { SceneInstructionSuggestionRead } from '../../../services/generated'
import { directingError } from './common'

export type InstructionActivityTarget = {
  projectId: string; sequenceId: string; versionId: string; unitId: string
  taskId: string; unitLabel: string; versionTitle: string
}

/** 在画布之外跟踪原任务；完成只通知，定位必须由用户明确发起。 */
export function SceneInstructionActivity({ target, hidden, onLocate, onDismiss, onEvidenceChanged }: {
  onEvidenceChanged?: () => void
  target: InstructionActivityTarget; hidden: boolean
  onLocate: () => Promise<void>; onDismiss: () => void
}) {
  const evidenceCallback = useRef(onEvidenceChanged)
  evidenceCallback.current = onEvidenceChanged
  const evidenceKey = useRef('')
  const [record, setRecord] = useState<SceneInstructionSuggestionRead>()
  const [readError, setReadError] = useState('')
  const [locateError, setLocateError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [locating, setLocating] = useState(false)
  useEffect(() => {
    // 用户已经在该单元的指令画布查看结果时，不积累重复完成通知。
    if (hidden && record && ['succeeded', 'failed', 'cancelled'].includes(record.status)) onDismiss()
  }, [hidden, record?.status])
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const result = await StudioDirectingService.directingSceneInstructionSuggestions(target)
        if (!active) return
        const row = result.data?.find(item => item.task_id === target.taskId)
        if (!row) throw new Error('原指令任务记录尚未核实')
        setRecord(row); setReadError('')
        const evidence = JSON.stringify(row)
        if (evidence !== evidenceKey.current) { evidenceKey.current = evidence; evidenceCallback.current?.() }
        if (!['succeeded', 'failed', 'cancelled'].includes(row.status)) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [target.taskId, attempt])
  if (hidden || !readError && !['succeeded', 'failed', 'cancelled'].includes(record?.status || '')) return null
  return <section aria-label={`${target.unitLabel} 指令任务通知`}>
    <Alert type={readError || locateError || record?.status === 'failed' ? 'warning' : 'info'}
      message={readError ? '指令任务状态读取失败' : record?.status === 'succeeded' ? '指令任务已完成' : record?.status === 'cancelled' ? '指令任务已取消' : '指令任务失败'}
      description={<><p>{target.versionTitle} · {target.unitLabel}</p><p>{readError || locateError || record?.error || '结果保留在原单元，尚未应用。'}</p></>}
      action={<Space direction="vertical">
        {readError ? <Button onClick={() => setAttempt(value => value + 1)}>重试通知状态</Button> : <Button loading={locating} onClick={async () => {
          setLocating(true); setLocateError('')
          try { await onLocate() } catch (cause) { setLocateError(directingError(cause)) }
          finally { setLocating(false) }
        }}>定位指令结果</Button>}
        <Button onClick={onDismiss}>关闭通知</Button>
      </Space>} />
  </section>
}
