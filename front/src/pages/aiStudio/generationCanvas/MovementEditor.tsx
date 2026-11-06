import { useContext, useEffect, useRef, useState } from 'react'
import { Divider } from 'antd'
import type { MovementCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { DesignReferenceContext, ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { DesignScopePopover } from './DesignScopePopover'
import { VisualDesignRelations } from './VisualDesignRelations'
import { MovementPhaseTabs } from './MovementPhaseTabs'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions } from './photographyDesign'
import { designSummary } from './designSummary'

/** 阶段身份不随名称和顺序改变；删除只移除本卡画面，外部定位保留失效状态。 */
export function MovementEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign, document, savedRevision, modelOutputs, onLocateDesign }: CardRendererProps) {
  const card = raw as MovementCard, fields = card.fields || {}, phases = card.phases || []
  const latest = useRef(card); latest.current = card
  const change = (next: MovementCard) => { latest.current = next; onChange(next) }
  const [selectedId, setSelectedId] = useState('field:movement_start')
  const references = useContext(DesignReferenceContext)
  const activeId = selectedId === 'field:end_frame' || phases.some(phase => phase.id === selectedId) ? selectedId : 'field:movement_start'
  const selected = phases.find(phase => phase.id === activeId)
  const frameField = activeId === 'field:end_frame' ? 'end_frame' : 'movement_start'
  const frameLabel = frameField === 'end_frame' ? '结束画面' : '起始画面'
  useEffect(() => { if (!editorOpen) setSelectedId('field:movement_start') }, [editorOpen])
  useEffect(() => {
    if (!editorOpen) return
    const field = references?.targetField?.fieldId
    if (field?.startsWith('phase:')) setSelectedId(field.slice(6))
    else if (field === 'movement_start' || field === 'end_frame') setSelectedId('field:' + field)
  }, [references?.targetField, editorOpen])
  const uses = (id: string) => (document.cards || []).reduce((count, target) => {
    if ('frame_target' in target && target.frame_target?.card_id === card.id && target.frame_target.state_id === 'phase:' + id) count += 1
    if ('frame_targets' in target) count += (target.frame_targets || []).filter(frame => frame.state_id === 'phase:' + id && target.input_bindings?.some(binding => binding.id === frame.binding_id && binding.source.card_id === card.id)).length
    return count
  }, 0)
  const labels = photographyRegions.movement.fields
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets.movement} current={movementSummary(card)} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} scopeTools={<DesignScopePopover card={card} onChange={onChange} disabled={disabled} editorOpen={editorOpen} labelPrefix="运镜" />} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <section className="movement-keyframes design-stable-region" aria-label="运镜关键画面">
      <MovementPhaseTabs phases={phases} activeId={activeId} onSelect={setSelectedId} editorOpen={editorOpen} disabled={disabled} uses={uses} issues={(references?.issues || []).filter(issue => issue.field_id.startsWith('phase:')).map(issue => issue.field_id.slice(6))}
        onRename={(id, name) => change({ ...latest.current, phases: latest.current.phases?.map(phase => phase.id === id ? { ...phase, name } : phase) })}
        onOrder={ids => change({ ...latest.current, phases: ids.map(id => latest.current.phases!.find(phase => phase.id === id)!) })}
        onAdd={() => { const id = crypto.randomUUID(); change({ ...latest.current, phases: [...(latest.current.phases || []), { id, name: '', frame: { state: 'empty', text: '', purpose: 'design' } }] }); setSelectedId(id); return id }}
        onDelete={id => {
          const current = latest.current, index = current.phases!.findIndex(phase => phase.id === id)
          if (activeId === id) setSelectedId(current.phases![index + 1]?.id || 'field:end_frame')
          change({ ...current, phases: current.phases!.filter(phase => phase.id !== id) })
        }} />
      <div className="movement-keyframe-edit" role="tabpanel" aria-label={selected ? selected.name || '未命名画面' : frameLabel}>
        {!selected ? <DesignFieldEditor compact key={frameField} label={frameLabel} value={fields[frameField]} onChange={value => change({ ...latest.current, fields: { ...latest.current.fields, [frameField]: value } })} /> : <DesignFieldEditor compact key={selected.id} label="此时的画面" value={selected.frame} onChange={frame => change({ ...latest.current, phases: latest.current.phases?.map(phase => phase.id === selected.id ? { ...phase, frame } : phase) })} />}
      </div>
    </section>
    <Divider className="movement-section-divider" />
    <section className="movement-motion design-preset-fields design-preset-fields-compact design-stable-region" aria-label="运镜功能参数">
      {(['movement_type', 'movement_path', 'movement_speed', 'movement_trigger'] as const).map(key => <DesignFieldEditor compact key={key} label={labels[key]} value={fields[key]} onChange={value => change({ ...latest.current, fields: { ...latest.current.fields, [key]: value } })} />)}
    </section>
    <VisualDesignRelations onLocateDesign={onLocateDesign} card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
  </DesignPresetEditor>
}

/** 卡面摘要只读取本卡真实参数和明确阶段。 */
export function movementSummary(card: MovementCard) {
  return designSummary([], [...Object.values(card.fields || {}), ...(card.phases || []).map(phase => phase.frame)])
}
