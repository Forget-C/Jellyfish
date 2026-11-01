import { createContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseOutlined, ExpandOutlined, ShrinkOutlined, FileTextOutlined, PictureOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { useWorkbenchDetailsSlot } from '../directing/ui/WorkbenchDetails'
import { WorkbenchReadingContext } from '../directing/ui/WorkbenchReadingContext'
import { useWorkbenchDesktop } from '../directing/useWorkbenchDesktop'

/** 操作条位于滚动正文之外；复杂设计编辑器仍保留同一实例。 */
export const CanvasEditorFooter = createContext<HTMLElement | null>(null)

/** A single retained editor moves between its card anchor and a modal without remounting fields. */
export function CanvasCardEditor({ title, status, open, onClose, trigger, anchor, layoutKey, expandRequest, forceModal = false, material = false, focusLayout = false, modality, cardType, children }: {
  title: string; status?: ReactNode; open: boolean; onClose: () => void; trigger?: HTMLElement;
  anchor?: HTMLElement | null; layoutKey: string;
  expandRequest?: number; forceModal?: boolean; material?: boolean; focusLayout?: boolean; modality?: string; cardType?: string; children: ReactNode;
}) {
  const desktop = useWorkbenchDesktop()
  const slot = useWorkbenchDetailsSlot(), slotId = useId(), selectSlot = slot?.select
  const activated = useRef(false)
  useEffect(() => { if (open) selectSlot?.(slotId) }, [open, selectSlot, slotId])
  const [expanded, setExpanded] = useState(false)
  const [placement, setPlacement] = useState({ left: 16, top: 100, maxHeight: 360, visible: true })
  const panel = useRef<HTMLElement>(null)
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
  const anchorFits = useRef(true)
  const anchorSide = useRef<'bottom' | 'top' | 'right' | 'left'>()
  useEffect(() => { if (expandRequest) setExpanded(true) }, [expandRequest])
  useLayoutEffect(() => {
    const node = panel.current
    if (!open || !node || !anchor) { previousOpen.current = open; return }
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
      const visible = box.bottom > 64 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth
      const width = Math.min(focusLayout || material ? 700 : 680, bounds.right - bounds.left)
      const height = Math.min(anchoredHeightLimit, anchoredHeightLimit, bounds.bottom - bounds.top)
      if (!previousOpen.current || !anchorSide.current) {
        const candidates = [
          { x: box.left, y: box.bottom + 16 },
          { x: box.left, y: box.top - height - 16 },
          { x: box.right + 16, y: box.top },
          { x: box.left - width - 16, y: box.top },
        ]
        const placement = candidates.find(point => point.x >= bounds.left && point.x + width <= bounds.right && point.y >= bounds.top && point.y + height <= bounds.bottom)
        anchorFits.current = !!placement
        if (placement) anchorSide.current = (['bottom', 'top', 'right', 'left'] as const)[candidates.indexOf(placement)]
        else { anchorSide.current = 'bottom'; if (desktop && !expanded) setExpanded(true) }
      }
      const side = anchorSide.current
      const left = side === 'right' ? box.right + 16 : side === 'left' ? box.left - width - 16 : box.left
      const top = side === 'top' ? box.top - height - 16 : side === 'bottom' ? box.bottom + 16 : box.top
      setPlacement({ left, top, maxHeight: Math.max(100, bounds.bottom - bounds.top), visible })
    }
    position()
    previousOpen.current = true
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    observer.observe(node)
    const imageContent = cardType === 'content.image' ? node.querySelector('.wb-details-body')?.firstElementChild : undefined
    if (imageContent) observer.observe(imageContent)
    chrome.forEach(element => observer.observe(element))
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [open, anchor, layoutKey, desktop, expanded, material, focusLayout, cardType, slot?.active, anchoredHeightLimit])
  useEffect(() => {
    if (!open) { activated.current = false; return }
    if (slot?.active === slotId) activated.current = true
    else if (activated.current) { activated.current = false; close.current() }
  }, [open, slot?.active, slotId])
  const visible = open && (!slot || slot.active === slotId) && (modal || placement.visible)
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
      if ([...document.querySelectorAll<HTMLElement>('[role="menu"], .generation-card-menu, .canvas-toolbar-popover')].some(menu => !menu.closest('[inert]') && menu.getClientRects().length && getComputedStyle(menu).visibility !== 'hidden') || node?.querySelector('[role="combobox"][aria-expanded="true"]')) return
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation()
        // The material picker is the innermost editor surface once native menus have closed.
        const materials = node?.querySelector<HTMLDetailsElement>('.generation-material-candidates[open]')
        if (materials) { materials.open = false; materials.querySelector('summary')?.focus(); return }
        if (expanded && !forceModal) { setExpanded(false); if (!anchorFits.current) dismiss.current() } else dismiss.current()
      }
      if (modal && event.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"], [contenteditable="true"], summary, a[href]')].filter(item => item.getClientRects().length)
        const first = items[0], last = items[items.length-1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => { observer.disconnect(); if (node) node.inert = false; document.removeEventListener('keydown', keyboard); if (modal && workbench) workbench.inert = !!prior; if (node?.contains(document.activeElement)) opener.current?.focus({preventScroll:true}) }
  }, [visible, modal, expanded, forceModal])
  return createPortal(<>
    {visible && modal && <div className="generation-editor-mask" onClick={() => expanded && !forceModal ? setExpanded(false) : dismiss.current()} />}
    <section ref={panel} hidden={!visible} tabIndex={-1} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label={title}
      className="canvas-workbench-dialog wb-details generation-card-editor" data-expanded={modal} data-material={material} data-focus-layout={focusLayout} data-card-type={cardType} style={!modal ? {left:placement.left, top:placement.top, maxHeight:Math.min(anchoredHeightLimit, placement.maxHeight)} : undefined}>
      <header className={`wb-details-header${material ? ' generation-model-editor-chrome' : ''}`}>{!material && <div className="generation-editor-heading">{focusLayout && <span className="generation-editor-modality" aria-hidden="true">{modality === 'image' ? <PictureOutlined /> : <FileTextOutlined />}</span>}<h2 title={title}>{title}</h2>{status && <small role="status">{status}</small>}</div>}
        {!forceModal && <WorkbenchIconButton variant="quiet" label={expanded ? '收起详情' : '展开详情'} icon={expanded ? <ShrinkOutlined /> : <ExpandOutlined />} onClick={() => { if (expanded && !anchorFits.current) dismiss.current(); setExpanded(value=>!value) }} />}
        {!material && <WorkbenchIconButton variant="quiet" label="关闭详情" icon={<CloseOutlined />} onClick={() => expanded && !forceModal ? setExpanded(false) : dismiss.current()} />}
      </header>
      <div className="wb-details-body">{/* 隐藏时保留页脚宿主，避免 portal 重建导致媒体选择状态丢失。 */}<CanvasEditorFooter.Provider value={footer}><WorkbenchReadingContext.Provider value>{children}</WorkbenchReadingContext.Provider></CanvasEditorFooter.Provider></div>
      <div ref={setFooter} className="generation-editor-actions" />
    </section>
  </>, document.body)
}
