import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { CanvasCard } from '../../../components/canvas/Canvas'
import { MoreOutlined, FileTextOutlined, PictureOutlined, VideoCameraOutlined, AudioOutlined, CameraOutlined, CheckSquareOutlined, CommentOutlined, LockOutlined, ProfileOutlined, ThunderboltOutlined, ControlOutlined, CompassOutlined, ReadOutlined, FlagOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import type { CanvasPoint } from '../../../components/canvas/geometry'

const designIcons = {
  'direction.criterion': CheckSquareOutlined,
  'direction.fact': LockOutlined,
  'direction.dialogue': CommentOutlined,
  'direction.event': ThunderboltOutlined,
  'direction.performance_rule': ProfileOutlined,
  'direction.creative_control': ControlOutlined,
  'direction.guidance': CompassOutlined,
  'direction.narrative': ReadOutlined,
  'direction.beat': FlagOutlined,
  'direction.shot': VideoCameraOutlined,
}

/** 卡片仅管理阅读、布局和选择；编辑及采用仍由业务详情负责。 */
export function CardShell({ id, title, name, label, type, contextKey, point, scale, width, height, selected, filterMatch, readonly, removeDisabled, onSelect, onMove, onRemove, connections, children, footer, issueIndicator, onOpen, onExpand, onConnect, multiSelectMode, onStartMultiSelect, onDragStart, onDragEnd, viewportOffset, menu, onMenuChange: setMenu, onContextActions }:
  { id: string; type?: string; title: string; name?: string; label?: string; contextKey: string; point: CanvasPoint; scale: number; width: number; height: number; selected: boolean; filterMatch?: boolean; readonly?: boolean; removeDisabled?: boolean;
    onContextActions?: (trigger: HTMLElement) => void; menu: boolean; onMenuChange?: (open: boolean) => void; viewportOffset?: CanvasPoint; multiSelectMode?: boolean; onStartMultiSelect?: () => void; onDragStart: () => void; onDragEnd?: (cancelled?: boolean) => void; onConnect?: (trigger: HTMLElement) => void; onSelect: (selected: boolean) => void; onMove: (point: CanvasPoint) => void; onRemove?: () => void;
    connections: ReactNode; children: ReactNode; footer?: ReactNode; issueIndicator?: ReactNode; onExpand?: (trigger: HTMLElement) => void; onOpen: (trigger: HTMLElement) => void }) {
  const [holding, setHolding] = useState(false)
  const gesture = useRef<{ pointer: number; x: number; y: number; origin: CanvasPoint; viewport?: CanvasPoint; ready: boolean; tolerance: number; restore: () => void }>()
  const menuChange = useRef(setMenu); menuChange.current = setMenu
  const end = useRef(onDragEnd); end.current = onDragEnd
  const cancel = useCallback(() => {
    const current = gesture.current
    if (!current) return
    if (current.ready) { current.restore(); end.current?.(true) }
    gesture.current = undefined
    setHolding(false)
  }, [])
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (!event.isComposing && event.key === 'Escape' && gesture.current) { event.preventDefault(); event.stopPropagation(); menuChange.current?.(false); cancel() }
    }
    const blur = () => { if (gesture.current?.ready) end.current?.(); gesture.current = undefined; setHolding(false) }
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', escape, true)
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('keydown', escape, true); gesture.current = undefined }
  }, [contextKey, cancel])

  const DesignIcon = designIcons[type as keyof typeof designIcons] || CameraOutlined
  return <article tabIndex={0} onPointerDown={event => {
    if (event.button !== 0 || (event.target as Element).closest('button:not([data-keyboard-move]), input, textarea, select, a, summary, [role="button"], [role="combobox"], audio, video')) return
    event.preventDefault(); event.stopPropagation()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    const current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, origin: point, viewport: viewportOffset, ready: false,
      tolerance: event.pointerType === 'touch' ? 12 : 6, restore: () => onMove(point) }
    gesture.current = current
  }} onPointerMove={event => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    const dx = event.clientX - current.x, dy = event.clientY - current.y
    if (!current.ready) {
      if (Math.hypot(dx, dy) <= current.tolerance) return
      current.ready = true; setMenu?.(false); onDragStart(); setHolding(true)
    }
    onMove({ x: current.origin.x + (dx - ((viewportOffset?.x || 0) - (current.viewport?.x || 0))) / scale, y: current.origin.y + (dy - ((viewportOffset?.y || 0) - (current.viewport?.y || 0))) / scale })
  }} onPointerUp={event => {
    const current = gesture.current
    if (!current || current.pointer !== event.pointerId) return
    gesture.current = undefined; setHolding(false)
    event.stopPropagation()
    if (!current.ready && (multiSelectMode || (navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey))) onSelect(!selected)
    else if (!current.ready) onOpen(event.currentTarget)
    if (current.ready) onDragEnd?.()
  }} onPointerCancel={() => { if (gesture.current?.ready) onDragEnd?.(); gesture.current = undefined; setHolding(false) }} onLostPointerCapture={() => { if (gesture.current?.ready) onDragEnd?.(); gesture.current = undefined; setHolding(false) }} onKeyDown={event => {
    if (!event.defaultPrevented && !event.nativeEvent.isComposing && !gesture.current?.ready && event.target === event.currentTarget && event.key === 'Enter') { event.preventDefault(); if (multiSelectMode) onSelect(!selected); else onOpen(event.currentTarget) }
    if (!event.nativeEvent.isComposing && event.key === 'Escape' && menu) { event.preventDefault(); event.stopPropagation(); setMenu?.(false); event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus() }
  }} aria-label={label} data-card-id={id} data-card-type={type} data-canvas-node={id} data-selected={selected} data-filter-match={filterMatch} aria-description={filterMatch ? '符合筛选' : undefined} className={`generation-card${holding ? ' generation-card-holding' : ''}`} style={{ left: point.x, top: point.y, width, height }}>
    <header><button type="button" data-keyboard-move aria-label={`移动布局：${name || title}`} title="拖动卡片，或用方向键移动">{type?.startsWith('direction.') ? <DesignIcon /> : type?.endsWith('image') || type?.startsWith('reference.') ? <PictureOutlined /> : type?.endsWith('video') ? <VideoCameraOutlined /> : type?.endsWith('audio') ? <AudioOutlined /> : <FileTextOutlined />}</button>
      <strong title={name || title}>{name || title}</strong>{name && <small>{title}</small>}
      {issueIndicator}
      {setMenu && <WorkbenchIconButton label="卡片操作" icon={<MoreOutlined />} variant="quiet" aria-expanded={menu} onClick={() => setMenu(!menu)} />}
      {menu && <div className="generation-card-menu" onPointerDown={event => event.stopPropagation()}>
        {onContextActions && <WorkbenchButton onClick={event=>onContextActions(event.currentTarget)}>复制、封面与下载…</WorkbenchButton>}
        {onStartMultiSelect && <WorkbenchButton onClick={() => { onStartMultiSelect(); setMenu?.(false) }}>选择多个</WorkbenchButton>}
        <WorkbenchButton aria-pressed={selected} onClick={() => { onSelect(!selected); setMenu?.(false) }}>{selected ? '取消选择卡片' : '选择卡片'}</WorkbenchButton>
        {onExpand && <WorkbenchButton onClick={event => { onExpand(event.currentTarget.closest('article')!); setMenu?.(false) }}>展开编辑</WorkbenchButton>}
        {onConnect && <WorkbenchButton disabled={readonly} onClick={event => { onConnect(event.currentTarget.closest('article')!); setMenu?.(false) }}>连接到…</WorkbenchButton>}
        {onRemove && <WorkbenchButton variant="danger" disabled={readonly || removeDisabled} onClick={() => { onRemove(); setMenu?.(false) }}>删除卡片</WorkbenchButton>}
      </div>}
    </header>
    {connections}
    <CanvasCard className="generation-card-body" aria-label={`${name || title}详情`} >{children}{footer && <footer className="generation-card-footer">{footer}</footer>}</CanvasCard>
  </article>
}
