import { DesignScopeEditor } from './DesignScopeEditor'
import { VisualDesignRelations } from './VisualDesignRelations'
import { Input } from 'antd'
import type { MovementCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions } from './photographyDesign'
import { designSummary } from './designSummary'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'

/** 运镜阶段身份由创建时确定；重命名和重排只改变展示，不改变引用目标。 */
export function MovementEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign, document, savedRevision, modelOutputs, onLocateDesign }: CardRendererProps) {
  const card = raw as MovementCard, fields = card.fields || {}, phases = card.phases || []
  const labels = photographyRegions.movement.fields
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets.movement} current={movementSummary(card)} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <div className="design-preset-fields">{Object.entries(labels).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={fields[key as keyof typeof fields]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } })} />)}</div>
    <VisualDesignRelations onLocateDesign={onLocateDesign} card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
    <DesignScopeEditor card={card} onChange={onChange} disabled={disabled} labelPrefix="运镜" />
    <section aria-label="明确运镜阶段"><h3>明确运镜阶段</h3><Button disabled={disabled} onClick={() => onChange({ ...card, phases: [...phases, { id: crypto.randomUUID(), name: '新阶段', frame: { state: 'empty', text: '', purpose: 'design' } }] })}>添加阶段</Button>
      {phases.map((phase, index) => <section className="movement-design-phase" key={phase.id}>
        <Input aria-label={`阶段 ${index + 1} 名称`} value={phase.name} disabled={disabled} onChange={event => onChange({ ...card, phases: phases.map(item => item.id === phase.id ? { ...item, name: event.target.value } : item) })} />
        <div><Button disabled={disabled || index === 0} onClick={() => { const next = [...phases]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; onChange({ ...card, phases: next }) }}>前移阶段 {index + 1}</Button><Button disabled={disabled} onClick={() => onChange({ ...card, phases: phases.filter(item => item.id !== phase.id) })}>删除阶段 {index + 1}</Button></div>
        <DesignFieldEditor compact label={`阶段 ${index + 1} 画面`} value={phase.frame} onChange={frame => onChange({ ...card, phases: phases.map(item => item.id === phase.id ? { ...item, frame } : item) })} />
      </section>)}
    </section>
  </DesignPresetEditor>
}

/** 卡面摘要只读取本卡真实参数和明确阶段。 */
export function movementSummary(card: MovementCard) {
  return designSummary([], [...Object.values(card.fields || {}), ...(card.phases || []).map(phase => phase.frame)])
}
