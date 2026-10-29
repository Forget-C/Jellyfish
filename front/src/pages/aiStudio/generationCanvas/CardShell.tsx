import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CanvasCard } from '../../../components/canvas/Canvas'
import { MoreOutlined, FileTextOutlined, PictureOutlined, VideoCameraOutlined, AudioOutlined, CameraOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import type { CanvasPoint } from '../../../components/canvas/geometry'

/** 卡片仅管理阅读、布局和选择；编辑及采用仍由业务详情负责。 */
export function CardShell({ id, title, name, type, contextKey, point, scale, width, height, selected, readonly, removeDisabled, onSelect, onMove, onRemove, connections, children, footer, onOpen, onExpand, onConnect, multiSelectMode, onStartMultiSelect, onDragStart }:
  { id: string; type?: string; title: string; name?: string; contextKey: string; point: CanvasPoint; scale: number; width: number; height?: number; selected: boolean; readonly?: boolean; removeDisabled?: boolean;
    multiSelectMode?: boolean; onStartMultiSelect: () => void; onDragStart: () => void; onConnect: (trigger: HTMLElement) => void; onSelect: (selected: boolean) => void; onMove: (point: CanvasPoint) => void; onRemove: () => void;
    connections: ReactNode; children: ReactNode; footer?: ReactNode; onExpand?: (trigger: HTMLElement) => void; onOpen: (trigger: HTMLElement, dragged?: boolean) => void }) {
  const [menu, setMenu] = useState(false)
  const [holding, setHolding] = useState(false)
  const gesture = useRef<{ pointer: number; x: number; y: number; origin: CanvasPoint; ready: boolean; tolerance: number; restore: () => void }>()
  const cancel = useCallback(() => {
    const current = gesture.current
    if (!current) return
    if (current.ready) current.restore()
    gesture.current = undefined
    setHolding(false)
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); cancel() }
    }
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('keydown', escape, true); gesture.current = undefined }
  }, [contextKey, cancel])

  return <article tabIndex={0} onPointerDown={event => {
    if (event.button !== 0 || (event.target as Element).closest('button:not([data-keyboard-move]), input, textarea, select, a, summary, [role="button"], [role="combobox"], audio, video')) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: point, ready: false,
      tolerance: event.pointerType === 'touch' ? 12 : 6, restore: () => onMove(point) }
    gesture.current = current
  }} onPointerMove={event => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    if (!current.ready) {
      if (Math.hypot(dx, dy) <= current.tolerance) return
      current.ready = true; onDragStart(); setHolding(true)
    }
    onMove({ x: current.origin.x + dx / scale, y: current.origin.y + dy / scale })
  }} onPointerUp={event => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    gesture.current = undefined; setHolding(false)
    event.stopPropagation()
    if (!current.ready && (multiSelectMode || (navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey))) onSelect(!selected)
    else onOpen(event.currentTarget, current.ready)
  }} onPointerCancel={cancel} onLostPointerCapture={cancel} onKeyDown={event => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); if (multiSelectMode) onSelect(!selected); else onOpen(event.currentTarget) }
    if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(false); event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus() }
  }} data-card-id={id} data-canvas-node={id} data-selected={selected} className={`generation-card${holding ? ' generation-card-holding' : ''}`} style={{ left: point.x, top: point.y, width, minHeight: height }}>
    <header><button type="button" data-keyboard-move aria-label={`移动布局：${name || title}`} title="拖动卡片，或用方向键移动" onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
        event.preventDefault(); event.stopPropagation()
        onMove({ x: point.x + (event.key === 'ArrowLeft' ? -20 : event.key === 'ArrowRight' ? 20 : 0), y: point.y + (event.key === 'ArrowUp' ? -20 : event.key === 'ArrowDown' ? 20 : 0) })
      }}>{type?.startsWith('direction.') ? <CameraOutlined /> : type?.endsWith('image') || type?.startsWith('reference.') ? <PictureOutlined /> : type?.endsWith('video') ? <VideoCameraOutlined /> : type?.endsWith('audio') ? <AudioOutlined /> : <FileTextOutlined />}</button>
      <strong title={name || title}>{name || title}</strong>{name && <small>{title}</small>}
      <WorkbenchIconButton label="卡片操作" icon={<MoreOutlined />} variant="quiet" aria-expanded={menu} onClick={() => setMenu(value => !value)} />
      {menu && <div className="generation-card-menu" onPointerDown={event => event.stopPropagation()}>
        <WorkbenchButton onClick={() => { onStartMultiSelect(); setMenu(false) }}>选择多个</WorkbenchButton>
        <WorkbenchButton aria-pressed={selected} onClick={() => { onSelect(!selected); setMenu(false) }}>{selected ? '取消选择卡片' : '选择卡片'}</WorkbenchButton>
        {onExpand && <WorkbenchButton onClick={event => { onExpand(event.currentTarget.closest('article')!); setMenu(false) }}>展开编辑</WorkbenchButton>}
        <WorkbenchButton disabled={readonly} onClick={event => { onConnect(event.currentTarget.closest('article')!); setMenu(false) }}>连接到…</WorkbenchButton>
        <WorkbenchButton variant="danger" disabled={readonly || removeDisabled} onClick={() => { onRemove(); setMenu(false) }}>删除卡片</WorkbenchButton>
      </div>}
    </header>
    {connections}
    <CanvasCard className="generation-card-body" aria-label={`${name || title}详情`} >{children}{footer && <footer className="generation-card-footer">{footer}</footer>}</CanvasCard>
  </article>
}
