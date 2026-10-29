import { canvasNodeStatusLabels } from './useGenerationCanvasRuntime'
import { GenerationCanvasBrowse, type CanvasDisplayFilter } from './GenerationCanvasBrowse'
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
import { createPortal } from 'react-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent, ReactNode } from 'react'
import { AimOutlined, MinusOutlined, PlusOutlined, CloseOutlined } from '@ant-design/icons'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { CanvasToolbarMenu } from '../directing/CanvasToolbarMenu'
import { ConfigProvider, Input, Select, Space, Tooltip } from 'antd'
import { StudioGenerationCanvasesService as Canvases, LlmService } from '../../../services/generated'
import type { CanvasDocument, CanvasModelCapability, CanvasNodeRead, CanvasResolvedOutput, ModelRead } from '../../../services/generated'
import { CanvasDragHandle, CanvasEdge, useCanvasViewport } from '../../../components/canvas/Canvas'
import { useGraphLayout } from '../directing/useGraphLayout'
import type { GraphArrange, GraphSize } from '../directing/graphLayout'
import { referenceProtection } from './promptRules'
import { CardList, cardDragType, cardDragEntry } from './CardList'
import { CardShell } from './CardShell'
import { CandidateOutputStatus } from './CandidateOutputStatus'
import { connectionSides, sideLabels, sidePoint, defaultSides, connectionPath, useConnectionSides, type ConnectionSide } from './connectionGeometry'
import { MediaPreview } from './MediaContentEditor'
import { MediaResultsPreview } from './MediaResultsPreview'
import { rendererRegistry } from './rendererRegistry'
import { connect, disconnect } from './graphRules'
import { CanvasCatalogProvider, useGraphRules } from './CanvasCatalogContext'
import type { ComponentProps } from 'react'
import type { GenerationCard, GenerationEdge } from './graphRules'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { useWorkbenchDesktop } from '../directing/useWorkbenchDesktop'
import { WorkbenchDetails } from '../directing/ui/WorkbenchDetails'
import './generationCanvas.css'

const emptyCards: NonNullable<CanvasDocument['cards']> = []
const emptyGroups: NonNullable<CanvasDocument['groups']> = []
const emptyEdges: NonNullable<CanvasDocument['edges']> = []

const arrange: GraphArrange = (nodes, _sizes, _width, _anchor, retained = {}) => Object.fromEntries(nodes.map((node, index) =>
  [node.id, retained[node.id] || { x: 200 + index % 3 * 440, y: Math.floor(index / 3) * 560 }]))

/** 独立画布编辑适配：候选关系与文档持久化，几何沿用公共布局缓存。 */
function GenerationCanvasGraphContent({ primaryHost, contentHistory, document, onChange, readonly = false, runtime, inspectTarget, editingStatus, savedRevision, savedDocument }: { primaryHost?: HTMLElement | null; contentHistory?: ReactNode; savedDocument?: CanvasDocument; savedRevision?: number; document: CanvasDocument; onChange: (next: CanvasDocument) => void; readonly?: boolean; inspectTarget?: { cardId: string; serial: number; segmentId?: string }; editingStatus?: string; runtime?: { outputs: Record<string, CanvasResolvedOutput[]>; nodes: Record<string, CanvasNodeRead>; busyCards: Set<string>; checking?: string; disabled: boolean; precheck: (id: string, kind?: 'single' | 'target' | 'selection', cardIds?: string[]) => void } }) {
  const { catalog, cardDefinitions, cardTitles, connectionReason, inputPorts, outputPorts, portLabels } = useGraphRules()
  const cards = document.cards || emptyCards, edges = document.edges || emptyEdges, groups = document.groups || emptyGroups
  const cardLabel = (id: string) => {
    const source = cards.find(card => card.id === id)
    const name = source && ('name' in source && source.name || 'title' in source && source.title)
    return `${name || cardTitles[source?.type || ''] || '未知卡片'} · ${id.slice(0, 8)}`
  }
  const inputLabel = (card: GenerationCard, port: string) => cardDefinitions[card.type || '']?.inputs.find(item => item.id === port)?.label || portLabels[port]
  const [displayFilter, setDisplayFilter] = useState<CanvasDisplayFilter>({ group: '', modality: '', problems: false })
  const [selected, setSelected] = useState<string[]>([])
  const [detailId, setDetailId] = useState<string | undefined>()
  const [newPhotographyEntry, setNewPhotographyEntry] = useState<{ cardId: string; entry: string }>()
  // Retain visited editors by card identity; unvisited cards stay unmounted.
  const [detailSessions, setDetailSessions] = useState<string[]>([])
  useEffect(() => {
    if (detailId) setDetailSessions(previous => previous.includes(detailId) ? previous : [...previous, detailId])
    // Hidden editors keep their preview position, but must not keep playing.
    window.document.querySelectorAll<HTMLElement>(`[data-canvas-details="${CSS.escape(document.id)}"]`).forEach(editor => {
      if (editor.getAttribute('data-card-details') !== detailId) editor.querySelectorAll<HTMLMediaElement>('audio, video').forEach(media => media.pause())
    })
  }, [detailId, document.id])
  const desktop = useWorkbenchDesktop()
  const [activeCategory, setActiveCategory] = useState<string>()
  const [accessibleConnection, setAccessibleConnection] = useState<{ card: string; side: ConnectionSide }>()
  const connectionTrigger = useRef<HTMLElement>()
  const connectionMenu = useRef<HTMLDivElement>(null)
  const [detailTrigger, setDetailTrigger] = useState<HTMLElement>()
  const [minimapOpen, setMinimapOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectionBox, setSelectionBox] = useState<{ x: number; y: number; width: number; height: number }>()
  const selectionStart = useRef<{ x: number; y: number }>()
  const [storageError, setStorageError] = useState('')
  const [models, setModels] = useState<ModelRead[]>([])
  const [capabilities, setCapabilities] = useState<Record<string, CanvasModelCapability>>({})
  const [capabilityErrors, setCapabilityErrors] = useState<Record<string, string>>({})
  const filtered = new Set(cards.filter(card => {
    const definition = cardDefinitions[card.type || '']
    const node = runtime?.nodes[card.id]
    const problem = !!runtime?.outputs[card.id]?.some(output => output.basis_current === false) || !!(node && ['failed', 'blocked', 'cancelled'].includes(node.status)) || !!('model_id' in card && card.model_id && capabilityErrors[card.model_id])
    return !!(displayFilter.group && definition?.group !== displayFilter.group || displayFilter.modality && definition?.modality !== displayFilter.modality || displayFilter.problems && !problem)
  }).map(card => card.id))
  const [measured, setMeasured] = useState<Record<string, GraphSize>>({})
  const [drag, setDrag] = useState<{ card: string; side: ConnectionSide; x: number; y: number }>()
  const connectionPointer = useRef(false)
  const [pendingConnection, setPendingConnection] = useState<{ target: string; side: ConnectionSide; x: number; y: number }>()
  const connectionLayout = useConnectionSides(`jellyfish:generation-connection-sides:${document.project_id}:${document.id}`, edges.map(edge => edge.id))
  const cancelConnection = useCallback(() => {
    connectionPointer.current = false; setDrag(undefined); setPendingConnection(undefined); setAccessibleConnection(undefined)
    if (connectionTrigger.current?.isConnected && (desktop || !detailId)) connectionTrigger.current.focus({ preventScroll: true })
  }, [desktop, detailId])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (drag || pendingConnection || accessibleConnection)) { event.preventDefault(); event.stopPropagation(); cancelConnection() }
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [drag, pendingConnection, accessibleConnection, cancelConnection])
  // 仅隐藏详情外壳，编辑器会话仍挂载；连接期间为所有目标让出空间。
  const detailsSuppressed = !!(drag || accessibleConnection || !desktop && activeCategory)
  useEffect(() => {
    if (detailsSuppressed) window.document.querySelectorAll<HTMLMediaElement>(`[data-canvas-details="${CSS.escape(document.id)}"] audio, [data-canvas-details="${CSS.escape(document.id)}"] video`).forEach(media => media.pause())
  }, [detailsSuppressed, document.id])
  useEffect(() => {
    if (!accessibleConnection && !pendingConnection) return
    connectionMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [accessibleConnection, pendingConnection])
  useEffect(() => {
    if (inspectTarget) setDetailId(inspectTarget.cardId)
  }, [inspectTarget?.cardId, inspectTarget?.serial])
  useEffect(() => {
    if (!inspectTarget?.segmentId || inspectTarget.cardId !== detailId) return
    const frame = requestAnimationFrame(() => {
      const editor = window.document.querySelector<HTMLElement>(`[data-canvas-details="${CSS.escape(document.id)}"][data-card-details="${CSS.escape(inspectTarget.cardId)}"]`)
      const segment = editor?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(inspectTarget.segmentId!)}"]`)
      if (segment && !segment.closest('[inert]')) {
        segment.tabIndex = -1
        segment.scrollIntoView({ block: 'nearest', inline: 'nearest' })
        segment.focus({ preventScroll: true })
      }
    })
    return () => cancelAnimationFrame(frame)
  }, [inspectTarget?.serial, detailId, document.id])
  const latest = useRef(document); latest.current = document
  const container = useRef<HTMLDivElement>(null)
  const hidden = useMemo(() => new Set(groups.filter(group => group.collapsed).flatMap(group => group.card_ids || [])), [groups])
  const cardIdentity = cards.map(card => card.id).join('|')
  const filterIdentity = [...filtered].join('|')
  const groupIdentity = groups.map(group => `${group.id}:${group.collapsed}`).join('|')
  // 折叠成员在新浏览器没有本地测量；保留几何占位，不能让整个布局永远等待隐藏 DOM。
  const layoutMeasurements = useMemo(() => ({ ...Object.fromEntries([...hidden].map(id => [id, { width: 400, height: 350 }])), ...measured }), [measured, hidden])
  const nodes = useMemo(() => cards.map(card => ({ id: card.id })), [cards])
  const layout = useGraphLayout({ storageKey: `jellyfish:generation-layout:${document.project_id}:${document.id}`, viewId: 'canvas',
    initialTop: 104, initialLeft: window.innerWidth > 700 ? 200 : 16, anchorId: cards[0]?.id || '', validIds: [...cards.map(card => card.id), ...groups.map(group => group.id)], arrange,
    onStorageError: setStorageError }, nodes, layoutMeasurements, container.current?.clientWidth || 1200)
  const creationView = useRef<{ cardId: string; transform: typeof layout.view.transform }>()
  useLayoutEffect(() => {
    if (!creationView.current || !layout.ready || !measured[creationView.current.cardId]) return
    const retained = creationView.current.transform
    creationView.current = undefined
    layout.setView(previous => ({ ...previous, transform: retained }))
  }, [layout, measured])
  useEffect(() => {
    if (!layout.ready) return
    const missing = edges.filter(edge => !connectionLayout.sides[edge.id])
    if (!missing.length) return
    connectionLayout.setSides(previous => ({ ...previous, ...Object.fromEntries(missing.map(edge => [edge.id, defaultSides(layout.view.positions[edge.source_card] || { x: 0, y: 0 }, layout.view.positions[edge.target_card] || { x: 0, y: 0 })])) }))
  }, [edges, layout, connectionLayout])
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
  }, [cardIdentity, groupIdentity, filterIdentity])
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
  const add = (type: string, position?: { x: number; y: number }, entry?: string) => {
    if (readonly || !catalog.cards.some(card => card.type === type)) return
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
    creationView.current = { cardId: card.id, transform: { ...transform } }
    edit({ ...latest.current, cards: [...(latest.current.cards || []), card] })
    const box = container.current?.getBoundingClientRect()
    let point = position
    if (!point && box) {
      const left = ((box.width > 700 ? 120 : 88) - transform.x) / transform.scale
      const top = ((box.width > 700 ? 180 : 300) - transform.y) / transform.scale
      const availableWidth = Math.max(320, (box.width - (box.width > 700 ? 600 : 140)) / transform.scale)
      const availableHeight = Math.max(250, (box.height - 320) / transform.scale)
      point = { x: left, y: top }
      for (let y = top; y < top + availableHeight; y += 40) {
        let found = false
        for (let x = left; x < left + availableWidth; x += 40) {
          if (!cards.some(existing => {
            const occupied = layout.view.positions[existing.id]
            const size = measured[existing.id] || { width: 400, height: 350 }
            return occupied && x < occupied.x + size.width + 16 && x + 400 + 16 > occupied.x && y < occupied.y + size.height + 16 && y + 350 + 16 > occupied.y
          })) { point = { x, y }; found = true; break }
        }
        if (found) break
      }
    }
    if (point) layout.move(card.id, point)
    setSelected([card.id])
    if (entry) setNewPhotographyEntry({ cardId: card.id, entry })
    setDetailId(card.id)
  }
  const capability = (card: GenerationCard) => 'model_id' in card && card.model_id ? capabilities[card.model_id] : undefined
  const check = (edge: GenerationEdge) => {
    const target = cards.find(card => card.id === edge.target_card)
    if (target && 'model_id' in target && !capability(target)) return '模型能力尚未核实，暂不能新建连接'
    return connectionReason(latest.current, edge, target ? capability(target) : undefined)
  }
  const connectionOptions = (sourceId: string, targetId: string) => {
    const source = cards.find(card => card.id === sourceId), target = cards.find(card => card.id === targetId)
    return source && target ? outputPorts(source).flatMap(source_port => inputPorts(target).map(target_port => ({ id: 'preview', source_card: sourceId, source_port, target_card: targetId, target_port }))) : []
  }
  const compatibleOptions = (sourceId: string, targetId: string) => connectionOptions(sourceId, targetId).filter(edge => !check(edge))
  /** 替代拖线的入口，仍复用同一用途、能力与候选校验，不建立实际采用。 */
  const startAccessibleConnection = (card: string, side: ConnectionSide, trigger: HTMLElement) => {
    if (readonly) return
    setActiveCategory(undefined); connectionTrigger.current = trigger
    setAccessibleConnection({ card, side }); setReason('选择目标，仅提供候选')
    setPendingConnection(undefined); setDrag(undefined)
  }
  const commitConnection = (option: GenerationEdge, targetSide: ConnectionSide) => {
    const issue = check(option)
    if (issue) { setReason(issue); cancelConnection(); return }
    const edge = { ...option, id: crypto.randomUUID() }
    const sourceSide = drag?.side || accessibleConnection?.side
    if (sourceSide) connectionLayout.setSides(previous => ({ ...previous, [edge.id]: { source: sourceSide, target: targetSide } }))
    edit(connect(latest.current, edge)); setReason('已连接候选输入；接收端明确选择后才实际使用')
    cancelConnection()
  }
  const finishDrag = (event: PointerEvent) => {
    if (!drag || pendingConnection) return
    connectionPointer.current = false
    const target = window.document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-connection-side]')
    if (!target) { setReason('连接已取消，请拖到目标连接点'); cancelConnection(); return }
    const targetId = target.dataset.card!, side = target.dataset.connectionSide as ConnectionSide
    const options = compatibleOptions(drag.card, targetId)
    if (!options.length) {
      const first = connectionOptions(drag.card, targetId)[0]
      setReason(first ? check(first) || '没有兼容的接收用途' : '此卡没有兼容的接收用途'); cancelConnection()
    } else if (options.length === 1) commitConnection(options[0], side)
    else setPendingConnection({ target: targetId, side, x: event.clientX, y: event.clientY })
  }
  const chooseAccessibleTarget = (targetId: string, side: ConnectionSide = 'left') => {
    if (!accessibleConnection) return
    const options = compatibleOptions(accessibleConnection.card, targetId)
    if (!options.length) { const first = connectionOptions(accessibleConnection.card, targetId)[0]; setReason(first ? check(first) || '没有兼容的接收用途' : '此卡没有兼容的接收用途'); return }
    if (options.length === 1) commitConnection(options[0], side)
    else setPendingConnection({ target: targetId, side, x: 88, y: 180 })
  }
  // Counts reflect canonical explicit selections, including fixed media associations.
  const edgeAdoptions = (edge: GenerationEdge) => {
    const target = cards.find(card => card.id === edge.target_card)
    if (!target) return 0
    const matches = (source: { card_id: string; port_id: string } | null | undefined) => source?.card_id === edge.source_card && source.port_id === edge.source_port
    const bindings = ('input_bindings' in target ? target.input_bindings || [] : []).filter(binding => binding.input_port === edge.target_port && matches(binding.source)).length
    const mainImage = 'image_binding' in target && edge.target_port === 'image_source' && matches(target.image_binding?.source) ? 1 : 0
    const examples = 'examples' in target && edge.target_port === `${edge.source_port}_example` ? (target.examples || []).filter(example => matches(example.source)).length : 0
    return bindings + mainImage + examples
  }
  const geometricPorts = (card: GenerationCard) => {
    const definition = cardDefinitions[card.type || '']
    const sourceConnection = drag || accessibleConnection
    const options = sourceConnection && card.id !== sourceConnection.card ? compatibleOptions(sourceConnection.card, card.id) : []
    const outputName = ({ text: '文本', image: '图片', video: '视频', audio: '音频' })[definition?.modality || 'text']
    const hoveredPoint = drag && !pendingConnection ? window.document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-connection-side]') : undefined
    const summary = sourceConnection && card.id !== sourceConnection.card ? options.length ? `可作为${[...new Set(options.map(edge => inputLabel(card, edge.target_port)))].join('／')}候选` : connectionOptions(sourceConnection.card, card.id).map(check).find(Boolean) || '此卡没有兼容的接收用途' : `${outputName}${(runtime?.outputs[card.id]?.length || 0) > 1 ? ` · ${runtime?.outputs[card.id]?.length} 项` : ''}`
    return connectionSides.map(side => {
      const connected = edges.some(edge => {
        const sides = connectionLayout.sides[edge.id] || defaultSides(point(edge.source_card), point(edge.target_card))
        return edge.source_card === card.id && sides.source === side || edge.target_card === card.id && sides.target === side
      })
      return <Tooltip key={side} title={summary} open={drag ? !!hoveredPoint && hoveredPoint.dataset.card === card.id && hoveredPoint.dataset.connectionSide === side : undefined}>
        <button type="button" disabled={readonly} className="generation-connection-point" data-card={card.id} data-connection-side={side} data-connected={connected} data-connecting={!!drag || !!accessibleConnection} data-compatible={sourceConnection ? options.length > 0 : undefined} aria-label={`${sideLabels[side]}侧连接点`} onKeyDown={event => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault(); event.stopPropagation()
          if (accessibleConnection) chooseAccessibleTarget(card.id, side)
          else startAccessibleConnection(card.id, side, event.currentTarget)
        }} onPointerDown={event => {
          if (readonly || event.button !== 0 || pendingConnection) return
          if (accessibleConnection) { event.preventDefault(); event.stopPropagation(); chooseAccessibleTarget(card.id, side); return }
          event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
          connectionPointer.current = true; setActiveCategory(undefined); connectionTrigger.current = event.currentTarget
          setDrag({ card: card.id, side, x: event.clientX, y: event.clientY }); setReason('拖到目标连接点，仅提供候选')
        }} onPointerMove={event => { if (drag && !pendingConnection) setDrag({ ...drag, x: event.clientX, y: event.clientY }) }} onPointerUp={finishDrag} onPointerCancel={cancelConnection} onLostPointerCapture={() => { if (connectionPointer.current) cancelConnection() }}><i aria-hidden /></button>
      </Tooltip>
    })
  }
  const references = (card: GenerationCard) => <>
    <CandidateOutputStatus document={document} savedDocument={savedDocument} cardId={card.id} savedRevision={savedRevision} published={runtime?.outputs} />
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
    </>}<Select<string> aria-label="连接已有卡" placeholder="选择已有卡" value={null} disabled={readonly} style={{ width: 160 }}
      options={cards.flatMap(source => outputPorts(source).flatMap(sourcePort => inputPorts(card).filter(targetPort => !check({ id: 'candidate', source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: targetPort })).map(targetPort => ({ value: `${source.id}|${sourcePort}|${targetPort}`, label: `${cardLabel(source.id)} → ${inputLabel(card, targetPort)}` }))))}
      onChange={value => { if (!value) return; const [source_card, source_port, target_port] = value.split('|'); commitConnection({ id: 'candidate', source_card, source_port, target_card: card.id, target_port }, 'left') }} />
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
  const anchor = (id: string, side: ConnectionSide) => sidePoint(point(id), measured[id]?.width || layout.view.sizes[id]?.width || 400, measured[id]?.height || layout.view.sizes[id]?.height || 172, side)
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
  const runSelection = <Button aria-label={`运行所选模型（${selectedModels.length}）`} disabled={readonly || !selectedModels.length || !runtime || runtime.disabled || selectedModels.some(card => runtime.busyCards.has(card.id))}
        onClick={() => runtime?.precheck(selectedModels[0].id, 'selection', selected)}>运行所选模型（{selectedModels.length}）</Button>
  return <div className="generation-graph" ref={container}>
    {connectionLayout.error && <span role="status">{connectionLayout.error}</span>}
    {accessibleConnection && !pendingConnection && <div ref={connectionMenu} role="dialog" aria-label="选择连接目标" className="generation-connection-menu generation-target-menu">
      <strong>选择连接目标</strong>
      <p>连接只提供候选，实际使用仍需明确选择。</p>
      {cards.filter(card => card.id !== accessibleConnection.card && !filtered.has(card.id) && !hidden.has(card.id)).map(card => <Button key={card.id} onClick={() => chooseAccessibleTarget(card.id)}>连接到{'name' in card && card.name || 'title' in card && card.title || cardTitles[card.type || '']} · 卡片 {cards.indexOf(card) + 1}</Button>)}
      <Button onClick={cancelConnection}>取消连接</Button>
    </div>}
    {pendingConnection && (drag || accessibleConnection) && <div ref={connectionMenu} role="menu" aria-label="选择连接用途" className="generation-connection-menu" style={{ left: Math.max(8, Math.min(pendingConnection.x, window.innerWidth - 328)), top: Math.max(8, Math.min(pendingConnection.y, window.innerHeight - 320)) }}>
      <strong>选择连接用途</strong>
      {compatibleOptions((drag || accessibleConnection)!.card, pendingConnection.target).map(option => <Button key={`${option.source_port}:${option.target_port}`} role="menuitem" onClick={() => commitConnection(option, pendingConnection.side)}>{cardDefinitions[cards.find(card => card.id === (drag || accessibleConnection)!.card)?.type || '']?.outputs.find(output => output.id === option.source_port)?.label} → 作为{inputLabel(cards.find(card => card.id === pendingConnection.target)!, option.target_port)}候选</Button>)}
      <Button role="menuitem" onClick={cancelConnection}>取消连接</Button>
    </div>}
    <GenerationCanvasBrowse value={displayFilter} onChange={setDisplayFilter} />
    {primaryHost ? createPortal(runSelection, primaryHost) : runSelection}
    <CardList catalog={catalog} readonly={readonly} active={activeCategory} onActiveChange={category => { cancelConnection(); setActiveCategory(category) }} onAdd={(type, entry) => add(type, undefined, entry)} />
    <nav className="director-canvas-bottom generation-view-tools" aria-label="画布视图工具">
      <WorkbenchIconButton label="定位所选" variant="quiet" icon={<AimOutlined />} disabled={!selected.length} onClick={() => { const p = point(selected[0]); layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: (container.current?.clientWidth || 1200) / 2 - p.x * previous.transform.scale, y: (container.current?.clientHeight || 800) / 2 - p.y * previous.transform.scale } })) }} />
      <WorkbenchIconButton label="缩小" variant="quiet" icon={<MinusOutlined />} onClick={() => viewport.zoom(-.1)} />
      <span aria-label="画布缩放比例">{Math.round(transform.scale * 100)}%</span>
      <WorkbenchIconButton label="放大" variant="quiet" icon={<PlusOutlined />} onClick={() => viewport.zoom(.1)} />
      <Button variant="quiet" onClick={() => viewport.fit()}>适应全部</Button>
      <CanvasToolbarMenu label="布局" caption="布局">
        <Button onClick={() => layout.rearrange()}>整理布局</Button>
        <Button disabled={!layout.canUndo} onClick={layout.undo}>撤销布局整理</Button>
        <Button aria-label={minimapOpen ? '收起小地图' : '展开小地图'} aria-expanded={minimapOpen} onClick={() => setMinimapOpen(value => !value)}>{minimapOpen ? '收起小地图' : '展开小地图'}</Button>
        <Button aria-label="框选" variant="quiet" aria-pressed={selecting} onClick={() => setSelecting(value => !value)}>框选</Button>
      </CanvasToolbarMenu>
    </nav>
    {selected.length > 0 && <div className="generation-selection-actions" aria-label="所选卡片操作">      <Button disabled={readonly} onClick={() => {
        const members = selected.filter(id => !groups.some(group => group.card_ids?.includes(id)))
        if (!members.length) { setReason('所选卡片已经属于分组'); return }
        edit({ ...document, groups: [...groups, { id: crypto.randomUUID(), name: '新分组', card_ids: members, collapsed: false }] }); setSelected([])
      }}>将所选卡片分组</Button>
</div>}
    <div className="canvas-bottom-right generation-bottom-right">
      {(reason || storageError) && <div role="status" className="canvas-status-host">{storageError ? `布局本地保存失败：${storageError}` : reason}</div>}
      {contentHistory}
    </div>
    <div ref={viewport.surface} {...viewport.surfaceProps} className="generation-surface" aria-label="生成画布视口"
      onDragOver={event => { if (!readonly && event.dataTransfer.types.includes(cardDragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
      onDrop={event => {
        if (readonly || !event.dataTransfer.types.includes(cardDragType)) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        add(event.dataTransfer.getData(cardDragType), { x: (event.clientX - box.left - transform.x) / transform.scale, y: (event.clientY - box.top - transform.y) / transform.scale }, event.dataTransfer.getData(cardDragEntry) || undefined)
      }}
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
          {edges.filter(edge => !hidden.has(edge.source_card) && !hidden.has(edge.target_card) && !filtered.has(edge.source_card) && !filtered.has(edge.target_card)).map(edge => {
            const sides = connectionLayout.sides[edge.id] || defaultSides(point(edge.source_card), point(edge.target_card))
            const from = anchor(edge.source_card, sides.source), to = anchor(edge.target_card, sides.target)
            const adopted = edgeAdoptions(edge) > 0
            return <CanvasEdge key={edge.id} d={connectionPath(from, to, sides.source, sides.target)} className={adopted ? 'generation-edge-adopted' : 'generation-edge-candidate'}
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
        {cards.filter(card => !hidden.has(card.id) && !filtered.has(card.id)).map(card => {
          const size = layout.view.sizes[card.id]
          const referenceImage = 'image_binding' in card ? card.image_binding?.file_id : undefined
          const outputs = runtime?.outputs[card.id] || []
          const node = runtime?.nodes[card.id]
          const stale = outputs.some(output => output.basis_current === false)
          const isModel = 'model_id' in card
          return <CardShell key={`${document.id}:${card.id}`} id={card.id} name={'name' in card ? card.name : 'title' in card ? card.title : undefined} title={cardTitles[card.type || 'content.text']} contextKey={document.id} point={point(card.id)}
            scale={transform.scale} width={size?.width || 400} height={size?.height} selected={selected.includes(card.id)} readonly={readonly} removeDisabled={runtime?.busyCards.has(card.id)}
            onOpen={trigger => { if (accessibleConnection) chooseAccessibleTarget(card.id); else { setDetailTrigger(trigger); setDetailId(card.id) } }} onSelect={checked => setSelected(previous => checked ? [...previous, card.id] : previous.filter(id => id !== card.id))}
            onConnect={trigger => startAccessibleConnection(card.id, 'right', trigger)} onMove={position => { if (!accessibleConnection) layout.move(card.id, position) }} onRemove={() => removeCard(card.id)} connections={geometricPorts(card)}
            footer={<>{isModel && <section aria-label="模型状态摘要">
              <span>{models.find(model => model.id === card.model_id)?.name || '尚未选择模型'} · {canvasNodeStatusLabels[node?.status || ''] || '尚未运行'}</span>
              {node?.error_message && <p data-problem="true">生成失败：{node.error_message}{outputs.length > 0 ? ' · 保留上次成果' : ''}</p>}
              {node?.status === 'succeeded' && !node.current_output_updated && <p>配置已变，本次结果未替换正式输出</p>}
            </section>}{stale && <p data-problem="true">依据已变，旧正式输出仍保留</p>}
              {'image_binding' in card && <span>{!referenceImage && '缺少主图 · '}{!card.objects?.length && '尚未绑定名称'}</span>}
              {'uploading' in card && card.uploading && <span>上传尚未完成</span>}
            </>}>

            {!isModel && <>            <p className="canvas-card-summary">{['direction.creative_control', 'direction.guidance', 'direction.criterion'].includes(card.type || '') ? guidanceSummary(card as GuidanceCard) : card.type === 'direction.style' ? Object.values((card as VisualStyleCard).fields || {}).map(value => value.text).filter(Boolean).join(' · ') || '风格方向、视觉特征、材质与色彩待编辑' : ['direction.space_rule', 'direction.continuity', 'direction.fact'].includes(card.type || '') ? constraintSummary(card as ConstraintCard) : card.type === 'direction.photography' ? photographySummary(card as PhotographyCard) : ['direction.dialogue', 'direction.sound'].includes(card.type || '') ? soundSummary(card as SoundCard) : ['direction.narrative', 'direction.beat', 'direction.event', 'direction.shot'].includes(card.type || '') ? narrativeSummary(card as NarrativeCard) : ['direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment'].includes(card.type || '') ? spatialSummary(card as SpatialCard) : card.type?.startsWith('direction.') ? performanceSummary(card as PerformanceCard) : 'title' in card ? `${card.objects?.map(object => object.name).filter(Boolean).join('、') || '未绑定名称'} · ${card.angle || '正面'}` : 'text' in card ? card.text || '未填写正文' : 'model_id' in card ? '尚未生成' : 'file_id' in card && card.file_id ? '固定媒体' : '未选择媒体'}</p>
              {'file_id' in card && card.file_id && <MediaPreview fileId={card.file_id} type={card.type?.split('.')[1] || 'image'} />}
              {referenceImage && <MediaPreview fileId={referenceImage} type="image" />}
            </>}
            {isModel && <section aria-label="模型输出预览">
              {outputs.length === 0 && <><p className="canvas-card-summary">尚未生成</p><small>输入与模型配置在右侧编辑</small></>}
              {outputs.some(output => output.file_id) && <MediaResultsPreview outputs={outputs.filter(output => output.file_id)} showBasisStatus={false} />}
              {outputs.filter(output => output.text).map(output => <p key={output.source.position} className="canvas-card-summary">{output.text}</p>)}
              {node?.text && node.status !== 'succeeded' && <section aria-label="临时生成预览"><small>临时生成内容 · 未成为正式输出</small><p className="canvas-card-summary">{node.text}</p></section>}
            </section>}
          </CardShell>
        })}
      </div>
      {drag && <svg className="generation-temporary-connection" aria-label="正在连接候选" width="100%" height="100%"><path d={(() => {
        const origin = anchor(drag.card, drag.side), rect = viewport.surface.current?.getBoundingClientRect()
        const from = { x: origin.x * transform.scale + transform.x, y: origin.y * transform.scale + transform.y }
        const target = window.document.elementFromPoint(drag.x, drag.y)?.closest<HTMLElement>('[data-connection-side]')
        const targetCard = target?.dataset.card, side = target?.dataset.connectionSide as ConnectionSide | undefined
        const snapped = pendingConnection ? anchor(pendingConnection.target, pendingConnection.side) : targetCard && side && compatibleOptions(drag.card, targetCard).length ? anchor(targetCard, side) : undefined
        const to = snapped ? { x: snapped.x * transform.scale + transform.x, y: snapped.y * transform.scale + transform.y } : { x: drag.x - (rect?.left || 0), y: drag.y - (rect?.top || 0) }
        return connectionPath(from, to, drag.side, pendingConnection?.side || side)
      })()} fill="none" stroke="var(--wb-focus)" strokeWidth="2" markerEnd="url(#generation-preview-arrow)" /><defs><marker id="generation-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="var(--wb-focus)" /></marker></defs></svg>}

    </div>
    {minimapOpen && <WorkbenchIconButton className="director-minimap-toggle director-minimap-toggle-open" label="关闭小地图" variant="quiet" icon={<CloseOutlined />} onClick={() => setMinimapOpen(false)} />}
    {minimapOpen && <svg className="director-minimap generation-minimap" width="200" height="132" role="img" tabIndex={0} aria-label="小地图导航" viewBox={`${mapLeft} ${mapTop} ${mapWidth} ${mapHeight}`} preserveAspectRatio="none"
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panMap(event) }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) panMap(event) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onKeyDown={event => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: previous.transform.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: previous.transform.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) } })) } }}>
      <title>小地图导航；方向键平移画布</title>
      {cards.filter(card => !hidden.has(card.id) && !filtered.has(card.id)).map(card => <rect key={card.id} data-minimap-node={card.id} x={point(card.id).x} y={point(card.id).y} width={layout.view.sizes[card.id]?.width || 400} height={layout.view.sizes[card.id]?.height || 160} />)}
      <rect className="director-minimap-viewport generation-minimap-viewport" x={visibleWorld.x} y={visibleWorld.y} width={visibleWorld.width} height={visibleWorld.height} />
    </svg>}
    {cards.filter(card => detailSessions.includes(card.id) || card.id === detailId).map(detailCard => {
      const DetailRenderer = rendererRegistry[detailCard.type || 'content.text']
      return <WorkbenchDetails key={detailCard.id} title={cardTitles[detailCard.type || 'content.text'] || '卡片详情'} status={readonly ? '只读' : editingStatus} open={detailCard.id === detailId && !detailsSuppressed} onClose={() => setDetailId(current => current === detailCard.id ? undefined : current)} trigger={detailTrigger}>
        {!desktop && <Space wrap><Button onClick={() => setActiveCategory('基础卡')}>添加卡片</Button><Button disabled={readonly} onClick={event => startAccessibleConnection(detailCard.id, 'right', event.currentTarget)}>连接到…</Button></Space>}
        {detailCard?.type?.startsWith('direction.') && <details className="generation-candidate-management"><summary>候选连接管理</summary>{references(detailCard)}</details>}
        {detailCard?.type === 'direction.photography' && <Button disabled={readonly} onClick={() => {
          const copy = { ...structuredClone(detailCard), id: crypto.randomUUID() }
          const incoming = (document.edges || []).filter(edge => edge.target_card === detailCard.id)
          const edgeIds = new Map(incoming.map(edge => [edge.id, crypto.randomUUID()]))
          edit({ ...latest.current, cards: [...(latest.current.cards || []), copy], edges: [...(latest.current.edges || []), ...incoming.map(edge => ({ ...edge, id: edgeIds.get(edge.id)!, target_card: copy.id }))],
            input_order: { ...latest.current.input_order, [copy.id]: Object.fromEntries(Object.entries(document.input_order?.[detailCard.id] || {}).map(([port, ids]) => [port, ids.map(id => edgeIds.get(id)!)])) } })
          setDetailId(copy.id)
        }}>复制为独立摄影方案</Button>}
        {DetailRenderer && <ConfigProvider componentDisabled={readonly}><fieldset disabled={readonly} className="generation-card-body" data-canvas-details={document.id} data-card-details={detailCard.id}><DetailRenderer initialEntry={newPhotographyEntry?.cardId === detailCard.id ? newPhotographyEntry.entry : undefined} savedCard={savedDocument?.cards?.find(card => card.id === detailCard.id)} savedRevision={savedRevision} key={detailCard.id} card={detailCard} document={document} projectId={document.project_id} onChange={updateCard} onAddAngle={output => {
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
    })}
  </div>
}


export function GenerationCanvasGraph(props: ComponentProps<typeof GenerationCanvasGraphContent>) {
  return <CanvasCatalogProvider key={`${props.document.project_id}:${props.document.id}`} projectId={props.document.project_id} canvasId={props.document.id}><GenerationCanvasGraphContent {...props} /></CanvasCatalogProvider>
}
