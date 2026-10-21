import { createPortal } from 'react-dom'
import { useEffect, useRef, useState } from 'react'
import { Alert, Input, Select, Spin } from 'antd'
import { ApiError, LlmService, StudioDirectingService } from '../../../services/generated'
import type { ModelRead, SceneUnitDesignBlocker, SceneUnitDesignRequest_Input as SceneUnitDesignRequest, SceneUnitDesignSuggestionRead, SceneVersionContent_Output, VideoGenerationOptionsRead, VideoReferenceCapabilities } from '../../../services/generated'
import { HistoryOutlined } from '@ant-design/icons'
import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { WorkbenchButton, WorkbenchIconButton } from './ui/WorkbenchButton'
import { WorkbenchModal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { CanvasTextPreview } from './CanvasTextPreview'
import { directingError } from './common'

const terminal = ['succeeded', 'failed', 'cancelled']
const statuses: Record<string, string> = { queued: '等待执行', running: '执行中', succeeded: '已生成', failed: '失败', cancelled: '已取消' }

/** 组织建议与场次编辑分开；结果未明确应用前，不创建任何正式单元。 */
export function SceneUnitDesignSuggestions({ projectId, sequenceId, versionId, revision, content, shotId, unitId, disabled, focusTaskId, triggerHost, onFocused, onChange, onLocateBlocker }: {
  onLocateBlocker: (blocker: SceneUnitDesignBlocker) => void
  onChange: (content: SceneVersionContent_Output) => void
  triggerHost?: HTMLElement | null
  projectId: string; sequenceId: string; versionId: string; revision: number
  content: SceneVersionContent_Output; shotId?: string; unitId?: string; disabled: boolean; focusTaskId?: string; onFocused?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [recordsOpen, setRecordsOpen] = useState(!!focusTaskId)
  const [models, setModels] = useState<ModelRead[]>()
  const [modelId, setModelId] = useState<string>()
  const [modelsError, setModelsError] = useState('')
  const [options, setOptions] = useState<VideoGenerationOptionsRead>()
  const [capabilities, setCapabilities] = useState<VideoReferenceCapabilities>()
  const [capabilityError, setCapabilityError] = useState('')
  const [instruction, setInstruction] = useState('')
  const [rows, setRows] = useState<SceneUnitDesignSuggestionRead[]>()
  const [selectedId, setSelectedId] = useState<string | undefined>(focusTaskId)
  const [preparing, setPreparing] = useState(!focusTaskId)
  const [error, setError] = useState('')
  const [readError, setReadError] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [blockers, setBlockers] = useState<SceneUnitDesignBlocker[]>([])
  const [previewReady, setPreviewReady] = useState(false)
  const [previewRetryable, setPreviewRetryable] = useState(false)
  const [previewAttempt, setPreviewAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [capabilityAttempt, setCapabilityAttempt] = useState(0)
  const pending = useRef<SceneUnitDesignRequest>()
  const storageKey = `jellyfish:scene-unit-design-request:${projectId}:${sequenceId}:${versionId}`
  const shot = content.design.direction.shots.find(row => row.id === shotId)
  const sourceUnit = content.units.find(row => row.id === unitId && row.coverage.every(item => item.shot_id === shotId))
  const needsSource = content.units.some(row => row.coverage.every(item => item.shot_id === shotId))
  const live = useRef({ content, shotId, unitId, disabled, revision })
  live.current = { content, shotId, unitId, disabled, revision }
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const readPending = () => {
    const raw = localStorage.getItem(storageKey)
    if (!raw) return undefined
    const request = JSON.parse(raw) as SceneUnitDesignRequest
    if (!request.request_id || !request.shot_id || !request.target_model_id || !request.content?.design) throw new Error('原单元设计请求凭据无法读取，请恢复存储后重试')
    return request
  }
  const clearPending = (id: string) => {
    if (readPending()?.request_id === id) localStorage.removeItem(storageKey)
    if (pending.current?.request_id === id) pending.current = undefined
  }
  useEffect(() => {
    if (!open) return
    let active = true
    setModels(undefined); setModelsError('')
    void Promise.all([
      LlmService.listModelsApiV1LlmModelsGet({ category: 'video', pageSize: 100 }),
      LlmService.getModelSettingsApiV1LlmModelSettingsGet(),
    ]).then(([list, settings]) => {
      if (!list.data || !settings.data) throw new Error('视频模型与全局默认设置尚未核实')
      if (!active) return
      setModels(list.data.items)
      const globalDefault = sourceUnit ? sourceUnit.model_id : settings.data.default_video_model_id
      setModelId(current => list.data!.items.some(row => row.id === current) ? current
        : list.data!.items.some(row => row.id === globalDefault) ? globalDefault || undefined : undefined)
    }).catch(cause => { if (active) setModelsError(directingError(cause)) })
    return () => { active = false }
  }, [open, projectId, attempt, sourceUnit?.id])
  useEffect(() => {
    let active = true
    setOptions(undefined); setCapabilities(undefined); setCapabilityError('')
    if (open && modelId) void Promise.all([
      LlmService.getVideoGenerationOptionsApiV1LlmVideoGenerationOptionsGet({ modelId }),
      StudioDirectingService.directingReferenceCapabilities({ projectId, modelId }),
    ]).then(([settings, references]) => {
      if (!settings.data || settings.data.model_id !== modelId || !settings.data.allowed_ratios?.length || !references.data || references.data.model_id !== modelId) throw new Error('必要视频模型能力尚未核实')
      if (active) { setOptions(settings.data); setCapabilities(references.data) }
    }).catch(cause => { if (active) setCapabilityError(directingError(cause)) })
    return () => { active = false }
  }, [open, projectId, modelId, capabilityAttempt])
  useEffect(() => {
    if (!open && !recordsOpen) return
    let active = true, timer: ReturnType<typeof setTimeout> | undefined
    const read = async () => {
      try {
        pending.current = readPending()
        const response = await StudioDirectingService.directingSceneUnitDesignSuggestions({ projectId, sequenceId, versionId })
        if (!response.data) throw new Error('单元设计任务尚未核实')
        if (!active) return
        setRows(response.data); setReadError(''); setSelectedId(current => current || response.data?.[0]?.task_id)
        const matching = response.data.find(row => row.request_id === pending.current?.request_id)
        if (matching) { clearPending(matching.request_id); setSelectedId(matching.task_id); setPreparing(false) }
        if (response.data.some(row => !terminal.includes(row.status))) timer = setTimeout(() => void read(), 1500)
      } catch (cause) { if (active) setReadError(directingError(cause)) }
    }
    void read()
    return () => { active = false; clearTimeout(timer) }
  }, [open, recordsOpen, projectId, sequenceId, versionId, attempt])
  useEffect(() => {
    if (focusTaskId) { setSelectedId(focusTaskId); setPreparing(false); setOpen(false); setRecordsOpen(true); onFocused?.() }
  }, [focusTaskId])
  const selected = preparing ? undefined : rows?.find(row => row.task_id === selectedId)
  useEffect(() => {
    let active = true
    setPreviewError(''); setBlockers([]); setPreviewReady(false)
    if (open && selected?.result) void StudioDirectingService.directingSceneUnitDesignPreview({ projectId, sequenceId, versionId,
      taskId: selected.task_id, requestBody: { content } }).then(response => {
        if (!response.data) throw new Error('预览尚未核实')
        if (active) { setBlockers(response.data.blockers || []); setPreviewReady(true) }
      }).catch(cause => { if (active) { setPreviewError(directingError(cause)); setPreviewRetryable(!(cause instanceof ApiError) || cause.status >= 500 || cause.status === 408) } })
    return () => { active = false }
  }, [open, projectId, sequenceId, versionId, selected?.task_id, selected?.status, content, previewAttempt])
  const context = useRef({ unitId, shotId })
  useEffect(() => {
    if (context.current.unitId !== unitId || context.current.shotId !== shotId) {
      setModelId(undefined); context.current = { unitId, shotId }
    }
  }, [unitId, shotId])
  const running = rows?.some(row => !terminal.includes(row.status))
  const verified = !!modelId && options?.model_id === modelId && capabilities?.model_id === modelId
  const submit = async () => {
    if (busy || live.current.disabled || !pending.current && (!verified || !live.current.shotId)) return
    const request = pending.current || { request_id: crypto.randomUUID(), expected_revision: live.current.revision,
      content: structuredClone(live.current.content), shot_id: live.current.shotId!, source_unit_id: sourceUnit?.id, target_model_id: modelId!, instruction }
    setBusy(true); setError('')
    try {
      localStorage.setItem(storageKey, JSON.stringify(request)); pending.current = request
      const response = await StudioDirectingService.directingSceneUnitDesignSuggest({ projectId, sequenceId, versionId, requestBody: request })
      if (!response.data) throw new Error('原提交结果尚未核实')
      if (!mounted.current) return
      clearPending(request.request_id); setSelectedId(response.data.task_id); setPreparing(false); setAttempt(value => value + 1)
    } catch (cause) {
      if (!mounted.current) return
      const rejected = cause instanceof ApiError && cause.status >= 400 && cause.status < 500 && cause.status !== 408
      if (rejected) clearPending(request.request_id)
      setError(rejected ? directingError(cause) : `提交未核实，保留原请求：${directingError(cause)}`)
    } finally { if (mounted.current) setBusy(false) }
  }
  const apply = async () => {
    if (!selected?.result || busy || live.current.disabled || previewError || !previewReady || blockers.length) return
    const snapshot = live.current.content
    setBusy(true); setError('')
    try {
      const response = await StudioDirectingService.directingSceneUnitDesignApply({ projectId, sequenceId, versionId,
        taskId: selected.task_id, requestBody: { content: snapshot } })
      if (!response.data) throw new Error('应用结果尚未核实')
      if (!mounted.current) return
      if (live.current.disabled || live.current.content !== snapshot) throw new Error('确认期间编辑已变化，请重新核对并确认方案')
      onChange(response.data); setOpen(false)
    } catch (cause) { if (mounted.current) setError(directingError(cause)) }
    finally { if (mounted.current) setBusy(false) }
  }
  const fixedRequest = pending.current || selected?.request
  const displayShot = fixedRequest ? fixedRequest.content.design.direction?.shots?.find(row => row.id === fixedRequest.shot_id) : shot
  const displayUnitId = fixedRequest ? fixedRequest.source_unit_id : sourceUnit?.id
  const resultContent = selected && <section aria-label="单元设计建议预览">
        <p role="status">{statuses[selected.status] || selected.status}</p>
        <details><summary>固定依据与模型</summary>
          <p>视频模型：{selected.target_model_name}；组织文本模型：{selected.text_model_name}</p>
          <CanvasTextPreview text={selected.request.content.basis.text} label="固定原文依据" lines={4} />
          <p>本次要求{!selected.request.instruction && '：未填写'}</p>
          {selected.request.instruction && <CanvasTextPreview text={selected.request.instruction} label="本次要求" lines={4} />}
          <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(selected.capabilities, null, 2)}</pre>
        </details>
        {selected.error && <Alert type="error" message={selected.error} />}
        {!terminal.includes(selected.status) && <p>任务在后台执行，可关闭后稍后查看。</p>}
        {selected.result && <>
          {open && previewError && <Alert type="warning" message={previewError} description={previewRetryable ? '原结果保留，可重新核对预览，不会提交新的设计任务。' : '保留本次结果供查看，请按当前内容重新设计。'} />}
          {open && previewError && previewRetryable && <WorkbenchButton onClick={() => setPreviewAttempt(value => value + 1)}>重新核对预览</WorkbenchButton>}
          {open && !!blockers.length && <Alert type="warning" message="移除存在引用，处理前不能确认" description={<ul>{blockers.map(blocker => <li key={blocker.path}>
            {blocker.unit_id} / {blocker.coverage_item_id} · {blocker.path}
            <WorkbenchButton onClick={() => { setOpen(false); onLocateBlocker(blocker) }}>定位并处理引用</WorkbenchButton>
          </li>)}</ul>} />}
          {selected.request.content.units.filter(unit => unit.coverage.every(item => item.shot_id === selected.result!.shot_id)
            && !selected.result!.units.some(row => row.id === unit.id)).map(unit => <section key={unit.id} aria-label={`移除单元 ${unit.id}`}>
              <h4>移除 · {unit.id}</h4><p>原执行范围：{unit.coverage.map(item => item.action_scope).join('；')}</p>
              <p>历史任务、检查和素材保留原依据；运行任务继续，完成后登记原任务候选。移除后不能按原依据发起新重试。</p>
            </section>)}
          <h3>单元方案预览</h3><p>{selected.result.organization}</p>
          {!!selected.result.missing?.length && <Alert type="warning" message="方案准备缺项" description={<ul>{selected.result.missing?.map((item, index) => <li key={index}>{item}</li>)}</ul>} />}
          {selected.result.units.map((unit, index) => {
            const previous = selected.request.content.units.find(row => row.id === unit.id)
            const inherited = previous || selected.request.content.units.find(row => row.id === selected.request.source_unit_id)
            const changed = previous && (unit.operation === 'modify' || JSON.stringify(previous.coverage) !== JSON.stringify(unit.coverage)
              || previous.duration_ms !== unit.duration_ms || previous.ratio !== unit.ratio
              || ['entry_state', 'exit_state', 'reference_requirements'].some(field => {
                const key = field as 'entry_state' | 'exit_state' | 'reference_requirements'
                return unit[key] != null && JSON.stringify(unit[key]) !== JSON.stringify(previous.organization?.[key] ?? (key === 'reference_requirements' ? [] : ''))
              }))
            return <section key={unit.id} aria-label={`建议单元 ${index + 1}`}>
            <h4>{previous ? changed ? '修改' : '保留' : '新增'} · {unit.id}</h4><p>{unit.reason}</p>
            {changed && <p>原执行范围：{previous.coverage.map(item => item.action_scope).join('；')}</p>}
            <p>视频模型：{previous && !changed ? previous.model_id || '待选择' : selected.target_model_name}</p>
            {unit.coverage.map(item => <div key={item.id}><p>{item.action_scope}</p>
              <p>覆盖选择：{[...item.beat_ids, ...item.event_ids, ...item.performance_action_ids, ...item.staging_activity_ids, ...item.continuity_change_ids].join('、') || '镜头可见内容'}</p></div>)}
            <p>{unit.ratio} · {unit.duration_ms == null ? '预计时长待确定' : `${unit.duration_ms / 1000} 秒`}</p>
            {!previous && inherited && <><p>继承来源：{inherited.id}</p><details><summary>继承的准备输入</summary>
              <p style={{ overflowWrap: 'anywhere' }}>参数：{JSON.stringify(inherited.parameters)}</p>
              <p>真实参考：{inherited.references.map(reference => `${reference.file_id}（${reference.input_role}）`).join('；') || '尚未绑定'}</p>
              <p>历史依赖：{[...inherited.dependencies.map(link => `${link.plan_revision_id} / ${link.unit_id}`),
                ...inherited.scene_dependencies.map(link => `${link.version_id} / ${link.clip_id}`)].join('；') || '无'}</p>
              <CanvasTextPreview text={inherited.instruction} label="来源指令正文" lines={4} />
              <p>来源正文保留；指令依据与检查需要重新确认。</p>
            </details></>}
            <p>进入：{(unit.entry_state ?? inherited?.organization?.entry_state) || '未填写'}；结束：{(unit.exit_state ?? inherited?.organization?.exit_state) || '未填写'}</p>
            {!!(unit.reference_requirements ?? inherited?.organization?.reference_requirements)?.length && <p>参考需求：{(unit.reference_requirements ?? inherited?.organization?.reference_requirements)?.join('；')}</p>}
            {!!unit.missing?.length && <ul>{unit.missing?.map((item, number) => <li key={number}>{item}</li>)}</ul>}
          </section>})}
          <Alert type="info" message={open ? "尚未应用到当前编辑；确认后沿用当前保存模式。参考需求不代表已绑定真实素材，设计完成不代表拍摄准备通过。" : "以下为生成时的方案记录。参考需求不代表已绑定真实素材，设计完成不代表拍摄准备通过。"} />
        </>}
      </section>
  const recordSelector = !!rows?.length && <Select aria-label="单元设计记录" style={{ width: '100%' }} value={selected?.task_id} placeholder="查看本版本的设计记录"
    options={rows.map(row => ({ value: row.task_id, label: `${row.request.shot_id} · ${statuses[row.status] || row.status}` }))}
    onChange={id => { setSelectedId(id); setPreparing(false) }} />
  const trigger = <><WorkbenchButton disabled={disabled || !shot} onClick={() => setOpen(true)}>AI设计</WorkbenchButton>
    <WorkbenchIconButton label="单元设计记录" icon={<HistoryOutlined />} onClick={() => { setOpen(false); setPreparing(false); setSelectedId(current => current || rows?.[0]?.task_id); setRecordsOpen(true) }} /></>
  return <>
    {triggerHost ? createPortal(trigger, triggerHost) : trigger}
    <WorkbenchDetails open={recordsOpen} title="单元设计记录" status="只读" initialExpanded onClose={() => setRecordsOpen(false)}>
      {readError && <Alert type="error" message={readError} action={<WorkbenchButton onClick={() => setAttempt(value => value + 1)}>重试读取</WorkbenchButton>} />}
      {!rows && !readError && <p role="status"><Spin size="small" /> 正在读取单元设计记录</p>}
      {rows?.length === 0 && <p>暂无单元设计记录</p>}
      {recordSelector}
      {resultContent}
      {selected && <WorkbenchButton onClick={() => { setRecordsOpen(false); setOpen(true) }}>比较并应用方案</WorkbenchButton>}
    </WorkbenchDetails>
    <WorkbenchModal title="AI设计" open={open} onCancel={() => setOpen(false)} footer={<WorkbenchDialogActions
      secondary={<WorkbenchButton variant="quiet" onClick={() => setOpen(false)}>{selected ? '关闭预览' : '取消'}</WorkbenchButton>}>
      {pending.current ? <WorkbenchButton variant="primary" loading={busy} disabled={busy || disabled} onClick={() => void submit()}>核实原设计请求</WorkbenchButton>
        : selected ? <><WorkbenchButton disabled={busy || disabled || running} onClick={() => { setPreparing(true); setError('') }}>重新设计</WorkbenchButton>{selected.result && <WorkbenchButton variant="primary" loading={busy} disabled={busy || disabled || !!previewError || !previewReady || !!blockers.length} onClick={() => void apply()}>确认应用方案</WorkbenchButton>}</>
          : <WorkbenchButton variant="primary" loading={busy} disabled={disabled || busy || !shot || needsSource && !sourceUnit || !verified || !rows || !!readError || running} onClick={() => void submit()}>开始设计</WorkbenchButton>}
    </WorkbenchDialogActions>}>
      <p>当前镜头：{displayShot?.visible_result.text || (displayShot ? displayShot.id : '请先选择有效镜头')}</p>
      {displayUnitId && <p>所选单元：{displayUnitId}</p>}
      {!displayUnitId && needsSource && <Alert type="warning" message="请先在单元画布明确选择本次来源或目标单元" />}
      <p>按既有六岗设计组织生产单元，生成结果供查看。创作内容变化请先到导演画布处理。</p>
      {(error || readError) && <Alert type="error" message={error || readError} action={<WorkbenchButton variant="quiet" onClick={() => setAttempt(value => value + 1)}>重试读取</WorkbenchButton>} />}
      {pending.current && <Alert type="info" message="原提交尚未核实，请先核实原请求，避免重复生成" />}
      {recordSelector}
      {!selected && <>
        <label htmlFor="unit-design-video-model">目标视频模型</label>
        <Select id="unit-design-video-model" aria-label="目标视频模型" style={{ width: '100%' }} loading={!models && !modelsError} value={modelId}
          placeholder="请选择视频模型" options={models?.map(row => ({ value: row.id, label: row.name }))} disabled={busy || !!pending.current}
          onChange={id => setModelId(id)} />
        <p>此处选择拍摄视频模型；组织方案使用全局文本模型，本次选择不修改全局设置。</p>
        {modelsError && <Alert type="error" message={modelsError} action={<WorkbenchButton onClick={() => setAttempt(value => value + 1)}>重试模型读取</WorkbenchButton>} />}
        {capabilityError ? <Alert type="error" message={`模型能力核实失败：${capabilityError}`} action={<WorkbenchButton onClick={() => setCapabilityAttempt(value => value + 1)}>重试能力核实</WorkbenchButton>} />
          : modelId && !verified ? <p role="status"><Spin size="small" /> 正在核实视频模型能力</p>
            : verified ? <><p role="status">视频模型能力已核实</p><p>可用画幅：{options?.allowed_ratios?.join('、')}；参考范围：{capabilities?.frame_roles.join('、') || '无帧参考'}。未知时长或参考条件保留缺项。</p></> : <p>没有有效默认视频模型时，请明确选择。</p>}
        <label htmlFor="unit-design-instruction">本次要求（可选）</label>
        <Input.TextArea id="unit-design-instruction" autoSize={{ minRows: 3, maxRows: 6 }} value={instruction} disabled={busy || !!pending.current} onChange={event => setInstruction(event.target.value)} />
      </>}
      {resultContent}
    </WorkbenchModal>
  </>
}
