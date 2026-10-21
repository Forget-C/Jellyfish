import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select, Spin } from 'antd'
import { ApiError, FilmService, StudioDirectingService } from '../../../services/generated'
import type { SceneInstructionRequest, SceneInstructionScope, SceneInstructionSuggestionRead, SceneVersionContent_Output } from '../../../services/generated'
import { directingError } from './common'
import { SourceLinks } from './Sources'
import { SceneInstructionSnapshot } from './SceneInstructionSnapshot'

// 只记录本页会话的查看状态，不进入业务内容或改变建议的应用状态。
const viewedSuggestions = new Map<string, Set<string>>()

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
// 提交快照与未保存编辑分开保存；刷新、切换画布后核实同一请求。
const pendingRequests = new Map<string, SceneInstructionRequest>()
const storageKey = (key: string) => `jellyfish:scene-instruction-request:${key}`

function restoreRequest(key: string, unitId: string) {
  const saved = localStorage.getItem(storageKey(key))
  if (!saved) { pendingRequests.delete(key); return }
  const request = JSON.parse(saved) as SceneInstructionRequest
  if (!request.request_id || !Number.isInteger(request.expected_revision) ||
    !request.content?.units?.some(unit => unit.id === unitId) || typeof request.requirements !== 'string') {
    throw new Error('原指令请求恢复数据无法读取，尚未开放新提交')
  }
  pendingRequests.set(key, request)
}

/** 迟到响应只能清除同一请求，不能删除新提交的恢复快照。 */
function clearRequest(key: string, requestId: string) {
  const saved = localStorage.getItem(storageKey(key))
  if (saved && (JSON.parse(saved) as SceneInstructionRequest).request_id === requestId) localStorage.removeItem(storageKey(key))
  if (pendingRequests.get(key)?.request_id === requestId) pendingRequests.delete(key)
}

/** 建议保留在任务中；只有显式应用才修改当前单元正文。 */
export function SceneInstructionSuggestions({ onEvidenceChanged, onPriority, primaryHost, onLocate, projectId, sequenceId, versionId, revision, unitId, content, disabled, onChange, compact, initialTaskId, recordFocus, onOpen, onTask, onPrepare }: {
  onEvidenceChanged?: () => void
  projectId: string; sequenceId: string; versionId: string; revision: number; unitId: string
  content: SceneVersionContent_Output; disabled: boolean; onChange: (content: SceneVersionContent_Output) => void
  onPriority?: (state: { versionId: string; unitId: string; priority: boolean }) => void
  onLocate?: () => void
  primaryHost?: HTMLElement | null
  onPrepare?: () => void
  recordFocus?: { taskId: string; serial: number }
  compact?: boolean; initialTaskId?: string; onOpen?: (taskId?: string) => void
  onTask?: (taskId: string, unitId: string) => void
}) {
  const panel = useRef<HTMLElement>(null)
  const key = `${projectId}:${sequenceId}:${versionId}:${unitId}`
  const evidenceCallback = useRef(onEvidenceChanged)
  evidenceCallback.current = onEvidenceChanged
  const evidenceKey = useRef('')
  const [viewed, setViewed] = useState(() => new Set(viewedSuggestions.get(key)))
  const markViewed = (taskId: string) => {
    const next = new Set(viewedSuggestions.get(key)); next.add(taskId)
    viewedSuggestions.set(key, next); setViewed(next)
  }
  const target = { projectId, sequenceId, versionId, unitId }
  const [rows, setRows] = useState<SceneInstructionSuggestionRead[]>()
  const [selectedId, setSelectedId] = useState<string | undefined>(initialTaskId)
  useEffect(() => { if (recordFocus) { setSelectedId(recordFocus.taskId); setAttempt(value => value + 1) } }, [recordFocus?.taskId, recordFocus?.serial])
  const [requirements, setRequirements] = useState('')
  const [limited, setLimited] = useState(false)
  const [selection, setSelection] = useState<{ scope: SceneInstructionScope; before: string }>()
  const [reading, setReading] = useState(true)
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const mounted = useRef(true)
  const errorElement = useRef<HTMLDivElement>(null)
  const live = useRef({ content, disabled })
  const editing = useRef({ value: JSON.stringify(content), serial: 0 })
  const value = JSON.stringify(content)
  if (editing.current.value !== value) editing.current = { value, serial: editing.current.serial + 1 }
  const generation = useRef<{ requestId: string; taskId?: string; serial: number }>()
  live.current = { content, disabled }
  useEffect(() => {
    const field = errorElement.current
    const container = field?.closest<HTMLElement>('.director-canvas-object-content')
    if (!error || !field || !container) return
    const bounds = container.getBoundingClientRect(), message = field.getBoundingClientRect()
    // 仅滚动本节点，保持画布位置；缩放后仍使拒绝原因可见。
    const scale = bounds.width / container.offsetWidth
    if (message.top < bounds.top || message.bottom > bounds.bottom) container.scrollTop += (message.top - bounds.top) / scale - 16
  }, [error])
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      setReading(true)
      try {
        restoreRequest(key, unitId)
        const pending = pendingRequests.get(key)
        if (pending) {
          setRequirements(pending.requirements || '')
          setLimited(!!pending.scope)
          setSelection(pending.scope ? { scope: pending.scope, before: pending.content.units?.find(unit => unit.id === unitId)?.instruction || '' } : undefined)
        }
        const result = await StudioDirectingService.directingSceneInstructionSuggestions(target)
        if (!result.data) throw new Error('指令建议记录尚未核实')
        if (!active) return
        setRows(result.data); setReadError('')
        const evidence = JSON.stringify(result.data)
        if (evidence !== evidenceKey.current) {
          evidenceKey.current = evidence
          evidenceCallback.current?.()
        }
        const found = result.data.find(row => row.request_id === pendingRequests.get(key)?.request_id)
        if (found) { clearRequest(key, found.request_id); setSelectedId(found.task_id); setError(''); onTask?.(found.task_id, unitId) }
        result.data.filter(row => !terminal.includes(row.status)).forEach(row => onTask?.(row.task_id, unitId))
        if (result.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 2000)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
      finally { if (active) setReading(false) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [key, attempt])
  const selected = rows?.find(row => row.task_id === selectedId)
  const running = rows?.some(row => !terminal.includes(row.status))
  useEffect(() => {
    const origin = generation.current
    if (!origin?.taskId || selected?.task_id !== origin.taskId || !terminal.includes(selected.status)) return
    generation.current = undefined
    if (compact && selected.status === 'succeeded' && origin.serial === editing.current.serial && !live.current.disabled) onOpen?.(selected.task_id)
  }, [selected, compact, onOpen])
  const newestSuggestion = rows?.find(row => row.status === 'succeeded')
  const unseenSuggestion = newestSuggestion && !viewed.has(newestSuggestion.task_id) ? newestSuggestion : undefined
  const priority = !!unseenSuggestion || busy || pendingRequests.has(key) || !!running || !rows || !!readError
  useEffect(() => { onPriority?.({ versionId, unitId, priority }) }, [onPriority, versionId, unitId, priority])
  const currentText = content.units.find(unit => unit.id === unitId)?.instruction || ''
  const scopeReady = !limited || selection && selection.before === currentText
  const submit = async () => {
    if (busy || live.current.disabled) return
    if (!pendingRequests.has(key) && onPrepare) { onPrepare(); return }
    if (!pendingRequests.has(key) && !scopeReady) { setError('请重新选择允许修订的正文范围'); return }
    const request = pendingRequests.get(key) || { request_id: crypto.randomUUID(), expected_revision: revision, content: structuredClone(live.current.content), requirements, scope: limited ? selection?.scope : null }
    if (!pendingRequests.has(key)) generation.current = { requestId: request.request_id, serial: editing.current.serial }
    try {
      localStorage.setItem(storageKey(key), JSON.stringify(request))
      pendingRequests.set(key, request)
    } catch { setError('无法保存原指令请求的恢复信息，尚未提交。请检查浏览器存储后重试'); return }
    setBusy(true); setError('')
    try {
      const result = await StudioDirectingService.directingSceneInstructionSuggest({ ...target, requestBody: request })
      if (!result.data) throw new Error('指令提交结果尚未核实')
      onTask?.(result.data.task_id, unitId)
      if (generation.current?.requestId === request.request_id) generation.current.taskId = result.data.task_id
      clearRequest(key, request.request_id)
      if (mounted.current) { setSelectedId(result.data.task_id); setAttempt(value => value + 1) }
    } catch (cause) {
      const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408
      if (rejected) {
        try { clearRequest(key, request.request_id) }
        catch { if (mounted.current) setError('请求已拒绝，但恢复记录未能清理；请重试核实原请求'); return }
      }
      if (mounted.current) setError(rejected ? directingError(cause) : `指令提交未核实，保留原请求：${directingError(cause)}`)
    } finally { if (mounted.current) setBusy(false) }
  }
  const apply = async () => {
    if (!selected || busy || live.current.disabled) return
    const snapshot = live.current.content
    setBusy(true); setError('')
    try {
      const result = await StudioDirectingService.directingSceneInstructionApply({ ...target, taskId: selected.task_id, requestBody: { content: snapshot } })
      if (!result.data) throw new Error('指令建议尚未核实')
      if (!mounted.current) return
      if (live.current.disabled || live.current.content !== snapshot) throw new Error('核对期间内容已变化，请重新核对后应用')
      const preview = result.data
      if (preview.unit_id !== unitId || !snapshot.units.some(unit => unit.id === unitId)) throw new Error('原单元已不可用，未应用建议')
      markViewed(selected.task_id)
      onChange({ ...snapshot, units: snapshot.units.map(unit => unit.id === unitId ? { ...unit, instruction: preview.text, instruction_source: preview.source, instruction_basis_id: preview.basis_id } : unit) })
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  if (compact) {
    const task = rows?.find(row => !terminal.includes(row.status)) || selected
      || (!currentText.trim() ? rows?.find(row => row.status === 'succeeded') : undefined)
    const pending = pendingRequests.has(key)
    const preparation = !!onPrepare && !pending && !running
    const showTask = !pending && !preparation
    return <section className="scene-unit-instruction-action" aria-label="当前单元指令操作">
      {reading && <Spin size="small" />}
      {readError && <Alert type="error" message="指令建议读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试指令记录</Button>} />}
      {error && <Alert type="error" message={error} />}
      {showTask && task && <span>指令任务：{statuses[task.status] || task.status}</span>}
      {showTask && task && <Button onClick={() => onOpen?.(task.task_id)}>{task.status === 'succeeded' ? '查看指令建议' : '查看指令任务'}</Button>}
      {showTask && !task && currentText && <Button type="primary" onClick={() => onOpen?.()}>查看当前指令</Button>}
      {preparation && !reading && !readError && <Button type="primary" onClick={onPrepare}>补齐当前单元准备</Button>}
      {(pending || !onPrepare && !running && !currentText && task?.status !== 'succeeded') && <Button type="primary"
        disabled={disabled || busy || !pendingRequests.has(key) && (reading || !!readError || !rows || running)} onClick={() => void submit()}>
        {pendingRequests.has(key) ? '核实原指令请求' : '生成当前单元指令建议'}
      </Button>}
    </section>
  }
  const primaryTask = rows?.find(row => !terminal.includes(row.status)) || unseenSuggestion || selected || rows?.find(row => row.status === 'succeeded')
  const locateTask = () => {
    if (primaryTask) {
      setSelectedId(primaryTask.task_id)
      if (primaryTask.status === 'succeeded') markViewed(primaryTask.task_id)
    }
    const node = panel.current?.closest<HTMLElement>('.director-canvas-object-content')
    if (!node || !panel.current) return
    onLocate?.()
    panel.current.focus({ preventScroll: true })
    const scale = node.getBoundingClientRect().width / node.offsetWidth
    node.scrollTop += (panel.current.getBoundingClientRect().top - node.getBoundingClientRect().top) / scale - 16
  }
  const primary = busy ? <Button disabled>正在核实当前指令操作</Button> : pendingRequests.has(key) ? <Button type="primary" disabled={disabled || busy} onClick={() => void submit()}>核实原指令请求</Button>
    : readError ? <Button onClick={() => setAttempt(value => value + 1)}>重试指令记录</Button>
    : !rows ? <Button disabled>正在核实指令建议</Button>
    : onPrepare && !running ? <Button type="primary" onClick={onPrepare}>补齐当前单元准备</Button>
    : primaryTask ? <Button type="primary" onClick={locateTask}>{primaryTask.status === 'succeeded' ? '查看指令建议' : '查看指令任务'}</Button>
    : <Button type="primary" disabled={disabled || busy || !scopeReady} onClick={() => void submit()}>生成当前单元指令建议</Button>
  return <section id="scene-instruction-suggestions" ref={panel} tabIndex={-1} className="scene-design-suggestions" aria-label="当前单元指令建议">
    {primaryHost && createPortal(primary, primaryHost)}
    <h3>指令建议</h3>
    <p>先明确允许修改的范围，再查看建议并明确应用。</p>
    {reading && <Spin size="small" />}
    {readError && <Alert type="error" message="指令建议读取失败" description={readError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试指令记录</Button>} />}
    {error && <div ref={errorElement}><Alert type="error" message={error} /></div>}
    {pendingRequests.has(key) && <p>有尚未核实的指令提交。核实使用原请求和当时的输入，不改写当前正文。</p>}
    <Select className="scene-instruction-select" aria-label="指令修订范围" value={limited ? 'selection' : 'whole'} style={{ width: '100%' }}
      disabled={disabled || busy || pendingRequests.has(key)} options={[{ value: 'whole', label: '当前单元整份指令' }, { value: 'selection', label: '限定选中文字' }]}
      onChange={value => { setLimited(value === 'selection'); setSelection(undefined) }} />
    {limited && <>
      <p>在下方选中允许修改的文字；范围外正文保持原样。</p>
      <Input.TextArea aria-label="选择允许修订的正文" readOnly rows={5} value={currentText} disabled={disabled || busy || pendingRequests.has(key)}
        onSelect={event => {
          const field = event.currentTarget
          const start = Array.from(field.value.slice(0, field.selectionStart)).length
          const end = Array.from(field.value.slice(0, field.selectionEnd)).length
          setSelection(start < end ? { scope: { start, end }, before: field.value } : undefined)
        }} />
      {selection && <p>允许修改：{Array.from(selection.before).slice(selection.scope.start, selection.scope.end).join('')}</p>}
      {selection && selection.before !== currentText && <p>正文已变化，请重新选择修订范围。</p>}
    </>}
    <Input.TextArea aria-label="本次指令编写要求" value={requirements} disabled={disabled || busy || !!pendingRequests.get(key)} onChange={event => setRequirements(event.target.value)} placeholder="本次编写要求（可选）" />
    {onPrepare && !pendingRequests.has(key) && <p>当前单元准备尚未齐备，请先补齐模型、动作、参考及依赖。</p>}
    <Button type="primary" disabled={disabled || busy || !pendingRequests.get(key) && (reading || !!readError || !rows || running || !scopeReady || !!onPrepare)} onClick={() => void submit()}>
      {pendingRequests.get(key) ? '核实原指令请求' : '生成当前单元指令建议'}
    </Button>
    {!!rows?.length && <Select className="scene-instruction-select" aria-label="指令建议记录" style={{ width: '100%' }} placeholder="明确选择建议查看" value={selectedId}
      options={rows.map((row, index) => ({ value: row.task_id, label: `建议 ${rows.length - index} · ${statuses[row.status] || row.status}` }))}
      onChange={id => { setSelectedId(id); setError(''); if (rows?.find(row => row.task_id === id)?.status === 'succeeded') markViewed(id) }} />}
    {selected && <>
      <p>指令任务：{statuses[selected.status] || selected.status}</p>
      <p>建议范围：{selected.scope ? `限定文字「${Array.from(selected.unit.instruction).slice(selected.scope.start, selected.scope.end).join('')}」` : '当前单元整份指令'}</p>
      {selected.error && <Alert type="error" message={selected.error} />}
      <SceneInstructionSnapshot selected={selected} />
      {!terminal.includes(selected.status) && <Button disabled={disabled || busy} onClick={async () => {
        setBusy(true)
        try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: selected.task_id, requestBody: { reason: '用户取消指令建议' } }); if (mounted.current) setAttempt(value => value + 1) }
        catch (cause) { if (mounted.current) setError(directingError(cause)) }
        finally { if (mounted.current) setBusy(false) }
      }}>取消本次指令任务</Button>}
      {selected.text != null && <><p>生成前正文</p><pre>{selected.unit.instruction || '尚无正文'}</pre>{selected.unit.instruction_source && <SourceLinks sources={[selected.unit.instruction_source]} />}<p>建议正文</p><pre>{selected.text}</pre>
        <Button type="primary" disabled={disabled || busy || !!readError} onClick={() => void apply()}>应用指令建议</Button>
        <p>{selected.scope ? '应用前核实范围外文字未变，范围内整次应用。' : '应用替换当前单元整份正文。'}可一次撤销；不会自动检查或生成视频。</p></>}
    </>}
  </section>
}
