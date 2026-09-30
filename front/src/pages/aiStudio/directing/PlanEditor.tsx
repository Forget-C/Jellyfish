import { useContext } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, InputNumber, Select, Space, Typography } from 'antd'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, WorkspaceRead, VideoReferenceCapabilities, GenerationUnit_Input, ModelRead, ProductionPlan_Input, SceneDesign_Input, ReferenceBinding_Input } from '../../../services/generated'
import { ReferencePicker } from './ReferencePicker'
import { ProductionInputContext, ProductionParameters } from './ProductionWorkbench'
import { DependencyEditor } from './DependencyEditor'
import { directingError } from './common'
import type { ProductionGraphNode } from './productionGraph'

/** 拍摄单元和本轮参考的显式编辑，关联资产不会自动全量提交。 */
export function PlanEditor({ assets, assetError, onReloadAssets, projectId, workspace, design, value, onChange, disabled = false, issue, selectedUnitId, planId }: {
  assets?: AssetSummary[]; assetError?: string; onReloadAssets?: () => void;
  planId?: string; selectedUnitId?: string; projectId: string; workspace: WorkspaceRead; design: SceneDesign_Input; value: ProductionPlan_Input; onChange: (plan: ProductionPlan_Input) => void; disabled?: boolean; issue?: { unitId?: string; message: string }
}) {
  const latest = useRef({ value, planId })
  latest.current = { value, planId }
  const [models, setModels] = useState<ModelRead[]>([])
  const [defaultModel, setDefaultModel] = useState('')
  const [error, setError] = useState('')
  const [picker, setPicker] = useState<{ unitId: string; participantIds?: string[]; assetId?: string; title?: string; referenceIds?: string[]; location?: boolean; purpose?: ReferenceBinding_Input['purpose'] }>()
  const [target, setTarget] = useState<ProductionGraphNode>()
  const [capability, setCapability] = useState<VideoReferenceCapabilities>()
  const [capabilityError, setCapabilityError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const input = useContext(ProductionInputContext)
  const inputSection = input?.section
  const selected = selectedUnitId ? value.units.find(unit => unit.id === selectedUnitId) : value.units[0]
  useEffect(() => { setPicker(undefined); setTarget(undefined) }, [planId, value.design_revision_id, selected?.id, selected?.model_id, disabled])
  useEffect(() => {
    const node = input?.node
    setTarget(node)
    const ref = node?.kind === 'reference' ? selected?.references.find(row => node.referenceIds?.includes(row.id)) : undefined
    if (node && ['participant', 'location', 'reference'].includes(node.kind) && selected) setPicker({ unitId: selected.id, title: node.action ? '添加参考' : node.label, participantIds: node.kind === 'participant' ? [node.objectId] : ref?.participant_ids, assetId: node.assetId || ref?.asset_origin?.id, referenceIds: node.kind === 'reference' && !node.action ? node.referenceIds : undefined, location: node.kind === 'location', purpose: node.kind === 'location' ? 'space' : undefined })
    else setPicker(undefined)
  }, [input?.serial])
  useEffect(() => {
    let current = true
    setCapability(undefined); setCapabilityError('')
    if (selected?.model_id) void StudioDirectingService.directingReferenceCapabilities({ projectId, modelId: selected.model_id }).then(response => {
      if (!response.data?.model_id) throw new Error('模型能力暂不可用')
      if (current) setCapability(response.data)
    }).catch(cause => { if (current) setCapabilityError(directingError(cause)) })
    return () => { current = false }
  }, [projectId, selected?.model_id, attempt])
  const activeCapability = capability?.model_id === selected?.model_id ? capability : undefined
  useEffect(() => { input?.onModel({ modelId: selected?.model_id, name: models.find(model => model.id === selected?.model_id)?.name, capability: activeCapability, error: capabilityError }) }, [selected?.model_id, models, activeCapability, capabilityError, input?.onModel])
  useEffect(() => {
    void Promise.all([LlmService.listModelsApiV1LlmModelsGet({ category: 'video', pageSize: 100 }), LlmService.getModelSettingsApiV1LlmModelSettingsGet()]).then(([list, settings]) => {
      setModels(list.data?.items || []); setDefaultModel(settings.data?.default_video_model_id || '')
    }).catch(cause => setError(directingError(cause)))
  }, [])
  /** 仅替换当前单元，其他单元与已确认版本保持原样。 */
  const patch = (id: string, update: Partial<GenerationUnit_Input>) => onChange({ ...value, units: value.units.map(unit => unit.id === id ? { ...unit, ...update } : unit) })
  /** 用户选择新镜头范围后建立稳定出现项，部分动作可继续手工缩小。 */
  const coverage = (shotIds: string[]) => shotIds.map(shotId => {
    const shot = design.direction.shots.find(item => item.id === shotId)!
    return { id: 'coverage-' + crypto.randomUUID().slice(0, 8), shot_id: shot.id, beat_ids: shot.beat_ids,
      event_ids: shot.event_ids, action_scope: shot.visible_result.text || '请描述本次要拍的动作范围' }
  })
  /** modal 仅在明确应用时更新当前单元；取消与迟到结果不写入计划。 */
  const applyReferences = (references: ReferenceBinding_Input[]) => {
    if (disabled || latest.current.planId !== planId || !picker || picker.unitId !== selected?.id) return
    const current = latest.current.value
    if (!current.units.some(unit => unit.id === picker.unitId)) return
    const next = { ...current, units: current.units.map(unit => unit.id === picker.unitId ? { ...unit, references } : unit) }
    latest.current = { value: next, planId }; onChange(next)
  }
  const targetMissing = !!target && !target.action && !!selected && (target.kind === 'coverage' ? !selected.coverage.some(row => row.id === target.objectId) : target.kind === 'reference' ? !selected.references.some(row => target.referenceIds?.includes(row.id) || row.id === target.objectId) : target.kind === 'participant' ? !design.participants.some(row => row.id === target.objectId) : target.kind === 'dependency' ? !selected.dependencies?.some(row => row.plan_revision_id === target.sourcePlanId && row.unit_id === target.sourceUnitId) : false)
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {targetMissing && <Alert type="warning" message="所选输入已不存在，请在关系图中明确选择其他对象" />}
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    <div className="production-preparation">
    {value.units.filter(unit => unit.id === selected?.id).map(unit => <Card className="xl:col-start-1 xl:row-start-1 min-w-0" key={unit.id} title={inputSection ? undefined : `本次要拍：${unit.coverage.map(item => item.action_scope).join('；') || '待填写动作范围'}`} data-workspace-target={`unit:${unit.id}`} tabIndex={-1} extra={!disabled && <Button danger onClick={() => onChange({ ...value, units: value.units.filter(item => item.id !== unit.id) })}>移除单元</Button>}>
      {issue?.unitId === unit.id && <Alert type="error" message={issue.message} />}
      {target && ['coverage', 'dependency'].includes(target.kind) && !target.action && <div className="production-object-context"><Typography.Text strong>{target.label}</Typography.Text><Button type="link" onClick={() => setTarget(undefined)}>查看本单元全部{inputSection === 'coverage' ? '覆盖范围' : '依赖'}</Button></div>}
      <Space className="production-input-fields" direction="vertical" style={{ width: '100%' }}>
        <div hidden={!!inputSection && inputSection !== 'coverage'}><details><summary>单元身份</summary>{unit.id} · 计划：{planId || '未保存'}</details><Typography.Text>本次覆盖镜头</Typography.Text>
        <Select aria-label="本次覆盖镜头" mode="multiple" disabled={disabled} style={{ width: '100%' }} value={unit.coverage.map(item => item.shot_id)} options={design.direction.shots.map((shot, i) => ({ value: shot.id, label: `镜头 ${i + 1} · ${shot.visible_result.text || '待确定内容'}` }))} onChange={ids => patch(unit.id, { coverage: coverage(ids).map(row => unit.coverage.find(old => old.shot_id === row.shot_id) || row) })} />
        {unit.coverage.filter(item => !target || target.action || target.kind !== 'coverage' || item.id === target.objectId).map(item => <div key={item.id} style={{ width: '100%' }}><Typography.Text type="secondary">动作范围 · {item.shot_id}</Typography.Text><Input.TextArea aria-label={`动作范围 ${item.id}`} disabled={disabled} value={item.action_scope} onChange={event => patch(unit.id, { coverage: unit.coverage.map(row => row.id === item.id ? { ...row, action_scope: event.target.value } : row) })} /></div>)}
        {unit.coverage.length > 1 && <Alert type="warning" message="计划包含多个镜头，当前多镜执行能力未验证。保存并确认后，可在重组面板明确拆分。" />}
        </div><ProductionParameters>        <Space wrap>
          <span data-workspace-target={`unit-model:${unit.id}`} tabIndex={-1}><Select aria-label="视频模型" disabled={disabled} placeholder="选择视频模型" style={{ minWidth: 220 }} value={unit.model_id || undefined} options={models.map(model => ({ value: model.id, label: model.name }))} onChange={model_id => patch(unit.id, { model_id })} /></span>
          <span>时长（秒）</span><InputNumber disabled={disabled} min={1} precision={0} value={unit.duration_ms / 1000} onChange={seconds => patch(unit.id, { duration_ms: (seconds || 1) * 1000 })} />
          <Select aria-label="画幅" disabled={disabled} value={unit.ratio} options={['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map(ratio => ({ value: ratio, label: ratio }))} onChange={ratio => patch(unit.id, { ratio })} />
          <details><summary>更多拍摄设置</summary><span>种子（可留空）</span><InputNumber disabled={disabled} min={-1} precision={0} value={typeof unit.parameters?.seed === 'number' ? unit.parameters.seed : null} onChange={seed => patch(unit.id, { parameters: seed === null ? Object.fromEntries(Object.entries(unit.parameters || {}).filter(([key]) => key !== 'seed')) : { ...unit.parameters, seed } })} /></details>
        </Space>
</ProductionParameters>
        <div hidden={!!inputSection && inputSection !== 'dependency'}><DependencyEditor selectedSource={target?.kind === 'dependency' && !target.action ? { planId: target.sourcePlanId!, unitId: target.sourceUnitId! } : undefined} projectId={projectId} workspace={workspace} unit={unit} onChange={update => patch(unit.id, update)} disabled={disabled} /></div>

      </Space>
    </Card>)}
    </div>
    {!disabled && <Button disabled={!design.direction.shots.length} onClick={() => onChange({ ...value, units: [...value.units, { id: 'unit-' + crypto.randomUUID().slice(0, 8), coverage: coverage([design.direction.shots[0].id]), references: [], model_id: defaultModel, duration_ms: 5000, ratio: '16:9', capability: { multi_shot: 'unknown' } }] })}>新增试拍 / 补拍单元</Button>}
    {picker && picker.unitId === selected?.id && <ReferencePicker key={`${planId}:${value.design_revision_id}:${picker.unitId}:${input?.serial}:${picker.title || ''}:${selected.model_id}`} projectId={projectId} title={picker.title} referenceIds={picker.referenceIds} location={picker.location} initialParticipantIds={picker.participantIds} initialAssetId={picker.assetId} initialPurpose={picker.purpose} assets={assets} assetError={assetError} onReloadAssets={onReloadAssets} design={design} references={selected.references} capability={activeCapability} capabilityError={capabilityError} onRetryCapability={() => setAttempt(value => value + 1)} dependencyReferenceIds={selected.dependencies?.flatMap(row => row.reference_id ? [row.reference_id] : [])} disabled={disabled} onEditAssets={input?.onEditAssets} onApply={applyReferences} onClose={() => setPicker(undefined)} />}

  </Space>
}
