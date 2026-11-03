import { Input, Select } from 'antd'
import { VisualDesignRelations } from './VisualDesignRelations'
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
  const fields = card.fields || {}, labels = photographyRegions[kind].fields
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets[kind]} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) } as StaticVisualDesignCard)}>
    <div className="design-preset-fields">{Object.entries(labels).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={(fields as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } } as StaticVisualDesignCard)} />)}</div>
    <VisualDesignRelations card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
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
