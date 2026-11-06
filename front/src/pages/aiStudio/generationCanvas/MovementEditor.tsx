import { DesignScopeEditor } from './DesignScopeEditor'
import { VisualDesignRelations } from './VisualDesignRelations'
import { ConfigProvider, Divider, Dropdown, Input, Popover, Select } from 'antd'
import type { InputRef } from 'antd'
import { useContext, useEffect, useRef, useState } from 'react'
import { DesignReferenceContext } from './DesignReferenceEditor'
import type { MovementCard } from '../../../services/generated'
import type { CardRendererProps } from './rendererRegistry'
import { ReferencedDesignFieldEditor as DesignFieldEditor } from './DesignReferenceEditor'
import { DesignPresetEditor } from './DesignPresetEditor'
import { applyPreset, photographyPresets } from './visualPresets'
import { photographyRegions } from './photographyDesign'
import { designSummary } from './designSummary'
import { FilterOutlined, PlusOutlined } from '@ant-design/icons'
import { WorkbenchButton as Button, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'

/** 运镜阶段身份由创建时确定；重命名和重排只改变展示，不改变引用目标。 */
export function MovementEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign, document, savedRevision, modelOutputs, onLocateDesign }: CardRendererProps) {
  const card = raw as MovementCard, fields = card.fields || {}, phases = card.phases || []
  const [selectedId, setSelectedId] = useState<string>('field:movement_start')
  const references = useContext(DesignReferenceContext)
  const list = useRef<HTMLDivElement>(null)
  const nameInput = useRef<InputRef>(null), focusNew = useRef(false)
  const activeId = selectedId === 'field:end_frame' || phases.some(phase => phase.id === selectedId) ? selectedId : 'field:movement_start'
  const selected = phases.find(phase => phase.id === activeId)
  const [scopeOpen, setScopeOpen] = useState(false)
  const frameField = activeId === 'field:end_frame' ? 'end_frame' : 'movement_start'
  const frameLabel = frameField === 'end_frame' ? '结束画面' : '起始画面'
  const index = phases.findIndex(phase => phase.id === selected?.id)
  useEffect(() => { if (!editorOpen) { focusNew.current = false; setScopeOpen(false); setSelectedId('field:movement_start') } }, [editorOpen])
  useEffect(() => {
    if (!editorOpen) return
    const field = references?.targetField?.fieldId
    if (field?.startsWith('phase:')) setSelectedId(field.slice(6))
    else if (field === 'movement_start' || field === 'end_frame') setSelectedId('field:' + field)
  }, [references?.targetField, editorOpen])
  useEffect(() => {
    if (focusNew.current && selected) { nameInput.current?.focus(); focusNew.current = false }
  }, [selected])
  useEffect(() => {
    const root = list.current, button = root?.querySelector<HTMLButtonElement>('[aria-selected="true"]')
    if (!root || !button) return
    if (button.offsetLeft < root.scrollLeft) root.scrollLeft = button.offsetLeft
    else if (button.offsetLeft + button.offsetWidth > root.scrollLeft + root.clientWidth) root.scrollLeft = button.offsetLeft + button.offsetWidth - root.clientWidth
  }, [activeId])
  const move = (offset: number) => {
    if (!selected) return
    setSelectedId(selected.id)
    const next = [...phases]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    onChange({ ...card, phases: next })
  }
  const describe = (phase: typeof phases[number]) => phase.frame?.document
    ? phase.frame.document.segments?.map(segment => segment.kind === 'text' ? segment.text : '@引用').join('') || ''
    : phase.frame?.text || ''
  const scopeCount = Object.values(card.scope || {}).filter(value => value?.trim()).length
  const scopeTrigger = useRef<HTMLElement>(null)
  const labels = photographyRegions.movement.fields
  const scopeTools = <ConfigProvider componentDisabled={false}>
    <Popover trigger="click" placement="bottomRight" open={scopeOpen} onOpenChange={setScopeOpen} getPopupContainer={trigger => trigger.parentElement!} content={<div className="movement-scope-panel" onKeyDown={event => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.stopPropagation(); setScopeOpen(false); scopeTrigger.current?.focus() }
    }}>
      <DesignScopeEditor card={card} onChange={onChange} disabled={disabled} labelPrefix="运镜" productionLabel="适用制作环节" />
      <p>描述整张运镜卡的适用限制，随整卡传递；不会自动筛选关键画面。</p>
    </div>}>
      <span className="movement-scope-trigger"><WorkbenchIconButton ref={scopeTrigger} variant="quiet" label={`整卡适用限制${scopeCount ? ` · 已填写 ${scopeCount} 项` : ''}`} aria-expanded={scopeOpen} icon={<FilterOutlined />} />{scopeCount > 0 && <i aria-hidden="true" />}</span>
    </Popover>
  </ConfigProvider>
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets.movement} current={movementSummary(card)} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} advancedTitle="" onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <section className="movement-keyframes" aria-label="运镜关键画面">
      <div className="movement-keyframe-layout">
        <div className="movement-sequence">
        <div ref={list} className="movement-keyframe-list" role="tablist" aria-label="关键画面列表" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          const ids = ['field:movement_start', ...phases.map(phase => phase.id), 'field:end_frame']
          const current = ids.indexOf(activeId)
          const next = event.key === 'Home' ? 0 : event.key === 'End' ? ids.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length
          event.preventDefault(); setSelectedId(ids[next])
          list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus()
        }}>
          <button type="button" role="tab" aria-selected={activeId === 'field:movement_start'} tabIndex={activeId === 'field:movement_start' ? 0 : -1} onClick={() => setSelectedId('field:movement_start')}>起始</button>
          {phases.map((phase, position) => <button type="button" role="tab" key={phase.id} aria-selected={activeId === phase.id} tabIndex={activeId === phase.id ? 0 : -1} onClick={() => setSelectedId(phase.id)} title={describe(phase)}>
            {String(position + 1).padStart(2, '0')} {phase.name?.trim() || '未命名画面'}{references?.issues.some(issue => issue.field_id === 'phase:' + phase.id) && ' · 引用需处理'}
          </button>)}
          <button type="button" role="tab" aria-selected={activeId === 'field:end_frame'} tabIndex={activeId === 'field:end_frame' ? 0 : -1} onClick={() => setSelectedId('field:end_frame')}>结束</button>
        </div>
        <WorkbenchIconButton label="添加关键画面" variant="quiet" icon={<PlusOutlined />} disabled={disabled} onClick={() => {
          const id = crypto.randomUUID()
          focusNew.current = true; setSelectedId(id)
          onChange({ ...card, phases: [...phases, { id, name: '', frame: { state: 'empty', text: '', purpose: 'design' } }] })
        }} />
        <Divider type="vertical" />
        {scopeTools}
        </div>
        {phases.length > 3 && <ConfigProvider componentDisabled={false}><Select className="movement-frame-select" aria-label="全部画面" value={activeId} onChange={setSelectedId} options={[{value:'field:movement_start',label:'起始'}, ...phases.map((phase, position) => ({ value: phase.id, label: `${position + 1} ${phase.name?.trim() || '未命名画面'}` })), {value:'field:end_frame',label:'结束'}]} /></ConfigProvider>}
        <div className="movement-keyframe-edit" role="tabpanel" aria-label={selected ? selected.name || '未命名画面' : frameLabel}>
          {!selected ? <DesignFieldEditor compact key={frameField} label={frameLabel} value={fields[frameField]} onChange={value => onChange({...card, fields:{...fields, [frameField]:value}})} /> : <>
          <label>画面名称<Input ref={nameInput} aria-label="画面名称" placeholder="如：经过门口、靠近人物" value={selected.name} disabled={disabled} onChange={event => onChange({ ...card, phases: phases.map(item => item.id === selected.id ? { ...item, name: event.target.value } : item) })} /></label>
          <DesignFieldEditor compact key={selected.id} label="此时的画面" value={selected.frame} onChange={frame => onChange({ ...card, phases: phases.map(item => item.id === selected.id ? { ...item, frame } : item) })} />
          <div className="movement-keyframe-actions">
            <Dropdown disabled={disabled} trigger={['click']} menu={{ items: [{key:'up', label:'上移', disabled:index === 0}, {key:'down', label:'下移', disabled:index === phases.length - 1}, { key: 'delete', label: '删除关键画面', danger: true }], onClick: ({key}) => {
              if (key === 'up' || key === 'down') { move(key === 'up' ? -1 : 1); return }
              focusNew.current = phases.length > 1
              setSelectedId(phases[index + 1]?.id || phases[index - 1]?.id || 'field:movement_start')
              onChange({ ...card, phases: phases.filter(item => item.id !== selected.id) })
            } }}><Button disabled={disabled}>更多画面操作</Button></Dropdown></div>
          </>}
        </div>
      </div>
    </section>
    <Divider className="movement-section-divider" />
    <section className="movement-motion design-preset-fields" aria-label="运镜功能参数">
      {(['movement_type', 'movement_path', 'movement_speed', 'movement_trigger'] as const).map(key => <DesignFieldEditor compact key={key} label={labels[key]} value={fields[key]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } })} />)}
    </section>
    <VisualDesignRelations onLocateDesign={onLocateDesign} card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
  </DesignPresetEditor>
}

/** 卡面摘要只读取本卡真实参数和明确阶段。 */
export function movementSummary(card: MovementCard) {
  return designSummary([], [...Object.values(card.fields || {}), ...(card.phases || []).map(phase => phase.frame)])
}
