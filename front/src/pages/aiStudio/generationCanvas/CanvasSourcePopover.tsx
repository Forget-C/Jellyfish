import { useEffect, useId, useRef, useState } from 'react'
import { Popover, theme } from 'antd'
import type { CanvasSourceIndex } from '../../../services/generated'

export type CanvasSourceItem = { source: CanvasSourceIndex; label: string; position?: string; issue?: string; missing?: boolean }

/** 卡片来源只提供同画布导航，不创建候选或采用。 */
export function CanvasSourcePopover({ items, onLocate }: {
  items: CanvasSourceItem[]
  onLocate: (source: CanvasSourceIndex, trigger: HTMLButtonElement) => void
}) {
  const id = useId()
  const { token } = theme.useToken()
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null), panel = useRef<HTMLElement>(null)
  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => (panel.current?.querySelector('button') || panel.current)?.focus({ preventScroll: true }))
    return () => cancelAnimationFrame(frame)
  }, [open])
  return <Popover open={open} onOpenChange={setOpen} trigger="click" placement="bottom"
    getPopupContainer={node => node.ownerDocument.body} overlayClassName="canvas-workbench-dialog"
    content={<section ref={panel} id={id} tabIndex={-1} role="dialog" aria-label="卡片引用" className="generation-source-list"
      onPointerDown={event => event.stopPropagation()}
      onKeyDown={event => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing) return
        event.preventDefault(); event.stopPropagation(); setOpen(false); button.current?.focus({ preventScroll: true })
      }}>
      <ul>{items.map(({ source, label, position, issue, missing }, index) => <li key={index}>
        {missing ? <span>{label}</span> : <button type="button" onClick={() => {
          setOpen(false)
          if (button.current) onLocate(source, button.current)
        }}>{label}{position && <small>{position}</small>}</button>}
        {issue && <small style={{ color: token.colorWarning }}>{issue}</small>}
      </li>)}</ul>
    </section>}>
    <button ref={button} type="button" className="generation-source-trigger" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-haspopup="dialog" onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape' && open && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      }}>引用</button>
  </Popover>
}
