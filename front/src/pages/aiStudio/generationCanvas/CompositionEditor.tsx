import { useUiText } from '../../../uiText'
import { userDesignField } from './designFieldMetadata'
import { DesignScopePopover } from './DesignScopePopover'
import { Select } from 'antd'
import type { CompositionCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions, shotSizeLabels } from './photographyDesign'
import { designSummary } from './designSummary'

/** 构图文字与结构化景别属于同一卡片；画面阶段关联由独立关系提供。 */
export function CompositionEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign }: CardRendererProps) {
  const uiText = useUiText()
  const card = raw as CompositionCard, fields = card.fields || {}
  return <DesignPresetEditor scopeTools={<DesignScopePopover card={card} onChange={onChange} disabled={disabled} editorOpen={editorOpen} />} fields={{ ...fields }} labels={photographyRegions.composition.fields} presets={photographyPresets.composition} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <div className="design-preset-fields design-composition-fields">{Object.entries(photographyRegions.composition.fields).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} labelAction={key === 'shot_size' ? <Select size="small" bordered={false} aria-label={uiText("结构化景别")} disabled={disabled} allowClear placeholder={uiText("可选")} value={fields.shot_size?.size || undefined} options={Object.entries(shotSizeLabels).map(([value, label]) => ({ value, label }))} onChange={size => onChange({ ...card, fields: { ...fields, shot_size: userDesignField({ ...fields.shot_size, size }) } })} /> : undefined} value={fields[key as keyof typeof fields]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: { ...fields[key as keyof typeof fields], ...value } } })} />)}</div>
  </DesignPresetEditor>
}
