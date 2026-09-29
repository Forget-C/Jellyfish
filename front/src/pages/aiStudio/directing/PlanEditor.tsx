import { useContext } from 'react'
import { SourceLinks } from './Sources'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Input, InputNumber, Select, Space, Typography } from 'antd'
import { LlmService, StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, WorkspaceRead, VideoReferenceCapabilities, GenerationUnit_Input, ModelRead, ProductionPlan_Input, SceneDesign_Input, ReferenceBinding_Input } from '../../../services/generated'
import { ReferencePicker } from './ReferencePicker'
import { referenceGroups, referenceIssues, referencePurposes, referenceRoles, referenceSummary } from './referenceInput'
import { ProductionInputContext, ProductionParameters } from './ProductionWorkbench'
import { ReferencePreview } from './ReferencePreview'
import { DependencyEditor } from './DependencyEditor'
import { directingError } from './common'

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
  const [picker, setPicker] = useState<string>()
  const [capability, setCapability] = useState<VideoReferenceCapabilities>()
  const [capabilityError, setCapabilityError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const inputSection = useContext(ProductionInputContext)
  const selected = value.units.find(unit => unit.id === selectedUnitId) || value.units[0]
  useEffect(() => { setPicker(undefined) }, [planId, value.design_revision_id, selected?.id, selected?.model_id, disabled])
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
  /** 按当前计划和单元写入，快速重复选择不会重复添加或覆盖其他图片。 */
  const addReference = (reference: ReferenceBinding_Input) => {
    if (disabled || latest.current.planId !== planId || !picker || picker !== selected?.id) return
    const current = latest.current.value
    const unit = current.units.find(item => item.id === picker)
    if (!unit || unit.references.some(ref => ref.file_id === reference.file_id)) return
    const existing = reference.asset_origin && reference.input_role === 'subject' ? unit.references.find(ref => ref.subject_group_id && ref.input_role === 'subject' && ref.purpose === reference.purpose && ref.asset_origin?.kind === reference.asset_origin?.kind && ref.asset_origin?.id === reference.asset_origin?.id && ref.asset_origin?.name === reference.asset_origin?.name && [...ref.participant_ids].sort().join() === [...reference.participant_ids].sort().join()) : undefined
    const added = { ...reference, ordinal: Math.max(-1, ...unit.references.map(ref => ref.ordinal)) + 1, subject_group_id: existing?.subject_group_id || reference.subject_group_id }
    const next = { ...current, units: current.units.map(row => row.id === unit.id ? { ...row, references: [...unit.references, added] } : row) }
    latest.current = { value: next, planId }; onChange(next)
  }
  return <Space direction="vertical" size="middle" style={{ width: '100%' }}>
    {error && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    <div className="production-preparation">
    {value.units.filter(unit => unit.id === selected?.id).map(unit => <Card className="xl:col-start-1 xl:row-start-1 min-w-0" key={unit.id} title={inputSection ? undefined : `本次要拍：${unit.coverage.map(item => item.action_scope).join('；') || '待填写动作范围'}`} data-workspace-target={`unit:${unit.id}`} tabIndex={-1} extra={!disabled && <Button danger onClick={() => onChange({ ...value, units: value.units.filter(item => item.id !== unit.id) })}>移除单元</Button>}>
      {issue?.unitId === unit.id && <Alert type="error" message={issue.message} />}
      <Space className="production-input-fields" direction="vertical" style={{ width: '100%' }}>
        <div hidden={!!inputSection && inputSection !== 'coverage'}><details><summary>单元身份</summary>{unit.id} · 计划：{planId || '未保存'}</details><Typography.Text>本次覆盖镜头</Typography.Text>
        <Select mode="multiple" disabled={disabled} style={{ width: '100%' }} value={unit.coverage.map(item => item.shot_id)} options={design.direction.shots.map((shot, i) => ({ value: shot.id, label: `镜头 ${i + 1} · ${shot.visible_result.text || '待确定内容'}` }))} onChange={ids => patch(unit.id, { coverage: coverage(ids).map(row => unit.coverage.find(old => old.shot_id === row.shot_id) || row) })} />
        {unit.coverage.map(item => <div key={item.id} style={{ width: '100%' }}><Typography.Text type="secondary">动作范围 · {item.shot_id}</Typography.Text><Input.TextArea disabled={disabled} value={item.action_scope} onChange={event => patch(unit.id, { coverage: unit.coverage.map(row => row.id === item.id ? { ...row, action_scope: event.target.value } : row) })} /></div>)}
        {unit.coverage.length > 1 && <Alert type="warning" message="计划包含多个镜头，当前多镜执行能力未验证。保存并确认后，可在重组面板明确拆分。" />}
        </div><ProductionParameters>        <Space wrap>
          <span data-workspace-target={`unit-model:${unit.id}`} tabIndex={-1}><Select aria-label="视频模型" disabled={disabled} placeholder="选择视频模型" style={{ minWidth: 220 }} value={unit.model_id || undefined} options={models.map(model => ({ value: model.id, label: model.name }))} onChange={model_id => patch(unit.id, { model_id })} /></span>
          <span>时长（秒）</span><InputNumber disabled={disabled} min={1} precision={0} value={unit.duration_ms / 1000} onChange={seconds => patch(unit.id, { duration_ms: (seconds || 1) * 1000 })} />
          <Select aria-label="画幅" disabled={disabled} value={unit.ratio} options={['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'].map(ratio => ({ value: ratio, label: ratio }))} onChange={ratio => patch(unit.id, { ratio })} />
          <details><summary>更多拍摄设置</summary><span>种子（可留空）</span><InputNumber disabled={disabled} min={-1} precision={0} value={typeof unit.parameters?.seed === 'number' ? unit.parameters.seed : null} onChange={seed => patch(unit.id, { parameters: seed === null ? Object.fromEntries(Object.entries(unit.parameters || {}).filter(([key]) => key !== 'seed')) : { ...unit.parameters, seed } })} /></details>
        </Space>
</ProductionParameters>
        <div hidden={!!inputSection && inputSection !== 'dependency'}><DependencyEditor projectId={projectId} workspace={workspace} unit={unit} onChange={update => patch(unit.id, update)} disabled={disabled} /></div>
        <div hidden={!!inputSection && inputSection !== 'reference'}><Typography.Text strong>本次模型输入</Typography.Text>
        {!activeCapability && <Alert type={capabilityError ? 'warning' : 'info'} message={capabilityError || (unit.model_id ? '正在核实模型参考能力' : '请选择视频模型')} action={capabilityError && <Button onClick={() => setAttempt(attempt + 1)}>重试读取能力</Button>} />}
        {activeCapability && <Typography.Text type="secondary">{activeCapability.subject_images ? `支持主体图片${activeCapability.max_images_per_subject != null ? `，每个主体最多 ${activeCapability.max_images_per_subject} 张` : '，数量上限未知'}` : '不支持主体图片'}；{activeCapability.frame_roles.length ? `帧位置：${activeCapability.frame_roles.map(role => referenceRoles[role]).join('、')}${activeCapability.max_frames != null ? `，最多 ${activeCapability.max_frames} 张` : '，总数上限待核实'}` : '不支持帧参考'}。以提交检查为准。</Typography.Text>}
        {referenceIssues(unit.references, activeCapability).map(message => <Alert key={message} type="warning" message={message} />)}
        {!unit.references.length && <Typography.Text type="secondary">本次不发送图片。能否纯文本试拍仍需模型检查。</Typography.Text>}
        {referenceGroups(unit.references).map(group => {
          const ref = group[0]
          const groupIds = new Set(group.map(item => item.id))
          const update = (change: Partial<ReferenceBinding_Input>) => patch(unit.id, { references: unit.references.map(item => groupIds.has(item.id) ? { ...item, ...change } : item) })
          return <Card key={ref.subject_group_id || ref.id} size="small" style={{ width: '100%' }} title={`${ref.asset_origin?.name || ref.participant_ids.map(id => design.participants.find(person => person.id === id)?.name || id).join('、') || '画面参考'} · ${referenceRoles[ref.input_role || 'subject']}`}>
            <Space direction="vertical" style={{ width: '100%' }}>
              <Space wrap>{group.map(item => <Space key={item.id} direction="vertical"><ReferencePreview reference={item} />
                <span>{item.media_kind === 'image' ? '图片' : item.media_kind === 'video' ? '视频' : '声音'} {item.ordinal + 1}</span>
                {!disabled && <Space><Button size="small" disabled={unit.references.indexOf(item) === 0} onClick={() => {
                  const next = [...unit.references]; const index = next.indexOf(item); [next[index - 1], next[index]] = [next[index], next[index - 1]]
                  patch(unit.id, { references: next.map((row, ordinal) => ({ ...row, ordinal })) })
                }}>上移</Button><Button size="small" danger onClick={() => patch(unit.id, { references: unit.references.filter(row => row.id !== item.id).map((row, ordinal) => ({ ...row, ordinal })) })}>移除</Button></Space>}
              </Space>)}</Space>
              <Typography.Text type="secondary">{ref.asset_origin ? `来源：${ref.asset_origin.name} · 选择时的资产记录` : '来源：人工选入素材'}{ref.subject_group_id ? ` · 同一主体 ${group.length} 份素材` : ''}</Typography.Text>
              <Space wrap><Select aria-label="参考用途" disabled={disabled} value={ref.purpose} style={{ width: 150 }} options={Object.entries(referencePurposes).map(([value, label]) => ({ value, label }))} onChange={purpose => update({ purpose })} />
                <Select aria-label="参考输入位置" disabled={disabled} value={ref.input_role || 'subject'} style={{ width: 145 }} options={Object.entries(referenceRoles).map(([value, label]) => ({ value, label, disabled: value !== (ref.input_role || 'subject') && (group.length > 1 && value !== 'subject' || !!activeCapability && (value === 'subject' ? !activeCapability.subject_images : !activeCapability.frame_roles.includes(value as 'first_frame'))) }))} onChange={input_role => update({ input_role, subject_group_id: input_role === 'subject' ? ref.subject_group_id || 'group-' + crypto.randomUUID().slice(0, 8) : undefined })} />
                <Select aria-label="参考对应人物或物件" mode="multiple" disabled={disabled || !!ref.asset_origin} placeholder="绑定人物/物件" style={{ minWidth: 180, maxWidth: '100%' }} value={ref.participant_ids} options={design.participants.map(person => ({ value: person.id, label: person.name }))} onChange={participant_ids => update({ participant_ids })} />
                <SourceLinks sources={[ref.source]} />
              </Space>
            </Space>
          </Card>
        })}
        {!disabled && <Button onClick={() => setPicker(unit.id)}>添加参考</Button>}
        <Alert type="info" message={`拟发送：${referenceSummary(unit.references)}`} description="仅包含当前单元已选素材；保存并确认后进入指令检查。" />
        </div>
      </Space>
    </Card>)}
    </div>
    {!disabled && <Button disabled={!design.direction.shots.length} onClick={() => onChange({ ...value, units: [...value.units, { id: 'unit-' + crypto.randomUUID().slice(0, 8), coverage: coverage([design.direction.shots[0].id]), references: [], model_id: defaultModel, duration_ms: 5000, ratio: '16:9', capability: { multi_shot: 'unknown' } }] })}>新增试拍 / 补拍单元</Button>}
    {!disabled && picker && picker === selected?.id && <ReferencePicker key={`${planId}:${value.design_revision_id}:${picker}:${selected.model_id}`} projectId={projectId} assets={assets} assetError={assetError} onReloadAssets={onReloadAssets} design={design} references={selected.references} capability={activeCapability} onAdd={addReference} onClose={() => setPicker(undefined)} />}
  </Space>
}
