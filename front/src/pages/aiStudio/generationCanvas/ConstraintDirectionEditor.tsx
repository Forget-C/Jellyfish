import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopeEditor } from './DesignScopeEditor'
import { soundConstraintPresets } from './soundConstraintPresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert, Select } from 'antd'
import type { SpaceRuleCard, ContinuityCard, ImmutableFactCard, DesignField, CanvasResolvedOutput } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'
import { useGraphRules } from './CanvasCatalogContext'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

export type ConstraintCard = SpaceRuleCard | ContinuityCard | ImmutableFactCard
const categoryOptions = [{ value: 'space', label: '空间' }, { value: 'appearance', label: '造型' }, { value: 'hands_props', label: '手部与道具' }, { value: 'environment', label: '环境' }, { value: 'photography', label: '摄影' }, { value: 'dialogue_sound', label: '对白与声音' }]
const labels = { spatial_basis: '空间依据', shootable_area: '可拍区域', axis: '轴线', scale: '空间尺度', before: '前态', change: '变化', after: '后态', following_constraints: '后续约束', fact: '不可改事实', source_basis: '来源依据' }

function eligible(port: string, item: CanvasResolvedOutput) {
  const payload = item.payload
  if (!payload) return false
  if (payload.kind === 'object_reference' && 'category' in payload) return port === 'effect_object' || port === 'space' && payload.category === 'place' || port === 'participant' && payload.category !== 'place'
  return port === 'effect_object' && ['narrative_reference', 'spatial_reference'].includes(payload.kind || '') || payload.kind === 'narrative_reference' && 'category' in payload && port === 'related_event' && payload.category === 'event'
}

/** 约束卡编辑本卡设计与明确身份关系；素材使用统一候选，字段实际引用按整卡携带。 */
export function ConstraintDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions, inputPorts, portLabels } = useGraphRules()
  const card = raw as ConstraintCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const keys = (card.type === 'direction.space_rule' ? ['spatial_basis', 'shootable_area', 'axis', 'scale'] : card.type === 'direction.continuity' ? ['before', 'change', 'after', 'following_constraints'] : ['fact', 'source_basis']) as (keyof typeof labels)[]
  const fields = Object.fromEntries(designFieldEntries(card))
  const missingBindings = bindings.filter(binding => !resolved.candidates.some(item => item.available && sourceKey(item.source) === sourceKey(binding.source)))
  const relationRows = resolved.candidates.map(item => {
    const payload = item.payload
    if (!payload || !('name' in payload)) return null
    const ports = inputPorts(card).filter(port => eligible(port, item) && document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id))
    if (!ports.length) return null
    return <div key={sourceKey(item.source)}><span>{payload.name}</span>{ports.map(port => {
      const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
      return <WorkbenchButton key={port} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{`${binding ? '取消' : '选择'}${portLabels[port]} ${payload.name}`}</WorkbenchButton>
    })}</div>
  }).filter(Boolean)
  const hasRelations = relationRows.length > 0 || missingBindings.length > 0
  const relations = (hasRelations || card.type === 'direction.continuity') && <details><summary>对象与制作关系</summary>    {hasRelations && <section aria-label="约束关系"><h3>直接关系候选与已采用</h3>{relationRows}{missingBindings.map(binding => <div key={binding.id}><span role="alert">已选关系失效</span><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}</section>}    {card.type === 'direction.continuity' && <Select aria-label="连续性分类" value={card.category || 'space'} options={categoryOptions} onChange={category => onChange({ ...card, category })} />}</details>
  return <DesignPresetEditor fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={soundConstraintPresets(card)} direct={card.type === 'direction.fact'} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} relations={card.type === 'direction.fact' ? undefined : relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as typeof card)}>


    {keys.map(key => <DesignFieldEditor compact key={key} label={labels[key]} purpose={['spatial_basis', 'source_basis'].includes(key) ? 'background' : ['before', 'change', 'after'].includes(key) ? 'design' : 'constraint'} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />)}
    {resolved.error && <Alert type="warning" message={resolved.error} />}

    <DesignScopeEditor card={card} disabled={disabled} onChange={onChange} />
  </DesignPresetEditor>
}
