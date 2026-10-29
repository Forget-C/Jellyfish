import { useState } from 'react'
import type { ReactNode } from 'react'
import { CanvasCard, CanvasDragHandle } from '../../../components/canvas/Canvas'
import { MoreOutlined } from '@ant-design/icons'
import { WorkbenchButton, WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import type { CanvasPoint } from '../../../components/canvas/geometry'

/** 卡片仅管理阅读、布局和选择；编辑及采用仍由业务详情负责。 */
export function CardShell({ id, title, name, contextKey, point, scale, width, height, selected, readonly, removeDisabled, onSelect, onMove, onRemove, inputs, outputs, children, onOpen }:
  { id: string; title: string; name?: string; contextKey: string; point: CanvasPoint; scale: number; width: number; height?: number; selected: boolean; readonly?: boolean; removeDisabled?: boolean;
    onSelect: (selected: boolean) => void; onMove: (point: CanvasPoint) => void; onRemove: () => void;
    inputs: ReactNode; outputs: ReactNode; children: ReactNode; onOpen: (trigger: HTMLElement) => void }) {
  const [menu, setMenu] = useState(false)
  return <article tabIndex={0} onKeyDown={event => {
    if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onOpen(event.currentTarget) }
    if (event.key === 'Escape' && menu) { event.stopPropagation(); setMenu(false); event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded]')?.focus() }
  }} data-card-id={id} data-canvas-node={id} data-selected={selected} className="generation-card" style={{ left: point.x, top: point.y, width, height }}>
    <header><CanvasDragHandle contextKey={contextKey} label={name || title} offset={point} scale={scale} onMove={onMove} />
      <strong title={name || title}>{name || title}</strong>{name && <small>{title}</small>}
      <WorkbenchIconButton label="卡片操作" icon={<MoreOutlined />} variant="quiet" aria-expanded={menu} onClick={() => setMenu(value => !value)} />
      {menu && <div className="generation-card-menu" onPointerDown={event => event.stopPropagation()}>
        <WorkbenchButton aria-pressed={selected} onClick={() => { onSelect(!selected); setMenu(false) }}>{selected ? '取消选择卡片' : '选择卡片'}</WorkbenchButton>
        <WorkbenchButton variant="danger" disabled={readonly || removeDisabled} onClick={() => { onRemove(); setMenu(false) }}>删除卡片</WorkbenchButton>
      </div>}
    </header>
    <div className="generation-ports">{inputs}{outputs}</div>
    <CanvasCard className="generation-card-body" aria-label={`${name || title}详情`} onActivate={onOpen}>{children}</CanvasCard>
  </article>
}
