import { Children, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Dropdown, Space, Tooltip } from 'antd'
import { AimOutlined, EnvironmentOutlined, MinusOutlined, PlusOutlined, ToolOutlined, UserOutlined } from '@ant-design/icons'
import { CanvasDragHandle, CanvasEdge, useCanvasViewport } from '../../../components/canvas/Canvas'
import { canvasConnection } from '../../../components/canvas/geometry'
import type { CanvasPoint, CanvasTransform } from '../../../components/canvas/geometry'
import { directorGroup, directorGroups, fixedDirectorSize } from './directorLayout'
import { directorRelationCategory } from './directorRelations'
import { useDirectorLayout } from './useDirectorLayout'
import type { DirectorLayoutScope } from './useDirectorLayout'
import { WorkbenchButton } from './ui/WorkbenchButton'

type ViewState = { transform: CanvasTransform; positions: Record<string, CanvasPoint> }
const views = new Map<string, ViewState>()
const scrollPositions = new Map<string, Record<string, number>>()
const locatedRequests = new Map<string, number>()
const defaultLabels = ['原文依据', '全场共享', '镜头设计']
const toolDrag = 'application/x-jellyfish-director-tool'
export type DirectorCanvasObject = { id: string; label: string; title?: string; content: ReactNode; onInspect?: (trigger: HTMLElement) => void }
export type DirectorCanvasRelation = { from: string; to: string; label: string; indirect?: boolean }

/** 画布只维护视口与节点位置；内容及排序始终由业务编辑入口维护。 */
export function DirectorCanvasSurface({ contextKey, children, objects = [], relations = [], inspectors = {}, tools = [], toolbar, anchorTitle, labels = defaultLabels, ariaLabel = '导演画布视口', initialPositions = {}, focusTarget, layoutScope }: { layoutScope?: DirectorLayoutScope; focusTarget?: { nodeId: string; fieldId: string; serial: number }; initialPositions?: Record<string, CanvasPoint>; labels?: string[]; ariaLabel?: string; tools?: { label: string; onClick: (trigger: HTMLElement) => void }[]; toolbar?: ReactNode; anchorTitle?: string; contextKey: string; children: ReactNode; objects?: DirectorCanvasObject[]; relations?: DirectorCanvasRelation[]; inspectors?: Record<string, ((trigger: HTMLElement) => void) | undefined> }) {
  const [classicView, setClassicView] = useState<ViewState>(() => views.get(contextKey) || {
    transform: { x: 120, y: 30, scale: Math.max(.3, Math.min(1, (window.innerWidth - 180) / 1160)) }, positions: {},
  })
  const nodes: DirectorCanvasObject[] = [...Children.toArray(children).map((content, index) => ({ id: layoutScope && index === 2 && layoutScope.anchorId !== '全场共享' ? layoutScope.anchorId : labels[index], label: labels[index], title: index === 2 ? anchorTitle : undefined, content, onInspect: inspectors[labels[index]] })), ...objects]
  const [sizes, setSizes] = useState<Record<string, { width: number; height: number }>>({})
  const [surfaceWidth, setSurfaceWidth] = useState(window.innerWidth)
  const [surfaceHeight, setSurfaceHeight] = useState(window.innerHeight)
  const [minimapOpen, setMinimapOpen] = useState(() => window.innerWidth > 700)
  const [legendOpen, setLegendOpen] = useState(() => window.innerWidth > 700)
  const wasNarrow = useRef(window.innerWidth <= 700)
  const minimapDrag = useRef<{ x: number; y: number }>()
  const layout = useDirectorLayout(layoutScope, nodes, sizes, surfaceWidth)
  const view = layoutScope ? layout.view : classicView
  const setView = (update: (previous: ViewState) => ViewState) => layoutScope ? layout.setView(previous => ({ ...previous, ...update(previous) })) : setClassicView(update)
  const viewKey = layoutScope ? `${contextKey}:${layoutScope.viewId}` : contextKey
  const [hovered, setHovered] = useState<string>()
  const [focused, setFocused] = useState<string>()
  const [edgeFocus, setEdgeFocus] = useState<number>()
  const [edgeHover, setEdgeHover] = useState<number>()
  const cards = useRef(new Map<string, HTMLDivElement>())
  useLayoutEffect(() => {
    const stored = scrollPositions.get(viewKey)
    if (!stored) return
    cards.current.forEach((card, id) => {
      const body = card.querySelector<HTMLElement>('.director-canvas-object-content')
      if (body && stored[id] != null && body.scrollHeight - body.clientHeight >= stored[id]) body.scrollTop = stored[id]
    })
  })
  const menuTrigger = useRef<HTMLElement>()
  useEffect(() => { if (!layoutScope) views.set(contextKey, view) }, [contextKey, view, layoutScope])
  const viewport = useCanvasViewport(viewKey, view.transform, next => setView(previous => ({ ...previous,
    transform: typeof next === 'function' ? next(previous.transform) : next })), { x: 1120, y: 700 })
  useEffect(() => {
    const surface = viewport.surface.current
    if (!surface) return
    const observer = new ResizeObserver(() => { setSurfaceWidth(surface.clientWidth); setSurfaceHeight(surface.clientHeight) })
    observer.observe(surface); setSurfaceWidth(surface.clientWidth); setSurfaceHeight(surface.clientHeight)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const narrow = surfaceWidth <= 700
    if (narrow !== wasNarrow.current) { wasNarrow.current = narrow; setMinimapOpen(!narrow); setLegendOpen(!narrow) }
  }, [surfaceWidth])
  // 默认布局围绕当前镜头；测量摘要高度避免长内容重叠，手动位置始终优先。
  const height = (id: string) => sizes[id]?.height || 260
  const shotTop = height(labels[1]) + 72
  const defaults: Record<string, CanvasPoint> = {
    [labels[0]]: { x: 0, y: 0 }, [labels[1]]: { x: 400, y: 0 }, [labels[2]]: { x: 400, y: shotTop },
  }
  let leftTop = Math.max(shotTop, height(labels[0]) + 72), rightTop = shotTop
  objects.forEach(node => {
    const left = /^(participant|location|performance|situation|activity|dialogue):/.test(node.id)
    defaults[node.id] = { x: left ? 0 : 800, y: left ? leftTop : rightTop }
    if (left) leftTop += height(node.id) + 64
    else rightTop += height(node.id) + 64
  })
  const position = (id: string) => view.positions[id] || initialPositions[id] || defaults[id] || { x: 0, y: 0 }
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
  const groupRegions = layoutScope ? Object.entries(directorGroups).flatMap(([group, label]) => {
    const members = objects.filter(node => directorGroup(node.id) === group)
    const boxes = members.map(node => box(node.id)!).filter(Boolean)
    if (!boxes.length) return []
    const x = Math.min(...boxes.map(item => item.x)), y = Math.min(...boxes.map(item => item.y))
    return [{ group, label, count: members.length, first: members[0].id, x, y: y - 40,
      width: Math.max(...boxes.map(item => item.x + item.width)) - x, height: Math.max(...boxes.map(item => item.y + item.height)) - y }]
  }) : []
  const activeNode = focused || hovered
  const activeRelation = edgeHover ?? edgeFocus
  const mapBoxes = nodes.map(node => box(node.id)!).filter(Boolean)
  const mapLeft = Math.min(...mapBoxes.map(item => item.x)), mapTop = Math.min(...mapBoxes.map(item => item.y))
  const mapWidth = Math.max(1, Math.max(...mapBoxes.map(item => item.x + item.width)) - mapLeft)
  const mapHeight = Math.max(1, Math.max(...mapBoxes.map(item => item.y + item.height)) - mapTop)
  const mapScale = Math.min(180 / mapWidth, 112 / mapHeight)
  const mapX = (x: number) => 10 + (x - mapLeft) * mapScale
  const mapY = (y: number) => 10 + (y - mapTop) * mapScale
  const visibleWorld = { x: -view.transform.x / view.transform.scale, y: -view.transform.y / view.transform.scale,
    width: surfaceWidth / view.transform.scale, height: surfaceHeight / view.transform.scale }
  const panMap = (worldX: number, worldY: number, offset: { x: number; y: number }) => setView(previous => ({ ...previous,
    transform: { ...previous.transform, x: -(worldX - offset.x) * previous.transform.scale, y: -(worldY - offset.y) * previous.transform.scale } }))
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
  const targetId = (id: string) => layoutScope && id === '镜头设计' && !nodes.some(node => node.id === id) ? layoutScope.anchorId : id
  const locate = (requestedId: string) => {
    const id = targetId(requestedId)
    const point = position(id)
    // 明确定位保留其它节点位置；窄屏也能直接找回当前对象。
    const scale = Math.min(1, ((viewport.surface.current?.clientWidth || window.innerWidth) - 32) / 360)
    setView(previous => ({ ...previous, transform: { scale, x: 16 - point.x * scale, y: (layoutScope ? 56 : 20) - point.y * scale } }))
    requestAnimationFrame(() => cards.current.get(id)?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true }))
  }
  useEffect(() => {
    if (!focusTarget || layoutScope && !layout.ready || locatedRequests.get(contextKey) === focusTarget.serial || !nodes.some(node => node.id === targetId(focusTarget.nodeId))) return
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
  }, [focusTarget?.serial, viewKey, layout.ready])
  return <>
    <div className={`director-canvas-surface${layoutScope ? ' director-layout-surface' : ''}`} data-layout-view={layoutScope?.viewId} ref={viewport.surface} {...viewport.surfaceProps} aria-label={ariaLabel}
      onDragOver={event => { if (event.dataTransfer.types.includes(toolDrag)) event.preventDefault() }}
      onDrop={event => {
        const tool = tools.find(item => item.label === event.dataTransfer.getData(toolDrag))
        if (!tool) return
        event.preventDefault()
        const trigger = document.querySelector<HTMLElement>(`[data-director-tool="${tool.label}"]`)
        if (trigger) tool.onClick(trigger)
      }}>
      <div className="director-canvas-content" style={{ visibility: layoutScope && !layout.ready ? 'hidden' : undefined, transform: `translate(${view.transform.x}px, ${view.transform.y}px) scale(${view.transform.scale})` }}>
        {groupRegions.map(group => <div key={group.group} className="director-layout-region" style={{ left: group.x - 12, top: group.y + 28, width: group.width + 24, height: group.height + 24 }} />)}
        {groupRegions.map(group => <div key={group.group} className="director-layout-group" data-layout-group={group.group} style={{ left: group.x, top: group.y }}>{group.label} · {group.count}</div>)}
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
            const active = activeRelation !== undefined ? activeRelation === index : !!activeNode && (relation.from === activeNode || relation.to === activeNode)
            const category = directorRelationCategory(relation.label)
            const caption = !layoutScope || active ? { x: line.x, y: line.y, text: relation.label } : undefined
            return <g key={`${relation.from}:${relation.to}:${index}`} data-relation-from={relation.from} data-relation-to={relation.to} data-relation-category={category}
              onMouseEnter={() => setEdgeHover(index)} onMouseLeave={() => setEdgeHover(undefined)} onFocus={() => { setEdgeFocus(index); setEdgeHover(undefined) }} onBlur={() => setEdgeFocus(undefined)}>
              <title>{relation.label}{relation.indirect ? ' · 间接' : ''}</title>
              <CanvasEdge d={line.d} label={`查看关系：${relation.label}${relation.indirect ? '，间接展示' : '，直接展示'}`} onInspect={() => setEdgeFocus(index)} indirect={relation.indirect} selected={!!layoutScope && active} muted={!!layoutScope && !active} caption={caption} />
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
          const highlighted = layoutScope && (activeRelation !== undefined && [relations[activeRelation]?.from, relations[activeRelation]?.to].includes(id) || !!activeNode && (id === activeNode || relations.some(relation => relation.from === activeNode && relation.to === id || relation.to === activeNode && relation.from === id)))
          return <Dropdown key={id} menu={menu} trigger={['contextMenu']}><div data-canvas-node={id} className={`director-canvas-object${layoutScope && fixedDirectorSize(id) ? ' director-compact-card' : ''}${highlighted ? ' director-relation-endpoint' : ''}`} tabIndex={-1}
            onMouseEnter={event => { if (layoutScope && event.currentTarget.contains(event.target as Node)) setHovered(id) }} onMouseLeave={event => { if (layoutScope && event.currentTarget.contains(event.target as Node)) setHovered(undefined) }}
            onMouseMove={event => { if (layoutScope && event.currentTarget.contains(event.target as Node) && (event.movementX || event.movementY)) { setHovered(id); setFocused(undefined); setEdgeFocus(undefined); setEdgeHover(undefined) } }}
            onKeyDownCapture={event => { if (layoutScope && event.currentTarget.contains(event.target as Node)) { setFocused(id); setEdgeFocus(undefined); setEdgeHover(undefined) } }}
            onFocus={event => { if (layoutScope && event.currentTarget.contains(event.target as Node)) { setFocused(id); setHovered(undefined); setEdgeFocus(undefined); setEdgeHover(undefined) } }} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(undefined) }}
            onContextMenu={event => { menuTrigger.current = event.currentTarget }} ref={element => {
            if (element) cards.current.set(id, element); else cards.current.delete(id)
          }} style={{ left: point.x, top: point.y, height: layoutScope ? fixedDirectorSize(id)?.height : undefined }}>
            <div className="director-canvas-title"><CanvasDragHandle contextKey={viewKey} label={label} offset={point}
              scale={view.transform.scale} onMove={next => setView(previous => ({ ...previous, positions: { ...previous.positions, [id]: next } }))} />
              <h2>{layoutScope && id === '全场共享' ? '全场概览' : node.title || label}</h2><Dropdown menu={menu} trigger={['click']}>
                <Button className="director-node-menu" aria-label={`更多操作：${label}`} disabled={!node.onInspect}
                  onClick={event => { menuTrigger.current = event.currentTarget }}>⋯</Button>
              </Dropdown></div>
            <div className="director-canvas-object-content" style={layoutScope && layout.view.sizes[id] ? { height: layout.view.sizes[id].height - 32 } : undefined} onScroll={event => {
              scrollPositions.set(viewKey, { ...scrollPositions.get(viewKey), [id]: event.currentTarget.scrollTop })
            }}>
              <button type="button" className="director-node-open" aria-label={`查看节点：${label}`} disabled={!node.onInspect}
                onClick={event => node.onInspect?.(event.currentTarget)} />
              <div className="director-node-summary">{node.content}</div>
            </div>
          </div></Dropdown>
        })}
      </div>
    </div>
    {toolbar && <nav className="director-canvas-toolbar" aria-label="导演画布选择">{toolbar}</nav>}
    {layoutScope && <WorkbenchButton className={`director-relation-legend-toggle${minimapOpen ? ' director-legend-toggle-above-map' : ''}`} variant="quiet" aria-label={legendOpen ? '收起关系图例' : '展开关系图例'} aria-expanded={legendOpen} onClick={() => setLegendOpen(value => !value)}>关系图例</WorkbenchButton>}
    {layoutScope && legendOpen && <div className={`director-relation-legend${minimapOpen ? ' director-legend-above-map' : ''}`} aria-label="导演画布关系图例">
      <span data-category="design">设计关联</span><span data-category="evidence">对象与依据</span>
      <span data-category="criterion">验收要求</span><span data-category="constraint">全场约束</span>
      <small>实线直接 · 虚线间接</small>
    </div>}
    {layoutScope && <div className="director-minimap">
      <WorkbenchButton variant="quiet" aria-label={minimapOpen ? '收起小地图' : '展开小地图'} aria-expanded={minimapOpen} onClick={() => setMinimapOpen(value => !value)}>小地图</WorkbenchButton>
      {minimapOpen && <svg width="200" height="132" viewBox="0 0 200 132" aria-label="小地图导航" onPointerDown={event => {
        const bounds = event.currentTarget.getBoundingClientRect()
        const worldX = mapLeft + (event.clientX - bounds.left - 10) / mapScale
        const worldY = mapTop + (event.clientY - bounds.top - 10) / mapScale
        const inside = worldX >= visibleWorld.x && worldX <= visibleWorld.x + visibleWorld.width && worldY >= visibleWorld.y && worldY <= visibleWorld.y + visibleWorld.height
        minimapDrag.current = inside ? { x: worldX - visibleWorld.x, y: worldY - visibleWorld.y } : { x: visibleWorld.width / 2, y: visibleWorld.height / 2 }
        event.currentTarget.setPointerCapture(event.pointerId)
        if (!inside) panMap(worldX, worldY, minimapDrag.current)
      }} onPointerMove={event => {
        if (!minimapDrag.current) return
        const bounds = event.currentTarget.getBoundingClientRect()
        panMap(mapLeft + (event.clientX - bounds.left - 10) / mapScale, mapTop + (event.clientY - bounds.top - 10) / mapScale, minimapDrag.current)
      }} onPointerUp={() => { minimapDrag.current = undefined }} onPointerCancel={() => { minimapDrag.current = undefined }}>
        {groupRegions.map(group => {
          const members = objects.filter(node => directorGroup(node.id) === group.group).map(node => box(node.id)!).filter(Boolean)
          const left = Math.min(...members.map(item => item.x)), top = Math.min(...members.map(item => item.y))
          return <rect key={group.group} data-minimap-group={group.group} x={mapX(left) - 2} y={mapY(top) - 2}
            width={(Math.max(...members.map(item => item.x + item.width)) - left) * mapScale + 4} height={(Math.max(...members.map(item => item.y + item.height)) - top) * mapScale + 4} />
        })}
        {mapBoxes.map((item, index) => <rect key={nodes[index]?.id || index} data-minimap-node={nodes[index]?.id} x={mapX(item.x)} y={mapY(item.y)} width={item.width * mapScale} height={item.height * mapScale} />)}
        <rect className="director-minimap-viewport" data-minimap-viewport x={mapX(visibleWorld.x)} y={mapY(visibleWorld.y)} width={visibleWorld.width * mapScale} height={visibleWorld.height * mapScale} />
      </svg>}
    </div>}
    <nav className="director-canvas-tools" aria-label="导演画布工具">{tools.map(tool => <Tooltip key={tool.label} title={tool.label} placement="right"><Button type="text" aria-label={tool.label} icon={tool.label === '角色工具' ? <UserOutlined /> : tool.label === '场所工具' ? <EnvironmentOutlined /> : <ToolOutlined />} key={tool.label} data-director-tool={tool.label} draggable onDragStart={event => { event.dataTransfer.setData(toolDrag, tool.label); event.dataTransfer.effectAllowed = 'link' }} onClick={event => tool.onClick(event.currentTarget)} /></Tooltip>)}</nav>
    <div className="director-canvas-bottom">
      <Dropdown trigger={['click']} menu={{ style: { maxHeight: '60dvh', overflowY: 'auto', maxWidth: 'calc(100vw - 32px)' }, items: [...groupRegions.map(group => ({ key: `group:${group.group}`, label: `${group.label}分区 · ${group.count}`, onClick: () => locate(group.first) })), ...nodes.map(node => ({ key: node.id, label: node.label, onClick: () => locate(node.id) }))] }}>
        <Button type="text" aria-label="定位画布节点" title="定位画布节点" icon={<AimOutlined />} />
      </Dropdown>
    <Space className="director-canvas-controls" aria-label="画布视口控制">
      <Button type="text" title="缩小画布" icon={<MinusOutlined />} aria-label="缩小画布" onClick={() => viewport.zoom(-.1)} />
      <span>{Math.round(view.transform.scale * 100)}%</span>
      <Button type="text" title="放大画布" icon={<PlusOutlined />} aria-label="放大画布" onClick={() => viewport.zoom(.1)} />
      <Button type="text" onClick={fit}>{layoutScope ? '适应全部' : '适应画布'}</Button>
      {layoutScope && <Dropdown trigger={['click']} menu={{ items: [
        { key: 'arrange', label: '重新整理布局', onClick: layout.rearrange },
        { key: 'undo', label: '撤销本次整理', disabled: !layout.canUndo, onClick: layout.undo },
      ] }}><WorkbenchButton variant="quiet">布局</WorkbenchButton></Dropdown>}
    </Space>
    </div>
  </>
}
