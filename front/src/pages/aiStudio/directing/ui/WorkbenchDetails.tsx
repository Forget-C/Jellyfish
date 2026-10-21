import { WorkbenchReadingContext } from './WorkbenchReadingContext'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { Dispatch, ReactNode, SetStateAction } from 'react'
import { createPortal } from 'react-dom'
import { CloseOutlined, ExpandOutlined, ShrinkOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from './WorkbenchButton'
import { useWorkbenchDesktop } from '../useWorkbenchDesktop'

const DetailsContext = createContext<{ active?: string; select: Dispatch<SetStateAction<string | undefined>> } | undefined>(undefined)

export function useWorkbenchDetailsAvailable() { return !!useContext(DetailsContext) }

/** 一个工作台只有一个详情位置；替换展示目标不销毁业务组件持有的输入。 */
export function WorkbenchDetailsProvider({ children }: { children: ReactNode }) {
  const [active, select] = useState<string>()
  return <DetailsContext.Provider value={{ active, select }}>{children}</DetailsContext.Provider>
}

/** 非事务性详情外壳；保留同一编辑会话，保存和关闭保护由调用方负责。 */
export function WorkbenchDetails({ title, status, open, onClose, trigger, children, initialExpanded = false, closeDisabled = false, onDeactivate, focusTarget }: {
  focusTarget?: { fieldId: string; serial: number }
  title: string; status?: ReactNode; open: boolean; onClose: () => void; trigger?: HTMLElement; children: ReactNode; initialExpanded?: boolean; closeDisabled?: boolean; onDeactivate?: () => void;
}) {
  const desktop = useWorkbenchDesktop()
  const modal = !desktop || closeDisabled
  const [expanded, setExpanded] = useState(initialExpanded)
  const id = useId()
  const details = useContext(DetailsContext)
  const select = details?.select
  useEffect(() => { if (open) select?.(id) }, [open, id, select])
  const visible = open && (!details || details.active === id)
  const panel = useRef<HTMLElement>(null)
  const opener = useRef<HTMLElement>()
  if (trigger) opener.current = trigger
  const activated = useRef(false)
  const deactivate = useRef(onDeactivate || onClose)
  deactivate.current = onDeactivate || onClose
  useEffect(() => {
    if (!open) { activated.current = false; return }
    if (details?.active === id) activated.current = true
    else if (activated.current && open) { activated.current = false; deactivate.current() }
  }, [details?.active, id, open])
  const close = useRef(onClose)
  close.current = () => { if (!closeDisabled) onClose() }
  const titleId = useId()
  useEffect(() => {
    if (!visible) return
    if (!trigger) opener.current = document.activeElement as HTMLElement
    const node = panel.current
    const workbench = document.querySelector<HTMLElement>('.canvas-workbench')
    const wasInert = workbench?.inert
    if (modal) {
      if (workbench) workbench.inert = true
      node?.focus()
    }
    // AntD 操作和一致性保护继续拥有最高层；不卸载底层编辑内容。
    const blocked = () => [...document.querySelectorAll<HTMLElement>('.ant-modal-wrap, .ant-drawer-content-wrapper')]
      .some(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden' && getComputedStyle(element).display !== 'none')
    const sync = () => {
      if (node && node.inert !== blocked()) node.inert = blocked()
      if (modal && workbench && !workbench.inert) workbench.inert = true
    }
    sync()
    const observer = new MutationObserver(sync)
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'class', 'inert'] })
    const keyboard = (event: KeyboardEvent) => {
      if (!node || node.inert || event.defaultPrevented) return
      if (event.key === 'Escape') {
        // 画布菜单可能通过 portal 位于详情之外，先让菜单自己的监听器消费 Escape。
        const menuOpen = [...document.querySelectorAll<HTMLElement>('[role="menu"]')]
          .some(menu => menu.getClientRects().length && getComputedStyle(menu).visibility !== 'hidden')
        if (menuOpen || node.querySelector('[role="combobox"][aria-expanded="true"], [aria-haspopup][aria-expanded="true"]')) return
        event.preventDefault(); event.stopPropagation(); close.current()
      }
      if (modal && event.key === 'Tab') {
        const items = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, audio[controls], video[controls], [tabindex], a[href], [contenteditable="true"]')]
          .filter(element => element.tabIndex >= 0 && element.getClientRects().length && !element.closest('[hidden], [inert]'))
        const first = items[0], last = items[items.length - 1]
        if (!first) { event.preventDefault(); node.focus() }
        else if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus() }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first.focus() }
      }
    }
    document.addEventListener('keydown', keyboard)
    return () => {
      observer.disconnect(); document.removeEventListener('keydown', keyboard)
      if (modal && workbench) workbench.inert = !!wasInert
      if (!node || node.contains(document.activeElement) || document.activeElement === document.body) {
        const fallback = [...document.querySelectorAll<HTMLElement>('.canvas-workbench button:not(:disabled), .canvas-workbench [tabindex="0"]')].find(element => element.getClientRects().length && !element.closest('[hidden], [inert]'))
        const entry = opener.current
        const target = entry?.isConnected && entry.getClientRects().length && !entry.closest('[hidden], [inert]') ? entry : fallback
        target?.focus({ preventScroll: true })
      }
    }
  }, [visible, modal])
  useEffect(() => {
    if (!visible || !focusTarget?.fieldId) return
    const field = document.getElementById(focusTarget.fieldId)
    if (field && panel.current?.contains(field)) {
      field.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      field.focus({ preventScroll: true })
    }
  }, [visible, focusTarget?.fieldId, focusTarget?.serial])
  return createPortal(<section ref={panel} hidden={!visible} tabIndex={-1} role={modal ? 'dialog' : 'complementary'}
    aria-modal={modal ? true : undefined} aria-labelledby={titleId}
    className="canvas-workbench-dialog wb-details" data-expanded={expanded}>
    <header className="wb-details-header"><div><h2 id={titleId}>{title}</h2>{status && <small role="status">{status}</small>}</div>
      <WorkbenchIconButton variant="quiet" label={expanded ? '收起详情' : '展开详情'} icon={expanded ? <ShrinkOutlined /> : <ExpandOutlined />} onClick={() => setExpanded(value => !value)} />
      <WorkbenchIconButton variant="quiet" label="关闭详情" icon={<CloseOutlined />} disabled={closeDisabled} onClick={() => close.current()} />
    </header>
    <div className="wb-details-body"><WorkbenchReadingContext.Provider value>{children}</WorkbenchReadingContext.Provider></div>
  </section>, document.body)
}
