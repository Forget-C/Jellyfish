import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopeEditor } from './DesignScopeEditor'
import { performancePresets } from './performancePresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import { Alert } from 'antd'
import type { CharacterPerformanceCard, CharacterSituationCard, DialogueReferencePayload, PerformanceRuleCard, ObjectReferencePayload, NarrativeReferencePayload } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useCardCandidates } from './useCardCandidates'
import { useGraphRules } from './CanvasCatalogContext'
import { sourceKey } from './promptRules'
import { CanvasTextPreview } from '../directing/CanvasTextPreview'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'

export type PerformanceCard = CharacterPerformanceCard | CharacterSituationCard | PerformanceRuleCard

function SituationFields({ card, onChange }: { card: CharacterSituationCard; onChange: (card: PerformanceCard) => void }) {
  return <div className="design-preset-fields"><FieldEditor compact label="当前处境" purpose="background" value={card.situation} onChange={situation => onChange({ ...card, situation })} />
    <FieldEditor compact label="人物关系" purpose="background" value={card.relationship} onChange={relationship => onChange({ ...card, relationship })} /></div>
}

function PerformanceFields({ card, onChange }: { card: CharacterPerformanceCard; onChange: (card: PerformanceCard) => void }) {
  return <>
    <section className="performance-field-group" aria-label="触发反应动作结束"><h3>触发 → 反应 → 动作 → 结束状态</h3>
      <FieldEditor compact label="反应顺序" value={card.reaction_order} onChange={reaction_order => onChange({ ...card, reaction_order })} />
      <FieldEditor compact label="身体动作" value={card.physical_action} onChange={physical_action => onChange({ ...card, physical_action })} />
      <FieldEditor compact label="结束状态" value={card.exit_state} onChange={exit_state => onChange({ ...card, exit_state })} />
    </section>
    <section className="performance-field-group" aria-label="背景与注意对象"><h3>背景与注意对象</h3>
      <FieldEditor compact label="人物目标" purpose="background" value={card.objective} onChange={objective => onChange({ ...card, objective })} />
      <FieldEditor compact label="阻碍" purpose="background" value={card.obstacle} onChange={obstacle => onChange({ ...card, obstacle })} />
      <FieldEditor compact label="潜台词" purpose="background" value={card.subtext} onChange={subtext => onChange({ ...card, subtext })} />
      <FieldEditor compact label="注意对象说明" purpose="background" value={card.attention} onChange={attention => onChange({ ...card, attention })} />
      <FieldEditor compact label="内在调整" purpose="background" value={card.internal_adjustment} onChange={internal_adjustment => onChange({ ...card, internal_adjustment })} />
    </section>
    <section className="performance-field-group" aria-label="表演细节与约束"><h3>表演细节与约束</h3>
      <FieldEditor compact label="目光" value={card.gaze} onChange={gaze => onChange({ ...card, gaze })} />
      <FieldEditor compact label="呼吸" value={card.breath} onChange={breath => onChange({ ...card, breath })} />
      <FieldEditor compact label="重心" value={card.weight} onChange={weight => onChange({ ...card, weight })} />
      <FieldEditor compact label="手部" value={card.hands} onChange={hands => onChange({ ...card, hands })} />
      <FieldEditor compact label="声音表现" value={card.voice} onChange={voice => onChange({ ...card, voice })} />
      <FieldEditor compact label="表达方式" value={card.delivery} onChange={delivery => onChange({ ...card, delivery })} />
      <FieldEditor compact label="避免的表现" purpose="constraint" value={card.avoid} onChange={avoid => onChange({ ...card, avoid })} />
    </section>
  </>
}

/** 明确对象采用及本卡专用设计字段；正式输出只读取后端保存修订。 */
export function PerformanceDirectionEditor({ card: raw, document, savedRevision, modelOutputs, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions, inputPorts, portLabels } = useGraphRules()
  const card = raw as PerformanceCard
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const update = (next: PerformanceCard) => onChange(next)
  const fields = Object.fromEntries(designFieldEntries(card))
  const labels = Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))
  const relations = <>

    {resolved.error && <Alert type="warning" message={resolved.error} />}
    {card.type !== 'direction.performance_rule' && <section aria-label="对象关系"><h3>对象关系</h3>
      {resolved.candidates.filter(item => item.payload?.kind === 'object_reference' || item.payload?.kind === 'narrative_reference').map(item => {
        const object = item.payload as ObjectReferencePayload | NarrativeReferencePayload
        if (object.kind !== 'object_reference' && object.kind !== 'narrative_reference') return null
        return <div key={sourceKey(item.source)}><span>{object.name} · {{ character: '人物', prop: '物件', costume: '服装', place: '场所', beat: '节拍', event: '事件', shot: '镜头' }[object.category]}</span>{inputPorts(card).filter(port => ['participant', 'effect_object', 'beat', 'received_event'].includes(port)).map(port => {
          if (port === 'participant' && (card.type === 'direction.performance_rule' || object.kind !== 'object_reference' || !['character', 'prop', 'costume'].includes(object.category))) return null
          if (!document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)) return null
          const binding = bindings.find(value => value.input_port === port && sourceKey(value.source) === sourceKey(item.source))
          const label = portLabels[port]
          const single = port === 'participant' || port === 'beat'
          return <WorkbenchButton key={port} disabled={disabled || !binding && single && bindings.some(value => value.input_port === port && value.source.object_id !== item.source.object_id)} onClick={() => update({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), source: item.source, input_port: port }] })}>{`${binding ? '取消' : '选择'}${label} ${object.name}`}</WorkbenchButton>
        })}</div>
      })}
      {!bindings.length && <small>尚未选择对象</small>}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><small role="alert">已采用对象缺失，请替换或取消</small><WorkbenchButton disabled={disabled} onClick={() => update({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效对象关系</WorkbenchButton></div>)}
    </section>}
    {card.type === 'direction.performance' && <section aria-label="对白依据"><h3>对白依据</h3>{resolved.candidates.filter(item => item.source.port_id === 'dialogue' && item.payload?.kind === 'dialogue_reference').map(item => {
      const binding = bindings.find(value => value.input_port === 'dialogue_basis' && sourceKey(value.source) === sourceKey(item.source))
      const payload = item.payload as DialogueReferencePayload
      return <div key={sourceKey(item.source)}><WorkbenchButton title={payload.dialogue_id} disabled={disabled || !item.available} onClick={() => update({ ...card, input_bindings: binding ? bindings.filter(value => value.id !== binding.id) : [...bindings, { id: crypto.randomUUID(), source: item.source, input_port: 'dialogue_basis' }] })}>{`${binding ? '取消' : '采用'}对白 ${payload.dialogue_id.slice(0, 8)} · 版本 ${payload?.version}`}</WorkbenchButton><p>说话对象：{payload.speaker?.name || '待确定'}</p></div>
    })}</section>}
  </>
  return <DesignPresetEditor fields={fields} labels={labels} presets={performancePresets[card.type!.split('.')[1]] || []} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} relations={relations} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as PerformanceCard)}>
    {card.type === 'direction.situation' ? <SituationFields card={card} onChange={update} /> : card.type === 'direction.performance' ? <PerformanceFields card={card} onChange={update} /> : <FieldEditor compact label="表演适用说明" purpose="constraint" value={(card as PerformanceRuleCard).applicability} onChange={applicability => update({ ...(card as PerformanceRuleCard), applicability })} />}
    <DesignScopeEditor card={card} onChange={update} disabled={disabled} />
    <details aria-label="完整设计输出"><summary>查看已保存完整设计 · revision {resolved.revision}</summary>{resolved.outputs.map(item => <CanvasTextPreview key={sourceKey(item.source)} text={item.text || ''} label="完整设计" />)}</details>
  </DesignPresetEditor>
}

export function performanceSummary(card: PerformanceCard) {
  const preferred = card.type === 'direction.situation' ? [(card as CharacterSituationCard).situation, (card as CharacterSituationCard).relationship]
    : card.type === 'direction.performance_rule' ? [(card as PerformanceRuleCard).applicability]
    : [(card as CharacterPerformanceCard).reaction_order, (card as CharacterPerformanceCard).physical_action, (card as CharacterPerformanceCard).exit_state]
  return designSummary(preferred, Object.values(card)) || (card.type === 'direction.situation' ? '未填写处境 · 未填写关系' : card.type === 'direction.performance_rule' ? '未填写表演适用规则' : '触发 → 反应待定 → 动作待定 → 结束状态待定')
}
