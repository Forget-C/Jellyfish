import { guidanceSummary, type GuidanceCard } from './GuidanceDirectionEditor'
import { constraintSummary, type ConstraintCard } from './ConstraintDirectionEditor'
import type { VisualStyleCard } from '../../../services/generated'
import { narrativeSummary, type NarrativeCard } from './NarrativeDirectionEditor'
import { photographySummary } from './PhotographyEditor'
import type { PhotographyCard } from '../../../services/generated'
import { spatialSummary, type SpatialCard } from './SpatialDirectionEditor'
import { soundSummary } from './SoundDirectionEditor'
import type { SoundCard } from './SoundDirectionEditor'
import { performanceSummary } from './PerformanceDirectionEditor'
import type { PerformanceCard } from './PerformanceDirectionEditor'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import { Alert, ConfigProvider, Input, Select, Space } from 'antd'
import { StudioGenerationCanvasesService as Canvases, LlmService } from '../../../services/generated'
import type { CanvasDocument, CanvasModelCapability, CanvasNodeRead, CanvasResolvedOutput, ModelRead } from '../../../services/generated'
import { CanvasDragHandle, CanvasEdge, useCanvasViewport } from '../../../components/canvas/Canvas'
import { useGraphLayout } from '../directing/useGraphLayout'
import type { GraphArrange, GraphSize } from '../directing/graphLayout'
import { referenceProtection } from './promptRules'
import { CardShell } from './CardShell'
import { rendererRegistry } from './rendererRegistry'
import { connect, disconnect } from './graphRules'
import { CanvasCatalogProvider, useGraphRules } from './CanvasCatalogContext'
import type { ComponentProps } from 'react'
import type { GenerationCard, GenerationEdge } from './graphRules'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { WorkbenchDetails } from '../directing/ui/WorkbenchDetails'
import './generationCanvas.css'

const emptyCards: NonNullable<CanvasDocument['cards']> = []
const emptyGroups: NonNullable<CanvasDocument['groups']> = []

const arrange: GraphArrange = (nodes, _sizes, _width, _anchor, retained = {}) => Object.fromEntries(nodes.map((node, index) =>
  [node.id, retained[node.id] || { x: 200 + index % 3 * 440, y: Math.floor(index / 3) * 560 }]))

/** 独立画布编辑适配：候选关系与文档持久化，几何沿用公共布局缓存。 */
function GenerationCanvasGraphContent({ document, onChange, readonly = false, runtime, inspectTarget, editingStatus, savedRevision, savedDocument }: { savedDocument?: CanvasDocument; savedRevision?: number; document: CanvasDocument; onChange: (next: CanvasDocument) => void; readonly?: boolean; inspectTarget?: { cardId: string; serial: number }; editingStatus?: string; runtime?: { outputs: Record<string, CanvasResolvedOutput[]>; nodes: Record<string, CanvasNodeRead>; busyCards: Set<string>; checking?: string; disabled: boolean; precheck: (id: string, kind?: 'single' | 'target' | 'selection', cardIds?: string[]) => void } }) {
  const { catalog, cardDefinitions, cardTitles, connectionReason, inputPorts, outputPorts, portLabels } = useGraphRules()
  const cards = document.cards || emptyCards, edges = document.edges || [], groups = document.groups || emptyGroups
  const cardLabel = (id: string) => {
    const source = cards.find(card => card.id === id)
    const name = source && ('name' in source && source.name || 'title' in source && source.title)
    return `${name || cardTitles[source?.type || ''] || '未知卡片'} · ${id.slice(0, 8)}`
  }
  const inputLabel = (card: GenerationCard, port: string) => cardDefinitions[card.type || '']?.inputs.find(item => item.id === port)?.label || portLabels[port]
  const [selected, setSelected] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | undefined>(cards[0]?.id)
  const [detailTrigger, setDetailTrigger] = useState<HTMLElement>()
  const [minimapOpen, setMinimapOpen] = useState(false)
  const [toolboxOpen, setToolboxOpen] = useState(true)
  const [reason, setReason] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number }>()
  const selectionStart = useRef<{ x: number; y: number }>()
  const [storageError, setStorageError] = useState('')
  const [models, setModels] = useState<ModelRead[]>([])
  const [capabilities, setCapabilities] = useState<Record<string, CanvasModelCapability>>({})
  const [capabilityErrors, setCapabilityErrors] = useState<Record<string, string>>({})
  const [measured, setMeasured] = useState<Record<string, GraphSize>>({})
  const [drag, setDrag] = useState<{ card: string; port: string; x: number; y: number }>()
  useEffect(() => {
    if (inspectTarget) setDetailId(inspectTarget.cardId)
  }, [inspectTarget?.cardId, inspectTarget?.serial])
  const latest = useRef(document); latest.current = document
  const container = useRef<HTMLDivElement>(null)
  const hidden = useMemo(() => new Set(groups.filter(group => group.collapsed).flatMap(group => group.card_ids || [])), [groups])
  const cardIdentity = cards.map(card => card.id).join('|')
  const groupIdentity = groups.map(group => `${group.id}:${group.collapsed}`).join('|')
  // 折叠成员在新浏览器没有本地测量；保留几何占位，不能让整个布局永远等待隐藏 DOM。
  const layoutMeasurements = useMemo(() => ({ ...Object.fromEntries([...hidden].map(id => [id, { width: 400, height: 350 }])), ...measured }), [measured, hidden])
  const nodes = useMemo(() => cards.map(card => ({ id: card.id })), [cards])
  const layout = useGraphLayout({ storageKey: `jellyfish:generation-layout:${document.project_id}:${document.id}`, viewId: 'canvas',
    initialTop: 104, initialLeft: window.innerWidth > 700 ? 200 : 16, anchorId: cards[0]?.id || '', validIds: [...cards.map(card => card.id), ...groups.map(group => group.id)], arrange,
    onStorageError: setStorageError }, nodes, layoutMeasurements, container.current?.clientWidth || 1200)
  const transform = layout.view.transform
  const viewport = useCanvasViewport(document.id, transform, update => layout.setView(previous => ({ ...previous,
    transform: typeof update === 'function' ? update(previous.transform) : update })), { x: 2000, y: 1800 })
  const modelIds = cards.filter(card => 'model_id' in card).map(card => 'model_id' in card ? card.model_id : '').filter(Boolean).join('|')
  useEffect(() => {
    let active = true
    LlmService.listModelsApiV1LlmModelsGet({ pageSize: 100 }).then(response => { if (active) setModels(response.data?.items || []) }).catch(() => { if (active) setReason('模型列表读取失败，请刷新后重试') })
    return () => { active = false }
  }, [document.id])
  useEffect(() => {
    let active = true
    setCapabilities({}); setCapabilityErrors({})
    for (const modelId of new Set(modelIds.split('|').filter(Boolean))) {
      Canvases.canvasModelCapability({ projectId: document.project_id, canvasId: document.id, modelId }).then(response => {
        if (active && response.data) setCapabilities(previous => ({ ...previous, [modelId]: response.data! }))
      }).catch(() => { if (active) setCapabilityErrors(previous => ({ ...previous, [modelId]: '模型能力读取失败，原配置和连接已保留' })) })
    }
    return () => { active = false }
  }, [document.id, document.project_id, modelIds])
  useEffect(() => {
    const root = container.current
    if (!root) return
    const observer = new ResizeObserver(entries => setMeasured(previous => {
      const next = { ...previous }; let changed = false
      for (const entry of entries) {
        const id = (entry.target as HTMLElement).dataset.cardId!
        const width = (entry.target as HTMLElement).offsetWidth, height = (entry.target as HTMLElement).offsetHeight
        if (id && (next[id]?.width !== width || next[id]?.height !== height)) { next[id] = { width, height }; changed = true }
      }
      return changed ? next : previous
    }))
    root.querySelectorAll('[data-card-id]').forEach(card => observer.observe(card))
    return () => observer.disconnect()
  }, [cardIdentity, groupIdentity])
  const edit = (next: CanvasDocument) => { if (!readonly) onChange(next) }
  const updateCard = (next: GenerationCard) => edit({ ...latest.current, cards: latest.current.cards?.map(card => card.id === next.id ? next : card) })
  const showProtection = (protection: NonNullable<ReturnType<typeof referenceProtection>>) => {
    setReason(protection.message); setDetailId(protection.cardId)
    const card = window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(protection.cardId)}"]`)
    const segment = card?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(protection.segmentId)}"]`)
    if (segment) { segment.tabIndex = -1; segment.focus(); segment.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  const removeCard = (id: string) => {
    if (runtime?.busyCards.has(id)) { setReason('卡片正在运行，结束前不可删除'); return }
    const protection = referenceProtection(latest.current, id)
    if (protection) { showProtection(protection); return }
    let next = latest.current
    for (const edge of next.edges || []) if (edge.source_card === id || edge.target_card === id) next = disconnect(next, edge.id)
    const order = { ...next.input_order }; delete order[id]
    edit({ ...next, cards: next.cards?.filter(card => card.id !== id), input_order: order,
      groups: next.groups?.map(group => ({ ...group, card_ids: group.card_ids?.filter(card => card !== id) })) })
  }
  const add = (type: string) => {
    const card = (type === 'content.text' || type === 'content.basis') ? { id: crypto.randomUUID(), type, type_version: 1, text: '' }
      : (type === 'content.object' || type === 'content.place') ? { id: crypto.randomUUID(), type, type_version: 1, object_id: null, name: '', category: type === 'content.place' ? 'place' : 'character', text: '', source_locator: '' }
      : ['direction.beat', 'direction.event', 'direction.shot'].includes(type) ? { id: crypto.randomUUID(), type, [type.slice(10) + '_id']: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.criterion' ? { id: crypto.randomUUID(), type, criterion_id: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : ['direction.creative_control', 'direction.guidance'].includes(type) ? { id: crypto.randomUUID(), type, name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.narrative' ? { id: crypto.randomUUID(), type, name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.anchor' ? { id: crypto.randomUUID(), type, anchor_id: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.blocking' ? { id: crypto.randomUUID(), type, blocking_id: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.dialogue' ? { id: crypto.randomUUID(), type, type_version: 1, dialogue_id: crypto.randomUUID(), version: 1, input_bindings: [], examples: [], scope: {} }
      : type.startsWith('direction.') ? { id: crypto.randomUUID(), type, type_version: 1, input_bindings: [], examples: [], scope: {} }
      : type.startsWith('reference.') ? { id: crypto.randomUUID(), type, type_version: 1, title: '', angle: '正面', objects: [], input_bindings: [] }
      : type.startsWith('model.') ? { id: crypto.randomUUID(), type, type_version: 1, model_id: null, prompt: { segments: [] }, config: {} }
      : { id: crypto.randomUUID(), type, type_version: 1, file_id: null, uploading: false }
    edit({ ...latest.current, cards: [...(latest.current.cards || []), card] })
    setDetailId(card.id)
  }
  const capability = (card: GenerationCard) => 'model_id' in card && card.model_id ? capabilities[card.model_id] : undefined
  const check = (edge: GenerationEdge) => {
    const target = cards.find(card => card.id === edge.target_card)
    if (target && 'model_id' in target && target.model_id && !capability(target)) return '模型能力尚未核实，暂不能新建连接'
    return connectionReason(latest.current, edge, target ? capability(target) : undefined)
  }
  const finishDrag = (event: PointerEvent) => {
    if (!drag) return
    const target = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-input-port]')
    if (target) {
      const edge = { id: crypto.randomUUID(), source_card: drag.card, source_port: drag.port, target_card: target.dataset.card!, target_port: target.dataset.inputPort! }
      const issue = check(edge)
      if (issue) setReason(issue)
      else { edit(connect(latest.current, edge)); setReason('已连接候选输入；正文或用途配置决定实际使用') }
    } else setReason('请拖到接收卡的输入端口')
    setDrag(undefined)
  }
  const port = (card: GenerationCard, name: string, input: boolean) => {
    const issue = input && drag ? check({ id: 'preview', source_card: drag.card, source_port: drag.port, target_card: card.id, target_port: name }) : undefined
    return <button key={name} type="button" disabled={readonly} data-card={card.id} data-input-port={input ? name : undefined} data-output-port={!input ? name : undefined}
      data-compatible={input && drag ? !issue : undefined} title={issue || `${input ? '输入' : '输出'}：${input ? inputLabel(card, name) : cardDefinitions[card.type || '']?.outputs.find(item => item.id === name)?.label}`} aria-label={`${input ? '输入' : '输出'}端口 ${name}`}
      onPointerDown={!input ? event => {
        if (readonly || event.button !== 0) return
        event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
        setDrag({ card: card.id, port: name, x: event.clientX, y: event.clientY }); setReason('拖到兼容输入端口；绿色端口可连接')
      } : undefined}
      onPointerMove={!input ? event => { if (drag) setDrag({ ...drag, x: event.clientX, y: event.clientY }) } : undefined}
      onPointerUp={!input ? finishDrag : undefined} onPointerCancel={() => setDrag(undefined)}>
      {input ? '○' : '●'} {input ? inputLabel(card, name) : cardDefinitions[card.type || '']?.outputs.find(item => item.id === name)?.label}
    </button>
  }
  const references = (card: GenerationCard) => <>
    <Space wrap>{card.type?.startsWith('model.') && <><Button disabled={readonly} size="small" onClick={() => {
      const source = { id: crypto.randomUUID(), type: 'content.text' as const, type_version: 1 as const, text: '' }
      const next = { ...latest.current, cards: [...(latest.current.cards || []), source] }
      edit(connect(next, { id: crypto.randomUUID(), source_card: source.id, source_port: 'text', target_card: card.id, target_port: 'text' }))
    }}>添加文本参考</Button>
    <Select<string> aria-label="添加媒体参考" placeholder="添加媒体参考" value={undefined} disabled={readonly} style={{ width: 150 }}
      options={inputPorts(card).filter(port => port !== 'text').map(port => ({ value: port, label: `新建${inputLabel(card, port)}内容卡` }))}
      onChange={targetPort => {
        if (!targetPort) return
        const sourcePort = ['first_frame', 'last_frame', 'key_frame', 'subject_image'].includes(targetPort) ? 'image' : targetPort === 'subject_video' ? 'video' : targetPort
        const source = { id: crypto.randomUUID(), type: `content.${sourcePort}`, type_version: 1, file_id: null, uploading: false }
        edit(connect({ ...latest.current, cards: [...(latest.current.cards || []), source] }, { id: crypto.randomUUID(), source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: targetPort }))
      }} />
    </>}<Select<string> aria-label="连接已有卡" placeholder="选择已有卡" value={undefined} disabled={readonly} style={{ width: 160 }}
      options={cards.flatMap(source => outputPorts(source).flatMap(sourcePort => inputPorts(card).filter(targetPort => !connectionReason(document, { id: 'candidate', source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: targetPort }, capability(card))).map(targetPort => ({ value: `${source.id}|${sourcePort}|${targetPort}`, label: `${cardLabel(source.id)} → ${inputLabel(card, targetPort)}` }))))}
      onChange={value => { if (!value) return; const [source_card, source_port, target_port] = value.split('|'); edit(connect(latest.current, { id: crypto.randomUUID(), source_card, source_port, target_card: card.id, target_port })) }} />
    </Space>
    {inputPorts(card).map(name => {
    const order = document.input_order?.[card.id]?.[name] || []
    if (!order.length) return null
    return <div key={name}><strong>{inputLabel(card, name)}</strong><ol>{order.map((id, index) => {
      const edge = edges.find(item => item.id === id)
      if (!edge) return null
      const unsupported = capability(card) && !capability(card)?.input_ports.includes(name)
      return <li key={id} data-edge-id={id}>
        <span title={edge.source_card}>{cardLabel(edge.source_card)}</span> {unsupported && <span>当前模型不支持，候选保留</span>}
        <Button size="small" disabled={readonly || index === 0} aria-label={`前移输入 ${id}`} onClick={() => {
          const next = [...order]; [next[index - 1], next[index]] = [next[index], next[index - 1]]
          edit({ ...document, input_order: { ...document.input_order, [card.id]: { ...document.input_order?.[card.id], [name]: next } } })
        }}>↑</Button><Button size="small" disabled={readonly} aria-label={`断开连接 ${id}`} onClick={() => {
          const protection = referenceProtection(latest.current, edge.source_card, edge.target_card, edge.source_port, edge.target_port)
          if (protection) { showProtection(protection); return }
          edit(disconnect(latest.current, id))
        }}>断开</Button>
      </li>
    })}</ol></div>
  })}</>
  const selectedModels = cards.filter(card => selected.includes(card.id) && card.type?.startsWith('model.'))
  const finishSelection = (event: PointerEvent<HTMLDivElement>) => {
    const start = selectionStart.current
    if (!start) return
    const left = Math.min(start.x, event.clientX), right = Math.max(start.x, event.clientX)
    const top = Math.min(start.y, event.clientY), bottom = Math.max(start.y, event.clientY)
    const ids = [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')].filter(card => {
      const box = card.getBoundingClientRect()
      return box.left < right && box.right > left && box.top < bottom && box.bottom > top
    }).map(card => card.dataset.cardId!)
    setSelected(ids); selectionStart.current = undefined; setSelectionBox(undefined)
  }
  const point = (id: string) => layout.view.positions[id] || { x: 0, y: 0 }
  const width = viewport.surface.current?.clientWidth || 1200, height = viewport.surface.current?.clientHeight || 800
  const visibleWorld = { x: -transform.x / transform.scale, y: -transform.y / transform.scale, width: width / transform.scale, height: height / transform.scale }
  const mapLeft = Math.min(0, visibleWorld.x, ...cards.map(card => point(card.id).x))
  const mapTop = Math.min(0, visibleWorld.y, ...cards.map(card => point(card.id).y))
  const mapWidth = Math.max(visibleWorld.x + visibleWorld.width, ...cards.map(card => point(card.id).x + (layout.view.sizes[card.id]?.width || 400))) - mapLeft
  const mapHeight = Math.max(visibleWorld.y + visibleWorld.height, ...cards.map(card => point(card.id).y + (layout.view.sizes[card.id]?.height || 160))) - mapTop
  const panMap = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = mapLeft + (event.clientX - box.left) / box.width * mapWidth
    const y = mapTop + (event.clientY - box.top) / box.height * mapHeight
    layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: width / 2 - x * previous.transform.scale, y: height / 2 - y * previous.transform.scale } }))
  }
  const detailCard = cards.find(card => card.id === detailId)
  const DetailRenderer = detailCard && rendererRegistry[detailCard.type || 'content.text']
  return <div className="generation-graph" ref={container}>
    <nav hidden={!toolboxOpen} className="generation-toolbox" aria-label="添加卡片">
      {(['基础内容', '模型生成'] as const).map(group => <section key={group}><h2>{group}</h2>
        {catalog.cards.filter(card => card.group === group).map(card => <Button key={card.type} disabled={readonly} onClick={() => add(card.type)}>添加{card.title.replace('内容', '')}</Button>)}
      </section>)}
      <section><h2>导演工具箱</h2>{[...new Set(catalog.cards.filter(card => card.group === '导演工具箱').map(card => card.category))].map(group => <div key={group}><h3>{group}</h3>{catalog.cards.filter(card => card.category === group).map(card => <Button key={card.type} disabled={readonly} onClick={() => add(card.type)}>添加{card.title}</Button>)}</div>)}</section>
    </nav>
    <Space wrap className="generation-toolbar">
      <Button aria-label={toolboxOpen ? '收起工具箱' : '展开工具箱'} aria-expanded={toolboxOpen} onClick={() => setToolboxOpen(value => !value)}>{toolboxOpen ? '收起工具箱' : '展开工具箱'}</Button>
      <Button aria-label={minimapOpen ? '收起小地图' : '展开小地图'} aria-expanded={minimapOpen} onClick={() => setMinimapOpen(value => !value)}>{minimapOpen ? '收起小地图' : '展开小地图'}</Button>

      <Button disabled={readonly || !selected.length} onClick={() => {
        const members = selected.filter(id => !groups.some(group => group.card_ids?.includes(id)))
        if (!members.length) { setReason('所选卡片已经属于分组'); return }
        edit({ ...document, groups: [...groups, { id: crypto.randomUUID(), name: '新分组', card_ids: members, collapsed: false }] }); setSelected([])
      }}>将所选卡片分组</Button>
      <Button aria-label="框选" variant={selecting ? 'primary' : 'secondary'} aria-pressed={selecting} onClick={() => setSelecting(value => !value)}>框选</Button>
      <Button aria-label={`运行所选模型（${selectedModels.length}）`} disabled={readonly || !selectedModels.length || !runtime || runtime.disabled || selectedModels.some(card => runtime.busyCards.has(card.id))}
        onClick={() => runtime?.precheck(selectedModels[0].id, 'selection', selected)}>运行所选模型（{selectedModels.length}）</Button>
      <Button onClick={() => viewport.fit()}>适应画布</Button>
      <Button disabled={!selected.length} onClick={() => { const id = selected[0], p = point(id); layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: (container.current?.clientWidth || 1200) / 2 - p.x * previous.transform.scale, y: (container.current?.clientHeight || 800) / 2 - p.y * previous.transform.scale } })) }}>定位所选</Button>
      <Button onClick={() => layout.rearrange()}>整理布局</Button><Button disabled={!layout.canUndo} onClick={layout.undo}>撤销布局整理</Button>
      <Button aria-label="放大" onClick={() => viewport.zoom(.1)}>放大</Button><Button aria-label="缩小" onClick={() => viewport.zoom(-.1)}>缩小</Button>
    </Space>
    {storageError && <Alert type="warning" message={`布局本地保存失败：${storageError}`} />}
    <div role="status" className="generation-connection-reason">{reason || '拖动输出端口建立连接；按住 Shift 或启用框选后拖动空白选择卡片'}</div>
    <div ref={viewport.surface} {...viewport.surfaceProps} className="generation-surface" aria-label="生成画布视口"
      onPointerDown={event => {
        if ((selecting || event.shiftKey) && event.button === 0 && event.currentTarget.contains(event.target as Node)
          && !(event.target as Element).closest('[data-card-id], .generation-group, button, input, select, textarea')) {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
          selectionStart.current = { x: event.clientX, y: event.clientY }
          const box = event.currentTarget.getBoundingClientRect()
          setSelectionBox({ x: event.clientX - box.left, y: event.clientY - box.top, width: 0, height: 0 })
        } else viewport.surfaceProps.onPointerDown?.(event)
      }}
      onPointerMove={event => {
        const start = selectionStart.current
        if (!start) { viewport.surfaceProps.onPointerMove?.(event); return }
        const box = event.currentTarget.getBoundingClientRect()
        setSelectionBox({ x: Math.min(start.x, event.clientX) - box.left, y: Math.min(start.y, event.clientY) - box.top,
          width: Math.abs(event.clientX - start.x), height: Math.abs(event.clientY - start.y) })
      }}
      onPointerUp={event => { finishSelection(event); viewport.surfaceProps.onPointerUp?.(event) }}
      onPointerCancel={event => { selectionStart.current = undefined; setSelectionBox(undefined); viewport.surfaceProps.onPointerCancel?.(event) }}
      onLostPointerCapture={event => { selectionStart.current = undefined; setSelectionBox(undefined); viewport.surfaceProps.onLostPointerCapture?.(event) }}>
      {selectionBox && <div className="generation-selection-box" aria-hidden="true" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
      <div className="generation-world" style={{ transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})` }}>
        <svg className="generation-edges" width={12000} height={12000}>
          {edges.filter(edge => !hidden.has(edge.source_card) && !hidden.has(edge.target_card)).map(edge => {
            const from = point(edge.source_card), to = point(edge.target_card), width = layout.view.sizes[edge.source_card]?.width || 400
            return <CanvasEdge key={edge.id} d={`M ${from.x + width} ${from.y + 80} C ${from.x + width + 80} ${from.y + 80}, ${to.x - 80} ${to.y + 80}, ${to.x} ${to.y + 80}`}
              label={`${edge.source_card} → ${edge.target_card} ${portLabels[edge.target_port]}`} />
          })}
        </svg>
        {groups.map(group => {
          const members = (group.card_ids || []).filter(id => cards.some(card => card.id === id))
          const positions = members.map(point)
          const origin = { x: positions.length ? Math.min(...positions.map(pos => pos.x)) - 16 : 0,
            y: positions.length ? Math.min(...positions.map(pos => pos.y)) - 96 : 0 }
          const width = group.collapsed ? 300 : Math.max(400, ...members.map(id => point(id).x + (layout.view.sizes[id]?.width || 400) - origin.x + 16))
          const height = group.collapsed ? 110 : Math.max(140, ...members.map(id => point(id).y + (layout.view.sizes[id]?.height || 350) - origin.y + 16))
          return <section key={group.id} data-group-id={group.id} className="generation-group" style={{ left: origin.x, top: origin.y, width, height }}>
            <div className="generation-group-header"><CanvasDragHandle contextKey={document.id} label={`分组 ${group.name}`} offset={origin} scale={transform.scale} onMove={next => {
              const delta = { x: next.x - origin.x, y: next.y - origin.y }
              layout.setView(previous => ({ ...previous, positions: { ...previous.positions, ...Object.fromEntries(members.map(id => [id,
                { x: (previous.positions[id]?.x || 0) + delta.x, y: (previous.positions[id]?.y || 0) + delta.y }])) } }))
            }} /><Input aria-label="分组名称" value={group.name} disabled={readonly} onChange={event => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) })} />
              <Button size="small" disabled={readonly} onClick={() => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, collapsed: !item.collapsed } : item) })}>{group.collapsed ? '展开组' : '折叠组'}</Button>
              <Button size="small" disabled={readonly} onClick={() => edit({ ...document, groups: groups.filter(item => item.id !== group.id) })}>解散组</Button>
              <Select aria-label={`分组成员 ${group.name}`} mode="multiple" value={members} disabled={readonly} style={{ width: 180 }}
                options={cards.filter(card => members.includes(card.id) || !groups.some(item => item.card_ids?.includes(card.id))).map(card => ({ value: card.id, label: `${cardTitles[card.type || '']} ${card.id.slice(0, 4)}` }))}
                onChange={ids => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, card_ids: ids } : item) })} />
            </div>
            {group.collapsed && <span>{members.length} 张独立卡片 · 无集合输出</span>}
          </section>
        })}
        {cards.filter(card => !hidden.has(card.id)).map(card => {
          const size = layout.view.sizes[card.id]
          return <CardShell key={`${document.id}:${card.id}`} id={card.id} title={cardTitles[card.type || 'content.text']} contextKey={document.id} point={point(card.id)}
            scale={transform.scale} width={size?.width || 400} height={size?.height} selected={selected.includes(card.id)} readonly={readonly} removeDisabled={runtime?.busyCards.has(card.id)}
            onOpen={trigger => { setDetailTrigger(trigger); setDetailId(card.id) }} onSelect={checked => setSelected(previous => checked ? [...previous, card.id] : previous.filter(id => id !== card.id))}
            onMove={position => layout.move(card.id, position)} onResize={(width, height) => {
              if (Math.abs(width - (size?.width || 400)) > 2 || Math.abs(height - (size?.height || measured[card.id]?.height || height)) > 2)
                layout.setView(previous => ({ ...previous, sizes: { ...previous.sizes, [card.id]: { width, height } } }))
            }} onRemove={() => removeCard(card.id)} inputs={inputPorts(card).map(name => port(card, name, true))} outputs={outputPorts(card).map(name => port(card, name, false))}>
            <p className="canvas-card-summary">{['direction.creative_control', 'direction.guidance', 'direction.criterion'].includes(card.type || '') ? guidanceSummary(card as GuidanceCard) : card.type === 'direction.style' ? Object.values((card as VisualStyleCard).fields || {}).map(value => value.text).filter(Boolean).join(' · ') || '风格方向、视觉特征、材质与色彩待编辑' : ['direction.space_rule', 'direction.continuity', 'direction.fact'].includes(card.type || '') ? constraintSummary(card as ConstraintCard) : card.type === 'direction.photography' ? photographySummary(card as PhotographyCard) : ['direction.dialogue', 'direction.sound'].includes(card.type || '') ? soundSummary(card as SoundCard) : ['direction.narrative', 'direction.beat', 'direction.event', 'direction.shot'].includes(card.type || '') ? narrativeSummary(card as NarrativeCard) : ['direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment'].includes(card.type || '') ? spatialSummary(card as SpatialCard) : card.type?.startsWith('direction.') ? performanceSummary(card as PerformanceCard) : 'title' in card ? `${card.title || '命名图片参考'} · ${card.angle || '正面'} · ${card.image_binding ? '已选主图' : '缺少主图'}` : 'text' in card ? card.text || '未填写正文' : 'model_id' in card ? '模型配置、输入采用与运行记录' : 'file_id' in card && card.file_id ? '已选择媒体，打开详情预览' : '未选择媒体'}</p>
          </CardShell>
        })}
      </div>
      {drag && <div className="generation-drag-hint" style={{ left: drag.x - (viewport.surface.current?.getBoundingClientRect().left || 0) + 12, top: drag.y - (viewport.surface.current?.getBoundingClientRect().top || 0) }}>正在连接{portLabels[drag.port]}</div>}
    </div>
    {minimapOpen && <svg className="generation-minimap" role="img" tabIndex={0} aria-label="小地图导航" viewBox={`${mapLeft} ${mapTop} ${mapWidth} ${mapHeight}`} preserveAspectRatio="none"
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panMap(event) }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) panMap(event) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: previous.transform.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: previous.transform.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) } })) } }}>
      <title>小地图导航；方向键平移画布</title>
      {cards.filter(card => !hidden.has(card.id)).map(card => <rect key={card.id} x={point(card.id).x} y={point(card.id).y} width={layout.view.sizes[card.id]?.width || 400} height={layout.view.sizes[card.id]?.height || 160} />)}
      <rect className="generation-minimap-viewport" x={visibleWorld.x} y={visibleWorld.y} width={visibleWorld.width} height={visibleWorld.height} />
    </svg>}
    <WorkbenchDetails title={detailCard ? cardTitles[detailCard.type || 'content.text'] || '卡片详情' : '卡片详情'} status={readonly ? '只读' : editingStatus} open={!!detailCard} onClose={() => setDetailId(undefined)} trigger={detailTrigger}>
      {detailCard?.type?.startsWith('direction.') && <details className="generation-candidate-management"><summary>候选连接管理</summary>{references(detailCard)}</details>}
      {detailCard?.type === 'direction.photography' && <Button disabled={readonly} onClick={() => {
        const copy = { ...structuredClone(detailCard), id: crypto.randomUUID() }
        const incoming = (document.edges || []).filter(edge => edge.target_card === detailCard.id)
        const edgeIds = new Map(incoming.map(edge => [edge.id, crypto.randomUUID()]))
        edit({ ...latest.current, cards: [...(latest.current.cards || []), copy], edges: [...(latest.current.edges || []), ...incoming.map(edge => ({ ...edge, id: edgeIds.get(edge.id)!, target_card: copy.id }))],
          input_order: { ...latest.current.input_order, [copy.id]: Object.fromEntries(Object.entries(document.input_order?.[detailCard.id] || {}).map(([port, ids]) => [port, ids.map(id => edgeIds.get(id)!)])) } })
        setDetailId(copy.id)
      }}>复制为独立摄影方案</Button>}
      {detailCard && DetailRenderer && <ConfigProvider componentDisabled={readonly}><fieldset disabled={readonly} className="generation-card-body"><DetailRenderer savedCard={savedDocument?.cards?.find(card => card.id === detailCard.id)} savedRevision={savedRevision} key={detailCard.id} card={detailCard} document={document} projectId={document.project_id} onChange={updateCard} onAddAngle={output => {
        if (output.payload?.kind !== 'object_reference' || !('category' in output.payload)) return
        const id = crypto.randomUUID(), edgeId = crypto.randomUUID()
        const card = { id, type: `reference.${output.payload.category}`, title: `${output.payload.name} · 另一角度`, angle: '正面', objects: [],
          input_bindings: [{ id: crypto.randomUUID(), input_port: 'name', source: output.source }] } as GenerationCard
        edit(connect({ ...latest.current, cards: [...(latest.current.cards || []), card] },
          { id: edgeId, source_card: output.source.card_id, source_port: 'object', target_card: id, target_port: 'name' }))
        setDetailId(id)
      }} models={models} capability={capability(detailCard)}
        capabilityError={'model_id' in detailCard && detailCard.model_id ? capabilityErrors[detailCard.model_id] : undefined} references={references(detailCard)} disabled={readonly} modelOutputs={runtime?.outputs} node={runtime?.nodes[detailCard.id]} busy={runtime?.busyCards.has(detailCard.id)} checking={runtime?.checking === detailCard.id} runDisabled={runtime?.disabled} onPrecheck={() => runtime?.precheck(detailCard.id)} onTargetPrecheck={() => runtime?.precheck(detailCard.id, 'target')} /></fieldset></ConfigProvider>}
    </WorkbenchDetails>
  </div>
}


export function GenerationCanvasGraph(props: ComponentProps<typeof GenerationCanvasGraphContent>) {
  return <CanvasCatalogProvider key={`${props.document.project_id}:${props.document.id}`} projectId={props.document.project_id} canvasId={props.document.id}><GenerationCanvasGraphContent {...props} /></CanvasCatalogProvider>
}
