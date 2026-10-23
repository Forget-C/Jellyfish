import type { ReactNode } from 'react'
import { Button, Checkbox, ConfigProvider } from 'antd'
import { CanvasDragHandle } from '../../../components/canvas/Canvas'
import type { CanvasPoint } from '../../../components/canvas/geometry'

/** 通用卡壳只表达几何、标题、选择、端口和内容；不持有业务文档。 */
export function CardShell({ id, title, contextKey, point, scale, width, height, selected, readonly, removeDisabled, onSelect, onMove, onResize, onRemove, inputs, outputs, children }:
  { id: string; title: string; contextKey: string; point: CanvasPoint; scale: number; width: number; height?: number; selected: boolean; readonly?: boolean; removeDisabled?: boolean;
    onSelect: (selected: boolean) => void; onMove: (point: CanvasPoint) => void; onResize: (width: number, height: number) => void; onRemove: () => void;
    inputs: ReactNode; outputs: ReactNode; children: ReactNode }) {
  return <article data-card-id={id} data-canvas-node={id} className="generation-card" style={{ left: point.x, top: point.y, width, height }}
    onPointerUp={event => { const box = event.currentTarget.getBoundingClientRect(); onResize(box.width / scale, box.height / scale) }}>
    <header><CanvasDragHandle contextKey={contextKey} label={title} offset={point} scale={scale} onMove={onMove} />
      <Checkbox aria-label={`选择卡片 ${id}`} checked={selected} onChange={event => onSelect(event.target.checked)} />
      <strong>{title}</strong><Button danger size="small" disabled={readonly || removeDisabled} onClick={onRemove}>删除卡片</Button>
    </header>
    <div className="generation-ports">{inputs}{outputs}</div>
    <ConfigProvider componentDisabled={readonly}><fieldset disabled={readonly} className="generation-card-body">{children}</fieldset></ConfigProvider>
  </article>
}
