import { Children, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Dropdown, Space, Tooltip } from 'antd'
import { AimOutlined, EnvironmentOutlined, MinusOutlined, PlusOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons'
import { CanvasDragHandle, CanvasEdge, useCanvasViewport } from '../../../components/canvas/Canvas'
import { canvasConnection } from '../../../components/canvas/geometry'
import type { CanvasPoint, CanvasTransform } from '../../../components/canvas/geometry'

type ViewState = { transform: CanvasTransform; positions: Record<string, CanvasPoint> }
const views = new Map<string, ViewState>()
const scrollPositions = new Map<string, Record<string, number>>()
const locatedRequests = new Map<string, number>()
const defaultLabels = ['原文依据', '全场共享', '镜头设计']
const toolDrag = 'application/x-jellyfish-director-tool'
export type DirectorCanvasObject = { id: string; label: string; content: ReactNode; onInspect?: (trigger: HTMLElement) => void }
export type DirectorCanvasRelation = { from: string; to: string; label: string; indirect?: boolean }

/** 画布只维护视口与节点位置；内容及排序始终由业务编辑入口维护。 */
export function DirectorCanvasSurface({ contextKey, children, objects = [], relations = [], inspectors = {}, tools = [], labels = defaultLabels, ariaLabel = '导演画布视口', initialPositions = {}, focusTarget }: { focusTarget?: { nodeId: string; fieldId: string; serial: number }; initialPositions?: Record<string, CanvasPoint>; labels?: string[]; ariaLabel?: string; tools?: { label: string; onClick: (trigger: HTMLElement) => void }[]; contextKey: string; children: ReactNode; objects?: DirectorCanvasObject[]; relations?: DirectorCanvasRelation[]; inspectors?: Record<string, ((trigger: HTMLElement) => void) | undefined> }) {
  const [view, setView] = useState<ViewState>(() => views.get(contextKey) || {
    transform: { x: 120, y: 30, scale: Math.max(.3, Math.min(1, (window.innerWidth - 180) / 1160)) }, positions: {},
  })
  const nodes: DirectorCanvasObject[] = [...Children.toArray(children).map((content, index) => ({ id: labels[index], label: labels[index], content, onInspect: inspectors[labels[index]] })), ...objects]
  const cards = useRef(new Map<string, HTMLDivElement>())
  useLayoutEffect(() => {
    const stored = scrollPositions.get(contextKey)
    if (!stored) return
    cards.current.forEach((card, id) => {
      const body = card.querySelector<HTMLElement>('.director-canvas-object-content')
      if (body && stored[id] != null && body.scrollHeight - body.clientHeight >= stored[id]) body.scrollTop = stored[id]
    })
  })
  const menuTrigger = useRef<HTMLElement>()
  useEffect(() => { views.set(contextKey, view) }, [contextKey, view])
  const viewport = useCanvasViewport(contextKey, view.transform, next => setView(previous => ({ ...previous,
    transform: typeof next === 'function' ? next(previous.transform) : next })), { x: 1120, y: 700 })
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  // 默认布局围绕当前镜头；测量摘要高度避免长内容重叠，手动位置始终优先。
  const height = (id: string) => sizes[id]?.height || 260
  const shotTop = height(labels[1]) + 72
  const defaults: Record<string, CanvasPoint> = {
    [labels[0]]: { x: 0, y: 0 }, [labels[1]]: { x: 400, y: 0 }, [labels[2]]: { x: 400, y: shotTop },
  }
  let leftTop = Math.max(shotTop, height(labels[0]) + 72), rightTop = shotTop
  objects.forEach(node => {
    const left = node.id.startsWith('participant:') || node.id.startsWith('location:')
    defaults[node.id] = { x: left ? 0 : 800, y: left ? leftTop : rightTop }
    if (left) leftTop += height(node.id) + 64
    else rightTop += height(node.id) + 64
  })
  const position = (id: string) => view.positions[id] || initialPositions[id] || defaults[id]
  useEffect(() => {
    const measure = () => {
      const next = Object.fromEntries([...cards.current].map(([id, element]) => [id, { width: element.offsetWidth, height: element.offsetHeight }]))
      setSizes(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
    }
    const observer = new ResizeObserver(measure)
    cards.current.forEach(element => observer.observe(element)); measure()
    return () => observer.disconnect()
  }, [nodes.map(node => node.id).join('|')])
  const box = (id: string) => {
    const index = nodes.findIndex(node => node.id === id)
    return index < 0 ? undefined : { ...position(id), width: sizes[id]?.width || 360, height: sizes[id]?.height || 200 }
  }
  const fit = () => {
    const surface = viewport.surface.current
    if (!surface) return
    const boxes = nodes.map((_, i) => {
      const point = position(nodes[i].id), card = cards.current.get(nodes[i].id)
      return { ...point, width: card?.offsetWidth || 360, height: card?.offsetHeight || 600 }
    })
    const left = Math.min(...boxes.map(box => box.x)), top = Math.min(...boxes.map(box => box.y))
    const width = Math.max(...boxes.map(box => box.x + box.width)) - left
    const height = Math.max(...boxes.map(box => box.y + box.height)) - top
    const scale = Math.max(.15, Math.min(1.2, (surface.clientWidth - 180) / width, (surface.clientHeight - 180) / height))
    setView(previous => ({ ...previous, transform: { scale, x: 120 - left * scale, y: 30 - top * scale } }))
  }
  const locate = (id: string) => {
    const point = position(id)
    // 明确定位保留其它节点位置；窄屏也能直接找回当前对象。
    const scale = Math.min(1, ((viewport.surface.current?.clientWidth || window.innerWidth) - 32) / 360)
    setView(previous => ({ ...previous, transform: { scale, x: 16 - point.x * scale, y: 20 - point.y * scale } }))
    requestAnimationFrame(() => cards.current.get(id)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }))
  }
  useEffect(() => {
    if (!focusTarget || locatedRequests.get(contextKey) === focusTarget.serial || !nodes.some(node => node.id === focusTarget.nodeId)) return
    locatedRequests.set(contextKey, focusTarget.serial)
    locate(focusTarget.nodeId)
    requestAnimationFrame(() => {
      const field = document.getElementById(focusTarget.fieldId)
      field?.focus({ preventScroll: true })
      const content = field?.closest<HTMLElement>('.director-canvas-object-content')
      if (!field || !content) return
      const bounds = content.getBoundingClientRect(), target = field.getBoundingClientRect()
      // 只滚动节点内部，避免浏览器为焦点移动整个画布；补偿画布缩放。
      const scale = bounds.width / content.offsetWidth
      if (target.top < bounds.top || target.bottom > bounds.bottom) content.scrollTop += (target.top - bounds.top) / scale - 16
    })
  }, [focusTarget?.serial])
  return <>
    <div className="director-canvas-surface" ref={viewport.surface} {...viewport.surfaceProps} aria-label={ariaLabel}
      onDragOver={event => { if (event.dataTransfer.types.includes(toolDrag)) event.preventDefault() }}
      onDrop={event => {
        const tool = tools.find(item => item.label === event.dataTransfer.getData(toolDrag))
        if (!tool) return
        event.preventDefault()
        const trigger = document.querySelector<HTMLElement>(`[data-director-tool="${tool.label}"]`)
        if (trigger) tool.onClick(trigger)
      }}>
      <div className="director-canvas-content" style={{ transform: `translate(${view.transform.x}px, ${view.transform.y}px) scale(${view.transform.scale})` }}>
        <svg className="director-canvas-relations" aria-label="当前镜头关系">
          {relations.map((relation, index) => {
            const from = box(relation.from), to = box(relation.to)
            if (!from || !to) return null
            let line = canvasConnection({ left: from.x, top: from.y, width: from.width, height: from.height }, { left: to.x, top: to.y, width: to.width, height: to.height })
            if (Math.abs(from.x - to.x) < 100 && from.y + from.height < to.y) {
              const start = { x: from.x + from.width / 2, y: from.y + from.height }
              const end = { x: to.x + to.width / 2, y: to.y + 32 }
              const middle = (start.y + end.y) / 2
              line = { start, end, d: `M${start.x},${start.y} C${start.x},${middle} ${end.x},${middle} ${end.x},${end.y}`, x: (start.x + end.x) / 2, y: middle - 8 }
            }
            return <g key={`${relation.from}:${relation.to}:${index}`}>
              <CanvasEdge d={line.d} label={relation.label} indirect={relation.indirect} caption={{ x: line.x, y: line.y, text: relation.label }} />
              <circle cx={line.start.x} cy={line.start.y} r={4} className="director-relation-port" />
              <circle cx={line.end.x} cy={line.end.y} r={4} className="director-relation-port" />
            </g>
          })}
        </svg>
        {nodes.map(node => {
          const { id, label } = node, point = position(id)
          const menu = { items: [{ key: 'inspect', label: '查看或编辑', disabled: !node.onInspect, onClick: () => {
            const trigger = menuTrigger.current || cards.current.get(id)
            if (trigger) node.onInspect?.(trigger)
          } }] }
          return <Dropdown key={id} menu={menu} trigger={['contextMenu']}><div data-canvas-node={id} className="director-canvas-object" tabIndex={-1}
            onContextMenu={event => { menuTrigger.current = event.currentTarget }} ref={element => {
            if (element) cards.current.set(id, element); else cards.current.delete(id)
          }} style={{ left: point.x, top: point.y }}>
            <div className="director-canvas-title"><CanvasDragHandle contextKey={contextKey} label={label} offset={point}
              scale={view.transform.scale} onMove={next => setView(previous => ({ ...previous, positions: { ...previous.positions, [id]: next } }))} />
              <h2>{label}</h2><Dropdown menu={menu} trigger={['click']}>
                <Button className="director-node-menu" aria-label={`更多操作：${label}`} disabled={!node.onInspect}
                  onClick={event => { menuTrigger.current = event.currentTarget }}>⋯</Button>
              </Dropdown></div>
            <div className="director-canvas-object-content" onScroll={event => {
              scrollPositions.set(contextKey, { ...scrollPositions.get(contextKey), [id]: event.currentTarget.scrollTop })
            }}>
              <button type="button" className="director-node-open" aria-label={`查看节点：${label}`} disabled={!node.onInspect}
                onClick={event => node.onInspect?.(event.currentTarget)} />
              <div className="director-node-summary">{node.content}</div>
            </div>
          </div></Dropdown>
        })}
      </div>
    </div>
    <nav className="director-canvas-tools" aria-label="导演画布工具">{tools.map(tool => <Tooltip key={tool.label} title={tool.label} placement="right"><Button type="text" aria-label={tool.label} icon={tool.label === '角色工具' ? <UserOutlined /> : tool.label === '场所工具' ? <EnvironmentOutlined /> : <ToolOutlined />} key={tool.label} data-director-tool={tool.label} draggable onDragStart={event => { event.dataTransfer.setData(toolDrag, tool.label); event.dataTransfer.effectAllowed = 'link' }} onClick={event => tool.onClick(event.currentTarget)} /></Tooltip>)}</nav>
    <div className="director-canvas-bottom">
      <Dropdown trigger={['click']} menu={{ items: nodes.slice(0, labels.length).map(node => ({ key: node.id, label: node.label, onClick: () => locate(node.id) })) }}>
        <Button type="text" aria-label="定位画布节点" title="定位画布节点" icon={<AimOutlined />} />
      </Dropdown>
    <Space className="director-canvas-controls" aria-label="画布视口控制">
      <Button type="text" title="缩小画布" icon={<MinusOutlined />} aria-label="缩小画布" onClick={() => viewport.zoom(-.1)} />
      <span>{Math.round(view.transform.scale * 100)}%</span>
      <Button type="text" title="放大画布" icon={<PlusOutlined />} aria-label="放大画布" onClick={() => viewport.zoom(.1)} />
      <Button type="text" onClick={fit}>适应画布</Button>
    </Space>
    </div>
  </>
}
