import { fixedCanvasSource } from './fixedCanvasSource'
import { CheckCardSession } from './CheckCardSession'
import { CardIssueIndicator } from './CardIssueIndicator'
import { diagnosticAssociation, diagnosticEdgeId, diagnosticRelatedCards, isWholeCardDiagnostic } from './canvasRelationNavigation'
import { AssociationInspectionContext } from './CanvasAssociations'
import { CheckCardIssues } from './CheckCardIssues'
import { diagnosticCardAction, diagnosticControl, diagnosticDesignField, duplicateDesignName, type CanvasInspectTarget } from './canvasDiagnosticNavigation'
import type { CanvasDiagnostic } from '../../../services/generated'
import { CheckCardFace } from './CheckCardFace'
import { designMediaSourcePorts } from './designSources'
import { designSummary } from './designSummary'
import type { CompositionCard } from '../../../services/generated'
import { FlatDesignCardBody } from './FlatDesignCard'
import { VisualDesignCard } from './VisualDesignCard'
import { DesignReferenceEditor } from './DesignReferenceEditor'
import { designReferences, isVisualDesign, isReferenceDesign, isFlatDesign } from './designFieldReferences'
import { buildFileDownloadUrl } from '../assets/utils'
import { TextContentEditor } from './TextContentEditor'
import { TextCardPreview } from './TextCardPreview'
import { LinkedResultReader } from './LinkedResultReader'
import { CardStatusSummary } from './CardStatusSummary'
import { ImageContentCardSummary } from './ImageContentCardSummary'
import { GenerationCanvasBrowse, type CanvasDisplayFilter } from './GenerationCanvasBrowse'
import type { ImageContentCard } from '../../../services/generated'
import { spatialSummary, type SpatialCard } from './SpatialDirectionEditor'
import { performanceSummary } from './PerformanceDirectionEditor'
import type { PerformanceCard } from './PerformanceDirectionEditor'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import { AimOutlined, MinusOutlined, PlusOutlined, CloseOutlined, ScissorOutlined, GroupOutlined, MoreOutlined, AppstoreOutlined } from '@ant-design/icons'
import { WorkbenchModal, WorkbenchDialogActions } from '../directing/ui/WorkbenchModal'
import { WorkbenchIconButton } from '../directing/ui/WorkbenchButton'
import { CanvasToolbarMenu } from '../directing/CanvasToolbarMenu'
import { ConfigProvider, Dropdown, Modal, Input, Select, Space, Tooltip, Image } from 'antd'
import { StudioGenerationCanvasesService as Canvases, StudioFilesService, LlmService } from '../../../services/generated'
import type { CanvasCatalog, CanvasDocument, NamedImageReferenceCard, CanvasModelCapability, CanvasNodeRead, CanvasRunRead, CanvasResolvedOutput, ModelRead, ModelSettingsRead, OutputIdentity, TextContentCard } from '../../../services/generated'
import { CanvasDragHandle, CanvasEdge, useCanvasViewport } from '../../../components/canvas/Canvas'
import { createSurfaceGesture } from './surfaceGesture'
import { createConnectionSession, type ConnectionState } from './connectionSession'
import { createMoveTransaction } from './moveTransaction'
import { arrangeGenerationCards, generationVisibleFrames, placeStoryboardCards } from './generationLayout'
import { useCanvasEditorReveal } from './useCanvasEditorReveal'
import { readStoredGraphView, useGraphLayout } from '../directing/useGraphLayout'
import type { GraphArrange } from '../directing/graphLayout'
import { editorPrompt } from './inputBindings'
import type { referenceProtection } from './promptRules'
import { CardList, cardDragType, cardDragEntry } from './CardList'
import { CanvasOutputActions, downloadOutputs, type DownloadOutput } from './CanvasOutputActions'
import { cloneCard, copyRestriction, readCardClipboard, resultClipboardCard, writeCardClipboard, type CardClipboard } from './cardClipboard'
import { CanvasContextMenu } from './CanvasContextMenu'
import { CardShell } from './CardShell'
import { CandidateOutputStatus } from './CandidateOutputStatus'
import { connectionSides, sideLabels, sidePoint, defaultSides, connectionPath, useConnectionSides, type ConnectionSide } from './connectionGeometry'
import { MediaContentEditor, MediaPreview, type MediaCard } from './MediaContentEditor'
import { referenceNameError } from './referenceCardRules'
import { ReferenceCard } from './ReferenceCard'
import { DescriptionCard, isDescriptionCard } from './DescriptionCard'
import { ModelGenerationCard } from './ModelGenerationCard'
import { designHeightBands, generationCardSize, useDesignCardSizes } from './cardGeometry'
import { knownResultPositions, linkedResultCards, placeLinkedResults, retainedResultIds, type LinkedResult } from './linkedResults'
import { resultScopeIncludes } from './resultConnections'
import { capturedResult } from './detachedResults'
import { LinkedResultPreview, linkedResultTitle } from './LinkedResultPreview'
import { PlaybackCardPreview } from './PlaybackCardPreview'
import { rendererRegistry } from './rendererRegistry'
import { visibleSourceEdges, sourceConnectionEdges } from './graphRules'
import { createCanvasOperations } from './canvasOperations'
import { StoryboardReferences } from './StoryboardReferences'
import { chooseStoryboardOverride, storyboardImageBinding, updateStoryboardReference } from './storyboardReferenceEdits'
import { CanvasCatalogProvider, useGraphRules } from './CanvasCatalogContext'
import type { ComponentProps } from 'react'
import type { GenerationCard, GenerationEdge } from './graphRules'
import { WorkbenchButton as Button } from '../directing/ui/WorkbenchButton'
import { useWorkbenchDesktop } from '../directing/useWorkbenchDesktop'
import { CanvasCardEditor } from './CanvasCardEditor'
import { CanvasSourcePopover } from './CanvasSourcePopover'
import { sourceDestination, type CanvasSourceFocus } from './canvasSourceNavigation'
import type { CanvasSourceIndex } from '../../../services/generated'
import './generationCanvas.css'

const emptyCards: NonNullable<CanvasDocument['cards']> = []
const emptyGroups: NonNullable<CanvasDocument['groups']> = []
const emptyEdges: NonNullable<CanvasDocument['edges']> = []

const focusCardTypes = ['content.text', 'content.image', 'model.text', 'model.image']
const connectionPointAt = (x: number, y: number) => window.document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-connection-side]')

const arrange: GraphArrange = (nodes, _sizes, _width, _anchor, retained = {}) => Object.fromEntries(nodes.map((node, index) =>
  [node.id, retained[node.id] || { x: 200 + index % 3 * 440, y: Math.floor(index / 3) * 560 }]))

/** 独立画布编辑适配：候选关系与文档持久化，几何沿用公共布局缓存。 */
function GenerationCanvasGraphContent({ contentHistory, history, document, onChange, readonly = false, runtime, inspectTarget, diagnostics, editingStatus, savedRevision, savedDocument }: { history?: { canUndo?: boolean; record: (undo: () => void, redo: () => void) => void; undo: () => void; redo: () => void }; onCatalogReady?: (catalog: CanvasCatalog) => void; primaryHost?: HTMLElement | null; contentHistory?: ReactNode; savedDocument?: CanvasDocument; savedRevision?: number; document: CanvasDocument; onChange: (next: CanvasDocument) => void; readonly?: boolean; inspectTarget?: CanvasInspectTarget; diagnostics?: CanvasDiagnostic[]; editingStatus?: string; runtime?: { outputs: Record<string, CanvasResolvedOutput[]>; outputsVerified?: boolean; runs: CanvasRunRead[]; nodes: Record<string, CanvasNodeRead>; busyCards: Set<string>; checking?: string; disabled: boolean; precheck: (id: string) => void } }) {
  const [outputAction,setOutputAction] = useState<{mode:'cover'|'download';outputs:DownloadOutput[]}>()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; ids: string[] }>()
  const [pendingDeletion, setPendingDeletion] = useState<string[]>()
  const rules = useGraphRules()
  const { connectionPolicy, catalog, cardDefinitions, cardTitles, inputPorts, outputPorts, portLabels, sourceOptions } = rules
  const summaryOutputs = runtime?.outputsVerified ? runtime.outputs : undefined
  const operations = createCanvasOperations(rules)
  const clean = operations.clean
  const cards = document.cards || emptyCards, edges = document.edges || emptyEdges, groups = document.groups || emptyGroups
  const [sourceGroupId, setSourceGroupId] = useState<string>()
  const viewGroups = useMemo(() => sourceGroupId ? groups.map(group => group.id === sourceGroupId && group.kind !== 'stack'
    ? { ...group, collapsed: false } : group) : groups, [groups, sourceGroupId])
  const [sourceFocus, setSourceFocus] = useState<CanvasSourceFocus>()
  const stacks = groups.filter(group => group.kind === 'stack')
  const stackFor = (id: string) => stacks.find(group => group.card_ids?.includes(id))
  const [viewStackId, setViewStackId] = useState<string>()
  useEffect(() => {
    if (!viewStackId) return
    const escape = (event: KeyboardEvent) => {
      if (!event.isComposing && event.key === 'Escape' && !(event.target as Element).closest('.ant-image-preview')) { event.preventDefault(); event.stopPropagation(); setViewStackId(undefined) }
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [viewStackId])
  const cardLabel = (id: string) => {
    const source = cards.find(card => card.id === id)
    const name = source && ('name' in source && source.name)
    return `${name || cardTitles[source?.type || ''] || '未知卡片'} · ${id.slice(0, 8)}`
  }
  const sourceItems = useMemo(() => {
    const byId = new Map(document.cards?.map(card => [card.id, card]))
    return Object.fromEntries(Object.entries(document.storyboard?.origins || {}).map(([id, origin]) => [id,
      (origin.sources || []).map(source => {
        const target = byId.get(source.card_id)
        const { issue } = sourceDestination(document, source)
        const fieldCard = source.source_field_id ? target : byId.get(id)
        const fieldId = source.source_field_id || source.field_id
        const field = cardDefinitions[fieldCard?.type || '']?.fields.find(item => item.id === fieldId)?.label
          || (fieldCard && 'phases' in fieldCard ? fieldCard.phases?.find(item => 'phase:' + item.id === fieldId)?.name : undefined)
        return { source, label: target ? ('name' in target && target.name || cardTitles[target.type || ''] || '来源卡片') : '失效来源',
          position: field || (typeof source.start === 'number' && typeof source.end === 'number' ? `正文 ${source.start + 1}–${source.end}` : undefined), issue, missing: !target }
      }),
    ]))
  }, [document, cardDefinitions, cardTitles])
  const inputLabel = (card: GenerationCard, port: string) => cardDefinitions[card.type || '']?.inputs.find(item => item.id === port)?.label || portLabels[port]
  const [displayFilter, setDisplayFilter] = useState<CanvasDisplayFilter>({ group: '', modality: '', problems: false })
  const [multiSelectMode, setMultiSelectMode] = useState(false)
  const stackMoved = useRef(false)
  const groupDrag = useRef<{ pointer: number; x: number; y: number; transform: { x: number; y: number }; positions: Record<string, { x: number; y: number }> }>()
  const historicalPositions = useRef<Record<string, { x: number; y: number }>>({})
  const retainedPositions = useRef<Record<string, { x: number; y: number }>>({})
  const [selected, setSelected] = useState<string[]>([])
  const [movingIds, setMovingIds] = useState<readonly string[]>([])
  const [expandRequest, setExpandRequest] = useState<{id:string;serial:number}>()
  const [detailId, setDetailId] = useState<string | undefined>()
  // 保留打开位置的身份；位置消失时不保留旧输出内容。
  const [openedResult, setOpenedResult] = useState<LinkedResult>()
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
  const [connectionState, setConnectionState] = useState<ConnectionState>({})
  const connectionActions = useRef<Omit<Parameters<typeof createConnectionSession>[0], 'change'>>()
  const [connection] = useState(() => createConnectionSession({
    change: setConnectionState,
    options: (source, target) => connectionActions.current!.options(source, target),
    issue: (source, target) => connectionActions.current!.issue(source, target),
    commit: (option, target, source, sourceCard) => connectionActions.current!.commit(option, target, source, sourceCard),
    end: () => connectionActions.current!.end(),
  }))
  const { drag, accessibleConnection, target: connectionTarget } = connectionState
  const connectionSource = drag?.card || accessibleConnection?.card
  const arrangementBlocked = movingIds.length > 0 || !!connectionSource
  const connectionTrigger = useRef<HTMLElement>()
  const connectionMenu = useRef<HTMLDivElement>(null)
  const [detailTrigger, setDetailTrigger] = useState<HTMLElement>()
  const [minimapOpen, setMinimapOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [invalidRequirementNames, setInvalidRequirementNames] = useState<Set<string>>(() => new Set())
  const [sourceTarget, setSourceTarget] = useState<string>()
  const [uploadSource, setUploadSource] = useState<string>()
  const [pendingFrameDisconnect, setPendingFrameDisconnect] = useState<GenerationEdge>()
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | { resultId: string }>()
  const detachPending = useRef(false)
  const [detaching, setDetaching] = useState(false)
  const [selectedResultSource, setSelectedResultSource] = useState<OutputIdentity>()
  const [selectedGroupId, setSelectedGroupId] = useState<string>()
  const [groupPanel, setGroupPanel] = useState<'name' | 'members'>()
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string>()
  const [cardMenuId, setCardMenuId] = useState<string>()
  const [surfaceState, setSurfaceState] = useState<{ spaceHeld: boolean; selectionBox?: { x: number; y: number; width: number; height: number } }>({ spaceHeld: false })
  const [surfaceGesture] = useState(() => createSurfaceGesture(setSurfaceState))
  const { spaceHeld, selectionBox } = surfaceState
  const blankPointer = useRef(false)
  const clearSelection = useCallback(() => { setMultiSelectMode(false); setSelected([]); setSelectedEdgeId(undefined); setDetailId(undefined); setSelectedGroupId(undefined); setGroupPanel(undefined) }, [])
  useEffect(() => {
    if (selected.length || detailId || selectedEdgeId || multiSelectMode) { setSelectedGroupId(undefined); setGroupPanel(undefined) }
  }, [selected, detailId, selectedEdgeId, multiSelectMode])
  const selectGroup = (id: string) => { clearSelection(); setSelectedGroupId(id); setGroupPanel(undefined) }
  const [edgeActionPoint, setEdgeActionPoint] = useState<{ x: number; y: number }>()
  const selectEdge = (id?: typeof selectedEdgeId, position?: { x: number; y: number }, resultSource?: OutputIdentity) => {
    const selected = document.edges?.find(edge => edge.id === id)
    if (selected) id = sourceConnectionEdges(document, selected)[0]?.id
    // Keyboard and relation-picker activation use the visible path midpoint; mouse activation supplies its click.
    const resultSelector = resultSource ? `[data-generation-result-port="${CSS.escape(resultSource.port_id)}"][data-generation-result-position="${resultSource.position}"]` : ''
    const selector = typeof id === 'string'
      ? `[data-generation-edge-id="${CSS.escape(id)}"]${resultSelector}`
      : id && `[data-generation-update-id="${CSS.escape(id.resultId)}"]`
    const path = selector ? container.current?.querySelector<SVGPathElement>(selector + ' .canvas-edge-hit') : undefined
    if (!position && path) {
      const point = path.getPointAtLength(path.getTotalLength() / 2)
      const matrix = path.getScreenCTM(), bounds = container.current?.getBoundingClientRect()
      if (matrix && bounds) { const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix); position = { x: screen.x - bounds.left, y: screen.y - bounds.top } }
    }
    setMultiSelectMode(false); setSelected([]); setDetailId(undefined); setSelectedEdgeId(id); setSelectedResultSource(resultSource); setEdgeActionPoint(position)
  }
  const [selecting, setSelecting] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [modelDefaults, setModelDefaults] = useState<ModelSettingsRead>()
  const [models, setModels] = useState<ModelRead[]>([])
  const [capabilities, setCapabilities] = useState<Record<string, CanvasModelCapability>>({})
  const [capabilityErrors, setCapabilityErrors] = useState<Record<string, string>>({})
  const filterActive = !!(displayFilter.group || displayFilter.modality || displayFilter.problems)
  const matched = new Set(cards.filter(card => {
    const definition = cardDefinitions[card.type || '']
    const node = runtime?.nodes[card.id]
    const problem = !!runtime?.outputs[card.id]?.some(output => output.basis_current === false) || !!(node && ['failed', 'blocked', 'cancelled'].includes(node.status)) || !!('model_id' in card && card.model_id && capabilityErrors[card.model_id])
    return filterActive && (!displayFilter.group || definition?.group === displayFilter.group) && (!displayFilter.modality || definition?.modality === displayFilter.modality) && (!displayFilter.problems || problem)
  }).map(card => card.id))
  const cancelConnection = useCallback(() => connection.cancel(), [connection])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || !(drag || accessibleConnection)) return
      // Menus consume Escape before connection cancellation, including when focus has left the menu.
      if (container.current?.closest('[inert]') || container.current?.querySelector('.generation-card-menu, .canvas-toolbar-popover:not([hidden])') || window.document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return
      event.preventDefault(); event.stopPropagation(); cancelConnection()
    }
    window.addEventListener('keydown', cancel)
    return () => window.removeEventListener('keydown', cancel)
  }, [drag, accessibleConnection, cancelConnection])
  // 仅隐藏详情外壳，编辑器会话仍挂载；连接期间为所有目标让出空间。
  const detailsSuppressed = !!(drag || accessibleConnection || !desktop && activeCategory)
  useEffect(() => {
    if (detailsSuppressed) window.document.querySelectorAll<HTMLMediaElement>(`[data-canvas-details="${CSS.escape(document.id)}"] audio, [data-canvas-details="${CSS.escape(document.id)}"] video`).forEach(media => media.pause())
  }, [detailsSuppressed, document.id])
  useEffect(() => {
    if (!accessibleConnection) return
    const focusTarget = (event: FocusEvent) => {
      const target = event.target
      const item = target instanceof HTMLElement && container.current?.contains(target)
        ? target.closest<HTMLElement>('[data-connection-target], [data-card-id]') : undefined
      connection.focusTarget(item?.dataset.connectionTarget || item?.dataset.cardId)
    }
    window.addEventListener('focusin', focusTarget)
    connectionMenu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    return () => window.removeEventListener('focusin', focusTarget)
  }, [accessibleConnection, connection])
  const [diagnosticTarget, setDiagnosticTarget] = useState<CanvasInspectTarget>()
  useEffect(() => { setDiagnosticTarget(current => current?.cardId === detailId ? current : undefined) }, [detailId])
  const [designFieldTarget, setDesignFieldTarget] = useState<{ cardId: string; fieldId: string; serial: number }>()
  const navigateInspection = useRef<(cardId: string, target?: CanvasInspectTarget) => void>(() => undefined)
  // Diagnostics navigate once per explicit request, using current stack/layout data without re-centering on every render.
  useEffect(() => {
    if (inspectTarget) navigateInspection.current(inspectTarget.cardId, inspectTarget)
  }, [inspectTarget])
  const latest = useRef(document); latest.current = document
  useEffect(() => {
    if (readonly) return
    const cleaned = clean(document)
    if (cleaned !== document) {
      const removed = document.edges?.filter(edge => !cleaned.edges?.some(item => item.id === edge.id)) || []
      if (removed.length) setReason(`已清理 ${removed.length} 条旧的未采用设计关联线，已采用关系保留`)
      onChange(cleaned)
    }
  }, [document, readonly, onChange, clean])
  const container = useRef<HTMLDivElement>(null)
  const hidden = useMemo(() => new Set(viewGroups.filter(group => group.kind === 'stack' || group.collapsed).flatMap(group => group.card_ids || [])), [viewGroups])
  const knownPositions = useMemo(() => knownResultPositions(runtime?.runs || []), [runtime?.runs])
  const linkedResults = useMemo(() => linkedResultCards(cards, runtime?.outputs, hidden, edges, knownPositions), [cards, runtime?.outputs, hidden, edges, knownPositions])
  const resultsById = useMemo(() => new Map(linkedResults.map(result => [result.id, result])), [linkedResults])
  useEffect(() => {
    if (cardMenuId && !cards.some(card => card.id === cardMenuId) && !resultsById.has(cardMenuId)) setCardMenuId(undefined)
  }, [cards, cardMenuId, resultsById])
  const layoutKey = `jellyfish:generation-layout:${document.project_id}:${document.id}`
  const cachedResultIds = retainedResultIds(cards, readStoredGraphView(`${layoutKey}:view:canvas`)?.positions || {})
  const visibleSourceConnections = visibleSourceEdges(document).filter(edge =>
    !(stackFor(edge.source_card) && stackFor(edge.source_card)?.id === stackFor(edge.target_card)?.id)
    && (!hidden.has(edge.source_card) || stackFor(edge.source_card)) && (!hidden.has(edge.target_card) || stackFor(edge.target_card)))
  const projectedConnections = visibleSourceConnections.map(edge => {
    const members = sourceConnectionEdges(document, edge)
    const displayed = linkedResults.filter(result => result.output.source.card_id === edge.source_card && members.some(member => member.source_port === result.output.source.port_id))
    const covered = ({ port_id, position }: CanvasResolvedOutput['source']) => members.some(member => member.source_port === port_id && resultScopeIncludes(member.result_scope, position))
    // A scope may retain future candidates even after the last current path is disconnected.
    const known = [...(knownPositions.get(edge.source_card)?.values() || []), ...(runtime?.outputs[edge.source_card] || [])]
      .filter(output => members.some(member => member.source_port === output.source.port_id))
    // 显式连接模型仍能提供已固定批次的正式输出，其结果卡不再展开。
    const source = cards.find(card => card.id === edge.source_card)
    const expanded = source && 'show_result_cards' in source && source.show_result_cards && !hidden.has(source.id)
    const direct = expanded ? (runtime?.outputs[edge.source_card] || []).filter(output =>
      covered(output.source) && !displayed.some(({ output: item }) =>
        item.source.port_id === output.source.port_id && item.source.position === output.source.position)) : []
    return { edge, projected: displayed.length > 0 || direct.length > 0 || known.length > 0 && !known.some(output => covered(output.source)),
      results: displayed.filter(result => covered(result.output.source)), direct }
  })
  const isCardVisible = (id: string) => !hidden.has(id)
  const visibleCardIds = cards.map(({ id }) => id).filter(isCardVisible)
  const arrangeCards: GraphArrange = (items, sizes, width, anchorId, retained) => {
    const cards = items.filter(item => !resultsById.has(item.id))
    const arranged = retained
      ? arrange(cards, sizes, width, anchorId, { ...historicalPositions.current, ...retained })
      : arrangeGenerationCards(cards.map(card => card.id), groups, retainedPositions.current, sizes)
    const base = document.storyboard && retained
      ? placeStoryboardCards(arranged, retained, groups, document.storyboard.origins, sizes)
      : arranged
    const basePoint = (id: string) => base[id] || { x: 0, y: 0 }
    const { cardFrames, groupFrames } = generationVisibleFrames(visibleCardIds, viewGroups, basePoint, sizes)
    const positions = placeLinkedResults(linkedResults, base, sizes, [...cardFrames, ...groupFrames.values()], retained && { ...historicalPositions.current, ...retained })
    for (const id of cachedResultIds) if (!positions[id] && retained?.[id]) positions[id] = retained[id]
    return positions
  }
  const lockedDesignCardIds = [
    ...movingIds.filter(id => !hidden.has(id)),
    ...[detailId, connectionSource, connectionTarget].filter((id): id is string => !!id),
  ]
  const designSizes = useDesignCardSizes(cards, lockedDesignCardIds)
  const sizesReady = cards.every(card => !designHeightBands(card.type) || hidden.has(card.id) || designSizes.measured(card.id))
  const nodes = [
    ...cards.map(card => ({ id: card.id, size: designSizes.sizes[card.id] })),
    ...linkedResults.map(result => ({ id: result.id, size: generationCardSize(`result.${result.output.modality}`) })),
  ]
  const cardSizes = Object.fromEntries(nodes.map(({ id, size }) => [id, size]))
  const layout = useGraphLayout({ storageKey: layoutKey, viewId: 'canvas',
    initialTop: window.innerWidth > 700 ? 180 : 300, initialLeft: window.innerWidth > 700 ? 200 : 80, anchorId: cards[0]?.id || '',
    validIds: [...new Set([...nodes.map(node => node.id), ...groups.map(group => group.id), ...cachedResultIds])], arrange: arrangeCards,
    onStorageError: setStorageError }, nodes, sizesReady ? cardSizes : {}, container.current?.clientWidth || 1200)
  const arrangeLayout = () => { if (!arrangementBlocked) layout.rearrange() }
  const layoutAction = <WorkbenchIconButton label="整理布局" variant="quiet" icon={<AppstoreOutlined />} disabled={arrangementBlocked} onClick={arrangeLayout} />
  const movementHost = useRef({ layout, history })
  movementHost.current = { layout, history }
  const [movement] = useState(() => createMoveTransaction({
    view: () => movementHost.current.layout.view,
    update: change => movementHost.current.layout.setView(change),
    record: (undo, redo) => movementHost.current.history?.record(undo, redo),
    onMembersChange: setMovingIds,
  }))
  const centerInspectionElement = (selector: string) => requestAnimationFrame(() => {
    const element = container.current?.querySelector<HTMLElement>(selector)
    const bounds = container.current?.getBoundingClientRect()
    if (!element || !bounds) return
    const box = element.getBoundingClientRect()
    layout.setView(previous => ({ ...previous, transform: { ...previous.transform,
      x: previous.transform.x + bounds.x + (bounds.width - box.width) / 2 - box.x,
      y: previous.transform.y + bounds.y + (bounds.height - box.height) / 2 - box.y } }))
    element.focus({ preventScroll: true })
  })
  const locateSource = (source: CanvasSourceIndex, trigger: HTMLElement) => {
    const { focus, issue } = sourceDestination(document, source)
    if (!focus) { setReason(issue); return }
    const cardId = focus.cardId
    const stack = stackFor(cardId)
    const group = groups.find(item => item.kind !== 'stack' && item.card_ids?.includes(cardId))
    setSourceGroupId(group?.collapsed ? group.id : undefined)
    setDiagnosticTarget(undefined); setDesignFieldTarget(undefined); setSourceFocus({ ...focus, serial: Date.now() })
    setMultiSelectMode(false); setSelected([cardId]); setSelectedEdgeId(undefined); setSelectedGroupId(undefined)
    setDetailTrigger(trigger); setReason(issue || '')
    centerInspectionElement(stack ? `[data-stack-id="${CSS.escape(stack.id)}"]` : `[data-card-id="${CSS.escape(cardId)}"]`)
    if (focus.selector || stack) requestAnimationFrame(() => setDetailId(cardId))
    else setDetailId(undefined)
  }
  navigateInspection.current = (cardId: string, target?: CanvasInspectTarget) => {
    setSourceFocus(undefined)
    setDiagnosticTarget(target)
    const edgeId = target?.diagnostic && diagnosticEdgeId(target.diagnostic)
    if (edgeId) {
      const edge = edges.find(item => item.id === edgeId)
      if (!edge) { setReason('问题所指的连线已不可用'); return }
      const representative = sourceConnectionEdges(document, edge)[0]
      const connection = projectedConnections.find(item => item.edge.id === representative?.id)
      if (!connection) {
        if (stackFor(edge.source_card)?.id && stackFor(edge.source_card)?.id === stackFor(edge.target_card)?.id) navigateInspection.current(edge.source_card)
        else setReason('问题所指的连线当前不可见')
        return
      }
      const outputs = [...connection.results.map(item => item.output), ...connection.direct].filter(output => output.source.port_id === edge.source_port && resultScopeIncludes(edge.result_scope, output.source.position))
      if (connection.projected && outputs.length !== 1) { setReason('问题所指的连线当前没有唯一可定位的输出'); return }
      const source = connection.projected ? outputs[0].source : undefined
      const selector = `[data-generation-edge-id="${CSS.escape(connection.edge.id)}"]` + (source ? `[data-generation-result-port="${CSS.escape(source.port_id)}"][data-generation-result-position="${source.position}"]` : '')
      const path = container.current?.querySelector<SVGPathElement>(selector + ' .canvas-edge-hit')
      const matrix = path?.getScreenCTM(), bounds = container.current?.getBoundingClientRect()
      if (!path || !matrix || !bounds) { setReason('问题所指的连线当前不可见'); return }
      const center = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(matrix)
      layout.setView(previous => ({ ...previous, transform: { ...previous.transform,
        x: previous.transform.x + bounds.x + bounds.width / 2 - center.x,
        y: previous.transform.y + bounds.y + bounds.height / 2 - center.y } }))
      selectEdge(edge.id, { x: bounds.width / 2, y: bounds.height / 2 }, source)
      setReason('')
      requestAnimationFrame(() => path.focus({ preventScroll: true }))
      return
    }
    if (target && !cards.some(card => card.id === cardId)) { setReason('问题所指的卡片已不可用'); return }
    const stack = stackFor(cardId)
    if (stack) {
      clearSelection()
      setReason('请先解除堆叠后编辑')
      centerInspectionElement(`[data-stack-id="${CSS.escape(stack.id)}"]`)
      return
    }
    const collapsedGroup = groups.find(group => group.collapsed && group.card_ids?.includes(cardId))
    if (target && collapsedGroup) {
      clearSelection()
      setSelectedGroupId(collapsedGroup.id)
      setReason('问题所指的卡片位于已折叠的编组内')
      centerInspectionElement(`[data-group-id="${CSS.escape(collapsedGroup.id)}"]`)
      return
    }
    if (target?.diagnostic && isWholeCardDiagnostic(target.diagnostic)) {
      clearSelection()
      setSelected([cardId])
      setReason('')
      centerInspectionElement(`[data-card-id="${CSS.escape(cardId)}"]`)
      return
    }
    if (target?.diagnostic && diagnosticAssociation(cards.find(card => card.id === cardId), target.diagnostic)?.unavailable) {
      setReason('问题所指的关系已不可用'); return
    }
    { setSelected([cardId]); setSelectedEdgeId(undefined); setDetailId(cardId) }
  }
  /** 始终从手势起始位置平移成员，堆叠与编组共用同一位移语义。 */
  const moveGroupDrag = (clientX: number, clientY: number) => {
    const current = groupDrag.current
    if (!current) return
    setCardMenuId(undefined)
    movement.begin(Object.keys(current.positions), true)
    const delta = { x: (clientX - current.x - transform.x + current.transform.x) / transform.scale, y: (clientY - current.y - transform.y + current.transform.y) / transform.scale }
    movement.moveGroup(current.positions, delta)
  }
  const cancelGroupDrag = useCallback(() => {
    const current = groupDrag.current
    if (!current) return
    layout.setView(previous => ({ ...previous, positions: { ...previous.positions, ...current.positions } }))
    groupDrag.current = undefined
    movement.finish(true)
  }, [layout, movement])
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (!event.isComposing && event.key === 'Escape' && groupDrag.current) { event.preventDefault(); event.stopPropagation(); cancelGroupDrag() }
    }
    const blur = () => { if (groupDrag.current) { groupDrag.current = undefined; movement.finish() } }
    window.addEventListener('keydown', cancel, true); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', cancel, true); window.removeEventListener('blur', blur) }
  }, [cancelGroupDrag, movement])
  historicalPositions.current = { ...historicalPositions.current, ...layout.view.positions }
  retainedPositions.current = layout.view.positions
  const connectionLayout = useConnectionSides(`jellyfish:generation-connection-sides:${document.project_id}:${document.id}`, edges.map(edge => edge.id), Object.fromEntries(edges.map(edge => [edge.id, defaultSides(layout.view.positions[edge.source_card] || { x: 0, y: 0 }, layout.view.positions[edge.target_card] || { x: 0, y: 0 })])))
  const creationView = useRef<{ cardId: string; autoPlace: boolean; transform: typeof layout.view.transform }>()
  const pastedView = useRef<{ ids: string[]; origin: { x: number; y: number }; transform: typeof layout.view.transform }>()
  useEffect(() => {
    if (!layout.ready) return
    const missing = edges.filter(edge => !connectionLayout.sides[edge.id])
    if (!missing.length) return
    connectionLayout.setSides(previous => ({ ...previous, ...Object.fromEntries(missing.map(edge => [edge.id, defaultSides(layout.view.positions[edge.source_card] || { x: 0, y: 0 }, layout.view.positions[edge.target_card] || { x: 0, y: 0 })])) }))
  }, [edges, layout, connectionLayout])
  const transform = layout.view.transform
  const currentTransform = useRef(transform); currentTransform.current = transform
  const viewport = useCanvasViewport(document.id, transform, update => layout.setView(previous => ({ ...previous,
    transform: typeof update === 'function' ? update(previous.transform) : update })), { x: 2000, y: 1800 })
  const surfaceRef = viewport.surface
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const target = event.target as Element
      if (event.key === 'Escape' || event.isComposing) { surfaceGesture.spaceReset(); return }
      if (event.defaultPrevented || movement.pointerActive || target.closest('input, textarea, select, [contenteditable], [role="dialog"], .generation-card-menu')) return
      if (event.code === 'Space' && target.closest('button, audio, video')) return
      if (event.code === 'Space' && container.current?.contains(target)) { event.preventDefault(); surfaceGesture.spaceDown(target, event.repeat) }

    }
    const keyup = (event: KeyboardEvent) => {
      if (event.code !== 'Space') return
      if (!surfaceGesture.spaceUp(event.target, event.isComposing || event.defaultPrevented || movement.pointerActive)) return
      const target = event.target as HTMLElement
      const card = target.matches('[data-card-id]') ? target : undefined
      if (card) {
        const id = card.dataset.cardId!
        if (multiSelectMode) setSelected(previous => previous.includes(id) ? previous.filter(value => value !== id) : [...previous, id])
        else { setSelected([id]); setDetailTrigger(card); setDetailId(id) }
      }
    }
    const focus = (event: FocusEvent) => {
      surfaceGesture.focus(!!(event.target as Element).closest('input, textarea, select, [contenteditable], [role="dialog"]'))
    }
    const blur = () => { if (surfaceRef.current) delete surfaceRef.current.dataset.panning; surfaceGesture.blur() }
    window.addEventListener('focusin', focus); window.addEventListener('keydown', keydown); window.addEventListener('keyup', keyup); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('focusin', focus); window.removeEventListener('keydown', keydown); window.removeEventListener('keyup', keyup); window.removeEventListener('blur', blur) }
  }, [movement, multiSelectMode, surfaceGesture, surfaceRef])
  const revealEditor = useCanvasEditorReveal(transform, offset => layout.setView(previous => ({ ...previous, transform: { ...previous.transform, ...offset } })))
  const edgePointer = useRef<{x:number;y:number}>()
  const beginMove = (id: string, pointer = false) => {
    const selection = selected.includes(id) ? selected : [id]
    movement.begin(selection, pointer)
    setSelected(selection); setSelectedEdgeId(undefined)
    if (selection.length > 1 || detailId && detailId !== id) setDetailId(undefined)
  }
  const finishMove = (cancelled = false) => movement.finish(cancelled)
  const moveCards = (id: string, position: { x: number; y: number }) => movement.move(id, position)
  const panAtEdge = useRef(() => {})
  panAtEdge.current = () => {
    const pointer = edgePointer.current, surface = viewport.surface.current
    if (!movement.pointerActive || !pointer || !surface) return
    const box = surface.getBoundingClientRect()
    const speed = (value: number, min: number, max: number) => value < min + 40 ? Math.min(10, (min + 40 - value) / 4) : value > max - 40 ? -Math.min(10, (value - max + 40) / 4) : 0
    const dx = speed(pointer.x, box.left + 80, box.right), dy = speed(pointer.y, box.top + 80, box.bottom - 48)
    if (!dx && !dy) return
    movement.pan(dx, dy)
  }
  useEffect(() => {
    let frame: number
    const tick = () => { panAtEdge.current(); frame = requestAnimationFrame(tick) }
    const pointer = (event: globalThis.PointerEvent) => { edgePointer.current = { x: event.clientX, y: event.clientY } }
    frame = requestAnimationFrame(tick); window.addEventListener('pointermove', pointer)
    return () => { cancelAnimationFrame(frame); window.removeEventListener('pointermove', pointer) }
  }, [])
  const modelIds = cards.filter(card => 'model_id' in card).map(card => 'model_id' in card ? card.model_id : '').filter(Boolean).join('|')
  useEffect(() => {
    let active = true
    LlmService.getModelSettingsApiV1LlmModelSettingsGet().then(response => { if (active) setModelDefaults(response.data || undefined) }).catch(() => { if (active) setReason('默认模型读取失败，请手动选择模型') })
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
  const edit = (next: CanvasDocument) => { if (!readonly) onChange(next) }
  const updateCard = (next: GenerationCard) => {
    const result = updateStoryboardReference(latest.current, next, operations, capability)
    if (result.document) {
      edit(result.document)
      if (invalidRequirementNames.has(next.id) && next.type === 'direction.criterion' && 'name' in next && next.name?.trim() && reason === '请先填写验收要求名称') setReason('')
      return true
    }
    setReason(result.reason); return false
  }
  const showProtection = (protection: NonNullable<ReturnType<typeof referenceProtection>>) => {
    setReason(protection.message); setDetailId(protection.cardId)
    const card = window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(protection.cardId)}"]`)
    const segment = card?.querySelector<HTMLElement>(`[data-segment-id="${CSS.escape(protection.segmentId)}"]`)
    if (segment) { segment.tabIndex = -1; segment.focus(); segment.scrollIntoView({ block: 'nearest', inline: 'nearest' }) }
  }
  const removeCards = (ids: string[], confirmed = false) => {
    if (readonly || !ids.length) return
    const selectedIds = new Set(ids)
    if (ids.some(id => {
      const owner = resultsById.get(id)?.output.source.card_id
      return owner && !selectedIds.has(owner)
    })) { setReason('请先断开与生成卡的连线，再删除此结果卡'); return }
    // 关联结果只随所属模型移除，文档删除始终按真实卡片及最终保留的消费者检查。
    const cardIds = (latest.current.cards || []).filter(card => selectedIds.has(card.id)).map(card => card.id)
    if (!cardIds.length) return
    const result = operations.remove(latest.current, cardIds, runtime?.busyCards || new Set(), cardLabel)
    if (!result.document) {
      if (result.protection) showProtection(result.protection)
      else setReason(result.reason)
      return
    }
    if (!confirmed) { setPendingDeletion(cardIds); return }
    edit(result.document)
    clearSelection(); viewport.surface.current?.focus({ preventScroll: true })
  }
  const removeCard = (id: string) => removeCards([id])
  const zoomAt = (scale: number, x: number, y: number) => {
    if (movement.active) return
    layout.setView(previous => {
      const before = previous.transform, next = Math.max(.15, Math.min(2, scale))
      return { ...previous, transform: { scale: next, x: x - (x - before.x) * next / before.scale, y: y - (y - before.y) * next / before.scale } }
    })
  }
  useEffect(() => {
    const surface = viewport.surface.current
    if (!surface) return
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest('input,textarea,select,[contenteditable],audio,video,[role="menu"],.generation-linked-text')) return
      event.preventDefault()
      const box = surface.getBoundingClientRect(), units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? surface.clientHeight : 1
      zoomAt(transform.scale * Math.exp(-event.deltaY * units * .002), event.clientX - box.left, event.clientY - box.top)
    }
    surface.addEventListener('wheel', wheel, { passive: false })
    return () => surface.removeEventListener('wheel', wheel)
  })
  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      if (!event.isComposing && viewport.surface.current) viewport.surface.current.dataset.keyboardFocus = 'true'
      const target = event.target as HTMLElement
      if (contextMenu || event.defaultPrevented || event.isComposing || !container.current?.contains(target)) return
      const toolbarMenuOpen = !!container.current?.querySelector('.canvas-toolbar-popover:not([hidden])')
      if ((cardMenuId || toolbarMenuOpen || drag || accessibleConnection) && event.key === 'Escape') return // Inner controls consume Escape before the window bubble listener.
      if (target.closest('input,textarea,select,[contenteditable],[role="dialog"],[role="menu"],[role="combobox"],.generation-card-menu,.generation-linked-text') || window.document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return
      if (cardMenuId || toolbarMenuOpen) {
        const activation = ['Enter', ' '].includes(event.key) && !target.closest('button, a, summary, [role="button"], audio, video')
        if (activation || ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete', 'Backspace', '+', '=', '-', '0'].includes(event.key) || (event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
          event.preventDefault(); event.stopPropagation()
        }
        return
      }
      if (movement.pointerActive && event.key !== 'Escape') { event.preventDefault(); event.stopPropagation(); return }
      if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); removeCards(selected); return }
      if ((event.metaKey || event.ctrlKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); if (!readonly) { if (event.shiftKey || event.key.toLowerCase() === 'y') history?.redo(); else history?.undo() } return
      }
      if (event.key === 'Escape' && (surfaceGesture.selecting || surfaceGesture.pan)) {
        event.preventDefault()
        const restore = surfaceGesture.escape()
        if (restore) layout.setView(previous => ({ ...previous, transform: { ...previous.transform, ...restore } }))
        if (viewport.surface.current) delete viewport.surface.current.dataset.panning
        return
      }
      if (event.key === 'Escape' && !detailId) { event.preventDefault(); clearSelection(); return }
      const box = viewport.surface.current?.getBoundingClientRect()
      if (box && ['+', '=', '-'].includes(event.key)) { event.preventDefault(); zoomAt(transform.scale + (event.key === '-' ? -.1 : .1), box.width / 2, box.height / 2) }
      if (event.key === '0') { event.preventDefault(); fitVisibleCards() }
      const card = target.closest<HTMLElement>('[data-card-id]')
      if (card && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
        event.preventDefault()
        const id = card.dataset.cardId!, step = event.shiftKey ? 50 : 10
        beginMove(id)
        const origin = layout.view.positions[id] || { x: 0, y: 0 }
        moveCards(id, { x: origin.x + (event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0), y: origin.y + (event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0) })
      }
    }
    const menuEscape = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key !== 'Escape' || !cardMenuId || container.current?.closest('[inert]') || window.document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return
      if (container.current?.querySelector('.canvas-toolbar-popover:not([hidden])')) return
      const target = event.target as Element
      if (!container.current?.contains(target) && !target.closest('.generation-card-editor')?.querySelector(`[data-canvas-details="${CSS.escape(document.id)}"]`)) return
      event.preventDefault(); setCardMenuId(undefined)
      container.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(cardMenuId)}"] [aria-label="卡片操作"]`)?.focus({ preventScroll: true })
    }
    const up = (event: KeyboardEvent) => { if (event.key.startsWith('Arrow') && !movement.pointerActive) finishMove() }
    const blur = () => finishMove()
    window.addEventListener('blur', blur)
    window.addEventListener('keydown', menuEscape); window.addEventListener('keydown', keyboard, true); window.addEventListener('keyup', up)
    return () => { window.removeEventListener('blur', blur); window.removeEventListener('keydown', menuEscape); window.removeEventListener('keydown', keyboard, true); window.removeEventListener('keyup', up) }
  })
  const add = (type: string, position?: { x: number; y: number }, _entry?: string, selectOnly = false) => {
    if (readonly || !catalog.cards.some(card => card.type === type)) return
    const card = (type === 'content.text' || type === 'content.basis') ? { id: crypto.randomUUID(), type, type_version: 1, text: '' }
      : ['content.character', 'content.prop', 'content.costume', 'content.place'].includes(type) ? { id: crypto.randomUUID(), type, type_version: 1, object_id: null, name: '', category: type.split('.')[1], text: '', source_locator: '' }
      : ['direction.beat', 'direction.event', 'direction.shot'].includes(type) ? { id: crypto.randomUUID(), type, [type.slice(10) + '_id']: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.criterion' ? { id: crypto.randomUUID(), type, criterion_id: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : ['direction.creative_control', 'direction.guidance'].includes(type) ? { id: crypto.randomUUID(), type, name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.narrative' ? { id: crypto.randomUUID(), type, name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.anchor' ? { id: crypto.randomUUID(), type, anchor_id: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.blocking' ? { id: crypto.randomUUID(), type, blocking_id: crypto.randomUUID(), name: '', input_bindings: [], examples: [], scope: {} }
      : type === 'direction.dialogue' ? { id: crypto.randomUUID(), type, type_version: 1, dialogue_id: crypto.randomUUID(), input_bindings: [], examples: [], scope: {} }
      : type.startsWith('direction.') ? { id: crypto.randomUUID(), type, type_version: 1, input_bindings: [], examples: [], scope: {} }
      : type.startsWith('reference.') ? { id: crypto.randomUUID(), type, type_version: 2, name: '', angle: '正面' }
      : type === 'review.check' ? { id: crypto.randomUUID(), type, type_version: 1, disabled_items: [] }
      : type.startsWith('model.') ? { id: crypto.randomUUID(), type, type_version: 1, model_id: null, prompt: { segments: [] }, config: {} }
      : { id: crypto.randomUUID(), type, type_version: 1, file_id: null, uploading: false }
    creationView.current = { cardId: card.id, autoPlace: !position, transform }
    edit({ ...latest.current, cards: [...(latest.current.cards || []), card] })
    if (position) layout.move(card.id, position)
    setSelected([card.id])
    setDetailId(selectOnly || card.type?.startsWith('direction.') ? undefined : card.id)
  }
  const cardOutputs = (ids:string[]):DownloadOutput[] => ids.flatMap<DownloadOutput>(id=>{
    const card=cards.find(card=>card.id===id)
    if(!card)return []
    const values=runtime?.outputs[id] || []
    if(values.length)return values.filter(output=>output.available && (output.file_id || output.text)).map((output,index)=>({key:`${id}:${index}`,name:cardLabel(id),fileId:output.file_id || undefined,text:output.text || undefined,modality:output.modality,stale:output.basis_current===false}))
    const fileId='file_id' in card ? card.file_id : 'image_binding' in card ? card.image_binding?.file_id : undefined
    if(fileId)return [{key:id,name:cardLabel(id),fileId,modality:card.type?.startsWith('reference.')?'image':card.type?.split('.')[1] || 'image'}]
    if('text' in card && card.text)return [{key:id,name:cardLabel(id),text:card.text,modality:'text'}]
    return []
  })
  const setCover=(fileId:string)=>{if(!readonly){edit({...latest.current,cover_file_id:fileId});setReason('画布封面已设置')}}
  const openOutputAction=(mode:'cover'|'download',ids:string[])=>{
    if(mode==='cover' && (readonly || ids.length!==1))return
    const outputs=cardOutputs(ids).filter(output=>mode==='download'||output.modality==='image')
    if(!outputs.length){setReason('没有可用输出');return}
    if(outputs.length>1)setOutputAction({mode,outputs:structuredClone(outputs)})
    else if(mode==='cover')setCover(outputs[0].fileId!)
    else void downloadOutputs(outputs).catch(()=>{setOutputAction({mode,outputs});setReason('下载失败，请重试')})
  }
  const pasteCount=useRef(0)
  const pastePending=useRef(false)
  const currentReadonly=useRef(readonly);currentReadonly.current=readonly
  const lastPaste=useRef<{x:number;y:number;count:number}>()
  const mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  const pasteCards = async (clipboard: CardClipboard | undefined, position?: { x:number; y:number }) => {
    if (readonly || !clipboard || clipboard.projectId !== document.project_id || clipboard.cards.some(card => copyRestriction(card))) return
    if(pastePending.current)return
    pastePending.current=true
    try {
      const fileIds=clipboard.cards.flatMap(card=>'file_id' in card && card.file_id ? [card.file_id] : 'image_binding' in card && card.image_binding?.file_id ? [card.image_binding.file_id] : [])
      await Promise.all([...new Set(fileIds)].map(async fileId=>{
        const {data}=await StudioFilesService.getFileDetailApiV1StudioFilesFileIdGet({fileId})
        if(!data || data.deleted || !data.usages?.some(usage=>usage.project_id===document.project_id))throw new Error('文件不可用或不属于当前项目')
      }))
    } catch {setReason('无法粘贴：媒体不可用或项目归属不匹配');pastePending.current=false;return}
    pastePending.current=false
    if(!mounted.current || currentReadonly.current)return
    // 校验期间允许浏览；提交落点及可见性必须使用此刻视口，而非调用时闭包。
    const pasteTransform = currentTransform.current
    const box=viewport.surface.current?.getBoundingClientRect()
    const origin=position || {x:((box?.width || 1200)/2-pasteTransform.x)/pasteTransform.scale,y:((box?.height || 800)/2-pasteTransform.y)/pasteTransform.scale}
    if(position){const last=lastPaste.current;lastPaste.current={...position,count:last?.x===position.x && last.y===position.y ? last.count+1 : 0}}
    const offset=position ? (lastPaste.current?.count || 0)*32 : pasteCount.current++*32
    origin.x+=offset;origin.y+=offset
    const left=Math.min(...clipboard.positions.map(point=>point.x)), top=Math.min(...clipboard.positions.map(point=>point.y))
    const copies=clipboard.cards.map(cloneCard)
    const positions=Object.fromEntries(copies.map((card,index)=>[card.id,{x:origin.x+clipboard.positions[index].x-left,y:origin.y+clipboard.positions[index].y-top}]))
    if (box) pastedView.current = { ids: copies.map(card => card.id), origin, transform: pasteTransform }
    layout.setView(previous=>({...previous,positions:{...previous.positions,...positions}}))
    edit({...latest.current,cards:[...(latest.current.cards || []),...copies]})
    setSelected(copies.map(card=>card.id));setDetailId(undefined);setSelectedEdgeId(undefined)
  }
  const copyTarget = (id: string): { card?: GenerationCard; reason?: string } => {
    const result = resultsById.get(id)
    if (result) {
      const card = resultClipboardCard(id, result.output)
      return card ? { card } : { reason: '当前输出不可用，无法复制' }
    }
    const card = latest.current.cards?.find(card => card.id === id)
    if (!card) return { reason: '卡片已不存在' }
    return { card, reason: stackFor(id) ? '请先解除堆叠' : copyRestriction(card) }
  }
  const copyReason = (ids: string[]) => ids.map(id => copyTarget(id).reason).find(Boolean)
  const copyCards = (ids: string[], duplicate=false) => {
    const entries = ids.map(copyTarget)
    const targets = entries.flatMap(({ card }) => card ? [card] : [])
    const reason = entries.find(entry => entry.reason)?.reason
    if (!targets.length || reason) {setReason(reason || '请选择卡片');return}
    const value:CardClipboard={schema:1,projectId:document.project_id,cards:structuredClone(targets),positions:targets.map(card=>point(card.id))}
    if(duplicate) pasteCards(value,{x:Math.min(...value.positions.map(point=>point.x))+32,y:Math.min(...value.positions.map(point=>point.y))+32})
    else try {writeCardClipboard(value);setReason('已复制，可在画布粘贴')} catch {setReason('卡片剪贴板保存失败，请重试')}
  }
  const openCardContext = (id: string, trigger: HTMLElement) => {
    const box = trigger.getBoundingClientRect()
    const ids = selected.includes(id) ? selected : [id]
    setCardMenuId(undefined)
    setSelected(ids)
    setContextMenu({ x: box.left, y: box.bottom, ids })
  }
  // 容器后代不等于画布焦点；编组、堆叠、连线及独立控件保留各自键盘行为。
  const ownsCardShortcut = (target: Element) => target === viewport.surface.current
    || target.matches('[data-card-id], [data-keyboard-move]') && !!target.closest('[data-card-id]')
  const clipboardKey = useRef<(event: KeyboardEvent)=>void>();clipboardKey.current=event=>{
    if(!contextMenu && !movement.pointerActive && !drag && !accessibleConnection && !surfaceGesture.selecting && !surfaceGesture.pan && !event.isComposing && (event.key==='ContextMenu'||event.shiftKey&&event.key==='F10')){
      const target=event.target as Element
      if(!container.current?.contains(target)||!ownsCardShortcut(target)||target.closest('input,textarea,[contenteditable],[data-card-details],[role="dialog"]'))return
      event.preventDefault();event.stopImmediatePropagation()
      const card=target.closest<HTMLElement>('[data-card-id]'),box=(card||viewport.surface.current)?.getBoundingClientRect()
      if(box){const ids=card?.dataset.cardId ? selected.includes(card.dataset.cardId)?selected:[card.dataset.cardId] : [];if(ids.length)setSelected(ids);setContextMenu({x:box.left+24,y:box.top+24,ids})}return
    }

    if(contextMenu || readonly && event.key.toLowerCase()!=='c' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey || event.isComposing || event.defaultPrevented || movement.pointerActive) return
    const target=event.target as Element
    if(!container.current?.contains(target) || !ownsCardShortcut(target) || target.closest('input,textarea,select,[contenteditable],[data-card-details],[role="dialog"],[role="menu"],.generation-card-menu') || window.document.querySelector('.ant-modal-wrap:not([style*="display: none"])')) return
    const key=event.key.toLowerCase()
    if(!['c','v','d'].includes(key))return
    event.preventDefault();event.stopImmediatePropagation()
    if(key==='v')void pasteCards(readCardClipboard(document.project_id));else copyCards(selected,key==='d')
  }
  useEffect(()=>{const handler=(event:KeyboardEvent)=>clipboardKey.current?.(event);window.addEventListener('keydown',handler,true);return()=>window.removeEventListener('keydown',handler,true)},[])
  const capability = (card: GenerationCard) => 'model_id' in card && card.model_id ? capabilities[card.model_id] : undefined
  const check = (edge: GenerationEdge, position?: number) => {
    const target = latest.current.cards?.find(card => card.id === edge.target_card)
    return operations.check(latest.current, edge, target ? capability(target) : undefined, position)
  }
  // Composite creation keeps its card and connection in one document history entry.
  const connectDocument = (next: CanvasDocument, edge: GenerationEdge, modelCapability?: CanvasModelCapability) => {
    const result = operations.connect(next, edge, modelCapability)
    if (!result.document) { setReason(result.reason); return false }
    edit(result.document); return true
  }
  const connectionOptions = (sourceId: string, targetId: string) => {
    const source = cards.find(card => card.id === sourceId), target = cards.find(card => card.id === targetId)
    return source && target ? outputPorts(source).flatMap(source_port => inputPorts(target).map(target_port => ({ id: 'preview', source_card: sourceId, source_port, target_card: targetId, target_port }))) : []
  }
  const existingSource = (sourceId: string, targetId: string) => {
    const result = resultsById.get(sourceId)?.output.source
    return latest.current.edges?.find(edge => edge.source_card === (result?.card_id || sourceId) && edge.target_card === targetId
      && (!result || edge.source_port === result.port_id && resultScopeIncludes(edge.result_scope, result.position)))
  }
  const compatibleOptions = (sourceId: string, targetId: string) => {
    const result = resultsById.get(sourceId)?.output
    if (result?.available === false) return []
    const existing = existingSource(sourceId, targetId)
    return existing ? [existing] : sourceOptions(latest.current, result?.source.card_id || sourceId, targetId)
      .filter(edge => (!result || edge.source_port === result.source.port_id) && !check(edge, result?.source.position))
  }
  // Hover, pointer release and keyboard activation report the same compatible-use failure.
  const connectionFailure = (sourceId: string, targetId: string) => {
    const result = resultsById.get(sourceId)?.output
    if (result?.available === false) return '当前输出缺失，不能建立连接'
    const source = result?.source.card_id || sourceId
    const options = sourceOptions(latest.current, source, targetId)
    const first = options[0] || connectionOptions(source, targetId)[0]
    return first ? check(first, result?.source.position) || '没有兼容的接收用途' : '此卡没有兼容的接收用途'
  }
  const showConnectionIssue = (message: string, sourceId: string) => {
    setReason(message)
    if (message === '请先填写验收要求名称') setInvalidRequirementNames(previous => new Set(previous).add(sourceId))
  }
  /** 替代拖线的入口，复用来源兼容与能力校验，唯一独立用途随连接生效。 */
  const startAccessibleConnection = (card: string, side: ConnectionSide, trigger: HTMLElement) => {
    if (readonly) return
    setActiveCategory(undefined); connectionTrigger.current = trigger
    connection.start({ card, side }); setReason('选择接收卡以建立来源连接')
  }
  const submitConnection = (option: GenerationEdge, targetSide: ConnectionSide, sourceSide: ConnectionSide, sourceId?: string) => {
    if (readonly) { setReason('当前只读，不能新建连接'); return }
    const result = sourceId ? resultsById.get(sourceId)?.output : undefined
    if (result?.available === false) { setReason('当前输出缺失，不能建立连接'); return }
    const position = result?.source.position
    const existing = existingSource(sourceId || option.source_card, option.target_card)
    if (existing) { selectEdge(existing.id, undefined, result?.source); setReason('该来源已连接'); return }
    const issue = check(option, position)
    if (issue) { showConnectionIssue(issue, option.source_card); return }
    const edge = { ...option, id: crypto.randomUUID() }
    const target = latest.current.cards?.find(card => card.id === edge.target_card)
    if (position !== undefined) {
      const added = operations.connectResult(latest.current, edge, position, target && capability(target))
      if (!added.document) { setReason(added.reason); return }
      edit(added.document); setReason(connectionPolicy(latest.current, option)?.message || '来源已连接')
      return
    }
    if (sourceSide) connectionLayout.setSides(previous => ({ ...previous, [edge.id]: { source: sourceSide, target: targetSide } }))
    if (connectDocument(latest.current, edge, target && capability(target))) setReason(connectionPolicy(latest.current, option)?.message || '来源已连接')
  }
  const finishDrag = (event: PointerEvent) => {
    if (!drag) return
    const target = connectionPointAt(event.clientX, event.clientY)
    if (!target) { setReason('连接已取消，请拖到目标连接点'); cancelConnection(); return }
    connection.choose(target.dataset.card!, target.dataset.connectionSide as ConnectionSide)
  }
  const chooseAccessibleTarget = (targetId: string, side: ConnectionSide = 'left') => {
    if (accessibleConnection) connection.choose(targetId, side)
  }
  connectionActions.current = {
    options: compatibleOptions,
    issue: (source, target) => showConnectionIssue(connectionFailure(source, target), source),
    commit: submitConnection,
    end: () => {
      if (connectionTrigger.current?.isConnected && (desktop || !detailId)) connectionTrigger.current.focus({ preventScroll: true })
    },
  }
  // Counts reflect canonical explicit selections, including fixed media associations.
  const edgeAdoptions = (edge: GenerationEdge, position?: number) => {
    const target = cards.find(card => card.id === edge.target_card)
    if (!target) return 0
    const matches = (source: { card_id: string; port_id: string; position?: number } | null | undefined) =>
      source?.card_id === edge.source_card && source.port_id === edge.source_port && (position === undefined || source.position === position)
    const bindings = ('input_bindings' in target ? target.input_bindings || [] : []).filter(binding => binding.input_port === edge.target_port && matches(binding.source)).length
    const name = 'name_binding' in target && edge.target_port === 'name' && matches(target.name_binding) ? 1 : 0
    const mainImage = 'image_binding' in target && edge.target_port === 'image_source' && matches(target.image_binding?.source) ? 1 : 0
    const examples = 'examples' in target && edge.target_port === `${edge.source_port}_example` ? (target.examples || []).filter(example => matches(example.source)).length : 0
    const fields = edge.target_port === edge.source_port ? designReferences(target).filter(({ reference }) => matches(reference.source)).length : 0
    const frame = edge.source_port === 'text' && edge.target_port === 'text' && 'frame_target' in target && target.frame_target?.card_id === edge.source_card ? 1 : 0
    return bindings + name + mainImage + examples + fields + frame
  }
  const geometricPorts = (card: GenerationCard, result?: LinkedResult) => {
    const id = result?.id || card.id
    const definition = cardDefinitions[card.type || '']
    const sourceConnection = drag || accessibleConnection
    const options = !result && sourceConnection && id !== sourceConnection.card ? compatibleOptions(sourceConnection.card, id) : []
    const outputName = ({ text: '文本', image: '图片', video: '视频', audio: '音频' })[definition?.modality || 'text']
    const hoveredPoint = drag ? connectionPointAt(drag.x, drag.y) : undefined
    const summary = result ? (result.output.available === false ? '当前输出缺失' : linkedResultTitle(result.output))
      : sourceConnection && id !== sourceConnection.card
        ? existingSource(sourceConnection.card, id) ? '已连接，选择可定位连线'
          : options[0] ? connectionPolicy(document, options[0])?.message : connectionFailure(sourceConnection.card, id)
        : `${outputName}${(runtime?.outputs[card.id]?.length || 0) > 1 ? ` · ${runtime?.outputs[card.id]?.length} 项` : ''}`
    const sidesToRender = result ? ['right'] as const : connectionSides
    return sidesToRender.map(side => {
      const connected = result ? projectedConnections.some(connection => connection.results.some(item => item.id === id)) : edges.some(edge => {
        const sides = connectionLayout.sides[edge.id] || defaultSides(point(edge.source_card), point(edge.target_card))
        return edge.source_card === card.id && sides.source === side || edge.target_card === card.id && sides.target === side
      })
      return <Tooltip key={side} title={summary} trigger={['hover', 'focus']} open={drag ? !!hoveredPoint && hoveredPoint.dataset.card === id && hoveredPoint.dataset.connectionSide === side : undefined}>
        <button type="button" disabled={readonly || result?.output.available === false} className="generation-connection-point" data-card={id} data-connection-side={side} data-connected={connected} data-connecting={!!drag || !!accessibleConnection} data-compatible={sourceConnection ? options.length > 0 : undefined} aria-label={`${sideLabels[side]}侧连接点`} onKeyDown={event => {
          if (event.defaultPrevented || event.nativeEvent.isComposing || event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault(); event.stopPropagation()
          if (accessibleConnection) chooseAccessibleTarget(id, side)
          else startAccessibleConnection(id, side, event.currentTarget)
        }} onPointerDown={event => {
          if (readonly || event.button !== 0) return
          if (accessibleConnection) { event.preventDefault(); event.stopPropagation(); chooseAccessibleTarget(id, side); return }
          event.stopPropagation(); event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
          setActiveCategory(undefined); connectionTrigger.current = event.currentTarget
          connection.start({ card: id, side }, { x: event.clientX, y: event.clientY }); setReason('拖到接收卡建立来源连接')
        }} onPointerMove={event => {
          if (drag) connection.move({ x: event.clientX, y: event.clientY }, connectionPointAt(event.clientX, event.clientY)?.dataset.card)
        }} onPointerUp={finishDrag} onPointerCancel={cancelConnection} onLostPointerCapture={() => { if (connection.pointerActive) cancelConnection() }}><i aria-hidden>+</i></button>
      </Tooltip>
    })
  }
  const removeEdge = (edge: GenerationEdge, confirmed = false, resultPosition?: number) => {
    const members = sourceConnectionEdges(latest.current, edge)
    const result = resultPosition === undefined ? operations.disconnect(latest.current, edge, confirmed) : operations.disconnectResult(latest.current, edge, resultPosition)
    if (!result.document) {
      if (result.confirmFrame) setPendingFrameDisconnect(edge)
      else setReason(result.reason)
      return
    }
    edit(result.document)
    if (members.some(member => member.id === selectedEdgeId)) setSelectedEdgeId(undefined)
    requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(edge.target_card)}"]`)?.focus({ preventScroll: true }))
  }
  const edgePurpose = (edge: GenerationEdge, resultSource?: OutputIdentity) => {
    if (edge.target_port === 'check_basis') return '生成检查依据 · 只读'
    const target = cards.find(card => card.id === edge.target_card)
    const members = sourceConnectionEdges(document, edge).filter(member => !resultSource || member.source_port === resultSource.port_id)
    const used = members.filter(member => edgeAdoptions(member, resultSource?.position)).map(member => target ? inputLabel(target, member.target_port) : member.target_port)
    const matches = (source?: OutputIdentity | null) => source?.card_id === edge.source_card
      && (!resultSource || source.port_id === resultSource.port_id && source.position === resultSource.position)
    const fields = target ? designReferences(target).filter(({ reference }) => matches(reference.source)).map(({ field }) => '正文引用 · ' + (cardDefinitions[target.type || '']?.fields?.find(item => item.id === field)?.label || field)) : []
    const prompt = target ? (editorPrompt(target).segments || []).flatMap((segment, index) => {
      const references = segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : []
      return references.some(reference => matches(reference.source) && members.some(member => member.source_port === reference.source?.port_id)) ? [segment.kind === 'instruction' ? '指令引用 · ' + segment.command : `模型正文引用 · 第 ${index + 1} 段`] : []
    }) : []
    const frame = !resultSource && target && 'frame_target' in target && target.frame_target?.card_id === edge.source_card ? ['画面定位 · ' + target.frame_target.state_id] : []
    return [...new Set([...used, ...fields, ...prompt, ...frame])].join('／') || (members.length === 1 && target ? `${inputLabel(target, edge.target_port)} · 候选` : '来源候选 · 在接收卡选择用途')
  }
  const edgeLabel = (edge: GenerationEdge) => `${cardLabel(edge.source_card)} → ${cardLabel(edge.target_card)} · ${edgePurpose(edge)}`
  const inspectedEdge = edges.find(edge => edge.id === selectedEdgeId)
  const inspectedResultEdge = inspectedEdge && selectedResultSource && sourceConnectionEdges(document, inspectedEdge).find(member =>
    member.source_port === selectedResultSource.port_id && resultScopeIncludes(member.result_scope, selectedResultSource.position))
  const inspectedResult = typeof selectedEdgeId === 'object' ? resultsById.get(selectedEdgeId.resultId) : undefined
  const detachResult = async (result: LinkedResult) => {
    if (readonly || detachPending.current) return
    const captured = capturedResult(result.output, runtime?.runs || [])
    if (!captured) { setReason('当前正式结果不可固定'); return }
    detachPending.current = true
    setDetaching(true)
    const { id: canvasId, project_id: projectId } = latest.current
    try {
      const response = await Canvases.canvasOutputContent({ projectId, canvasId, ...captured })
      if (!container.current || currentReadonly.current || latest.current.id !== canvasId) return
      const fixed = response.data
      if (!fixed?.origin || fixed.origin.incomplete) { setReason('当前正式结果不可固定'); return }
      const changed = operations.detachResult(latest.current, result.output, fixed)
      if (!changed.document) { setReason(changed.reason); return }
      const position = retainedPositions.current[result.id] || historicalPositions.current[result.id]
      if (position) layout.move(fixed.id, position)
      edit(changed.document)
      setSelectedEdgeId(previous => typeof previous === 'object' && previous.resultId === result.id ? undefined : previous)
      setReason('已固定此结果，原下游连接及引用已保留')
      requestAnimationFrame(() => container.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(fixed.id)}"]`)?.focus({ preventScroll: true }))
    } catch {
      if (container.current) setReason('无法读取此正式结果，固定未完成')
    } finally {
      detachPending.current = false
      if (container.current) setDetaching(false)
    }
  }
  const references = (card: GenerationCard) => <>
    <CandidateOutputStatus document={document} savedDocument={savedDocument} cardId={card.id} savedRevision={savedRevision} published={runtime?.outputs} />
    <Space wrap>{card.type?.startsWith('model.') && <><Button disabled={readonly} size="small" onClick={() => {
      const source = { id: crypto.randomUUID(), type: 'content.text' as const, type_version: 1 as const, text: '' }
      const next = { ...latest.current, cards: [...(latest.current.cards || []), source] }
      connectDocument(next, { id: crypto.randomUUID(), source_card: source.id, source_port: 'text', target_card: card.id, target_port: 'text' })
    }}>添加文本参考</Button>
    <Select<string> aria-label="添加媒体参考" placeholder="添加媒体参考" value={undefined} disabled={readonly} style={{ width: 150 }}
      options={inputPorts(card).filter(port => port !== 'text').map(port => ({ value: port, label: `新建${inputLabel(card, port)}内容卡` }))}
      onChange={targetPort => {
        if (!targetPort) return
        const sourcePort = ['first_frame', 'last_frame', 'key_frame', 'subject_image'].includes(targetPort) ? 'image' : targetPort === 'subject_video' ? 'video' : targetPort
        const source = { id: crypto.randomUUID(), type: `content.${sourcePort}`, type_version: 1, file_id: null, uploading: false }
        connectDocument({ ...latest.current, cards: [...(latest.current.cards || []), source] }, { id: crypto.randomUUID(), source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: targetPort })
      }} />
    </>}<Select<string> aria-label="连接已有卡" placeholder="选择已有卡" value={null} disabled={readonly} style={{ width: 160 }}
      options={cards.filter(source => compatibleOptions(source.id, card.id).length).map(source => ({ value: source.id, label: cardLabel(source.id) + (existingSource(source.id, card.id) ? ' · 已连接' : '') }))}
      onChange={sourceId => {
        const option = compatibleOptions(sourceId, card.id)[0]
        if (!option) return
        const sides = defaultSides(point(sourceId), point(card.id))
        submitConnection(option, sides.target, sides.source)
      }} />
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
          const reorderedEdges = edges.map(edge => edge.target_card === card.id && edge.target_port === name && edge.order_anchor
            ? { ...edge, order_anchor: undefined } : edge)
          edit({ ...document, edges: reorderedEdges, input_order: { ...document.input_order, [card.id]: { ...document.input_order?.[card.id], [name]: next } } })
        }}>↑</Button><Button size="small" disabled={readonly} aria-label={`断开连接 ${id}`} onClick={() => {
          removeEdge(edge)
        }}>断开</Button>
      </li>
    })}</ol></div>
  })}</>

  const point = (id: string) => layout.view.positions[id] || { x: 0, y: 0 }
  const { cardFrames, groupFrames } = generationVisibleFrames([...visibleCardIds, ...linkedResults.map(({ id }) => id)], viewGroups, point, cardSizes)
  const visibleFrames = [...cardFrames, ...groupFrames.values()]
  // 新卡和副本先挂载摘要测量，完成后在首次绘制前提交落点与可见性修正。
  useLayoutEffect(() => {
    if (!sizesReady || !layout.ready) return
    const creation = creationView.current
    if (creation && layout.view.positions[creation.cardId]) {
      creationView.current = undefined
      const box = container.current?.getBoundingClientRect()
      if (creation.autoPlace && box) {
        const { x: offsetX, y: offsetY, scale } = creation.transform
        const wide = box.width > 700
        const left = ((wide ? 120 : 88) - offsetX) / scale
        const top = ((wide ? 180 : 300) - offsetY) / scale
        const availableWidth = Math.max(320, (box.width - (wide ? 600 : 140)) / scale)
        const availableHeight = Math.max(250, (box.height - 320) / scale)
        const { width, height } = cardSizes[creation.cardId]
        const occupied = [...cardFrames.filter(frame => frame.id !== creation.cardId), ...groupFrames.values()]
        let position = { x: left, y: top }
        search: for (let y = top; y < top + availableHeight; y += 40) {
          for (let x = left; x < left + availableWidth; x += 40) {
            if (occupied.some(frame => x < frame.x + frame.width + 16 && x + width + 16 > frame.x && y < frame.y + frame.height + 16 && y + height + 16 > frame.y)) continue
            position = { x, y }
            break search
          }
        }
        layout.move(creation.cardId, position)
      }
      layout.setView(previous => ({ ...previous, transform: creation.transform }))
    }
    const paste = pastedView.current
    if (!paste || !paste.ids.every(id => layout.view.positions[id] && cardSizes[id])) return
    pastedView.current = undefined
    const box = viewport.surface.current?.getBoundingClientRect()
    if (!box) return
    const { x: offsetX, y: offsetY, scale } = paste.transform
    if (!paste.ids.every(id => {
      const position = point(id), size = cardSizes[id]
      const x = position.x * scale + offsetX, y = position.y * scale + offsetY
      return x >= box.width || y >= box.height || x + size.width * scale <= 0 || y + size.height * scale <= 0
    })) return
    const x = paste.origin.x * scale + offsetX, y = paste.origin.y * scale + offsetY
    layout.setView(previous => ({ ...previous, transform: { ...previous.transform,
      x: previous.transform.x + Math.max(16, Math.min(x, box.width - 80)) - x,
      y: previous.transform.y + Math.max(16, Math.min(y, box.height - 80)) - y } }))
  })
  /** 显式适应全部按实际可见卡片及悬浮导航留白计算，不改保存或生成依据。 */
  const fitVisibleCards = () => {
    if (movement.active) return
    const surface = viewport.surface.current
    if (!surface || !visibleFrames.length) { viewport.fit(); return }
    // Focus/scrollIntoView can scroll an overflow-hidden surface independently of the saved transform.
    surface.scrollTo(0, 0)
    const bounds = cardFrames.map(({ x, y, width, height }) => ({ left: x, top: y - 36, right: x + width, bottom: y + height }))
    // 分组标题高于成员卡；收起组也需参与适应范围，避免操作落在顶部导航后。
    const surfaceBox = surface.getBoundingClientRect()
    container.current?.querySelectorAll<HTMLElement>('[data-group-id], [data-stack-id]').forEach(group => {
      const box = group.getBoundingClientRect()
      const title = group.querySelector('.generation-group-header')?.getBoundingClientRect()
      bounds.push({ left: (box.left - surfaceBox.left - transform.x) / transform.scale, top: (Math.min(box.top, title?.top ?? box.top) - surfaceBox.top - transform.y) / transform.scale,
        right: (box.right - surfaceBox.left - transform.x) / transform.scale, bottom: (box.bottom - surfaceBox.top - transform.y) / transform.scale })
    })
    const left = Math.min(...bounds.map(box => box.left)), top = Math.min(...bounds.map(box => box.top))
    const width = Math.max(...bounds.map(box => box.right)) - left, height = Math.max(...bounds.map(box => box.bottom)) - top
    const surfaceTop = surface.getBoundingClientRect().top
    const browseBottom = container.current?.querySelector('.generation-browse')?.getBoundingClientRect().bottom || surfaceTop + 140
    const paddingTop = Math.max(80, browseBottom - surfaceTop + 24), paddingLeft = 80, paddingBottom = 80
    const availableWidth = Math.max(1, surface.clientWidth - paddingLeft - 24), availableHeight = Math.max(1, surface.clientHeight - paddingTop - paddingBottom)
    const scale = Math.min(1, availableWidth / Math.max(width, 1), availableHeight / Math.max(height, 1))
    layout.setView(previous => ({ ...previous, transform: { scale, x: paddingLeft + (availableWidth - width * scale) / 2 - left * scale, y: paddingTop + (availableHeight - height * scale) / 2 - top * scale } }))
  }

  const anchor = (id: string, side: ConnectionSide) => {
    const stack = stackFor(id), frame = stack && groupFrames.get(stack.id)
    return frame ? sidePoint(frame, frame.width, frame.height, side) : sidePoint(point(id), cardSizes[id]?.width || 400, cardSizes[id]?.height || 172, side)
  }
  const resultPath = (source: string, target: string, label: string, result: LinkedResult, adopted = false, edge?: GenerationEdge, lane = 0) => {
    const sides = defaultSides(point(source), point(target))
    const resultSource = edge ? result.output.source : undefined
    const selected = edge ? selectedEdgeId === edge.id && selectedResultSource?.port_id === resultSource?.port_id
      && selectedResultSource?.position === resultSource?.position : inspectedResult?.id === result.id
    return <g key={JSON.stringify([source, target, resultSource?.port_id, resultSource?.position])} data-generation-update-id={edge ? undefined : result.id}
      data-generation-edge-id={edge?.id} data-generation-result-port={resultSource?.port_id} data-generation-result-position={resultSource?.position}>
      <CanvasEdge d={connectionPath(anchor(source, sides.source), anchor(target, sides.target), sides.source, sides.target, lane)}
        label={label} selected={selected}
        onInspect={() => edge ? selectEdge(edge.id, undefined, resultSource) : selectEdge({ resultId: result.id })}
        className={adopted ? 'generation-edge-adopted' : 'generation-edge-candidate'} />
    </g>
  }
  const width = viewport.surface.current?.clientWidth || 1200, height = viewport.surface.current?.clientHeight || 800
  const visibleWorld = { x: -transform.x / transform.scale, y: -transform.y / transform.scale, width: width / transform.scale, height: height / transform.scale }
  const mapLeft = Math.min(0, visibleWorld.x, ...visibleFrames.map(frame => frame.x))
  const mapTop = Math.min(0, visibleWorld.y, ...visibleFrames.map(frame => frame.y))
  const mapWidth = Math.max(visibleWorld.x + visibleWorld.width, ...visibleFrames.map(frame => frame.x + frame.width)) - mapLeft
  const mapHeight = Math.max(visibleWorld.y + visibleWorld.height, ...visibleFrames.map(frame => frame.y + frame.height)) - mapTop
  const panMap = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const x = mapLeft + (event.clientX - box.left) / box.width * mapWidth
    const y = mapTop + (event.clientY - box.top) / box.height * mapHeight
    layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: width / 2 - x * previous.transform.scale, y: height / 2 - y * previous.transform.scale } }))
  }
  const [uploadText, setUploadText] = useState<string>()
  const [uploadLibrary, setUploadLibrary] = useState(false)
  const sourcePorts = (card: GenerationCard) => isReferenceDesign(card) ? inputPorts(card).filter(port => ['text', 'image', 'video', 'audio', ...(isFlatDesign(card) ? ['anchor', 'participant', 'effect_object', 'space', 'position_anchor', 'area_anchor', 'beat', 'received_event', 'change_event', 'trigger_event', 'dialogue_basis', 'acceptance_basis', 'covered_beat', 'related_event', 'blocking_basis', 'speaker', 'audio_example', 'video_example', 'image_example'] : [])].includes(port)) : capability(card)?.input_ports || []
  const modelSources = (card: GenerationCard) => <Dropdown trigger={['click']} placement="topRight" overlayStyle={{ minWidth: 200 }} disabled={readonly} menu={{ items: [
    { key: 'upload', label: '上传参考素材', children: [
      { key: 'upload:text', label: '上传文本参考', disabled: !sourcePorts(card).includes('text') },
      ...designMediaSourcePorts(sourcePorts(card)).map(port => ({ key: `upload:${port}`, label: `上传${inputLabel(card, port).replace(/素材$/, '')}素材` })),
    ] },
    { key: 'library', label: '从素材库添加', disabled: !designMediaSourcePorts(sourcePorts(card)).length, children: designMediaSourcePorts(sourcePorts(card)).map(port => ({ key: `library:${port}`, label: `选择${inputLabel(card, port).replace(/素材$/, '')}素材` })) },
    { key: 'canvas', label: '从当前画布选择' },
  ], onClick: ({ key: action }) => {
    if (readonly) return
    if (action === 'canvas') { setSourceTarget(card.id); return }
    const [mode, key] = action.split(':')
    if (key === 'text') {
      const source = { id: crypto.randomUUID(), type: 'content.text' as const, text: '' }
      if (connectDocument({ ...latest.current, cards: [...(latest.current.cards || []), source] }, { id: crypto.randomUUID(), source_card: source.id, source_port: 'text', target_card: card.id, target_port: 'text' }, capability(card))) setUploadText(source.id)
      return
    }
    setUploadLibrary(mode === 'library')
    const sourcePort = ['first_frame', 'last_frame', 'key_frame', 'subject_image'].includes(key) ? 'image' : key === 'subject_video' ? 'video' : key.replace(/_example$/, '')
    const source = { id: crypto.randomUUID(), type: `content.${sourcePort}`, type_version: 1, file_id: null, uploading: false } as MediaCard
    const next = { ...latest.current, cards: [...(latest.current.cards || []), source] }
    const edge = { id: crypto.randomUUID(), source_card: source.id, source_port: sourcePort, target_card: card.id, target_port: key }
    if (connectDocument(next, edge, capability(card))) setUploadSource(source.id)
  } }}><WorkbenchIconButton label={isReferenceDesign(card) ? '添加设计来源' : '添加模型来源'} icon={<PlusOutlined />} disabled={readonly} /></Dropdown>
  const resultSource = openedResult && cards.find(card => card.id === openedResult.output.source.card_id)
  const resultDetail = openedResult && openedResult.id === detailId && resultSource && 'show_result_cards' in resultSource
    && resultSource.show_result_cards && !hidden.has(resultSource.id)
    ? resultsById.get(openedResult.id) || openedResult : undefined
  const sourceTargetCard = cards.find(card => card.id === sourceTarget)
  const uploadTextCard = cards.find(card => card.id === uploadText) as TextContentCard | undefined
  const uploadSourceCard = cards.find(card => card.id === uploadSource) as MediaCard | undefined
  const renderEditor = (detailCard: GenerationCard) => {
      const source = sourceFocus?.cardId === detailCard.id ? sourceFocus : undefined
      const sourceStack = source && !!stackFor(detailCard.id)
      const detailReadonly = readonly || !!sourceStack
      const diagnostic = diagnosticTarget?.cardId === detailCard.id ? diagnosticTarget.diagnostic : undefined
      const control = diagnostic && diagnosticControl(detailCard, diagnostic)
      const relation = diagnostic && diagnosticAssociation(detailCard, diagnostic)
      const associationRequest = relation && !relation.unavailable && diagnosticTarget ? { serial: diagnosticTarget.serial, source: relation.source } : undefined
      const designDestination = diagnostic && diagnosticDesignField(detailCard, diagnostic, cardDefinitions[detailCard.type || '']?.fields || [])
      const targetField = designDestination
        ? designDestination.fieldId && diagnosticTarget ? { fieldId: designDestination.fieldId, segmentId: designDestination.segmentId, serial: diagnosticTarget.serial } : undefined
        : source?.fieldId ? { fieldId: source.fieldId, serial: source.serial } : designFieldTarget?.cardId === detailCard.id ? designFieldTarget : undefined
      const EditorContainer = CanvasCardEditor
      const DetailRenderer = rendererRegistry[detailCard.type || 'content.text']
      const observedTarget = detailCard.type === 'review.check'
        ? document.edges?.find(edge => edge.target_card === detailCard.id && edge.target_port === 'check_basis')?.source_card
        : undefined
      const observedNode = observedTarget && runtime?.nodes[observedTarget]
      const automaticCheckRunId = observedNode && observedNode.status === 'succeeded'
        && observedNode.automatic_check_card_ids?.includes(detailCard.id) ? observedNode.run_id : undefined
      // 新卡先完成测量和创建视口恢复，避免覆盖首次让位（尤其是减少动态效果模式）。
      const isCheck = detailCard.type === 'review.check'
      const longForm = isCheck || detailCard.type === 'direction.performance' || detailCard.type === 'direction.activity'
      const showEditorStatus = !(isCheck || isReferenceDesign(detailCard)) || !['修改尚未保存', '正在保存修改'].includes(editingStatus || '')
      return <AssociationInspectionContext.Provider key={detailCard.id} value={{
        request: associationRequest,
        onLocateFrameRelation: cardId => navigateInspection.current(cardId, { cardId, serial: Date.now(), diagnostic: { card_id: cardId, path: ['frame_target'] } }),
      }}><EditorContainer sourceFocus={source} diagnosticFocus={control?.selector && diagnosticTarget ? { selector: control.selector, serial: diagnosticTarget.serial } : undefined} editableTitle={isReferenceDesign(detailCard) && 'name' in detailCard} typeLabel={cardTitles[detailCard.type || 'content.text']} onReveal={revealEditor} suppressed={detailsSuppressed || creationView.current?.cardId === detailCard.id} cardType={detailCard.type} focusLayout={isDescriptionCard(detailCard) || detailCard.type?.startsWith('reference.') || detailCard.type?.startsWith('model.') || focusCardTypes.includes(detailCard.type || '')} modality={cardDefinitions[detailCard.type || '']?.modality} material={isDescriptionCard(detailCard) || detailCard.type?.startsWith('model.') || detailCard.type?.startsWith('reference.')} forceModal={sourceStack || isCheck || detailCard.type?.startsWith('direction.')} layoutAction={sourceStack ? undefined : layoutAction} longForm={longForm} key={detailCard.id} anchor={window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(detailCard.id)}"]`)} layoutKey={`${transform.x}:${transform.y}:${transform.scale}:${JSON.stringify(point(detailCard.id))}`} expandRequest={expandRequest?.id === detailCard.id ? expandRequest.serial : undefined} title={('name' in detailCard && detailCard.name) || cardTitles[detailCard.type || 'content.text'] || '卡片详情'} status={detailReadonly ? '只读' : showEditorStatus ? editingStatus : undefined} open={detailCard.id === detailId && (sourceStack || !stackFor(detailCard.id))} onClose={() => { setSourceFocus(current => current?.cardId === detailCard.id ? undefined : current); setDesignFieldTarget(undefined); setDetailId(current => current === detailCard.id ? undefined : current) }} trigger={detailTrigger}>
        {!sourceStack && !desktop && !isReferenceDesign(detailCard) && !isDescriptionCard(detailCard) && !detailCard.type?.startsWith('model.') && !detailCard.type?.startsWith('reference.') && !focusCardTypes.includes(detailCard.type || '') && detailCard.type !== 'review.check' && <Space wrap><Button onClick={() => setActiveCategory('基础卡')}>卡片</Button><Button disabled={readonly} onClick={event => startAccessibleConnection(detailCard.id, 'right', event.currentTarget)}>连接到…</Button></Space>}
        {!sourceStack && detailCard?.type?.startsWith('direction.') && !isReferenceDesign(detailCard) && <details className="generation-candidate-management"><summary>候选连接管理</summary>{references(detailCard)}</details>}
        {control?.action === '查看卡片' && <div role="status">无法定位原位置。问题所指的正文片段已不可用。</div>}
        {designDestination?.action === '查看卡片' && <div role="status">无法定位原位置。问题所指的设计字段、运镜阶段或引用已不可用。</div>}
        {/* 只读文本仍可聚焦选取；写入由正文readOnly和导入禁用保护。 */}
        {DetailRenderer && <ConfigProvider componentDisabled={detailReadonly}><fieldset disabled={detailReadonly && !(detailCard.type === 'review.check' || detailCard.type === 'content.text' || !!source && detailCard.type === 'content.basis' || detailCard.type?.startsWith('model.') || isReferenceDesign(detailCard))} className="generation-card-body" data-canvas-details={document.id} data-card-details={detailCard.id}><DesignReferenceBoundary onChange={updateCard} onDisconnect={id => { const edge = latest.current.edges?.find(item => item.id === id); if (edge) removeEdge(edge) }} onLocateDesign={(cardId, fieldId) => { setDesignFieldTarget({ cardId, fieldId, serial: Date.now() }); navigateInspection.current(cardId) }} targetField={targetField} card={detailCard} document={document} savedRevision={savedRevision} modelOutputs={runtime?.outputs} sourceActions={sourceStack ? undefined : modelSources(detailCard)} disabled={detailReadonly} editorOpen={detailId === detailCard.id}><DetailRenderer suppressAutomaticDefaults={!!diagnostic || !!source || detailCard.id !== detailId} requirementNameValidationRequested={invalidRequirementNames.has(detailCard.id)} onLocateDesign={(cardId, fieldId) => { setDesignFieldTarget({ cardId, fieldId, serial: Date.now() }); navigateInspection.current(cardId) }} onUndoDesign={history?.canUndo && !detailReadonly ? history.undo : undefined} editorOpen={detailId === detailCard.id} savedCard={savedDocument?.cards?.find(card => card.id === detailCard.id)} savedRevision={savedRevision} documentPending={!!editingStatus} key={detailCard.id} card={detailCard} document={document} projectId={document.project_id} onChange={updateCard} defaultModelId={document.storyboard?.origins[detailCard.id] ? undefined : detailCard.type === 'model.text' ? modelDefaults?.default_text_model_id : detailCard.type === 'model.image' ? modelDefaults?.default_image_model_id : modelDefaults?.default_video_model_id} models={models} capability={capability(detailCard)}
          automaticCheckRunId={automaticCheckRunId} capabilityError={'model_id' in detailCard && detailCard.model_id ? capabilityErrors[detailCard.model_id] : undefined} references={sourceStack ? undefined : references(detailCard)} disabled={detailReadonly} modelOutputs={runtime?.outputs} node={runtime?.nodes[detailCard.id]} busy={runtime?.busyCards.has(detailCard.id)} checking={runtime?.checking === detailCard.id} runDisabled={sourceStack || runtime?.disabled} onPrecheck={sourceStack ? undefined : () => runtime?.precheck(detailCard.id)} sourceActions={sourceStack ? undefined : modelSources(detailCard)} /></DesignReferenceBoundary></fieldset></ConfigProvider>}
      </EditorContainer></AssociationInspectionContext.Provider>
  }
  return <div className="generation-graph" ref={container} onContextMenu={event => {
    event.preventDefault()
    const target = event.target as Element
    if (movement.pointerActive || drag || accessibleConnection || surfaceGesture.selecting || surfaceGesture.pan || target.closest('input,textarea,[contenteditable],.generation-card-menu,[data-card-details],[role="dialog"],.generation-group,.generation-stack,.canvas-edge-hit,button:not([data-keyboard-move])')) return
    if (!viewport.surface.current?.contains(target)) return
    const id = target.closest<HTMLElement>('[data-card-id]')?.dataset.cardId
    const ids = id ? selected.includes(id) ? selected : [id] : []
    if (id) setSelected(ids)
    setCardMenuId(undefined); setActiveCategory(undefined)
    setContextMenu({ x: event.clientX, y: event.clientY, ids })
  }} onPointerDownCapture={event => {
    if(event.button===2)return
    const surface = viewport.surface.current
    if (surface) surface.dataset.keyboardFocus = 'false'
    if (surface?.contains(event.target as Node) && (event.button === 1 || spaceHeld && event.button === 0)) {
      event.preventDefault(); event.stopPropagation(); surface.focus({ preventScroll: true }); surface.setPointerCapture(event.pointerId)
      surfaceGesture.beginPan({ x: event.clientX, y: event.clientY }, event.pointerId, transform)
      surface.dataset.panning = 'true'; return
    }
    if (event.shiftKey || (event.target as Element).closest('.generation-surface')) return
    if (selected.length < 2 && !multiSelectMode) return
    const target = event.target as Element
    if (!event.currentTarget.contains(target)) return
    const modifier = navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey
    if (target.closest('.generation-selection-actions, .generation-browse') || modifier || multiSelectMode && target.closest('[data-card-id]')) return
    clearSelection()
  }}>
    {outputAction && <CanvasOutputActions {...outputAction} onCover={setCover} onClose={()=>setOutputAction(undefined)} />}
    {contextMenu && <CanvasContextMenu {...contextMenu} card={!!contextMenu.ids.length} catalog={catalog} onClose={() => { const target=contextMenu.ids[0] ? container.current?.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(contextMenu.ids[0])}"]`) : viewport.surface.current;setContextMenu(undefined);target?.focus({preventScroll:true}) }} actions={contextMenu.ids.length ? [
      {label:`复制${contextMenu.ids.length>1 ? ` ${contextMenu.ids.length} 张卡片` : ''}`,shortcut:`${navigator.platform.includes('Mac')?'⌘':'Ctrl'} C`,reason:copyReason(contextMenu.ids),run:()=>copyCards(contextMenu.ids)},
      {label:'复制副本',shortcut:`${navigator.platform.includes('Mac')?'⌘':'Ctrl'} D`,reason:readonly ? '当前只读' : copyReason(contextMenu.ids),run:()=>copyCards(contextMenu.ids,true)},
      {label:'设置为封面',reason:readonly ? '当前只读' : contextMenu.ids.length!==1 ? '请选择一张卡片' : !cardOutputs(contextMenu.ids).some(output=>output.modality==='image') ? '没有可用图片' : undefined,run:()=>openOutputAction('cover',contextMenu.ids)},
      {label:'下载',reason:!cardOutputs(contextMenu.ids).length ? '没有可下载输出' : undefined,run:()=>openOutputAction('download',contextMenu.ids)},
      {label:'删除',danger:true,reason:readonly ? '当前只读' : contextMenu.ids.some(id => fixedCanvasSource(document, id)) ? '固定原文不可删除' : undefined,run:()=>removeCards(contextMenu.ids)},
    ] : [
      {label:'新建节点', reason:readonly ? '当前只读' : undefined, run:()=>{}},
      {label:'粘贴', reason:readonly ? '当前只读' : !readCardClipboard(document.project_id) ? '剪贴板没有卡片' : undefined, run:()=>{const box=viewport.surface.current!.getBoundingClientRect();pasteCards(readCardClipboard(document.project_id),{x:(contextMenu.x-box.left-transform.x)/transform.scale,y:(contextMenu.y-box.top-transform.y)/transform.scale})}},
      {label:'撤销',reason:readonly ? '当前只读' : !history?.canUndo ? '没有可撤销操作' : undefined, run:()=>history?.undo()},
    ]} onAdd={(type, entry) => {
      const box=viewport.surface.current!.getBoundingClientRect()
      add(type,{x:(contextMenu.x-box.left-transform.x)/transform.scale,y:(contextMenu.y-box.top-transform.y)/transform.scale},entry,true)
      setContextMenu(undefined)
    }} />}
    <WorkbenchModal title="解除定位并断开？" open={!!pendingFrameDisconnect} onCancel={() => setPendingFrameDisconnect(undefined)} footer={<WorkbenchDialogActions secondary={<Button onClick={() => setPendingFrameDisconnect(undefined)}>取消</Button>}><Button variant="danger" onClick={() => { const edge = pendingFrameDisconnect; setPendingFrameDisconnect(undefined); if (edge) removeEdge(edge, true) }}>解除定位并断开</Button></WorkbenchDialogActions>}><p>当前构图使用此运镜画面定位，可通过撤销恢复。</p></WorkbenchModal>
    <WorkbenchModal title={`删除 ${pendingDeletion?.length || 0} 张卡片？`} open={!!pendingDeletion} width={480} onCancel={() => setPendingDeletion(undefined)} footer={<WorkbenchDialogActions secondary={<Button onClick={() => setPendingDeletion(undefined)}>取消</Button>}><Button variant="danger" onClick={() => { const ids = pendingDeletion; setPendingDeletion(undefined); if (ids) removeCards(ids, true) }}>确认删除</Button></WorkbenchDialogActions>}>
      相关连线将一并移除，可撤销恢复；已生成的媒体文件保留。
      {cards.some(card => card.type?.startsWith('model.') && pendingDeletion?.includes(card.id)) && <p>关联结果卡会随生成卡一并移除，已独立的内容卡按本次选择处理。</p>}
      {cards.filter(card => 'input_bindings' in card && card.input_bindings?.some(binding => binding.input_port === 'acceptance_basis' && pendingDeletion?.includes(binding.source.card_id)) && !pendingDeletion?.includes(card.id)).map(card => <p key={card.id}>将解除 {cardLabel(card.id)} 的验收关联，后续生成不再自动带入该要求。</p>)}
    </WorkbenchModal>
    <Modal title="堆叠内容（只读）" open={!!stacks.find(group => group.id === viewStackId)} onCancel={() => setViewStackId(undefined)} footer={null} width={1100} maskClosable destroyOnClose>
      <div className="generation-stack-reading" onClick={event => { if (event.target === event.currentTarget) setViewStackId(undefined) }}>
        {(stacks.find(group => group.id === viewStackId)?.card_ids || []).map(id => {
          const card = cards.find(item => item.id === id)!
          const file = 'file_id' in card ? card.file_id : 'image_binding' in card ? card.image_binding?.file_id : undefined
          const fields = 'fields' in card ? Object.values((card as CompositionCard).fields || {}) : []
          return <article key={id} data-filter-match={matched.has(id)} aria-description={matched.has(id) ? '符合筛选' : undefined} aria-label={`只读成员 ${cardLabel(id)}`}><h3>{cardLabel(id)}</h3>
            {'text' in card && <p>{card.text || '未填写正文'}</p>}
            {card.type?.startsWith('reference.') && <p>{(card as NamedImageReferenceCard).name} · {(card as NamedImageReferenceCard).angle || '正面'}</p>}
            {fields.map((field, index) => <p key={index}>{designSummary([field], [])}</p>)}
            {file && (card.type?.startsWith('reference.') || card.type === 'content.image' ? <Image alt="图片预览" src={buildFileDownloadUrl(file)} /> : <MediaPreview fileId={file} type={card.type?.split('.')[1] || 'image'} />)}
            {runtime?.outputs[id]?.filter(output => output.text).map(output => <p key={output.source.position}>{output.text}</p>)}
            {runtime?.outputs[id]?.filter(output => output.file_id).map(output => output.modality === 'image' ? <Image key={output.source.position} alt={`输出图片 ${output.source.position + 1}`} src={buildFileDownloadUrl(output.file_id!)} /> : <MediaPreview key={output.source.position} fileId={output.file_id!} type={output.modality} />)}
            {runtime?.nodes[id]?.text && runtime.nodes[id].status !== 'succeeded' && <p>{runtime.nodes[id].text}</p>}
          </article>
        })}
      </div>
    </Modal>
    <Modal title="选择画布来源" open={!!sourceTargetCard} onCancel={() => setSourceTarget(undefined)} footer={null}>
      <p>选择来源建立连接。候选用途在接收卡的关联区选择。</p>
      {sourceTargetCard && cards.filter(source => !stackFor(source.id)).flatMap(source => compatibleOptions(source.id, sourceTargetCard.id).slice(0, 1).map(option => <Button key={source.id} disabled={readonly} onClick={() => {
        const sides = defaultSides(point(option.source_card), point(option.target_card))
        submitConnection(option, sides.target, sides.source); setSourceTarget(undefined)
      }}>{cardLabel(source.id)} · {existingSource(source.id, sourceTargetCard.id) ? '已连接' : connectionPolicy(document, option)?.message}</Button>))}
    </Modal>
    <Modal title="上传文本参考" open={!!uploadTextCard} onCancel={() => setUploadText(undefined)} footer={null}>
      {uploadTextCard && <TextContentEditor card={uploadTextCard} disabled={readonly} onChange={next => edit({ ...latest.current, cards: (latest.current.cards || []).map(card => card.id === next.id ? next : card) })} />}
    </Modal>
    <Modal title={cards.some(card => card.id === detailId && isReferenceDesign(card)) ? "添加参考素材" : "上传模型来源"} open={!!uploadSourceCard} onCancel={() => setUploadSource(undefined)} footer={null}>
      {uploadSourceCard && <MediaContentEditor key={uploadSourceCard.id} initialLibrary={uploadLibrary} card={uploadSourceCard} projectId={document.project_id} disabled={readonly} onChange={next => {
        if ((latest.current.cards || []).some(card => card.id === next.id)) edit({ ...latest.current, cards: (latest.current.cards || []).map(card => card.id === next.id ? next : card) })
      }} />}
    </Modal>
    {connectionLayout.error && <span role="status">{connectionLayout.error}</span>}
    {accessibleConnection && <div ref={connectionMenu} role="dialog" aria-label="选择连接目标" className="generation-connection-menu generation-target-menu">
      <strong>选择连接目标</strong>
      <p>选择接收卡建立连接。候选用途在接收卡的关联区选择。</p>
      {cards.filter(card => card.id !== accessibleConnection.card && !hidden.has(card.id)).map(card => <Button key={card.id} data-connection-target={card.id} disabled={readonly} onClick={() => chooseAccessibleTarget(card.id)}>连接到{'name' in card && card.name || cardTitles[card.type || '']} · 卡片 {cards.indexOf(card) + 1}</Button>)}
      <Button onClick={cancelConnection}>取消连接</Button>
    </div>}

    <GenerationCanvasBrowse value={displayFilter} onChange={setDisplayFilter} />
    <CardList catalog={catalog} readonly={readonly} active={activeCategory} onActiveChange={category => { cancelConnection(); setActiveCategory(category) }} onAdd={(type, entry) => add(type, undefined, entry)} />
    <nav className="director-canvas-bottom generation-view-tools" aria-label="画布视图工具">
      <WorkbenchIconButton label="定位所选" variant="quiet" icon={<AimOutlined />} disabled={!selected.length} onClick={() => { const p = point(selected[0]); layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: (container.current?.clientWidth || 1200) / 2 - p.x * previous.transform.scale, y: (container.current?.clientHeight || 800) / 2 - p.y * previous.transform.scale } })) }} />
      <WorkbenchIconButton label="缩小" variant="quiet" icon={<MinusOutlined />} onClick={() => zoomAt(transform.scale - .1, (viewport.surface.current?.clientWidth || 0) / 2, (viewport.surface.current?.clientHeight || 0) / 2)} />
      <span aria-label="画布缩放比例">{Math.round(transform.scale * 100)}%</span>
      <WorkbenchIconButton label="放大" variant="quiet" icon={<PlusOutlined />} onClick={() => zoomAt(transform.scale + .1, (viewport.surface.current?.clientWidth || 0) / 2, (viewport.surface.current?.clientHeight || 0) / 2)} />
      <Button variant="quiet" onClick={fitVisibleCards}>适应全部</Button>
      {document.storyboard && <StoryboardReferences document={document} readonly={readonly}
        setDefault={(reference, image) => {
          const current = latest.current
          const result = updateStoryboardReference(current, {
            ...reference, image_binding: image ? storyboardImageBinding(current, image) : null,
          }, operations, capability, true)
          if (result.document) edit(result.document)
          return result.reason
        }}
        setOverride={(shotId, objectId, image) => {
          const result = chooseStoryboardOverride(latest.current, shotId, objectId, image, operations, capability)
          if (result.document) edit(result.document)
          return result.reason
        }} />}
      <CanvasToolbarMenu label="布局" caption="布局">
        <Button disabled={arrangementBlocked} onClick={arrangeLayout}>整理布局</Button>
        <Button disabled={!layout.canUndo} onClick={layout.undo}>撤销布局整理</Button>
        <Button aria-label={minimapOpen ? '收起小地图' : '展开小地图'} aria-expanded={minimapOpen} onClick={() => setMinimapOpen(value => !value)}>{minimapOpen ? '收起小地图' : '展开小地图'}</Button>
        <Button aria-label="框选" variant="quiet" aria-pressed={selecting} onClick={() => setSelecting(value => !value)}>框选</Button>
        <Select aria-label="选择连线" placeholder="选择连线" value={inspectedEdge?.id} allowClear showSearch optionFilterProp="label" style={{ width: '100%' }}
          options={visibleSourceEdges(document).map(edge => ({ value: edge.id, label: edgeLabel(edge) }))} onChange={id => selectEdge(id)} />
      </CanvasToolbarMenu>
    </nav>
    {(inspectedEdge || inspectedResult) && <section className="generation-edge-inspector" aria-label="所选连接" style={{ left: Math.max(20, Math.min(edgeActionPoint?.x ?? 40, (container.current?.clientWidth || window.innerWidth) - 20)), top: Math.max(20, Math.min(edgeActionPoint?.y ?? 40, (container.current?.clientHeight || window.innerHeight) - 20)) }} onPointerDown={event => event.stopPropagation()}>
      <Tooltip trigger={['hover', 'focus']} title={<span className="generation-edge-hint">
        {inspectedResult ? <><strong>断开后保留当前结果为独立内容卡</strong><span>{inspectedResult.output.available === false ? '当前输出缺失' : '保留下游连接及引用'}</span></>
          : inspectedEdge && <><strong>{edgePurpose(inspectedEdge, selectedResultSource)}</strong><span>{cardLabel(inspectedEdge.source_card)} → {cardLabel(inspectedEdge.target_card)}{readonly ? ' · 只读，无法删除' : ''}</span></>}
      </span>}>
        <span><Button aria-label="断开此连接" disabled={readonly || detaching || inspectedResult?.output.available === false || (!!selectedResultSource && !inspectedResultEdge)}
          icon={<ScissorOutlined style={{ fontSize: 'calc(var(--wb-icon) * 1.5)' }} />} variant="quiet"
          onClick={() => {
            if (inspectedResult) void detachResult(inspectedResult)
            else if (inspectedResultEdge && selectedResultSource) removeEdge(inspectedResultEdge, false, selectedResultSource.position)
            else if (inspectedEdge && !selectedResultSource) removeEdge(inspectedEdge)
          }} /></span>
      </Tooltip>
    </section>}
    {(selected.length > 1 || multiSelectMode) && <div className="generation-selection-actions" role="toolbar" aria-label="所选卡片操作" style={(() => {
      const chosen = selected.map(point)
      const left = (chosen.length ? Math.min(...chosen.map(item => item.x)) : 0) * transform.scale + transform.x
      const top = (chosen.length ? Math.min(...chosen.map(item => item.y)) : 0) * transform.scale + transform.y - 16
      return { left: Math.max(12, Math.min(left, width - 300)), top: Math.max(160, top), transform: 'translateY(-100%)' }
    })()}>
      <span>{selected.length} 张卡片</span>
      <Button disabled={readonly || selected.length < 2 || selected.some(id => resultsById.has(id))} onClick={() => {
        if (selected.some(id => groups.some(group => group.card_ids?.includes(id)))) { setReason('请先解除已有编组或堆叠，再重新选择'); return }
        edit({ ...document, groups: [...groups, { id: crypto.randomUUID(), name: '新堆叠', kind: 'stack', card_ids: selected, collapsed: false }] }); clearSelection()
      }}>堆叠</Button>
      <Button disabled={readonly || selected.length < 2 || selected.some(id => resultsById.has(id))} onClick={() => {
        if (selected.some(id => groups.some(group => group.card_ids?.includes(id)))) { setReason('请先解除已有编组，再重新选择'); return }
        edit({ ...document, groups: [...groups, { id: crypto.randomUUID(), name: '新编组', card_ids: selected, collapsed: false }] }); clearSelection()
      }}>编组</Button>
      {multiSelectMode && <><Button onClick={() => setMultiSelectMode(false)}>完成选择</Button><Button onClick={clearSelection}>退出多选</Button></>}
    </div>}
    <div className="canvas-bottom-right generation-bottom-right">
      {(reason || storageError) && <div role="status" className="canvas-status-host">{storageError ? `布局本地保存失败：${storageError}` : reason}</div>}
      {contentHistory}
    </div>
    <div ref={viewport.surface} {...viewport.surfaceProps} className={`generation-surface${spaceHeld ? ' generation-surface-pan-ready' : ''}`} aria-label="生成画布视口"
      onDragOver={event => { if (!readonly && event.dataTransfer.types.includes(cardDragType)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
      onDrop={event => {
        if (readonly || !event.dataTransfer.types.includes(cardDragType)) return
        event.preventDefault()
        const box = event.currentTarget.getBoundingClientRect()
        add(event.dataTransfer.getData(cardDragType), { x: (event.clientX - box.left - transform.x) / transform.scale, y: (event.clientY - box.top - transform.y) / transform.scale }, event.dataTransfer.getData(cardDragEntry) || undefined)
      }}
      onPointerOver={event => { blankPointer.current = !(event.target as Element).closest('[data-card-id], button, input, select, textarea, audio, video') }}
      onPointerLeave={() => { blankPointer.current = false }}
      onPointerDown={event => {
        // Portal 菜单属于编辑操作，不是画布空白手势。
        if (!event.currentTarget.contains(event.target as Node)) return
        // 空白画布接收焦点，释放连接点的焦点圈与提示；Escape 仍返回连接起点。
        if (event.button === 0 && !(event.target as Element).closest('[data-card-id], .generation-group, button, input, select, textarea, audio, video, .canvas-edge-hit')) {
          if (drag || accessibleConnection) cancelConnection()
          event.currentTarget.focus({ preventScroll: true })
        }
        if (spaceHeld && event.button === 0 && event.currentTarget.contains(event.target as Node)
          && !(event.target as Element).closest('[data-card-id], button, input, select, textarea, audio, video')) {
          event.preventDefault(); event.currentTarget.focus({ preventScroll: true }); event.currentTarget.setPointerCapture(event.pointerId)
          surfaceGesture.beginPan({ x: event.clientX, y: event.clientY }, event.pointerId, transform, false)
          event.currentTarget.dataset.panning = 'true'
          return
        }
        if (event.button === 0 && !(event.target as Element).closest('[data-card-id], .generation-group, button, input, select, textarea, .canvas-edge-hit')) surfaceGesture.blankDown({ x: event.clientX, y: event.clientY })
        if (event.button === 0 && event.currentTarget.contains(event.target as Node)
          && !(event.target as Element).closest('[data-card-id], button, input, select, textarea, .canvas-edge-hit')) {
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId)
          const box = event.currentTarget.getBoundingClientRect()
          surfaceGesture.beginSelection({ x: event.clientX, y: event.clientY }, { x: box.left, y: box.top })
        } else viewport.surfaceProps.onPointerDown?.(event)
      }}
      onPointerMove={event => {
        if (!surfaceGesture.pan && !surfaceGesture.selecting) { viewport.surfaceProps.onPointerMove?.(event); return }
        const box = event.currentTarget.getBoundingClientRect()
        const next = surfaceGesture.move({ x: event.clientX, y: event.clientY }, { x: box.left, y: box.top })
        if (next) layout.setView(previous => ({ ...previous, transform: { ...previous.transform, ...next } }))
      }}
      onPointerUp={event => {
        const cards = surfaceGesture.selecting ? [...event.currentTarget.querySelectorAll<HTMLElement>('[data-card-id]')].map(card => { const { left, right, top, bottom } = card.getBoundingClientRect(); return { id: card.dataset.cardId!, left, right, top, bottom } }) : []
        const result = surfaceGesture.finish({ x: event.clientX, y: event.clientY }, cards)
        if (result.clear) clearSelection()
        else if (result.ids) { const ids = result.ids; setSelected(previous => event.shiftKey ? [...new Set([...previous, ...ids])] : ids); setDetailId(undefined); setSelectedEdgeId(undefined) }
        delete event.currentTarget.dataset.panning
        viewport.surfaceProps.onPointerUp?.(event)
      }}
      onPointerCancel={event => { surfaceGesture.interrupt(); delete event.currentTarget.dataset.panning; viewport.surfaceProps.onPointerCancel?.(event) }}
      onLostPointerCapture={event => { surfaceGesture.interrupt(); delete event.currentTarget.dataset.panning; viewport.surfaceProps.onLostPointerCapture?.(event) }}>

      {selectionBox && <div className="generation-selection-box" aria-hidden="true" style={{ left: selectionBox.x, top: selectionBox.y, width: selectionBox.width, height: selectionBox.height }} />}
      <div className="generation-world" style={{ visibility: sizesReady ? undefined : 'hidden', transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`, '--generation-canvas-scale': transform.scale } as CSSProperties}>
        <svg className="generation-edges" width={12000} height={12000}>
          {linkedResults.map(result => resultPath(result.output.source.card_id, result.id, '随生成更新 · ' + linkedResultTitle(result.output), result))}
          {projectedConnections.map(({ edge, results, projected, direct }) => {
            if (projected) return [...results, ...direct.map(output => ({ id: edge.source_card, output }))].map((result, index) => {
              const adopted = sourceConnectionEdges(document, edge).some(member =>
                member.source_port === result.output.source.port_id && resultScopeIncludes(member.result_scope, result.output.source.position) && edgeAdoptions(member, result.output.source.position) > 0)
              const modelPath = index >= results.length
              const label = modelPath ? '模型输出候选' : '结果候选连接'
              const lane = modelPath ? (index - results.length - (direct.length - 1) / 2) * 36 : 0
              return resultPath(result.id, edge.target_card, `${label} · ${linkedResultTitle(result.output)} → ${cardLabel(edge.target_card)}`, result, adopted, edge, lane)
            })
            const sides = connectionLayout.sides[edge.id] || defaultSides(point(edge.source_card), point(edge.target_card))
            const from = anchor(edge.source_card, sides.source), to = anchor(edge.target_card, sides.target)
            const adopted = sourceConnectionEdges(document, edge).some(member => edgeAdoptions(member) > 0)
            const parallel = cards.find(card => card.id === edge.source_card)?.type?.startsWith('direction.') ? [edge] : edges.filter(item => item.source_card === edge.source_card && item.target_card === edge.target_card)
            const lane = (parallel.findIndex(item => item.id === edge.id) - (parallel.length - 1) / 2) * 36
            const active = selectedEdgeId ? selectedEdgeId === edge.id : hoveredEdgeId === edge.id || selected.includes(edge.source_card) || selected.includes(edge.target_card)
            return <g key={edge.id} data-generation-edge-id={edge.id} data-edge-active={active} onFocus={() => setHoveredEdgeId(edge.id)} onBlur={() => setHoveredEdgeId(undefined)} onClick={event => {
              const bounds = container.current?.getBoundingClientRect()
              if (bounds) selectEdge(edge.id, { x: event.clientX - bounds.left, y: event.clientY - bounds.top })
            }} onMouseEnter={() => setHoveredEdgeId(edge.id)} onMouseLeave={() => setHoveredEdgeId(undefined)}>
              <CanvasEdge selected={selectedEdgeId === edge.id} d={connectionPath(from, to, sides.source, sides.target, lane)} className={adopted ? 'generation-edge-adopted' : 'generation-edge-candidate'}
                label={edgeLabel(edge)} onInspect={() => selectEdge(edge.id)}
                caption={active ? { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 + lane * .75 - 12, text: edgePurpose(edge) } : undefined} />
            </g>
          })}
        </svg>
        {stacks.map(group => {
          const members = group.card_ids || []
          const frame = groupFrames.get(group.id)
          if (!frame) return null
          const cover = cards.find(card => card.id === members[0])!
          const coverImage = 'image_binding' in cover ? cover.image_binding?.file_id : cover.type === 'content.image' && 'file_id' in cover ? cover.file_id : runtime?.outputs[cover.id]?.find(output => output.modality === 'image')?.file_id
          const coverText = 'text' in cover ? cover.text : runtime?.outputs[cover.id]?.find(output => output.text)?.text
          return <section key={group.id} data-stack-id={group.id} data-filter-match={members.some(id => matched.has(id))} className="generation-stack" tabIndex={0} role="button" aria-label={`查看堆叠 ${group.name}`} style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
            onClick={event => { if ((event.target as Element).closest('button')) return; event.stopPropagation(); if (!stackMoved.current) { clearSelection(); setViewStackId(group.id) } stackMoved.current = false }}
            onKeyDown={event => { if (!event.defaultPrevented && !event.nativeEvent.isComposing && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); clearSelection(); setViewStackId(group.id) } }}
            onPointerDown={event => {
              if (event.button !== 0 || (event.target as Element).closest('button')) return
              event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
              stackMoved.current = false
              groupDrag.current = {pointer:event.pointerId,x:event.clientX,y:event.clientY,transform,positions:Object.fromEntries(members.map(id => [id,point(id)]))}
            }} onPointerMove={event => {
              const current=groupDrag.current
              if (!current || current.pointer!==event.pointerId) return
              event.stopPropagation()
              if (Math.hypot(event.clientX-current.x,event.clientY-current.y)<6) return
              moveGroupDrag(event.clientX, event.clientY)
            }} onPointerUp={event => {
              const current=groupDrag.current; groupDrag.current=undefined; event.stopPropagation()
              stackMoved.current = !!current && Math.hypot(event.clientX-current.x,event.clientY-current.y)>=6
              finishMove()
            }} onPointerCancel={() => { groupDrag.current = undefined; finishMove() }} onLostPointerCapture={() => { if (groupDrag.current) { groupDrag.current = undefined; finishMove() } }}>
            <div className="generation-stack-actions"><span>{members.length} 张卡片{filterActive && ` · 匹配 ${members.filter(id => matched.has(id)).length}`}</span><Button disabled={readonly} onClick={event => {
              event.stopPropagation(); edit({...document,groups:groups.filter(item=>item.id!==group.id)});setViewStackId(undefined);setSelected(members);setSelectedEdgeId(undefined);setDetailId(undefined)
            }}>解除堆叠</Button></div>
            <div className="generation-stack-face"><strong>{group.name}</strong><p>{cardLabel(members[0])}</p>{coverImage && <img alt="堆叠封面" src={buildFileDownloadUrl(coverImage)} />}{coverText && <p className="canvas-card-summary">{coverText}</p>}<span>{filterActive ? `匹配 ${members.filter(id => matched.has(id)).length}／${members.length}` : members.length}</span></div>
          </section>
        })}
        {viewGroups.filter(group => group.kind !== 'stack').map(group => {
          const members = (group.card_ids || []).filter(id => cards.some(card => card.id === id))
          const origin = groupFrames.get(group.id)!
          const { width, height } = origin
          return <section key={group.id} data-group-id={group.id} tabIndex={-1} className="generation-group" data-selected={selectedGroupId === group.id} onPointerDown={event => {
            if (!event.currentTarget.contains(event.target as Node)) return
            if (event.button !== 0 || (event.target as Element).closest('button, input, select, [role="combobox"], [data-card-id]')) return
            const modifier = navigator.platform.includes('Mac') ? event.metaKey : event.ctrlKey
            if (spaceHeld || modifier) return
            event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId)
            groupDrag.current = { pointer: event.pointerId, x: event.clientX, y: event.clientY, transform, positions: Object.fromEntries(members.map(id => [id, point(id)])) }
          }} onPointerMove={event => {
            const current = groupDrag.current
            if (!current || current.pointer !== event.pointerId) return
            event.stopPropagation()
            moveGroupDrag(event.clientX, event.clientY)
          }} onPointerUp={event => {
            const current = groupDrag.current
            if (current) {
              event.stopPropagation(); groupDrag.current = undefined
              if (Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6) selectGroup(group.id)
              finishMove()
            }
          }} onPointerCancel={() => { groupDrag.current = undefined; finishMove() }} onLostPointerCapture={() => { if (groupDrag.current) { groupDrag.current = undefined; finishMove() } }} style={{ left: origin.x, top: origin.y, width, height, '--generation-group-controls-scale': 1 / Math.min(transform.scale, 1) } as CSSProperties}>
            <div className="generation-group-header">
              <button type="button" className="generation-group-title" aria-label={`选择编组 ${group.name}`} aria-pressed={selectedGroupId === group.id} onClick={() => selectGroup(group.id)}><GroupOutlined aria-hidden /><span>{group.name}</span></button>
              {selectedGroupId === group.id && <div className="generation-group-actions" onLostPointerCaptureCapture={() => finishMove()} onPointerCancelCapture={() => finishMove()} onPointerDownCapture={event => { if ((event.target as Element).closest('.generation-group-move')) { setCardMenuId(undefined); movement.begin(members, true) } }} onPointerUpCapture={() => finishMove()} role="toolbar" aria-label={`编组操作 ${group.name}`}>
                <CanvasDragHandle onCancel={() => finishMove(true)} className="generation-group-move" contextKey={document.id} label={`分组 ${group.name}`} offset={origin} scale={transform.scale} onMove={next => {
                  movement.moveHandle(members, next, origin)
                }} />
                <Dropdown trigger={['click']} placement="topLeft" dropdownRender={menu => <div onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>{menu}</div>} menu={{ items: [
                  { key: 'name', label: '重命名', disabled: readonly },
                  { key: 'members', label: '管理成员', disabled: readonly },
                  ...(group.collapsed ? [{ key: 'expand', label: '展开组', disabled: readonly }] : []),
                  { key: 'remove', label: '解散组', disabled: readonly },
                ], onClick: ({ key }) => {
                  if (key === 'remove') { edit({ ...document, groups: groups.filter(item => item.id !== group.id) }); clearSelection() }
                  else if (key === 'expand') edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, collapsed: false } : item) })
                  else setGroupPanel(key as 'name' | 'members')
                } }}><Button aria-label="管理编组" title="管理编组" className="wb-icon-action" icon={<MoreOutlined />} /></Dropdown>
                {groupPanel && <div className="generation-group-management">
                  {groupPanel === 'name' ? <Input autoFocus aria-label="分组名称" value={group.name} disabled={readonly} onChange={event => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, name: event.target.value } : item) })} />
                    : <Select aria-label={`分组成员 ${group.name}`} mode="multiple" value={members} disabled={readonly}
                      options={cards.filter(card => members.includes(card.id) || !groups.some(item => item.card_ids?.includes(card.id))).map(card => ({ value: card.id, label: `${cardTitles[card.type || '']} ${card.id.slice(0, 4)}` }))}
                      onChange={ids => edit({ ...document, groups: groups.map(item => item.id === group.id ? { ...item, card_ids: ids } : item) })} />}
                  <WorkbenchIconButton label="完成编组管理" icon={<CloseOutlined />} onClick={event => { setGroupPanel(undefined); event.currentTarget.closest('.generation-group-actions')?.querySelector<HTMLButtonElement>('button[aria-label="管理编组"]')?.focus() }} />
                </div>}
              </div>}
            </div>
            {group.collapsed && <span>{members.length} 张独立卡片 · 无集合输出</span>}
          </section>
        })}
        {linkedResults.map(result => {
          const { id, output } = result
          const title = linkedResultTitle(output)
          const openResult = (trigger: HTMLElement) => {
            setMultiSelectMode(false); setSelected([id]); setSelectedEdgeId(undefined)
            setOpenedResult({ id, output: { source: output.source, modality: output.modality, available: false } })
            setDetailTrigger(trigger); setDetailId(id)
          }
          const issue: CanvasDiagnostic | undefined = output.available === false
            ? { code: 'RESULT_UNAVAILABLE', message: '当前输出缺失', severity: 'error', target: output.source, blocks: [] }
            : output.basis_current === false
              ? { code: 'RESULT_BASIS_CHANGED', message: '此产物的生成依据已变', severity: 'warning', target: output.source, blocks: [] }
              : undefined
          return <CardShell key={id} id={id} type={`result.${output.modality}`} title={title} label={title} contextKey={document.id}
            menu={cardMenuId === id} onMenuChange={open => setCardMenuId(open ? id : undefined)}
            onContextActions={trigger => openCardContext(id, trigger)} readonly={readonly}
            point={point(id)} scale={transform.scale} viewportOffset={transform}
            width={cardSizes[id].width} height={cardSizes[id].height} selected={selected.includes(id)}
            issueIndicator={issue && <CardIssueIndicator issues={[issue]} actionFor={() => '查看产物'} onLocate={(_, trigger) => openResult(trigger)} />}
            onOpen={openResult}
            onSelect={checked => { setDetailId(undefined); setSelectedEdgeId(undefined); setSelected(previous => checked ? [...new Set([...previous, id])] : previous.filter(value => value !== id)) }}
            multiSelectMode={multiSelectMode} onDragStart={() => beginMove(id, true)} onDragEnd={finishMove}
            onMove={position => { if (!accessibleConnection) moveCards(id, position) }} connections={geometricPorts(cards.find(card => card.id === output.source.card_id)!, result)}>
            <LinkedResultPreview output={output} />
          </CardShell>
        })}
        {cards.map(card => {
          const showCard = isCardVisible(card.id)
          // 隐藏的检查卡仍保留会话，接收自动检查事件。
          if (!showCard && card.type !== 'review.check') return null
          const size = cardSizes[card.id]
          const designSizing = designHeightBands(card.type) ? designSizes.sizing(card.id) : undefined
          const isReference = card.type?.startsWith('reference.')
          const isDescription = isDescriptionCard(card)
          const isTextContent = card.type === 'content.text' || card.type === 'content.basis'
          const playbackType = card.type === 'content.audio' ? 'audio' : card.type === 'content.video' ? 'video' : undefined
          const playbackFile = playbackType && 'file_id' in card ? card.file_id ?? undefined : undefined
          const outputs = runtime?.outputs[card.id] || []
          const node = runtime?.nodes[card.id]
          const isModel = card.type?.startsWith('model.')
          const visualDesign = isReferenceDesign(card)
          const issues = (diagnostics || []).filter(issue => issue.target.card_id === card.id)
          const hasNameIssue = issues.some(issue => Array.isArray(issue.target.path) && issue.target.path.length === 1 && issue.target.path[0] === 'name')
          const requiresName = invalidRequirementNames.has(card.id) && card.type === 'direction.criterion' && (!('name' in card) || !card.name?.trim())
          if (!hasNameIssue && (requiresName || duplicateDesignName(card, cards))) {
            issues.push({ code: 'DESIGN_NAME', message: requiresName ? '请先填写验收要求名称' : '该名称已被同类型卡片使用，请使用其他名称', target: { card_id: card.id, path: ['name'] }, blocks: [] })
          }
          const openCheck = (trigger: HTMLElement) => { setSelected([card.id]); setSelectedEdgeId(undefined); setDetailTrigger(trigger); setDetailId(card.id) }
          const cardNode = !showCard ? null : <CardShell menu={cardMenuId === card.id} onMenuChange={open => setCardMenuId(open ? card.id : undefined)} onContextActions={trigger => openCardContext(card.id, trigger)} key={`${document.id}:${card.id}`} id={card.id} type={card.type} name={'name' in card ? card.name : undefined} title={cardTitles[card.type || 'content.text']} contextKey={document.id} point={point(card.id)}
            issueIndicator={card.type === 'review.check' ? <CheckCardIssues diagnostics={issues} onOpen={openCheck} /> : issues.length > 0 && <CardIssueIndicator issues={issues} actionFor={issue => diagnosticCardAction(card, issue.target, cardDefinitions[card.type || '']?.fields || [])}
              relatedActionsFor={issue => diagnosticRelatedCards(issue.target).map((id, index) => {
                const related = cards.find(item => item.id === id)
                return related ? { id, label: `定位 ${('name' in related && related.name?.trim()) || cardTitles[related.type || ''] || '相关卡片'}`, target: { card_id: id, path: [] } }
                  : { id, label: `相关卡片 ${index + 1} 已不可用` }
              })} onLocate={(issue, trigger, diagnostic = issue.target) => {
                const cardId = typeof diagnostic.card_id === 'string' ? diagnostic.card_id : card.id
                setDetailTrigger(trigger); navigateInspection.current(cardId, { cardId, serial: Date.now(), diagnostic })
              }} />} viewportOffset={transform} scale={transform.scale} width={size.width} height={size.height} selected={selected.includes(card.id)} filterMatch={matched.has(card.id)} readonly={readonly} removeDisabled={!!fixedCanvasSource(document, card.id) || runtime?.busyCards.has(card.id)}
            onExpand={trigger => { setSourceFocus(undefined); setDetailTrigger(trigger); setDetailId(card.id); setExpandRequest({id:card.id,serial:Date.now()}) }}
            onOpen={trigger => { if (accessibleConnection) chooseAccessibleTarget(card.id); else { setSourceFocus(undefined); setMultiSelectMode(false); setSelected([card.id]); setSelectedEdgeId(undefined); setDetailTrigger(trigger); setDetailId(card.id) } }} onSelect={checked => { setDetailId(undefined); setSelectedEdgeId(undefined); setSelected(previous => checked ? [...new Set([...previous, card.id])] : previous.filter(id => id !== card.id)) }}
            multiSelectMode={multiSelectMode} onStartMultiSelect={() => { setMultiSelectMode(true); setSelected([card.id]); setDetailId(undefined); setSelectedEdgeId(undefined) }} onDragStart={() => { setCardMenuId(undefined); beginMove(card.id, true) }} onDragEnd={finishMove}
            onConnect={card.type === 'review.check' ? undefined : trigger => startAccessibleConnection(card.id, 'right', trigger)} onMove={position => { if (!accessibleConnection) moveCards(card.id, position) }} onRemove={() => removeCard(card.id)} connections={geometricPorts(card)}
            sourceControl={sourceItems[card.id]?.length ? <CanvasSourcePopover items={sourceItems[card.id]} onLocate={locateSource} /> : undefined}
            footer={card.type === 'review.check' || isModel || isReference || isDescription || visualDesign && (!readonly || designSizing) || card.type === 'content.image' || isTextContent || playbackType ? undefined : <CardStatusSummary card={card} node={node} outputs={outputs} readonly={readonly} missingImage={false} />}>

            {card.type === 'review.check' && <CheckCardFace onOpen={openCheck} />}
            {isTextContent && <TextCardPreview label="正文预览" text={'text' in card && card.text || '未填写正文'}
              status={<CardStatusSummary card={card} outputs={[]} readonly={readonly} missingImage={false} />} />}
            {playbackType && <PlaybackCardPreview key={playbackFile} type={playbackType} fileId={playbackFile} label="媒体预览"
              status={<>{playbackFile && <span>固定媒体</span>}<CardStatusSummary card={card} outputs={[]} readonly={readonly} missingImage={false} /></>} />}
            {!isModel && !isReference && !isDescription && !isTextContent && !playbackType && card.type !== 'review.check' && <>            {card.type === 'content.image' ? <ImageContentCardSummary card={card as ImageContentCard} readonly={readonly} /> : isVisualDesign(card) ? <VisualDesignCard card={card} document={document} outputs={summaryOutputs} sizing={designSizing} /> : isFlatDesign(card) ? <FlatDesignCardBody card={card} document={document} outputs={summaryOutputs} sizing={designSizing} /> : <p className="canvas-card-summary">{['direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment'].includes(card.type || '') ? spatialSummary(card as SpatialCard) : card.type?.startsWith('direction.') ? performanceSummary(card as PerformanceCard)  : 'text' in card ? card.text || '未填写正文' : 'model_id' in card ? '尚未生成' : 'file_id' in card && card.file_id ? '固定媒体' : '未选择媒体'}</p>}
              {card.type !== 'content.image' && 'file_id' in card && card.file_id && <MediaPreview fileId={card.file_id} type={card.type?.split('.')[1] || 'image'} />}
            </>}
            {isDescription && <DescriptionCard card={card} readonly={readonly} />}
            {isReference && <ReferenceCard card={card as NamedImageReferenceCard} readonly={readonly} error={referenceNameError(card as NamedImageReferenceCard, cards)} />}
            {isModel && <ModelGenerationCard card={card} node={node} outputs={outputs} readonly={readonly} />}
          </CardShell>
          if (card.type !== 'review.check') return cardNode
          const observedTarget = edges.find(edge => edge.target_card === card.id && edge.target_port === 'check_basis')?.source_card
          const observedNode = observedTarget ? runtime?.nodes[observedTarget] : undefined
          return <CheckCardSession key={`${document.id}:${card.id}`} card={card} document={document} projectId={document.project_id}
            onChange={updateCard} savedCard={savedDocument?.cards?.find(row => row.id === card.id)} savedRevision={savedRevision}
            documentPending={!!editingStatus} disabled={readonly} editorOpen={detailId === card.id} models={models} modelOutputs={runtime?.outputs}
            reportTarget={diagnosticTarget?.cardId === card.id ? diagnosticTarget : undefined}
            onLocateDesign={(cardId, fieldId) => { setDesignFieldTarget({ cardId, fieldId, serial: Date.now() }); navigateInspection.current(cardId) }}
            automaticCheckRunId={observedNode?.status === 'succeeded' && observedNode.automatic_check_card_ids?.includes(card.id) ? observedNode.run_id : undefined}>
            {cardNode}{renderEditor(card)}
          </CheckCardSession>
        })}
      </div>
      {drag && <svg className="generation-temporary-connection" aria-label="正在连接候选" width="100%" height="100%"><path d={(() => {
        const origin = anchor(drag.card, drag.side), rect = viewport.surface.current?.getBoundingClientRect()
        const from = { x: origin.x * transform.scale + transform.x, y: origin.y * transform.scale + transform.y }
        const target = connectionPointAt(drag.x, drag.y)
        const targetCard = target?.dataset.card, side = target?.dataset.connectionSide as ConnectionSide | undefined
        const snapped = targetCard && side && compatibleOptions(drag.card, targetCard).length ? anchor(targetCard, side) : undefined
        const to = snapped ? { x: snapped.x * transform.scale + transform.x, y: snapped.y * transform.scale + transform.y } : { x: drag.x - (rect?.left || 0), y: drag.y - (rect?.top || 0) }
        return connectionPath(from, to, drag.side, side)
      })()} fill="none" stroke="var(--wb-focus)" strokeWidth="2" markerEnd="url(#generation-preview-arrow)" /><defs><marker id="generation-preview-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L10 5 L0 10 Z" fill="var(--wb-focus)" /></marker></defs></svg>}

    </div>
    {minimapOpen && <WorkbenchIconButton className="director-minimap-toggle director-minimap-toggle-open" label="关闭小地图" variant="quiet" icon={<CloseOutlined />} onClick={() => setMinimapOpen(false)} />}
    {minimapOpen && sizesReady && <svg className="director-minimap generation-minimap" width="200" height="132" role="img" tabIndex={0} aria-label="小地图导航" viewBox={`${mapLeft} ${mapTop} ${mapWidth} ${mapHeight}`} preserveAspectRatio="none"
      onPointerDown={event => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panMap(event) }}
      onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) panMap(event) }}
      onPointerUp={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId) }}
      onKeyDown={event => { if (!event.defaultPrevented && !event.nativeEvent.isComposing && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) { event.preventDefault(); layout.setView(previous => ({ ...previous, transform: { ...previous.transform, x: previous.transform.x + (event.key === 'ArrowLeft' ? 40 : event.key === 'ArrowRight' ? -40 : 0), y: previous.transform.y + (event.key === 'ArrowUp' ? 40 : event.key === 'ArrowDown' ? -40 : 0) } })) } }}>
      <title>小地图导航；方向键平移画布</title>
      {[...groupFrames].map(([id, frame]) => <rect key={id} data-minimap-group={id} {...frame} />)}
      {cardFrames.map(({ id, ...frame }) => <rect key={id} data-minimap-node={id} {...frame} />)}
      <rect className="director-minimap-viewport generation-minimap-viewport" x={visibleWorld.x} y={visibleWorld.y} width={visibleWorld.width} height={visibleWorld.height} />
    </svg>}
    {cards.filter(card => card.type !== 'review.check' && (detailSessions.includes(card.id) || card.id === detailId)).map(renderEditor)}
    {resultDetail && <CanvasCardEditor key={resultDetail.id} open title={linkedResultTitle(resultDetail.output)}
      status={resultDetail.output.basis_current === false ? '只读 · 依据已变' : '只读'}
      anchor={window.document.querySelector<HTMLElement>(`[data-card-id="${CSS.escape(resultsById.has(resultDetail.id) ? resultDetail.id : resultDetail.output.source.card_id)}"]`)}
      layoutKey={`${transform.x}:${transform.y}:${transform.scale}:${JSON.stringify(point(resultDetail.id))}`}
      onReveal={revealEditor} suppressed={detailsSuppressed} trigger={detailTrigger} layoutAction={layoutAction}
      cardType={`content.${resultDetail.output.modality}`} modality={resultDetail.output.modality}
      focusLayout={focusCardTypes.includes(`content.${resultDetail.output.modality}`)}
      onClose={() => { setOpenedResult(undefined); setDetailId(undefined) }}>
      <div className="generation-card-body" data-canvas-details={document.id} data-card-details={resultDetail.id}>
        <LinkedResultReader id={resultDetail.id} output={resultDetail.output} />
      </div>
    </CanvasCardEditor>}
  </div>
}


export function GenerationCanvasGraph(props: ComponentProps<typeof GenerationCanvasGraphContent>) {
  return <CanvasCatalogProvider key={`${props.document.project_id}:${props.document.id}`} projectId={props.document.project_id} canvasId={props.document.id} onReady={props.onCatalogReady}><GenerationCanvasGraphContent {...props} /></CanvasCatalogProvider>
}

function DesignReferenceBoundary({ children, ...props }: ComponentProps<typeof DesignReferenceEditor>) {
  return isReferenceDesign(props.card) ? <DesignReferenceEditor {...props}>{children}</DesignReferenceEditor> : <>{children}</>
}
