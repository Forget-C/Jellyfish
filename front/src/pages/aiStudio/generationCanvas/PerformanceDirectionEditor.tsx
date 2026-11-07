import { DesignParameterTabs } from './DesignParameterTabs'
import { PlayCircleOutlined, BulbOutlined, SlidersOutlined } from '@ant-design/icons'
import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopePopover } from './DesignScopePopover'
import { performancePresets } from './performancePresets'
import { applyPreset } from './visualPresets'
import { designFieldEntries } from './designFieldReferences'
import { designSummary } from './designSummary'
import type { CharacterPerformanceCard, CharacterSituationCard, PerformanceRuleCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { useGraphRules } from './CanvasCatalogContext'
import { ReferencedDesignFieldEditor as FieldEditor } from './DesignReferenceEditor'

export type PerformanceCard = CharacterPerformanceCard | CharacterSituationCard | PerformanceRuleCard

function SituationFields({ card, onChange }: { card: CharacterSituationCard; onChange: (card: PerformanceCard) => void }) {
  return <div className="design-preset-fields"><FieldEditor compact label="当前处境" purpose="background" value={card.situation} onChange={situation => onChange({ ...card, situation })} />
    <FieldEditor compact label="人物关系" purpose="background" value={card.relationship} onChange={relationship => onChange({ ...card, relationship })} /></div>
}

function PerformanceFields({ card, onChange, editorOpen }: { card: CharacterPerformanceCard; onChange: (card: PerformanceCard) => void; editorOpen?: boolean }) {
  return <DesignParameterTabs editorOpen={editorOpen} items={[
    { key: "action", fields: ["reaction_order", "physical_action", "exit_state"], label: <><PlayCircleOutlined /> 动作过程</>, children: <div className="design-preset-fields design-preset-fields-compact">
      <FieldEditor compact label="反应顺序" value={card.reaction_order} onChange={reaction_order => onChange({ ...card, reaction_order })} />
      <FieldEditor compact label="身体动作" value={card.physical_action} onChange={physical_action => onChange({ ...card, physical_action })} />
      <FieldEditor compact label="结束状态" value={card.exit_state} onChange={exit_state => onChange({ ...card, exit_state })} />
    </div> },
    { key: "motivation", fields: ["objective", "obstacle", "subtext", "attention", "internal_adjustment"], label: <><BulbOutlined /> 动机背景</>, children: <div className="design-preset-fields design-preset-fields-compact">
      <FieldEditor compact label="人物目标" purpose="background" value={card.objective} onChange={objective => onChange({ ...card, objective })} />
      <FieldEditor compact label="阻碍" purpose="background" value={card.obstacle} onChange={obstacle => onChange({ ...card, obstacle })} />
      <FieldEditor compact label="潜台词" purpose="background" value={card.subtext} onChange={subtext => onChange({ ...card, subtext })} />
      <FieldEditor compact label="注意对象说明" purpose="background" value={card.attention} onChange={attention => onChange({ ...card, attention })} />
      <FieldEditor compact label="内在调整" purpose="background" value={card.internal_adjustment} onChange={internal_adjustment => onChange({ ...card, internal_adjustment })} />
    </div> },
    { key: "details", fields: ["gaze", "breath", "weight", "hands", "voice", "delivery", "avoid"], label: <><SlidersOutlined /> 表现细节</>, children: <div className="design-preset-fields design-preset-fields-compact">
      <FieldEditor compact label="目光" value={card.gaze} onChange={gaze => onChange({ ...card, gaze })} />
      <FieldEditor compact label="呼吸" value={card.breath} onChange={breath => onChange({ ...card, breath })} />
      <FieldEditor compact label="重心" value={card.weight} onChange={weight => onChange({ ...card, weight })} />
      <FieldEditor compact label="手部" value={card.hands} onChange={hands => onChange({ ...card, hands })} />
      <FieldEditor compact label="声音表现" value={card.voice} onChange={voice => onChange({ ...card, voice })} />
      <FieldEditor compact label="表达方式" value={card.delivery} onChange={delivery => onChange({ ...card, delivery })} />
      <FieldEditor compact label="避免的表现" purpose="constraint" value={card.avoid} onChange={avoid => onChange({ ...card, avoid })} />
    </div> },
  ]} />
}

/** 明确对象采用及本卡专用设计字段；正式输出只读取后端保存修订。 */
export function PerformanceDirectionEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const { cardDefinitions } = useGraphRules()
  const card = raw as PerformanceCard
  const update = (next: PerformanceCard) => onChange(next)
  const fields = Object.fromEntries(designFieldEntries(card))
  const labels = Object.fromEntries(cardDefinitions[card.type!].fields.map(field => [field.id, field.label]))
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} onChange={update} disabled={disabled} editorOpen={editorOpen} />} fields={fields} labels={labels} presets={performancePresets[card.type!.split('.')[1]] || []} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, ...applyPreset(fields, preset) } as PerformanceCard)}>
    {card.type === 'direction.situation' ? <SituationFields card={card} onChange={update} /> : card.type === 'direction.performance' ? <PerformanceFields card={card} onChange={update} editorOpen={editorOpen} /> : <div className="design-preset-fields design-single-field"><FieldEditor compact label="表演适用说明" purpose="constraint" value={(card as PerformanceRuleCard).applicability} onChange={applicability => update({ ...(card as PerformanceRuleCard), applicability })} /></div>}
  </DesignPresetEditor>
}

export function performanceSummary(card: PerformanceCard) {
  const preferred = card.type === 'direction.situation' ? [(card as CharacterSituationCard).situation, (card as CharacterSituationCard).relationship]
    : card.type === 'direction.performance_rule' ? [(card as PerformanceRuleCard).applicability]
    : [(card as CharacterPerformanceCard).reaction_order, (card as CharacterPerformanceCard).physical_action, (card as CharacterPerformanceCard).exit_state]
  return designSummary(preferred, Object.values(card)) || (card.type === 'direction.situation' ? '未填写处境 · 未填写关系' : card.type === 'direction.performance_rule' ? '未填写表演适用规则' : '触发 → 反应待定 → 动作待定 → 结束状态待定')
}
