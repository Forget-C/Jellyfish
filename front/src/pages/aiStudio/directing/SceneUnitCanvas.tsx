import { createPortal } from 'react-dom'
import { useSceneUnitPreparation } from './useSceneUnitPreparation'
import { useEffect, useState } from 'react'
import { Alert, Button, Input, InputNumber, Modal, Select, Space, Spin } from 'antd'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, EditableGenerationUnit_Output, ModelRead, SceneVersionContent_Output, WorkspaceRead } from '../../../services/generated'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'
import { SceneFrameDependencies } from './SceneFrameDependencies'
import { DependencyEditor } from './DependencyEditor'
import { ReferencePicker } from './ReferencePicker'
import { referencePurposes } from './referenceInput'
import { directingError } from './common'
import { SourceLinks } from './Sources'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { SceneInstructionSuggestions } from './SceneInstructionSuggestions'

/** 单元和设计共用一份可编辑方案；画布浏览不创建单元，也不选择替代对象。 */
export function SceneUnitCanvas({ primaryHost, projectId, sequenceId, versionId, revision, content, shotId, unitId, disabled, onSelectShot, onSelectUnit, onChange, focusRequest, onOpenInstruction, onInstructionTask, onOpenEdit }: {
  primaryHost: HTMLElement | null
  projectId: string; sequenceId: string; versionId: string; revision: number; content: SceneVersionContent_Output; shotId?: string; unitId?: string; disabled: boolean
  onOpenEdit: (clipId: string) => void
  onOpenInstruction: (taskId?: string) => void
  onInstructionTask: (taskId: string, unitId: string) => void
  onSelectShot: (id: string) => void; onSelectUnit: (id: string, shotId?: string) => void; onChange: (content: SceneVersionContent_Output) => void
  focusRequest?: { versionId: string; unitId: string; nodeId: string; fieldId: string; serial: number }
}) {
  const [focusTarget, setFocusTarget] = useState<{ nodeId: string; fieldId: string; serial: number }>()
  const [models, setModels] = useState<ModelRead[]>()
  const [modelsError, setModelsError] = useState('')
  const [assets, setAssets] = useState<AssetSummary[]>()
  const [assetError, setAssetError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [picker, setPicker] = useState<string>()
  const [parametersUnitId, setParametersUnitId] = useState<string>()
  const [dependencyUnitId, setDependencyUnitId] = useState<string>()
  const [workspace, setWorkspace] = useState<WorkspaceRead>()
  const [workspaceError, setWorkspaceError] = useState('')
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const shot = content.design.direction.shots.find(row => row.id === shotId)
  const allUnits = content.units || []
  const units = allUnits.filter(row => row.coverage.some(item => item.shot_id === shotId))
  const unit = units.find(row => row.id === unitId)
  const { capability, capabilityError, frameEvidence, missing, designScopeError } = useSceneUnitPreparation(projectId, sequenceId, versionId, revision, content, unit, attempt)
  useEffect(() => {
    if (focusRequest?.versionId === versionId && focusRequest.unitId === unit?.id) {
      setFocusTarget(focusRequest)
      if (focusRequest.fieldId === 'scene-unit-dependencies') setDependencyUnitId(unit.id)
      if (focusRequest.fieldId === 'scene-unit-parameters') setParametersUnitId(unit.id)
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
  const create = () => {
    if (!shot || disabled) return
    const id = crypto.randomUUID()
    onChange({ ...content, units: [...allUnits, { id,
      coverage: [{ id: crypto.randomUUID(), shot_id: shot.id, beat_ids: [], event_ids: [], staging_activity_ids: [], performance_action_ids: [], continuity_change_ids: [], action_scope: '' }],
      references: [], model_id: null, duration_ms: null, ratio: content.output_aspect_ratio,
      parameters: {}, capability: { multi_shot: 'unknown' }, dependencies: [], scene_dependencies: [], instruction: '', instruction_source: null, instruction_basis_id: null, instruction_check_task_id: null,
    }] })
    onSelectUnit(id)
  }
  const locateIssue = (issue: typeof missing[number]) => {
    if (issue.fieldId === 'scene-unit-dependencies' && unit) setDependencyUnitId(unit.id)
    else if (issue.fieldId === 'scene-unit-parameters' && unit) setParametersUnitId(unit.id)
    else setFocusTarget({ nodeId: issue.nodeId || '单元设置', fieldId: issue.fieldId, serial: Date.now() })
  }
  return <section className="scene-unit-canvas">
    {unit && primaryHost && createPortal(<nav className="scene-unit-primary" aria-label="当前单元主操作"><strong>当前单元 {allUnits.indexOf(unit) + 1}</strong>
      {<SceneInstructionSuggestions onPrepare={missing.length ? () => locateIssue(missing[0]) : undefined} key={unit.id} compact projectId={projectId} sequenceId={sequenceId} versionId={versionId} revision={revision}
        unitId={unit.id} content={content} disabled={disabled} onChange={onChange} onOpen={onOpenInstruction} onTask={onInstructionTask} />}
    </nav>, primaryHost)}
    <DirectorCanvasSurface key={`${versionId}:units:${unitId || 'empty'}`} focusTarget={focusTarget} initialPositions={{ 参考素材: { x: 800, y: 0 } }} contextKey={`${versionId}:units:${unitId || 'empty'}`} labels={['镜头依据', '单元设置', '参考素材']} ariaLabel="单元画布视口"
      relations={unit ? [{ from: '镜头依据', to: '单元设置', label: '动作覆盖' }, { from: '参考素材', to: '单元设置', label: '明确输入' }] : []}>
      <section className="canvas-workbench-card">
          <Select aria-label="单元所属镜头" placeholder="明确选择镜头" value={shotId} style={{ width: '100%' }}
          options={content.design.direction.shots.map((row, index) => ({ value: row.id, label: `镜头 ${index + 1}：${row.visible_result.text || '未填写'}` }))}
          onChange={onSelectShot} />
        {!shot && <p>{shotId ? '原镜头已不可用，请重新选择' : '先选择镜头，再建立或选择单元'}</p>}
        {shot && <><p>{shot.visible_result.text || '可见结果尚未填写'}</p>
          {!units.length && <p>当前镜头尚无单元</p>}
          <Select aria-label="当前单元" placeholder={units.length > 1 ? '多个单元，请明确选择' : '选择单元'} value={unit?.id} style={{ width: '100%' }}
            options={units.map(row => ({ value: row.id, label: `单元 ${allUnits.indexOf(row) + 1} · ${row.coverage.map(item => item.action_scope).join('；') || '动作待填写'}` }))} onChange={id => onSelectUnit(id)} />
          <Button disabled={disabled} onClick={create}>{units.length ? '为当前镜头增加补拍单元' : '为当前镜头建立单元'}</Button>
          {unitId && !unit && <p>原单元不属于当前镜头或已不可用，请重新选择</p>}
        </>}
      </section>
      <section className="canvas-workbench-card">
          {!unit ? <p>明确选择单元后编辑；浏览不创建数据。</p> : <>
          <p>单元 {allUnits.indexOf(unit) + 1} · 当前场次版本</p>
          {!missing.length && <p role="status">当前单元基础准备已齐备</p>}
          {missing.length > 0 && <Alert type="warning" message="本单元待准备" description={<ul>{missing.map(item => <li key={item.message}><Button type="link" onClick={() => locateIssue(item)}>{item.message}</Button></li>)}</ul>}
            action={designScopeError ? <WorkbenchButton variant="secondary" onClick={() => setAttempt(value => value + 1)}>重试设计范围</WorkbenchButton> : undefined} />}
          {unit.coverage.map((item, index) => {
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
          <label>视频模型<Select id="scene-unit-model" aria-label="单元视频模型" allowClear disabled={disabled || !models || !!modelsError} value={unit.model_id || undefined}
            placeholder="选择视频模型" style={{ width: '100%' }} options={models?.map(model => ({ value: model.id, label: model.name }))} onChange={id => patch({ model_id: id || null })} /></label>
          {modelsError && <Alert type="error" message="模型读取失败" description={modelsError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试模型</Button>} />}
          <label>预计时长（秒）<InputNumber id="scene-unit-duration" aria-label="单元预计时长" min={0.1} disabled={disabled} value={unit.duration_ms == null ? null : unit.duration_ms / 1000}
            onChange={seconds => patch({ duration_ms: seconds == null ? null : Math.round(seconds * 1000) })} /></label>
          <label>画幅<Input id="scene-unit-ratio" aria-label="单元画幅" disabled={disabled} value={unit.ratio} onChange={event => patch({ ratio: event.target.value })} /></label>
          <p>画幅继承创建时的场次设置；修改后仅影响本单元。</p>
          <Button id="scene-unit-parameters" onClick={() => setParametersUnitId(unit.id)}>编辑模型参数</Button>
          {capabilityError && <Alert type="error" message="模型能力读取失败" description={capabilityError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试模型能力</Button>} />}
          <h3 id="scene-unit-dependencies" tabIndex={-1}>前段依赖</h3><Button onClick={() => setDependencyUnitId(unit.id)}>编辑前段依赖</Button>{!unit.dependencies.length && !(unit.scene_dependencies || []).length ? <p>当前无前段落幅依赖</p> : unit.dependencies.map((link, index) => <p key={`${link.plan_revision_id}:${link.unit_id}`}>前段依赖 {index + 1} · {link.frame_id ? '已绑定实际落幅' : '实际落幅待准备'}</p>)}
        </>}
      </section>
      <section className="canvas-workbench-card">
        {unit ? <><p>{unit.references.length} 项参考；项目资产不会自动成为输入。</p>
          {unit.references.map(binding => <p key={binding.id}>{binding.asset_origin?.name || binding.file_id} · {referencePurposes[binding.purpose]}</p>)}
          <Space><Button id="scene-unit-references" disabled={disabled} onClick={() => setPicker(unit.id)}>编辑本单元参考</Button></Space></> : <p>先选择单元</p>}
      </section>
    </DirectorCanvasSurface>
    {unit && parametersUnitId === unit.id && <Modal rootClassName="canvas-workbench-dialog" title="当前单元模型参数" open
      onCancel={() => setParametersUnitId(undefined)} footer={<Button onClick={() => setParametersUnitId(undefined)}>完成参数编辑</Button>}>
      <p>当前执行器支持随机种子；留空使用模型的默认行为。参数随本单元保存，不修改其他单元。</p>
      <label>随机种子<InputNumber aria-label="单元随机种子" disabled={disabled} min={-1} max={4294967295} precision={0}
        value={typeof unit.parameters.seed === 'number' ? unit.parameters.seed : null}
        onChange={seed => patch({ parameters: seed === null ? Object.fromEntries(Object.entries(unit.parameters).filter(([key]) => key !== 'seed')) : { ...unit.parameters, seed } })} /></label>
      {unit.parameters.seed != null && typeof unit.parameters.seed !== 'number' && <Alert type="warning" message={`原随机种子不可用：${String(unit.parameters.seed)}`}
        action={<Button disabled={disabled} onClick={() => patch({ parameters: Object.fromEntries(Object.entries(unit.parameters).filter(([key]) => key !== 'seed')) })}>清除不可用随机种子</Button>} />}
      {Object.entries(unit.parameters).filter(([key]) => key !== 'seed').map(([key, value]) => <p key={key}>{key}：{String(value)} · 当前执行器不支持
        <Button disabled={disabled} onClick={() => patch({ parameters: Object.fromEntries(Object.entries(unit.parameters).filter(([name]) => name !== key)) })}>移除参数 {key}</Button></p>)}
    </Modal>}
    {unit && dependencyUnitId === unit.id && <Modal rootClassName="canvas-workbench-dialog" title="前段依赖" open width={760}
      styles={{ body: { maxHeight: 'calc(100dvh - 240px)', overflowY: 'auto' } }}
      onCancel={() => setDependencyUnitId(undefined)} footer={<Space><Button onClick={() => setDependencyUnitId(undefined)}>完成依赖编辑</Button><Button onClick={() => { setDependencyUnitId(undefined); onOpenInstruction() }}>前往当前单元指令核对</Button></Space>}>
      <SceneFrameDependencies onOpenEdit={onOpenEdit} unit={unit} content={content} versionId={versionId} evidence={frameEvidence} disabled={disabled} onChange={patch} />
      {!!unit.dependencies.length && workspaceLoading && <Spin />}
      {workspaceError && <Alert type="error" message="来源单元读取失败" description={workspaceError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试来源单元</Button>} />}
      {!!unit.dependencies.length && workspace && !workspaceLoading && !workspaceError && <DependencyEditor sceneVersion projectId={projectId} workspace={workspace} unit={unit} disabled={disabled} onChange={patch} />}
    </Modal>}
    {unit && picker === unit.id && <ReferencePicker title={unit.references.length ? '本单元参考' : '添加参考'} rootClassName="canvas-workbench-dialog" key={`${versionId}:${unit.id}`} projectId={projectId} assets={assets} assetError={assetError}
      onReloadAssets={() => setAttempt(value => value + 1)} design={content.design} coverage={unit.coverage} references={unit.references}
      capability={capability} capabilityError={capabilityError} onRetryCapability={() => setAttempt(value => value + 1)} disabled={disabled}
      dependencyReferenceIds={[...unit.dependencies, ...(unit.scene_dependencies || [])].flatMap(link => link.reference_id ? [link.reference_id] : [])}
      onApply={references => patch({ references })} onClose={() => setPicker(undefined)} />}
  </section>
}
