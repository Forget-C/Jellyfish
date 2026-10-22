import { CanvasBrowse } from './CanvasBrowse'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Select, Space, Switch, Tooltip } from 'antd'
import { CloseOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useLocation, useNavigationType, useSearchParams } from 'react-router-dom'
import type { DirectorCanvasGraph, EditableSceneDesign_Output, SceneRelationshipGraph, SceneVersionContent_Output } from '../../../services/generated'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'
import type { DirectorCanvasObject, DirectorCanvasRelation } from './DirectorCanvasSurface'
import { WorkbenchButton, WorkbenchIconButton } from './ui/WorkbenchButton'
import { WorkbenchDetails } from './ui/WorkbenchDetails'
import { designLabels } from './designLabels'
import { SceneDesignPanel, resolveTarget, targetFor } from './SceneDesignPanel'
import type { DesignFocusRequest, DesignTarget } from './SceneDesignPanel'
import { SceneAssetLinks } from './SceneAssetLinks'
import { DirectorGraphSummary } from './DirectorGraphSummary'
import { DirectorShotEntry } from './DirectorShotEntry'
import { directorDesignNodeSize } from './directorLayout'
import { designAt } from './designValue'
import { designObjectLayoutId, designObjects, reorderScopeShots } from './designWorkspace'
import { directorCanvasProjection } from './directorCanvasGraph'
import type { DesignObject } from './designWorkspace'
import type { UnitReferenceConflict } from './sceneUnitReferences'

type BrowseState = { scope: 'all' | 'shot'; focus?: string; shotId?: string }
let directorFocusSerial = 0

type DirectorDesignCanvasProps = {
  projectId: string; sequenceId: string; versionId: string; content: SceneVersionContent_Output; saved: SceneVersionContent_Output
  relationshipGraph: SceneRelationshipGraph
  directorGraph: DirectorCanvasGraph
  shotId?: string; onChange: (value: SceneVersionContent_Output) => void; disabled: boolean
  source: ReactNode; onPrepare: (shotId?: string) => void; onLocateUnit: (conflict: UnitReferenceConflict) => void
  externalFocus?: { nodeId: string; fieldId: string; serial: number }
  onExternalFocusHandled: () => void
  noticeHost: HTMLElement | null
  nextHost: HTMLElement | null
  saveStatus: string
}

/** 图读取失败不回退客户端组图；父工作台继续保留当前输入及保存队列。 */
export function DirectorDesignCanvas(props: DirectorDesignCanvasProps) {
  const graph = props.directorGraph
  if (!graph || graph.kind !== 'director' || graph.version_id !== props.versionId ||
    graph.revision !== props.relationshipGraph.revision || graph.views.filter(view => view.parent_id == null).length !== 1 ||
    !graph.nodes.some(node => node.kind === 'source')) {
    return <Alert type="error" message="画布图数据与当前版本不一致，请重新读取；当前编辑内容已保留" />
  }
  return <DirectorDesignCanvasBody {...props} />
}

/** 总览和逐镜子图消费同一服务端 graph，编辑目标单独对齐当前输入。 */
function DirectorDesignCanvasBody({ projectId, sequenceId, versionId, content, saved, relationshipGraph, directorGraph, shotId, onChange, disabled, source, onPrepare, onLocateUnit, externalFocus, onExternalFocusHandled, noticeHost, nextHost, saveStatus }: DirectorDesignCanvasProps) {
  const [params, setParams] = useSearchParams()
  const location = useLocation(), navigationType = useNavigationType()
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
  const scope = state.scope
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
  const graphPending = JSON.stringify(content) !== JSON.stringify(saved)
  const projection = useMemo(() => directorCanvasProjection(directorGraph, content.design, saved.design), [directorGraph, content.design, saved.design])
  const overviewGraph = useMemo(() => projection.view(), [projection])
  const allObjects = projection.objects
  // 仅供当前编辑重进；这些对象不进入服务端 graph 的卡片或成员。
  const pendingObjects = useMemo(() => designObjects(content.design).filter(node => {
    const savedNode = projection.byKey.get(node.key)
    return !savedNode || projection.unavailable.has(savedNode.id)
  }), [content.design, projection])
  const sourceNode = directorGraph?.nodes.find(node => node.kind === 'source')
  const identity = (node: DesignObject, design = content.design) => projection.byKey.get(node.key)?.id || designObjectLayoutId(design, node)
  const target = (id?: string) => allObjects.find(node => identity(node) === id)
  const graph = useMemo(() => scope === 'shot' ? projection.view(activeShotId) : overviewGraph,
    [scope, activeShotId, overviewGraph, projection])
  // overview 仅保留既有根布局缓存键；实际子图地址来自后端。
  const viewId = graph.metadata ? (graph.metadata.parent_id == null ? 'overview' : graph.metadata.id) : `pending:${activeShotId || 'view'}`
  const pendingCount = directorGraph.pending_count
  const unlinkedCount = directorGraph.unlinked_count
  const infoOpen = !!infoOpenByView[viewId]
  const setInfoOpen = (open: boolean) => {
    setInfoOpenByView(previous => {
      const next = { ...previous, [viewId]: open }
      try { localStorage.setItem(`${storageKey}:info`, JSON.stringify(next)) } catch { /* 浏览偏好不可写不影响附加信息。 */ }
      return next
    })
  }
  const nextParams = useCallback((next: BrowseState) => {
    const result = new URLSearchParams(params)
    result.set('canvas', 'director')
    result.set('directorView', next.scope === 'shot' ? 'shot' : 'outer'); result.set('directorScope', next.scope)
    result.delete('directorTemporary')
    for (const [key, value] of [['directorTarget', next.focus], ['directorShot', next.shotId]] as const) {
      if (value) result.set(key, value)
      else result.delete(key)
    }
    return result
  }, [params])
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
  }, [params, nextParams, remembered, setParams, shotId, versionId])
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
    const node = allObjects.find(row => row.key === (externalFocus.nodeId === '镜头设计' ? `shot:${shotId}` : externalFocus.nodeId) || identity(row) === externalFocus.nodeId)
    if (node) {
      jump(node)
      const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : document.body
      if (externalFocus.fieldId === 'cinematography' && node.key.startsWith('shot:')) {
        setFocusRequest({ target: { path: ['cinematography'] }, trigger, serial: Date.now(),
          side: true, createPath: ['cinematography'], defaults: { shot_id: node.key.slice(5) } })
      } else if (externalFocus.fieldId) edit(node, trigger, externalFocus.fieldId === 'applicability', externalFocus.fieldId)
    } else setUnavailable(true)
    onExternalFocusHandled()
  }, [externalFocus?.serial])
  useEffect(() => {
    if (state.focus && state.focus !== sourceNode?.id && !target(state.focus)) {
      setUnavailable(true)
      go({ ...state, focus: undefined }, undefined, true)
    }
  }, [state.focus, content.design])
  // 当前选择器明确指定当前行，可重新编辑尚不能安全映射到旧图的历史对象。
  const editCurrentObject = (node: DesignObject, trigger: HTMLElement, focusApplicability = false, fieldId?: string) => {
    const next = { ...targetFor(content.design, node.path, true), object: true, fields: node.fields, label: node.fields ? node.label : undefined }
    setEditingTarget(next)
    setFocusRequest({ target: next, trigger, serial: Date.now(), side: true, fieldId: focusApplicability ? 'applicability' : fieldId })
  }
  const edit = (node: DesignObject, trigger: HTMLElement, focusApplicability = false, fieldId?: string) => {
    if (projection.unavailable.has(identity(node))) { setUnavailable(true); return }
    editCurrentObject(node, trigger, focusApplicability, fieldId)
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
  const focusStillVisible = !state.focus || state.focus === sourceNode?.id || visibleNodes.some(node => identity(node) === state.focus)
  const visibleFocus = focusStillVisible ? state.focus : scope === 'shot' ? currentShot && identity(currentShot) : sourceNode?.id
  const objects: DirectorCanvasObject[] = visibleNodes.map(node => {
    const serverCard = projection.byKey.get(node.key)!
    const home = graph.location(node.key)
    const member = graph.members.get(serverCard.id)!
    const isEntry = member.presentation === 'entry'
    const entryView = isEntry && directorGraph.views.find(view => view.id === member.entry_view_id)
    const entryAnchor = entryView && projection.metadata.get(entryView.anchor_id!)
    const entryShotId = entryAnchor && entryAnchor.kind === 'design' ? entryAnchor.record_id : undefined
    const unavailableObject = projection.unavailable.has(serverCard.id)
    const open = (trigger: HTMLElement) => {
      if (isEntry && entryShotId) { go({ scope: 'shot', shotId: entryShotId }, identity(node)) }
      else if (isReference(node)) jump(node, identity(node))
      else if (node.key === 'location') setAssetTarget('location')
      else if (node.kind !== 'missing') edit(node, trigger)
    }
    return { id: serverCard.id, label: node.label, entry: isEntry, title: member.title || serverCard.title,
      group: member.group,
      size: isEntry ? { width: 360, height: 276 } : directorDesignNodeSize(node),
      related: home === 'shared', onInspect: node.kind === 'missing' || unavailableObject ? undefined : open,
      content: isEntry && entryView ? <DirectorShotEntry authority={directorGraph} view={entryView} storageKey={storageKey} />
        : <section className={`canvas-workbench-card${isReference(node) ? ' director-reference-card' : ' director-design-card'}`}>
        {unavailableObject && <p>当前编辑中该对象已移除或无法确定，请保存后重新定位</p>}
        {home === 'unlinked' && serverCard.kind === 'design' && <p>{serverCard.scope_label} · {serverCard.scope_reason}</p>}
        {isReference(node) ? <>
          <p>共享引用 · 只读定位</p>
          <WorkbenchButton onClick={() => jump(node, identity(node))}>定位共享原卡</WorkbenchButton>
        </> : node.key === 'location' ? <>
          {serverCard.kind !== 'source' && <DirectorGraphSummary node={serverCard} />}
          <WorkbenchButton disabled={disabled} onClick={() => setAssetTarget('location')}>设置默认资产</WorkbenchButton>
        </> : <>
          {serverCard.kind !== 'source' && <DirectorGraphSummary node={serverCard} />}
          {node.key.startsWith('shot:') && <Space wrap>
            {([-1, 1] as const).map(offset => {
              const index = content.design.direction.shots.findIndex(row => `shot:${row.id}` === node.key)
              const destination = content.design.direction.shots[index + offset]
              return <WorkbenchButton key={offset} variant="quiet" disabled={disabled || !destination} onClick={() => changeDesign(reorderScopeShots(content.design,
                content.design.direction.shots.map(row => row.id), node.key.slice(5), destination.id))}>{offset < 0 ? '镜头前移' : '镜头后移'}</WorkbenchButton>
            })}
          </Space>}
          {node.key.startsWith('participant:') && <WorkbenchButton disabled={disabled} onClick={() => setAssetTarget(node.key)}>设置默认资产</WorkbenchButton>}
          {node.kind === 'missing' && <WorkbenchButton onClick={() => {
            const owner = allObjects.find(row => row.key === graph.edges.find(edge => edge.to === node.key)?.from)
            if (owner) jump(owner)
          }}>定位引用者</WorkbenchButton>}
        </>}
      </section> }
  })
  if (scope === 'all' && sourceNode) objects.unshift({ id: sourceNode.id, label: sourceNode.title, title: sourceNode.title, group: overviewGraph.members.get(sourceNode.id)?.group, size: { width: 360, height: 240 }, onInspect: undefined, related: false, content: <section className="canvas-workbench-card">{source}</section> })
  const relations = graph.edges.filter(edge => visibleNodes.some(node => node.key === edge.from) && visibleNodes.some(node => node.key === edge.to)).map(edge => ({ ...edge,
    from: identity(allObjects.find(node => node.key === edge.from) || { key: edge.from, path: [], kind: '', label: '' }),
    to: identity(allObjects.find(node => node.key === edge.to) || { key: edge.to, path: [], kind: '', label: '' }),
    sources: edge.sources.map(row => ({ ...row, fromLabel: allObjects.find(node => node.key === row.from)?.label,
      toLabel: allObjects.find(node => node.key === row.to)?.label })) }))
  const currentRelation = inspectedRelation && relations.find(row => row.from === inspectedRelation.from && row.to === inspectedRelation.to && row.label === inspectedRelation.label)
  const locationOptions = [...visibleNodes, ...(scope === 'all' && !unlinkedOpen ? graph.unlinked : [])].filter(node => node.kind !== 'missing')
  const activeShotNumber = content.design.direction.shots.findIndex(row => row.id === activeShotId) + 1
  useEffect(() => setInspectedRelation(undefined), [viewId])
  let restore = false
  try { restore = navigationType === 'POP' && !!localStorage.getItem(`${storageKey}:view:${viewId}`) } catch { /* 使用会话布局。 */ }
  return <>
    <CanvasBrowse storageKey={storageKey} label="导演画布位置" filtered={state.scope === 'shot' || unlinkedOpen}
      filters={<><label>镜头<Select aria-label="导演镜头筛选" value={state.scope === 'shot' ? activeShotId : ''}
        options={[{ value: '', label: '全部镜头' }, ...content.design.direction.shots.map((shot, index) => ({ value: shot.id, label: `镜头 ${index + 1}` })), ...(state.scope === 'shot' && !hasShot ? [{ value: activeShotId || '', label: '原镜头不可用' }] : [])]}
        onChange={id => go({ scope: id ? 'shot' : 'all', shotId: id || undefined })} /></label>
        {scope === 'all' && <label>待归镜头 {pendingCount} · 未关联设计 {unlinkedCount}<Switch aria-label="显示未关联设计" checked={unlinkedOpen} disabled={!graph.unlinked.length} onChange={setUnlinkedOpen} /></label>}</>}
      actions={<WorkbenchIconButton label="附加信息" variant="quiet" icon={<InfoCircleOutlined />} aria-pressed={infoOpen} onClick={() => setInfoOpen(!infoOpen)} />}>
      <WorkbenchButton variant="quiet" aria-current={scope === 'all' ? 'page' : undefined} disabled={scope === 'all'} onClick={() => go({ scope: 'all', shotId: activeShotId })}>总览</WorkbenchButton>
      {state.scope === 'shot' && <span aria-current="page">› {hasShot ? `镜头 ${String(activeShotNumber).padStart(2, '0')} 子图` : '原镜头不可用'}</span>}
    </CanvasBrowse>
    {nextHost && !!content.design.direction.shots.length && createPortal(
      <Tooltip trigger={['hover', 'focus']} title={`${scope === 'shot' ? `进入镜头 ${activeShotNumber} 的` : '进入'}单元画布，建立或选择拍摄单元，填写动作范围、模型、时长和参考，再生成指令并检查。`}>
        <WorkbenchButton variant="primary" onClick={() => onPrepare(scope === 'shot' && hasShot ? activeShotId : undefined)}>下一步：单元画布</WorkbenchButton>
      </Tooltip>, nextHost)}
    {noticeHost && createPortal(<>
      {graphPending && <Alert type="info" message={`关系图来自已保存 revision ${relationshipGraph.revision}；关系更新中`} />}
      {!graphPending && !!relationshipGraph.issues?.length && <Alert type="warning" message={`设计未完整 · ${relationshipGraph.issues.length} 项缺项`}
        action={<WorkbenchButton variant="quiet" onClick={() => setInfoOpen(true)}>查看设计缺项</WorkbenchButton>} />}
      {!graphPending && relationshipGraph.complete && <span role="status">设计范围完整</span>}
      {unavailable && <Alert type="warning" message="原对象不可用，请重新选择" closable onClose={() => setUnavailable(false)} />}
      {!focusStillVisible && <Alert type="info" message="关联已变化，已定位到当前视图中心" />}
      {scope === 'shot' && !hasShot && <Alert type="warning" message="原镜头不可用，请重新选择镜头" action={<WorkbenchButton onClick={() => go({ scope: 'all' })}>返回有效总览</WorkbenchButton>} />}
      {editingAway && <Alert type="info" message={`当前编辑对象已移至${editingHome === 'shared' ? '总览共享区' : editingHome === 'unlinked' ? '未关联设计区' : editingHome === 'global' ? '总览全场区' : `镜头 ${content.design.direction.shots.findIndex(row => row.id === editingHome) + 1}`}`}
        action={<WorkbenchButton variant="quiet" onClick={() => jump(editingNode)}>定位对象</WorkbenchButton>} />}
    </>, noticeHost)}
    {(scope !== 'shot' || hasShot) && <DirectorCanvasSurface contextKey={`${versionId}:shots`} labels={[]} objects={objects} relations={relations} groups={graph.metadata?.groups}
      tools={[{ label: '关联项目资产', onClick: () => setAssetTarget('create') }]}
      onInspectRelation={relation => { setInspectedRelation(relation); setInfoOpen(true) }}
      guides={graph.guides}
      layoutScope={{ storageKey, viewId, anchorId: graph.metadata?.anchor_id || '',
        // 旧原文缓存键只在业务适配层迁移；绘制与有效身份使用后端地址。
        identityAliases: { ...(sourceNode ? { '原文依据': sourceNode.id } : {}), ...identityAliases },
        validViewIds: directorGraph.views.map(view => view.parent_id == null ? 'overview' : view.id),
        validIds: directorGraph.nodes.map(node => node.id),
        onInvalidTarget: () => setUnavailable(true) }}
      focusTarget={visibleFocus ? { nodeId: visibleFocus, fieldId: '', serial: focusSerial.current, restore } : undefined}>
      {null}
    </DirectorCanvasSurface>}
    {scope === 'all' && !content.design.direction.shots.length && <aside className="director-first-shot" aria-label="首镜头空状态">
      <p>当前还没有镜头</p><WorkbenchButton disabled={disabled} onClick={addShot}>添加首个镜头</WorkbenchButton>
    </aside>}
    <WorkbenchDetails title="附加信息" open={infoOpen} onClose={() => setInfoOpen(false)}>
      <header><h2>{scope === 'all' ? '总览附加信息' : `镜头 ${String(activeShotNumber).padStart(2, '0')} 附加信息`}</h2>
        <WorkbenchIconButton label="隐藏附加信息" variant="quiet" icon={<CloseOutlined />} onClick={() => setInfoOpen(false)} /></header>
      <p>{scope === 'all' ? `镜头 ${directorGraph.shot_count} · 待归镜头 ${pendingCount} · 未关联设计 ${unlinkedCount}` : graph.metadata ? `当前子图 ${graph.metadata.node_count} 张卡片` : '当前子图待同步'}</p>
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
      {!!pendingObjects.length && <section aria-label="当前待同步对象编辑">
        <label htmlFor="director-pending-editor">编辑待同步对象</label>
        <Select id="director-pending-editor" aria-label="编辑待同步对象" showSearch optionFilterProp="label" placeholder="选择当前编辑对象" value={null} style={{ width: '100%' }}
          options={pendingObjects.map(node => ({ value: node.key, label: node.label }))}
          onChange={key => {
            const node = pendingObjects.find(candidate => candidate.key === key)
            if (node) { setInfoOpen(false); editCurrentObject(node, document.activeElement instanceof HTMLElement ? document.activeElement : document.body) }
          }} />
      </section>}
      <label htmlFor="director-object-locator">定位当前视图对象</label>
      <Select id="director-object-locator" aria-label="定位设计对象" showSearch optionFilterProp="label" placeholder="选择设计对象" value={null}
        options={locationOptions.map(node => ({ value: identity(node), label: node.label }))}
        onChange={id => { const node = target(id || undefined); if (node) { setInfoOpen(false); jump(node) } }} />
      {scope === 'all' ? <section><h3>镜头子图</h3>{content.design.direction.shots.map((shot, index) => <WorkbenchButton key={shot.id} variant="quiet" onClick={() => { go({ scope: 'shot', shotId: shot.id }) }}>
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
    <WorkbenchDetails title="设置默认资产" status={saveStatus}
      open={!!assetTarget} onClose={() => setAssetTarget(undefined)}>
      {assetTarget && <SceneAssetLinks projectId={projectId} value={content.design} disabled={disabled} onChange={changeDesign}
        shotId={assetTarget === 'create' && scope === 'shot' ? activeShotId : undefined}
        createOnly={assetTarget === 'create'} assetKind={assetTarget === 'location' ? 'scene' : undefined} participantId={assetTarget.startsWith('participant:') ? assetTarget.slice(12) : undefined} />}
    </WorkbenchDetails>
  </>
}
