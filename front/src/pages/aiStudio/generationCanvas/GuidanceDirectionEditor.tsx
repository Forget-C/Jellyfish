import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopeEditor } from './DesignScopeEditor'
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
import { sourceKey } from './promptRules'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignMediaExamples } from './DesignMediaExamples'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'

export type GuidanceCard = AcceptanceCriterionCard | CreativeControlCard | GenerationGuidanceCard

/** 要求正文、明确对象关系、固定示例和只读使用记录分别展示。 */
export function GuidanceDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign, requirementNameValidationRequested }: CardRendererProps) {
  const { cardDefinitions, cardTitles, inputPorts } = useGraphRules()
  const card = raw as GuidanceCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const nameInvalid = card.type === 'direction.criterion' && !!requirementNameValidationRequested && !card.name?.trim()
  const bindings = card.input_bindings || []
  const field = (key: string, label: string, purpose: DesignField['purpose'] = 'design') => <DesignFieldEditor compact key={key} label={label} purpose={purpose} value={(card as unknown as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, [key]: value })} />
  const users = document.cards?.filter(consumer => 'input_bindings' in consumer && consumer.input_bindings?.some(binding => binding.input_port === 'acceptance_basis' && binding.source.card_id === card.id && binding.source.port_id === 'criterion')) || []
  const fields = Object.fromEntries(designFieldEntries(card))
  const objects = <details><summary>作用对象</summary>
      {resolved.candidates.filter(item => ['object_reference', 'spatial_reference', 'narrative_reference'].includes(item.payload?.kind || '') && !(card.type === 'direction.criterion' && item.payload?.kind === 'narrative_reference' && 'category' in item.payload && item.payload.category === 'shot')).map(item => {
        const bound = bindings.find(binding => binding.input_port === 'effect_object' && sourceKey(binding.source) === sourceKey(item.source))
        const name = item.payload && 'name' in item.payload ? item.payload.name : ''
        return <WorkbenchButton key={sourceKey(item.source)} disabled={disabled || !item.available} onClick={() => onChange({ ...card, input_bindings: bound ? bindings.filter(value => value.id !== bound.id) : [...bindings, { id: crypto.randomUUID(), input_port: 'effect_object', source: item.source }] })}>{`${bound ? '取消' : '选择'}作用对象 ${name}`}</WorkbenchButton>
      })}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><small role="alert">已选对象失效</small><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效对象</WorkbenchButton></div>)}
    </details>
  const nameLabel = card.type === 'direction.criterion' ? '验收要求名称' : card.type === 'direction.creative_control' ? '创作控制名称' : '生成指导名称'
  const namePlaceholder = card.type === 'direction.criterion' ? '例如：手部与钥匙清晰可见' : card.type === 'direction.creative_control' ? '例如：主角造型保持原则' : '例如：反应镜头生成指导'
  const relations = <div className="design-named-relations">
    <DesignNameField label={nameLabel} placeholder={namePlaceholder} value={card.name} disabled={disabled} error={nameInvalid ? '请先填写验收要求名称' : undefined} onChange={name => onChange({ ...card, name })} />
    {card.type !== 'direction.criterion' && objects}
  </div>
  return <DesignPresetEditor fields={fields} labels={Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))} presets={soundConstraintPresets(card)} direct={false} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} relations={relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as typeof card)}>


    {card.type === 'direction.creative_control' && <>{field('freedom', '创作控制程度')}{field('allowed_range', '允许发挥范围')}{field('keep', '需要保持', 'constraint')}{field('undecided', '待确定事项')}</>}
    {card.type === 'direction.guidance' && <>{field('priority', '编译优先级')}{field('reference_requirements', '参考绑定要求')}{field('sound_strategy', '声音策略')}{field('prohibitions', '禁止项', 'constraint')}</>}
    {card.type === 'direction.criterion' && <>{field('standard', '可观察判断标准', 'constraint')}<section role="region" aria-label="被使用记录"><h3>被使用记录 · 只读</h3>{users.length ? users.map(consumer => <p key={consumer.id}>{'name' in consumer && consumer.name || cardTitles[consumer.type || ''] || consumer.type}</p>) : <small>尚未被采用</small>}</section></>}
    {resolved.error && <Alert type="warning" message={resolved.error} />}

    <DesignMediaExamples fieldOptions={cardDefinitions[card.type!].fields.map(field => ({value:field.id,label:field.label}))} ports={inputPorts(card)} examples={card.examples || []} candidates={resolved.candidates} disabled={disabled} onChange={examples => onChange({ ...card, examples })} />
    <DesignScopeEditor card={card} disabled={disabled} onChange={onChange} />
    <details aria-label="完整要求输出"><summary>查看已保存完整要求 · revision {resolved.revision}</summary>{resolved.outputs.filter(item => item.source.port_id === 'text').map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整要求" />)}</details>
  </DesignPresetEditor>
}
