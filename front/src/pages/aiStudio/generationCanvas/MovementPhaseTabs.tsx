import { ConfigProvider, Input, Popconfirm, Select } from 'antd'
import type { InputRef } from 'antd'
import { CloseOutlined, EditOutlined, PlusOutlined } from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import type { MovementPhase } from '../../../services/generated'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { useOrderedDesignItems } from './useOrderedDesignItems'

/** 运镜独有的名称与删除语义；排序基础只处理稳定 ID，不改变画面采用。 */
export function MovementPhaseTabs({ phases, activeId, onSelect, onRename, onOrder, onAdd, onDelete, uses, disabled, editorOpen, issues }: {
  phases: MovementPhase[]; activeId: string; onSelect: (id: string) => void; onRename: (id: string, name: string) => void; onOrder: (ids: string[]) => void; onAdd: () => string; onDelete: (id: string) => void; uses: (id: string) => number; disabled?: boolean; editorOpen?: boolean; issues: string[];
}) {
  const list = useRef<HTMLDivElement>(null), input = useRef<InputRef>(null)
  const [editing, setEditing] = useState<{ id: string; name: string }>()
  const edit = useRef(editing); edit.current = editing
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
  return <div className="movement-sequence">
    <div ref={list} className="movement-keyframe-list" role="tablist" aria-label="关键画面列表" onPointerDown={sort.onPointerDown} onClickCapture={sort.onClickCapture} onKeyDown={event => {
      sort.onKeyDown(event)
      if (event.defaultPrevented || (event.target as HTMLElement).closest('input, [data-sort-ignore]')) return
      if (event.key === 'F2') { event.preventDefault(); rename(activeId); return }
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault(); const current = items.findIndex(item => item.id === activeId)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + items.length) % items.length
      finish(true); onSelect(items[index].id); list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[index]?.focus()
    }}>
      {items.map((item, index) => {
        const phase = phases.find(phase => phase.id === item.id), selected = activeId === item.id, count = phase ? uses(phase.id) : 0
        return <div key={item.id} className="movement-phase-tab" data-sort-id={phase?.id} data-dragging={sort.drag?.id === item.id} data-drop-target={phase && sort.drag && phases[sort.drag.to]?.id === phase.id} data-drop-side={sort.drag && phases.findIndex(phase => phase.id === sort.drag!.id) < sort.drag.to ? 'after' : 'before'} data-selected={selected}>
          {editing?.id === item.id ? <Input ref={input} aria-label="画面名称" disabled={disabled} value={editing.name} onChange={event => setEditing({ ...editing, name: event.target.value })} onBlur={() => finish(true)} onKeyDown={event => { event.stopPropagation(); if (!event.nativeEvent.isComposing && (event.key === 'Enter' || event.key === 'Escape')) { event.preventDefault(); finish(event.key === 'Enter'); requestAnimationFrame(() => list.current?.querySelector<HTMLButtonElement>(`[data-sort-id="${CSS.escape(item.id)}"] [role="tab"]`)?.focus()) } }} /> : <button type="button" role="tab" aria-selected={selected} tabIndex={selected ? 0 : -1} title={`${item.name || '未命名画面'}${issues.includes(item.id) ? ' · 引用需处理' : ''}${phase && !disabled ? ' · 双击或F2改名；拖动或Ctrl/⌘+Shift+左右键排序' : ''}`} aria-keyshortcuts={phase && !disabled ? 'F2 Control+Shift+ArrowLeft Control+Shift+ArrowRight Meta+Shift+ArrowLeft Meta+Shift+ArrowRight' : undefined} onClick={() => { finish(true); onSelect(item.id) }} onDoubleClick={() => phase && rename(phase.id)}>{phase ? `${String(index).padStart(2, '0')} ${(item.name || '').trim() || '未命名画面'}` : item.name}{issues.includes(item.id) && ' · 引用需处理'}</button>}
          {phase && !disabled && <div className="movement-tab-actions" data-sort-ignore>
            <WorkbenchIconButton label={`编辑画面名称 ${item.name || '未命名画面'}`} variant="quiet" icon={<EditOutlined />} onClick={() => rename(phase.id)} />
            <Popconfirm getPopupContainer={node => node.closest<HTMLElement>('.design-preset-editor') || node.parentElement!} title={`此画面正被 ${count} 处定位使用`} description="删除后，相关目标需重新选择。" disabled={!count} okText="删除画面" cancelText="取消" onConfirm={() => onDelete(phase.id)}><WorkbenchIconButton label={`删除画面 ${item.name || '未命名画面'}`} variant="quiet" icon={<CloseOutlined />} onClick={() => { finish(true); if (!count) onDelete(phase.id) }} /></Popconfirm>
          </div>}
        </div>
      })}
    </div>
    <ConfigProvider componentDisabled={false}>{overflow && <Select className="movement-frame-select" aria-label="全部画面" value={activeId} onChange={id => { finish(true); onSelect(id) }} options={items.map((item, index) => ({ value: item.id, label: `${index ? index + ' ' : ''}${item.name || '未命名画面'}` }))} />}</ConfigProvider>
    <WorkbenchIconButton label="添加关键画面" variant="quiet" icon={<PlusOutlined />} disabled={disabled} onClick={() => { finish(true); const id = onAdd(); setEditing({ id, name: '' }) }} />
    <span className="design-sort-status" role="status">{sort.drag ? '正在调整画面顺序，松开完成' : ''}</span>
  </div>
}
