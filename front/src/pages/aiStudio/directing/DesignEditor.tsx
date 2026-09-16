import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Alert, Button, Drawer, Empty, Input, Modal, Select, Tabs } from 'antd'
import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import type { SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { readWorkspaceContext, readDesignPosition, saveWorkspaceContext } from './workspaceContext'
import { designLabels } from './designLabels'
import { SourceInspector, SourceLinks } from './Sources'
import { DesignRelations } from './DesignRelations'
import { DesignRelationEditor } from './DesignRelationEditor'
import { DesignStoryboard } from './DesignStoryboard'
import { emptyDesign } from './designTemplate'
import { DesignFields, designAt, noteText, patchDesign } from './DesignFields'
import { departmentNames, designObjects, shotIssues, scopeShots, scopeGraph, shotGraph, reorderScopeShots } from './designWorkspace'
import type { DesignScope, DesignEdge } from './designWorkspace'
import { SequenceNavigation } from './SequenceLayout'

/** 范围与共享选择驱动分镜、关系画布与对象详情，所有编辑直接更新唯一设计内容。 */
export function DesignEditor({ value, onChange, disabled = false, active = true, assets, revisionId, cuts, rememberContext, onShoot, shootUnavailable }: { value: SceneDesign_Input; onChange: (value: SceneDesign_Input) => void; disabled?: boolean; active?: boolean; revisionId?: string; cuts?: WorkspaceRead['cuts']; assets?: ReactNode; rememberContext?: { projectId: string; sequenceId: string }; onShoot?: (shotId: string) => void; shootUnavailable?: string }) {
  const initialContext = useRef(rememberContext ? readWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId) : {})
  const [selected, setSelected] = useState<string | undefined>(initialContext.current.designObject || undefined)
  const [tab, setTab] = useState(['narrative', 'performance', 'camera', 'relations'].includes(initialContext.current.designTab || '') ? initialContext.current.designTab! : 'narrative')
  const [selectionEpoch, setSelectionEpoch] = useState(0)
  const [relation, setRelation] = useState<{ edge?: DesignEdge; objectKey?: string }>()
  const [view, setView] = useState(['storyboard', 'relations', 'list'].includes(initialContext.current.designView || '') ? initialContext.current.designView! : 'storyboard')
  const auxiliaryReturn = useRef<{ view: string; selected?: string }>({ view: 'storyboard' })
  const openRoles = (nextRole?: string) => { if (view !== 'roles') auxiliaryReturn.current = { view, selected }; if (nextRole) setRole(nextRole); setView('roles') }
  const closeRoles = () => { setView(auxiliaryReturn.current.view); setSelected(auxiliaryReturn.current.selected) }
  const [query, setQuery] = useState(initialContext.current.designQuery || '')
  const [scope, setScope] = useState<DesignScope>(initialContext.current.designScope === 'unassigned' || initialContext.current.designScope?.startsWith('beat:') ? initialContext.current.designScope as DesignScope : 'all')
  const beat = scope.startsWith('beat:') ? scope.slice(5) : undefined
  const [problems, setProblems] = useState(initialContext.current.designProblems === 'true')
  const [role, setRole] = useState('direction')
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [assetsOpen, setAssetsOpen] = useState(false)
  useEffect(() => { if (!active) { setAssetsOpen(false); setDetailsOpen(false) } }, [active])
  const [scrollTop, setScrollTop] = useState(() => readDesignPosition(initialContext.current.designListPosition, revisionId, scope).top)
  useEffect(() => { if (rememberContext) saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, { designListPosition: JSON.stringify({ revisionId, scope, top: scrollTop }) }) }, [scrollTop, scope, revisionId, rememberContext?.projectId, rememberContext?.sequenceId])
  const [revealId, setRevealId] = useState<string>()
  const [height, setHeight] = useState(640)
  const [inspectorWidth, setInspectorWidth] = useState(344)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => { if (view === 'list' && list.current) list.current.scrollTop = scrollTop }, [view])
  const desktop = useWorkbenchDesktop()
  const objects = useMemo(() => designObjects(value), [value])
  const scopedShots = useMemo(() => scopeShots(value, scope), [value, scope])
  const scopeLabel = scope === 'all' ? '全场' : scope === 'unassigned' ? '未分组' : `节拍 ${String(value.direction.beats.findIndex(row => row.id === beat) + 1).padStart(2, '0')} · ${noteText(value.direction.beats.find(row => row.id === beat)?.objective) || '未命名节拍'}`
  useEffect(() => {
    if (beat && !value.direction.beats.some(row => row.id === beat)) setScope('all')
    if (selected && !objects.some(object => object.key === selected)) setSelected(undefined)
  }, [objects, selected, beat, value.direction.beats])
  useEffect(() => {
    if (!rememberContext) return
    saveWorkspaceContext(rememberContext.projectId, rememberContext.sequenceId, {
      designScope: scope, designView: view === 'roles' ? auxiliaryReturn.current.view : view,
      designObject: selected ?? null, designQuery: query, designProblems: String(problems), designTab: tab,
    })
  }, [rememberContext?.projectId, rememberContext?.sequenceId, scope, view, selected, query, problems, tab])
  const changeScope = (next: DesignScope) => {
    const allowed = next === 'all' ? objects.map(row => row.key) : [...scopeGraph(value, next).nodes.map(row => row.key), next]
    if (selected && !allowed.includes(selected)) setSelected(undefined)
    setScope(next); setScrollTop(0); setRelation(undefined)
    if (list.current) list.current.scrollTop = 0
  }
  const [scopeHistory, setScopeHistory] = useState<Array<{ scope: DesignScope; selected?: string }>>([])
  const previousRevision = useRef(revisionId)
  useEffect(() => {
    if (previousRevision.current === revisionId) return
    previousRevision.current = revisionId; setScopeHistory([]); setRelation(undefined)
    const next = beat && !value.direction.beats.some(row => row.id === beat) ? 'all' : scope
    const allowed = next === 'all' || view === 'roles' ? objects.map(row => row.key) : [...scopeGraph(value, next).nodes.map(row => row.key), next, 'overview']
    if (selected && !allowed.includes(selected)) setSelected(undefined)
  }, [revisionId, scope, beat, objects, selected, value, view])
  const enterGraphScope = (id?: string) => {
    const next: DesignScope = id ? `beat:${id}` : 'all'
    if (next === scope) return
    setScopeHistory(previous => [...previous, { scope, selected }]); changeScope(next)
  }
  const returnGraphScope = () => {
    const previous = scopeHistory[scopeHistory.length - 1]
    if (!previous) return
    const next = previous.scope.startsWith('beat:') && !value.direction.beats.some(row => `beat:${row.id}` === previous.scope) ? 'all' : previous.scope
    changeScope(next)
    const allowed = next === 'all' ? objects : scopeGraph(value, next).nodes
    setSelected(allowed.some(row => row.key === previous.selected) ? previous.selected : undefined)
    setScopeHistory(history => history.slice(0, -1))
  }
  const selectedObject = objects.find(row => row.key === selected)
  const shotId = selectedObject?.key.startsWith('shot:') ? selectedObject.key.slice(5) : undefined
  const shot = value.direction.shots.find(row => row.id === shotId)
  const filtered = useMemo(() => scopedShots.filter(row => {
    const index = value.direction.shots.indexOf(row)
    const names = value.direction.blocking_states.filter(b => row.blocking_state_ids.includes(b.id)).map(b => value.participants.find(p => p.id === b.participant_id)?.name).join(' ')
    return (!problems || shotIssues(value, row.id).length) && `${index + 1} ${row.id} ${noteText(row.visible_result)} ${noteText(row.narrative_function)} ${names}`.toLowerCase().includes(query.toLowerCase())
  }), [value, scopedShots, query, problems])
  const rows = useMemo(() => {
    const groups = new Map<string, typeof filtered>()
    filtered.forEach(row => { const group = beat || row.beat_ids.find(id => value.direction.beats.some(item => item.id === id)) || ''; groups.set(group, [...(groups.get(group) || []), row]) })
    return [...groups].flatMap(([id, shots]) => [{ kind: 'group' as const, id, shots }, ...shots.map(shot => ({ kind: 'shot' as const, id: shot.id, shot }))])
  }, [filtered, beat])
  useEffect(() => {
    const target = list.current
    if (!target) return
    const observer = new ResizeObserver(() => setHeight(target.clientHeight))
    observer.observe(target)
    return () => observer.disconnect()
  }, [view])
  useEffect(() => { const reset = () => setInspectorWidth(344); window.addEventListener('sequence-reset-layout', reset); return () => window.removeEventListener('sequence-reset-layout', reset) }, [])
  const select = (key: string, open = true) => { setSelectionEpoch(previous => previous + 1); setSelected(key); setRelation(undefined); if (open && !desktop) setDetailsOpen(true) }
  const reveal = (id: string) => {
    setSelected(`shot:${id}`); setRevealId(id)
  }
  useEffect(() => {
    if (!revealId || view !== 'list' || !list.current) return
    const row = rows.findIndex(row => row.kind === 'shot' && row.id === revealId)
    if (row >= 0) list.current.scrollTop = Math.max(0, row * 40 - list.current.clientHeight / 2)
    setRevealId(undefined)
  }, [revealId, rows, view])
  const update = (next: SceneDesign_Input) => onChange(next)
  const addShot = () => {
    const id = 'shot-' + crypto.randomUUID().slice(0, 8)
    const template = emptyDesign().direction.shots[0]
    onChange({ ...value, direction: { ...value.direction, shots: [...value.direction.shots, { ...template, id, beat_ids: beat ? [beat] : scope === 'unassigned' ? [] : value.direction.beats.slice(0, 1).map(b => b.id), event_ids: [], criterion_ids: [], blocking_state_ids: [] }] } })
    setSelected(`shot:${id}`)
  }
  const impact = selectedObject && !selectedObject.key.startsWith('shot:')
    ? value.direction.shots.filter(s => shotGraph(value, s.id).nodes.some(node => node.key === selectedObject.key))
    : []
  const inspectorElement = useRef<HTMLDivElement>(null)
  const [issueField, setIssueField] = useState<string>()
  const showIssue = (id: string, issue: string) => {
    const target = value.direction.shots.find(row => row.id === id)
    const missing = target && ([['beat_ids', value.direction.beats], ['event_ids', value.events], ['blocking_state_ids', value.direction.blocking_states], ['criterion_ids', value.criteria]] as const).find(([key, rows]) => target[key].some(ref => !rows.some(row => row.id === ref)))?.[0]
    const field = ({ '动作待明确': 'visible_result', '叙事待明确': 'narrative_function', '时长未填写': 'estimated_duration_ms', '未关联节拍': 'beat_ids', '关联缺失': missing || 'beat_ids' } as Record<string, string>)[issue]
    select(`shot:${id}`); setTab(field?.endsWith('_ids') ? 'relations' : 'narrative'); setIssueField(field)
  }
  useEffect(() => {
    if (!issueField) return
    const frame = requestAnimationFrame(() => {
      const field = inspectorElement.current?.querySelector<HTMLElement>(`[aria-label="${designLabels[issueField]}"]`)
      field?.scrollIntoView({ block: 'nearest' }); field?.focus({ preventScroll: true }); setIssueField(undefined)
    })
    return () => cancelAnimationFrame(frame)
  }, [issueField, selected, tab])
  const cameraIndex = value.cinematography.findIndex(row => row.shot_id === shotId)
  const shotIndex = value.direction.shots.findIndex(row => row.id === shotId)
  const hiddenSelection = !!shotId && !filtered.some(row => row.id === shotId)
  const moveShot = (id: string, delta: number) => {
    const index = filtered.findIndex(row => row.id === id), target = filtered[index + delta]
    if (target) update(reorderScopeShots(value, filtered.map(row => row.id), id, target.id))
  }
  const inspector = <div className="design-inspector-content" ref={inspectorElement}><SourceInspector identity={`${revisionId}:${selected}:${selectionEpoch}`}>
    {hiddenSelection && <Alert type="info" message="所选对象不在当前筛选结果中" action={<Button onClick={() => { setQuery(''); setProblems(false) }}>清除筛选</Button>} />}
    {relation ? <DesignRelationEditor value={value} {...relation} disabled={disabled} onChange={update} onSelect={select} onClose={() => setRelation(undefined)} /> : !selectedObject ? <><h2>{scopeLabel}</h2><p>{scopedShots.length} 个关联镜头 · 预计 {scopedShots.reduce((n, row) => n + (row.estimated_duration_ms || 0), 0) / 1000} 秒</p><p className="design-secondary">选择分镜或关系节点，查看与编辑对象。</p>{beat && <Button onClick={() => select(`beat:${beat}`)}>编辑本节拍</Button>}<Button onClick={() => select('overview')}>全场概览</Button></> : <>
    <h2>{selectedObject.label}</h2>{shot && onShoot && <><Button disabled={disabled || !!shootUnavailable} onClick={() => onShoot(shot.id)}>查看对应试拍单元</Button>{shootUnavailable && <p className="design-secondary">{shootUnavailable}</p>}</>}
    {shot && <div className="design-issue-actions">{shotIssues(value, shot.id).map(issue => <Button type="link" size="small" key={issue} onClick={() => showIssue(shot.id, issue)}>{issue} · 定位字段</Button>)}</div>}
    {shot && <p className="design-secondary">覆盖节拍：{shot.beat_ids.map(id => `${value.direction.beats.findIndex(b => b.id === id) + 1} ${noteText(value.direction.beats.find(b => b.id === id)?.objective)}`).join('、') || '未关联'}</p>}
    {impact.length > 1 && <Alert type="info" message={`共享规则 · 修改将影响 ${impact.length} 个镜头`} description={impact.map(s => `镜头 ${value.direction.shots.indexOf(s) + 1}`).join('、')} />}
    {shot ? <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'narrative', label: '叙事', children: <DesignFields value={value} path={['direction', 'shots', shotIndex]} fields={['visible_result', 'narrative_function', 'estimated_duration_ms']} onChange={update} disabled={disabled} /> },
      { key: 'performance', label: '表演', children: <>{value.performance.beats.map((row, index) => shot.beat_ids.includes(row.beat_id) && <section className="design-related" key={index}><p>{value.participants.find(p => p.id === row.participant_id)?.name || '缺失人物引用'} · 共享节拍表演</p><p>{noteText(row.physical_action) || '身体动作待填写'}</p><Button onClick={() => select(`performance:${index}`)}>编辑表演与影响范围</Button></section>)}<Button onClick={() => { openRoles('performance') }}>完整表演审阅</Button></> },
      { key: 'camera', label: '摄影', children: cameraIndex >= 0 ? <><DesignFields value={value} path={['cinematography', cameraIndex]} fields={['composition', 'lens_effect', 'movement_path', 'end_frame']} onChange={update} disabled={disabled} /><details><summary>完整摄影参数与验收依据</summary><DesignFields value={value} path={['cinematography', cameraIndex]} fields={Object.keys(value.cinematography[cameraIndex]).filter(key => !['composition', 'lens_effect', 'movement_path', 'end_frame'].includes(key))} onChange={update} disabled={disabled} /></details></> : <Empty description="此镜头尚无摄影设计">{!disabled && <Button onClick={() => onChange({ ...value, cinematography: [...value.cinematography, { ...emptyDesign().cinematography[0], shot_id: shot.id, criterion_ids: [] }] })}>添加摄影设计</Button>}</Empty> },
      { key: 'relations', label: '关联', children: <><DesignFields value={value} path={['direction', 'shots', shotIndex]} fields={['beat_ids', 'event_ids', 'blocking_state_ids', 'criterion_ids']} onChange={update} disabled={disabled} /><h3>相关对象</h3>{objects.filter(o => o.key.startsWith('blocking:') && shot.blocking_state_ids.includes(o.key.slice(9)) || o.key.startsWith('event:') && shot.event_ids.includes(o.key.slice(6)) || o.key.startsWith('criterion:') && shot.criterion_ids.includes(o.key.slice(10))).map(o => <Button block type="text" className="design-object-link" key={o.key} onClick={() => select(o.key)}>{o.label}</Button>)}<Button onClick={() => { openRoles('sound') }}>声音与连续性审阅</Button></> },
    ]} /> : <DesignFields value={value} path={selectedObject.path} fields={selectedObject.fields} onChange={update} disabled={disabled} />}
    {!disabled && typeof selectedObject.path[selectedObject.path.length - 1] === 'number' && <Button danger onClick={() => Modal.confirm({ title: `移除${selectedObject.label}`, content: '会从当前设计草稿移除此对象。其他对象保留原引用，缺失关联会明确标记，保存前需要修复。', onOk: () => { const path = selectedObject.path.slice(0, -1); const index = selectedObject.path[selectedObject.path.length - 1]; update(patchDesign(value, path, designAt(value, path).filter((_: unknown, i: number) => i !== index))); setSelected(undefined) } })}>移除当前对象</Button>}
    <h3>设计来源</h3><SourceLinks sources={value.sources} /><details className="design-source"><summary>对象技术身份</summary><p>{selectedObject.key}</p></details>
    </>}
  </SourceInspector></div>
  const start = Math.max(0, Math.floor(scrollTop / 40) - 4)
  const visible = rows.slice(start, start + Math.ceil(height / 40) + 8)
  return <div className="design-workspace" style={{ '--sequence-inspector-width': `${inspectorWidth}px` } as React.CSSProperties} data-workspace-target="design-editor" tabIndex={-1}>
    {active && <SequenceNavigation><div className="design-navigation"><h2>场次结构</h2>
      <Button type="text" block aria-pressed={scope === 'all'} onClick={() => changeScope('all')}>全场 · {value.direction.shots.length} 个镜头</Button>
      <div className="design-tree">{value.direction.beats.map((b, i) => <Button type="text" block aria-pressed={beat === b.id} key={b.id} onClick={() => changeScope(`beat:${b.id}`)}>{String(i + 1).padStart(2, '0')}　{noteText(b.objective) || '未命名节拍'} · {scopeShots(value, `beat:${b.id}`).length} 镜</Button>)}
        {!!scopeShots(value, 'unassigned').length && <Button type="text" block aria-pressed={scope === 'unassigned'} onClick={() => changeScope('unassigned')}>未分组 · {scopeShots(value, 'unassigned').length} 镜</Button>}
      </div>
      <div className="design-navigation-bottom"><Button type="text" block onClick={() => setAssetsOpen(true)}>人物与场所</Button><Button type="text" block onClick={() => openRoles()}>全场规则</Button><Button type="text" block aria-pressed={problems} onClick={() => setProblems(!problems)}>设计问题 · {scopedShots.filter(s => shotIssues(value, s.id).length).length}</Button></div>
    </div></SequenceNavigation>}
    <section className="design-center">
      <div className="design-view-toolbar"><div className="design-scope-heading"><strong>{scopeLabel}</strong><small>{scopedShots.length} 镜 · 预计 {scopedShots.reduce((n, row) => n + (row.estimated_duration_ms || 0), 0) / 1000} 秒</small></div><div className="design-view-tabs" role="tablist" aria-label="设计视图">{[['storyboard', '分镜'], ['relations', '关系']].map(([key, label]) => <button role="tab" aria-selected={view === key} key={key} onClick={() => setView(key)}>{label}</button>)}</div><Button aria-label="表格" aria-pressed={view === 'list'} onClick={() => setView('list')}>表格</Button>{!active && <Button onClick={() => openRoles()}>岗位审阅</Button>}<Input prefix={<SearchOutlined />} aria-label="搜索镜头、动作、人物" placeholder="搜索当前范围" value={query} onChange={event => { setQuery(event.target.value); setScrollTop(0); if (list.current) list.current.scrollTop = 0 }} allowClear /><Button aria-pressed={problems} onClick={() => setProblems(!problems)}>仅看问题</Button></div>
      <div className="design-view-content" hidden={view !== 'list'}><div className="design-intent"><strong>本场意图：{noteText(value.direction.information_change) || '待明确'}</strong><Button type="link" onClick={() => select('overview')}>全场概览 ›</Button></div>
        <div className="design-list-head" role="row"><span>镜头</span><span>可见动作</span><span>叙事作用</span><span>预计时长</span><span>待处理</span></div>
        <div className="design-shot-list" role="grid" aria-label="镜头清单" aria-rowcount={filtered.length} tabIndex={0} ref={list} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} onKeyDown={event => {
          if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) return
          event.preventDefault()
          if (event.key === 'Enter') { setDetailsOpen(true); return }
          const current = filtered.findIndex(s => s.id === shotId)
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? filtered.length - 1 : Math.max(0, Math.min(filtered.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
          if (filtered[index]) reveal(filtered[index].id)
        }}>
          {!filtered.length && <Empty description="没有匹配的镜头" />}
          <div style={{ height: rows.length * 40, position: 'relative' }}>{visible.map((row, index) => row.kind === 'group' ? <div className="design-group-row" style={{ top: (start + index) * 40 }} key={`group:${row.id}`}><strong>{row.id ? `${String(value.direction.beats.findIndex(b => b.id === row.id) + 1).padStart(2, '0')}　${noteText(value.direction.beats.find(b => b.id === row.id)?.objective) || '待明确节拍'}` : '未分组'}</strong><span>（{row.shots.length} 个镜头）</span></div> : <div className={`design-shot-row${shotId === row.id ? ' is-selected' : ''}`} role="row" aria-selected={shotId === row.id} data-shot-id={row.id} style={{ top: (start + index) * 40 }} key={row.id} onClick={() => select(`shot:${row.id}`)}>
            <span>{String(value.direction.shots.indexOf(row.shot) + 1).padStart(2, '0')}</span><span title={noteText(row.shot.visible_result)}>{noteText(row.shot.visible_result) || '动作待填写'}{row.shot.beat_ids.length > 1 && <small> · 跨 {row.shot.beat_ids.length} 节拍</small>}</span><span title={noteText(row.shot.narrative_function)}>{noteText(row.shot.narrative_function) || '待填写'}</span><span>{row.shot.estimated_duration_ms ? `${row.shot.estimated_duration_ms / 1000}s` : '未填写'}</span><span className={shotIssues(value, row.id).length ? 'design-issue' : 'design-secondary'} title={shotIssues(value, row.id).join('；')}>{shotIssues(value, row.id)[0] || '未记录问题'}</span>
          </div>)}</div>
        </div><div className="design-list-footer"><span>{filtered.length} / {scopedShots.length} 个镜头 · 预计 {scopedShots.reduce((n, s) => n + (s.estimated_duration_ms || 0), 0) / 1000} 秒</span>{!disabled && <Button size="small" icon={<PlusOutlined />} onClick={addShot}>新增镜头</Button>}</div></div>
      <div className="design-view-content" hidden={view !== 'storyboard'}><DesignStoryboard onIssue={showIssue} active={view === 'storyboard'} onRevealed={() => setRevealId(undefined)} rememberContext={rememberContext} key={revisionId} value={value} shots={filtered} selected={shotId} onSelect={id => select(`shot:${id}`)} revisionId={revisionId} cuts={cuts} scope={scope} revealId={revealId} onMove={disabled ? undefined : moveShot} />{!disabled && <div className="design-list-footer"><span>{filtered.length} / {scopedShots.length} 个镜头</span><Button size="small" icon={<PlusOutlined />} onClick={addShot}>新增镜头</Button></div>}</div>
      <div className="design-view-content" hidden={view !== 'relations'}><DesignRelations onIssue={showIssue} key={revisionId} revisionId={revisionId} rememberContext={rememberContext} onReturn={scopeHistory.length ? returnGraphScope : undefined} value={value} scope={scope} visibleShotIds={filtered.map(row => row.id)} selected={selected} active={view === 'relations'} onSelect={select} onLocate={id => { setQuery(''); setProblems(false); setView('storyboard'); reveal(id) }} onRelation={edge => { setRelation({ edge }); if (!desktop) setDetailsOpen(true) }} onEditRelations={objectKey => { setRelation({ objectKey }); if (!desktop) setDetailsOpen(true) }} onBeatSelect={enterGraphScope} /></div>
      <div className="design-view-content" hidden={view !== 'roles'}><Button onClick={closeRoles}>返回{auxiliaryReturn.current.view === 'relations' ? '关系' : auxiliaryReturn.current.view === 'list' ? '表格' : '分镜'}</Button><div className="design-role-browser"><Select aria-label="岗位" value={role} onChange={setRole} options={Object.entries({ ...departmentNames, participants: '人物与物件' }).map(([value, label]) => ({ value, label }))} /><h2>{departmentNames[role] || '人物与物件'}</h2><p className="design-secondary">选择对象查看全部字段；共享内容仅在原对象上编辑。</p>{objects.filter(o => o.kind === role).map(o => <button className={`design-role-row${selected === o.key ? ' is-selected' : ''}`} key={o.key} onClick={() => select(o.key)}>{o.label}<span>查看与编辑 ›</span></button>)}{!disabled && <Select<string> aria-label="新增岗位对象" value={undefined} placeholder="新增对象" options={Object.entries(role === 'direction' ? { beats: '节拍', anchors: '空间锚点', blocking_states: '调度', events: '事件', criteria: '验收要求' } : role === 'performance' ? { situations: '角色情境', beats: '节拍表演' } : role === 'staging' ? { activities: '镜内活动' } : role === 'sound' ? { dialogues: '对白' } : { [role]: departmentNames[role] || '人物与物件' }).filter(([key]) => key !== 'prompt').map(([value, label]) => ({ value, label }))} onChange={key => {
          const path = ['events', 'criteria', 'cinematography', 'continuity', 'participants'].includes(key) ? [key] : [role, key]
          const rows = designAt(value, path)
          const sample = designAt(emptyDesign(), [...path, 0])
          if (!Array.isArray(rows) || !sample) return
          const next = structuredClone(sample); if ('id' in next) next.id = 'item-' + crypto.randomUUID().slice(0, 8)
          update(patchDesign(value, path, [...rows, next]))
        }} />}</div></div>
      {!desktop && <Button className="design-detail-trigger" onClick={() => setDetailsOpen(true)}>所选对象详情</Button>}
    </section>
    {desktop ? <aside className="design-inspector"><div className="design-inspector-resizer" role="separator" aria-label="调整详情宽度" tabIndex={0} aria-valuemin={300} aria-valuemax={480} aria-valuenow={inspectorWidth} onDoubleClick={() => setInspectorWidth(344)} onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setInspectorWidth(v => Math.max(300, Math.min(480, v + (event.key === 'ArrowLeft' ? 8 : -8)))) } }} onPointerDown={event => event.currentTarget.setPointerCapture(event.pointerId)} onPointerMove={event => { if (event.currentTarget.hasPointerCapture(event.pointerId)) setInspectorWidth(Math.max(300, Math.min(480, window.innerWidth - event.clientX))) }} />{inspector}</aside> : <Drawer title="对象详情" width={344} open={detailsOpen} onClose={() => setDetailsOpen(false)}>{inspector}</Drawer>}
    <Drawer title="人物、场所与风格" width={640} open={assetsOpen} onClose={() => setAssetsOpen(false)}>{assets || <DesignFields value={value} path={['participants']} onChange={update} disabled={disabled} />}</Drawer>
  </div>
}
