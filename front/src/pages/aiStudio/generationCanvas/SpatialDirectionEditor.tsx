import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopeEditor } from './DesignScopeEditor'
import { performancePresets } from './performancePresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert, Input, InputNumber, Select, Space } from 'antd'
import type { SpatialAnchorCard, BlockingDirectionCard, InFrameActivityCard, EnvironmentActivityCard, ObjectReferencePayload, SpatialReferencePayload, NarrativeReferencePayload } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { MediaPreview } from './MediaContentEditor'

export type SpatialCard = SpatialAnchorCard | BlockingDirectionCard | InFrameActivityCard | EnvironmentActivityCard

function AnchorFields({ card, onChange }: { card: SpatialAnchorCard; onChange: (card: SpatialCard) => void }) {
  return <div className="design-preset-fields performance-parameters">
    <Input aria-label="锚点名称" value={card.name} onChange={event => onChange({ ...card, name: event.target.value })} />
    <small className="performance-identity">锚点身份：{card.anchor_id || '未建立'}</small>
    <FieldEditor compact label="位置" value={card.position} onChange={position => onChange({ ...card, position })} />
    <FieldEditor compact label="方位与朝向" value={card.orientation} onChange={orientation => onChange({ ...card, orientation })} />
    <FieldEditor compact label="空间关系" value={card.spatial_relation} onChange={spatial_relation => onChange({ ...card, spatial_relation })} />
    <FieldEditor compact label="尺度依据" value={card.scale} onChange={scale => onChange({ ...card, scale })} />
  </div>
}

function BlockingFields({ card, onChange }: { card: BlockingDirectionCard; onChange: (card: SpatialCard) => void }) {
  return <div className="design-preset-fields performance-parameters"><Input aria-label="调度名称" value={card.name} onChange={event => onChange({ ...card, name: event.target.value })} /><small className="performance-identity">调度身份：{card.blocking_id || '未建立'}</small>
    <h3>位置 → 路径 → 状态切换</h3>
    <FieldEditor compact label="位置" value={card.position} onChange={position => onChange({ ...card, position })} />
    <FieldEditor compact label="路径" value={card.path} onChange={path => onChange({ ...card, path })} />
    <FieldEditor compact label="方位与朝向" value={card.orientation} onChange={orientation => onChange({ ...card, orientation })} />
    <FieldEditor compact label="主动权" value={card.initiative} onChange={initiative => onChange({ ...card, initiative })} />
    <FieldEditor compact label="状态切换原因" value={card.transition_reason} onChange={transition_reason => onChange({ ...card, transition_reason })} />

  </div>
}

function ActivityFields({ card, onChange }: { card: InFrameActivityCard; onChange: (card: SpatialCard) => void }) {
  return <div className="design-preset-fields performance-parameters"><h3>谁在做什么</h3>
    <FieldEditor compact label="持续任务" value={card.task} onChange={task => onChange({ ...card, task })} />
    <FieldEditor compact label="对主戏的作用" value={card.main_action_effect} onChange={main_action_effect => onChange({ ...card, main_action_effect })} />
    <FieldEditor compact label="结束状态" value={card.exit_state} onChange={exit_state => onChange({ ...card, exit_state })} />
    <section aria-label="位置、注意对象与时序"><h3>位置、注意对象与时序</h3>
      <FieldEditor compact label="注意对象说明" value={card.attention} onChange={attention => onChange({ ...card, attention })} />
      <FieldEditor compact label="路径" value={card.path} onChange={path => onChange({ ...card, path })} />
      <FieldEditor compact label="反应延迟依据" value={card.delay_basis} onChange={delay_basis => onChange({ ...card, delay_basis })} />
      <label>反应延迟毫秒<InputNumber aria-label="反应延迟毫秒" min={0} value={card.delay_ms} onChange={delay_ms => onChange({ ...card, delay_ms })} /></label>
      <FieldEditor compact label="入出画" value={card.entry_exit} onChange={entry_exit => onChange({ ...card, entry_exit })} />
      <FieldEditor compact label="景深层次" value={card.depth} onChange={depth => onChange({ ...card, depth })} />
      <FieldEditor compact label="活动强度" value={card.intensity} onChange={intensity => onChange({ ...card, intensity })} />

    </section>
  </div>
}

function EnvironmentFields({ card, onChange }: { card: EnvironmentActivityCard; onChange: (card: SpatialCard) => void }) {
  return <div className="design-preset-fields performance-parameters"><FieldEditor compact label="环境活动" value={card.activity} onChange={activity => onChange({ ...card, activity })} />
    <FieldEditor compact label="刻意留白" value={card.empty_space} onChange={empty_space => onChange({ ...card, empty_space })} />
    <FieldEditor compact label="留白理由" value={card.reason} onChange={reason => onChange({ ...card, reason })} />
  </div>
}

/** 四种空间设计复用预设与字段引用；关系仍只采用明确身份。 */
export function SpatialDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions, inputPorts, portLabels } = useGraphRules()
  const card = raw as SpatialCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || [], examples = card.examples || []
  const update = (next: SpatialCard) => onChange(next)
  const fields = Object.fromEntries(designFieldEntries(card))
  const labels = Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))
  const relations = <>

    {resolved.error && <Alert type="warning" message={resolved.error} />}
    <section aria-label="空间关系"><h3>直接对象与空间关系</h3>
      {resolved.candidates.map(item => {
        const rawPayload = item.payload
        if (rawPayload?.kind !== 'object_reference' && rawPayload?.kind !== 'spatial_reference' && rawPayload?.kind !== 'narrative_reference') return null
        const payload = rawPayload as ObjectReferencePayload | SpatialReferencePayload | NarrativeReferencePayload
        return <div key={sourceKey(item.source)}><span>{payload.name}</span>{inputPorts(card).filter(port => ['space', 'participant', 'effect_object', 'position_anchor', 'area_anchor', 'change_event', 'trigger_event'].includes(port)).filter(port => document.edges?.some(edge => edge.source_card === item.source.card_id && edge.source_port === item.source.port_id && edge.target_card === card.id && edge.target_port === port)).map(port => {
          if (port === 'participant' && (payload.kind !== 'object_reference' || payload.category === 'place')) return null
          if (port === 'space' && (payload.kind !== 'object_reference' || payload.category !== 'place')) return null
          const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
          const single = ['participant', 'space', 'area_anchor', 'change_event', 'trigger_event'].includes(port)
          return <WorkbenchButton key={port} disabled={disabled || !binding && single && bindings.some(value => value.input_port === port)} onClick={() => update({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{`${binding ? '取消' : '选择'}${portLabels[port]} ${payload.name}`}</WorkbenchButton>
        })}</div>
      })}
      {bindings.filter(binding => !resolved.candidates.some(item => item.available && sourceKey(item.source) === sourceKey(binding.source))).map(binding => <div key={binding.id}><small role="alert">已选关系失效</small><WorkbenchButton disabled={disabled} onClick={() => update({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}
    </section>
  </>
  return <DesignPresetEditor fields={fields} labels={labels} presets={performancePresets[card.type!.split('.')[1]] || []} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} direct={card.type === 'direction.anchor'} relations={card.type === 'direction.environment' ? undefined : relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as SpatialCard)}>
    <div className={card.type === 'direction.anchor' ? 'design-anchor-layout' : undefined}><div>
    {card.type === 'direction.anchor' ? <AnchorFields card={card as SpatialAnchorCard} onChange={update} /> : card.type === 'direction.blocking' ? <BlockingFields card={card as BlockingDirectionCard} onChange={update} /> : card.type === 'direction.activity' ? <ActivityFields card={card as InFrameActivityCard} onChange={update} /> : <EnvironmentFields card={card as EnvironmentActivityCard} onChange={update} />}
    <DesignScopeEditor card={card} onChange={update} disabled={disabled} />
    </div><div>
    <details open={card.type === 'direction.anchor'}><summary>参考素材与图片标记</summary>
      {resolved.candidates.filter(item => ['image', 'video'].includes(item.modality) && item.file_id).map(item => <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available || examples.some(value => sourceKey(value.source) === sourceKey(item.source) && value.file_id === item.file_id)} onClick={() => update({ ...card, examples: [...examples, { id: crypto.randomUUID(), source: item.source, file_id: item.file_id! }] })}>关联素材 {item.token}</WorkbenchButton>)}
      {examples.map(example => {
        const change = (patch: Partial<typeof example>) => update({ ...card, examples: examples.map(value => value.id === example.id ? { ...value, ...patch } : value) })
        const anchor = card.type === 'direction.anchor' ? card as SpatialAnchorCard : undefined
        const marker = anchor?.markers?.find(value => value.example_id === example.id)
        return <section key={example.id}><div style={{ position: 'relative', display: 'inline-block', maxWidth: '100%' }}><MediaPreview fileId={example.file_id} type={example.source.port_id === 'video' ? 'video' : 'image'} />{marker && <span aria-label={`锚点图片标记 ${anchor?.name || ''}`} style={{ position: 'absolute', left: `${marker.x * 100}%`, top: `${marker.y * 100}%`, transform: 'translate(-50%, -50%)', pointerEvents: 'none' }}>⊕</span>}</div>
          <Select aria-label="素材用途" disabled={disabled} value={example.purpose} options={[{value:'positive',label:'正向示例'},{value:'negative',label:'反例'}]} onChange={purpose=>change({purpose})}/>
          <Select aria-label="素材定位字段" placeholder="选择定位字段" style={{width:180,maxWidth:'100%'}} disabled={disabled} allowClear value={example.field_id || undefined} options={cardDefinitions[card.type!].fields.map(field=>({value:field.id,label:field.label}))} onChange={field_id=>change({field_id:field_id??null})}/>
          <Input aria-label="素材说明" value={example.description} onChange={event => change({ description: event.target.value })} />
          {anchor && example.source.port_id === 'image' && <Space wrap><span>归一化图片标记</span><InputNumber aria-label="标记横坐标" min={0} max={1} step={0.01} value={marker?.x} onChange={x => update({ ...anchor, markers: [...(anchor.markers || []).filter(value => value.example_id !== example.id), { example_id: example.id, x: x ?? 0.5, y: marker?.y ?? 0.5 }] })} /><InputNumber aria-label="标记纵坐标" min={0} max={1} step={0.01} value={marker?.y} onChange={y => update({ ...anchor, markers: [...(anchor.markers || []).filter(value => value.example_id !== example.id), { example_id: example.id, x: marker?.x ?? 0.5, y: y ?? 0.5 }] })} /></Space>}
          {example.source.port_id === 'video' && <Space wrap><InputNumber aria-label="素材起点毫秒" min={0} value={example.start_ms} onChange={start => change(start === null ? { start_ms: null, end_ms: null } : { start_ms: start, end_ms: Math.max(example.end_ms || 0, start + 1) })} /><InputNumber aria-label="素材终点毫秒" min={(example.start_ms || 0) + 1} value={example.end_ms} onChange={end => change(end === null ? { start_ms: null, end_ms: null } : { start_ms: example.start_ms || 0, end_ms: end })} /></Space>}
          <WorkbenchButton disabled={disabled} onClick={() => update({ ...card, examples: examples.filter(value => value.id !== example.id), ...(anchor ? { markers: anchor.markers?.filter(value => value.example_id !== example.id) } : {}) })}>取消素材</WorkbenchButton>
        </section>
      })}
    </details>    </div></div>

    <details aria-label="完整空间设计输出"><summary>查看已保存完整设计 · revision {resolved.revision}</summary>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整空间设计" />)}</details>
  </DesignPresetEditor>
}

export function spatialSummary(card: SpatialCard) {
  const preferred = card.type === 'direction.anchor' ? [(card as SpatialAnchorCard).position]
    : card.type === 'direction.blocking' ? [(card as BlockingDirectionCard).position, (card as BlockingDirectionCard).path]
    : card.type === 'direction.activity' ? [(card as InFrameActivityCard).task, (card as InFrameActivityCard).exit_state]
    : [(card as EnvironmentActivityCard).activity, (card as EnvironmentActivityCard).empty_space]
  const summary = designSummary(preferred, Object.values(card))
  if (summary) return summary
  return card.type === 'direction.anchor' ? `${card.name || '未命名锚点'} · 位置待定` : card.type === 'direction.blocking' ? `${card.name || '未命名调度'} · 位置待定 → 路径待定` : card.type === 'direction.activity' ? '持续任务待定 → 结束状态待定' : '活动待定 · 留白待定'
}
