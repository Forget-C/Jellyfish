import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Alert, Dropdown, Select, Space } from 'antd'
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom'
import type { EditableSceneDesign_Output, SceneVersionContent_Output } from '../../../services/generated'
import { DirectorCanvasSurface } from './DirectorCanvasSurface'
import type { DirectorCanvasObject } from './DirectorCanvasSurface'
import { WorkbenchButton } from './ui/WorkbenchButton'
import { CanvasQuickEditor } from './CanvasQuickEditor'
import { DesignObjectSummary } from './DesignObjectSummary'
import { SceneDesignPanel, resolveTarget, targetFor } from './SceneDesignPanel'
import type { DesignFocusRequest, DesignTarget } from './SceneDesignPanel'
import { SceneAssetLinks } from './SceneAssetLinks'
import { DirectorLocationSummary } from './DirectorLocationSummary'
import { designCard } from './designCard'
import { designAt } from './designValue'
import { departmentNames, designCoreContent, designDomain, designDomains, designObjectLayoutId, directorDesignGraph, reorderScopeShots } from './designWorkspace'
import type { DesignDomain, DesignObject } from './designWorkspace'
import type { UnitReferenceConflict } from './sceneUnitReferences'
import type { DesignPath } from './designValue'

type BrowseState = { domain?: DesignDomain; scope: 'all' | 'shot'; focus?: string; temporary?: string; shotId?: string }
let directorFocusSerial = 0
const globalKeys = new Set(['overview', 'space', 'performance', 'staging', 'sound', 'prompt', 'location'])
const domainCollections: Record<DesignDomain, { label: string; path: DesignPath }[]> = {
  direction: [{ label: '叙事节拍', path: ['direction', 'beats'] }, { label: '空间锚点', path: ['direction', 'anchors'] }, { label: '人物／物件调度', path: ['direction', 'blocking_states'] }],
  performance: [{ label: '角色情境', path: ['performance', 'situations'] }, { label: '节拍表演', path: ['performance', 'beats'] }],
  staging: [{ label: '镜内活动', path: ['staging', 'activities'] }], cinematography: [{ label: '摄影工作单', path: ['cinematography'] }],
  continuity: [{ label: '连续性工作单', path: ['continuity'] }], sound: [{ label: '对白', path: ['sound', 'dialogues'] }], prompt: [],
}

/** 七个设计域共用场次草稿；浏览位置和临时目标只进入版本级浏览记录。 */
export function DirectorDesignCanvas({ projectId, sequenceId, versionId, content, saved, shotId, onSelectShot, onRestoreShot, onChange, disabled, source, onLocateUnit, externalFocus, onExternalFocusHandled, externalOverlay, noticeHost }: {
  projectId: string; sequenceId: string; versionId: string; content: SceneVersionContent_Output; saved: SceneVersionContent_Output
  shotId?: string; onSelectShot: (id: string) => void; onRestoreShot: (id: string) => void; onChange: (value: SceneVersionContent_Output) => void; disabled: boolean
  source: ReactNode; onLocateUnit: (conflict: UnitReferenceConflict) => void
  externalFocus?: { nodeId: string; fieldId: string; serial: number }
  onExternalFocusHandled: () => void
  externalOverlay?: string
  noticeHost: HTMLElement | null
}) {
  const [params, setParams] = useSearchParams()
  const location = useLocation(), navigate = useNavigate(), navigationType = useNavigationType()
  const storageKey = `jellyfish:director-domains:local-user:${projectId}:${sequenceId}:${versionId}`
  const [remembered] = useState<BrowseState>(() => {
    try { return JSON.parse(localStorage.getItem(`${storageKey}:selection`) || '{}') || {} } catch { return { scope: 'all' } }
  })
  const readState = (): BrowseState => {
    const domain = params.get('directorView')
    return { domain: designDomains.includes(domain as DesignDomain) ? domain as DesignDomain : undefined,
      scope: params.get('directorScope') === 'shot' ? 'shot' : 'all', focus: params.get('directorTarget') || undefined,
      temporary: params.get('directorTemporary') || undefined, shotId: params.get('directorShot') || shotId }
  }
  const state = readState()
  const hasShot = content.design.direction.shots.some(row => row.id === shotId)
  const scope = state.scope === 'shot' && hasShot ? 'shot' : 'all'
  const [focusRequest, setFocusRequest] = useState<DesignFocusRequest>()
  const [editingTarget, setEditingTarget] = useState<DesignTarget>()
  const [identityAliases, setIdentityAliases] = useState<Record<string, string>>({})
  const [assetTarget, setAssetTarget] = useState<string>()
  const [unavailable, setUnavailable] = useState(false)
  const [editorContext, setEditorContext] = useState(0)
  const consumedFocus = useRef<number>()
  const focusSerial = useRef(0), lastLocation = useRef('')
  if (lastLocation.current !== location.key) { lastLocation.current = location.key; focusSerial.current = ++directorFocusSerial }
  const allGraph = directorDesignGraph(content.design, { scope: 'all' })
  const allObjects = [...allGraph.nodes.filter(node => node.kind !== 'summary'), ...allGraph.groups.flatMap(group => group.members)]
  const identity = (node: DesignObject, design = content.design) => designObjectLayoutId(design, node)
  const target = (id?: string) => allObjects.find(node => identity(node) === id)
  const temporary = target(state.temporary)
  const graph = directorDesignGraph(content.design, { domain: state.domain, scope, shotId, temporaryKey: temporary?.key })
  const nextParams = (next: BrowseState) => {
    const result = new URLSearchParams(params)
    result.set('directorView', next.domain || 'outer'); result.set('directorScope', next.scope)
    for (const [key, value] of [['directorTarget', next.focus], ['directorTemporary', next.temporary], ['directorShot', next.shotId]] as const) {
      if (value) result.set(key, value)
      else result.delete(key)
    }
    return result
  }
  const go = (next: BrowseState, sourceId?: string, replace = false) => {
    if (params.get('version') !== versionId) return
    if (!replace) { setEditorContext(value => value + 1); setAssetTarget(undefined) }
    if (sourceId && !replace) setParams(nextParams({ ...state, focus: sourceId, shotId }), { replace: true, state: location.state })
    setParams(nextParams({ ...next, shotId }), { replace, state: replace ? location.state : { directorBack: true } })
  }
  useLayoutEffect(() => {
    if (!params.has('directorView') && params.get('version') === versionId) {
      const initial = { ...remembered, domain: designDomains.includes(remembered.domain!) ? remembered.domain : undefined,
        scope: remembered.scope === 'shot' ? 'shot' as const : 'all' as const }
      setParams(nextParams({ ...initial, shotId: initial.shotId || shotId }), { replace: true })
    }
    if (state.shotId && state.shotId !== shotId && (!externalFocus || consumedFocus.current === externalFocus.serial)) onRestoreShot(state.shotId)
  }, [params.get('version'), params.get('directorView'), params.get('directorShot')])
  useEffect(() => {
    try { localStorage.setItem(`${storageKey}:selection`, JSON.stringify({ ...state, shotId })) } catch { /* 浏览偏好不可写不影响设计。 */ }
  }, [location.key, shotId])
  useEffect(() => setAssetTarget(undefined), [state.domain, scope])
  useEffect(() => { if (navigationType === 'POP') setEditorContext(value => value + 1) }, [location.key])
  const jump = (node: DesignObject, from?: string, design = content.design) => {
    const id = identity(node, design), domain = designDomain(node.key)
    const related = directorDesignGraph(design, { scope: 'shot', shotId }).relatedKeys.has(node.key)
    go({ domain, scope, focus: id, temporary: scope === 'shot' && !related ? id : undefined }, from)
  }
  useEffect(() => {
    if (!externalFocus || externalFocus.serial === consumedFocus.current) return
    consumedFocus.current = externalFocus.serial
    const node = allObjects.find(row => row.key === (externalFocus.nodeId === '镜头设计' ? `shot:${shotId}` : externalFocus.nodeId))
    if (node) jump(node)
    else setUnavailable(true)
    onExternalFocusHandled()
  }, [externalFocus?.serial])
  useEffect(() => {
    if ((state.focus && !state.focus.startsWith('domain:') && !['原文依据', 'current-shot'].includes(state.focus) && !target(state.focus)) || state.temporary && !temporary) {
      setUnavailable(true)
      go({ ...state, focus: undefined, temporary: undefined }, undefined, true)
    }
  }, [state.focus, state.temporary, content.design])
  const edit = (node: DesignObject, trigger: HTMLElement) => {
    const next = { ...targetFor(content.design, node.path, true), object: true, fields: node.fields, label: node.fields ? node.label : undefined }
    setEditingTarget(next)
    setFocusRequest({ target: next, trigger, serial: Date.now(), side: true })
  }
  const create = (path: DesignPath, label: string, trigger: HTMLElement) => {
    const next = { path, label }
    setEditingTarget(next)
    setFocusRequest({ target: next, trigger, serial: Date.now(), side: true, createPath: path,
      defaults: path[0] === 'cinematography' && hasShot ? { shot_id: shotId! } : undefined })
  }
  const changeDesign = (next: EditableSceneDesign_Output) => {
    const nextGraph = directorDesignGraph(next, { scope: 'all' })
    const nextObjects = [...nextGraph.nodes.filter(node => node.kind !== 'summary'), ...nextGraph.groups.flatMap(group => group.members)]
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
      jump(created, undefined, next)
      const nextTarget = { ...targetFor(next, created.path), object: true }
      setEditingTarget(nextTarget)
      setFocusRequest({ target: nextTarget, trigger: document.activeElement as HTMLElement, serial: Date.now(), side: true })
    } else if (edited && scope === 'shot' && !directorDesignGraph(next, { scope: 'shot', shotId }).relatedKeys.has(edited.key)) {
      const id = identity(edited, next)
      go({ ...state, focus: id, temporary: id }, undefined, true)
    } else if (edited && previousObject && explicitSessionEdit && identity(edited, next) !== identity(previousObject)) {
      const beforeId = identity(previousObject), nextId = identity(edited, next)
      go({ ...state, focus: state.focus === beforeId ? nextId : state.focus, temporary: state.temporary === beforeId ? nextId : state.temporary }, undefined, true)
    } else if (renamed[state.focus || ''] || renamed[state.temporary || '']) {
      go({ ...state, focus: renamed[state.focus || ''] || state.focus, temporary: renamed[state.temporary || ''] || state.temporary }, undefined, true)
    }
  }
  const addShot = () => changeDesign({ ...content.design, direction: { ...content.design.direction, shots: [...content.design.direction.shots, {
    id: crypto.randomUUID(), beat_ids: [], event_ids: [], blocking_state_ids: [], participant_ids: null, criterion_ids: [],
    narrative_function: { state: 'unset' }, visible_result: { state: 'unset' }, estimated_duration_ms: null,
  }] } })
  const isReference = (node: DesignObject) => node.kind === 'reference'
  const objects: DirectorCanvasObject[] = graph.nodes.map(node => {
    const domain = node.kind === 'summary' ? node.key.slice(7) as DesignDomain : undefined
    const group = graph.groups.find(row => row.domain === domain)
    const cards = group?.members.map(member => designCard(content.design, member, saved.design)) || []
    const issues = cards.reduce((count, card) => count + card.issues.length, 0)
    const contents = group?.members.map(member => designCoreContent(content.design, member)) || []
    const snippet = contents.find(Boolean)
    const open = (trigger: HTMLElement) => {
      if (domain) go({ domain, scope }, node.key)
      else if (isReference(node)) jump(node, identity(node))
      else if (node.key === 'location') setAssetTarget('location')
      else if (node.kind !== 'missing') edit(node, trigger)
    }
    return { id: identity(node), label: node.label, title: node.key === 'overview' ? '全场叙事与约束' : node.label,
      group: isReference(node) ? 'references' : node.key.startsWith('continuity:') ? `continuity_${designAt(content.design, node.path)?.domain}` : undefined,
      size: isReference(node) ? { width: 360, height: 152 } : domain ? { width: 360, height: 232 }
        : globalKeys.has(node.key) || node.key.startsWith('participant:') ? { width: 360, height: 276 }
          : /^(dialogue|criterion):/.test(node.key) ? { width: 360, height: 232 } : undefined,
      related: scope === 'all' && !globalKeys.has(node.key) && (domain ? group?.members.some(member => !globalKeys.has(member.key) && graph.relatedKeys.has(member.key)) : graph.relatedKeys.has(node.key)),
      onInspect: node.kind === 'missing' ? undefined : open,
      content: <section className={`canvas-workbench-card${domain ? ' director-summary-card' : isReference(node) ? ' director-reference-card' : ' director-design-card'}`}>
        {node.key === 'location' && <p>全场适用</p>}
        {domain ? <>
          <p>{snippet?.slice(0, 150) || '尚无设计正文'}</p>
          <p>成员 {group?.members.length || 0} · 已填写 {contents.filter(Boolean).length}{issues ? ` · 待处理 ${issues} 项` : ''}{cards.some(card => card.dirty) ? ' · 有未保存修改' : ''}</p>
          <WorkbenchButton onClick={() => go({ domain, scope }, node.key)}>进入{departmentNames[domain]}</WorkbenchButton>
        </> : isReference(node) ? <>
          <p>{designDomain(node.key) ? `来自${departmentNames[designDomain(node.key)!]}` : '来自外层'} · 只读引用</p>
          <WorkbenchButton onClick={() => jump(node, identity(node))}>前往正式归属</WorkbenchButton>
        </> : node.key === 'location' ? <>
          <DirectorLocationSummary projectId={projectId} assetId={content.design.direction.location_asset_id} />
          <WorkbenchButton disabled={disabled} onClick={() => setAssetTarget('location')}>编辑场所资产绑定</WorkbenchButton>
        </> : <>
          {identity(node) === state.temporary && <p>范围外 · 临时查看</p>}
          <DesignObjectSummary value={content.design} saved={saved.design} object={node} compact />
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
  if (!state.domain) objects.unshift({ id: '原文依据', label: '原文依据', title: '原文依据', onInspect: undefined, related: false, content: <section className="canvas-workbench-card">{source}</section> })
  const currentShot = allObjects.find(node => node.key === `shot:${shotId}`)
  if (!state.domain && currentShot) objects.push({ id: 'current-shot', label: '当前镜头摘要', title: '当前镜头 · 摘要引用', size: { width: 360, height: 276 }, group: 'shared',
    onInspect: () => jump(currentShot, 'current-shot'), content: <section className="canvas-workbench-card director-design-card">
      <DesignObjectSummary value={content.design} saved={saved.design} object={currentShot} compact />
      <WorkbenchButton onClick={() => jump(currentShot, 'current-shot')}>前往总导演编辑镜头</WorkbenchButton>
    </section> })
  const relations = graph.edges.map(edge => ({ ...edge,
    from: identity(allObjects.find(node => node.key === edge.from) || { key: edge.from, path: [], kind: '', label: '' }),
    to: identity(allObjects.find(node => node.key === edge.to) || { key: edge.to, path: [], kind: '', label: '' }),
    sources: ('sources' in edge && Array.isArray(edge.sources) ? edge.sources : edge.path || [edge]).map(row => ({ ...row,
      fromLabel: allObjects.find(node => node.key === row.from)?.label, toLabel: allObjects.find(node => node.key === row.to)?.label })) }))
  const viewId = `${state.domain || 'outer'}:${scope === 'shot' ? `shot:${shotId}` : 'all'}`
  let restore = false
  try { restore = navigationType === 'POP' && !!localStorage.getItem(`${storageKey}:view:${viewId}`) } catch { /* 使用会话布局。 */ }
  const anchor = state.domain && graph.groups.find(group => group.domain === state.domain)?.members[0]
  return <>
    {noticeHost && createPortal(<>
      {unavailable && <Alert type="warning" message="原对象不可用，请重新选择" closable onClose={() => setUnavailable(false)} />}
      {shotId && !hasShot && <Alert type="warning" message="原镜头不可用，请重新选择镜头" />}
    </>, noticeHost)}
    <DirectorCanvasSurface contextKey={`${versionId}:domains`} labels={[]} objects={objects} relations={relations}
      layoutScope={{ storageKey, viewId, anchorId: state.domain ? anchor ? identity(anchor) : '' : '原文依据',
        identityAliases,
        validIds: ['原文依据', 'current-shot', ...designDomains.map(domain => `domain:${domain}`), ...allObjects.map(node => identity(node))].filter(id => !id.includes(':ambiguous:')),
        onInvalidTarget: () => setUnavailable(true) }}
      focusTarget={state.focus ? { nodeId: state.focus, fieldId: '', serial: focusSerial.current, restore } : undefined}
      toolbar={<Space wrap>
        <WorkbenchButton variant="quiet" disabled={!location.state?.directorBack} onClick={() => navigate(-1)}>返回上一处</WorkbenchButton>
        {state.domain && <WorkbenchButton onClick={() => go({ scope })}>导演画布</WorkbenchButton>}
        <Select aria-label="设计域" value={state.domain || 'outer'} options={[{ value: 'outer', label: '导演画布' }, ...designDomains.map(domain => ({ value: domain, label: departmentNames[domain] }))]}
          onChange={domain => go({ domain: domain === 'outer' ? undefined : domain as DesignDomain, scope })} />
        <Select aria-label="查看范围" value={scope} options={[{ value: 'all', label: '整场' }, { value: 'shot', label: '当前镜头', disabled: !hasShot }]}
          onChange={next => go({ ...state, scope: next as 'all' | 'shot', temporary: undefined, focus: undefined })} />
        <Select aria-label="选择镜头" showSearch optionFilterProp="label" value={shotId} placeholder="选择镜头" options={content.design.direction.shots.map((shot, index) => ({ value: shot.id, label: `镜头 ${String(index + 1).padStart(2, '0')} · ${shot.visible_result.text || '未填写'}` }))}
          onChange={id => { setEditorContext(value => value + 1); onSelectShot(id); setParams(nextParams({ ...state, shotId: id, focus: undefined, temporary: undefined })) }} />
        <Select aria-label="定位设计对象" showSearch optionFilterProp="label" placeholder="定位设计对象" value={null}
          options={allObjects.filter(node => node.kind !== 'missing').map(node => ({ value: identity(node), label: node.label }))}
          onChange={id => { const node = target(id || undefined); if (node) jump(node) }} />
        {state.domain && !!domainCollections[state.domain].length && <Dropdown menu={{ items: domainCollections[state.domain].map(row => ({ key: row.path.join('.'), label: `新增${row.label}`,
          onClick: () => create(row.path, `新增${row.label}`, document.activeElement as HTMLElement) })) }}><WorkbenchButton disabled={disabled}>新增工作单</WorkbenchButton></Dropdown>}
        {state.domain === 'direction' && <WorkbenchButton disabled={disabled} onClick={addShot}>手动添加镜头</WorkbenchButton>}
        {!state.domain && <Dropdown menu={{ items: [{ key: 'participants', label: '人物／物件' }, { key: 'events', label: '触发事件' }, { key: 'criteria', label: '验收要求' }].map(row => ({ ...row,
          onClick: () => create([row.key], `新增${row.label}`, document.activeElement as HTMLElement) })) }}><WorkbenchButton disabled={disabled}>新增共享对象</WorkbenchButton></Dropdown>}
        {!state.domain && <WorkbenchButton variant="quiet" disabled={disabled} onClick={() => setAssetTarget('create')}>从项目资产新增</WorkbenchButton>}
        {state.temporary && <><span>范围外 · 临时查看</span><WorkbenchButton onClick={() => go({ ...state, scope: 'all', temporary: undefined })}>查看整场</WorkbenchButton>
          <WorkbenchButton variant="quiet" onClick={() => go({ ...state, focus: undefined, temporary: undefined })}>结束临时查看</WorkbenchButton></>}
      </Space>}>
      {null}
    </DirectorCanvasSurface>
    {noticeHost && state.domain && state.domain !== 'prompt' && !graph.groups.find(group => group.domain === state.domain)?.members.some(node => !globalKeys.has(node.key)) && createPortal(<aside className="director-domain-empty" aria-label="设计域空状态">
      <p>{scope === 'shot' ? '当前镜头暂无明确关联的工作单' : '当前设计域暂无工作单'}</p>
      <WorkbenchButton onClick={() => go({ ...state, scope: 'all' })}>查看整场</WorkbenchButton>
    </aside>, noticeHost)}
    <SceneDesignPanel value={content.design} saved={saved.design} units={content.units} disabled={disabled}
      onChange={changeDesign} onNavigateTarget={(next, trigger) => {
        const path = resolveTarget(content.design, next)
        const node = path && allObjects.find(row => JSON.stringify(row.path) === JSON.stringify(path))
        const sourcePath = editingTarget && resolveTarget(content.design, editingTarget)
        const source = sourcePath && allObjects.find(row => JSON.stringify(row.path) === JSON.stringify(sourcePath))
        if (node) jump(node, source ? identity(source) : undefined)
        else { setUnavailable(true); trigger.focus({ preventScroll: true }) }
      }} onLocateUnit={onLocateUnit} focusRequest={focusRequest} onFocusHandled={() => setFocusRequest(undefined)}
      onSideClose={() => setEditingTarget(undefined)} sideContext={`${state.domain || 'outer'}:${scope}:${editorContext}:${externalOverlay || ''}`} />
    {assetTarget && <CanvasQuickEditor title="项目资产绑定" onClose={() => setAssetTarget(undefined)}>
      <SceneAssetLinks projectId={projectId} value={content.design} disabled={disabled} onChange={changeDesign}
        createOnly={assetTarget === 'create'} assetKind={assetTarget === 'location' ? 'scene' : undefined} participantId={assetTarget.startsWith('participant:') ? assetTarget.slice(12) : undefined} />
    </CanvasQuickEditor>}
  </>
}
