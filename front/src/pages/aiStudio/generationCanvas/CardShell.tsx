import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CanvasCard } from '../../../components/canvas/Canvas'
import { MoreOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import type { CanvasPoint } from '../../../components/canvas/geometry'

/** 卡片仅管理阅读、布局和选择；编辑及采用仍由业务详情负责。 */
export function CardShell({ id, title, name, contextKey, point, scale, width, height, selected, readonly, removeDisabled, onSelect, onMove, onRemove, connections, children, footer, onOpen }:
  { id: string; title: string; name?: string; contextKey: string; point: CanvasPoint; scale: number; width: number; height?: number; selected: boolean; readonly?: boolean; removeDisabled?: boolean;
    onSelect: (selected: boolean) => void; onMove: (point: CanvasPoint) => void; onRemove: () => void;
    connections: ReactNode; children: ReactNode; footer?: ReactNode; onOpen: (trigger: HTMLElement) => void }) {
  const [menu, setMenu] = useState(false)
  const [holding, setHolding] = useState(false)
  const gesture = useRef<{ pointer: number; x: number; y: number; origin: CanvasPoint; ready: boolean; cancelled: boolean; tolerance: number; timer: ReturnType<typeof setTimeout>; restore: () => void }>()
  const cancel = useCallback(() => {
    const current = gesture.current
    if (!current) return
    clearTimeout(current.timer)
    if (current.ready) current.restore()
    gesture.current = undefined
    setHolding(false)
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel() }
    }
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('keydown', escape, true); if (gesture.current) clearTimeout(gesture.current.timer); gesture.current = undefined }
  }, [contextKey, cancel])

  return <article tabIndex={0} onPointerDown={event => {
    if (event.button !== 0 || (event.target as Element).closest('button:not([data-keyboard-move]), input, textarea, select, a, summary, [role="button"], [role="combobox"], audio, video')) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: point, ready: false, cancelled: false,
      tolerance: event.pointerType === 'touch' ? 12 : 6, timer: setTimeout(() => {
        if (gesture.current === current && !current.cancelled) { current.ready = true; setHolding(true) }
      }, event.pointerType === 'touch' ? 350 : 200), restore: () => onMove(point) }
    gesture.current = current
  }} onPointerMove={event => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId || current.cancelled) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    if (!current.ready) {
      if (Math.hypot(dx, dy) > current.tolerance) { current.cancelled = true; clearTimeout(current.timer) }
      return
    }
    onMove({ x: current.origin.x + dx / scale, y: current.origin.y + dy / scale })
  }} onPointerUp={event => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    clearTimeout(current.timer); gesture.current = undefined; setHolding(false)
    event.stopPropagation()
    if (!current.cancelled) {
      if (event.shiftKey || event.ctrlKey || event.metaKey) onSelect(!selected)
      else onOpen(event.currentTarget)
    }
  }} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(event.currentTarget) }
    if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(false); event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus() }
  }} data-card-id={id} data-canvas-node={id} data-selected={selected} className={`generation-card${holding ? ' generation-card-holding' : ''}`} style={{ left: point.x, top: point.y, width, minHeight: height }}>
    <header><button type="button" data-keyboard-move aria-label={`移动布局：${name || title}`} title="长按卡片拖动，或用方向键移动" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        onMove({ x: point.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), y: point.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0) })
      }}>⠿</button>
      <strong title={name || title}>{name || title}</strong>{name && <small>{title}</small>}
      <WorkbenchIconButton label="卡片操作" icon={<MoreOutlined />} variant="quiet" aria-expanded={menu} onClick={() => setMenu(value => !value)} />
      {menu && <div className="generation-card-menu" onPointerDown={event => event.stopPropagation()}>
        <WorkbenchButton aria-pressed={selected} onClick={() => { onSelect(!selected); setMenu(false) }}>{selected ? '取消选择卡片' : '选择卡片'}</WorkbenchButton>
        <WorkbenchButton variant="danger" disabled={readonly || removeDisabled} onClick={() => { onRemove(); setMenu(false) }}>删除卡片</WorkbenchButton>
      </div>}
    </header>
    {connections}
    <CanvasCard className="generation-card-body" aria-label={`${name || title}详情`} >{children}{footer && <footer className="generation-card-footer">{footer}</footer>}</CanvasCard>
  </article>
}
