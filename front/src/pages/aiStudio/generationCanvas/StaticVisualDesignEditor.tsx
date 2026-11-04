import { VisualDesignScope } from './VisualDesignScope'
import { VisualDesignRelations } from './VisualDesignRelations'
import type { CameraCard, LightingCard, FocusCard, DesignField } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions } from './photographyDesign'
import { designSummary } from './designSummary'

export type StaticVisualDesignCard = CameraCard | LightingCard | FocusCard
const kindFor = (card: StaticVisualDesignCard) => (card.type || 'direction.camera').split('.')[1] as 'camera' | 'lighting' | 'focus'

/** Three independent field sets share editing behavior, never a hidden photography owner. */
export function StaticVisualDesignEditor({ card: raw, disabled, editorOpen, onUndoDesign, onChange, document, savedRevision, modelOutputs }: CardRendererProps) {
  const card = raw as StaticVisualDesignCard, kind = kindFor(card)
  const fields = card.fields || {}, labels = photographyRegions[kind].fields
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets[kind]} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) } as StaticVisualDesignCard)}>
    <div className="design-preset-fields">{Object.entries(labels).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={(fields as Record<string, DesignField>)[key]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } } as StaticVisualDesignCard)} />)}</div>
    <VisualDesignRelations card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
    <VisualDesignScope card={card} onChange={onChange} disabled={disabled} />
  </DesignPresetEditor>
}
