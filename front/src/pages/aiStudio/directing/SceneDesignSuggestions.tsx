import { WorkbenchButton as Button } from './ui/WorkbenchButton'
import { WorkbenchModal as Modal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { CanvasTextPreview } from './CanvasTextPreview'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AimOutlined, FileTextOutlined, HistoryOutlined, PlusOutlined, EditOutlined } from '@ant-design/icons'
import { Alert, Input, Select, Spin, message } from 'antd'
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
const statusNames: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已生成', failed: '失败', cancelled: '已取消' }

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

/** 来源与默认结构不算已填写；人工添加的对象或正文同样属于已有设计。 */
function hasDesignContent(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0
  if (!value || typeof value !== 'object') return false
  const row = value as Record<string, unknown>
  if ('state' in row) return typeof row.text === 'string' && !!row.text.trim()
  return Object.entries(row).some(([key, child]) => key !== 'sources' && key !== 'style_revision_id' && hasDesignContent(child))
}

function designSummary(value: unknown): string {
  if (!value || typeof value !== 'object') return ''
  const row = value as Record<string, unknown>
  if ('state' in row) return typeof row.text === 'string' ? row.text : ''
  return Object.entries(row).filter(([key]) => key !== 'sources').map(([, child]) => designSummary(child)).find(Boolean) || ''
}

/** 建议与编辑内容分开；每次应用先核实固定依据，整份结果只进入一次编辑历史。 */
export function SceneDesignSuggestions({ triggerHost, projectId, sequenceId, version, content, disabled, open, onOpenChange, onChange, onLocateUnit }: {
  triggerHost?: HTMLElement | null
  projectId: string; sequenceId: string; version: SceneVersionRead; content: SceneVersionContent_Output
  disabled: boolean; open: boolean; onOpenChange: (open: boolean) => void
  onChange: (content: SceneVersionContent_Output) => void
  onLocateUnit: (conflict: UnitReferenceConflict) => void
}) {
  const [messageApi, messageContext] = message.useMessage()
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
  const [preparing, setPreparing] = useState(false)
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
        if (matching) { clearPending(matching.request_id); setSelectedId(matching.task_id); setPreparing(false); setError('') }
        if (result.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 2500)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
      finally { if (active) setReading(false) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, sequenceId, version.id, attempt, open])
  const selected = preparing ? undefined : selectedId ? rows?.find(row => row.task_id === selectedId) : rows?.find(row => !terminal.includes(row.status)) || rows?.[0]
  const awaitingSelection = !preparing && !!selectedId && !selected
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
      clearPending(request.request_id); setSelectedId(result.data.task_id); setPreparing(false); setAttempt(value => value + 1)
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
      void messageApi.success(`设计已应用到「${version.title}」`)
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const differences = selected?.design ? revisionDifferences(selected.before, selected.design) : []
  const unitConflicts = selected?.design ? sceneUnitReferenceConflicts(content, selected.design) : []
  // 响应补齐的 nullable 和空列表默认值不属于用户改动。
  const empty = (value: unknown) => value == null || Array.isArray(value) && !value.length
  const currentDifferences = selected ? revisionDifferences(selected.before, content.design).filter(change => !empty(change.before) || !empty(change.after)) : []
  const display = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '未填写'
  const hasDesign = hasDesignContent(content.design)
  const generating = selected && !terminal.includes(selected.status)
  const generateLabel = limited ? (hasDesign ? '生成调整方案' : '生成所选内容') : (hasDesign ? '重新生成整场' : '生成场次设计')
  const recordStatus = (row: SceneDesignSuggestionRead) => row.design
    ? !revisionDifferences(row.design, content.design).length ? '与当前设计一致' : !revisionDifferences(row.before, content.design).length ? '待应用' : '待核对'
    : row.diagnostics ? '未完成 · 可查看结果' : statusNames[row.status] || row.status
  const triggerLabel = 'AI 设计'
  const trigger = <Button size="large" className="scene-design-launch" aria-label={triggerLabel} title={running ? '查看当前执行进度' : '整场设计建议'} aria-haspopup="dialog" onClick={() => onOpenChange(true)}>
    <svg className="scene-design-launch-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <path d="m4 20 11-11 3 3L7 23z" transform="translate(0 -2)" />
      <path d="m12 10 3 3M6 3v4M4 5h4M19 2v6M16 5h6M20 16v4M18 18h4" />
    </svg>
    <span>{triggerLabel}</span>
  </Button>
  return <>
    {messageContext}
    {triggerHost === undefined ? trigger : triggerHost && createPortal(trigger, triggerHost)}
    <Modal rootClassName="scene-ai-design-dialog" title="AI 设计" open={open} focusTriggerAfterClose={!locatingUnit}
      onCancel={() => onOpenChange(false)} footer={<WorkbenchDialogActions className="scene-ai-footer" secondary={<Button variant="quiet" onClick={() => onOpenChange(false)}>{selected?.design ? '暂不应用' : generating ? '稍后查看' : '取消'}</Button>}>
        {pending.current ? <Button variant="primary" disabled={busy || disabled} loading={busy} onClick={() => void submit()}>核实原设计请求</Button>
          : selected?.design ? <><span className="scene-ai-apply-target" title={`写入「${version.title}」`}>写入「{version.title}」</span><Button variant="primary" disabled={disabled || busy || !!readError || !differences.length || !!unitConflicts.length} loading={busy} onClick={() => void apply()}>应用设计</Button></>
          : generating ? <Button disabled={busy || disabled} onClick={async () => {
            setBusy(true)
            try { await FilmService.cancelTaskApiV1FilmTasksTaskIdCancelPost({ taskId: selected.task_id, requestBody: { reason: '用户取消设计建议' } }); setAttempt(value => value + 1) }
            catch (cause) { setError(directingError(cause)) }
            finally { setBusy(false) }
          }}>取消本次设计任务</Button>
          : selected ? <Button variant="primary" disabled={busy || disabled || running} onClick={() => { setPreparing(true); setError('') }}>调整后重新生成</Button>
          : <Button variant="primary" className="scene-design-generate" disabled={disabled || busy || reading || !!readError || !rows || running || awaitingSelection || limited && !validScope} loading={busy} onClick={() => void submit()}>{generateLabel}</Button>}
      </WorkbenchDialogActions>}>
      <p className="scene-ai-version-owner">所属版本：<strong>{version.title}</strong></p>
      <div className="scene-ai-intro"><p>根据原文生成六岗设计，供你检查并应用。</p><span>结果不会自动覆盖当前设计</span></div>
      <ol className="scene-ai-stages" aria-label="设计流程">
        {['准备', '生成中', '查看结果'].map((label, index) => <li key={label} aria-current={index === (generating || awaitingSelection ? 1 : selected ? 2 : 0) ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}
      </ol>
      <div className="scene-ai-refresh-status" role="status">
        {!rows && reading && <><Spin size="small" /><span>正在读取设计任务…</span></>}
        {readError && <><span title={readError}>{rows ? '刷新失败，已保留上次状态' : '建议任务读取失败，已知内容保留'}</span><Button variant="quiet" size="small" disabled={reading} onClick={() => setAttempt(value => value + 1)}>重试读取建议</Button></>}
      </div>
      {error && <Alert type="error" message={error} action={error.includes('结果来源校验未通过') && selected?.design ? <Button icon={<PlusOutlined aria-hidden="true" />} disabled={busy || disabled || running} onClick={() => { setPreparing(true); setError('') }}>重新生成设计</Button> : undefined} />}
      {!!rows?.length && <div className="scene-ai-history">
        <details><summary><HistoryOutlined aria-hidden="true" /> 生成记录 · {rows.length} <span className="scene-ai-empty-tag">当前版本</span></summary><Select aria-label="生成记录" placeholder="选择生成记录" value={selected?.task_id} style={{ width: '100%' }}
          options={rows.map(row => ({ value: row.task_id, label: `${new Date(row.created_at).toLocaleString('zh-CN', { hour12: false })} · ${row.scope ? '局部设计' : '整场设计'} · ${recordStatus(row)}` }))}
          onChange={id => { setSelectedId(id); setPreparing(false); setError('') }} /></details>
        {selected && !generating && <Button className="scene-ai-new-design" icon={<PlusOutlined aria-hidden="true" />} disabled={busy || disabled || running || !!pending.current} onClick={() => { setPreparing(true); setError('') }}>发起新设计</Button>}
      </div>}
      {pending.current && <Alert type="info" message="上次提交尚未核实" description="请先核实原请求，避免重复生成。原设计要求与范围已保留。" />}
      {awaitingSelection && <p role="status">正在读取本次设计任务…</p>}
      {!selected && !awaitingSelection && !pending.current && <div className="scene-ai-prepare">
        <section className="scene-ai-source"><h3><FileTextOutlined aria-hidden="true" /> 原文依据</h3><CanvasTextPreview text={content.basis.text || '当前版本尚无原文'} label="原文" lines={4} paragraphClassName="scene-ai-source-text" />
          <span>使用当前版本采用的原文，不受画布中选中镜头影响。</span>
        </section>
        <section className="scene-ai-settings"><h3>{hasDesign ? '继续完善场次设计' : '从原文开始设计'}</h3>
          <p>{limited ? '只生成所选字段的内容，其他设计保持不变。' : '统筹总导演、表演、镜内执行、摄影、连续性与声音设计。'}</p>
          <div className="scene-ai-scope" role="group" aria-label="设计范围">
            <Button className="canvas-choice" aria-pressed={!limited} disabled={disabled || busy} onClick={() => setLimited(false)}>{hasDesign ? '重新生成整场' : '整场设计'}</Button>
            <Button variant="quiet" className="canvas-choice" aria-pressed={limited} disabled={disabled || busy} onClick={() => setLimited(true)}>{hasDesign ? '调整部分设计' : '只设计部分内容'}</Button>
          </div>
          {limited && <div className="scene-ai-field-picker">
            <label htmlFor="scene-design-fields">选择要设计的内容</label>
            <Select id="scene-design-fields" aria-label="允许修改的字段" mode="multiple" showSearch optionFilterProp="label" style={{ width: '100%' }}
              disabled={disabled || busy} options={fields} value={scope.map(field => field.value)}
              onChange={values => setScope(values.flatMap(path => fields.find(field => field.value === path) || []))} />
            <small>可补全空字段或修改已有内容；不会新增镜头、人物等对象，也不改变引用关系。</small>
            {scope.length > 0 && !validScope && <Alert type="warning" message="所选范围已失效或超过 100 项，请重新明确选择字段" />}
          </div>}
          <label htmlFor="scene-design-instruction">设计要求（可选）</label>
          <Input.TextArea id="scene-design-instruction" autoSize={{ minRows: 3, maxRows: 6 }} placeholder="例如：突出人物犹豫的情绪，镜头节奏保持克制" value={instruction} disabled={disabled || busy} onChange={event => setInstruction(event.target.value)} />
        </section>
      </div>}
      {selected && <section className="scene-design-suggestions" aria-label="设计建议预览">
        <div className="scene-ai-result-heading"><h3>{generating ? '正在准备你的场次设计' : selected.design ? '检查本次设计' : '本次设计未完成'}</h3><span role="status">状态：{recordStatus(selected)}</span></div>
        {generating && <p>任务在后台执行，可以关闭窗口稍后查看。完成后先检查结果，再应用到当前版本。</p>}
        <details className="scene-ai-context"><summary><FileTextOutlined aria-hidden="true" /> 依据与要求 <span className="scene-ai-scope-tag"><AimOutlined aria-hidden="true" /> {selected.scope ? `部分 · ${selected.scope.length} 项` : '整场'}</span></summary>
          {selected.scope && <ul>{selected.scope.map(path => <li key={path}>{scopeFields(selected.before).find(field => field.value === path)?.label || '原字段不可用'}</li>)}</ul>}
          <div className="scene-ai-basis-sections">
            <section aria-label="原文依据"><h4><FileTextOutlined aria-hidden="true" /> 原文依据</h4><p>{selected.basis.text}</p></section>
            <section aria-label="设计要求"><h4><EditOutlined aria-hidden="true" /> 设计要求 {!selected.instruction.trim() && <span className="scene-ai-empty-tag">未填写</span>}</h4>{!!selected.instruction.trim() && <p>{selected.instruction}</p>}</section>
          </div>
        </details>
        {selected.error && <Alert type="error" message={selected.diagnostics ? '整场设计未完成，已保留本次结果' : selected.error} />}
        {selected.diagnostics && <section aria-label="未完成设计结果">
          <p>本次结果未通过完整性检查，已保留供核对。请处理缺项后重新发起设计。</p>
          <ul>{selected.diagnostics.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
          <details><summary>查看模型输出 · 只读</summary><pre>{selected.diagnostics.output}</pre></details>
        </section>}
        {selected.design && <div className="scene-ai-departments">{(['direction', 'performance', 'staging', 'cinematography', 'continuity', 'sound'] as const).map(role => <section key={role}>
          <h4>{designLabels[role]}</h4><p>{designSummary(selected.design![role]) || '暂无正文内容'}</p>
          <span>{differences.filter(change => change.path === role || change.path.startsWith(`${role}.`) || change.path.startsWith(`${role}[`)).length} 项变更</span>
        </section>)}</div>}
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
        </section>}
      </section>}
    </Modal>
  </>
}
