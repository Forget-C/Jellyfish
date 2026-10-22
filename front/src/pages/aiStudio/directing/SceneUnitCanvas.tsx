import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { createPortal } from 'react-dom'
import { SceneUnitPreparationStatus } from './SceneUnitPreparationStatus'
import type { ScenePreparationIssue } from './useSceneUnitPreparation'
import { useSceneUnitPreparation } from './useSceneUnitPreparation'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, InputNumber, Select, Spin } from 'antd'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, CanvasTarget, UnitCanvasGraph, UnitReferencesCanvasNode, SceneUnitDesignBlocker, EditableGenerationUnit_Output, ModelRead, SceneVersionContent_Output, WorkspaceRead } from '../../../services/generated'
import { UnitGraphCanvas } from './UnitGraphCanvas'
import { SceneFrameDependencies } from './SceneFrameDependencies'
import { DependencyEditor } from './DependencyEditor'
import { ReferencePicker } from './ReferencePicker'
import { directingError } from './common'
import { sceneContentKey } from './sceneContentKey'
import { SourceLinks } from './Sources'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { WorkbenchModal, WorkbenchDialogActions } from './ui/WorkbenchModal'
import { SceneUnitDesignSuggestions } from './SceneUnitDesignSuggestions'
import { SceneInstructionSuggestions } from './SceneInstructionSuggestions'
import { UnitScopeSummary } from './UnitScopeSummary'

type SceneUnitCanvasProps = {
  onLocateDesign: (target: CanvasTarget) => void
  onLocateBlocker: (blocker: SceneUnitDesignBlocker) => void
  onUnitDesignFocused?: () => void
  unitDesignTaskId?: string
  saveStatus: string
  preparationHost: HTMLElement | null
  graphState: { current: boolean; pending: boolean; error: string; retry: () => void }
  primaryHost: HTMLElement | null
  graph: UnitCanvasGraph
  saved: SceneVersionContent_Output
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; shotId?: string; unitId?: string; disabled: boolean
  onOpenEdit: (clipId: string) => void
  onOpenInstruction: (taskId?: string) => void
  onInstructionTask: (taskId: string, unitId: string) => void
  onSelectUnit: (id: string, shotId?: string) => void; onChange: (content: SceneVersionContent_Output) => void
  focusRequest?: { versionId: string; unitId: string; nodeId: string; fieldId: string; serial: number }
}

/** 图不可用时保留父工作台的编辑状态，不回退前端拼图。 */
export function SceneUnitCanvas(props: SceneUnitCanvasProps) {
  const graph = props.graph
  if (!graph || graph.kind !== 'units' || graph.version_id !== props.versionId ||
    graph.revision !== props.revision || !Array.isArray(graph.nodes) || !Array.isArray(graph.views) ||
    graph.views.filter(view => view.parent_id == null).length !== 1) {
    return <Alert type="error" message="单元图数据与当前版本不一致；当前编辑内容已保留" />
  }
  return <SceneUnitCanvasBody {...props} />
}

/** 单元和设计共用一份可编辑方案；画布浏览不创建单元，也不选择替代对象。 */
function SceneUnitCanvasBody({ preparationHost, graphState, primaryHost, graph, saved, projectId, sequenceId, versionId, revision, content, unitId, disabled, saveStatus, onSelectUnit, onChange, focusRequest, onOpenInstruction, onInstructionTask, onOpenEdit, unitDesignTaskId, onUnitDesignFocused, onLocateBlocker, onLocateDesign }: SceneUnitCanvasProps) {
  const [browseShotId, setBrowseShotId] = useState<string>()
  const [creationOpen, setCreationOpen] = useState(false)
  const [creationShotId, setCreationShotId] = useState<string>()
  const [unavailableTarget, setUnavailableTarget] = useState(false)
  const [focusTarget, setFocusTarget] = useState<{ nodeId: string; fieldId: string; serial: number }>()
  const [models, setModels] = useState<ModelRead[]>()
  const [modelsError, setModelsError] = useState('')
  const [assets, setAssets] = useState<AssetSummary[]>()
  const [assetError, setAssetError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [settingsUnitId, setSettingsUnitId] = useState<string>()
  const [settingsSection, setSettingsSection] = useState<'coverage' | 'generation' | 'organization'>('coverage')
  const [coverageSelection, setCoverageSelection] = useState<string>()
  const [organizationReason, setOrganizationReason] = useState('')
  const openSettings = (id?: string, section: typeof settingsSection = 'coverage', coverageId?: string) => {
    if (id !== settingsUnitId) setOrganizationReason('')
    setSettingsUnitId(id); setSettingsSection(section); setCoverageSelection(coverageId)
  }
  const showSettings = (section: typeof settingsSection) => settingsSection === section
  const [basisUnitId, setBasisUnitId] = useState<string>()
  const [referenceUnitId, setReferenceUnitId] = useState<string>()
  const [picker, setPicker] = useState<UnitReferencesCanvasNode>()
  const [dependencyUnitId, setDependencyUnitId] = useState<string>()
  const [workspace, setWorkspace] = useState<WorkspaceRead>()
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const allUnits = content.units || []
  const unit = allUnits.find(row => row.id === unitId)
  const basis = graph.nodes.find(node => node.kind === 'unit_basis' && node.unit_id === basisUnitId)
  const { capability, capabilityError, frameEvidence, missing, checking, failed } = useSceneUnitPreparation(projectId, sequenceId, versionId, revision, content, unit, attempt, { ...graphState, graph })
  const consumedFocus = useRef<number>()
  const preparationLocator = useRef<(issue: ScenePreparationIssue) => void>()
  useEffect(() => {
    if (focusRequest?.serial !== consumedFocus.current && focusRequest?.versionId === versionId && focusRequest.unitId === unit?.id) {
      consumedFocus.current = focusRequest.serial
      preparationLocator.current?.({ message: '', fieldId: focusRequest.fieldId, nodeId: focusRequest.nodeId })
    }
  }, [focusRequest, versionId, unit?.id])
  useEffect(() => {
    let active = true
    void LlmService.listModelsApiV1LlmModelsGet({ category: 'video', pageSize: 100 }).then(result => {
      if (!result.data) throw new Error('模型列表尚未核实')
      if (active) { setModels(result.data.items); setModelsError('') }
    }).catch(error => { if (active) setModelsError(directingError(error)) })
    void StudioDirectingService.directingAssets({ projectId }).then(result => {
      if (!result.data) throw new Error('项目资产尚未核实')
      if (active) { setAssets(result.data); setAssetError('') }
    }).catch(error => { if (active) setAssetError(directingError(error)) })
    return () => { active = false }
  }, [projectId, attempt])
  useEffect(() => {
    if (!dependencyUnitId || !unit?.dependencies.length) return
    let active = true
    setWorkspaceLoading(true)
    void StudioDirectingService.directingWorkspace({ projectId, sequenceId }).then(result => {
      if (!result.data) throw new Error('来源单元尚未核实')
      if (active) { setWorkspace(result.data); setWorkspaceError('') }
    }).catch(error => { if (active) setWorkspaceError(directingError(error)) })
      .finally(() => { if (active) setWorkspaceLoading(false) })
    return () => { active = false }
  }, [projectId, sequenceId, dependencyUnitId, unit?.dependencies.length, attempt])
  const patch = (changes: Partial<EditableGenerationUnit_Output>) => {
    if (!unit || disabled) return
    onChange({ ...content, units: allUnits.map(row => row.id === unit.id ? { ...row, ...changes } : row) })
  }
  const create = (targetShotId: string) => {
    const shot = content.design.direction.shots.find(row => row.id === targetShotId)
    if (!shot || disabled) return
    const id = crypto.randomUUID(), coverageId = crypto.randomUUID()
    onChange({ ...content, units: [...allUnits, { id,
      coverage: [{ id: coverageId, shot_id: shot.id, beat_ids: [], event_ids: [], staging_activity_ids: [], performance_action_ids: [], continuity_change_ids: [], action_scope: '' }],
      references: [], model_id: null, duration_ms: null, ratio: content.output_aspect_ratio,
      organization: null, parameters: {}, capability: { multi_shot: 'unknown' }, dependencies: [], scene_dependencies: [], instruction: '', instruction_source: null, instruction_basis_id: null, instruction_check_task_id: null,
    }] })
    onSelectUnit(id, shot.id)
    openSettings(id, 'coverage', coverageId)
    setCreationOpen(false)
  }
  const locateIssue = (issue: ScenePreparationIssue) => {
    if (!unit) return
    if (issue.target?.external) { onLocateDesign(issue.target); return }
    const node = graph.nodes.find(row => row.id === (issue.target?.node_id || issue.nodeId))
    const fieldId = issue.fieldId
    if (node?.kind === 'unit_references') setPicker(node)
    else if (fieldId === 'scene-unit-references') setReferenceUnitId(unit.id)
    else if (fieldId === 'scene-unit-dependencies' || node?.kind === 'unit_config' && node.config_kind === 'dependencies') setDependencyUnitId(unit.id)
    else if (node?.kind === 'unit_config' && node.config_kind !== 'dependencies') openSettings(unit.id, node.config_kind, node.coverage_item_id || undefined)
    else {
      const coverage = unit.coverage.find(item => fieldId === `scene-unit-action-${item.id}`)
      if (coverage) openSettings(unit.id, 'coverage', coverage.id)
      else if (fieldId.startsWith('scene-unit-organization-')) openSettings(unit.id, 'organization')
      else if (fieldId === 'scene-unit-basis') setBasisUnitId(unit.id)
      else openSettings(unit.id, 'generation')
    }
    const focusField = node?.kind === 'unit_config' && node.config_kind === 'organization' && !fieldId.startsWith('scene-unit-')
      ? `scene-unit-organization-${unit.id}-${fieldId}` : fieldId
    setFocusTarget({ nodeId: issue.target?.node_id || issue.nodeId || '', fieldId: focusField, serial: Date.now() })
  }
  // 当前编辑变化不重复执行旧定位请求，避免输入期间抢回焦点。
  preparationLocator.current = locateIssue
  const retryPreparation = () => { setAttempt(value => value + 1); graphState.retry(); frameEvidence.reload() }
  const settings =       <>
          {!unit ? <p>明确选择单元后编辑；浏览不创建数据。</p> : <>
          <p>单元 {allUnits.indexOf(unit) + 1} · 当前场次版本</p>
          {showSettings('coverage') && unit.coverage.map((item, index) => {
            if (settingsSection === 'coverage' && item.id !== coverageSelection) return null
            const sourceShot = content.design.direction.shots.find(row => row.id === item.shot_id)
            const update = (changes: Partial<typeof item>) => patch({ coverage: unit.coverage.map(row => row.id === item.id ? { ...row, ...changes } : row) })
            const scopedToOccurrence = (kind: string, id: string, fields: string[]) => content.design.applicability.filter(row =>
              row.subject.kind === kind && row.subject.id === id && fields.includes(row.subject.field) && row.purpose === 'design')
              .some(row => row.scope === 'shots' ? (row.shot_ids || []).includes(item.shot_id) :
                row.scope === 'occurrences' && (row.occurrences || []).some(target => target.unit_id === unit.id && target.coverage_item_id === item.id))
            const activityFields = ['ongoing_task', 'path', 'entrances_exits', 'end_state']
            const performanceFields = ['physical_action', 'gaze', 'breath', 'weight', 'hands', 'voice', 'delivery', 'reaction_order']
            return <section key={item.id} aria-label={`覆盖 ${index + 1}`}>
              <h3>覆盖 {index + 1} · {sourceShot ? `镜头 ${content.design.direction.shots.indexOf(sourceShot) + 1}` : '原镜头不可用'}</h3>
              <p>{sourceShot?.visible_result.text || '镜头可见结果尚未填写'}</p>
              <label>所属镜头<Select aria-label={`覆盖 ${index + 1} 所属镜头`} disabled={disabled} value={item.shot_id} style={{ width: '100%' }}
                options={content.design.direction.shots.map((row, i) => ({ value: row.id, label: `镜头 ${i + 1}：${row.visible_result.text || '未填写'}` }))}
                onChange={shot_id => {
                  const next = content.design.direction.shots.find(row => row.id === shot_id)
                  if (!next) return
                  update({ shot_id, beat_ids: item.beat_ids.filter(id => next.beat_ids.includes(id)), event_ids: item.event_ids.filter(id => next.event_ids.includes(id)),
                    staging_activity_ids: [], performance_action_ids: [], continuity_change_ids: [] })
                  onSelectUnit(unit.id, shot_id)
                }} /></label>
              <p>修改来源镜头会清除不属于新镜头的节拍和事件关联；动作范围保留，请重新核对。</p>
              <label>动作范围<Input.TextArea id={`scene-unit-action-${item.id}`} aria-label={index ? `覆盖 ${index + 1} 动作范围` : '单元动作范围'} disabled={disabled} value={item.action_scope}
                onChange={event => update({ action_scope: event.target.value })} /></label>
              <label>覆盖节拍<Select aria-label={`覆盖 ${index + 1} 节拍`} mode="multiple" disabled={disabled || !sourceShot} value={item.beat_ids} style={{ width: '100%' }}
                options={content.design.direction.beats.flatMap((beat, i) => sourceShot?.beat_ids.includes(beat.id) ? [{ value: beat.id, label: `节拍 ${i + 1}：${beat.objective.text || '未填写目标'}` }] : [])}
                onChange={beat_ids => update({ beat_ids })} /></label>
              <label>覆盖事件<Select aria-label={`覆盖 ${index + 1} 事件`} mode="multiple" disabled={disabled || !sourceShot} value={item.event_ids} style={{ width: '100%' }}
                options={content.design.events.flatMap((event, i) => sourceShot?.event_ids.includes(event.id) ? [{ value: event.id, label: `事件 ${i + 1}：${event.description.text || '未填写事件'}` }] : [])}
                onChange={event_ids => update({ event_ids })} /></label>
              <p>镜头关联只提供候选；下列项目由本单元明确选择，不自动加入拍摄要求。</p>
              <label>镜内活动<Select aria-label={`覆盖 ${index + 1} 镜内活动`} mode="multiple" disabled={disabled || !sourceShot} value={item.staging_activity_ids} style={{ width: '100%' }}
                options={content.design.staging.activities.flatMap((activity, i) => activity.id && scopedToOccurrence('staging_activity', activity.id, activityFields)
                  ? [{ value: activity.id, label: `活动 ${i + 1}：${activity.ongoing_task.text || activity.path.text || '未填写动作'}` }] : [])}
                onChange={staging_activity_ids => update({ staging_activity_ids })} /></label>
              <label>表演行动<Select aria-label={`覆盖 ${index + 1} 表演行动`} mode="multiple" disabled={disabled || !sourceShot} value={item.performance_action_ids} style={{ width: '100%' }}
                options={content.design.performance.beats.flatMap((action, i) => action.id && sourceShot?.beat_ids.includes(action.beat_id) &&
                  (!content.design.applicability.some(row => row.subject.kind === 'performance_beat' && row.subject.id === action.id && performanceFields.includes(row.subject.field)) || scopedToOccurrence('performance_beat', action.id, performanceFields))
                  ? [{ value: action.id, label: `行动 ${i + 1}：${action.physical_action.text || '未填写动作'}` }] : [])}
                onChange={performance_action_ids => update({ performance_action_ids })} /></label>
              <label>可见连续性变化<Select aria-label={`覆盖 ${index + 1} 可见连续性变化`} mode="multiple" disabled={disabled || !sourceShot} value={item.continuity_change_ids} style={{ width: '100%' }}
                options={content.design.continuity.flatMap((change, i) => scopedToOccurrence('continuity', change.id, ['change'])
                  ? [{ value: change.id, label: `变化 ${i + 1}：${change.change.text || '未填写变化'}` }] : [])}
                onChange={continuity_change_ids => update({ continuity_change_ids })} /></label>
              <p>参与对象：{sourceShot?.participant_ids == null ? '范围待核对' : sourceShot.participant_ids.length ? sourceShot.participant_ids.map(id => content.design.participants.find(row => row.id === id)?.name || '原对象不可用').join('、') : '明确无对象'}</p>
              <details><summary>查看镜头依据与身份</summary>
                <p>镜头身份：{item.shot_id}</p><p>覆盖身份：{item.id}</p><p>单元身份：{unit.id}</p>
                {!!sourceShot?.visible_result.sources?.length ? <SourceLinks sources={sourceShot.visible_result.sources} /> : <p>可见结果尚未记录来源</p>}
              </details>
            </section>
          })}
          {showSettings('organization') && !unit.organization && <section aria-label="建立单元组织要求">
            <p>当前未填写组织要求；待准备参考文字不会自动绑定素材。</p>
            <label>组织理由<Input.TextArea aria-label="组织理由" disabled={disabled} value={organizationReason} onChange={event => setOrganizationReason(event.target.value)} /></label>
            <WorkbenchButton disabled={disabled || !organizationReason.trim()} onClick={() => {
              patch({ organization: { reason: organizationReason.trim(), entry_state: '', exit_state: '', reference_requirements: [], missing: [],
                source: { kind: 'human', reference: `unit:${unit.id}:organization`, version: `${versionId}:${revision}` } } })
              setOrganizationReason('')
            }}>建立组织要求</WorkbenchButton>
          </section>}
          {showSettings('organization') && unit.organization && <section aria-label="单元组织要求">
            <h3>组织要求</h3>
            <label>组织理由<Input.TextArea aria-label="组织理由" disabled={disabled} value={unit.organization.reason} onChange={event => patch({ organization: { ...unit.organization!, reason: event.target.value } })} /></label>
            <p>{unit.organization.source.kind === 'model' ? '原 AI 组织依据（以下要求可人工修改）：' : '组织要求来源：'}</p><SourceLinks sources={[unit.organization.source]} />
            <label>进入状态<Input.TextArea id={`scene-unit-organization-${unit.id}-entry_state`} aria-label="组织进入状态" disabled={disabled} value={unit.organization.entry_state}
              onChange={event => patch({ organization: { ...unit.organization!, entry_state: event.target.value } })} /></label>
            <label>结束状态<Input.TextArea id={`scene-unit-organization-${unit.id}-exit_state`} aria-label="组织结束状态" disabled={disabled} value={unit.organization.exit_state}
              onChange={event => patch({ organization: { ...unit.organization!, exit_state: event.target.value } })} /></label>
            <label>待准备参考（每行一项）<Input.TextArea id={`scene-unit-organization-${unit.id}-reference_requirements`} aria-label="组织参考需求" disabled={disabled} value={unit.organization.reference_requirements.join('\n')}
              onChange={event => patch({ organization: { ...unit.organization!, reference_requirements: event.target.value.split('\n').filter(Boolean) } })} /></label>
            {!!unit.organization.missing.length && <details><summary>设计时诊断（不代表当前准备度）</summary><ul>{unit.organization.missing.map((item, index) => <li key={index}>{item}</li>)}</ul></details>}
          </section>}
          {showSettings('generation') && <>
          <label>视频模型<Select id="scene-unit-model" aria-label="单元视频模型" allowClear disabled={disabled || !models || !!modelsError} value={unit.model_id || undefined}
            placeholder="选择视频模型" style={{ width: '100%' }} options={models?.map(model => ({ value: model.id, label: model.name }))} onChange={id => patch({ model_id: id || null })} /></label>
          {modelsError && <Alert type="error" message="模型读取失败" description={modelsError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试模型</Button>} />}
          <label>预计时长（秒）<InputNumber id="scene-unit-duration" aria-label="单元预计时长" min={0.1} disabled={disabled} value={unit.duration_ms == null ? null : unit.duration_ms / 1000}
            onChange={seconds => patch({ duration_ms: seconds == null ? null : Math.round(seconds * 1000) })} /></label>
          <label>画幅<Input id="scene-unit-ratio" aria-label="单元画幅" disabled={disabled} value={unit.ratio} onChange={event => patch({ ratio: event.target.value })} /></label>
          <p>画幅继承创建时的场次设置；修改后仅影响本单元。</p>
      <p>当前执行器支持随机种子；留空使用模型的默认行为。参数随本单元保存，不修改其他单元。</p>
      <label>随机种子<InputNumber id="scene-unit-parameters" aria-label="单元随机种子" disabled={disabled} min={-1} max={4294967295} precision={0}
        value={typeof unit.parameters.seed === 'number' ? unit.parameters.seed : null}
        onChange={seed => patch({ parameters: seed === null ? Object.fromEntries(Object.entries(unit.parameters).filter(([key]) => key !== 'seed')) : { ...unit.parameters, seed } })} /></label>
      {unit.parameters.seed != null && typeof unit.parameters.seed !== 'number' && <Alert type="warning" message={`原随机种子不可用：${String(unit.parameters.seed)}`}
        action={<Button disabled={disabled} onClick={() => patch({ parameters: Object.fromEntries(Object.entries(unit.parameters).filter(([key]) => key !== 'seed')) })}>清除不可用随机种子</Button>} />}
      {Object.entries(unit.parameters).filter(([key]) => key !== 'seed').map(([key, value]) => <p key={key}>{key}：{String(value)} · 当前执行器不支持
        <Button disabled={disabled} onClick={() => patch({ parameters: Object.fromEntries(Object.entries(unit.parameters).filter(([name]) => name !== key)) })}>移除参数 {key}</Button></p>)}
          {capabilityError && <Alert type="error" message="模型能力读取失败" description={capabilityError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试模型能力</Button>} />}
          </>}
        </>}
      </>
  return <section className="scene-unit-canvas">
    {unit && <SceneUnitPreparationStatus host={preparationHost} missing={missing} checking={checking} failed={failed} onLocate={locateIssue} onRetry={retryPreparation} />}
    <SceneUnitDesignSuggestions onLocateBlocker={onLocateBlocker} onChange={onChange} onFocused={onUnitDesignFocused} triggerHost={primaryHost} focusTaskId={unitDesignTaskId} projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision} content={content} shotId={browseShotId} unitId={unit?.id} disabled={disabled} />
    {unit && primaryHost && createPortal(<nav className="scene-unit-primary" aria-label="当前单元主操作"><strong>当前单元 {allUnits.indexOf(unit) + 1}</strong>
      {<SceneInstructionSuggestions preparationBlocked={!!missing.length || checking || failed} key={unit.id} compact projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision}
        unitId={unit.id} content={content} disabled={disabled} onChange={onChange} onOpen={onOpenInstruction} onTask={onInstructionTask} />}
    </nav>, primaryHost)}
    {!graphState.current && <section className="scene-unit-draft-cards" aria-label="当前单元配置卡片">
      <p>以下为当前编辑内容；执行依据与外部证据{graphState.error ? '核实失败，请重试' : '正在核实'}。</p>
      {!unit && <p>请选择当前单元以编辑配置。</p>}
      {unit && <>
        {unit.coverage.map((item, index) => <section className="canvas-workbench-card unit-graph-card" key={item.id}>
          <h3>动作覆盖 {index + 1}</h3><p>{item.action_scope || '未填写动作范围'}</p>
          <WorkbenchButton onClick={() => openSettings(unit.id, 'coverage', item.id)}>编辑动作覆盖 {index + 1}</WorkbenchButton>
        </section>)}
        <section className="canvas-workbench-card unit-graph-card"><h3>生成配置</h3>
          <p>模型：{unit.model_id || '未选择'} · 时长：{unit.duration_ms ?? '未填写'} 毫秒 · 画幅：{unit.ratio}</p>
          <p>参数：{Object.entries(unit.parameters).map(([name, value]) => `${name}：${String(value)}`).join('、') || '默认'}</p>
          <WorkbenchButton onClick={() => openSettings(unit.id, 'generation')}>编辑生成配置</WorkbenchButton>
        </section>
        <section className="canvas-workbench-card unit-graph-card"><h3>组织要求</h3>
          <p>{unit.organization?.reason || '未填写组织理由'}</p><p>{unit.organization?.entry_state || '未填写进入状态'}</p>
          <p>{unit.organization?.exit_state || '未填写结束状态'}</p>
          <WorkbenchButton onClick={() => openSettings(unit.id, 'organization')}>编辑组织要求</WorkbenchButton>
        </section>
        <section className="canvas-workbench-card unit-graph-card"><h3>前段依赖</h3>
          <p>单元依赖 {unit.dependencies.length} 项 · 场次依赖 {unit.scene_dependencies.length} 项 · 证据未核实</p>
          <WorkbenchButton onClick={() => setDependencyUnitId(unit.id)}>编辑前段依赖</WorkbenchButton>
        </section>
        <section className="canvas-workbench-card unit-graph-card"><h3>参考素材</h3>
          <p>已绑定 {unit.references.length} 项 · 文件可用性未核实</p>
          {graph.nodes.filter(node => node.kind === 'unit_references' && node.unit_id === unit.id).map(node => node.kind === 'unit_references' && <WorkbenchButton key={node.id} onClick={() => setPicker(node)}>{node.title}</WorkbenchButton>)}
        </section>
        <section className="canvas-workbench-card unit-graph-card"><h3>本单元执行依据</h3><p>尚未核实；核实成功后展示当前执行范围与来源。</p></section>
      </>}
    </section>}
    <UnitGraphCanvas error={graphState.error} onRetry={graphState.retry} graph={graph} updating={!graphState.current} versionId={versionId} revision={revision} content={content} unitId={unitId}
      storageKey={`jellyfish:unit-graph:local-user:${projectId}:${sequenceId}:${versionId}`}
      pending={sceneContentKey(content) !== sceneContentKey(saved)}
      onBrowseShotChange={setBrowseShotId}
      onReference={node => {
          const id = node.unit_id
        if (!allUnits.some(row => row.id === id)) { setUnavailableTarget(true); return }
        setUnavailableTarget(false); onSelectUnit(id); setPicker(node)
      }}
      onInspect={node => {
        if (!('unit_id' in node)) return
        const currentUnit = allUnits.find(row => row.id === node.unit_id)
        if (!currentUnit || (node.kind === 'unit_config' && node.config_kind === 'coverage' && !currentUnit.coverage.some(item => item.id === node.coverage_item_id))) { setUnavailableTarget(true); return }
        setUnavailableTarget(false)
        onSelectUnit(node.unit_id)
        if (node.kind === 'unit_basis') setBasisUnitId(node.unit_id)
        else if (node.kind === 'unit_references') setPicker(node)
        else if (node.kind === 'unit_config' && node.config_kind === 'dependencies') setDependencyUnitId(node.unit_id)
        else if (node.kind === 'unit_config' && node.config_kind !== 'dependencies') openSettings(node.unit_id, node.config_kind, node.coverage_item_id || undefined)
        else setBasisUnitId(node.unit_id)
      }} />
    {unavailableTarget && <Alert type="warning" message="当前编辑中该来源已移除，请重新选择当前卡片" />}
    {/* 保留手动创建能力；工作台创建入口目前仅提供 AI 方案应用。 */}
    <WorkbenchModal title="建立单元" open={creationOpen} onCancel={() => setCreationOpen(false)} footer={<WorkbenchDialogActions
      secondary={<WorkbenchButton variant="quiet" onClick={() => setCreationOpen(false)}>取消</WorkbenchButton>}>
      <WorkbenchButton variant="primary" disabled={disabled || !creationShotId} onClick={() => { if (creationShotId) create(creationShotId) }}>创建单元</WorkbenchButton>
    </WorkbenchDialogActions>}>
      <p>为一个明确镜头建立生产单元。</p>
      <Select aria-label="新增单元目标镜头" placeholder="选择目标镜头" value={creationShotId} style={{ width: '100%' }} onChange={setCreationShotId}
        options={content.design.direction.shots.map((row, index) => ({ value: row.id, label: `镜头 ${index + 1}：${row.visible_result.text || '未填写'}` }))} />
    </WorkbenchModal>
    <WorkbenchDetails focusTarget={focusTarget || focusRequest} status={saveStatus} title={settingsSection === 'coverage' ? '动作覆盖' : settingsSection === 'generation' ? '生成配置' : '组织要求'} open={!!unit && settingsUnitId === unit.id} onClose={() => openSettings(undefined)}>{settings}</WorkbenchDetails>
    <WorkbenchDetails title="本单元执行依据" status={graphState.current ? '只读 · 当前编辑' : '当前依据核实中'} open={basis?.kind === 'unit_basis' && allUnits.some(row => row.id === basis.unit_id)} onClose={() => setBasisUnitId(undefined)}>
      {graphState.current && basis?.kind === 'unit_basis' && <UnitScopeSummary value={basis.scope} fieldTargets={basis.field_targets} onLocate={target => {
        if (target.external) { onLocateDesign(target); return }
        const source = graph.nodes.find(node => node.id === target.node_id)
        if (source?.kind !== 'unit_config') { setUnavailableTarget(true); return }
        const currentUnit = allUnits.find(row => row.id === source.unit_id)
        if (!currentUnit || (source.config_kind === 'coverage' && !currentUnit.coverage.some(item => item.id === source.coverage_item_id)) || (source.config_kind === 'organization' && !currentUnit.organization)) { setUnavailableTarget(true); return }
        setUnavailableTarget(false)
        setBasisUnitId(undefined)
        onSelectUnit(source.unit_id)
        if (source.config_kind === 'dependencies') setDependencyUnitId(source.unit_id)
        else {
          openSettings(source.unit_id, source.config_kind, source.coverage_item_id || undefined)
          if (source.config_kind === 'coverage' && source.coverage_item_id) setFocusTarget({ nodeId: source.id, fieldId: `scene-unit-action-${source.coverage_item_id}`, serial: Date.now() })
          if (source.config_kind === 'organization' && target.field) setFocusTarget({ nodeId: source.id, fieldId: `scene-unit-organization-${source.unit_id}-${target.field}`, serial: Date.now() })
        }
      }} />}
    </WorkbenchDetails>
    {unit && dependencyUnitId === unit.id && <WorkbenchDetails status={saveStatus} title="前段依赖" open onClose={() => setDependencyUnitId(undefined)}>
      <Button onClick={() => { setDependencyUnitId(undefined); onOpenInstruction() }}>前往当前单元指令核对</Button>
      <section id="scene-unit-dependencies" tabIndex={-1}><SceneFrameDependencies onOpenEdit={onOpenEdit} unit={unit} content={content} versionId={versionId} evidence={frameEvidence} disabled={disabled} onChange={patch} />
      {!!unit.dependencies.length && workspaceLoading && <Spin />}
      {workspaceError && <Alert type="error" message="来源单元读取失败" description={workspaceError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试来源单元</Button>} />}
      {!!unit.dependencies.length && workspace && <DependencyEditor sceneVersion projectId={projectId} workspace={workspace} unit={unit} disabled={disabled} onChange={patch} />}</section>
    </WorkbenchDetails>}
    {unit && referenceUnitId === unit.id && <WorkbenchDetails status={saveStatus} title="参考输入" open onClose={() => setReferenceUnitId(undefined)}>
      <section id="scene-unit-references" tabIndex={-1}><p>选择要核对的参考位置。</p>
        {graph.nodes.filter(node => node.kind === 'unit_references' && node.unit_id === unit.id).map(node => node.kind === 'unit_references' && <WorkbenchButton key={node.id} onClick={() => { setReferenceUnitId(undefined); setPicker(node) }}>{node.title}</WorkbenchButton>)}
      </section>
    </WorkbenchDetails>}
    {unit && picker?.unit_id === unit.id && <ReferencePicker title={picker.input_role === 'subject' ? picker.bindings.length ? '编辑参考组' : '添加参考组' : `${picker.bindings.length ? '编辑' : '添加'}${picker.title}`}
      inputRole={picker.input_role === 'all' ? undefined : picker.input_role} referenceIds={picker.bindings.map(binding => binding.id)}
      initialParticipantIds={picker.bindings[0]?.participant_ids} initialPurpose={picker.bindings[0]?.purpose} initialAssetId={picker.bindings[0]?.asset_origin?.id} rootClassName="canvas-workbench-dialog" key={`${versionId}:${picker.id}`} projectId={projectId} assets={assets} assetError={assetError}
      contextLabel={`单元 ${allUnits.findIndex(row => row.id === unit.id) + 1} · ${disabled ? '只读' : saveStatus}`} onReloadAssets={() => setAttempt(value => value + 1)} design={content.design} coverage={unit.coverage} references={unit.references}
      capability={capability} capabilityError={capabilityError} onRetryCapability={() => setAttempt(value => value + 1)} disabled={disabled}
      dependencyReferenceIds={[...unit.dependencies, ...(unit.scene_dependencies || [])].flatMap(link => link.reference_id ? [link.reference_id] : [])}
      onApply={references => patch({ references })} onClose={() => setPicker(undefined)} />}
  </section>
}
