import { Input, Select, Alert } from 'antd'
import { WorkbenchButton } from '../directing/ui/WorkbenchButton'
import { AcceptanceBasisSelector } from './AcceptanceBasisSelector'
import { sourceKey } from './promptRules'
import { useCardCandidates } from './useCardCandidates'
import type { CameraCard, LightingCard, FocusCard, DesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions } from './photographyDesign'
import { designSummary } from './designSummary'
import { PresetIllustration } from './VisualPresetPicker'

export type StaticVisualDesignCard = CameraCard | LightingCard | FocusCard
const kindFor = (card: StaticVisualDesignCard) => (card.type || 'direction.camera').split('.')[1] as 'camera' | 'lighting' | 'focus'

/** Three independent field sets share editing behavior, never a hidden photography owner. */
export function StaticVisualDesignEditor({ card: raw, disabled, editorOpen, onUndoDesign, onChange, document, savedRevision, modelOutputs }: CardRendererProps) {
  const card = raw as StaticVisualDesignCard, kind = kindFor(card)
  const resolved = useCardCandidates(document.project_id, document.id, card.id, savedRevision, modelOutputs, false)
  const bindings = card.input_bindings || []
  const ports = kind === 'focus' ? ['effect_object', 'attention_object', 'focus_object'] : ['effect_object']
  const fields = card.fields || {}, labels = photographyRegions[kind].fields
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets[kind]} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) } as StaticVisualDesignCard)}>
    <div className="design-preset-fields">{Object.entries(labels).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={(fields as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } } as StaticVisualDesignCard)} />)}</div>
    <section className="static-design-relations" aria-label="对象与所属镜头">
      {resolved.candidates.filter(item => item.payload?.kind === 'object_reference' || item.payload?.kind === 'narrative_reference' && 'category' in item.payload && item.payload.category === 'shot').map(item => <div key={sourceKey(item.source)}>{[...ports, 'shot'].filter(port => document.edges?.some(edge => edge.target_card === card.id && edge.target_port === port && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id)).map(port => {
        const bound = bindings.find(binding => binding.input_port === port && sourceKey(binding.source) === sourceKey(item.source))
        const label = { effect_object: '作用对象', attention_object: '关注对象', focus_object: '焦点对象', shot: '所属镜头' }[port]
        return <WorkbenchButton key={port} disabled={disabled || !item.available || port === 'shot' && !bound && bindings.some(binding => binding.input_port === 'shot')} onClick={() => onChange({ ...card, input_bindings: bound ? bindings.filter(binding => binding.id !== bound.id) : [...bindings, { id: crypto.randomUUID(), input_port: port, source: item.source }] })}>{bound ? '取消' : '选择'}{label} {item.payload && 'name' in item.payload ? item.payload.name : ''}</WorkbenchButton>
      })}</div>)}
      {bindings.filter(binding => !resolved.candidates.some(item => sourceKey(item.source) === sourceKey(binding.source) && item.available)).map(binding => <div key={binding.id}><Alert type="warning" message="已采用关系来源缺失，请替换或取消" /><WorkbenchButton disabled={disabled} onClick={() => onChange({ ...card, input_bindings: bindings.filter(value => value.id !== binding.id) })}>取消失效关系</WorkbenchButton></div>)}
      <AcceptanceBasisSelector card={card} document={document} candidates={resolved.candidates} disabled={disabled} onChange={onChange} />
    </section>
    <div className="design-preset-fields static-design-scope">
      <label>适用范围<Input aria-label="设计适用范围" value={card.scope?.description} onChange={event => onChange({ ...card, scope: { ...card.scope, description: event.target.value } })} /></label>
      <label>制作阶段<Select aria-label="设计制作阶段" allowClear value={card.scope?.phase || undefined} options={[{ value: 'video', label: '画面／视频' }, { value: 'sound', label: '声音' }, { value: 'postproduction', label: '后期' }]} onChange={phase => onChange({ ...card, scope: { ...card.scope, phase: phase ?? null } })} /></label>
      <label>适用条件<Input aria-label="设计适用条件" value={card.scope?.condition} onChange={event => onChange({ ...card, scope: { ...card.scope, condition: event.target.value } })} /></label>
      <label>来源<Input aria-label="设计来源" value={card.source_locator} onChange={event => onChange({ ...card, source_locator: event.target.value })} /></label>
    </div>
  </DesignPresetEditor>
}

/** The illustration is a purpose guide; the adjacent text is the actual saved summary. */
export function StaticVisualDesignCardSummary({ card }: { card: StaticVisualDesignCard }) {
  const kind = kindFor(card), label = photographyRegions[kind].label
  const text = designSummary([], Object.values(card.fields || {}))
  return <section className="design-card-summary" aria-label={`${label}摘要`}><figure className="static-design-purpose" aria-label={`${label}用途示意`}><PresetIllustration preset={photographyPresets[kind][0]} /></figure>{text ? <p className="static-design-summary" title={text}>{text}</p> : <div className="design-card-empty"><strong>尚未填写{label}</strong><p>选择预设或直接填写设计参数</p></div>}</section>
}
