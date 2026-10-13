import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Select, Spin } from 'antd'
import { ApiError, FilmService, StudioDirectingService } from '../../../services/generated'
import type { InstructionInputs_Output as InstructionInputs, InstructionCheckComparison, InstructionBasisRead, InstructionCheckRead, InstructionCheckRequest, SceneVersionContent_Output } from '../../../services/generated'
import { SceneVideoPanel } from './SceneVideoPanel'
import { BasisInputs } from './SceneInstructionBasis'
import { SceneInstructionCheckResult } from './SceneInstructionCheckResult'
import { directingError } from './common'

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

/** 检查任务和历史结果独立保存，查看不确认结果或授权视频生成。 */
export function SceneInstructionChecks({ suggestionPriority, primaryHost, onEmptyPrimaryHost, projectId, sequenceId, versionId, unitId, revision, content, disabled, onChange, dirty, videoBusy, savePending, onVerifyVideo, videoRefresh, onGenerateVideo, onRetryVideo, videoFocus, onVideoFocused }: {
  suggestionPriority?: boolean
  onEmptyPrimaryHost?: (node: HTMLSpanElement | null) => void
  primaryHost?: HTMLElement | null
  onVideoFocused: () => void
  videoFocus?: { executionId: string; serial: number }
  onVerifyVideo?: () => void
  dirty: boolean; videoBusy: boolean; savePending: boolean; videoRefresh: number; onGenerateVideo: () => void; onRetryVideo: (executionId: string) => void
  projectId: string; sequenceId: string; versionId: string; unitId: string; revision: number
  content: SceneVersionContent_Output; disabled: boolean; onChange: (value: SceneVersionContent_Output) => void
}) {
  const target = { projectId, sequenceId, versionId, unitId }
  const key = `jellyfish:instruction-check:${projectId}:${sequenceId}:${versionId}:${unitId}`
  const [rows, setRows] = useState<InstructionCheckRead[]>()
  const [selectedId, setSelectedId] = useState<string>()
  const [viewedId, setViewedId] = useState<string>()
  const [pending, setPending] = useState<InstructionCheckRequest>()
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [comparison, setComparison] = useState<{ key: string; basis: boolean; basisStatus: InstructionBasisRead['status']; inputs: InstructionInputs; value?: InstructionCheckComparison }>()
  const [compareError, setCompareError] = useState('')
  const panel = useRef<HTMLElement>(null)
  const mounted = useRef(true)
  const live = useRef({ content, disabled })
  live.current = { content, disabled }
  const selected = rows?.find(row => row.task_id === selectedId) || rows?.[0]
  const snapshotKey = JSON.stringify([content, selected?.task_id])
  const current = !compareError && !readError && comparison?.key === snapshotKey ? comparison : undefined
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const clearPending = (requestId: string) => {
    const stored = localStorage.getItem(key)
    if (stored && (JSON.parse(stored) as InstructionCheckRequest).request_id === requestId) localStorage.removeItem(key)
    if (mounted.current) setPending(value => value?.request_id === requestId ? undefined : value)
  }
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        const saved = localStorage.getItem(key)
        const request = saved ? JSON.parse(saved) as InstructionCheckRequest : undefined
        if (request && (!request.request_id || !Number.isInteger(request.expected_revision) || !request.content?.units?.some(unit => unit.id === unitId))) throw new Error('原检查请求恢复记录无法读取')
        const result = await StudioDirectingService.directingInstructionChecks(target)
        if (!result.data) throw new Error('检查记录尚未核实')
        if (!active) return
        setPending(request); setRows(result.data); setReadError('')
        const recovered = result.data.find(row => row.request_id === request?.request_id)
        if (recovered && request) { clearPending(request.request_id); setSelectedId(recovered.task_id) }
        if (result.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [key, attempt])
  useEffect(() => {
    let active = true
    setCompareError(''); setComparison(undefined)
    const timer = setTimeout(() => {
      void Promise.all([
        StudioDirectingService.directingInstructionBasis({ ...target, requestBody: { content } }),
        selected ? StudioDirectingService.directingInstructionCheckCompare({ ...target, taskId: selected.task_id, requestBody: { content } }) : Promise.resolve(undefined),
      ]).then(([basis, compared]) => {
        if (!basis.data || selected && !compared?.data) throw new Error('当前检查适用性尚未核实')
        if (active) setComparison({ key: snapshotKey, basis: basis.data.status === 'current', basisStatus: basis.data.status, inputs: basis.data.current, value: compared?.data || undefined })
      }).catch(cause => { if (active) setCompareError(directingError(cause)) })
    }, 200)
    return () => { active = false; clearTimeout(timer) }
  }, [snapshotKey, attempt])
  const submit = async () => {
    if (disabled || busy || readError || !pending && (savePending || !current?.basis || compareError)) return
    const request = pending || { request_id: crypto.randomUUID(), expected_revision: revision, content: structuredClone(content) }
    try { localStorage.setItem(key, JSON.stringify(request)); setPending(request) }
    catch { setError('无法保存检查恢复记录，尚未提交'); return }
    setBusy(true); setError('')
    try {
      const result = await StudioDirectingService.directingInstructionCheck({ ...target, requestBody: request })
      if (!result.data) throw new Error('检查提交尚未核实，保留原请求')
      clearPending(request.request_id)
      if (mounted.current) { setSelectedId(result.data.task_id); setAttempt(value => value + 1) }
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408) {
        try { clearPending(request.request_id) } catch { /* 原请求保留，不能擅自换请求。 */ }
      }
      if (mounted.current) setError(directingError(cause))
    } finally { if (mounted.current) setBusy(false) }
  }
  const confirm = async () => {
    if (!selected || busy || live.current.disabled) return
    const snapshot = live.current.content
    setBusy(true); setError('')
    try {
      const result = await StudioDirectingService.directingInstructionCheckConfirm({ ...target, taskId: selected.task_id, requestBody: { content: snapshot } })
      if (!result.data) throw new Error('检查结果确认尚未核实')
      if (!mounted.current) return
      if (live.current.disabled || live.current.content !== snapshot) throw new Error('核对期间内容已变化，请重新核对检查结果')
      onChange({ ...snapshot, units: snapshot.units.map(unit => unit.id === unitId ? { ...unit, instruction_check_task_id: result.data!.task_id } : unit) })
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const locate = (label: string) => {
    const node = panel.current?.closest('.director-canvas-object-content')
    const targetNode = node?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
    if (!node || !targetNode) return
    targetNode.setAttribute('tabindex', '-1')
    targetNode.focus({ preventScroll: true })
    const scale = node.getBoundingClientRect().width / (node as HTMLElement).offsetWidth
    node.scrollTop += (targetNode.getBoundingClientRect().top - node.getBoundingClientRect().top) / scale - 16
  }
  const running = rows?.find(row => !terminal.includes(row.status))
  let next: { label: string; action?: () => void; submits?: boolean }
  if (busy) next = { label: '正在核实当前操作' }
  else if (onVerifyVideo) next = { label: '核实当前单元原视频请求', submits: true, action: onVerifyVideo }
  else if (videoBusy) next = { label: '正在核实当前操作' }
  else if (readError || compareError) next = { label: '重新核实当前单元检查', action: () => setAttempt(value => value + 1) }
  else if (pending) next = { label: '核实当前单元检查提交', submits: true, action: () => void submit() }
  else if (running) next = { label: '查看当前单元检查任务', action: () => { setSelectedId(running.task_id); locate('当前单元指令检查') } }
  else if (suggestionPriority) next = { label: '查看当前指令操作' }
  else if (!rows || !current) next = { label: '正在核对当前指令状态' }
  else if (!current.basis) next = { label: current.basisStatus === 'empty' ? '填写当前单元指令' : current.basisStatus === 'changed' ? '更新当前单元指令依据' : '核对当前单元指令依据', action: () => locate(current.basisStatus === 'empty' ? '当前单元指令正文' : '指令依据核对') }
  else if (!selected || !current.value?.matches_current || ['failed', 'cancelled'].includes(selected.status)) next = savePending ? { label: '等待场次保存核实后检查' } : { label: '检查当前单元指令', submits: true, action: () => void submit() }
  else if (!current.value?.confirmed) next = { label: '查看当前单元检查结果', action: () => { setViewedId(selected.task_id); locate('当前单元指令检查') } }
  else next = { label: '查看当前单元视频生成', action: () => locate('当前单元视频任务') }
  const videoStage = !!current?.value?.confirmed && current.basis && !busy && !videoBusy && !pending && !running && !suggestionPriority
  return <section ref={panel} aria-label="当前单元指令检查">
    {primaryHost && !videoStage && createPortal(['填写当前单元指令', '查看当前指令操作'].includes(next.label) && onEmptyPrimaryHost ? <span ref={onEmptyPrimaryHost} /> : <Button type="primary" disabled={!!next.submits && disabled || !next.action} onClick={next.action}>{next.label}</Button>, primaryHost)}
    <h3>指令检查</h3>
    {!rows && !readError && <Spin size="small" />}
    {readError && <Alert type="error" message="检查记录读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试检查记录</Button>} />}
    {compareError && <Alert type="error" message="检查适用性读取失败" description={compareError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试检查适用性</Button>} />}
    {error && <Alert type="error" message={error} />}
    {rows && !rows.length && <p>尚未检查当前指令。</p>}
    <Button disabled={disabled || busy || !!readError || !rows || !pending && (savePending || !current?.basis || !!compareError || rows.some(row => !terminal.includes(row.status)))} onClick={() => void submit()}>{pending ? '核实原检查请求' : '检查当前指令'}</Button>
    {current && !current.basis && <p>先按当前依据明确确认正文，再发起检查。</p>}
    {!!rows?.length && <Select className="scene-instruction-select" aria-label="指令检查记录" value={selected?.task_id} style={{ width: '100%' }} onChange={setSelectedId}
      options={rows.map((row, index) => ({ value: row.task_id, label: `检查 ${rows.length - index} · ${statuses[row.status] || row.status}` }))} />}
    {selected && <><p>检查任务：{statuses[selected.status] || selected.status}</p>
      {selected.origin_version_id !== versionId && <Alert type="info" message="引用原版本的检查结果" description={`该检查实际执行于版本 ${selected.origin_version_id}，另存时保留为当前内容的依据。当前适用性仍需按本版本内容核对。`} />}
      {selected.error && <Alert type="error" message={selected.error} />}
      {!terminal.includes(selected.status) && <Button disabled={disabled || busy} onClick={async () => {
        setBusy(true)
        try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: selected.task_id, requestBody: { reason: '用户取消指令检查' } }); if (mounted.current) setAttempt(value => value + 1) }
        catch (cause) { if (mounted.current) setError(directingError(cause)) }
        finally { if (mounted.current) setBusy(false) }
      }}>取消本次检查</Button>}
      <details><summary>查看检查固定输入</summary><p>检查模型：{selected.model_name}</p><p>送审正文：{selected.instruction}</p><BasisInputs title="检查当时依据" value={selected.inputs} /></details>
      {selected.result && <Button onClick={() => setViewedId(selected.task_id)}>查看检查结果</Button>}
      {current?.value && <p>{current.value.matches_current ? '检查输入与当前内容一致' : '当前正文或依据已变化，旧检查仅供查看'}</p>}
      {current?.value?.confirmed && <p>当前指令检查结果已确认</p>}
      {selected.result && viewedId === selected.task_id && <div>
        {!current?.value?.confirmed && <p>{selected.result.rows.every(row => row.verdict === 'pass') ? '六岗检查均通过，尚待明确核对结果' : '检查存在待处理问题'}</p>}
        {selected.result.rows.every(row => row.verdict === 'pass') && !current?.value?.confirmed && <Button disabled={disabled || busy || !!readError || !!compareError || !current?.value?.matches_current || !current.basis} onClick={() => void confirm()}>确认已核对检查结果</Button>}
        <SceneInstructionCheckResult selected={selected} />
      </div>}
    </>}
    <SceneVideoPanel savePending={savePending} primaryHost={videoStage ? primaryHost : undefined} onFocused={onVideoFocused} focusRequest={videoFocus} currentInputs={current?.inputs} instruction={content.units.find(unit => unit.id === unitId)?.instruction || ''} projectId={projectId} sequenceId={sequenceId} versionId={versionId} unitId={unitId} dirty={dirty} disabled={disabled || videoBusy} ready={!!current?.value?.confirmed && !busy && !pending && !running} refresh={videoRefresh} onGenerate={onGenerateVideo} onRetry={onRetryVideo} />
  </section>
}
