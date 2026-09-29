import { useContext, useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Select, Space, Tag } from 'antd'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { DirectingTaskRead, ApplyReviewRevisionRequest, ReviewRevisionRequest, WorkspaceRead, EditableRevisionField, ReviewPacket } from '../../../services/generated'
import { ProductionDetailContext } from './ProductionWorkbench'
import { useWorkspaceDraft } from './WorkspaceDrafts'
import { useWorkspacePreparation } from './useWorkspacePreparation'
import { revisionDirections, revisionInputIdentity, revisionIssueKey, directRevisionEdits, revisionRecoveryLabel, matchingRevisionFields } from './reviewRevision'
import { contextForPrompt, readablePath, readableSegments } from './readableText'
import { directingError } from './common'

type Props = {
  workspace: WorkspaceRead; packet?: ReviewPacket;
  scope: string; projectId: string; sequenceId: string; promptId: string;
  reviewSource?: { kind: 'review' | 'task'; id: string }; disabled?: boolean;
  onPrepare: () => void; onDesign: () => void;
  onTask: (taskId: string) => void;
  onApplied: (workspace: WorkspaceRead, planId: string, promptId: string, reviewTaskId: string) => void;
}

const stageLabel = (stage: 'saved' | 'compiled' | 'reviewing' | 'blocked') => ({ saved: '修订已保存，等待核对与编译', compiled: '新指令已生成，等待检查', reviewing: '已生成新指令，正在重新检查', blocked: '处理暂停，已完成步骤保留' })[stage]

/** 方向是本地草稿；方案和采用结果均从服务端核实，生成预览不表示采用。 */
export function ReviewRevisionPanel(props: Props) {
  const { scope, projectId, sequenceId, promptId, reviewSource, workspace, packet, disabled, onTask, onApplied } = props
  const detail = useContext(ProductionDetailContext)
  const draft = useWorkspacePreparation('问题处理方向', scope, { instruction: '', fieldValues: {} as Record<string, string>, directions: {} as Record<string, string>, soundChoices: {} as Record<string, string>, request: '', taskId: '', identity: '', application: '' })
  const [fields, setFields] = useState<EditableRevisionField[]>([])
  const [fieldsError, setFieldsError] = useState('')
  const [fieldEditorOpen, setFieldEditorOpen] = useState(false)
  const [fieldPaths, setFieldPaths] = useState<string[]>()
  const handledRequest = useRef<typeof detail.request>(undefined)
  const [fieldKey, setFieldKey] = useState('')
  const [fieldAttempt, setFieldAttempt] = useState(0)
  const [task, setTask] = useState<DirectingTaskRead>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const prompt = workspace.prompts.find(row => row.id === promptId)
  const plan = workspace.plans.find(row => row.id === prompt?.content.plan_revision_id)
  const design = workspace.designs.find(row => row.id === plan?.content.design_revision_id)
  const directions = packet ? revisionDirections(packet, draft.value.directions).map(({ direction, ...issue }) => {
    const choice: string | undefined = draft.value.soundChoices[revisionIssueKey(issue, issue.finding_index)]
    return { ...issue, text: direction, sound_execution: choice === 'generated' || choice === 'postproduction' ? choice as 'generated' | 'postproduction' : null }
  }) : []
  const edits = directRevisionEdits(fields, draft.value.fieldValues)
  const identity = revisionInputIdentity([scope, workspace.sequence, prompt, plan, design, packet, draft.value.instruction, draft.value.fieldValues], directions)
  useEffect(() => {
    let active = true
    void StudioDirectingService.directingRevisionFields({ projectId, sequenceId, promptRevisionId: promptId }).then(response => {
      if (!active) return
      if (!response.data || !Array.isArray(response.data.fields) || response.data.prompt_revision_id !== promptId) throw new Error('可编辑内容暂不可用')
      setFields(response.data.fields); setFieldsError('')
    }).catch(cause => { if (active) setFieldsError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, sequenceId, promptId, fieldAttempt])
  const callbacks = useRef({ onTask, onApplied })
  callbacks.current = { onTask, onApplied }
  const stale = !!draft.value.identity && draft.value.identity !== identity
  const draftRef = useRef(draft)
  draftRef.current = draft
  const candidate = task?.revision
  useEffect(() => {
    if (!task?.revision_application || !task.revision || !task.revision_request) return
    const body: ApplyReviewRevisionRequest = { task_id: task.task_id, request_id: task.revision_application.request_id, input_identity: task.revision.input_identity, directions: task.revision_request.directions || [], instruction: task.revision_request.instruction, edits: task.revision_request.edits, candidate_identity: task.revision.candidate_identity }
    const application = JSON.stringify(body)
    if (draftRef.current.value.application !== application) draftRef.current.update({ application })
  }, [task])
  const generating = !!draft.value.taskId && (!task || ['queued', 'running'].includes(task.status))
  const applying = !!draft.value.application
  useWorkspaceDraft({ name: '采用修改方案', dirty: false, busy: busy && applying, save: async () => true, discard: () => {} })
  const context = contextForPrompt(workspace, promptId)
  const fieldLabel = (field: EditableRevisionField) => field.path === '/duration_ms' ? '时长（秒）' : field.path === '/ratio' ? '画幅' : field.path === '/sound/execution' ? '声音制作方式' : readablePath(field.path, context)
  const availableFields = matchingRevisionFields(fields, fieldPaths)
  const selectedField = availableFields.find(field => `${field.target}:${field.path}` === fieldKey) || availableFields[0]
  useEffect(() => {
    if (detail.request?.tab !== 'revision' || handledRequest.current === detail.request) return
    handledRequest.current = detail.request
    const { paths, suggestion } = detail.request
    if (suggestion?.trim() && !draftRef.current.value.application) {
      draftRef.current.update({ instruction: [draftRef.current.value.instruction, suggestion.trim()].filter(Boolean).join('\n') })
    }
    setFieldKey(''); setFieldPaths(paths)
    if (paths?.length && !suggestion) setFieldEditorOpen(true)
    detail.consume()
    document.getElementById('revision-instruction')?.focus()
  }, [detail.request])
  const readable = (value: unknown) => {
    if (value && typeof value === 'object' && 'state' in value) {
      const note = value as { text?: string; reason?: string; state: string }
      return readableSegments(note.text || note.reason || ({ none: '明确没有', unset: '未填写', unknown: '待确定', not_applicable: '不适用' }[note.state] || note.state), context).map(row => row.label).join('')
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return ({ generated: '由模型生成声音', postproduction: '后期制作声音', unknown: '待确定' }[String(value)] || readableSegments(text, context).map(row => row.label).join(''))
  }
  useEffect(() => {
    if (!draft.value.taskId) { setTask(undefined); return }
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try {
        const response = await StudioDirectingService.directingTask({ projectId, taskId: draft.value.taskId })
        if (!active) return
        if (!response.data) throw new Error('修改方案状态暂不可用')
        setTask(response.data); setError('')
        if (response.data.revision_application) { setProgress(response.data.revision_application.stage === 'blocked' ? response.data.revision_application.prompt_revision_id ? '新指令已保存，检查尚未启动。' : response.data.revision_application.plan_revision_id ? '修改已保存，指令尚未生成。' : '修改尚未保存，请核对提示后继续。' : stageLabel(response.data.revision_application.stage)); setError(response.data.revision_application.error || '') }
        if (['queued', 'running'].includes(response.data.status)) timer = setTimeout(() => { void load() }, 2500)

      } catch (cause) { if (active) { setError(directingError(cause)); timer = setTimeout(() => { void load() }, 5000) } }
    }
    void load()
    return () => { active = false; clearTimeout(timer) }
  }, [projectId, draft.value.taskId])

  const generate = async () => {
    if (busy || applying || disabled) return
    const frozen = identity
    const recover = draft.value.request && !draft.value.taskId && draft.value.identity === frozen
    const body: ReviewRevisionRequest = recover ? JSON.parse(draft.value.request) : { prompt_revision_id: promptId, review_source: reviewSource, instruction: draft.value.instruction, edits, directions, request_id: crypto.randomUUID() }
    // 先保存请求身份，响应丢失后继续核实同一次生成。
    if (!draft.update({ request: JSON.stringify(body), taskId: '', identity: frozen })) { setError('请求身份未能暂存，请恢复浏览器存储后重试。'); return }
    setTask(undefined); setBusy(true); setError('')
    try {
      const direct = !!body.edits?.length && !body.instruction?.trim() && !body.directions?.some(row => row.text.trim())
      const response = await (direct ? StudioDirectingService.directingPreviewReviewRevision : StudioDirectingService.directingGenerateReviewRevision)({ projectId, sequenceId, requestBody: body })
      if (!response.data) throw new Error('提交结果待核实，请重试同一次生成')
      if (!mounted.current) return
      draft.update({ taskId: response.data.task_id })
      callbacks.current.onTask(response.data.task_id)
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const apply = async () => {
    if (busy || disabled || (!applying && (stale || !candidate))) return
    const body: ApplyReviewRevisionRequest = applying ? JSON.parse(draft.value.application) : { task_id: draft.value.taskId, input_identity: candidate!.input_identity, candidate_identity: candidate!.candidate_identity, instruction: draft.value.instruction, edits, directions, request_id: crypto.randomUUID() }
    if (!draft.update({ application: JSON.stringify(body) })) { setError('采用身份未能暂存，请恢复浏览器存储后重试。'); return }
    setBusy(true); setError(''); setProgress('正在保存修订、核对单元并重新检查…')
    try {
      const response = await StudioDirectingService.directingApplyReviewRevision({ projectId, sequenceId, requestBody: body })
      if (!response.data) throw new Error('采用结果待核实，继续处理将恢复同一次操作')
      if (!mounted.current) return
      const result = response.data
      setProgress(result.stage === 'blocked' ? result.prompt_revision_id ? '新指令已保存，检查尚未启动。' : result.plan_revision_id ? '修改已保存，指令尚未生成。' : '修改尚未保存，请核对提示后继续。' : stageLabel(result.stage))
      setTask(previous => previous ? { ...previous, revision_application: result } : previous)
      if (result.error) setError(result.error)
      if (result.review_task_id && result.prompt_revision_id && result.plan_revision_id) {
        const next = await StudioDirectingService.directingWorkspace({ projectId, sequenceId })
        if (!next.data) throw new Error('新版本已保存，读取工作区失败；继续处理即可恢复')
        if (mounted.current) callbacks.current.onApplied(next.data, result.plan_revision_id, result.prompt_revision_id, result.review_task_id)
      }
    } catch (cause) { if (mounted.current) {
      if (cause instanceof ApiError && [400, 409, 422].includes(cause.status)) {
        // 明确拒绝后也先核实服务端，避免丢失其他标签页已经采用的原请求身份。
        const recovered = await StudioDirectingService.directingTask({ projectId, taskId: body.task_id }).catch(() => undefined)
        if (mounted.current && recovered?.data) {
          setTask(recovered.data)
          if (!recovered.data.revision_application) draft.update({ application: '' })
        }
      }
      setError(directingError(cause))
    } }
    finally { if (mounted.current) setBusy(false) }
  }
  const reviseAgain = () => {
    if (busy || task?.revision_application?.stage !== 'blocked') return
    if (!draft.update({ request: '', taskId: '', identity: '', application: '' })) return
    setTask(undefined); setError(''); setProgress('已保存的版本保留，可调整方向并生成另一份方案。')
  }
  const problemLabel = (key: string) => {
    for (const row of packet?.rows || []) for (const index of row.findings.length ? row.findings.map((_, i) => i) : [-1]) if (revisionIssueKey(row, index) === key) return readable(row.findings[index]?.observation || row.rationale)
    return '本次修改要求'
  }
  const canApply = candidate && (!candidate.summary || candidate.summary.status === 'planned') && !!candidate.preview_text && !!candidate.candidate_identity && (candidate.changes || []).length > 0 && (candidate.outcomes || []).every(row => row.status === 'planned')
  const controls = <div className="review-revision-controls">
    <small role="status">修改要求自动暂存于本浏览器。</small>
    {task?.status === 'failed' && <Alert type="error" message={task.error || '修改方案生成失败，可重新生成。'} />}
    {!directions.length && !draft.value.instruction.trim() && !edits.length && <p>填写修改要求，或直接编辑一项内容后生成方案。</p>}
    <Space wrap>
      {!applying && <Button type={canApply && !stale ? 'default' : 'primary'} loading={busy || generating} disabled={disabled || workspace.sequence.source_changed || !!draft.error || generating || (!directions.length && !draft.value.instruction.trim() && !edits.length) || (!!Object.keys(draft.value.fieldValues).length && (!fields.length || !!fieldsError))} onClick={() => { void generate() }}>{draft.value.request && !draft.value.taskId && !stale ? '核实本次生成' : candidate || stale ? '更新修改方案' : '生成修改方案'}</Button>}

    </Space>
  </div>
  return <section className="review-revision-panel" data-workspace-target="revision" aria-label="修改方案">
      <section className="revision-current-unit" aria-label="这次拍什么">
        <header><h2>这次拍什么</h2><Button onClick={() => { setFieldPaths(undefined); setFieldEditorOpen(open => !open) }} aria-expanded={fieldEditorOpen}>直接编辑</Button></header>
        {context.unit?.coverage.map((coverage, index) => <div key={coverage.id}><strong>{context.entities.find(entity => entity.kind === '镜头' && entity.id === coverage.shot_id)?.label || '历史镜头暂不可用'} · 本单元第 {index + 1} 段</strong><p>{readable(coverage.action_scope) || '动作范围未填写'}</p>{context.design?.performance.beats.filter(beat => coverage.beat_ids.includes(beat.beat_id) && beat.physical_action.text).map((beat, beatIndex) => <p className="design-secondary" key={beatIndex}>{readable(beat.participant_id)}：{readable(beat.physical_action)}</p>)}</div>)}
        {!context.unit && <p>当前指令的固定单元暂不可用。</p>}
        <small className="design-secondary">依据当前指令的固定版本；修改草稿不会改变当前指令。</small>
      </section>
      {fieldEditorOpen && <section className="revision-field-editor" aria-label="直接编辑"><header><h3>直接编辑</h3><Button onClick={() => setFieldEditorOpen(false)}>收起编辑</Button></header>
        {fieldsError && <Alert type="warning" message="可编辑内容读取失败，已填写内容保留。" action={<Button onClick={() => setFieldAttempt(value => value + 1)}>重试读取</Button>} />}
        {!fields.length && !fieldsError && <p>正在读取可编辑内容…</p>}
        {!!fields.length && !availableFields.length && <Alert type="info" message="这段内容不在当前单元可直接修改的范围内。可填写修改要求，或前往导演设计核对共享内容。" />}
        {!!fieldPaths?.length && <Button type="link" onClick={() => { setFieldPaths(undefined); setFieldKey('') }}>查看其他可编辑内容</Button>}
        {availableFields.length > 0 && <Select aria-label="选择修改内容" className="w-full" value={selectedField && `${selectedField.target}:${selectedField.path}`} options={availableFields.map(field => ({ value: `${field.target}:${field.path}`, label: fieldLabel(field) }))} onChange={setFieldKey} />}
        {(selectedField ? [selectedField] : []).map(field => {
          const key = `${field.target}:${field.path}`
          const note = field.value && typeof field.value === 'object' && 'state' in field.value
          const value = draft.value.fieldValues[key] ?? (note ? field.value.text || field.value.reason || '' : field.path === '/duration_ms' ? String(field.value / 1000) : String(field.value))
          const label = fieldLabel(field)
          return <div className="revision-field" key={key}><label>{label}</label>{field.path === '/sound/execution' ? <Select aria-label={label} value={value} disabled={applying} options={[{ value: 'generated', label: '模型生成' }, { value: 'postproduction', label: '后期添加' }, { value: 'unknown', label: '待确定' }]} onChange={value => draft.update({ fieldValues: { ...draft.value.fieldValues, [key]: value } })} /> : <Input.TextArea aria-label={label} value={value} disabled={applying} autoSize={{ minRows: 1, maxRows: 4 }} onChange={event => draft.update({ fieldValues: { ...draft.value.fieldValues, [key]: event.target.value } })} />}</div>
        })}
        {!!edits.length && <p>已编辑：{edits.map(edit => fieldLabel({ ...edit, value: edit.after })).join('、')}</p>}
        <p className="design-secondary">只改这些字段可直接预览，不调用 AI。更换模型或参考、调整共享内容需修改对应依据，当前要求会保留。</p>
        <Space wrap><Button onClick={props.onPrepare}>前往拍摄准备</Button><Button onClick={props.onDesign}>前往导演设计</Button></Space>
      </section>}
      <label htmlFor="revision-instruction">你希望怎么改？</label>
      <Input.TextArea id="revision-instruction" value={draft.value.instruction} disabled={applying} maxLength={8000} autoSize={{ minRows: 3, maxRows: 8 }} placeholder="例如：保留人物停步，镜头改为固定机位；对白交给后期。" onChange={event => draft.update({ instruction: event.target.value })} />
      {controls}
      {Object.keys(draft.value.directions).length > 0 && <details className="review-direction"><summary>上次逐项方向</summary>{Object.entries(draft.value.directions).map(([key, value]) => <div key={key}><label>{problemLabel(key)}</label><Input.TextArea aria-label="处理方向" value={value} maxLength={2000} autoSize={{ minRows: 2, maxRows: 6 }} disabled={applying} onChange={event => draft.update({ directions: { ...draft.value.directions, [key]: event.target.value }, soundChoices: { ...draft.value.soundChoices, [key]: '' } })} /></div>)}</details>}
      {generating && <p role="status">AI 正在核对问题与处理方向…</p>}
      {stale && !applying && <Alert type="warning" message="方案需要更新，不能采用旧方案。" />}
      {!!candidate?.changes?.length && <section><h3>本次将修改 {candidate.changes.length} 处</h3><ul>{candidate.changes.map((change, index) => <li key={index}><strong>{readablePath(change.path, context)}</strong>：{readable(change.before)} → {readable(change.after)}</li>)}</ul><p className="design-secondary">采用后保存新版本并重新检查，已有视频不变。</p></section>}
      {!!candidate?.changes?.length && <details><summary>修改前后与依据</summary>{candidate.changes.map((change, index) => <section className="review-revision-change" key={index}><h3>{change.target === 'unit' ? '当前单元 · ' : ''}{readablePath(change.path, context)}</h3><p>{readable(change.reason)}</p><small>对应问题：{(change.problem_keys || []).map(problemLabel).join('；')}</small><div><strong>修改前</strong><p>{readable(change.before)}</p></div><div className="review-revision-after"><strong>拟修改为</strong><p>{readable(change.after)}</p></div></section>)}</details>}
      {candidate?.summary && <section aria-label="整体修改结果"><Tag color={candidate.summary.status === 'planned' ? 'blue' : 'orange'}>{{ planned: '拟落实', needs_choice: '需要你选择', unresolved: '未能满足', unchanged: '无需修改' }[candidate.summary.status]}</Tag><p>{readable(candidate.summary.reason)}</p><Space wrap>{candidate.summary.choices?.map(choice => <Button key={choice} disabled={applying} onClick={() => {
        const sound = choice === '声音由后期添加' ? 'postproduction' : choice === '使用支持声音的模型同期生成' ? 'generated' : ''
        const saved = draft.update({ instruction: [draft.value.instruction, choice].filter(Boolean).join('；'), ...(sound ? { fieldValues: { ...draft.value.fieldValues, 'design:/sound/execution': sound } } : {}) })
        if (saved && sound === 'generated') props.onPrepare()
      }}>{choice}</Button>)}</Space>{candidate.summary.status === 'unresolved' && <Space wrap><Button onClick={props.onPrepare}>前往拍摄准备</Button><Button onClick={props.onDesign}>前往导演设计</Button></Space>}</section>}
      {candidate?.preview_text && <details><summary>查看新指令全文</summary><pre>{candidate.preview_text}</pre></details>}
      {candidate?.outcomes?.filter(outcome => outcome.status !== 'planned').map(outcome => <section key={outcome.problem_key}><h3>{problemLabel(outcome.problem_key)}</h3>{draft.value.directions[outcome.problem_key] && <p>你的方向：{draft.value.directions[outcome.problem_key]}</p>}<Tag color={outcome.status === 'planned' ? 'blue' : 'orange'}>{{ planned: '拟落实', needs_choice: '需要你选择', unresolved: '未能解决' }[outcome.status]}</Tag><p>{readable(outcome.reason)}</p>{!!(outcome.choices || []).length && <Space wrap>{outcome.choices?.map(choice => <Button key={choice} disabled={applying} onClick={() => {
        const sound = choice === '声音由后期添加' ? 'postproduction' : choice === '使用支持声音的模型同期生成' ? 'generated' : ''
        const saved = directions.some(row => revisionIssueKey(row, row.finding_index) === outcome.problem_key) ? draft.update({ directions: { ...draft.value.directions, [outcome.problem_key]: [draft.value.directions[outcome.problem_key], choice].filter(Boolean).join('；') }, soundChoices: { ...draft.value.soundChoices, [outcome.problem_key]: sound } })
        : draft.update({ instruction: [draft.value.instruction, choice].filter(Boolean).join('；'), ...(sound ? { fieldValues: { ...draft.value.fieldValues, 'design:/sound/execution': sound } } : {}) })
        if (saved && sound === 'generated') props.onPrepare()
      }}>{choice}</Button>)}</Space>}</section>)}
      {candidate && <details><summary>技术详情</summary><pre>{JSON.stringify(candidate, null, 2)}</pre></details>}
      {fieldsError && !fieldEditorOpen && !!Object.keys(draft.value.fieldValues).length && <Alert type="warning" message="可编辑内容读取失败，已填写内容保留。请展开直接编辑后重试读取。" />}
      {draft.error && <Alert type="error" message={draft.error} />}
      {error && <Alert type="error" message={error} />}
      {(progress || applying) && <p role="status">{progress || '采用结果待核实，继续处理将恢复原请求。'}</p>}
      {disabled && <Alert type="warning" message="先处理工作区未保存或已过期的输入，再继续采用。" />}
      {task?.revision_application?.stage === 'blocked' && !busy && <Button onClick={reviseAgain}>保留版本，重新调整方向</Button>}
      {candidate && !candidate.changes?.length && <p>本次没有可执行的变化，不会创建新版本。请核对要求或返回当前指令。</p>}
      {candidate && !canApply && !!candidate.changes?.length && <p>仍有必要选择、无法执行的问题或未完成的指令预览，请核对后更新方案。</p>}
      <div className="review-revision-actions">{(applying || canApply && !stale) && <Button type="primary" loading={busy} disabled={disabled || (!applying && (!canApply || stale || !!draft.error))} onClick={() => { void apply() }}>{applying ? revisionRecoveryLabel(task?.revision_application) : '采用并重新检查'}</Button>}</div>
      <small>采用后生成新版本并重新检查；检查通过前不会标记为已解决，也不会自动拍摄。</small>
    </section>
}
