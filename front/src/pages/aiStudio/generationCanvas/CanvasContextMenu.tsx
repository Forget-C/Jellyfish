import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Button, ConfigProvider, Menu } from 'antd'
import type { MenuProps, MenuRef } from 'antd'
import { LeftOutlined } from '@ant-design/icons'
import { cardCategories, cardCategoryEntries, cardEntryIcon } from './CardList'
import { useWorkbenchColors } from '../../../components/workbench/WorkbenchTheme'
import type { CanvasCatalog } from '../../../services/generated'

export type ContextAction = { label: string; shortcut?: string; reason?: string; danger?: boolean; run: () => void }
type Entry = ContextAction & { key: string; icon?: ReactNode; children?: Entry[]; dividerAfter?: boolean }

/** 独立浮层采用菜单语义；桌面各级互不撑开，窄屏在同一浮层内逐级浏览。 */
export function CanvasContextMenu({ x, y, card, actions, catalog, onAdd, onClose }: { x: number; y: number; card: boolean; actions: ContextAction[]; catalog: CanvasCatalog; onAdd: (type: string, entry?: string) => void; onClose: () => void }) {
  const { tokens: workbenchTokens, dark } = useWorkbenchColors()
  const host = useRef<HTMLDivElement>(null)
  const menuRef = useRef<MenuRef>(null)
  const sessionClass = `generation-context-session-${useId().replace(/:/g, '')}`
  const narrow = window.innerWidth < 760
  const [openKeys, setOpenKeys] = useState<string[]>([])
  const [path, setPath] = useState<string[]>([])
  const scrollPositions = useRef<Record<string, number>>({})
  const returnFocus = useRef<string>()
  const rowHeight = window.matchMedia('(pointer: coarse)').matches ? 44 : 40
  const roots: Entry[] = actions.map((action, index) => ({ ...action, key: `action:${index}`, dividerAfter: action.label === '新建节点',
    children: action.label === '新建节点' ? cardCategories.map(category => ({ key: `category:${category.title}`, label: category.title, icon: category.icon, reason: action.reason, run: () => {},
      children: cardCategoryEntries(catalog, category.title).map(entry => ({ key: `node:${entry.type}:${entry.entry || ''}`, label: entry.title.replace('内容', ''), icon: cardEntryIcon(entry.modality), reason: action.reason, run: () => onAdd(entry.type, entry.entry) })),
    })) : undefined,
  }))
  const find = (key: string, entries = roots): Entry | undefined => {
    for (const entry of entries) { if (entry.key === key) return entry; const child = entry.children && find(key, entry.children); if (child) return child }
  }
  const entries = narrow && path.length ? find(path[path.length - 1])?.children || [] : roots
  const allDisabled = entries.every(entry => entry.reason)
  const inside = (target: EventTarget | null) => target instanceof Element && !!target.closest(`.${sessionClass}`)
  const focusItem = useCallback((key?: string) => {
    const selector = key ? `[data-context-key="${CSS.escape(key)}"]` : '[role="menuitem"]:not([aria-disabled="true"])'
    const item = [...window.document.querySelectorAll<HTMLElement>(`.${sessionClass} ${selector}`)].find(element => element.getClientRects().length)
    const target = item?.matches('[role="menuitem"]') ? item : item?.querySelector<HTMLElement>('[role="menuitem"]')
    if (!target) return false
    target.focus({ preventScroll: true }); return true
  }, [sessionClass])
  const navigate = (next: string[], focus?: string) => {
    const menu = host.current?.querySelector<HTMLElement>('[role="menu"]')
    scrollPositions.current[path.join('/')] = menu?.scrollTop || 0
    returnFocus.current = focus
    setPath(next)
  }
  const back = () => navigate(path.slice(0, -1), path[path.length - 1])
  const activate = (key: string) => {
    const entry = find(key)
    if (!entry || entry.reason) return
    if (narrow && entry.children) navigate([...path, key])
    else if (!entry.children) { onClose(); entry.run() }
  }
  useLayoutEffect(() => {
    setOpenKeys([]); setPath([]); scrollPositions.current = {}; returnFocus.current = undefined
  }, [x, y, card])
  useLayoutEffect(() => {
    const element = host.current!
    element.style.left = `${Math.max(8, Math.min(x, window.innerWidth - element.offsetWidth - 8))}px`
    element.style.top = `${Math.max(8, Math.min(y, window.innerHeight - element.offsetHeight - 8))}px`
    const menu = element.querySelector<HTMLElement>('[role="menu"]')
    if (menu) menu.scrollTop = scrollPositions.current[path.join('/')] || 0
    if (allDisabled) element.focus({ preventScroll: true })
    const key = returnFocus.current; returnFocus.current = undefined
    // rc-menu registers its items after layout; focus through its public API on the next frame.
    let frame = 0, attempts = 0
    const ready = () => {
      if (key || path.length) { if (focusItem(key)) return }
      else {
        menuRef.current?.focus({ preventScroll: true })
        const active = window.document.activeElement
        if (host.current?.contains(active) && active?.getAttribute('role') === 'menuitem') return
      }
      if (++attempts < 8) frame = requestAnimationFrame(ready)
    }
    frame = requestAnimationFrame(ready)
    // Desktop submenus are portals and never alter these measurements.
    return () => cancelAnimationFrame(frame)
  }, [x, y, card, path, focusItem, allDisabled])
  useLayoutEffect(() => {
    // rc-menu puts custom attributes on the outer <li>; describe the actual focusable submenu title too.
    window.document.querySelectorAll<HTMLElement>(`.${sessionClass} [data-context-key]`).forEach(element => {
      const title = element.querySelector<HTMLElement>(':scope > [role="menuitem"]')
      if (!title) return
      const reason = find(element.dataset.contextKey!)?.reason
      if (reason) { title.setAttribute('aria-description', reason); title.title = reason }
      else { title.removeAttribute('aria-description'); title.removeAttribute('title') }
    })
  })
  useEffect(() => {
    const close = (event: Event) => { event.preventDefault(); event.stopImmediatePropagation(); onClose() }
    const wheel = (event: WheelEvent) => { if (inside(event.target)) event.stopPropagation(); else close(event) }
    const outside = (event: PointerEvent) => {
      if (inside(event.target)) return
      if (event.button === 0) {
        const consumeClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation() }
        window.addEventListener('click', consumeClick, { capture: true, once: true })
        window.setTimeout(() => window.removeEventListener('click', consumeClick, true), 1000)
      }
      close(event)
    }
    const keyboard = (event: KeyboardEvent) => {
      if (event.isComposing) return
      if (event.key === 'Tab') { close(event); return }
      if (event.key === 'Escape' || narrow && event.key === 'ArrowLeft') {
        event.preventDefault(); event.stopImmediatePropagation()
        if (narrow && path.length) back()
        else if (!narrow && openKeys.length) {
          const parent = openKeys[openKeys.length - 1]; setOpenKeys(openKeys.slice(0, -1))
          requestAnimationFrame(() => focusItem(parent))
        } else if (event.key === 'Escape') onClose()
        return
      }
      if (narrow && event.key === 'ArrowRight') {
        event.preventDefault(); event.stopImmediatePropagation()
        const key = (window.document.activeElement as Element | null)?.closest('[data-context-key]')?.getAttribute('data-context-key')
        if (key && find(key)?.children) activate(key)
        return
      }
      if (!inside(event.target)) { event.preventDefault(); event.stopImmediatePropagation(); return }
      // Menu handles Enter, but Space needs the same activation as a pointer click.
      if (event.key === ' ' && event.target instanceof Element && event.target.closest('[data-context-key]')) {
        event.preventDefault(); event.stopImmediatePropagation()
        const item = event.target.closest<HTMLElement>('[role="menuitem"]')
        if (!event.repeat && item?.getAttribute('aria-disabled') !== 'true') item?.click()
        return
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation()
      }
    }
    window.addEventListener('pointerdown', outside, true); window.addEventListener('wheel', wheel, { capture: true, passive: false }); window.addEventListener('keydown', keyboard, true)
    window.addEventListener('blur', onClose); window.addEventListener('resize', onClose)
    return () => { window.removeEventListener('pointerdown', outside, true); window.removeEventListener('wheel', wheel, true); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('blur', onClose); window.removeEventListener('resize', onClose) }
  })
  const items = (values: Entry[], parents: string[] = []): MenuProps['items'] => values.flatMap((entry, index) => {
    const item = { key: entry.key, icon: entry.icon && <span aria-hidden>{entry.icon}</span>, disabled: !!entry.reason, danger: entry.danger,
      title: entry.reason || '', 'aria-label': entry.label, 'aria-description': entry.reason, 'data-context-key': entry.key,
      label: <span className="generation-context-label"><span>{entry.label}</span>{entry.shortcut && <small>{entry.shortcut}</small>}{narrow && entry.children && <small aria-hidden>›</small>}</span>,
      ...(!narrow && entry.children ? { children: items(entry.children, [...parents, entry.key]), onTitleClick: () => { if (!entry.reason) setOpenKeys([...parents, entry.key]) }, popupClassName: `generation-context-popup ${sessionClass}`, popupOffset: [4, 0] as [number, number] } : {}),
    }
    return [...(entry.danger && index ? [{ type: 'divider' as const, key: `before:${entry.key}` }] : []), item, ...(entry.dividerAfter ? [{ type: 'divider' as const, key: `after:${entry.key}` }] : [])]
  })
  const portalHost = window.document.querySelector<HTMLElement>('.canvas-workbench') || window.document.body
  return createPortal(<ConfigProvider theme={{ token: { motion: false }, components: { Menu: {
    itemHeight: rowHeight, itemBorderRadius: 8, subMenuItemBorderRadius: 8, itemMarginBlock: 0, itemMarginInline: 0,
    darkItemBg: workbenchTokens.raised, darkSubMenuItemBg: workbenchTokens.raised, darkItemColor: workbenchTokens.text,
    darkItemHoverBg: workbenchTokens.selected, darkItemSelectedBg: workbenchTokens.selected, darkItemDisabledColor: workbenchTokens.disabled,
  } } }}>
    <div ref={host} tabIndex={-1} className={`generation-context-host ${sessionClass}`} data-narrow={narrow} style={{ left: x, top: y }} onContextMenu={event => event.preventDefault()}>
      {narrow && path.length > 0 && <Button type="text" className="generation-context-back" aria-label="返回上一级" icon={<LeftOutlined />} onClick={back}>返回上一级<span>{find(path[path.length - 1])?.label}</span></Button>}
      <Menu ref={menuRef} theme={dark ? 'dark' : 'light'} mode="vertical" className="generation-context-menu" aria-label={card ? '卡片右键菜单' : '画布右键菜单'} selectable={false} items={items(entries)}
        openKeys={narrow ? [] : openKeys} onOpenChange={keys => setOpenKeys(keys)} onClick={({ key }) => activate(key)}
        subMenuOpenDelay={0.12} subMenuCloseDelay={0.2} getPopupContainer={() => portalHost} />
    </div>
  </ConfigProvider>, portalHost)
}
