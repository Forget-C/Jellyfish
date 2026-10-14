import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Button, Input, Modal, Radio, Select, Space, Spin } from 'antd'
import { ApiError, FilmService, StudioDirectingService } from '../../../services/generated'
import type { SceneDesignRequest, SceneDesignSuggestionRead, SceneVersionContent_Output, SceneVersionRead } from '../../../services/generated'
import { directingError } from './common'
import { revisionDifferences } from './revisionDiff'
import { designLabels } from './designLabels'
import { sceneUnitReferenceConflicts } from './sceneUnitReferences'
import type { UnitReferenceConflict } from './sceneUnitReferences'

const terminal = ['succeeded', 'failed', 'cancelled']
const labels: Record<string, string> = { ...designLabels, text: '正文', state: '信息状态', sources: '来源', version: '依据版本', reason: '说明', file_id: '文件', media_range: '媒体区间' }
const sourceLabels: Record<string, string> = { human: '人工来源', model: '模型来源', chapter: '章节原文来源', file: '文件来源', revision: '固定版本来源' }
const fieldLabel = (path: string, design?: SceneDesignSuggestionRead['before']) => path.split('.').map(part => {
  if (part.startsWith('sources[')) return sourceLabels[part.slice(8).split(':')[0]] || '来源'
  const shot = /^shots\[(.+)\]$/.exec(part)
  if (shot) {
    const index = design?.direction.shots.findIndex(row => row.id === shot[1]) ?? -1
    const row = design?.direction.shots[index]
    return row ? `镜头 ${index + 1}${row.visible_result.text ? ` · ${row.visible_result.text}` : ''}` : `原镜头（${shot[1]}）`
  }
  const collection = /^([^[]+)\[(.+)\]$/.exec(part)
  return collection ? `${labels[collection[1]] || collection[1]}（${collection[2]}）` : labels[part] || part
}).join(' / ')
const statusNames: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }

type ScopeField = { value: string; label: string; identity: string }
/** 选择完整内容字段；列表对象身份随选择保留，重排后不能按旧下标选中另一对象。 */
function scopeFields(value: unknown, path = '', title = '', identity = ''): ScopeField[] {
  if (Array.isArray(value)) return value.flatMap((child, index) => {
    const row = child as Record<string, any>
    const name = row?.name || row?.visible_result?.text || row?.objective?.text
    const key = row?.id || [row?.shot_id, row?.participant_id, row?.beat_id].filter(Boolean).join(':') || JSON.stringify(child)
    return scopeFields(child, `${path}/${index}`, `${title} ${index + 1}${name ? ` · ${name}` : ''}`, `${identity}/${key}`)
  })
  if (!value || typeof value !== 'object') return []
  const row = value as Record<string, unknown>
  if ('state' in row) return [{ value: path, label: title, identity }]
  return Object.entries(row).flatMap(([key, child]) => scopeFields(child, `${path}/${key}`, `${title ? title + ' / ' : ''}${labels[key] || key}`, identity))
}

/** 建议与编辑内容分开；每次应用先核实固定依据，整份结果只进入一次编辑历史。 */
export function SceneDesignSuggestions({ triggerHost, projectId, sequenceId, version, content, disabled, open, onOpenChange, onChange, onLocateUnit }: {
  triggerHost?: HTMLElement | null
  projectId: string; sequenceId: string; version: SceneVersionRead; content: SceneVersionContent_Output
  disabled: boolean; open: boolean; onOpenChange: (open: boolean) => void
  onChange: (content: SceneVersionContent_Output) => void
  onLocateUnit: (conflict: UnitReferenceConflict) => void
}) {
  const [rows, setRows] = useState<SceneDesignSuggestionRead[]>()
  const [reading, setReading] = useState(true)
  const [readError, setReadError] = useState('')
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [instruction, setInstruction] = useState('')
  const [limited, setLimited] = useState(false)
  const [scope, setScope] = useState<ScopeField[]>([])
  const fields = scopeFields(content.design)
  const validScope = scope.length > 0 && scope.length <= 100 && scope.every(field => fields.some(option => option.value === field.value && option.identity === field.identity))
  const [selectedId, setSelectedId] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [locatingUnit, setLocatingUnit] = useState(false)
  useEffect(() => { if (open) setLocatingUnit(false) }, [open])
  const pending = useRef<SceneDesignRequest>()
  const storageKey = `jellyfish:scene-design-request:${projectId}:${sequenceId}:${version.id}`
  const readPending = () => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const request = JSON.parse(raw) as SceneDesignRequest
    if (!request?.request_id || !Number.isInteger(request.expected_revision) || request.expected_revision < 1 || !request.content?.design) throw new Error('原设计请求凭据无法解析，请恢复存储后重读。')
    return request
  }
  const clearPending = (requestId: string) => {
    if (readPending()?.request_id === requestId) localStorage.removeItem(storageKey)
    if (pending.current?.request_id === requestId) pending.current = undefined
  }
  const live = useRef({ content, disabled })
  live.current = { content, disabled }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      setReading(true)
      try {
        pending.current = readPending()
        const result = await StudioDirectingService.directingSceneDesignSuggestions({ projectId, sequenceId, versionId: version.id })
        if (!result.data) throw new Error('建议任务尚未核实')
        if (!active) return
        setRows(result.data); setReadError('')
        const matching = result.data.find(row => row.request_id === pending.current?.request_id)
        if (matching) { clearPending(matching.request_id); setSelectedId(matching.task_id); setError('') }
        if (result.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 2500)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
      finally { if (active) setReading(false) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, sequenceId, version.id, attempt, open])
  const selected = rows?.find(row => row.task_id === selectedId)
  const running = rows?.some(row => !terminal.includes(row.status))
  const submit = async () => {
    if (live.current.disabled || busy || !pending.current && limited && !validScope) return
    const request = pending.current || { request_id: crypto.randomUUID(), expected_revision: version.revision, content: structuredClone(live.current.content), instruction, scope: limited ? scope.map(field => field.value) : null }
    setBusy(true); setError('')
    try {
      localStorage.setItem(storageKey, JSON.stringify(request))
      pending.current = request
      const result = await StudioDirectingService.directingSceneDesignSuggest({ projectId, sequenceId, versionId: version.id, requestBody: request })
      if (!result.data) throw new Error('提交结果尚未核实')
      if (!mounted.current) return
      clearPending(request.request_id); setSelectedId(result.data.task_id); setAttempt(value => value + 1)
    } catch (cause) {
      if (mounted.current) {
        const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408
        if (rejected) {
          try { clearPending(request.request_id) } catch { setError('原设计请求已被拒绝，但本地凭据尚未清理，请恢复存储后重读。'); return }
        }
        setError(rejected ? directingError(cause) : `提交未核实，保留本次请求：${directingError(cause)}`)
      }
    }
    finally { if (mounted.current) setBusy(false) }
  }
  const apply = async () => {
    if (!selected || busy || live.current.disabled) return
    const snapshot = live.current.content
    setBusy(true); setError('')
    try {
      const result = await StudioDirectingService.directingSceneDesignPreview({ projectId, sequenceId, versionId: version.id,
        taskId: selected.task_id, requestBody: { content: snapshot } })
      if (!result.data) throw new Error('建议内容尚未核实')
      if (!mounted.current) return
      if (live.current.disabled || live.current.content !== snapshot) throw new Error('核对期间内容发生变化，请重新查看差异后应用')
      onChange({ ...snapshot, design: result.data.design }); onOpenChange(false)
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const differences = selected?.design ? revisionDifferences(selected.before, selected.design) : []
  const unitConflicts = selected?.design ? sceneUnitReferenceConflicts(content, selected.design) : []
  // 响应补齐的 nullable 和空列表默认值不属于用户改动。
  const empty = (value: unknown) => value == null || Array.isArray(value) && !value.length
  const currentDifferences = selected ? revisionDifferences(selected.before, content.design).filter(change => !empty(change.before) || !empty(change.after)) : []
  const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '未填写'
  const trigger = <Button onClick={() => onOpenChange(true)}>{running ? '查看设计任务' : rows?.some(row => row.status === 'succeeded') ? '查看设计建议' : 'AI 提取设计 · 整场'}</Button>
  return <>
    {triggerHost === undefined ? trigger : triggerHost && createPortal(trigger, triggerHost)}
    <Modal rootClassName="canvas-workbench-dialog" title="AI 设计建议" open={open} focusTriggerAfterClose={!locatingUnit} width={960} styles={{ body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } }}
      onCancel={() => onOpenChange(false)} footer={<Button onClick={() => onOpenChange(false)}>关闭建议</Button>}>
      <p>使用本版本明确选择的原文。整场提取不受当前镜头选择影响；局部修订须在生成前明确允许修改的字段。结果先预览，再整次应用。</p>
      {reading && <Spin size="small" />}
      {readError && <Alert type="error" message="建议任务读取失败，已知内容保留" description={readError}
        action={<Button onClick={() => setAttempt(value => value + 1)}>重试读取建议</Button>} />}
      {error && <Alert type="error" message={error} />}
      {pending.current ? <Button disabled={busy || disabled} onClick={() => void submit()}>核实原设计请求</Button> : <>
        <label>设计建议范围</label>
        <Radio.Group className="scene-design-scope" aria-label="设计建议范围" value={limited ? 'limited' : 'whole'} disabled={disabled || busy}
          onChange={event => setLimited(event.target.value === 'limited')}>
          <Radio.Button value="whole">整场提取</Radio.Button><Radio.Button value="limited">限定范围修订</Radio.Button>
        </Radio.Group>
        {limited && <>
          <p>仅替换选中的完整内容字段；身份、引用和对象增删不属于局部修订范围。</p>
          <Select aria-label="允许修改的字段" mode="multiple" showSearch optionFilterProp="label" style={{ width: '100%' }}
            disabled={disabled || busy} options={fields} value={scope.map(field => field.value)}
            onChange={values => setScope(values.flatMap(path => fields.find(field => field.value === path) || []))} />
          {scope.length > 0 && !validScope && <Alert type="warning" message="所选范围已失效或超过 100 项，请重新明确选择字段" />}
        </>}
        <label htmlFor="scene-design-instruction">设计要求（可选）</label>
        <Input.TextArea id="scene-design-instruction" value={instruction} disabled={disabled || busy} onChange={event => setInstruction(event.target.value)} />
        <Button type="primary" disabled={disabled || busy || reading || !!readError || !rows || running || limited && !validScope} onClick={() => void submit()}>{limited ? '生成局部修订建议' : '生成整场设计建议'}</Button>
      </>}
      {rows && !rows.length && !reading && !readError && <p>当前版本尚无设计建议。</p>}
      {!!rows?.length && <Select aria-label="设计建议记录" placeholder="选择本次建议查看" value={selectedId} style={{ width: '100%', marginTop: 16 }}
        options={rows.map((row, index) => ({ value: row.task_id, label: `建议 ${rows.length - index} · ${statusNames[row.status] || row.status}` }))}
        onChange={id => { setSelectedId(id); setError('') }} />}
      {selected && <section className="scene-design-suggestions" aria-label="设计建议预览">
        <p>状态：{statusNames[selected.status] || selected.status}</p><h3>本次范围：{selected.scope ? '限定字段修订' : '整场设计'}</h3>
        {selected.scope && <ul>{selected.scope.map(path => <li key={path}>{scopeFields(selected.before).find(field => field.value === path)?.label || '原字段不可用'}</li>)}</ul>}
        <h3>本次固定原文</h3><p>{selected.basis.text}</p>
        <p>{selected.instruction || '未补充设计要求'}</p>
        {selected.error && <Alert type="error" message={selected.error} />}
        {!terminal.includes(selected.status) && <Button disabled={busy || disabled} onClick={async () => {
          setBusy(true)
          try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: selected.task_id, requestBody: { reason: '用户取消设计建议' } }); setAttempt(value => value + 1) }
          catch (cause) { setError(directingError(cause)) }
          finally { setBusy(false) }
        }}>取消本次设计任务</Button>}
        {!!currentDifferences.length && <section aria-label="当前编辑与建议依据的差异">
          <Alert type="warning" message="设计已变化，旧建议不能覆盖当前编辑" description="请核对以下位置，按当前内容重新发起建议。" />
          {currentDifferences.map((change, index) => <details key={index}><summary>{fieldLabel(change.path, content.design)}</summary>
            <p>建议生成前</p><pre>{display(change.before)}</pre><p>当前编辑</p><pre>{display(change.after)}</pre>
          </details>)}
        </section>}
        {selected.design && <section aria-label="建议内容差异">
          {!!unitConflicts.length && <Alert type="error" message="建议与当前单元引用冲突，整次应用已阻止" description={<>
            <p>先明确调整下游引用，再回来重新核对并整次应用；不会自动删除单元、素材或改写覆盖。</p>
            {unitConflicts.map(conflict => <p key={`${conflict.unitId}:${conflict.coverageId || conflict.referenceId}`}>
              {conflict.label}：{conflict.reason} <Button onClick={() => { setLocatingUnit(true); onLocateUnit(conflict) }}>定位{conflict.label}</Button>
            </p>)}
          </>} />}
          <h3>设计差异 · {differences.length} 项</h3>
          {differences.map((change, index) => <details key={index}><summary>{fieldLabel(change.path, selected.before)}</summary>
            <p>生成前</p><pre>{display(change.before)}</pre><p>建议</p><pre>{display(change.after)}</pre>
          </details>)}
          {!differences.length && <p>建议与原设计一致。</p>}
          <Space><Button type="primary" disabled={disabled || busy || !!readError || !differences.length || !!unitConflicts.length} onClick={() => void apply()}>应用到当前版本</Button></Space>
        </section>}
      </section>}
    </Modal>
  </>
}
