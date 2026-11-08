import { ConfigProvider, Input, Popconfirm, Popover, Select, theme } from 'antd'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import type { InputRef } from 'antd'
import { CloseOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import type { MovementPhase } from '../../../services/generated'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { useOrderedDesignItems } from './useOrderedDesignItems'

/** 删除浮层脱离横向滚动区；保留触摸选中及跨浮层的键盘路径。 */
function PhaseDeleteBadge({ children, content, selected, confirmed, editing }: { children: ReactElement; content: ReactNode; selected: boolean; confirmed: boolean; editing: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null), popup = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), [visible, setVisible] = useState(true), [touch, setTouch] = useState(false)
  useEffect(() => {
    const media = matchMedia('(hover: none)'), update = () => setTouch(media.matches)
    update(); media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    const node = anchor.current, root = node?.closest('.movement-keyframe-list')
    if (!node || !root) return
    // The retained editor can start hidden or reopen straight into parameters.
    const measure = () => {
      const tab = node.getBoundingClientRect(), strip = root.getBoundingClientRect()
      setVisible(tab.width > 0 && strip.width > 0 && tab.left < strip.right && tab.right > strip.left)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    observer.observe(root)
    root.addEventListener('scroll', measure, { passive: true })
    measure()
    return () => { observer.disconnect(); root.removeEventListener('scroll', measure) }
  }, [])
  const focusTitle = () => anchor.current?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus()
  return <Popover placement="topRight" align={{ offset: [0, 6] }} arrow={false} autoAdjustOverflow={false} trigger={['hover', 'focus']} mouseLeaveDelay={0.15} open={!editing && visible && (open || confirmed || (touch && selected))} onOpenChange={setOpen} getPopupContainer={node => node.closest<HTMLElement>('.design-preset-editor') || node.parentElement!} overlayClassName="movement-delete-popover" content={<div ref={popup} onFocus={() => setOpen(true)} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }} onKeyDown={event => {
    if (!(event.target as HTMLElement).matches('.movement-tab-delete-button') || confirmed) return
    if (event.key === 'Escape' || (event.key === 'Tab' && event.shiftKey)) { event.preventDefault(); event.stopPropagation(); focusTitle() }
    else if (event.key === 'Tab') { event.preventDefault(); const next = anchor.current?.nextElementSibling; next?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus(); setOpen(false) }
  }}>{content}</div>}>
    <span ref={anchor} className="movement-tab-anchor" onKeyDown={event => {
      if (event.key === 'Tab' && !event.shiftKey && (event.target as HTMLElement).closest('[role="tab"]')) { event.preventDefault(); popup.current?.querySelector<HTMLButtonElement>('.movement-tab-delete-button')?.focus() }
    }}>{children}</span>
  </Popover>
}

/** 运镜独有的名称与删除语义；排序基础只处理稳定 ID，不改变画面采用。 */
export function MovementPhaseTabs({ phases, activeId, onSelect, onRename, onOrder, onAdd, onDelete, uses, disabled, editorOpen, issues }: {
  phases: MovementPhase[]; activeId: string; onSelect: (id: string) => void; onRename: (id: string, name: string) => void; onOrder: (ids: string[]) => void; onAdd: () => string; onDelete: (id: string) => void; uses: (id: string) => number; disabled?: boolean; editorOpen?: boolean; issues: string[];
}) {
  const { token } = theme.useToken()
  const [confirmId, setConfirmId] = useState<string>()
  useEffect(() => { if (!editorOpen || disabled || !phases.some(phase => phase.id === confirmId)) setConfirmId(undefined) }, [editorOpen, disabled, phases, confirmId])
  const list = useRef<HTMLDivElement>(null), input = useRef<InputRef>(null)
  const [editing, setEditing] = useState<{ id: string; name: string }>()
  const edit = useRef(editing); edit.current = editing
  const lastTap = useRef<{ id: string; time: number }>()
  const touchStart = useRef<{ x: number; y: number }>()
  const [overflow, setOverflow] = useState(false)
  const sort = useOrderedDesignItems(phases.map(phase => phase.id), onOrder, disabled || editorOpen === false)
  const finish = (save: boolean) => {
    const value = edit.current
    edit.current = undefined; setEditing(undefined)
    if (value && save && !disabled && phases.find(phase => phase.id === value.id)?.name !== value.name) onRename(value.id, value.name)
  }
  const rename = (id: string) => { if (!disabled && phases.some(phase => phase.id === id)) { onSelect(id); setEditing({ id, name: phases.find(phase => phase.id === id)?.name || '' }) } }
  const editingId = editing?.id
  useEffect(() => { if (editingId) { input.current?.focus(); input.current?.select() } }, [editingId])
  useEffect(() => { if (!editorOpen || disabled || !phases.some(phase => phase.id === edit.current?.id)) { edit.current = undefined; setEditing(undefined) } }, [editorOpen, phases, disabled])
  useEffect(() => {
    const root = list.current
    if (!root) return
    const measure = () => setOverflow(root.scrollWidth > root.clientWidth + 1)
    const observer = new ResizeObserver(measure); observer.observe(root); [...root.children].forEach(node => observer.observe(node)); measure()
    return () => observer.disconnect()
  }, [phases, editorOpen])
  useEffect(() => { const root = list.current, tab = root?.querySelector<HTMLElement>('[aria-selected="true"]'); if (root && tab) { const box = tab.getBoundingClientRect(), bounds = root.getBoundingClientRect(); if (box.left < bounds.left) root.scrollLeft -= bounds.left - box.left; else if (box.right > bounds.right) root.scrollLeft += box.right - bounds.right } }, [activeId])
  const items = [{ id: 'field:movement_start', name: '起始' }, ...phases, { id: 'field:end_frame', name: '结束' }]
  return <div className="movement-sequence" style={{ '--movement-delete-color': token.colorError } as CSSProperties}>
    <div ref={list} className="movement-keyframe-list" role="tablist" aria-label="关键画面列表" onPointerDown={event => { if (event.pointerType === 'touch') touchStart.current = { x: event.clientX, y: event.clientY }; sort.onPointerDown(event) }} onPointerMove={event => { const start = touchStart.current; if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 8) lastTap.current = undefined }} onPointerCancel={() => { lastTap.current = undefined; touchStart.current = undefined }} onClickCapture={sort.onClickCapture} onKeyDown={event => {
      sort.onKeyDown(event)
      if (event.defaultPrevented || (event.target as HTMLElement).closest('input, [data-sort-ignore]')) return
      if (event.key === 'F2') { event.preventDefault(); const id = (event.target as HTMLElement).closest<HTMLElement>('[data-sort-id]')?.dataset.sortId; if (id) rename(id); return }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); const current = items.findIndex(item => item.id === activeId)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
      finish(true); onSelect(items[index].id); list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
    }}>
      {items.map((item, index) => {
        const phase = phases.find(phase => phase.id === item.id), selected = activeId === item.id, count = phase ? uses(phase.id) : 0
        const tab = <div key={item.id} className="movement-phase-tab" data-sort-id={phase?.id} data-dragging={sort.drag?.id === item.id} data-drop-target={phase && sort.drag && phases[sort.drag.to]?.id === phase.id} data-drop-side={sort.drag && phases.findIndex(phase => phase.id === sort.drag!.id) < sort.drag.to ? 'after' : 'before'} data-selected={selected}>
          {editing?.id === item.id ? <Input ref={input} aria-label="画面名称" disabled={disabled} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} onBlur={() => finish(true)} onKeyDown={event => { event.stopPropagation(); if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === 'Escape')) { event.preventDefault(); finish(event.key === 'Enter'); requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-sort-id="${CSS.escape(item.id)}"] [role="tab"]`)?.focus()) } }} /> : <button type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} title={`${item.name || '未命名画面'}${issues.includes(item.id) ? ' · 引用需处理' : ''}${phase && !disabled ? ' · 双击或F2改名；拖动或Ctrl/⌘+Shift+左右键排序' : ''}`} aria-keyshortcuts={phase && !disabled ? 'F2 Control+Shift+ArrowLeft Control+Shift+ArrowRight Meta+Shift+ArrowLeft Meta+Shift+ArrowRight' : undefined} onClick={event => {
            finish(true); onSelect(item.id)
            if ((event.nativeEvent as PointerEvent).pointerType === 'touch' && phase && !disabled) {
              const previous = lastTap.current
              lastTap.current = { id: item.id, time: event.timeStamp }
              if (previous?.id === item.id && event.timeStamp - previous.time < 350) { lastTap.current = undefined; rename(item.id) }
            } else lastTap.current = undefined
          }} onDoubleClick={event => { if (!(event.nativeEvent as MouseEvent & { sourceCapabilities?: { firesTouchEvents: boolean } }).sourceCapabilities?.firesTouchEvents && phase) rename(phase.id) }}>{phase && !disabled && <EditOutlined className="movement-tab-edit-hint" aria-hidden="true" />}{phase ? `${String(index).padStart(2, '0')} ${(item.name || '').trim() || '未命名画面'}` : item.name}{issues.includes(item.id) && ' · 引用需处理'}</button>}

        </div>
        return phase && !disabled ? <PhaseDeleteBadge key={item.id} selected={selected} editing={editing?.id === phase.id} confirmed={confirmId === phase.id} content={<div className="movement-tab-delete" style={{ '--movement-delete-color': token.colorError } as CSSProperties} data-sort-ignore>
            <Popconfirm open={confirmId === phase.id} onOpenChange={open => { if (!open || count) setConfirmId(open ? phase.id : undefined) }} getPopupContainer={node => node.closest<HTMLElement>('.design-preset-editor') || node.parentElement!} title={`此画面正被 ${count} 处定位使用`} description="删除后，相关目标需重新选择。" disabled={!count} okText="删除画面" cancelText="取消" onConfirm={() => onDelete(phase.id)}><WorkbenchIconButton tooltipOpen={confirmId === phase.id ? false : undefined} className="movement-tab-delete-button" label={`删除画面 ${item.name || '未命名画面'}`} variant="quiet" icon={<CloseOutlined />} onClick={() => { finish(true); if (!count) onDelete(phase.id) }} /></Popconfirm>
          </div>}>{tab}</PhaseDeleteBadge> : tab
      })}
    </div>
    <ConfigProvider componentDisabled={false}>{overflow && <Select className="movement-frame-select" aria-label="全部画面" value={activeId} onChange={id => { finish(true); onSelect(id) }} options={items.map((item, index) => ({ value: item.id, label: `${index ? index + ' ' : ''}${item.name || '未命名画面'}` }))} />}</ConfigProvider>
    <WorkbenchIconButton label="添加关键画面" variant="quiet" icon={<PlusOutlined />} disabled={disabled} onClick={() => { finish(true); const id = onAdd(); setEditing({ id, name: '' }) }} />
    <span className="design-sort-status" role="status">{sort.drag ? '正在调整画面顺序，松开完成' : ''}</span>
  </div>
}
