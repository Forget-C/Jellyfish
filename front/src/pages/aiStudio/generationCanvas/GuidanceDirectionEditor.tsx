import { useUiText } from '../../../uiText'
import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopePopover } from './DesignScopePopover'
import { soundConstraintPresets } from './soundConstraintPresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert } from 'antd'
import { DesignNameField } from './DesignNameField'
import type { AcceptanceCriterionCard, CreativeControlCard, GenerationGuidanceCard, DesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useGraphRules } from './CanvasCatalogContext'
import { useCardCandidates } from './useCardCandidates'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'

export type GuidanceCard = AcceptanceCriterionCard | CreativeControlCard | GenerationGuidanceCard

/** 要求正文直接编辑，素材复用统一候选区。 */
export function GuidanceDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign, requirementNameValidationRequested }: CardRendererProps) {
  const uiText = useUiText()
  const { cardDefinitions } = useGraphRules()
  const card = raw as GuidanceCard
  const resolved = useCardCandidates((document.project_id || ''), document.id, card.id, savedRevision, modelOutputs, false)
  const nameInvalid = card.type === 'direction.criterion' && !!requirementNameValidationRequested && !card.name?.trim()
  const field = (key: string, label: string, purpose: DesignField['purpose'] = 'design') => <DesignFieldEditor compact key={key} label={label} purpose={purpose} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />
  const fields = Object.fromEntries(designFieldEntries(card))
  const nameLabel = card.type === 'direction.criterion' ? uiText("验收要求名称") : card.type === 'direction.creative_control' ? uiText("创作控制名称") : uiText("生成指导名称")
  const namePlaceholder = card.type === 'direction.criterion' ? '例如：手部与钥匙清晰可见' : card.type === 'direction.creative_control' ? '例如：主角造型保持原则' : '例如：反应镜头生成指导'
  const relations = <DesignNameField label={nameLabel} placeholder={namePlaceholder} value={card.name} disabled={disabled} error={nameInvalid ? '请先填写验收要求名称' : undefined} onChange={name => onChange({ ...card, name })} />
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} disabled={disabled} onChange={onChange} editorOpen={editorOpen} />} fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={soundConstraintPresets(card)} direct={false} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} relations={relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as typeof card)}>


    <div className={card.type === 'direction.criterion' ? undefined : 'design-preset-fields design-preset-fields-compact'}>
    {card.type === 'direction.creative_control' && <>{field('freedom', uiText("创作控制程度"))}{field('allowed_range', uiText("允许发挥范围"))}{field('keep', uiText("需要保持"), 'constraint')}{field('undecided', uiText("待确定事项"))}</>}
    {card.type === 'direction.guidance' && <>{field('priority', uiText("编译优先级"))}{field('reference_requirements', uiText("参考绑定要求"))}{field('sound_strategy', uiText("声音策略"))}{field('prohibitions', uiText("禁止项"), 'constraint')}</>}
    {card.type === 'direction.criterion' && <>{field('standard', uiText("可观察判断标准"), 'constraint')}</>}
    </div>
    {resolved.error && <Alert type="warning" message={resolved.error} />}

  </DesignPresetEditor>
}
