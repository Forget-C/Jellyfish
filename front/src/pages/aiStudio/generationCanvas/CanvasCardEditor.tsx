import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CloseOutlined, ExpandOutlined, ShrinkOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { WorkbenchReadingContext } from '../directing/ui/WorkbenchReadingContext'
import { useWorkbenchDesktop } from '../directing/useWorkbenchDesktop'

/** A single retained editor moves between its card anchor and a modal without remounting fields. */
export function CanvasCardEditor({ title, status, open, onClose, trigger, anchor, layoutKey, allowPan, onFit, expandRequest, children }: {
  title: string; status?: ReactNode; open: boolean; onClose: () => void; trigger?: HTMLElement;
  anchor?: HTMLElement | null; layoutKey: string; allowPan: boolean; onFit: (delta: {x:number;y:number}) => void;
  expandRequest?: number; children: ReactNode;
}) {
  const desktop = useWorkbenchDesktop()
  const [expanded, setExpanded] = useState(false)
  const [placement, setPlacement] = useState({ left: 16, top: 100, visible: true })
  const panel = useRef<HTMLElement>(null)
  const close = useRef(onClose); close.current = onClose
  const opener = useRef(trigger); opener.current = trigger
  const modal = expanded || !desktop
  const previousOpen = useRef(false)
  const fit = useRef(onFit); fit.current = onFit
  useEffect(() => { if (expandRequest) setExpanded(true) }, [expandRequest])
  useLayoutEffect(() => {
    const node = panel.current
    if (!open || !node || !anchor) { previousOpen.current = open; return }
    const position = () => {
      const box = anchor.getBoundingClientRect()
      const visible = box.bottom > 64 && box.top < window.innerHeight && box.right > 0 && box.left < window.innerWidth
      const width = Math.min(680, window.innerWidth - 32)
      setPlacement({ left: Math.max(16, Math.min(box.left, window.innerWidth - width - 16)), top: box.bottom + 16, visible })
      return box
    }
    const box = position()
    // Fit once on deliberate activation, never on typing, saving, dragging or media resize.
    if (!previousOpen.current && allowPan && desktop && !expanded) {
      const height = Math.min(Math.max(node.scrollHeight, 240), 360, window.innerHeight - 160)
      let y = Math.min(0, window.innerHeight - 72 - (box.bottom + 16 + height))
      if (box.height + height + 16 <= window.innerHeight - 152) y = Math.max(y, 80 - box.top)
      const x = box.left < 16 ? 16 - box.left : box.right > window.innerWidth - 16 ? window.innerWidth - 16 - box.right : 0
      if (x || y) fit.current({x,y})
    }
    previousOpen.current = true
    const observer = new ResizeObserver(position)
    observer.observe(anchor)
    window.addEventListener('resize', position)
    return () => { observer.disconnect(); window.removeEventListener('resize', position) }
  }, [open, anchor, layoutKey, allowPan, desktop, expanded])
  const visible = open && (modal || placement.visible)
  useEffect(() => {
    if (!visible) panel.current?.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause())
  }, [visible])
  useEffect(() => {
    if (!visible) return
    const node = panel.current
    const workbench = document.querySelector<HTMLElement>('.canvas-workbench')
    const prior = workbench?.inert
    if (modal && workbench) { workbench.inert = true; node?.focus() }
    const keyboard = (event: KeyboardEvent) => {
      if (event.defaultPrevented || document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return
      if (document.querySelector('[role="menu"]') || node?.querySelector('[role="combobox"][aria-expanded="true"]')) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (expanded) setExpanded(false); else close.current() }
      if (modal && event.key === 'Tab' && node) {
        const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"], summary, a[href]')].filter(item => item.getClientRects().length)
        const first = items[0], last = items[items.length-1]
        if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last?.focus() }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => { document.removeEventListener('keydown', keyboard); if (modal && workbench) workbench.inert = !!prior; if (node?.contains(document.activeElement)) opener.current?.focus({preventScroll:true}) }
  }, [visible, modal, expanded])
  return createPortal(<>
    {visible && modal && <div className="generation-editor-mask" onClick={() => expanded ? setExpanded(false) : onClose()} />}
    <section ref={panel} hidden={!visible} tabIndex={-1} role={modal ? 'dialog' : 'complementary'} aria-modal={modal || undefined} aria-label={title}
      className="canvas-workbench-dialog wb-details generation-card-editor" data-expanded={modal} style={!modal ? {left:placement.left, top:placement.top} : undefined}>
      <header className="wb-details-header"><div><h2>{title}</h2>{status && <small role="status">{status}</small>}</div>
        <WorkbenchIconButton variant="quiet" label={expanded ? '收起详情' : '展开详情'} icon={expanded ? <ShrinkOutlined /> : <ExpandOutlined />} onClick={() => setExpanded(value=>!value)} />
        <WorkbenchIconButton variant="quiet" label="关闭详情" icon={<CloseOutlined />} onClick={() => expanded ? setExpanded(false) : onClose()} />
      </header>
      <div className="wb-details-body"><WorkbenchReadingContext.Provider value>{children}</WorkbenchReadingContext.Provider></div>
    </section>
  </>, document.body)
}
