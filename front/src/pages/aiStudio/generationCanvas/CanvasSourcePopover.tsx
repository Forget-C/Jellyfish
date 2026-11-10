import { useEffect, useId, useRef, useState } from 'react'
import { Popover, theme } from 'antd'
import type { CanvasSourceIndex } from '../../../services/generated'
import { useVideoSourceStatus } from './videoSourceStatus'

export type CanvasSourceItem = { source: CanvasSourceIndex; label: string; position?: string; issue?: string; missing?: boolean; fileId?: string }

/** 卡片来源只提供同画布导航，不创建候选或采用。 */
export function CanvasSourcePopover({ items, onLocate }: {
  items: CanvasSourceItem[]
  onLocate: (source: CanvasSourceIndex, trigger: HTMLButtonElement) => void
}) {
  const id = useId()
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
      <ul>{open && items.map((item, index) => <SourceRow key={index} item={item} onLocate={source => {
        setOpen(false)
        if (button.current) onLocate(source, button.current)
      }} />)}</ul>
    </section>}>
    <button ref={button} type="button" className="generation-source-trigger" aria-expanded={open} aria-controls={open ? id : undefined}
      aria-haspopup="dialog" onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape' && open && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); setOpen(false) }
      }}>引用</button>
  </Popover>
}

function SourceRow({ item, onLocate }: { item: CanvasSourceItem; onLocate: (source: CanvasSourceIndex) => void }) {
  const { source, label, position, issue, missing, fileId } = item
  const { token } = theme.useToken()
  const check = useVideoSourceStatus(missing ? undefined : fileId)
  const available = !missing && (!fileId || check === 'available')
  const status = issue || (fileId && !missing && !available
    ? check === 'unavailable' ? '来源视频已不可用' : '正在核对来源视频' : undefined)
  const title = fileId ? `视频文件 ${fileId}` : undefined
  const detail = <>{label}{position && <small>{position}</small>}</>
  return <li>
    {available ? <button type="button" title={title} onClick={() => onLocate(source)}>{detail}</button>
      : <span title={title}>{detail}{fileId && status && <small>视频文件 {fileId.slice(0, 8)}</small>}</span>}
    {status && <small style={{ color: token.colorWarning }}>{status}</small>}
  </li>
}
