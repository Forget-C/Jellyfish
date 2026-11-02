import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { CardList } from './CardList'
import type { CanvasCatalog } from '../../../services/generated'

export type ContextAction = { label: string; shortcut?: string; reason?: string; danger?: boolean; run: () => void }
/** 屏幕坐标浮层独占本轮输入；关闭点击不会穿透到底层画布。 */
export function CanvasContextMenu({ x, y, card, actions, catalog, onAdd, onClose }: { x: number; y: number; card: boolean; actions: ContextAction[]; catalog: CanvasCatalog; onAdd: (type: string, entry?: string) => void; onClose: () => void }) {
  const host = useRef<HTMLDivElement>(null)
  const [category, setCategory] = useState<string>()
  const [adding, setAdding] = useState(false)
  useLayoutEffect(() => {
    const menu = host.current!
    menu.style.left = `${Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8))}px`
    menu.style.top = `${Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8))}px`
    menu.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y, adding])
  useEffect(() => {
    const close = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); onClose() }
    const wheel = (event: WheelEvent) => { if(host.current?.contains(event.target as Node)) { event.stopPropagation();return } close(event) }
    const outside = (event: PointerEvent) => {
      if (host.current?.contains(event.target as Node)) return
      // 右键没有后续 click；只消费本次主键点击，避免误吞新菜单的首次操作。
      if (event.button === 0) {
        const consumeClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation() }
        window.addEventListener('click', consumeClick, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', consumeClick, true), 1000)
      }
      close(event)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); if (adding) setAdding(false); else onClose(); return }
      if (event.target instanceof Element && event.target.closest('input')) return
      if(event.key==='ArrowRight' && !card && !actions.find(action=>action.label==='新建节点')?.reason){event.preventDefault();event.stopImmediatePropagation();setAdding(true);setCategory('基础卡');requestAnimationFrame(()=>host.current?.querySelector<HTMLElement>('.generation-context-add button')?.focus());return}
      if(event.key==='ArrowLeft' && adding){event.preventDefault();event.stopImmediatePropagation();setAdding(false);host.current?.querySelector<HTMLElement>('button')?.focus();return}
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation()
        const items = [...host.current!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
        const index = items.indexOf(window.document.activeElement as HTMLButtonElement)
        items[event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus()
      } else if (!['Tab', 'Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopImmediatePropagation() }
      if (event.key === 'Tab') close(event)
    }
    window.addEventListener('pointerdown', outside, true); window.addEventListener('wheel', wheel, { capture: true, passive: false }); window.addEventListener('keydown', keyboard, true)
    window.addEventListener('blur', onClose); window.addEventListener('resize', onClose)
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('wheel', wheel, true); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose) }
  }, [onClose, adding, card, actions])
  const content: ReactNode = <div ref={host} className="generation-context-menu" role="menu" data-adding={adding} aria-label={card ? '卡片右键菜单' : '画布右键菜单'} style={{ left: x, top: y }} onContextMenu={event => event.preventDefault()}>
    {actions.map(action => <Button variant={action.danger ? 'danger' : 'quiet'} key={action.label} role="menuitem" aria-label={action.label} disabled={!!action.reason} title={action.reason} data-danger={action.danger} onMouseEnter={() => { if (action.label === '新建节点' && !action.reason) { setAdding(true); setCategory('基础卡') } }} onClick={() => {
      if (action.reason) return
      if (action.label === '新建节点') { setAdding(true); setCategory('基础卡'); return }
      onClose(); action.run()
    }}>{action.label}<small>{action.label==='新建节点'?'›':action.shortcut}</small>{action.reason && <span className="generation-context-reason">{action.reason}</span>}</Button>)}
    {adding && <div className="generation-context-add"><CardList catalog={catalog} readonly={!!actions.find(action=>action.label==='新建节点')?.reason} active={category} onActiveChange={setCategory} onAdd={onAdd} /></div>}
  </div>
  return createPortal(content, window.document.querySelector('.canvas-workbench') || window.document.body)
}
