import { WorkbenchTheme } from './ui/WorkbenchTheme'
import { WorkbenchButton, WorkbenchIconButton } from './ui/WorkbenchButton'
import { SourceProvider } from './Sources'
import { SceneSourceRevision } from './SceneSourceRevision'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Alert, Button, Dropdown, Input, Modal, Select, Space, Spin, Switch } from 'antd'
import { ArrowLeftOutlined, DownOutlined, MoreOutlined, RedoOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons'
import { CanvasToolbarMenu } from './CanvasToolbarMenu'
import { CanvasTextPreview } from './CanvasTextPreview'
import { Link, useBeforeUnload, useBlocker, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { SceneVersionContent_Output, SceneVersionCopy, SceneVersionCreate, SceneVersionRead, SceneVideoSaveResult, SequenceRead } from '../../../services/generated'
import { directingError, humanNote } from './common'
import { clearSceneRecovery, readSceneRecovery, writeSceneRecovery } from './sceneRecovery'
import type { SaveOperation, SceneRecovery } from './sceneRecovery'
import { useSceneEditOwnership } from './useSceneEditOwnership'
import type { SceneEditOwnership } from './useSceneEditOwnership'
import { SceneUnitCanvas } from './SceneUnitCanvas'
import { SceneDeliveryPanel } from './SceneDeliveryPanel'
import { OverviewDesignHistory, OverviewUnitHistory } from './SceneWorkbenchOverview'
import { SceneExportPanel } from './SceneExportPanel'
import { SceneEditCanvas } from './SceneEditCanvas'
import { SceneRelationsNavigation } from './SceneRelationsNavigation'
import type { SceneMediaNavigationTarget, SceneNavigationTarget } from './SceneRelationsNavigation'
import { SceneInstructionCanvas } from './SceneInstructionCanvas'
import { useSceneVideoRequests } from './useSceneVideoRequests'
import { SceneVideoBatch } from './SceneVideoBatch'
import { SceneVideoActivity } from './SceneVideoActivity'
import type { VideoActivityTarget } from './SceneVideoActivity'
import { SceneInstructionActivity } from './SceneInstructionActivity'
import type { InstructionActivityTarget } from './SceneInstructionActivity'
import { SceneSourceBasis } from './SceneSourceBasis'
import { ManualSceneShots } from './ManualSceneShots'
import { SceneDesignPanel, targetFor } from './SceneDesignPanel'
import type { DesignFocusRequest } from './SceneDesignPanel'
import { SceneDesignSuggestions } from './SceneDesignSuggestions'
import type { UnitReferenceConflict } from './sceneUnitReferences'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'
import { designObjects, scopeGraph, shotGraph, shotRelationPath } from './designWorkspace'
import type { DesignObject } from './designWorkspace'
import { DesignObjectSummary } from './DesignObjectSummary'
import { DirectorLocationSummary } from './DirectorLocationSummary'
import { designAt } from './designValue'
import { TaskCenter } from '../components/TaskCenter'
import { CanvasQuickEditor } from './CanvasQuickEditor'
import './canvasWorkbench.css'

type CopyIntent = { versionId: string; body: SceneVersionCopy; base: SceneVersionRead; undo: SceneVersionContent_Output[] }
type Draft = { versionId: string; content: SceneVersionContent_Output }
type Transition = { action: () => void; cancel?: () => void }
type EditHistory = { undo: SceneVersionContent_Output[]; redo: SceneVersionContent_Output[] }
type RecoveryState = { data?: SceneRecovery; stage: 'checking' | 'available' | 'unknown' | 'conflict' | 'foreign' | 'invalid'; message?: string }
const sessionHistories = new Map<string, EditHistory>()
// 输入 DTO 可省略空列表及 nullable 默认值，响应会补齐；比较业务值而非 JSON 字段顺序。
const contentKey = (value: unknown) => JSON.stringify(value, (_key, item) => {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  return Object.fromEntries(Object.keys(item).sort()
    .filter(key => item[key] != null && !(Array.isArray(item[key]) && item[key].length === 0))
    .map(key => [key, item[key]]))
})
const sameContent = (a: unknown, b: unknown) => contentKey(a) === contentKey(b)
const defaultVersion = (rows: SceneVersionRead[]) => rows.filter(row => row.last_save_request_id || row.copied_from_version_id)
  .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.id.localeCompare(b.id))[0] || rows[0]
// 当前工作台使用本地用户；浏览器存储天然隔离设备，偏好不写入场次内容。
const autoSavePreference = 'jellyfish:scene-autosave:local-user'

/** 只在明确创建时产生方案；保存状态属于同一场次版本，而不是设计草稿。 */
function Workbench({ projectId, chapterId, sequenceId, ownership }: { projectId: string; chapterId: string; sequenceId: string; ownership: SceneEditOwnership }) {
  const [params, setParams] = useSearchParams()
  const copyKey = `jellyfish:scene-copy:${projectId}:${sequenceId}`
  const [copyInitial] = useState(() => {
    try {
      const raw = localStorage.getItem(copyKey)
      const pending = raw ? JSON.parse(raw) as CopyIntent : undefined
      if (pending && (!pending.body?.request_id || !pending.body.content || pending.base?.id !== pending.versionId || !Array.isArray(pending.undo))) throw new Error('另存凭据无效')
      return { pending, error: '' }
    } catch { return { pending: undefined, error: '另存凭据无法读取，请恢复浏览器存储后刷新核实。' } }
  })
  const [copyPending, setCopyPending] = useState(copyInitial.pending)
  const [copyBusy, setCopyBusy] = useState(false)
  const [copyError, setCopyError] = useState(copyInitial.error)
  const copyLocked = copyBusy || !!copyPending || !!copyInitial.error
  const copyRunning = useRef(false)
  const copyLock = useRef(copyLocked)
  copyLock.current = copyLocked
  const [sequence, setSequence] = useState<SequenceRead>()
  const [versions, setVersions] = useState<SceneVersionRead[]>([])
  const [draft, setDraft] = useState<Draft>()
  const [canvas, setCanvas] = useState<'director' | 'units' | 'instructions' | 'edit'>('director')
  const [unitSelections, setUnitSelections] = useState<Record<string, string>>({})
  const shotUnitSelections = useRef<Record<string, Record<string, string>>>({})
  const rememberUnit = (versionId: string, shotId: string, unitId: string) => {
    shotUnitSelections.current[versionId] = { ...shotUnitSelections.current[versionId], [shotId]: unitId }
    setUnitSelections(previous => ({ ...previous, [versionId]: unitId }))
  }
  const [instructionSelection, setInstructionSelection] = useState<{ versionId: string; unitId: string; taskId?: string }>()
  const [instructionActivities, setInstructionActivities] = useState<InstructionActivityTarget[]>([])
  const [mediaFocus, setMediaFocus] = useState<{ versionId: string; target: SceneMediaNavigationTarget; serial: number }>()
  const [editClipFocus, setEditClipFocus] = useState<{ versionId: string; clipId: string }>()
  const [instructionFocus, setInstructionFocus] = useState<{ unitId: string; serial: number }>()
  const [directorFocus, setDirectorFocus] = useState<{ versionId: string; nodeId: string; fieldId: string; serial: number }>()
  const [unitFocus, setUnitFocus] = useState<{ versionId: string; unitId: string; nodeId: string; fieldId: string; serial: number }>()
  const [shotSelections, setShotSelections] = useState<Record<string, string>>({})
  const [showDesignEvidence, setShowDesignEvidence] = useState(false)
  const [showAllDesign, setShowAllDesign] = useState(false)
  const [designFocus, setDesignFocus] = useState<DesignFocusRequest & { versionId: string }>()
  const [editor, setEditor] = useState<{ versionId: string; kind: 'viewpoint' | 'shot' | 'design' | 'source' | 'ai' }>()
  const [navigation, setNavigation] = useState<{ versionId: string; kind: 'relations' | 'designNavigation' }>()
  const [primaryHost, setPrimaryHost] = useState<HTMLDivElement | null>(null)
  const [navigationHost, setNavigationHost] = useState<HTMLDivElement | null>(null)
  const [feedbackHost, setFeedbackHost] = useState<HTMLDivElement | null>(null)
  const [moreHost, setMoreHost] = useState<HTMLDivElement | null>(null)
  const toolbar = useRef<HTMLElement>(null)
  const notices = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = toolbar.current
    if (!element) return
    const measure = () => {
      const root = element.closest<HTMLElement>('.canvas-workbench')
      const toolbarBottom = element.offsetTop + element.offsetHeight + 12
      const noticeHeight = notices.current?.offsetHeight || 0
      root?.style.setProperty('--workbench-toolbar-bottom', `${toolbarBottom}px`)
      root?.style.setProperty('--workbench-content-top', `${toolbarBottom + noticeHeight + (noticeHeight ? 8 : 0)}px`)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    if (notices.current) observer.observe(notices.current)
    measure()
    return () => observer.disconnect()
  }, [])
  const [deliveryBusy, setDeliveryBusy] = useState(false)
  const [currentExportBusy, setExportBusy] = useState(false)
  const [historyExportBusy, setHistoryExportBusy] = useState(false)
  const exportBusy = currentExportBusy || historyExportBusy
  const [autoSave, setAutoSave] = useState(() => {
    try { return localStorage.getItem(autoSavePreference) !== 'off' } catch { return true }
  })
  const [recovery, setRecovery] = useState<RecoveryState>()
  const [storageError, setStorageError] = useState('')
  const recoveryUndo = useRef<SceneVersionContent_Output[]>([])
  const recoveryNavigation = useRef(false)
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [loadedEditing, setLoadedEditing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState<'create' | 'save'>()
  const [videoActivities, setVideoActivities] = useState<VideoActivityTarget[]>([])
  const [videoRefresh, setVideoRefresh] = useState(0)
  const [videoFocus, setVideoFocus] = useState<{ versionId: string; unitId: string; executionId: string; serial: number }>()
  const [videoFeedback, setVideoFeedback] = useState<Record<string, { message: string; versionId: string; unitId: string; executionId?: string; error?: string }>>({})
  const [failure, setFailure] = useState<{ versionId?: string; message: string }>()
  const pendingSave = useRef<SaveOperation>()
  const pendingCreate = useRef<SceneVersionCreate>()
  const inFlight = useRef<Promise<boolean>>()
  const [transition, setTransition] = useState<Transition>()
  const [leaving, setLeaving] = useState(false)
  const [handingOff, setHandingOff] = useState(false)
  const transitionActive = useRef(false)
  const lastEditing = useRef<{ element: HTMLTextAreaElement; start: number; end: number; scrollTop: number }>()
  const histories = useRef(sessionHistories)
  const live = useRef(true)
  const selectedId = params.get('version') || defaultVersion(versions)?.id
  const selected = versions.find(row => row.id === selectedId)
  const [historyNavigationError, setHistoryNavigationError] = useState('')
  const [historyNavigating, setHistoryNavigating] = useState(false)
  const historyNavigationRequest = useRef(0)
  const historyTaskId = params.get('sceneTask')
  const historyVersionId = params.get('taskVersion')
  const historyUnitId = params.get('taskUnit')
  const historyTaskKind = params.get('taskKind')
  useEffect(() => {
    setHistoryNavigating(false); setHistoryNavigationError('')
    return () => { historyNavigationRequest.current += 1 }
  }, [projectId, sequenceId, selectedId, historyTaskId, historyVersionId, historyUnitId, historyTaskKind])
  const closeTaskHistory = () => {
    historyNavigationRequest.current += 1
    setHistoryNavigating(false); setHistoryNavigationError('')
    const next = new URLSearchParams(params)
    for (const key of ['sceneTask', 'taskVersion', 'taskKind', 'taskUnit']) next.delete(key)
    setParams(next, { replace: true })
  }
  const exportVersionId = params.get('exportVersion') || params.get('version')
  const exportHistory = params.get('exportTask') && exportVersionId !== selectedId ? versions.find(row => row.id === exportVersionId) : undefined
  const closeExportHistory = () => {
    const next = new URLSearchParams(params)
    next.delete('exportVersion'); next.delete('exportTask')
    setParams(next, { replace: true })
  }
  const content = selected && (draft?.versionId === selected.id ? draft.content : selected.content)
  const trackInstruction = (taskId: string, unitId: string) => {
    if (!live.current || !selected || !content) return
    const index = content.units.findIndex(unit => unit.id === unitId)
    if (index < 0) return
    const unit = content.units[index]
    setInstructionActivities(previous => previous.some(item => item.taskId === taskId) ? previous : [
      ...previous,
      { projectId, sequenceId, versionId: selected.id, unitId, taskId, shotId: unit.coverage[0].shot_id,
        unitLabel: `单元 ${index + 1}`, versionTitle: selected.title },
    ])
  }
  const locateUnitReference = (conflict: UnitReferenceConflict) => {
    if (!selected || !content?.units.some(unit => unit.id === conflict.unitId && unit.coverage.some(item => item.shot_id === conflict.shotId))) return
    setEditor(undefined); setCanvas('units')
    setShotSelections(previous => ({ ...previous, [selected.id]: conflict.shotId }))
    rememberUnit(selected.id, conflict.shotId, conflict.unitId)
    setUnitFocus({ versionId: selected.id, unitId: conflict.unitId, nodeId: conflict.coverageId ? '单元设置' : '参考素材',
      fieldId: conflict.coverageId ? `scene-unit-action-${conflict.coverageId}` : 'scene-unit-references', serial: Date.now() })
  }
  const dirty = !!selected && !!content && !sameContent(content, selected.content)
  const readonly = sequence?.is_current === false || !ownership.editable || !loadedEditing
  const directVideos = useSceneVideoRequests({ projectId, sequenceId, enabled: ownership.editable && loadedEditing && loadState === 'ready', canSubmit: !readonly && !copyLocked,
    onAccepted: target => {
      setVideoActivities(previous => previous.some(item => item.taskId === target.taskId) ? previous : [...previous, target])
      setVideoRefresh(value => value + 1)
    },
    onRejected: (target, error) => setVideoFeedback(previous => ({ ...previous, [`${target.versionId}:${target.unitId}`]: { message: `${target.versionTitle} · ${target.unitLabel}：视频未提交：${error}`, versionId: target.versionId, unitId: target.unitId, executionId: target.executionId } })),
  })
  const currentDirectVideo = directVideos.pending.find(row => row.versionId === selectedId && row.unitId === unitSelections[selectedId || ''])
  const directorStorageKey = `jellyfish:director-layout:local-user:${projectId}:${sequenceId}:${selected?.id || 'empty'}`
  const [directorPreferenceKey, setDirectorPreferenceKey] = useState('')
  useLayoutEffect(() => {
    if (!selected || !content || directorPreferenceKey === directorStorageKey) return
    let stored: { shotId?: string; overview?: boolean; evidence?: boolean } = {}
    try { stored = JSON.parse(localStorage.getItem(`${directorStorageKey}:selection`) || '{}') || {} } catch { /* 使用默认镜头。 */ }
    if (typeof stored.shotId === 'string' && stored.shotId.length > 0) setShotSelections(previous => ({ ...previous, [selected.id]: stored.shotId! }))
    setShowAllDesign(stored.overview === true)
    setShowDesignEvidence(stored.evidence === true)
    setDirectorPreferenceKey(directorStorageKey)
  }, [selected?.id, !!content, directorStorageKey])
  const currentShotId = selected ? shotSelections[selected.id] ?? content?.design.direction.shots[0]?.id : undefined
  const currentEditor = editor?.versionId === selected?.id ? editor?.kind : undefined
  const openEditor = (kind: 'viewpoint' | 'shot' | 'design' | 'source' | 'ai') => {
    if (!selected) return
    if (kind === 'viewpoint' || kind === 'shot') setNavigation(undefined)
    setEditor({ versionId: selected.id, kind })
  }
  const currentNavigation = navigation?.versionId === selected?.id ? navigation?.kind : undefined
  const openNavigation = (kind: 'relations' | 'designNavigation') => {
    if (!selected) return
    setEditor(previous => previous?.kind === 'viewpoint' || previous?.kind === 'shot' ? undefined : previous)
    setNavigation({ versionId: selected.id, kind })
  }
  useEffect(() => {
    if (directorPreferenceKey !== directorStorageKey) return
    try { localStorage.setItem(`${directorStorageKey}:selection`, JSON.stringify({ shotId: currentShotId, overview: showAllDesign, evidence: showDesignEvidence })) } catch { /* 偏好不可写不影响业务编辑。 */ }
  }, [directorPreferenceKey, directorStorageKey, currentShotId, showAllDesign, showDesignEvidence])
  const hasDirectorShot = !!content?.design.direction.shots.some(shot => shot.id === currentShotId)
  const directorAnchor = hasDirectorShot ? `shot:${currentShotId}` : '全场共享'
  const graph = content ? showAllDesign ? scopeGraph(content.design, 'all') : currentShotId ? shotGraph(content.design, currentShotId) : { nodes: [], edges: [] } : { nodes: [], edges: [] }
  const graphIdentity = (key: string) => {
    if (key === `shot:${currentShotId}`) return directorAnchor
    const node = graph.nodes.find(item => item.key === key) || (content && designObjects(content.design).find(item => item.key === key))
    const row = node && content ? designAt(content.design, node.path) : undefined
    if (key.startsWith('camera:')) return `camera:${row?.shot_id}`
    if (key.startsWith('performance:')) return `performance:${row?.beat_id}:${row?.participant_id}`
    return key
  }
  const evidence = (key: string) => /^(participant|beat|event|anchor):/.test(key)
  const visibleObjects = graph.nodes.filter(node => node.key !== 'overview' && node.key !== `shot:${currentShotId}` && (showDesignEvidence || !evidence(node.key) || node.kind === 'missing'))
  if (content && showAllDesign) designObjects(content.design).filter(node => node.key !== 'overview' && node.key !== `shot:${currentShotId}` && !visibleObjects.some(item => item.key === node.key)).forEach(node => visibleObjects.push(node))
  const objectOrder = (key: string) => ({ camera: 0, performance: 1, blocking: 2, continuity: 3, dialogue: 4, criterion: 5 }[key.split(':')[0]] ?? 6)
  visibleObjects.sort((a, b) => objectOrder(a.key) - objectOrder(b.key))
  const cardTitle = (node: DesignObject) => {
    if (!content || node.kind === 'missing') return node.label
    const row = designAt(content.design, node.path)
    const person = row?.participant_id && content.design.participants.find(item => item.id === row.participant_id)?.name
    if (node.key.startsWith('performance:')) {
      const index = content.design.direction.beats.findIndex(item => item.id === row.beat_id)
      return `${person || '人物引用缺失'} · ${index < 0 ? '节拍引用缺失' : `节拍 ${String(index + 1).padStart(2, '0')}`}`
    }
    if (/^(blocking|situation|activity|dialogue):/.test(node.key)) return person || '人物引用缺失'
    if (node.key.startsWith('continuity:')) return `${({ hands_props: '手部与道具', space: '空间', appearance: '造型', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音' } as Record<string, string>)[row.domain] || row.domain || '未填写领域'} · ${person || (row.event_id ? '关联事件' : '未指定对象')}`
    if (node.key.startsWith('camera:')) {
      const index = content.design.direction.shots.findIndex(shot => shot.id === row.shot_id)
      return index < 0 ? '镜头引用缺失' : `镜头 ${String(index + 1).padStart(2, '0')}`
    }
    if (node.key.startsWith('participant:')) return row.name || node.label
    return node.label
  }
  const graphObjects = visibleObjects.map(node => ({
    id: graphIdentity(node.key), label: node.label, title: cardTitle(node),
    onInspect: node.kind === 'missing' ? undefined : (trigger: HTMLElement) => {
      if (selected && content) setDesignFocus({ versionId: selected.id, target: { ...targetFor(content.design, node.path), object: true }, trigger, serial: Date.now() })
    },
    content: <section className="canvas-workbench-card">
      {node.kind !== 'missing' && !/^(camera|criterion|performance|blocking|situation|activity|continuity|dialogue|participant|beat|event|anchor):/.test(node.key) && !/^(performance|staging|sound|prompt)$/.test(node.key) && <Button aria-label={`查看关系对象：${node.label}`} onClick={event => {
        if (selected && content) setDesignFocus({ versionId: selected.id, target: { ...targetFor(content.design, node.path), object: true }, trigger: event.currentTarget, serial: Date.now() })
      }}>查看或编辑</Button>}
      <DesignObjectSummary value={content!.design} saved={selected?.content.design} object={node} compact onSelectShot={id => { if (!selected) return; selectShot(id); setShowAllDesign(false); setDirectorFocus({ versionId: selected.id, nodeId: graphIdentity(node.key), fieldId: '', serial: Date.now() }) }} /></section>,
  }))
  const graphRelations = graph.edges.filter(edge => showAllDesign || showDesignEvidence || !evidence(edge.from) && !evidence(edge.to)).map(edge => ({ ...edge, from: graphIdentity(edge.from), to: graphIdentity(edge.to) }))
  if (!showDesignEvidence && !showAllDesign && currentShotId) visibleObjects.forEach(node => {
    const path = shotRelationPath(graph, currentShotId, node.key)
    if (path.length > 1 && path.some(edge => evidence(edge.from) || evidence(edge.to))) graphRelations.push({ from: directorAnchor, to: graphIdentity(node.key), label: path.map(edge => edge.label).join(' → '), indirect: true })
  })
  const openAssetTool = (assetKind: 'character' | 'scene', trigger: HTMLElement) => {
    if (selected) setDesignFocus({ versionId: selected.id, target: { path: ['assets'], assetKind, shotId: currentShotId }, trigger, serial: Date.now() })
  }
  if (content?.design.direction.shots.some(shot => shot.id === currentShotId)) {
    const id = `location:${content.design.direction.location_asset_id || 'unlinked'}`
    graphObjects.push({ id, label: '本场场所', title: '本场场所', onInspect: trigger => openAssetTool('scene', trigger),
      content: <section className="canvas-workbench-card"><DirectorLocationSummary projectId={projectId} assetId={content.design.direction.location_asset_id} /></section> })
    if (content.design.direction.location_asset_id) graphRelations.push({ from: directorAnchor, to: id, label: '共享场所' })
  }
  if (content?.design.direction.shots.some(shot => shot.id === currentShotId)) graphRelations.push({ from: '全场共享', to: directorAnchor, label: '全场约束' })
  const selectShot = (id: string) => {
    const { selected, content } = latest.current
    if (!selected || !content?.design.direction.shots.some(row => row.id === id)) return
    const remembered = shotUnitSelections.current[selected.id]?.[id]
    const units = content.units.filter(unit => unit.coverage.some(item => item.shot_id === id))
    // 失效的明确目标保留为不可用，不按剩余列表或同名对象替换。
    const unitId = remembered || (units.length === 1 ? units[0].id : '')
    setShotSelections(previous => ({ ...previous, [selected.id]: id }))
    setUnitSelections(previous => ({ ...previous, [selected.id]: unitId }))
  }
  const selectUnit = (id: string, targetShotId = currentShotId) => {
    const current = latest.current
    if (!current.selected || !targetShotId || !current.content?.units.some(unit => unit.id === id && unit.coverage.some(item => item.shot_id === targetShotId))) return
    setShotSelections(previous => ({ ...previous, [current.selected!.id]: targetShotId }))
    rememberUnit(current.selected.id, targetShotId, id)
  }
  const navigateRelation = (target: SceneNavigationTarget) => {
    const current = latest.current
    if (target.kind === 'take' || target.kind === 'clip') {
      if (!current.selected || !current.content) return
      setEditor(undefined); setCanvas('edit'); setEditClipFocus(undefined)
      setMediaFocus({ versionId: current.selected.id, target, serial: Date.now() })
      return
    }
    if (!current.selected || !current.content?.design.direction.shots.some(shot => shot.id === target.shotId)) return
    if (target.kind !== 'shot' && !current.content.units.some(unit => unit.id === target.unitId && unit.coverage.some(item => item.shot_id === target.shotId))) return
    setEditor(undefined)
    if (target.kind === 'shot') {
      selectShot(target.shotId); setCanvas('director')
      setDirectorFocus({ versionId: current.selected.id, nodeId: '镜头设计', fieldId: '', serial: Date.now() })
    } else {
      selectUnit(target.unitId, target.shotId)
      if (target.kind === 'unit') {
        setCanvas('units')
        setUnitFocus({ versionId: current.selected.id, unitId: target.unitId, nodeId: '单元设置', fieldId: 'scene-unit-duration', serial: Date.now() })
      } else {
        setCanvas('instructions')
        setInstructionFocus({ unitId: target.unitId, serial: Date.now() })
      }
    }
  }
  const latest = useRef({ selected, content })
  latest.current = { selected, content }
  const hasChanges = () => !!latest.current.selected && !sameContent(latest.current.content, latest.current.selected.content)
  const restoreEditing = () => {
    const editing = lastEditing.current
    if (!editing?.element.isConnected) return
    editing.element.focus({ preventScroll: true })
    editing.element.setSelectionRange(editing.start, editing.end)
    editing.element.scrollTop = editing.scrollTop
  }
  const persistEditing = () => {
    const { selected, content } = latest.current
    if (!selected || !content || recovery || !ownership.canEdit()) return
    try {
      if (!hasChanges() && !pendingSave.current) {
        clearSceneRecovery()
        recoveryUndo.current = []
      } else writeSceneRecovery({ format: 1, projectId, chapterId, sequenceId, base: selected,
        content, undo: recoveryUndo.current, pending: pendingSave.current })
      setStorageError('')
    } catch (error) { setStorageError(`未获得崩溃恢复保护，请保存当前输入。${String(error)}`) }
  }
  const checkRecovery = async (data: SceneRecovery, rows: SceneVersionRead[]) => {
    if (data.projectId !== projectId || data.chapterId !== chapterId || data.sequenceId !== sequenceId ||
      data.base.id !== (params.get('version') || defaultVersion(rows)?.id)) {
      setRecovery({ data, stage: 'foreign' })
      return
    }
    setRecovery({ data, stage: 'checking' })
    let server = rows.find(row => row.id === data.base.id)
    if (!server) { setRecovery({ data, stage: 'conflict', message: '原场次版本不可用，已保留本地内容。' }); return }
    let remaining = data
    try {
      if (data.pending) {
        const operation = data.pending
        // 已提交但响应丢失：优先核对读取结果，否则复用原请求核实，绝不另起保存。
        if (operation.video || server.last_save_request_id !== operation.body.request_id) server = await executeSaveOperation(operation)
        if (!live.current) return
        if (server.revision !== operation.body.expected_revision + (operation.videoOnly ? 0 : 1) || !sameContent(server.content, operation.body.content)) {
          setRecovery({ data, stage: 'conflict', message: '服务器内容与原保存结果不一致，不能直接恢复覆盖。' })
          return
        }
        remaining = { ...data, base: server, pending: undefined, undo: data.undo.slice(operation.operationCount) }
      } else if (server.revision !== data.base.revision || !sameContent(server.content, data.base.content)) {
        setRecovery({ data, stage: 'conflict', message: '服务器内容与恢复基准不一致，已保留本地编辑，不能直接覆盖。' })
        return
      }
      const verified = server
      setVersions(previous => previous.map(row => row.id === verified.id ? verified : row))
      if (sameContent(remaining.content, server.content)) {
        clearSceneRecovery()
        setRecovery(undefined)
      } else {
        writeSceneRecovery(remaining)
        setRecovery({ data: remaining, stage: 'available' })
      }
    } catch (error) {
      if (!live.current) return
      if (error instanceof ApiError && [400, 422].includes(error.status) && server.revision === data.base.revision && sameContent(server.content, data.base.content)) {
        const failed = { ...data, pending: undefined }
        try { writeSceneRecovery(failed) } catch (storageFailure) { setStorageError(`未获得崩溃恢复保护。${String(storageFailure)}`) }
        setRecovery({ data: failed, stage: 'available', message: '原保存明确失败，可恢复输入继续处理。' })
      } else setRecovery({ data: remaining, stage: error instanceof ApiError && error.status === 409 ? 'conflict' : 'unknown', message: directingError(error) })
    }
  }
  const restoreRecovery = () => {
    if (recovery?.stage !== 'available' || !recovery.data) return
    const data = recovery.data
    latest.current = { selected: data.base, content: data.content }
    setVersions(rows => rows.map(row => row.id === data.base.id ? data.base : row))
    setDraft({ versionId: data.base.id, content: data.content })
    recoveryUndo.current = [...data.undo]
    histories.current.set(data.base.id, { undo: [...data.undo], redo: [] })
    pendingSave.current = undefined
    setRecovery(undefined)
  }
  const discardRecovery = () => {
    try { clearSceneRecovery(); setRecovery(undefined); setStorageError(''); setAttempt(value => value + 1) }
    catch (error) { setStorageError(`本地数据清理失败，尚未丢弃。${String(error)}`) }
  }
  const editContent = (updated: SceneVersionContent_Output, record = true) => {
    const { selected, content } = latest.current
    if (!selected || !content || copyLock.current || recovery || handingOff || !ownership.canEdit() || sameContent(content, updated)) return
    if (record) {
      const history = histories.current.get(selected.id) || { undo: [], redo: [] }
      history.undo.push(content)
      history.redo = []
      histories.current.set(selected.id, history)
    }
    recoveryUndo.current.push(content)
    latest.current.content = updated
    setDraft({ versionId: selected.id, content: updated })
    persistEditing()
  }
  const stepHistory = (direction: 'undo' | 'redo') => {
    if (copyLock.current || readonly || busy === 'create' || transition || leaving || recovery || handingOff) return
    const { selected, content } = latest.current
    if (!selected || !content) return
    const history = histories.current.get(selected.id)
    const updated = history?.[direction].pop()
    if (!history || !updated) return
    history[direction === 'undo' ? 'redo' : 'undo'].push(content)
    editContent(updated, false)
  }

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === autoSavePreference) setAutoSave(event.newValue !== 'off')
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [])

  useEffect(() => {
    let active = true
    setLoadedEditing(false)
    if (ownership.state === 'checking') return
    let incoming: SceneRecovery | undefined
    if (ownership.canEdit()) {
      try {
        incoming = readSceneRecovery()
        setRecovery(incoming ? { data: incoming, stage: 'checking' } : undefined)
      } catch (error) {
        // 禁用存储不阻止服务器编辑，写入时另提示崩溃恢复不可用。
        setRecovery(error instanceof DOMException ? undefined : { stage: 'invalid', message: String(error) })
      }
    } else setRecovery(undefined)
    setLoadState('loading')
    void Promise.all([
      StudioDirectingService.directingWorkspace({ projectId, sequenceId }),
      StudioDirectingService.directingSceneVersions({ projectId, sequenceId }),
    ]).then(async ([workspace, result]) => {
      if (!active) return
      if (!workspace.data || !result.data) throw new Error('场次内容尚未核实，请重试读取')
      if (workspace.data.sequence.chapter_id !== chapterId) throw new Error('场次不属于当前章节')
      setSequence(workspace.data.sequence)
      setVersions(result.data)
      setLoadError('')
      setLoadState('ready')
      setLoadedEditing(ownership.canEdit())
      if (incoming && ownership.canEdit() && !copyInitial.pending) await checkRecovery(incoming, result.data)
      if (copyInitial.pending) setRecovery(undefined)
    }).catch(error => {
      if (!active) return
      setLoadError(directingError(error))
      setLoadState('failed')
    })
    return () => { active = false }
  }, [projectId, chapterId, sequenceId, attempt, params.get('version'), ownership.state])

  const select = (id: string) => {
    const next = new URLSearchParams(params)
    next.set('version', id)
    setParams(next)
    setFailure(undefined)
  }

  const create = async () => {
    if (copyLock.current || busy === 'create' || readonly || recovery || handingOff || !ownership.canEdit() || loadState !== 'ready') return
    const body = pendingCreate.current || { request_id: crypto.randomUUID(), title: `场次版本 ${versions.length + 1}` }
    pendingCreate.current = body
    setBusy('create')
    setFailure(undefined)
    try {
      const result = await StudioDirectingService.directingCreateSceneVersion({ projectId, sequenceId, requestBody: body })
      if (!live.current) return
      if (!result.data) throw new Error('创建结果尚未核实，请重试同一次创建')
      const created = result.data
      setVersions(rows => [...rows.filter(row => row.id !== created.id), created])
      pendingCreate.current = undefined
      select(created.id)
    } catch (error) {
      if (!live.current) return
      if (error instanceof ApiError && [400, 409, 422].includes(error.status)) pendingCreate.current = undefined
      setFailure({ message: directingError(error) })
    } finally { if (live.current) setBusy(undefined) }
  }

  const executeSaveOperation = async (operation: SaveOperation): Promise<SceneVersionRead> => {
    if (operation.video) {
      let data: SceneVideoSaveResult | undefined
      if (operation.videoOnly) {
        const accepted = await StudioDirectingService.directingSceneVideoSubmit({ projectId, sequenceId, versionId: operation.versionId,
          unitId: operation.video.unitId, requestBody: { request_id: operation.video.requestId, expected_revision: operation.body.expected_revision } })
        if (!accepted.data) throw new Error('视频提交结果尚未核实，请核实原请求')
        const version = await StudioDirectingService.directingSceneVersion({ projectId, sequenceId, versionId: operation.versionId })
        if (version.data) data = { version: version.data, task_id: accepted.data.task_id, error: null }
      } else {
        try {
          const response = await StudioDirectingService.directingSceneVideoSaveSubmit({ projectId, sequenceId, versionId: operation.versionId,
            unitId: operation.video.unitId, requestBody: { request_id: operation.video.requestId, save: operation.body } })
          if (!response.data) throw new Error('保存与视频提交结果尚未核实')
          data = response.data
        } catch (cause) {
          if (cause instanceof ApiError && [400, 409, 422].includes(cause.status)) throw cause
          // 只接受同一原请求的执行及完整保存结果；读取失败或不匹配时仍保留待核实授权。
          try {
            const [history, saved] = await Promise.all([
              StudioDirectingService.directingSceneVideos({ projectId, sequenceId, versionId: operation.versionId, unitId: operation.video.unitId }),
              StudioDirectingService.directingSceneVersion({ projectId, sequenceId, versionId: operation.versionId }),
            ])
            const execution = history.data?.find(row => row.request_id === operation.video!.requestId)
            if (execution && saved.data && execution.preparation.revision === operation.body.expected_revision + 1 &&
              saved.data.revision === operation.body.expected_revision + 1 && saved.data.last_save_request_id === operation.body.request_id &&
              sameContent(saved.data.content, operation.body.content)) {
              data = { version: saved.data, task_id: execution.task_id, error: null }
            }
          } catch { /* 不能凭读取失败推断提交失败，也不能另起请求。 */ }
          if (!data) throw cause
        }
      }
      if (!data) throw new Error('保存与视频提交结果尚未核实，请核实原请求')
      const result = { data }
      if (live.current) {
        const unitNumber = operation.body.content.units?.findIndex(unit => unit.id === operation.video!.unitId) ?? -1
        const label = `${versions.find(row => row.id === operation.versionId)?.title || '原场次版本'} · 单元 ${unitNumber + 1}`
        setVideoFeedback(previous => ({ ...previous, [`${operation.versionId}:${operation.video!.unitId}`]: { message: `${label}：${result.data!.error ? `已保存，视频未提交：${result.data!.error}` : '视频任务已提交'}`, versionId: operation.versionId, unitId: operation.video!.unitId } }))
        const taskId = result.data.task_id
        if (taskId) setVideoActivities(previous => previous.some(item => item.taskId === taskId) ? previous : [...previous, {
          projectId, sequenceId, versionId: operation.versionId, unitId: operation.video!.unitId, taskId,
          unitLabel: `单元 ${unitNumber + 1}`, versionTitle: versions.find(row => row.id === operation.versionId)?.title || '原场次版本',
        }])
        setVideoRefresh(value => value + 1)
      }
      return result.data.version
    }
    const result = await StudioDirectingService.directingSaveSceneVersion({ projectId, sequenceId, versionId: operation.versionId, requestBody: operation.body })
    if (!result.data) throw new Error('保存结果尚未核实，请重试同一次保存')
    return result.data
  }
  const saveOnce = async (): Promise<boolean> => {
    const { selected, content } = latest.current
    if (!selected || !content || readonly || recovery || !ownership.canEdit() || loadState !== 'ready') return false
    const operation = pendingSave.current || { versionId: selected.id, body: {
      request_id: crypto.randomUUID(), expected_revision: selected.revision, content,
    }, operationCount: recoveryUndo.current.length }
    pendingSave.current = operation
    persistEditing()
    setBusy('save')
    setFailure(undefined)
    try {
      const saved = await executeSaveOperation(operation)
      if (!live.current) return false
      if (latest.current.selected?.id === saved.id) {
        latest.current.selected = saved
        if (sameContent(latest.current.content, operation.body.content)) latest.current.content = saved.content
      }
      setVersions(rows => rows.map(row => row.id === saved.id ? saved : row))
      // 成功响应只清理本次发送的内容；请求期间继续编辑的输入仍为未保存。
      setDraft(previous => previous?.versionId === saved.id && sameContent(previous.content, operation.body.content) ? undefined : previous)
      pendingSave.current = undefined
      recoveryUndo.current = recoveryUndo.current.slice(operation.operationCount)
      persistEditing()
      return true
    } catch (error) {
      if (!live.current) return false
      if (error instanceof ApiError && [400, 409, 422].includes(error.status)) pendingSave.current = undefined
      persistEditing()
      setFailure({ versionId: operation.versionId, message: directingError(error) })
      return false
    } finally { if (live.current) setBusy(undefined) }
  }

  const save = (): Promise<boolean> => {
    if (inFlight.current) return inFlight.current
    if (copyLock.current && !pendingSave.current) return Promise.resolve(false)
    const request = saveOnce().finally(() => { inFlight.current = undefined })
    inFlight.current = request
    return request
  }

  const copyVersion = async () => {
    if (copyRunning.current || readonly || handingOff || leaving || deliveryBusy || exportBusy || loadState !== 'ready' || copyInitial.error) return
    const origin = latest.current
    if (!copyPending && (!origin.selected || !origin.content || recovery)) return
    copyRunning.current = true; copyLock.current = true
    setCopyBusy(true); setCopyError('')
    let intent = copyPending
    try {
      if (!intent) {
        const snapshot = structuredClone(origin.content!)
        // 只核实已经发出的保存，不为复制发起新保存。
        if (inFlight.current && !await inFlight.current) throw new Error('原保存尚未成功核实，未创建副本；请先处理保存结果。')
        if (pendingSave.current && !await save()) throw new Error('原保存尚未成功核实，未创建副本；请先处理保存结果。')
        if (directVideos.storageError || directVideos.pending.some(row => row.versionId === origin.selected!.id)) throw new Error('视频提交结果尚未核实，请先核实原视频请求。')
        if (localStorage.getItem(`jellyfish:scene-design-request:${projectId}:${sequenceId}:${origin.selected!.id}`)) throw new Error('设计提交结果尚未核实，请先核实原设计请求。')
        const prefixes = [`jellyfish:instruction-check:${projectId}:${sequenceId}:${origin.selected!.id}:`, `jellyfish:scene-instruction-request:${projectId}:${sequenceId}:${origin.selected!.id}:`]
        for (let index = 0; index < localStorage.length; index++) {
          const key = localStorage.key(index)
          if (key && prefixes.some(prefix => key.startsWith(prefix))) throw new Error('指令或检查提交结果尚未核实，请先在指令画布核实原请求。')
        }
        const ready = await StudioDirectingService.directingSceneCopyReadiness({ projectId, sequenceId, versionId: origin.selected!.id })
        if (!ready.data) throw new Error('关联任务读取失败，未创建副本。')
        if (!ready.data.ready) throw new Error(`关联任务尚未结束：${ready.data.blockers.map(row => `${row.title}（${row.status}）`).join('；')}`)
        const base = latest.current.selected!
        intent = { versionId: base.id, base, undo: [...recoveryUndo.current], body: { request_id: crypto.randomUUID(), expected_revision: base.revision, title: `${base.title}（副本）`, content: snapshot } }
        localStorage.setItem(copyKey, JSON.stringify(intent))
        setCopyPending(intent)
      }
      const result = await StudioDirectingService.directingCopySceneVersion({ projectId, sequenceId, versionId: intent.versionId, requestBody: intent.body })
      if (!result.data) throw new Error('创建结果尚未核实，请核实原另存请求。')
      if (!live.current) return
      // 清理失败时保留同一请求，下次核实不会重复创建。
      clearSceneRecovery()
      localStorage.removeItem(copyKey)
      const created = result.data
      setRecovery(undefined); setDraft(undefined); setFailure(undefined)
      pendingSave.current = undefined; recoveryUndo.current = []
      latest.current = { selected: created, content: created.content }
      setVersions(rows => [...rows.filter(row => row.id !== created.id), created])
      setCopyPending(undefined)
      recoveryNavigation.current = true
      select(created.id)
    } catch (cause) {
      if (!live.current) return
      if (intent && cause instanceof ApiError && [400, 409, 422].includes(cause.status)) {
        try {
          writeSceneRecovery({ format: 1, projectId, chapterId, sequenceId, base: intent.base, content: intent.body.content as SceneVersionContent_Output, undo: intent.undo })
          localStorage.removeItem(copyKey)
          latest.current = { selected: intent.base, content: intent.body.content as SceneVersionContent_Output }
          setVersions(rows => rows.map(row => row.id === intent!.base.id ? intent!.base : row))
          setDraft({ versionId: intent.versionId, content: intent.body.content as SceneVersionContent_Output })
          recoveryUndo.current = intent.undo
          histories.current.set(intent.versionId, { undo: [...intent.undo], redo: [] })
          setCopyPending(undefined); setRecovery(undefined)
        } catch { setCopyError('另存已被拒绝，但本地恢复凭据尚未整理完成，请恢复存储后核实原请求。'); return }
      }
      setCopyError(directingError(cause))
    } finally { copyRunning.current = false; if (live.current) setCopyBusy(false) }
  }

  const generateVideo = (unitId: string) => {
    const origin = latest.current
    if (copyLock.current || !origin.selected || !origin.content || readonly || busy || recovery || handingOff || leaving || pendingSave.current || inFlight.current || !ownership.canEdit()) return
    if (!origin.content.units.some(unit => unit.id === unitId)) return
    if (sameContent(origin.content, origin.selected.content)) {
      directVideos.submit({ projectId, sequenceId, versionId: origin.selected.id, unitId,
        unitLabel: `单元 ${origin.content.units.findIndex(unit => unit.id === unitId) + 1}`, versionTitle: origin.selected.title,
        request: { request_id: crypto.randomUUID(), expected_revision: origin.selected.revision } })
      return
    }
    const operation: SaveOperation = { versionId: origin.selected.id, operationCount: recoveryUndo.current.length,
      videoOnly: sameContent(origin.content, origin.selected.content),
      body: { request_id: crypto.randomUUID(), expected_revision: origin.selected.revision, content: structuredClone(origin.content) },
      video: { unitId, requestId: crypto.randomUUID() } }
    try {
      writeSceneRecovery({ format: 1, projectId, chapterId, sequenceId, base: origin.selected, content: origin.content, undo: recoveryUndo.current, pending: operation })
    } catch (error) { setStorageError(`未获得崩溃恢复保护，视频尚未提交。${String(error)}`); return }
    pendingSave.current = operation
    setStorageError('')
    void save()
  }

  const retryVideo = (unitId: string, executionId: string) => {
    const origin = latest.current
    if (copyLock.current || !origin.selected || readonly || recovery || handingOff || leaving || !ownership.canEdit()) return
    const index = origin.content?.units.findIndex(unit => unit.id === unitId) ?? -1
    if (index < 0) return
    directVideos.submit({ projectId, sequenceId, versionId: origin.selected.id, unitId, executionId,
      unitLabel: `单元 ${index + 1}`, versionTitle: origin.selected.title, request: { request_id: crypto.randomUUID() } })
  }

  // 离开前逐次保存请求期间产生的新输入；未知结果沿用原请求身份核实。
  const flushSave = async () => {
    if (inFlight.current && !await inFlight.current) return false
    while (live.current && (hasChanges() || pendingSave.current)) {
      if (!await save()) return false
    }
    return live.current
  }
  ownership.handoff.current = async action => {
    if (action === 'cancel') { setHandingOff(false); return 'ready' }
    if (copyLock.current || !ownership.canEdit() || recovery || busy === 'create' || loadState !== 'ready' || transitionActive.current) return 'failed'
    setHandingOff(true)
    if (inFlight.current && !await inFlight.current) { setHandingOff(false); return 'failed' }
    if (action === 'request' && !autoSave && (hasChanges() || pendingSave.current)) return 'choice'
    if (action === 'discard') {
      if (pendingSave.current && !await save()) { setHandingOff(false); return 'failed' }
      latest.current.content = latest.current.selected?.content
      setDraft(undefined)
      setFailure(undefined)
      persistEditing()
    } else if (!await flushSave()) { setHandingOff(false); return 'failed' }
    return 'ready'
  }
  const requestTransition = async (next: Transition) => {
    if (copyLock.current) { next.cancel?.(); return }
    if (transitionActive.current) return
    transitionActive.current = true
    setLeaving(true)
    if (busy === 'create' || recovery || handingOff || exportBusy) {
      next.cancel?.()
    } else if (inFlight.current && !await inFlight.current) {
      next.cancel?.()
      restoreEditing()
    } else if (!hasChanges() && !pendingSave.current) {
      next.action()
    } else if (autoSave) {
      if (await flushSave()) next.action()
      else { next.cancel?.(); restoreEditing() }
    } else {
      setTransition(next)
      setLeaving(false)
      return
    }
    transitionActive.current = false
    if (live.current) setLeaving(false)
  }
  const cancelTransition = () => {
    transition?.cancel?.()
    setTransition(undefined)
    transitionActive.current = false
  }
  const finishTransition = async (keep: boolean) => {
    if (!transition || leaving) return
    setLeaving(true)
    // 结果不明时不能直接放弃：先核实在途保存是否已写入。
    if (keep ? !await flushSave() : pendingSave.current && !await save()) {
      setLeaving(false)
      return
    }
    if (!keep) {
      latest.current.content = latest.current.selected?.content
      setDraft(undefined)
      setFailure(undefined)
      persistEditing()
    }
    const action = transition.action
    setTransition(undefined)
    transitionActive.current = false
    action()
    if (live.current) setLeaving(false)
  }
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (recoveryNavigation.current) { recoveryNavigation.current = false; return false }
    const changesContext = currentLocation.pathname !== nextLocation.pathname ||
      new URLSearchParams(currentLocation.search).get('version') !== new URLSearchParams(nextLocation.search).get('version')
    return changesContext && (copyLock.current || hasChanges() || !!inFlight.current || !!pendingSave.current || busy === 'create' || !!recovery || handingOff)
  })
  useEffect(() => {
    if (blocker.state === 'blocked') void requestTransition({ action: blocker.proceed, cancel: blocker.reset })
  }, [blocker])
  useBeforeUnload(event => {
    if (copyLock.current || hasChanges() || inFlight.current || pendingSave.current || busy === 'create') {
      event.preventDefault()
      event.returnValue = ''
    }
  })

  const locateVideoUnit = async (target: { versionId: string; unitId: string; executionId?: string }) => {
    const versionContent = latest.current.selected?.id === target.versionId ? latest.current.content :
      (await StudioDirectingService.directingSceneVersion({ projectId, sequenceId, versionId: target.versionId })).data?.content
    const unit = versionContent?.units.find(item => item.id === target.unitId)
    const shotId = unit?.coverage[0]?.shot_id
    if (!unit || !shotId || !versionContent?.design.direction.shots.some(shot => shot.id === shotId)) {
      throw new Error('原视频单元或关联镜头已不可用，未切换或选择替代对象')
    }
    if (target.executionId) {
      const records = await StudioDirectingService.directingSceneVideos({ projectId, sequenceId, versionId: target.versionId, unitId: target.unitId })
      if (!records.data?.some(row => row.execution_id === target.executionId)) throw new Error('原视频执行未能核实，请重试；未选择替代记录')
    }
    const action = () => {
      if (latest.current.selected?.id !== target.versionId) select(target.versionId)
      setVideoFocus(target.executionId ? { versionId: target.versionId, unitId: target.unitId, executionId: target.executionId, serial: Date.now() } : undefined)
      setEditor(undefined); setCanvas('instructions')
      setShotSelections(previous => ({ ...previous, [target.versionId]: shotId }))
      rememberUnit(target.versionId, shotId, target.unitId)
    }
    if (latest.current.selected?.id === target.versionId) action()
    else await requestTransition({ action })

  }
  const openTaskOrigin = async () => {
    if (!historyVersionId || !historyTaskId || historyNavigating) return
    const request = ++historyNavigationRequest.current
    const isCurrent = () => live.current && request === historyNavigationRequest.current
    setHistoryNavigating(true); setHistoryNavigationError('')
    try {
      const target = { projectId, sequenceId, versionId: historyVersionId, unitId: historyUnitId || '' }
      const records = historyTaskKind === 'design' ? await StudioDirectingService.directingSceneDesignSuggestions(target) :
        historyTaskKind === 'instructions' ? await StudioDirectingService.directingSceneInstructionSuggestions(target) :
          historyTaskKind === 'checks' ? await StudioDirectingService.directingInstructionChecks(target) :
            historyTaskKind === 'videos' ? await StudioDirectingService.directingSceneVideos(target) : undefined
      if (!isCurrent()) return
      if (!records?.data?.some(row => row.task_id === historyTaskId)) throw new Error('原任务未能核实，未切换或选择替代记录。')
      const original = (await StudioDirectingService.directingSceneVersion(target)).data
      if (!isCurrent()) return
      if (!original) throw new Error('原版本未能核实，请重试。')
      const originContent = latest.current.selected?.id === historyVersionId ? latest.current.content : original.content
      const unit = originContent?.units.find(row => row.id === historyUnitId)
      const shotId = unit?.coverage[0]?.shot_id
      if (historyTaskKind !== 'design' && (!unit || !shotId || !originContent?.design.direction.shots.some(row => row.id === shotId))) throw new Error('原单元或关联镜头已不可用，未切换或选择替代对象。')
      await requestTransition({ action: () => {
        if (!isCurrent()) return
        const next = new URLSearchParams(params)
        for (const key of ['sceneTask', 'taskVersion', 'taskKind', 'taskUnit']) next.delete(key)
        next.set('version', historyVersionId)
        setParams(next)
        setEditor(undefined); setCanvas(historyTaskKind === 'design' ? 'director' : 'instructions')
        if (shotId && historyUnitId) {
          setShotSelections(previous => ({ ...previous, [historyVersionId]: shotId }))
          rememberUnit(historyVersionId, shotId, historyUnitId)
        }
      } })
    } catch (error) { if (isCurrent()) setHistoryNavigationError(directingError(error)) }
    finally { if (isCurrent()) setHistoryNavigating(false) }
  }
  const videoUnverified = !!pendingSave.current?.video
  const saveLabel = videoUnverified ? '核实原视频请求' : '保存'
  const status = recovery ? '有待核实的本地编辑' : busy === 'save' ? (videoUnverified ? (pendingSave.current?.videoOnly ? '正在核实视频请求' : '正在保存并核实视频请求') : '保存中') : videoUnverified ? '视频提交待核实' : failure?.versionId === selected?.id && failure?.versionId ? '保存失败' : dirty ? '未保存' : currentDirectVideo ? (currentDirectVideo.submitting ? '正在核实视频请求' : '视频提交待核实') : '已保存'
  useEffect(() => {
    if (copyLock.current || copyError || !autoSave || !dirty || busy || deliveryBusy || exportBusy || failure || readonly || transition || leaving || recovery || handingOff) return
    const timer = window.setTimeout(() => { void save() }, 500)
    return () => window.clearTimeout(timer)
  }, [autoSave, dirty, draft, busy, deliveryBusy, exportBusy, copyLocked, copyError, failure, readonly, transition, leaving, recovery, handingOff])

  return <SourceProvider projectId={projectId} sequenceId={sequenceId} renderRevision={source => <SceneSourceRevision key={`${source.revision_id}:${source.source.version}`} projectId={projectId} sequenceId={sequenceId} source={source} />}><WorkbenchTheme><section ref={node => { if (node) node.inert = copyLocked }} className="canvas-workbench" data-canvas={canvas} aria-label="场次画布工作台" onBlurCapture={event => {
    if (event.target instanceof HTMLTextAreaElement) {
      const element = event.target
      lastEditing.current = { element, start: element.selectionStart, end: element.selectionEnd, scrollTop: element.scrollTop }
    }
  }} onKeyDown={event => {
    if (!(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing || event.altKey) return
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return
    const key = event.key.toLowerCase()
    if (key === 'z' || key === 'y') {
      event.preventDefault()
      stepHistory(key === 'y' || event.shiftKey ? 'redo' : 'undo')
    }
  }}>
    <header ref={toolbar} className="canvas-workbench-toolbar">
      <div className="canvas-toolbar-identity">
        <Link className="canvas-back" title="返回章节" aria-label="返回章节" to={`/projects/${projectId}/chapters/${chapterId}/sequences`}><ArrowLeftOutlined /></Link>
        <strong className="canvas-sequence-name" title={sequence?.title}>{sequence?.title || '场次工作台'}</strong>
        <CanvasToolbarMenu label="版本管理" caption={<span className="canvas-menu-caption"><span className="canvas-version-name">{selected?.title || '场次版本'}</span><DownOutlined className="canvas-menu-chevron" /></span>}>
          <h3>场次版本</h3>
          <Select aria-label="场次版本" placeholder="尚无场次版本" value={selectedId} disabled={handingOff || !!recovery || busy === 'create' || leaving || loadState !== 'ready'}
            options={versions.map(row => ({ value: row.id, label: row.title }))} onChange={select} />
          <WorkbenchButton data-menu-close onClick={() => void requestTransition({ action: () => { void create() } })} disabled={handingOff || !!recovery || busy === 'create' || leaving || readonly || loadState !== 'ready'} loading={busy === 'create'}>新建场次版本</WorkbenchButton>
          <WorkbenchButton data-menu-close disabled={!selected || readonly || !!recovery || handingOff || leaving || deliveryBusy || exportBusy || busy === 'create' || loadState !== 'ready'} onClick={() => void copyVersion()}>另存为新版本</WorkbenchButton>
        </CanvasToolbarMenu>
        <CanvasToolbarMenu label="保存设置" caption={<span role="status" aria-live="polite">{!selected ? loadState === 'loading' ? '读取中' : '尚无版本' : sequence?.is_current === false ? '历史场次 · 只读' : readonly ? '只读' : status}</span>}>
          <label>自动保存 <Switch aria-label="自动保存" checked={autoSave} onChange={value => {
            setAutoSave(value)
            try { localStorage.setItem(autoSavePreference, value ? 'on' : 'off') } catch { /* 存储不可用时仍可在本页选择。 */ }
          }} /></label>
        </CanvasToolbarMenu>
        {selected && <WorkbenchIconButton label={saveLabel} variant={dirty || videoUnverified ? "primary" : "quiet"} icon={<SaveOutlined />} onClick={() => void save()} disabled={handingOff || !!recovery || (!dirty && !pendingSave.current) || !!busy || deliveryBusy || exportBusy || readonly || loadState !== 'ready'} loading={busy === 'save'} />}
      </div>
      <nav className="canvas-toolbar-views" aria-label="画布切换">
        <WorkbenchButton onClick={() => { setEditor(undefined); setCanvas('director') }} variant="quiet" aria-pressed={canvas === 'director'}>导演画布</WorkbenchButton>
        <WorkbenchButton disabled={!selected} onClick={() => { setEditor(undefined); setCanvas('units') }} variant="quiet" aria-pressed={canvas === 'units'}>单元画布</WorkbenchButton>
        <WorkbenchButton disabled={!selected} onClick={() => { setEditor(undefined); setCanvas('instructions') }} variant="quiet" aria-pressed={canvas === 'instructions'}>指令画布</WorkbenchButton>
        <WorkbenchButton disabled={!selected} onClick={() => { setEditor(undefined); setCanvas('edit') }} variant="quiet" aria-pressed={canvas === 'edit'}>编辑画布</WorkbenchButton>
      </nav>
      <div className="canvas-toolbar-actions">
        <div ref={setPrimaryHost} className="canvas-toolbar-primary" />
        <TaskCenter workbench />
        <div ref={setNavigationHost} className="canvas-toolbar-navigation" />
        <CanvasToolbarMenu label="更多操作" icon={<MoreOutlined />}>
          <div className="canvas-more-actions" ref={setMoreHost} />
          <div className="canvas-more-actions" data-menu-close>
            {selected && content && <SceneVideoBatch activities={videoActivities.filter(row => row.versionId === selected.id)} pending={directVideos.pending.filter(row => row.versionId === selected.id)} storageError={directVideos.storageError}
              onVerify={unitId => { const request = directVideos.pending.find(row => row.versionId === selected.id && row.unitId === unitId); if (request) void directVideos.retry(request) }} key={`batch:${selected.id}`} projectId={projectId} sequenceId={sequenceId} version={selected} content={content}
              disabled={readonly || !!busy || handingOff || !!recovery || leaving || !!pendingSave.current || loadState !== 'ready'}
              onLocate={unitId => locateVideoUnit({ versionId: selected.id, unitId })}
              onSubmit={preparation => {
                if (!ownership.canEdit() || !selected || preparation.version_id !== selected.id) return false
                return directVideos.submit({ projectId, sequenceId, versionId: selected.id, unitId: preparation.unit_id,
                  versionTitle: selected.title, unitLabel: `单元 ${content.units.findIndex(unit => unit.id === preparation.unit_id) + 1}`,
                  request: { request_id: crypto.randomUUID(), expected_revision: selected.revision, expected_preparation: preparation } })
              }} />}
          </div>
          <div className="canvas-more-actions">
            {selected && content && <SceneExportPanel feedbackHost={feedbackHost} triggerHost={canvas === 'edit' || currentExportBusy ? primaryHost : undefined} key={`export:${selected.id}`} projectId={projectId} sequenceId={sequenceId} versionId={selected.id} dirty={dirty}
              content={content} historical={sequence?.is_current === false}
              currentClipIds={content.timeline.items.map(item => item.id)} onLocate={clipId => { setEditor(undefined); setCanvas('edit'); setMediaFocus({ versionId: selected.id, target: { kind: 'clip', clipId }, serial: Date.now() }) }}
              focusTaskId={exportVersionId === selected.id ? params.get('exportTask') || undefined : undefined} onClose={closeExportHistory}
              disabled={(readonly && sequence?.is_current !== false) || !!busy || deliveryBusy || historyExportBusy || handingOff || !!recovery || leaving || !!pendingSave.current || loadState !== 'ready'} onBusy={setExportBusy}
              onSave={async () => {
                const target = latest.current.selected
                const submitted = latest.current.content
                if (!target || !submitted || !ownership.canEdit() || !(await save())) return undefined
                const response = await StudioDirectingService.directingSceneVersion({ projectId, sequenceId, versionId: target.id })
                if (!response.data || !sameContent(response.data.content, submitted)) throw new Error('保存结果与本次导出内容不一致，未提交导出；请核对后重试。')
                return response.data
              }} />}
            {selected && content && <SceneDeliveryPanel feedbackHost={feedbackHost} key={`delivery:${selected.id}`} projectId={projectId} chapterId={chapterId} sequenceId={sequenceId} versionId={selected.id}
              hasItems={!!content.timeline.items.length} disabled={readonly || !!busy || deliveryBusy || exportBusy || handingOff || !!recovery || leaving || !!pendingSave.current || loadState !== 'ready'} onBusy={setDeliveryBusy}
              onSave={async () => {
                const original = latest.current
                const target = original.selected
                const submitted = original.content
                if (!target || !submitted || !ownership.canEdit() || !(await save())) return undefined
                const response = await StudioDirectingService.directingSceneVersion({ projectId, sequenceId, versionId: target.id })
                if (!response.data || !sameContent(response.data.content, submitted)) throw new Error('保存结果与本次交付内容不一致，未更新章节；请重新核对后明确交付。')
                return response.data
              }} />}
          </div>
        </CanvasToolbarMenu>
      </div>
    </header>
    <nav className="canvas-history-controls" aria-label="编辑历史">
      <WorkbenchIconButton label="撤销" variant="quiet" icon={<UndoOutlined />} onClick={() => stepHistory('undo')} disabled={handingOff || !selected || !histories.current.get(selected.id)?.undo.length || readonly || leaving || busy === 'create'} />
      <WorkbenchIconButton label="重做" variant="quiet" icon={<RedoOutlined />} onClick={() => stepHistory('redo')} disabled={handingOff || !selected || !histories.current.get(selected.id)?.redo.length || readonly || leaving || busy === 'create'} />
    </nav>
    {selected && content && <SceneDesignSuggestions triggerHost={canvas === 'director' ? primaryHost : moreHost} key={`design:${selected.id}`} projectId={projectId} sequenceId={sequenceId} version={selected} content={content}
      disabled={readonly || handingOff || !!recovery || busy === 'create' || leaving} open={currentEditor === 'ai'}
      onOpenChange={open => open ? openEditor('ai') : setEditor(undefined)} onChange={editContent}
      onLocateUnit={locateUnitReference} />}
    {historyTaskId && <Modal rootClassName="canvas-workbench-dialog" title="任务固定记录 · 只读" open={!transition} width={900} styles={{ body: { maxHeight: '60vh', overflowY: 'auto' } }} onCancel={closeTaskHistory} footer={<Space><Button onClick={closeTaskHistory}>返回当前工作</Button><Button loading={historyNavigating} disabled={readonly || !!busy || !!recovery || handingOff || leaving} onClick={() => void openTaskOrigin()}>打开所属版本继续编辑</Button></Space>}>
      {historyNavigationError && <Alert type="warning" message={historyNavigationError} />}
      {historyVersionId && historyTaskKind === 'design' ? <OverviewDesignHistory key={`${historyVersionId}:${historyTaskId}`} projectId={projectId} sequenceId={sequenceId} versionId={historyVersionId} focusTaskId={historyTaskId} /> :
        historyVersionId && historyUnitId && (historyTaskKind === 'instructions' || historyTaskKind === 'checks' || historyTaskKind === 'videos') ? <OverviewUnitHistory key={`${historyVersionId}:${historyUnitId}:${historyTaskId}`} projectId={projectId} sequenceId={sequenceId} versionId={historyVersionId} unitId={historyUnitId} focusTaskId={historyTaskId} taskKind={historyTaskKind} /> :
          <Alert type="warning" message="任务原始归属不完整，无法核实固定记录。" />}
    </Modal>}
    {exportHistory && <SceneExportPanel key={`history-export:${exportHistory.id}`} projectId={projectId} sequenceId={sequenceId} versionId={exportHistory.id}
      content={exportHistory.content} dirty={false} historical={sequence?.is_current === false} historyOnly
      currentClipIds={[]} onLocate={() => {}} onSave={async () => undefined} onClose={closeExportHistory}
      focusTaskId={params.get('exportTask') || undefined} onBusy={setHistoryExportBusy}
      disabled={(readonly && sequence?.is_current !== false) || !!busy || deliveryBusy || currentExportBusy || handingOff || !!recovery || leaving || !!pendingSave.current || loadState !== 'ready'} />}
    {loadState === 'ready' && params.get('exportTask') && exportVersionId !== selectedId && !exportHistory && <Modal rootClassName="canvas-workbench-dialog" title="整场导出记录" open onCancel={closeExportHistory} footer={<Button onClick={closeExportHistory}>返回画布</Button>}>
      <Alert type="warning" message="导出所属版本不可用，未切换或替换当前编辑。" />
    </Modal>}
    <div className="scene-video-request-list">
      {directVideos.storageError && <Alert type="warning" message={directVideos.storageError} />}
      {directVideos.pending.map(row => <Alert key={row.request.request_id} type={row.error ? 'warning' : 'info'}
        message={`${row.versionTitle} · ${row.unitLabel}：${row.submitting ? '视频提交中' : '视频提交待核实'}`} description={row.error}
        action={<Button disabled={!ownership.editable || loadState !== 'ready' || !!row.submitting} onClick={() => void directVideos.retry(row)}>核实原视频请求</Button>} />)}
    </div>
    <div ref={notices} className="canvas-workbench-alerts">
      <div className="canvas-operation-feedback" ref={setFeedbackHost} />
      {copyError && !copyLocked && <Alert type="warning" message={copyError} closable onClose={() => setCopyError('')} />}
    {Object.entries(videoFeedback).map(([key, feedback]) => <Alert key={key} className="canvas-workbench-notice" type="info" message={feedback.message} description={feedback.error} closable
      action={<Button onClick={() => void locateVideoUnit(feedback).then(() => setVideoFeedback(previous => previous[key] ? { ...previous, [key]: { ...previous[key], error: undefined } } : previous)).catch(cause => setVideoFeedback(previous => previous[key] ? { ...previous, [key]: { ...previous[key], error: directingError(cause) } } : previous))}>{feedback.executionId ? '返回原视频执行' : '返回视频单元'}</Button>}
      onClose={() => setVideoFeedback(previous => Object.fromEntries(Object.entries(previous).filter(([id]) => id !== key)))} />)}
    {loadState === 'loading' && <div className="canvas-workbench-notice"><Spin /> 正在读取场次版本</div>}
    {['readonly', 'waiting', 'choice', 'unresponsive'].includes(ownership.state) && <Alert type="info"
      message={ownership.message || '此页只读，另一个工作台页面正在编辑'}
      description={ownership.state === 'unresponsive' && ownership.ownerUrl ? `原编辑页：${ownership.ownerUrl}` : undefined}
      action={<Space>
        <Button onClick={ownership.takeEditing} disabled={ownership.state === 'waiting' || ownership.state === 'choice'}>转到此页编辑</Button>
        {['waiting', 'unresponsive'].includes(ownership.state) && <Button onClick={ownership.cancelHandoff}>取消交接</Button>}
        {ownership.state === 'unresponsive' && <Button onClick={ownership.locateOwner}>定位原页</Button>}
      </Space>} />}
    {handingOff && <Alert type="info" message="另一个页面正在请求编辑，请先完成交接"
      action={<Button onClick={ownership.cancelHandoff}>取消交接</Button>} />}
    {ownership.state === 'unsupported' && <Alert type="warning" message="浏览器无法确认独占编辑能力，此页保持只读" />}
    {loadState === 'failed' && <Alert type="error" message="场次内容读取失败" description={loadError} action={<Button onClick={() => setAttempt(value => value + 1)}>重试读取</Button>} />}
    {failure && <Alert type="error" message={videoUnverified ? '视频提交结果未知，请核实原请求；输入已保留' : failure.versionId ? '保存失败，输入已保留' : '创建未完成'} description={failure.message} />}
    {storageError && <Alert type="warning" message={storageError} />}
    {loadState === 'ready' && !selected && selectedId && <Alert type="warning" message="原场次版本不可用，请重新选择" />}
    </div>
    <div className="scene-instruction-activity-list">{videoActivities.map(target => <SceneVideoActivity key={target.taskId} target={target}
      hidden={canvas === 'instructions' && selectedId === target.versionId && unitSelections[target.versionId] === target.unitId}
      onDismiss={() => setVideoActivities(previous => previous.filter(item => item.taskId !== target.taskId))}
      onLocate={() => locateVideoUnit(target)} />)}
    {instructionActivities.map(target => <SceneInstructionActivity key={target.taskId} target={target}
      hidden={canvas === 'instructions' && selectedId === target.versionId && unitSelections[target.versionId] === target.unitId}
      onDismiss={() => setInstructionActivities(previous => previous.filter(item => item.taskId !== target.taskId))}
      onLocate={async () => {
        const versionContent = latest.current.selected?.id === target.versionId ? latest.current.content :
          (await StudioDirectingService.directingSceneVersion({ projectId, sequenceId, versionId: target.versionId })).data?.content
        const unit = versionContent?.units.find(item => item.id === target.unitId)
        if (!unit || !versionContent?.design.direction.shots.some(shot => shot.id === target.shotId) || !unit.coverage.some(item => item.shot_id === target.shotId)) {
          throw new Error('原单元或关联镜头已不可用，未切换或选择替代对象')
        }
        const action = () => {
          if (latest.current.selected?.id !== target.versionId) select(target.versionId)
          setEditor(undefined); setCanvas('instructions')
          setShotSelections(previous => ({ ...previous, [target.versionId]: target.shotId }))
          rememberUnit(target.versionId, target.shotId, target.unitId)
          setInstructionSelection({ versionId: target.versionId, unitId: target.unitId, taskId: target.taskId })
          setInstructionActivities(previous => previous.filter(item => item.taskId !== target.taskId))
        }
        if (latest.current.selected?.id === target.versionId) action()
        else await requestTransition({ action })
      }} />)}</div>
    {loadState === 'ready' && canvas === 'edit' && selected && content && <SceneEditCanvas onOpenVersion={locateVideoUnit} navigation={mediaFocus?.versionId === selected.id ? mediaFocus : undefined} focusClipId={editClipFocus?.versionId === selected.id ? editClipFocus.clipId : undefined} onOpenUnit={unitId => {
      const unit = content.units.find(row => row.id === unitId)
      const shotId = unit?.coverage[0]?.shot_id
      if (!unit || !shotId || !content.design.direction.shots.some(row => row.id === shotId)) return
      rememberUnit(selected.id, shotId, unitId)
      setShotSelections(previous => ({ ...previous, [selected.id]: shotId }))
      setUnitFocus({ versionId: selected.id, unitId, nodeId: '单元设置', fieldId: 'scene-unit-dependencies', serial: Date.now() })
      setEditor(undefined); setCanvas('units')
    }} dirty={dirty} key={selected.id} projectId={projectId} sequenceId={sequenceId} versionId={selected.id} content={content} revision={selected.revision}
      disabled={readonly || handingOff || !!recovery || busy === 'create' || leaving} onChange={editContent} />}
    {loadState === 'ready' && canvas === 'instructions' && selected && content && <SceneInstructionCanvas primaryHost={primaryHost} onPrepare={(unitId, issue) => { setEditor(undefined); setCanvas('units'); setUnitFocus({ versionId: selected.id, unitId, nodeId: issue.nodeId || '单元设置', fieldId: issue.fieldId, serial: Date.now() }) }} focusRequest={instructionFocus} onVideoFocused={() => setVideoFocus(undefined)} videoFocus={videoFocus?.versionId === selected.id && videoFocus.unitId === unitSelections[selected.id] ? videoFocus : undefined} key={selected.id} projectId={projectId} sequenceId={sequenceId} versionId={selected.id} revision={selected.revision} content={content} onTask={trackInstruction} dirty={dirty} videoBusy={!!currentDirectVideo || !!pendingSave.current?.video && pendingSave.current.versionId === selected.id && pendingSave.current.video.unitId === unitSelections[selected.id]} savePending={!!busy || !!pendingSave.current}
      onVerifyVideo={!busy && pendingSave.current?.versionId === selected.id && pendingSave.current?.video?.unitId === unitSelections[selected.id]
        ? () => { void save() } : currentDirectVideo && !currentDirectVideo.submitting ? () => { void directVideos.retry(currentDirectVideo) } : undefined}
      videoRefresh={videoRefresh} onGenerateVideo={generateVideo} onRetryVideo={retryVideo}
      taskId={instructionSelection?.versionId === selected.id && instructionSelection.unitId === unitSelections[selected.id] ? instructionSelection.taskId : undefined}
      shotId={currentShotId} unitId={unitSelections[selected.id]} disabled={readonly || handingOff || !!recovery || busy === 'create' || leaving}
      onSelectUnit={selectUnit} onChange={editContent} />}
    {loadState === 'ready' && canvas === 'units' && selected && content && <SceneUnitCanvas primaryHost={primaryHost} key={selected.id} projectId={projectId} sequenceId={sequenceId} versionId={selected.id} revision={selected.revision} content={content} focusRequest={unitFocus}
      onOpenEdit={clipId => { setMediaFocus(undefined); setEditClipFocus({ versionId: selected.id, clipId }); setEditor(undefined); setCanvas('edit') }}
      onInstructionTask={trackInstruction}
      onOpenInstruction={taskId => { setInstructionSelection({ versionId: selected.id, unitId: unitSelections[selected.id], taskId }); setCanvas('instructions') }}
      shotId={currentShotId} unitId={unitSelections[selected.id]} disabled={readonly || handingOff || !!recovery || busy === 'create' || leaving}
      onSelectShot={selectShot}
      onSelectUnit={selectUnit} onChange={editContent} />}
    {loadState === 'ready' && canvas === 'director' && <DirectorCanvasSurface layoutScope={content && directorPreferenceKey === directorStorageKey ? {
      storageKey: directorStorageKey, viewId: showAllDesign ? 'all' : hasDirectorShot ? `shot:${currentShotId}` : 'empty', anchorId: directorAnchor,
      validIds: [...new Set(['原文依据', '全场共享', '镜头设计', ...designObjects(content.design).filter(node => node.key !== 'overview').map(node => graphIdentity(node.key)), ...scopeGraph(content.design, 'all').nodes.map(node => graphIdentity(node.key)), `location:${content.design.direction.location_asset_id || 'unlinked'}`])],
    } : undefined} focusTarget={directorFocus?.versionId === selected?.id ? directorFocus : undefined} key={selectedId || sequenceId} contextKey={`${sequenceId}:${selectedId || 'empty'}`} objects={graphObjects} relations={graphRelations} anchorTitle={hasDirectorShot ? `镜头 ${String(content!.design.direction.shots.findIndex(shot => shot.id === currentShotId) + 1).padStart(2, '0')}` : undefined}
      toolbar={selected && content && <>
        <Dropdown trigger={['click']} menu={{ items: content.design.direction.shots.map((shot, index) => ({ key: shot.id, label: `镜头 ${String(index + 1).padStart(2, '0')} · ${shot.visible_result.text || '未填写可见结果'}`, onClick: () => selectShot(shot.id) })) }}>
          <WorkbenchButton variant="secondary" aria-label="选择镜头">{hasDirectorShot ? `镜头 ${String(content.design.direction.shots.findIndex(shot => shot.id === currentShotId) + 1).padStart(2, '0')}` : currentShotId ? '原镜头不可用' : '选择镜头'} <DownOutlined /></WorkbenchButton>
        </Dropdown>
        <WorkbenchButton variant="quiet" disabled={readonly || handingOff || !!recovery || busy === 'create' || leaving} onClick={() => {
          const id = crypto.randomUUID()
          editContent({ ...content, design: { ...content.design, direction: { ...content.design.direction, shots: [...content.design.direction.shots, { id, beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: null, criterion_ids: [], narrative_function: { state: 'unset' }, visible_result: { state: 'unset' }, estimated_duration_ms: null }] } } })
          setShotSelections(previous => ({ ...previous, [selected.id]: id }))
          openEditor('shot')
        }}>手动添加镜头</WorkbenchButton>
        <WorkbenchButton variant="quiet" disabled={!hasDirectorShot} onClick={() => openEditor('shot')}>编辑当前镜头</WorkbenchButton>
        <Dropdown trigger={['click']} menu={{ items: [
          { key: 'overview', label: showAllDesign ? '收起全场设计总览' : '展开全场设计总览', onClick: () => setShowAllDesign(value => !value) },
          { key: 'evidence', label: showDesignEvidence ? '收起关联依据' : '查看关联依据', onClick: () => setShowDesignEvidence(value => !value) },
        ] }}><WorkbenchButton variant="quiet" aria-label="导演画布展示范围">展示范围 <DownOutlined /></WorkbenchButton></Dropdown>
      </>}
      tools={selected ? [{ label: '角色工具', onClick: trigger => openAssetTool('character', trigger) }, { label: '场所工具', onClick: trigger => openAssetTool('scene', trigger) }] : []}
      inspectors={{
        原文依据: selected ? () => openEditor('source') : undefined,
        全场共享: selected ? trigger => setDesignFocus({ versionId: selected.id, target: { path: ['direction'] }, trigger, serial: Date.now() }) : undefined,
        镜头设计: content?.design.direction.shots.some(shot => shot.id === currentShotId) ? trigger => { if (selected) setDesignFocus({ versionId: selected.id, target: { ...targetFor(content.design, ['direction', 'shots', content.design.direction.shots.findIndex(shot => shot.id === currentShotId)]), object: true }, trigger, serial: Date.now() }) } : undefined,
      }}>
      <section className="canvas-workbench-card" aria-label="原文依据">
        {selected && content ? <SceneSourceBasis key={selected.id} projectId={projectId} chapterId={chapterId} basis={content.basis} compact dirty={JSON.stringify(content.basis) !== JSON.stringify(selected.content.basis)}
          open={currentEditor === 'source'} onOpenChange={open => open ? openEditor('source') : setEditor(undefined)}
          disabled={readonly || handingOff || !!recovery || busy === 'create'} onChange={basis => editContent({ ...content, basis })} /> :
          <CanvasTextPreview text={sequence?.source_text || '原文尚未填写'} label="原文" />}
        {!selected && !selectedId && <p>尚无场次版本，明确新建后开始设计。</p>}
      </section>
      {selected && content && <section className="canvas-workbench-card" aria-label="全场概览">
        {(() => { const object = designObjects(content.design).find(node => node.key === 'overview'); return object && <DesignObjectSummary value={content.design} saved={selected.content.design} object={object} compact /> })()}
        <SceneDesignPanel navigationOpen={currentNavigation === 'designNavigation'} onNavigationOpenChange={open => open ? openNavigation('designNavigation') : setNavigation(undefined)} key={selected.id} projectId={projectId} value={content.design} saved={selected.content.design} units={content.units || []} onLocateUnit={locateUnitReference} disabled={handingOff || !!recovery || readonly || busy === 'create'}
          open={currentEditor === 'design'} onOpenChange={open => open ? openEditor('design') : setEditor(undefined)}
          focusRequest={designFocus?.versionId === selected.id ? designFocus : undefined} onSelectShot={selectShot} onFocusHandled={() => setDesignFocus(undefined)}
          onChange={design => editContent({ ...content, design })} />
        <Button onClick={() => openEditor('viewpoint')}>编辑叙事视点</Button>
        {!content.design.direction.shots.length && <WorkbenchButton onClick={() => openEditor('ai')}>前往 AI 设计</WorkbenchButton>}
        {currentEditor === 'viewpoint' && <CanvasQuickEditor title="叙事视点编辑" onClose={() => setEditor(undefined)}>
          <label htmlFor="scene-viewpoint">叙事视点</label>
          <Input.TextArea id="scene-viewpoint" aria-label="叙事视点" rows={6} value={content.design.direction.viewpoint.text || ''} disabled={handingOff || !!recovery || readonly || busy === 'create'}
          onChange={event => {
            const updated = { ...content, design: { ...content.design,
              direction: { ...content.design.direction, viewpoint: humanNote(event.target.value) } } }
            editContent(updated)
          }} />
        </CanvasQuickEditor>}
      </section>}
      {selected && content && <ManualSceneShots key={selected.id} value={content.design.direction}
        summary={(() => { const object = designObjects(content.design).find(node => node.key === `shot:${currentShotId}`); return object && <DesignObjectSummary value={content.design} saved={selected.content.design} object={object} compact /> })()}
        selectedId={currentShotId} onSelect={selectShot} compact
        editing={currentEditor === 'shot'} onEdit={() => openEditor('shot')} onClose={() => setEditor(undefined)}
        disabled={handingOff || !!recovery || readonly || busy === 'create'}
        onChange={direction => editContent({ ...content, design: { ...content.design, direction } })} />}
    </DirectorCanvasSurface>}
    {loadState === 'ready' && selected && content && <SceneRelationsNavigation triggerHost={navigationHost} open={currentNavigation === 'relations'} onOpenChange={open => open ? openNavigation('relations') : setNavigation(undefined)} projectId={projectId} sequenceId={sequenceId} versionId={selected.id} key={`relations:${selected.id}`} content={content} shotId={currentShotId} unitId={unitSelections[selected.id]} canvas={canvas} onNavigate={navigateRelation} />}
    <Modal rootClassName="canvas-workbench-dialog" title="有未保存的修改" open={!!transition} maskClosable={false} closable={!leaving} onCancel={cancelTransition}
      footer={<Space>
        <Button disabled={leaving} onClick={cancelTransition}>取消，继续编辑</Button>
        <Button disabled={leaving} onClick={() => void finishTransition(false)}>放弃修改并切换</Button>
        <Button type="primary" loading={leaving} onClick={() => void finishTransition(true)}>保存并切换</Button>
      </Space>}>
      <p>保存成功后再切换，或放弃尚未保存的输入。已保存的内容不会撤回。</p>
      {failure && <Alert type="error" message="保存未完成，请重试或取消切换" description={failure.message} />}
    </Modal>
    <Modal rootClassName="canvas-workbench-dialog" title="原编辑页有未保存修改" open={ownership.state === 'choice'}
      maskClosable={false} onCancel={ownership.cancelHandoff} footer={<Space>
        <Button onClick={ownership.cancelHandoff}>取消交接</Button>
        <Button onClick={() => ownership.chooseHandoff('discard')}>放弃修改并交接</Button>
        <Button type="primary" onClick={() => ownership.chooseHandoff('save')}>保存并交接</Button>
      </Space>}><p>原页先保存或明确放弃未保存输入，再把编辑权交给此页。</p></Modal>
    <Modal rootClassName="canvas-workbench-dialog" title="发现未保存编辑" open={!!recovery} closable={false} maskClosable={false} keyboard={false} footer={<Space wrap>
      {recovery?.stage === 'foreign' && recovery.data && <Link
        onClick={() => { recoveryNavigation.current = true }}
        to={`/projects/${recovery.data.projectId}/chapters/${recovery.data.chapterId}/sequences/${recovery.data.sequenceId}?version=${recovery.data.base.id}`}>返回待恢复版本</Link>}
      {['unknown', 'conflict'].includes(recovery?.stage || '') && <Button onClick={() => setAttempt(value => value + 1)}>重新核实保存结果</Button>}
      <Button disabled={recovery?.stage === 'checking' || recovery?.stage === 'unknown' || (!!recovery?.data?.pending && recovery?.stage === 'foreign')}
        onClick={discardRecovery}>丢弃本地编辑</Button>
      {recovery?.stage === 'available' && <Button type="primary" onClick={restoreRecovery}>恢复编辑</Button>}
    </Space>}>
      <p>{recovery?.stage === 'checking' ? '正在核实原保存结果，请稍候。' : recovery?.stage === 'foreign' ? '另一个场次版本还有待处理的编辑，请先返回处理或明确丢弃。' :
        recovery?.stage === 'available' ? '已核实服务器内容。恢复仅找回尚未保存的编辑，不会重新执行生成或导出。' : '已保留本地数据，核实完成前不能覆盖服务器内容。'}</p>
      {recovery?.message && <Alert type="warning" message={recovery.message} />}
    </Modal>
  </section>
    <Modal rootClassName="canvas-workbench-dialog" title={copyBusy ? '正在另存为新版本' : '另存结果待核实'} open={copyLocked} closable={false} maskClosable={false} keyboard={false} getContainer={() => document.body}
      footer={copyBusy ? null : <Button disabled={!!copyInitial.error || readonly || loadState !== 'ready'} onClick={() => void copyVersion()}>核实原另存请求</Button>}>
      {copyBusy && <Spin />}<p>正在保护点击时的完整编辑，核实完成前请勿离开。不会为另存额外保存原版本，也不会重新执行生成任务。</p>
      {copyError && <Alert type="warning" message={copyError} />}
    </Modal>
  </WorkbenchTheme></SourceProvider>
}

/** 路由上下文改变时隔离在途响应；版本之间仍共用同一工作台。 */
export default function CanvasSequenceWorkbench() {
  const ownership = useSceneEditOwnership()
  const { projectId, chapterId, sequenceId } = useParams()
  if (!projectId || !chapterId || !sequenceId) return <Alert type="error" message="场次地址不完整" />
  return <Workbench key={`${projectId}:${chapterId}:${sequenceId}`} projectId={projectId} chapterId={chapterId} sequenceId={sequenceId} ownership={ownership} />
}
