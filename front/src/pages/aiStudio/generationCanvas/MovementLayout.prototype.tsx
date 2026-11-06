// Throwaway: compare three movement layouts on the existing canvas route via ?prototype=movement&variant=A/B/C.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Input, Popover, Segmented } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, FilterOutlined, PlusOutlined, ThunderboltOutlined, DownOutlined } from '@ant-design/icons'
import { CanvasNodeFrame } from '../../../components/canvas/Canvas'
import { WorkbenchTheme } from '../directing/ui/WorkbenchTheme'
import { WorkbenchButton as Button, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { CanvasCardEditor } from './CanvasCardEditor'
import { DesignFieldEditor } from './DesignFieldEditor'
import { DesignScopeEditor } from './DesignScopeEditor'
import type { MovementCard, ReferenceDesignField } from '../../../services/generated'
import './generationCanvas.css'
import './designPresetEditor.css'
import './MovementLayout.prototype.css'

const initial: MovementCard = { id: 'prototype-movement', type: 'direction.movement', scope: { description: '', phase: null, condition: '' }, fields: {
  movement_type: { text: '缓慢推近', state: 'proposal', purpose: 'design' },
  movement_path: { text: '沿门廊中线向人物推进，经过门框后轻微向右偏移，最终停在窗边。', state: 'proposal', purpose: 'design' },
  movement_speed: { text: '前段均匀，接近人物时逐渐放缓。', state: 'proposal', purpose: 'design' },
  movement_start: { text: '门廊全景，人物在画面右侧窗边，门框形成前景。', state: 'proposal', purpose: 'design' },
  end_frame: { text: '停在人物近景，目光与窗外光线形成画面重心。', state: 'proposal', purpose: 'design' },
  movement_trigger: { text: '人物抬头看向门口后开始推进。', state: 'proposal', purpose: 'design' },
}, phases: [{ id: 'door', name: '经过门框', frame: { text: '门框从画面两侧缓缓退出，人物仍保持在右侧。', state: 'proposal', purpose: 'design' } }] }
const variants = ['A', 'B', 'C']
const names = ['画面主区 · 参数侧栏', '运动在前 · 画面横向展开', '双视图 · 集中编辑']

export default function MovementLayoutPrototype() {
  const [search, setSearch] = useSearchParams()
  const variant = variants.includes(search.get('variant') || '') ? search.get('variant')! : 'A'
  const [card, setCard] = useState(initial), [active, setActive] = useState('start')
  const [scopeOpen, setScopeOpen] = useState(false), [open, setOpen] = useState(true), [view, setView] = useState('画面')
  const [showState, setShowState] = useState(false)
  const cycle = (offset: number) => setSearch(previous => { const next = new URLSearchParams(previous); next.set('variant', variants[(variants.indexOf(variant) + offset + 3) % 3]); return next }, { replace: true })
  useEffect(() => {
    console.info('Movement layout prototype', { variant, card })
  }, [variant, card])
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.defaultPrevented || (event.target as HTMLElement).closest('input, textarea, [contenteditable], [role="tablist"], [role="combobox"], button, summary')) return
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })
  const field = (key: keyof NonNullable<MovementCard['fields']>, label: string) => <DesignFieldEditor compact label={label} value={card.fields?.[key]} onChange={value => setCard(current => ({ ...current, fields: { ...current.fields, [key]: value } }))} />
  const selected = card.phases?.find(phase => phase.id === active)
  const updateFrame = (value: ReferenceDesignField) => setCard(current => selected ? { ...current, phases: current.phases?.map(phase => phase.id === active ? { ...phase, frame: value } : phase) } : { ...current, fields: { ...current.fields, [active === 'end' ? 'end_frame' : 'movement_start']: value } })
  const count = Object.values(card.scope || {}).filter(Boolean).length
  const restrictions = <Popover trigger="click" placement="bottomRight" open={scopeOpen} onOpenChange={setScopeOpen} getPopupContainer={trigger => trigger.parentElement!} content={<div className="movement-prototype-scope" onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); setScopeOpen(false) } }}><DesignScopeEditor card={card} onChange={setCard} labelPrefix="运镜" productionLabel="适用制作环节" /><p>适用于整张运镜卡，作为设计说明传递。</p></div>}>
    <span className="movement-prototype-filter" data-configured={count > 0}><WorkbenchIconButton variant="quiet" label={`整卡适用限制${count ? ` · 已填写 ${count} 项` : ''}`} aria-expanded={scopeOpen} icon={<FilterOutlined />} />{count > 0 && <i aria-hidden="true" />}</span>
  </Popover>
  const frames = <section className="movement-prototype-frames" aria-label="关键画面编辑">
    <div className="movement-prototype-sequence"><div className="movement-keyframe-list" role="tablist" aria-label="关键画面列表">
      {[{ id: 'start', name: '起始' }, ...(card.phases || []), { id: 'end', name: '结束' }].map((item, index) => <button key={item.id} role="tab" aria-selected={active === item.id} onClick={() => setActive(item.id)}>{index > 0 && item.id !== 'end' ? `${String(index).padStart(2, '0')} ` : ''}{item.name}</button>)}
    </div><WorkbenchIconButton variant="quiet" label="添加关键画面" icon={<PlusOutlined />} onClick={() => { const id = crypto.randomUUID(); setCard({ ...card, phases: [...(card.phases || []), { id, name: '新关键画面', frame: { text: '', state: 'empty', purpose: 'design' } }] }); setActive(id) }} /></div>
    {selected && <Input aria-label="画面名称" className="movement-prototype-name" value={selected.name} onChange={event => setCard({ ...card, phases: card.phases?.map(phase => phase.id === active ? { ...phase, name: event.target.value } : phase) })} />}
    <DesignFieldEditor label={selected ? '此时的画面' : active === 'end' ? '结束画面' : '起始画面'} value={selected?.frame || card.fields?.[active === 'end' ? 'end_frame' : 'movement_start']} onChange={updateFrame} />
    {selected && <Button variant="quiet" size="small" onClick={() => { setCard({ ...card, phases: card.phases?.filter(phase => phase.id !== active) }); setActive('start') }}>删除当前画面</Button>}
  </section>
  const trigger = <details className="movement-prototype-trigger"><summary aria-label="展开触发条件"><ThunderboltOutlined /><span>{card.fields?.movement_trigger?.text || '未填写触发条件'}</span><DownOutlined /></summary>{field('movement_trigger', '触发条件')}</details>
  const motion = <aside className="movement-prototype-motion" aria-label="运镜功能参数">{field('movement_type', '运动方式')}{field('movement_path', '运动路径')}{field('movement_speed', '运动速度')}{trigger}</aside>
  return <WorkbenchTheme><main className="workbench-ui movement-prototype-page">
    <div className="movement-prototype-context"><span>Jellyfish / 生成画布 / 门廊相遇</span><small>布局原型 · 内存数据</small></div>
    <div className="movement-prototype-canvas"><CanvasNodeFrame nodeId="brief" nodeType="text"><small>原文／创作依据</small><p>他抬起头，门廊里传来脚步声。</p></CanvasNodeFrame><CanvasNodeFrame nodeId="movement" nodeType="design" selected><small>运镜卡</small><p>门廊推近</p><Button onClick={() => setOpen(true)}>编辑设计</Button></CanvasNodeFrame></div>
    <CanvasCardEditor title="门廊推近" typeLabel="运镜卡" status="原型 · 仅在内存中编辑" cardType="direction.movement" layoutKey="movement-prototype" open={open} onReveal={() => () => {}} forceModal onClose={() => setOpen(false)}>
      <div className="design-preset-editor movement-prototype-editor" data-variant={variant}>
        <div className="movement-prototype-toolbar">{variant === 'C' ? <Segmented value={view} onChange={value => setView(String(value))} options={['画面', '运动']} /> : <span className="movement-prototype-caption">高级设置</span>}{restrictions}</div>
        <div className="movement-prototype-content">
          {variant === 'A' && <>{frames}{motion}</>}
          {variant === 'B' && <><div className="movement-prototype-motion-strip">{field('movement_type', '运动方式')}{field('movement_path', '运动路径')}{field('movement_speed', '运动速度')}</div>{frames}{trigger}</>}
          {variant === 'C' && (view === '画面' ? frames : motion)}
        </div>
        <div className="movement-prototype-footer"><Button variant="quiet" onClick={() => { setCard(initial); setActive('start') }}>重置样例</Button><small>修改仅在当前预览中保留</small></div>
      </div>
    </CanvasCardEditor>
    <div className="movement-prototype-switcher"><WorkbenchIconButton label="上一个方案" icon={<ArrowLeftOutlined />} onClick={() => cycle(-1)} /><span>{variant} · {names[variants.indexOf(variant)]}</span><WorkbenchIconButton label="下一个方案" icon={<ArrowRightOutlined />} onClick={() => cycle(1)} /><Button variant="quiet" onClick={() => setShowState(!showState)}>查看状态</Button></div>
    {showState && <pre className="movement-prototype-state">{JSON.stringify({ variant, active, card }, null, 2)}</pre>}
  </main></WorkbenchTheme>
}
