import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopePopover } from './DesignScopePopover'
import { soundConstraintPresets } from './soundConstraintPresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert, Select } from 'antd'
import type { SpaceRuleCard, ContinuityCard, ImmutableFactCard, DesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { useCardCandidates } from './useCardCandidates'
import { useGraphRules } from './CanvasCatalogContext'

export type ConstraintCard = SpaceRuleCard | ContinuityCard | ImmutableFactCard
const categoryOptions = [{ value: 'space', label: '空间' }, { value: 'appearance', label: '造型' }, { value: 'hands_props', label: '手部与道具' }, { value: 'environment', label: '环境' }, { value: 'photography', label: '摄影' }, { value: 'dialogue_sound', label: '对白与声音' }]
const labels = { spatial_basis: '空间依据', shootable_area: '可拍区域', axis: '轴线', scale: '空间尺度', before: '前态', change: '变化', after: '后态', following_constraints: '后续约束', fact: '不可改事实', source_basis: '来源依据' }

/** 约束卡编辑本卡设计与明确身份关系；素材使用统一候选，字段实际引用按整卡携带。 */
export function ConstraintDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions } = useGraphRules()
  const card = raw as ConstraintCard
  const resolved = useCardCandidates((document.project_id || ''), document.id, card.id, savedRevision, modelOutputs, false)
  const keys = (card.type === 'direction.space_rule' ? ['spatial_basis', 'shootable_area', 'axis', 'scale'] : card.type === 'direction.continuity' ? ['before', 'change', 'after', 'following_constraints'] : ['fact', 'source_basis']) as (keyof typeof labels)[]
  const fields = Object.fromEntries(designFieldEntries(card))
  const category = card.type === 'direction.continuity' && <label className="design-continuity-category">连续性分类 <Select size="small" aria-label="连续性分类" value={card.category || 'space'} options={categoryOptions} onChange={category => onChange({ ...card, category })} /></label>
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} disabled={disabled} onChange={onChange} editorOpen={editorOpen} />} fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={soundConstraintPresets(card)} direct={card.type === 'direction.fact'} current={designSummary(card.type === 'direction.continuity' && card.category && card.category !== 'space' ? [{ text: categoryOptions.find(option => option.value === card.category)?.label }] : [], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} category={card.type === 'direction.continuity' ? { value: card.category || 'space', labels: Object.fromEntries(categoryOptions.map(option => [option.value, option.label])) } : undefined} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset), ...(card.type === 'direction.continuity' && preset.category ? { category: preset.category } : {}) } as typeof card)}>


    {category}
    <div className="design-preset-fields design-preset-fields-compact">
    {keys.map(key => <DesignFieldEditor compact key={key} label={labels[key]} purpose={['spatial_basis', 'source_basis'].includes(key) ? 'background' : ['before', 'change', 'after'].includes(key) ? 'design' : 'constraint'} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />)}
    </div>
    {resolved.error && <Alert type="warning" message={resolved.error} />}

  </DesignPresetEditor>
}
