import { DesignScopeEditor } from './DesignScopeEditor'
import type { VisualStyleCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, styleLabels, stylePresets } from './visualPresets'
import { designSummary } from './designSummary'

/** 风格预设与高级参数修改同一份卡片；保存、修订和撤销由画布管理。 */
export function VisualStyleEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const card = raw as VisualStyleCard, fields = card.fields || {}
  const labels = { direction: styleLabels.direction, colors: styleLabels.colors, visual_features: styleLabels.visual_features, materials: styleLabels.materials, notes: styleLabels.notes }
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={stylePresets} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <div className="design-preset-fields">{Object.entries(labels).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={fields[key as keyof typeof fields]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } })} />)}</div>
    <DesignScopeEditor card={card} onChange={onChange} disabled={disabled} />
  </DesignPresetEditor>
}
