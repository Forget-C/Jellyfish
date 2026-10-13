import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Spin } from 'antd'
import { FilmService, StudioDirectingService } from '../../../services/generated'
import type { InstructionInputs_Output as InstructionInputs, SceneVideoRead } from '../../../services/generated'
import { SceneTakePreview } from './SceneTakePreview'
import { BasisInputs } from './SceneInstructionBasis'
import { directingError } from './common'

import { videoInputsMatch } from './sceneVideoInputs'

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 视频沿原版本和单元读取；查看任务与候选不采用素材。 */
export function SceneVideoPanel({ primaryHost, projectId, sequenceId, versionId, unitId, dirty, disabled, savePending, ready, refresh, onGenerate, onRetry, currentInputs, instruction, focusRequest, onFocused }: {
  primaryHost?: HTMLElement | null
  onFocused: () => void
  focusRequest?: { executionId: string; serial: number }
  currentInputs?: InstructionInputs; instruction: string
  projectId: string; sequenceId: string; versionId: string; unitId: string
  dirty: boolean; disabled: boolean; savePending: boolean; ready: boolean; refresh: number; onGenerate: () => void; onRetry: (executionId: string) => void
}) {
  const [rows, setRows] = useState<SceneVideoRead[]>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [cancelling, setCancelling] = useState(false)
  const panel = useRef<HTMLElement>(null)
  const focused = useRef<number>()
  useEffect(() => {
    if (!focusRequest || focused.current === focusRequest.serial || !rows || error) return
    const record = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-video-execution]') || [])
      .find(node => node.dataset.videoExecution === focusRequest.executionId)
    if (!record) return
    const details = record.querySelector('details')
    if (details) details.open = true
    record.focus(); record.scrollIntoView({ block: 'nearest' })
    focused.current = focusRequest.serial
    onFocused()
  }, [focusRequest, rows, error, onFocused])
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const response = await StudioDirectingService.directingSceneVideos({ projectId, sequenceId, versionId, unitId })
        if (!response.data) throw new Error('视频任务尚未核实')
        if (!active) return
        setRows(response.data); setError('')
        if (response.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, sequenceId, versionId, unitId, refresh, attempt])
  const running = rows?.find(row => !terminal.includes(row.status))
  const generateDisabled = disabled || savePending || !ready || !rows || !!error || cancelling || !!running
  const locateTask = () => {
    const target = Array.from(panel.current?.querySelectorAll<HTMLElement>('[data-video-execution]') || [])
      .find(node => node.dataset.videoExecution === running?.execution_id)
    const container = panel.current?.closest<HTMLElement>('.director-canvas-object-content')
    if (!target || !container) return
    target.focus({ preventScroll: true })
    const scale = container.getBoundingClientRect().width / container.offsetWidth
    container.scrollTop += (target.getBoundingClientRect().top - container.getBoundingClientRect().top) / scale - 16
  }
  return <section ref={panel} aria-label="当前单元视频任务"><h3>视频</h3>
    {primaryHost && createPortal(error
      ? <Button type="primary" onClick={() => setAttempt(value => value + 1)}>重新核实当前单元视频</Button>
      : !rows ? <Button disabled>正在读取当前单元视频</Button>
        : running ? <Button type="primary" onClick={locateTask}>查看当前单元视频任务</Button>
          : <Button type="primary" disabled={generateDisabled} onClick={onGenerate}>{savePending ? '等待场次保存核实后生成视频' : dirty ? '保存并生成当前单元视频' : '生成当前单元视频'}</Button>, primaryHost)}
    {!rows && !error && <Spin size="small" />}
    {error && <Alert type="error" message="视频任务读取失败" description={error} action={<Button onClick={() => setAttempt(value => value + 1)}>重试视频记录</Button>} />}
    <Button type="primary" disabled={generateDisabled} onClick={onGenerate}>{dirty ? '保存并生成视频' : '按当前内容生成视频'}</Button>
    {rows?.map(row => <section key={row.task_id} tabIndex={-1} data-video-execution={row.execution_id} aria-label={`视频执行 ${row.execution_id}`}>
      <p>视频任务：{row.cancel_requested && !terminal.includes(row.status) ? '取消处理中' : statuses[row.status] || row.status}</p>
      {row.retry_of_task_id && <p>按原依据重试，来源任务：{row.retry_of_task_id}</p>}
      {['failed', 'cancelled'].includes(row.status) && <Button disabled={disabled || !!error || cancelling || rows.some(item => !terminal.includes(item.status))}
        onClick={() => onRetry(row.execution_id)}>按原依据重试视频</Button>}
      {row.error && <Alert type="error" message={row.error} />}
      {!terminal.includes(row.status) && <Button disabled={disabled || cancelling || row.cancel_requested} onClick={async () => {
        setCancelling(true)
        try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: row.task_id, requestBody: { reason: '用户取消视频生成' } }); setAttempt(value => value + 1) }
        catch (cause) { setError(directingError(cause)) }
        finally { setCancelling(false) }
      }}>{row.cancel_requested ? '已请求取消，等待执行结束' : '取消本次视频任务'}</Button>}
      <details><summary>查看视频固定输入</summary><p>执行正文：{row.preparation.request.execution_prompt}</p><BasisInputs title="视频当时依据" value={row.preparation.inputs} /></details>
      {!!row.takes.length && <p>{!currentInputs ? '候选适用性待核实，尚不能判断是否符合当前要求' :
        !videoInputsMatch(row.preparation, currentInputs, instruction) ?
          '旧依据候选：当前正文或相关依据已变化，请重新核对' : '视频固定输入与当前内容一致，候选仍需审片'}</p>}
      {row.takes.map((take, index) => <div key={take.id}><p>候选素材 {index + 1} · {take.annotation.review_status === 'unreviewed' ? '未审片' : '已审片'} · 不自动采用</p>
        <SceneTakePreview projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={unitId} takeId={take.id} number={index + 1} />
      </div>)}
    </section>)}
  </section>
}
