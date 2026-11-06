import { DesignScopeEditor } from './DesignScopeEditor'
import { VisualDesignRelations } from './VisualDesignRelations'
import { ConfigProvider, Dropdown, Input, Select } from 'antd'
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
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'

/** 运镜阶段身份由创建时确定；重命名和重排只改变展示，不改变引用目标。 */
export function MovementEditor({ card: raw, onChange, disabled, editorOpen, onUndoDesign, document, savedRevision, modelOutputs, onLocateDesign }: CardRendererProps) {
  const card = raw as MovementCard, fields = card.fields || {}, phases = card.phases || []
  const [selectedId, setSelectedId] = useState<string>()
  const references = useContext(DesignReferenceContext)
  const list = useRef<HTMLDivElement>(null)
  const nameInput = useRef<InputRef>(null), focusNew = useRef(false)
  const selected = phases.find(phase => phase.id === selectedId) || phases[0]
  const index = phases.findIndex(phase => phase.id === selected?.id)
  useEffect(() => {
    const field = references?.targetField?.fieldId
    if (field?.startsWith('phase:')) setSelectedId(field.slice(6))
  }, [references?.targetField])
  useEffect(() => {
    if (focusNew.current && selected) { nameInput.current?.focus(); focusNew.current = false }
  }, [selected])
  useEffect(() => {
    const root = list.current, button = root?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')
    if (!root || !button) return
    if (button.offsetTop < root.scrollTop) root.scrollTop = button.offsetTop
    else if (button.offsetTop + button.offsetHeight > root.scrollTop + root.clientHeight) root.scrollTop = button.offsetTop + button.offsetHeight - root.clientHeight
  }, [selected?.id])
  const move = (offset: number) => {
    setSelectedId(selected.id)
    const next = [...phases]
    ;[next[index], next[index + offset]] = [next[index + offset], next[index]]
    onChange({ ...card, phases: next })
  }
  const describe = (phase: typeof phases[number]) => phase.frame?.document
    ? phase.frame.document.segments?.map(segment => segment.kind === 'text' ? segment.text : '@引用').join('') || ''
    : phase.frame?.text || ''
  const labels = photographyRegions.movement.fields
  return <DesignPresetEditor fields={{ ...fields }} labels={labels} presets={photographyPresets.movement} current={movementSummary(card)} disabled={disabled} editorOpen={editorOpen} onUndo={onUndoDesign} onApply={preset => onChange({ ...card, fields: applyPreset(fields, preset) })}>
    <details className="movement-scope"><summary>整卡适用说明 <small>{[card.scope?.description, card.scope?.phase, card.scope?.condition].filter(Boolean).join(' · ') || '未限定'}</small></summary>
      <p>作为本卡整体设计的适用说明，随各关键画面共同传递；不会自动筛选画面。</p>
      <DesignScopeEditor card={card} onChange={onChange} disabled={disabled} labelPrefix="运镜" productionLabel="适用制作环节" />
    </details>
    <h3>整体运镜</h3>
    <div className="design-preset-fields">{Object.entries(labels).map(([key, label]) => <DesignFieldEditor compact key={key} label={label} value={fields[key as keyof typeof fields]} onChange={value => onChange({ ...card, fields: { ...fields, [key]: value } })} />)}</div>
    <VisualDesignRelations onLocateDesign={onLocateDesign} card={card} document={document} savedRevision={savedRevision} modelOutputs={modelOutputs} disabled={disabled} onChange={onChange} />
    <section className="movement-keyframes" aria-label="运镜关键画面">
      <header><h3>运镜关键画面 <small>{phases.length} 个</small></h3><Button disabled={disabled} onClick={() => {
        const id = crypto.randomUUID()
        focusNew.current = true; setSelectedId(id)
        onChange({ ...card, phases: [...phases, { id, name: '', frame: { state: 'empty', text: '', purpose: 'design' } }] })
      }}>添加关键画面</Button></header>
      <p>描述运镜过程中的关键时刻，可用于构图定位和静帧目标选择。起始与结束画面在整体运镜中填写。</p>
      {!selected ? <p>尚未添加关键画面；需要明确中间画面时再添加。</p> : <div className="movement-keyframe-layout">
        <div ref={list} className="movement-keyframe-list" aria-label="关键画面列表">{phases.map((phase, position) => {
          const text = describe(phase)
          const state = references?.issues.some(issue => issue.field_id === 'phase:' + phase.id) ? '引用需处理' : ['empty', 'not_applicable'].includes(phase.frame?.state || 'empty') ? text ? '保留内容 · 未生效' : '待填写' : text ? '已描述' : '待填写'
          return <button type="button" key={phase.id} aria-pressed={selected.id === phase.id} onClick={() => setSelectedId(phase.id)}>
            <span>{String(position + 1).padStart(2, '0')} {phase.name?.trim() || '未命名画面'} <small>{state}</small></span><span>{text || '尚未描述此时的画面'}</span>
          </button>
        })}</div>
        <div className="movement-keyframe-edit">
          <ConfigProvider componentDisabled={false}><div className="movement-keyframe-mobile"><Select aria-label="选择关键画面" value={selected.id} onChange={setSelectedId} options={phases.map((phase, position) => ({ value: phase.id, label: `${position + 1} ${phase.name?.trim() || '未命名画面'}` }))} />
            <Button disabled={index === 0} onClick={() => setSelectedId(phases[index - 1].id)}>上一项</Button><Button disabled={index === phases.length - 1} onClick={() => setSelectedId(phases[index + 1].id)}>下一项</Button></div></ConfigProvider>
          <label>画面名称<Input ref={nameInput} aria-label="画面名称" placeholder="如：经过门口、靠近人物" value={selected.name} disabled={disabled} onChange={event => onChange({ ...card, phases: phases.map(item => item.id === selected.id ? { ...item, name: event.target.value } : item) })} /></label>
          <DesignFieldEditor compact key={selected.id} label="此时的画面" value={selected.frame} onChange={frame => onChange({ ...card, phases: phases.map(item => item.id === selected.id ? { ...item, frame } : item) })} />
          <div className="movement-keyframe-actions"><Button disabled={disabled || index === 0} onClick={() => move(-1)}>上移</Button><Button disabled={disabled || index === phases.length - 1} onClick={() => move(1)}>下移</Button>
            <Dropdown disabled={disabled} trigger={['click']} menu={{ items: [{ key: 'delete', label: '删除关键画面', danger: true }], onClick: () => {
              focusNew.current = phases.length > 1
              setSelectedId(phases[index + 1]?.id || phases[index - 1]?.id)
              onChange({ ...card, phases: phases.filter(item => item.id !== selected.id) })
            } }}><Button disabled={disabled}>更多画面操作</Button></Dropdown></div>
        </div>
      </div>}
    </section>
  </DesignPresetEditor>
}

/** 卡面摘要只读取本卡真实参数和明确阶段。 */
export function movementSummary(card: MovementCard) {
  return designSummary([], [...Object.values(card.fields || {}), ...(card.phases || []).map(phase => phase.frame)])
}
