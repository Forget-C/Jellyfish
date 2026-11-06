import { userDesignField } from './designFieldMetadata'
import { DesignScopePopover } from './DesignScopePopover'
import { VisualDesignRelations } from './VisualDesignRelations'
import { Select } from 'antd'
import type { CompositionCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions, shotSizeLabels } from './photographyDesign'
import { designSummary } from './designSummary'

/** 构图文字与结构化景别属于同一卡片；画面阶段关联由独立关系提供。 */
export function CompositionEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign, document, savedRevision, modelOutputs, onLocateDesign }: CardRendererProps) {
  const card = raw as CompositionCard, fields = card.fields || {}
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} onChange={onChange} disabled={disabled} editorOpen={editorOpen} />} fields={{ ...fields }} labels={photographyRegions.composition.fields} presets={photographyPresets.composition} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <div className="design-preset-fields">{Object.entries(photographyRegions.composition.fields).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} labelAction={key === 'shot_size' ? <Select aria-label="结构化景别" disabled={disabled} allowClear placeholder="可选" value={fields.shot_size?.size || undefined} options={Object.entries(shotSizeLabels).map(([value, label]) => ({ value, label }))} onChange={size => onChange({ ...card, fields: { ...fields, shot_size: userDesignField({ ...fields.shot_size, size }) } })} /> : undefined} value={fields[key as keyof typeof fields]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: { ...fields[key as keyof typeof fields], ...value } } })} />)}</div>
    <VisualDesignRelations onLocateDesign={onLocateDesign} card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
  </DesignPresetEditor>
}
