import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { WorkbenchButton } from '../../../components/workbench/WorkbenchButton'

/** 工具菜单只改变可见性，子组件持续挂载，避免收起菜单中断任务或丢失输入。 */
export function CanvasToolbarMenu({ label, children, icon, caption, compact = false }: {
  label: string
  children: ReactNode | ((focusTrigger: () => void) => ReactNode)
  icon?: ReactNode
  caption?: ReactNode
  compact?: boolean
}) {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || root.current?.closest('[inert]')) return
      event.preventDefault(); event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true })
    }
    document.addEventListener('pointerdown', dismiss)
    // Editor popups resolve at document before this outside-focus fallback.
    window.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', dismiss); window.removeEventListener('keydown', escape) }
  }, [open])
  return <div className={`canvas-toolbar-menu${compact ? ' canvas-toolbar-menu--compact' : ''}`} ref={root} onKeyDown={event => {
    if (!event.defaultPrevented && !event.nativeEvent.isComposing && event.key === 'Escape' && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus({ preventScroll: true }) }
  }}>
    <WorkbenchButton ref={trigger} variant="quiet" icon={icon} aria-label={label} title={label} aria-expanded={open} aria-controls={id}
      onClick={() => setOpen(value => !value)}>{caption}</WorkbenchButton>
    <div id={id} className="canvas-toolbar-popover canvas-workbench-dialog" role="group" aria-label={`${label}选项`} hidden={!open}
      onClick={event => {
        if (event.target instanceof Element && event.target.closest('[data-menu-close]') && root.current?.contains(event.target)) {
          setOpen(false); trigger.current?.focus({ preventScroll: true })
        }
      }}>
      {typeof children === 'function' ? children(() => trigger.current?.focus({ preventScroll: true })) : children}
    </div>
  </div>
}
