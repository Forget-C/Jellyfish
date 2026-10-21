import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Select, Space, Switch, Tooltip } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CloseOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import type { EditableSceneDesign_Output, SceneRelationshipGraph, SceneVersionContent_Output } from '../../../services/generated'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'
import type { DirectorCanvasObject, DirectorCanvasRelation } from './DirectorCanvasSurface'
import { WorkbenchButton, WorkbenchIconButton } from './ui/WorkbenchButton'
import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { DesignObjectSummary } from './DesignObjectSummary'
import { designLabels } from './designLabels'
import { SceneDesignPanel, resolveTarget, targetFor } from './SceneDesignPanel'
import type { DesignFocusRequest, DesignTarget } from './SceneDesignPanel'
import { SceneAssetLinks } from './SceneAssetLinks'
import { DirectorLocationSummary } from './DirectorLocationSummary'
import { DirectorShotEntry } from './DirectorShotEntry'
import { directorDesignNodeSize, shotDesignGroup } from './directorLayout'
import { designAt } from './designValue'
import { authoritativeShotCanvasProjection, designObjectLayoutId, designObjects, reorderScopeShots } from './designWorkspace'
import type { DesignObject } from './designWorkspace'
import type { UnitReferenceConflict } from './sceneUnitReferences'

type BrowseState = { scope: 'all' | 'shot'; focus?: string; shotId?: string }
type BrowseTrail = { entries: { key: string; index?: number }[]; cursor: number }
let directorFocusSerial = 0

/** 总览和逐镜子图共用当前场次版本；导航只记录版本内浏览现场。 */
export function DirectorDesignCanvas({ projectId, sequenceId, versionId, content, saved, relationshipGraph, shotId, onSelectShot, onRestoreShot, onChange, disabled, source, onPrepare, onLocateUnit, externalFocus, onExternalFocusHandled, noticeHost, navigationHost, nextHost, saveStatus }: {
  projectId: string; sequenceId: string; versionId: string; content: SceneVersionContent_Output; saved: SceneVersionContent_Output
  relationshipGraph: SceneRelationshipGraph
  shotId?: string; onSelectShot: (id: string) => void; onRestoreShot: (id: string) => void; onChange: (value: SceneVersionContent_Output) => void; disabled: boolean
  source: ReactNode; onPrepare: (shotId?: string) => void; onLocateUnit: (conflict: UnitReferenceConflict) => void
  externalFocus?: { nodeId: string; fieldId: string; serial: number }
  onExternalFocusHandled: () => void
  noticeHost: HTMLElement | null
  navigationHost: HTMLElement | null
  nextHost: HTMLElement | null
  saveStatus: string
}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation(), navigate = useNavigate(), navigationType = useNavigationType()
  const storageKey = `jellyfish:director-shots:local-user:${projectId}:${sequenceId}:${versionId}`
  const [remembered] = useState<BrowseState>(() => {
    try { return JSON.parse(localStorage.getItem(`${storageKey}:selection`) || '{}') || {} } catch { return { scope: 'all' } }
  })
  const readState = (): BrowseState => {
    return { scope: params.get('directorScope') === 'shot' ? 'shot' : 'all', focus: params.get('directorTarget') || undefined,
      shotId: params.get('directorShot') || shotId }
  }
  const state = readState()
  const activeShotId = state.shotId || shotId
  const hasShot = content.design.direction.shots.some(row => row.id === activeShotId)
  const scope = state.scope === 'shot' && hasShot ? 'shot' : 'all'
  const viewId = scope === 'shot' ? `shot:${activeShotId}` : 'overview'
  const [focusRequest, setFocusRequest] = useState<DesignFocusRequest>()
  const [editingTarget, setEditingTarget] = useState<DesignTarget>()
  const [identityAliases, setIdentityAliases] = useState<Record<string, string>>({})
  const [assetTarget, setAssetTarget] = useState<string>()
  const [unlinkedOpen, setUnlinkedOpen] = useState(false)
  const [infoOpenByView, setInfoOpenByView] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(`${storageKey}:info`) || '{}') || {} } catch { return {} }
  })
  const [inspectedRelation, setInspectedRelation] = useState<DirectorCanvasRelation>()
  const [unavailable, setUnavailable] = useState(false)
  const [editorContext, setEditorContext] = useState(0)
  const consumedFocus = useRef<number>()
  const focusSerial = useRef(0), lastLocation = useRef('')
  if (lastLocation.current !== location.key) { lastLocation.current = location.key; focusSerial.current = ++directorFocusSerial }
  const graphPending = JSON.stringify(content.design) !== JSON.stringify(saved.design)
  const projection = useMemo(() => authoritativeShotCanvasProjection(content.design, relationshipGraph), [content.design, relationshipGraph])
  const overviewGraph = useMemo(() => projection.view(), [projection])
  const allObjects = projection.objects
  const identity = (node: DesignObject, design = content.design) => designObjectLayoutId(design, node)
  const target = (id?: string) => allObjects.find(node => identity(node) === id)
  const graph = useMemo(() => scope === 'shot' ? projection.view(activeShotId) : overviewGraph,
    [scope, activeShotId, overviewGraph, projection])
  const pendingCount = relationshipGraph.nodes.filter(node => node.placement === 'pending_shot').length
  const unlinkedCount = relationshipGraph.nodes.filter(node => node.placement === 'unlinked').length
  const draftOnlyCount = projection.objects.filter(node => !relationshipGraph.nodes.some(savedNode => savedNode.key === node.key)).length
  const historyIndex = () => typeof window.history.state?.idx === 'number' ? window.history.state.idx as number : undefined
  const [trail, setTrail] = useState<BrowseTrail>(() => {
    const current = { key: location.key, index: historyIndex() }
    try {
      const stored = JSON.parse(sessionStorage.getItem(`${storageKey}:browse`) || 'null') as BrowseTrail | null
      const cursor = stored?.entries.findIndex(entry => entry.key === location.key || current.index !== undefined && entry.index === current.index) ?? -1
      if (navigationType === 'POP' && stored && cursor >= 0) {
        const entries = [...stored.entries]
        entries[cursor] = current
        return { entries, cursor }
      }
    } catch { /* 浏览记录不可读时从当前位置开始。 */ }
    return { entries: [current], cursor: 0 }
  })
  useEffect(() => {
    const current = { key: location.key, index: historyIndex() }
    setTrail(previous => {
      if (previous.entries[previous.cursor]?.key === current.key) return previous
      if (navigationType === 'POP') {
        const cursor = previous.entries.findIndex(entry => entry.key === current.key || current.index !== undefined && entry.index === current.index)
        if (cursor < 0) return { entries: [current], cursor: 0 }
        const entries = [...previous.entries]
        entries[cursor] = current
        return { entries, cursor }
      }
      if (navigationType === 'REPLACE') {
        const entries = [...previous.entries]
        entries[previous.cursor] = current
        return { entries, cursor: previous.cursor }
      }
      const entries = [...previous.entries.slice(0, previous.cursor + 1), current]
      return { entries, cursor: entries.length - 1 }
    })
  }, [location.key])
  useEffect(() => {
    try { sessionStorage.setItem(`${storageKey}:browse`, JSON.stringify(trail)) } catch { /* 浏览记录不可写时仍可在本页使用。 */ }
  }, [trail, storageKey])
  const canBrowse = (offset: -1 | 1) => {
    const current = trail.entries[trail.cursor], next = trail.entries[trail.cursor + offset]
    return current?.key === location.key && !!next && (current.index === undefined || next.index === undefined || next.index === current.index + offset)
  }
  const infoOpen = !!infoOpenByView[viewId]
  const setInfoOpen = (open: boolean) => {
    setInfoOpenByView(previous => {
      const next = { ...previous, [viewId]: open }
      try { localStorage.setItem(`${storageKey}:info`, JSON.stringify(next)) } catch { /* 浏览偏好不可写不影响附加信息。 */ }
      return next
    })
  }
  const nextParams = (next: BrowseState) => {
    const result = new URLSearchParams(params)
    result.set('directorView', next.scope === 'shot' ? 'shot' : 'outer'); result.set('directorScope', next.scope)
    result.delete('directorTemporary')
    for (const [key, value] of [['directorTarget', next.focus], ['directorShot', next.shotId]] as const) {
      if (value) result.set(key, value)
      else result.delete(key)
    }
    return result
  }
  const go = (next: BrowseState, sourceId?: string, replace = false) => {
    if (params.get('version') !== versionId) return
    if (!replace) { setEditorContext(value => value + 1); setAssetTarget(undefined) }
    if (sourceId && !replace) setParams(nextParams({ ...state, focus: sourceId, shotId: activeShotId }), { replace: true, state: location.state })
    setParams(nextParams({ ...next, shotId: next.shotId || activeShotId }), { replace, state: replace ? location.state : { directorBack: true } })
  }
  useLayoutEffect(() => {
    if (!params.has('directorView') && params.get('version') === versionId) {
      const initial = { ...remembered, scope: remembered.scope === 'shot' ? 'shot' as const : 'all' as const }
      setParams(nextParams({ ...initial, shotId: initial.shotId || shotId }), { replace: true })
    }
    if (state.shotId && state.shotId !== shotId && (!externalFocus || consumedFocus.current === externalFocus.serial)) onRestoreShot(state.shotId)
  }, [params.get('version'), params.get('directorView'), params.get('directorShot')])
  useEffect(() => {
    try { localStorage.setItem(`${storageKey}:selection`, JSON.stringify({ ...state, shotId })) } catch { /* 浏览偏好不可写不影响设计。 */ }
  }, [location.key, shotId])
  useEffect(() => setAssetTarget(undefined), [scope])
  useEffect(() => { if (navigationType === 'POP') setEditorContext(value => value + 1) }, [location.key])
  const jump = (node: DesignObject, from?: string) => {
    const id = identity(node), home = projection.location(node.key)
    if (home === 'unlinked') setUnlinkedOpen(true)
    const next = home === 'global' || home === 'shared' || home === 'unlinked'
      ? { scope: 'all' as const, focus: id, shotId: activeShotId }
      : { scope: 'shot' as const, focus: id, shotId: home }
    go(next, from, next.scope === scope && (next.scope === 'all' || next.shotId === activeShotId))
  }
  useEffect(() => {
    if (!state.focus || location.state?.directorBack || editingTarget) return
    const node = target(state.focus)
    if (!node) return
    const home = projection.location(node.key)
    if (home === 'unlinked') setUnlinkedOpen(true)
    if (home !== 'global' && home !== 'shared' && home !== 'unlinked' ? scope !== 'shot' || activeShotId !== home : scope !== 'all') {
      go({ scope: home === 'global' || home === 'shared' || home === 'unlinked' ? 'all' : 'shot', shotId: home, focus: state.focus }, undefined, true)
    }
  }, [location.key])
  useEffect(() => {
    if (scope === 'all' && state.focus) {
      const node = target(state.focus)
      if (node && graph.location(node.key) === 'unlinked') setUnlinkedOpen(true)
    }
  }, [scope, state.focus, content.design])
  useEffect(() => {
    if (!externalFocus || externalFocus.serial === consumedFocus.current) return
    consumedFocus.current = externalFocus.serial
    const node = allObjects.find(row => row.key === (externalFocus.nodeId === '镜头设计' ? `shot:${shotId}` : externalFocus.nodeId))
    if (node) {
      jump(node)
      if (externalFocus.fieldId === 'applicability') edit(node, document.activeElement instanceof HTMLElement ? document.activeElement : document.body)
    } else setUnavailable(true)
    onExternalFocusHandled()
  }, [externalFocus?.serial])
  useEffect(() => {
    if (state.focus && state.focus !== '原文依据' && !target(state.focus)) {
      setUnavailable(true)
      go({ ...state, focus: undefined }, undefined, true)
    }
  }, [state.focus, content.design])
  const edit = (node: DesignObject, trigger: HTMLElement) => {
    const next = { ...targetFor(content.design, node.path, true), object: true, fields: node.fields, label: node.fields ? node.label : undefined }
    setEditingTarget(next)
    setFocusRequest({ target: next, trigger, serial: Date.now(), side: true })
  }
  const changeDesign = (next: EditableSceneDesign_Output) => {
    const nextObjects = designObjects(next)
    const renamed: Record<string, string> = {}
    // 此处只处理一次人工修改中的唯一快照变化；删除、重排和重复内容不能建立身份别名。
    for (const prefix of ['activity:', 'situation:', 'camera:', 'performance:']) {
      const before = allObjects.filter(node => node.key.startsWith(prefix)), after = nextObjects.filter(node => node.key.startsWith(prefix))
      if (before.length !== after.length) continue
      const beforeIds = new Set(before.map(node => identity(node))), afterIds = new Set(after.map(node => identity(node, next)))
      const removed = before.filter(node => !afterIds.has(identity(node))), added = after.filter(node => !beforeIds.has(identity(node, next)))
      if (removed.length === 1 && added.length === 1 && removed[0].key === added[0].key) {
        const from = identity(removed[0]), to = identity(added[0], next)
        if (!from.includes(':ambiguous:') && !to.includes(':ambiguous:')) renamed[from] = to
      }
    }
    if (Object.keys(renamed).length) setIdentityAliases(previous => ({ ...Object.fromEntries(Object.entries(previous).map(([from, to]) => [from, renamed[to] || to])), ...renamed }))
    const editedPath = editingTarget?.object ? resolveTarget(content.design, editingTarget) : undefined
    const previousObject = editedPath && allObjects.find(node => JSON.stringify(node.path) === JSON.stringify(editedPath) &&
      (!editingTarget?.fields || JSON.stringify(node.fields) === JSON.stringify(editingTarget.fields)))
    const candidate = editedPath && nextObjects.find(node => JSON.stringify(node.path) === JSON.stringify(editedPath) &&
      (!editingTarget?.fields || JSON.stringify(node.fields) === JSON.stringify(editingTarget.fields)))
    const explicitSessionEdit = editingTarget?.sessionRow && editedPath &&
      designAt(content.design, editedPath.slice(0, -1))?.length === designAt(next, editedPath.slice(0, -1))?.length
    const edited = previousObject && candidate && (explicitSessionEdit || identity(previousObject) === identity(candidate, next) || renamed[identity(previousObject)] === identity(candidate, next)) ? candidate : undefined
    if (edited) setEditingTarget({ object: editingTarget?.object, fields: editingTarget?.fields, label: editingTarget?.label, ...targetFor(next, edited.path, true) })
    const created = nextObjects.find(node => {
      if (typeof node.path[node.path.length - 1] !== 'number') return false
      const parent = node.path.slice(0, -1), before = designAt(content.design, parent), after = designAt(next, parent)
      return Array.isArray(before) && Array.isArray(after) && after.length > before.length && node.path[node.path.length - 1] === after.length - 1
    })
    onChange({ ...content, design: next })
    if (created) {
      setAssetTarget(undefined)
      const nextTarget = { ...targetFor(next, created.path), object: true }
      setEditingTarget(nextTarget)
      setFocusRequest({ target: nextTarget, trigger: document.activeElement as HTMLElement, serial: Date.now(), side: true })
    } else if (edited && previousObject && explicitSessionEdit && identity(edited, next) !== identity(previousObject)) {
      const beforeId = identity(previousObject), nextId = identity(edited, next)
      go({ ...state, focus: state.focus === beforeId ? nextId : state.focus }, undefined, true)
    } else if (renamed[state.focus || '']) {
      go({ ...state, focus: renamed[state.focus || ''] || state.focus }, undefined, true)
    }
  }
  const addShot = () => changeDesign({ ...content.design, direction: { ...content.design.direction, shots: [...content.design.direction.shots, {
    id: crypto.randomUUID(), beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: null, criterion_ids: [],
    narrative_function: { state: 'unset' }, visible_result: { state: 'unset' }, estimated_duration_ms: null,
  }] } })
  const isReference = (node: DesignObject) => node.kind === 'reference'
  const currentShot = allObjects.find(node => node.key === `shot:${activeShotId}`)
  const editingPath = editingTarget?.object && resolveTarget(content.design, editingTarget)
  const editingNode = editingPath && allObjects.find(node => JSON.stringify(node.path) === JSON.stringify(editingPath) &&
    (!editingTarget?.fields || JSON.stringify(node.fields) === JSON.stringify(editingTarget.fields)))
  const editingHome = editingNode && graph.location(editingNode.key)
  const editingAway = editingNode && editingHome !== undefined && (scope === 'all' ? editingHome !== 'global' && editingHome !== 'shared' && (editingHome !== 'unlinked' || !unlinkedOpen)
    : editingHome !== activeShotId)
  const visibleNodes = scope === 'all' && unlinkedOpen ? [...graph.nodes, ...graph.unlinked] : graph.nodes
  const focusStillVisible = !state.focus || state.focus === '原文依据' || visibleNodes.some(node => identity(node) === state.focus)
  const visibleFocus = focusStillVisible ? state.focus : scope === 'shot' ? currentShot && identity(currentShot) : '原文依据'
  const objects: DirectorCanvasObject[] = visibleNodes.map(node => {
    const home = graph.location(node.key)
    const nodeUses = relationshipGraph.uses.filter(use => use.owner === node.key && use.has_content !== false)
    const isEntry = scope === 'all' && node.key.startsWith('shot:') && relationshipGraph.nodes.some(savedNode => savedNode.key === node.key)
    const open = (trigger: HTMLElement) => {
      if (isEntry) { onSelectShot(node.key.slice(5)); go({ scope: 'shot', shotId: node.key.slice(5) }, identity(node)) }
      else if (isReference(node)) jump(node, identity(node))
      else if (node.key === 'location') setAssetTarget('location')
      else if (node.kind !== 'missing') edit(node, trigger)
    }
    const shotNumber = isEntry ? content.design.direction.shots.findIndex(row => row.id === node.key.slice(5)) + 1 : 0
    return { id: identity(node), label: node.label, entry: isEntry, title: isEntry ? `聚合子图 · 镜头 ${String(shotNumber).padStart(2, '0')}` : isReference(node) ? `共享引用 · ${node.label}` : node.label,
      group: scope === 'shot' ? shotDesignGroup(node.key, node.kind, activeShotId!)
        : home === 'global' ? 'scene-global' : home === 'shared' ? 'scene-shared' : home === 'unlinked' ? 'scene-unlinked' : 'scene-entry',
      size: isEntry ? { width: 360, height: 276 } : directorDesignNodeSize(node),
      related: home === 'shared', onInspect: node.kind === 'missing' ? undefined : open,
      content: isEntry ? <DirectorShotEntry value={content.design} saved={saved.design} shotId={node.key.slice(5)} storageKey={storageKey} graph={projection.view(node.key.slice(5))} />
        : <section className={`canvas-workbench-card${isReference(node) ? ' director-reference-card' : ' director-design-card'}`}>
        {home === 'global' && <p>{nodeUses.some(use => use.purpose === 'constraint')
          ? nodeUses.some(use => use.purpose === 'background') ? '场次背景与规则 · 逐项查看用途' : '全场规则'
          : '场次背景 · 无需逐镜关联 · 不自动执行'}</p>}
        {home === 'unlinked' && <p>{!relationshipGraph.nodes.some(item => item.key === node.key) ? '未保存新增 · 保存后更新关系图' :
          `${relationshipGraph.nodes.find(item => item.key === node.key)?.placement === 'pending_shot' ? '待归镜头' : '未关联'} · ${relationshipGraph.nodes.find(item => item.key === node.key)?.reason}`}</p>}
        {isReference(node) ? <>
          <p>共享引用 · 只读定位</p>
          <WorkbenchButton onClick={() => jump(node, identity(node))}>定位共享原卡</WorkbenchButton>
        </> : node.key === 'location' ? <>
          <DirectorLocationSummary projectId={projectId} assetId={content.design.direction.location_asset_id} />
          <WorkbenchButton disabled={disabled} onClick={() => setAssetTarget('location')}>编辑场所资产绑定</WorkbenchButton>
        </> : <>
          <DesignObjectSummary value={content.design} saved={saved.design} object={node} relationshipGraph={relationshipGraph} compact />
          {node.kind !== 'missing' && <Space wrap><WorkbenchButton disabled={disabled} onClick={event => edit(node, event.currentTarget)}>编辑此卡</WorkbenchButton>
            {node.key.startsWith('shot:') && ([-1, 1] as const).map(offset => {
              const index = content.design.direction.shots.findIndex(row => `shot:${row.id}` === node.key)
              const destination = content.design.direction.shots[index + offset]
              return <WorkbenchButton key={offset} variant="quiet" disabled={disabled || !destination} onClick={() => changeDesign(reorderScopeShots(content.design,
                content.design.direction.shots.map(row => row.id), node.key.slice(5), destination.id))}>{offset < 0 ? '镜头前移' : '镜头后移'}</WorkbenchButton>
            })}
          </Space>}
          {node.key.startsWith('participant:') && <WorkbenchButton disabled={disabled} onClick={() => setAssetTarget(node.key)}>编辑资产绑定</WorkbenchButton>}
          {node.kind === 'missing' && <WorkbenchButton onClick={() => {
            const owner = allObjects.find(row => row.key === graph.edges.find(edge => edge.to === node.key)?.from)
            if (owner) jump(owner)
          }}>定位引用者</WorkbenchButton>}
        </>}
      </section> }
  })
  if (scope === 'all') objects.unshift({ id: '原文依据', label: '原文依据', title: '原文依据', onInspect: undefined, related: false, content: <section className="canvas-workbench-card">{source}</section> })
  const relations = graph.edges.filter(edge => visibleNodes.some(node => node.key === edge.from) && visibleNodes.some(node => node.key === edge.to)).map(edge => ({ ...edge,
    from: identity(allObjects.find(node => node.key === edge.from) || { key: edge.from, path: [], kind: '', label: '' }),
    to: identity(allObjects.find(node => node.key === edge.to) || { key: edge.to, path: [], kind: '', label: '' }),
    sources: edge.sources.map(row => ({ ...row, fromLabel: allObjects.find(node => node.key === row.from)?.label,
      toLabel: allObjects.find(node => node.key === row.to)?.label })) }))
  const currentRelation = inspectedRelation && relations.find(row => row.from === inspectedRelation.from && row.to === inspectedRelation.to && row.label === inspectedRelation.label)
  const locationOptions = [...graph.nodes, ...(scope === 'all' ? graph.unlinked : [])].filter(node => node.kind !== 'missing')
  const activeShotNumber = content.design.direction.shots.findIndex(row => row.id === activeShotId) + 1
  useEffect(() => setInspectedRelation(undefined), [viewId])
  let restore = false
  try { restore = navigationType === 'POP' && !!localStorage.getItem(`${storageKey}:view:${viewId}`) } catch { /* 使用会话布局。 */ }
  return <>
    {navigationHost && createPortal(<nav className="canvas-director-browse" aria-label="导演画布位置">
      <WorkbenchIconButton label="后退" variant="quiet" icon={<ArrowLeftOutlined />} disabled={!canBrowse(-1)} onClick={() => navigate(-1)} />
      <WorkbenchIconButton label="前进" variant="quiet" icon={<ArrowRightOutlined />} disabled={!canBrowse(1)} onClick={() => navigate(1)} />
      <span className="canvas-director-location"><WorkbenchButton variant="quiet" aria-current={scope === 'all' ? 'page' : undefined}
        disabled={scope === 'all'} onClick={() => go({ scope: 'all', shotId: activeShotId })}>总览</WorkbenchButton>
        {scope === 'shot' && <span aria-current="page">› 镜头 {String(activeShotNumber).padStart(2, '0')} 子图</span>}</span>
      <WorkbenchIconButton label="附加信息" variant="quiet" icon={<InfoCircleOutlined />} aria-pressed={infoOpen}
        onClick={() => setInfoOpen(!infoOpen)} />
    </nav>, navigationHost)}
    {nextHost && !!content.design.direction.shots.length && createPortal(
      <Tooltip trigger={['hover', 'focus']} title={`${scope === 'shot' ? `进入镜头 ${activeShotNumber} 的` : '进入'}单元画布，建立或选择拍摄单元，填写动作范围、模型、时长和参考，再生成指令并检查。`}>
        <WorkbenchButton variant="primary" onClick={() => onPrepare(hasShot ? activeShotId : undefined)}>下一步：单元画布</WorkbenchButton>
      </Tooltip>, nextHost)}
    {noticeHost && createPortal(<>
      {graphPending && <Alert type="info" message={`关系图来自已保存 revision ${relationshipGraph.revision}；关系更新中`} />}
      {!graphPending && !!relationshipGraph.issues?.length && <Alert type="warning" message={`设计未完整 · ${relationshipGraph.issues.length} 项缺项`}
        action={<WorkbenchButton variant="quiet" onClick={() => setInfoOpen(true)}>查看设计缺项</WorkbenchButton>} />}
      {!graphPending && relationshipGraph.complete && <span role="status">设计范围完整</span>}
      {unavailable && <Alert type="warning" message="原对象不可用，请重新选择" closable onClose={() => setUnavailable(false)} />}
      {!focusStillVisible && <Alert type="info" message="关联已变化，已定位到当前视图中心" />}
      {shotId && !hasShot && <Alert type="warning" message="原镜头不可用，请重新选择镜头" />}
      {editingAway && <Alert type="info" message={`当前编辑对象已移至${editingHome === 'shared' ? '总览共享区' : editingHome === 'unlinked' ? '未关联设计区' : editingHome === 'global' ? '总览全场区' : `镜头 ${content.design.direction.shots.findIndex(row => row.id === editingHome) + 1}`}`}
        action={<WorkbenchButton variant="quiet" onClick={() => jump(editingNode)}>定位对象</WorkbenchButton>} />}
    </>, noticeHost)}
    <DirectorCanvasSurface contextKey={`${versionId}:shots`} labels={[]} objects={objects} relations={relations}
      tools={[{ label: '关联项目资产', onClick: () => setAssetTarget('create') }]}
      onInspectRelation={relation => { setInspectedRelation(relation); setInfoOpen(true) }}
      guides={scope === 'all' ? [...objects.filter(node => node.entry).map(node => ({ from: '原文依据', to: node.id })),
        { from: '原文依据', group: 'scene-global' }] : []}
      layoutScope={{ storageKey, viewId, anchorId: scope === 'shot' ? currentShot ? identity(currentShot) : '' : '原文依据',
        identityAliases,
        validIds: ['原文依据', ...allObjects.map(node => identity(node))].filter(id => !id.includes(':ambiguous:')),
        onInvalidTarget: () => setUnavailable(true) }}
      focusTarget={visibleFocus ? { nodeId: visibleFocus, fieldId: '', serial: focusSerial.current, restore } : undefined}>
      {null}
    </DirectorCanvasSurface>
    {scope === 'all' && <aside className="director-unlinked-bubble" aria-label="未关联设计显示">
      <span>待归镜头 · {pendingCount}　未关联设计 · {unlinkedCount}{draftOnlyCount ? `　未保存新增 · ${draftOnlyCount}` : ''}</span>
      <Switch aria-label="显示未关联设计" checked={unlinkedOpen} disabled={!graph.unlinked.length}
        onChange={setUnlinkedOpen} />
    </aside>}
    {scope === 'all' && !content.design.direction.shots.length && <aside className="director-first-shot" aria-label="首镜头空状态">
      <p>当前还没有镜头</p><WorkbenchButton disabled={disabled} onClick={addShot}>添加首个镜头</WorkbenchButton>
    </aside>}
    <WorkbenchDetails title="附加信息" open={infoOpen} onClose={() => setInfoOpen(false)}>
      <header><h2>{scope === 'all' ? '总览附加信息' : `镜头 ${String(activeShotNumber).padStart(2, '0')} 附加信息`}</h2>
        <WorkbenchIconButton label="隐藏附加信息" variant="quiet" icon={<CloseOutlined />} onClick={() => setInfoOpen(false)} /></header>
      <p>{scope === 'all' ? `镜头 ${content.design.direction.shots.length} · 待归镜头 ${pendingCount} · 未关联设计 ${unlinkedCount}` : `当前子图 ${graph.nodes.length} 张卡片`}</p>
      <p>关系来源：已保存 revision {relationshipGraph.revision}</p>
      {!!relationshipGraph.issues?.length && <details open><summary>设计缺项 · {relationshipGraph.issues.length}</summary><ul>{relationshipGraph.issues.map((issue, index) => <li key={index}>
        <WorkbenchButton variant="quiet" onClick={() => { const owner = allObjects.find(node => node.key === issue.owner); if (owner) jump(owner) }}>定位缺项 · {allObjects.find(node => node.key === issue.owner)?.label || '场次设计'}</WorkbenchButton>
        {' · '}{issue.code === 'empty_row_scope' ? '整条记录' : designLabels[issue.field] || issue.field}：{issue.reason}
        {!!issue.missing_scope_fields?.length && <span> · 待明确范围：{issue.missing_scope_fields.map(field => designLabels[field] || field).join('、')}</span>}
      </li>)}</ul></details>}
      {!!relationshipGraph.preparation_issues?.length && <details><summary>拍摄分工待补 · {relationshipGraph.preparation_issues.length}</summary><ul>{relationshipGraph.preparation_issues.map((issue, index) => <li key={index}>
        <WorkbenchButton variant="quiet" onClick={() => { const owner = allObjects.find(node => node.key === issue.owner); if (owner) jump(owner) }}>定位拍摄分工 · {allObjects.find(node => node.key === issue.owner)?.label || '场次设计'}</WorkbenchButton>
        {' · '}{designLabels[issue.field] || issue.field}：{issue.reason} · 镜头 {issue.shot_ids?.map(id => String(content.design.direction.shots.findIndex(shot => shot.id === id) + 1).padStart(2, '0')).join('、')}
      </li>)}</ul></details>}
      <details><summary>全部直接引用 · {relationshipGraph.edges.length}</summary><ul>{relationshipGraph.edges.map((edge, index) => <li key={`${edge.owner}:${edge.field}:${edge.target}:${index}`}>
        <WorkbenchButton variant="quiet" onClick={() => { const owner = allObjects.find(node => node.key === edge.owner); if (owner) jump(owner) }}>{edge.owner}</WorkbenchButton>
        {' · '}{edge.field}{' → '}{edge.target}
      </li>)}</ul></details>
      <details><summary>字段与条目用途 · {relationshipGraph.uses.length}</summary><ul>{relationshipGraph.uses.map((use, index) => <li key={`${use.owner}:${use.field}:${index}`}>
        <WorkbenchButton variant="quiet" onClick={() => { const owner = allObjects.find(node => node.key === use.owner); if (owner) jump(owner) }}>{use.owner}</WorkbenchButton>
        {' · '}{designLabels[use.field] || use.field}{' · '}{use.purpose === 'background' ? '场次背景' : use.purpose === 'constraint' ? '约束' : '设计'}
        {use.scope === 'scene' ? ' · 全场背景' : use.scope === 'scene_rule' ? ' · 全场规则' : use.scope === 'shots' ? ` · 镜头 ${use.shot_ids?.join('、')}` : use.scope === 'occurrences' ? ' · 指定单元出现项' : ' · 范围待明确'}
        {use.phase ? ` · ${use.phase}` : ''}{use.condition ? ` · 条件：${use.condition}` : ''}
      </li>)}</ul></details>
      <label htmlFor="director-object-locator">定位当前视图对象</label>
      <Select id="director-object-locator" aria-label="定位设计对象" showSearch optionFilterProp="label" placeholder="选择设计对象" value={null}
        options={locationOptions.map(node => ({ value: identity(node), label: node.label }))}
        onChange={id => { const node = target(id || undefined); if (node) { setInfoOpen(false); jump(node) } }} />
      {scope === 'all' ? <section><h3>镜头子图</h3>{content.design.direction.shots.map((shot, index) => <WorkbenchButton key={shot.id} variant="quiet" onClick={() => { onSelectShot(shot.id); go({ scope: 'shot', shotId: shot.id }) }}>
        镜头 {String(index + 1).padStart(2, '0')} · {shot.visible_result.text || '未填写'}</WorkbenchButton>)}</section>
        : <WorkbenchButton variant="quiet" onClick={() => go({ scope: 'all', shotId: activeShotId })}>返回总览</WorkbenchButton>}
      {inspectedRelation && <section className="director-info-relation" aria-label="关系来源">
        <h3>{currentRelation?.label || '关系已变化'}</h3>
        {currentRelation && <ul>{(currentRelation.sources || [currentRelation]).map((item, index) => <li key={index}>
          {item.fromLabel || item.from} → {item.toLabel || item.to} · {item.label}{item.field ? ` · ${item.field}` : ''}</li>)}</ul>}
      </section>}
    </WorkbenchDetails>
    {noticeHost && scope === 'shot' && graph.nodes.length <= 1 && createPortal(<aside className="director-domain-empty" aria-label="镜头设计空状态"><p>当前镜头暂无明确关联的设计</p></aside>, noticeHost)}
    <SceneDesignPanel value={content.design} saved={saved.design} units={content.units} disabled={disabled} relationshipGraph={relationshipGraph}
      onChange={changeDesign} onNavigateTarget={(next, trigger) => {
        const path = resolveTarget(content.design, next)
        const node = path && allObjects.find(row => JSON.stringify(row.path) === JSON.stringify(path))
        const sourcePath = editingTarget && resolveTarget(content.design, editingTarget)
        const source = sourcePath && allObjects.find(row => JSON.stringify(row.path) === JSON.stringify(sourcePath))
        if (node) jump(node, source ? identity(source) : undefined)
        else { setUnavailable(true); trigger.focus({ preventScroll: true }) }
      }} onLocateUnit={onLocateUnit} focusRequest={focusRequest} onFocusHandled={() => setFocusRequest(undefined)}
      onSideClose={() => setEditingTarget(undefined)} sideContext={`${versionId}:${editorContext}`} saveStatus={saveStatus} />
    <WorkbenchDetails title="项目资产关联" status={saveStatus}
      open={!!assetTarget} onClose={() => setAssetTarget(undefined)}>
      {assetTarget && <SceneAssetLinks projectId={projectId} value={content.design} disabled={disabled} onChange={changeDesign}
        shotId={assetTarget === 'create' && scope === 'shot' ? activeShotId : undefined}
        createOnly={assetTarget === 'create'} assetKind={assetTarget === 'location' ? 'scene' : undefined} participantId={assetTarget.startsWith('participant:') ? assetTarget.slice(12) : undefined} />}
    </WorkbenchDetails>
  </>
}
