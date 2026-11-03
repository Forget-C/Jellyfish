import { Alert, Select } from 'antd'
import type { CompositionCard, DesignField, MovementCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions, shotSizeLabels } from './photographyDesign'
import { designSummary } from './designSummary'

/** 构图文字与结构化景别属于同一卡片；画面阶段关联由独立关系提供。 */
export function CompositionEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign, document }: CardRendererProps) {
  const card = raw as CompositionCard, fields = card.fields || {}
  const movements = (document.cards || []).filter((item): item is MovementCard => item.type === 'direction.movement')
  const movement = movements.find(item => item.id === card.frame_target?.card_id)
  const available = (value?: DesignField) => value && !['empty', 'not_applicable'].includes(value.state || 'empty') && !!value.text?.trim()
  const states = movement ? [
    ...(available(movement.fields?.movement_start) ? [{ value: 'field:movement_start', label: '起始画面' }] : []),
    ...(available(movement.fields?.end_frame) ? [{ value: 'field:end_frame', label: '结束画面' }] : []),
    ...(movement.phases || []).filter(phase => available(phase.frame)).map(phase => ({ value: 'phase:' + phase.id, label: phase.name || '未命名阶段' })),
  ] : []
  const missing = !!card.frame_target && !states.some(state => state.value === card.frame_target?.state_id)
  return <DesignPresetEditor fields={{ ...fields }} labels={photographyRegions.composition.fields} presets={photographyPresets.composition} current={designSummary([], Object.values(fields))} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <div className="design-preset-fields">{Object.entries(photographyRegions.composition.fields).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={fields[key as keyof typeof fields]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: { ...fields[key as keyof typeof fields], ...value } } })} />)}</div>
    <label>结构化景别<Select aria-label="结构化景别" disabled={disabled} allowClear placeholder="可选" value={fields.shot_size?.size || undefined} options={Object.entries(shotSizeLabels).map(([value, label]) => ({ value, label }))} onChange={size => onChange({ ...card, fields: { ...fields, shot_size: { ...fields.shot_size, size, state: fields.shot_size?.state === 'empty' || !fields.shot_size?.state ? 'proposal' : fields.shot_size.state } } })} /></label>
    <section aria-label="构图画面定位"><h3>画面定位（可选）</h3>
      <label>运镜卡<Select aria-label="关联运镜卡" disabled={disabled} allowClear placeholder={movements.length ? '选择同画布运镜卡' : '当前没有运镜卡'} value={card.frame_target?.card_id}
        options={[...movements.map(item => ({ value: item.id, label: `运镜卡 · ${item.id}` })), ...(card.frame_target && !movement ? [{ value: card.frame_target.card_id, label: `失效运镜卡 · ${card.frame_target.card_id}`, disabled: true }] : [])]}
        onChange={card_id => onChange({ ...card, frame_target: card_id ? { card_id, state_id: '' } : null })} /></label>
      {card.frame_target && <label>目标画面<Select aria-label="构图目标阶段" disabled={disabled} allowClear placeholder="选择起始、结束或明确阶段" value={card.frame_target.state_id || undefined}
        options={[...states, ...(missing && card.frame_target.state_id ? [{ value: card.frame_target.state_id, label: `失效画面 · ${card.frame_target.state_id}`, disabled: true }] : [])]}
        onChange={state_id => onChange({ ...card, frame_target: { ...card.frame_target!, state_id: state_id || '' } })} /></label>}
      {missing && <Alert type="warning" showIcon message="请选择有效的运镜画面，或取消定位" />}
    </section>
  </DesignPresetEditor>
}
