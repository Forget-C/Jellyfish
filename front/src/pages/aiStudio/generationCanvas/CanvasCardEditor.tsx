import { createContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseOutlined, ExpandOutlined, ShrinkOutlined, FileTextOutlined, PictureOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { useWorkbenchDetailsSlot } from '../directing/ui/WorkbenchDetails'
import { WorkbenchReadingContext } from '../directing/ui/WorkbenchReadingContext'
import { useWorkbenchDesktop } from '../directing/useWorkbenchDesktop'

/** 编辑器本体和独立菜单取消后使用同一可见焦点顺序。 */
export function canvasEditorFocusTargets(root: HTMLElement) {
  return [...root.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"], [contenteditable="true"], summary, a[href]')].filter(item => item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden')
}

/** 操作条位于滚动正文之外；复杂设计编辑器仍保留同一实例。 */
export const CanvasEditorHeader = createContext<HTMLElement | null>(null)

export const CanvasEditorFooter = createContext<HTMLElement | null>(null)

/** A single retained editor moves between its card anchor and a modal without remounting fields. */
export function CanvasCardEditor({ title, status, open, onClose, trigger, anchor, layoutKey, expandRequest, forceModal = false, material = false, focusLayout = false, modality, cardType, onReveal, suppressed = false, children }: {
  title: string; status?: ReactNode; open: boolean; onClose: () => void; trigger?: HTMLElement;
  anchor?: HTMLElement | null; layoutKey: string; suppressed?: boolean; onReveal: (offset: { x: number; y: number }) => (() => void);
  expandRequest?: number; forceModal?: boolean; material?: boolean; focusLayout?: boolean; modality?: string; cardType?: string; children: ReactNode;
}) {
  const desktop = useWorkbenchDesktop()
  const visualDesign = ['direction.movement', 'direction.composition', 'direction.style', 'direction.camera', 'direction.lighting', 'direction.focus'].includes(cardType || '')
  const slot = useWorkbenchDetailsSlot(), slotId = useId(), selectSlot = slot?.select
  const slotSelected = !slot || slot.active === slotId
  const activated = useRef(false)
  useEffect(() => { if (open) selectSlot?.(slotId) }, [open, selectSlot, slotId])
  const [expanded, setExpanded] = useState(false)
  const [placement, setPlacement] = useState({ left: 16, top: 100, maxHeight: 360, width: 700 })
  const panel = useRef<HTMLElement>(null)
  const menuAtMaskPress = useRef(false)
  const [header, setHeader] = useState<HTMLDivElement | null>(null)
  const [footer, setFooter] = useState<HTMLDivElement | null>(null)
  const close = useRef(onClose); close.current = onClose
  const opener = useRef(trigger); opener.current = trigger
  const dismiss = useRef<() => void>(() => {})
  dismiss.current = () => {
    const target = opener.current, node = panel.current
    onClose()
    // 隐藏节点会先失去焦点；等模态层解除 inert 后再恢复，避免焦点落到 body。
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (document.activeElement === document.body || node?.contains(document.activeElement)) {
        const fallback = document.querySelector<HTMLElement>('.generation-surface')
        const destination = target?.isConnected ? target : fallback
        destination?.focus({ preventScroll: true })
      }
    }))
  }
  const modal = forceModal || expanded || !desktop
  const anchoredHeightLimit = material ? 320 : 360
  const previousOpen = useRef(false)
  const lastModal = useRef(modal)
  const lastViewport = useRef({ width: window.innerWidth, height: window.innerHeight })
  const cancelReveal = useRef<() => void>()
  const reveal = useRef(onReveal); reveal.current = onReveal
  useEffect(() => () => cancelReveal.current?.(), [])
  useEffect(() => { if (expandRequest) setExpanded(true) }, [expandRequest])
  useLayoutEffect(() => {
    const node = panel.current
    if (!open || !node || !anchor || !slotSelected) { cancelReveal.current?.(); previousOpen.current = false; return }
    // 连线等临时隐藏不等于关闭；恢复同一会话时尊重用户手动视角。
    if (suppressed) { cancelReveal.current?.(); return }
    if (modal) cancelReveal.current?.()
    // The available rectangle excludes persistent canvas chrome, not just the viewport edge.
    const chrome = [...document.querySelectorAll<HTMLElement>('.generation-card-categories, .generation-workbench-header, .generation-browse, .generation-view-tools, .generation-bottom-right')]
    const available = () => {
      const bounds = { left: 16, top: 80, right: window.innerWidth - 16, bottom: window.innerHeight - 16 }
      for (const element of chrome) {
        if (!element.getClientRects().length) continue
        const rect = element.getBoundingClientRect()
        if (element.matches('.generation-card-categories')) bounds.left = Math.max(bounds.left, rect.right + 10)
        else if (element.matches('.generation-workbench-header, .generation-browse')) bounds.top = Math.max(bounds.top, rect.bottom + 10)
        else bounds.bottom = Math.min(bounds.bottom, rect.top - 10)
      }
      return bounds
    }
    const position = () => {
      const box = anchor.getBoundingClientRect(), bounds = available()
      const width = Math.min(focusLayout || material ? 700 : 680, Math.max(100, bounds.right - bounds.left))
      const maxHeight = Math.max(100, bounds.bottom - bounds.top)
      // 先应用本次尺寸再测量，避免重开时沿用上次受限高度，恢复高度后底部越界。
      if (!modal) {
        node.style.width = `${width}px`
        node.style.maxHeight = `${Math.min(anchoredHeightLimit, maxHeight)}px`
      }
      const height = Math.min(node.getBoundingClientRect().height || anchoredHeightLimit, anchoredHeightLimit, maxHeight)
      const left = box.left, top = box.bottom + 16
      const shrinking = window.innerWidth < lastViewport.current.width || window.innerHeight < lastViewport.current.height
      if (!modal && (!previousOpen.current || lastModal.current || shrinking)) {
        // 整体能放下时一起让位；过大时优先保证编辑区，卡片允许部分离开视口。
        const fitsHeight = box.height + 16 + height <= bounds.bottom - bounds.top
        const fitsWidth = Math.max(box.width, width) <= bounds.right - bounds.left
        const firstY = fitsHeight ? box.top : top, lastY = top + height
        const lastX = left + (fitsWidth ? Math.max(box.width, width) : width)
        const x = left < bounds.left ? bounds.left - left : lastX > bounds.right ? bounds.right - lastX : 0
        const y = firstY < bounds.top ? bounds.top - firstY : lastY > bounds.bottom ? bounds.bottom - lastY : 0
        if (x || y) cancelReveal.current = reveal.current({ x, y })
      }
      previousOpen.current = true
      lastModal.current = modal
      lastViewport.current = { width: window.innerWidth, height: window.innerHeight }
      setPlacement({ left, top, width, maxHeight })
    }

    position()
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    observer.observe(node)
    const imageContent = cardType === 'content.image' ? node.querySelector('.wb-details-body')?.firstElementChild : undefined
    if (imageContent) observer.observe(imageContent)
    chrome.forEach(element => observer.observe(element))
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [open, anchor, layoutKey, desktop, expanded, material, focusLayout, cardType, slotSelected, anchoredHeightLimit, modal, suppressed])
  useEffect(() => {
    if (!open) { activated.current = false; return }
    if (slot?.active === slotId) activated.current = true
    else if (activated.current) { activated.current = false; close.current() }
  }, [open, slot?.active, slotId])
  const visible = open && !suppressed && (!slot || slot.active === slotId)
  useLayoutEffect(() => {
    const node = panel.current
    const body = node?.querySelector<HTMLElement>('.wb-details-body')
    if (!visible || !material || !node || !body) return
    // 候选面板覆盖正文时，仍保留右上放大和底部固定操作可达。
    const measure = () => {
      const references = node.querySelector<HTMLElement>('.generation-material-basis')?.getBoundingClientRect().height || 0
      node.style.setProperty('--generation-candidate-height', `${Math.max(0, body.getBoundingClientRect().height - references - 16)}px`)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(body)
    return () => observer.disconnect()
  }, [visible, material])
  useEffect(() => {
    if (!visible) panel.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause())
  }, [visible])
  useEffect(() => {
    if (!visible) return
    const node = panel.current
    const workbench = document.querySelector<HTMLElement>('.canvas-workbench')
    const prior = workbench?.inert
    if (modal && workbench) { workbench.inert = true; node?.focus() }
    // Operation dialogs own focus while the retained card editor stays mounted below them.
    const syncBlocked = () => {
      if (node) node.inert = [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap, .ant-drawer-content-wrapper')]
        .some(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none')
      if (node?.inert) node.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause())
    }
    syncBlocked()
    const observer = new MutationObserver(syncBlocked)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class'] })
    const keyboard = (event: KeyboardEvent) => {
      if (node?.inert || event.defaultPrevented || event.isComposing || document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return
      const menus = [...document.querySelectorAll<HTMLElement>('[role="menu"], .generation-card-menu, .canvas-toolbar-popover')]
        .filter(menu => !menu.closest('[inert]') && menu.getClientRects().length && getComputedStyle(menu).visibility !== 'hidden')
      if (menus.some(menu => menu.matches('[role="menu"]')) || node?.querySelector('[role="combobox"][aria-expanded="true"]')) return
      if (event.key === 'Escape') {
        const materials = node?.querySelector<HTMLDetailsElement>('.generation-material-candidates[open]')
        if (materials) {
          event.preventDefault(); event.stopPropagation(); materials.open = false; materials.querySelector('summary')?.focus(); return
        }
      }
      if (menus.length) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        if (desktop && expanded && !forceModal) { setExpanded(false) } else dismiss.current()
      }
      if (modal && event.key === 'Tab' && node) {
        const items = canvasEditorFocusTargets(node)
        const first = items[0], last = items[items.length-1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => { observer.disconnect(); if (node) node.inert = false; document.removeEventListener('keydown', keyboard); if (modal && workbench) workbench.inert = !!prior; if (node?.contains(document.activeElement)) opener.current?.focus({preventScroll:true}) }
  }, [visible, modal, expanded, forceModal, desktop])
  return createPortal(<>
    {visible && modal && <div className="generation-editor-mask" onPointerDown={() => { menuAtMaskPress.current = !!panel.current?.querySelector('[data-design-menu-open="true"]') }} onClick={() => {
      if (menuAtMaskPress.current) { menuAtMaskPress.current = false; return }
      if (desktop && expanded && !forceModal) setExpanded(false)
      else dismiss.current()
    }} />}
    <section ref={panel} hidden={!visible} tabIndex={-1} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label={title}
      className="canvas-workbench-dialog wb-details generation-card-editor" data-expanded={modal} data-narrow={!desktop} data-design-editor={visualDesign} data-preset-design={['direction.movement', 'direction.composition', 'direction.style', 'direction.camera', 'direction.lighting', 'direction.focus'].includes(cardType || '')} data-material={material} data-focus-layout={focusLayout} data-card-type={cardType} style={!modal ? {left:placement.left, top:placement.top, width:placement.width, maxHeight:Math.min(anchoredHeightLimit, placement.maxHeight)} : visualDesign ? { top: 'var(--design-editor-top)', height: ['direction.movement', 'direction.composition', 'direction.style', 'direction.camera', 'direction.lighting', 'direction.focus'].includes(cardType || '') ? 'min(730px, calc(100dvh - 2 * var(--design-editor-top)))' : 'auto', maxHeight: 'calc(100dvh - 2 * var(--design-editor-top))', transform: 'translateX(-50%)' } : undefined}>
      <header className={`wb-details-header${material ? ' generation-model-editor-chrome' : ''}`}>{!material && <div className="generation-editor-heading">{focusLayout && <span className="generation-editor-modality" aria-hidden="true">{modality === 'image' ? <PictureOutlined /> : <FileTextOutlined />}</span>}<h2 title={title}>{title}</h2>{status && <small role="status">{status}</small>}</div>}
        <div ref={setHeader} className="generation-editor-tools" />
        {desktop && !forceModal && <WorkbenchIconButton variant="quiet" label={expanded ? '收起详情' : '展开详情'} icon={expanded ? <ShrinkOutlined /> : <ExpandOutlined />} onClick={() => setExpanded(value=>!value)} />}
        {(!desktop || !material) && <WorkbenchIconButton style={!desktop && visualDesign ? { minWidth: 44, minHeight: 44 } : undefined} variant="quiet" label="关闭详情" icon={<CloseOutlined />} onClick={() => desktop && expanded && !forceModal ? setExpanded(false) : dismiss.current()} />}
      </header>
      <div className="wb-details-body">{/* 隐藏时保留页脚宿主，避免 portal 重建导致媒体选择状态丢失。 */}<CanvasEditorHeader.Provider value={header}><CanvasEditorFooter.Provider value={footer}><WorkbenchReadingContext.Provider value>{children}</WorkbenchReadingContext.Provider></CanvasEditorFooter.Provider></CanvasEditorHeader.Provider></div>
      <div ref={setFooter} className="generation-editor-actions" />
    </section>
  </>, document.body)
}
