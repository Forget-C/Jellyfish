import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { ArrowLeftOutlined, ClockCircleOutlined, ExclamationCircleOutlined, MenuOutlined, ScissorOutlined, AppstoreOutlined, LayoutOutlined, DownOutlined } from '@ant-design/icons'
import { Alert, message, Button, Drawer, Empty, Grid, Input, Dropdown, Spin, Tooltip } from 'antd'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { managementBrowseKey, readManagementBrowse, saveManagementBrowse } from './managementBrowse'
import { usePageTitle } from '../../../layouts/pageTitle'
import { StudioDirectingService, type ChapterWorkbenchManagement, type WorkbenchSceneSummary } from '../../../services/generated'
import {
  managementStep, readChapterBrowse,
  saveChapterBrowse, type WorkbenchManagementStep,
} from './chapterNavigation'
import { directingError } from './common'
import { SceneObjectPreparation } from './SceneObjectPreparation'
import { WorkbenchCanvasCards } from './WorkbenchCanvasCards'
import { WorkbenchDivisionStep } from './WorkbenchDivisionStep'
import { useWorkspaceDraftStatus, WorkspaceDrafts } from './WorkspaceDrafts'
import './workbench-management.css'

type ProductionStep = Exclude<WorkbenchManagementStep, 'division'>
const steps: { id: WorkbenchManagementStep; label: string }[] = [
  { id: 'division', label: '场次划分' },
  { id: 'objects', label: '对象参考' },
  { id: 'storyboard', label: '分镜画布' },
]

function sceneNotices(scene: WorkbenchSceneSummary): string[] {
  const notices = []
  if (scene.source_changed) notices.push('章节原文已变化')
  if (scene.preparation_stale) notices.push('对象准备已过时')
  if (scene.object_task?.status === 'queued') notices.push('对象提取排队中')
  if (scene.object_task?.status === 'running') notices.push('正在提取对象')
  if (scene.storyboard_task?.status === 'queued') notices.push('分镜排队中')
  if (scene.storyboard_task?.status === 'running') notices.push('正在生成分镜')
  if (scene.object_task?.status === 'succeeded') notices.push('对象提取已完成')
  if (scene.object_task?.status === 'failed') notices.push('对象提取失败')
  if (scene.storyboard_task?.status === 'succeeded') notices.push('分镜已完成')
  if (scene.storyboard_task?.status === 'failed') notices.push('分镜生成失败')
  return notices
}

function SceneList({ overview, selected, historyOpen, setHistoryOpen, onSelect, query, setQuery, scrollTop }: {
  overview: ChapterWorkbenchManagement; selected?: string; historyOpen: boolean
  setHistoryOpen: (open: boolean) => void; onSelect: (id: string) => void
  query: string; setQuery: (query: string) => void; scrollTop: MutableRefObject<number>
}) {
  const list = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => { if (list.current) list.current.scrollTop = scrollTop.current }, [scrollTop])
  const keyword = query.trim().toLocaleLowerCase()
  const matching = (rows: WorkbenchSceneSummary[]) => rows.filter(row => `${row.position + 1}. ${row.title}`.toLocaleLowerCase().includes(keyword))
  const current = matching(overview.sequences)
  const historical = matching(overview.historical_sequences)
  const rows = (items: WorkbenchSceneSummary[]) => <ul className="management-scenes">
    {items.map(row => <li key={row.id}>
      <button type="button" className="management-scene-row" aria-pressed={row.id === selected} aria-current={row.id === selected ? 'true' : undefined} onClick={() => onSelect(row.id)}>
        <span className="management-scene-title">{row.position + 1}. {row.title}</span>
        <span className="management-scene-meta">{row.object_count} 个对象 · {row.canvas_count} 张画布</span>
        {sceneNotices(row).map(notice => <small className="management-scene-notice" data-tone={notice.includes('失败') ? 'error' : /变化|过时/.test(notice) ? 'warning' : 'muted'} key={notice}>{notice}</small>)}
      </button>
    </li>)}
  </ul>
  return <div ref={list} className="management-scene-list" onScroll={event => { scrollTop.current = event.currentTarget.scrollTop }}>
    <Input aria-label="搜索场次" placeholder="搜索名称或序号" allowClear value={query} onChange={event => setQuery(event.target.value)} />
    {current.length ? rows(current) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={keyword ? '没有匹配的场次' : '本章尚无场次'} />}
    <Button className="management-history-toggle" type="text" aria-expanded={historyOpen}
      onClick={() => setHistoryOpen(!historyOpen)}>{historyOpen ? '收起历史场次' : '查看历史场次'}</Button>
    {(historyOpen || !!keyword) && <section aria-label="历史场次">
      {historical.length ? rows(historical) : <p>{keyword ? '没有匹配的历史场次' : '暂无历史场次'}</p>}
    </section>}
  </div>
}

function ChapterManagement({ projectId, chapterId }: { projectId: string; chapterId: string }) {
  const { state } = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [overview, setOverview] = useState<ChapterWorkbenchManagement>()
  const [error, setError] = useState('')
  const [revision, setRevision] = useState(0)
  const [divisionRevision] = useState(0)
  const sidebarKey = managementBrowseKey(projectId, chapterId, '', 'sidebar')
  const [historyOpen, setHistoryOpen] = useState<boolean | undefined>(() => readManagementBrowse(sidebarKey).history)
  const [sceneQuery, setSceneQuery] = useState(() => readManagementBrowse(sidebarKey).query ?? '')
  const sceneScroll = useRef(readManagementBrowse(sidebarKey).top ?? 0)
  useEffect(() => () => { saveManagementBrowse(sidebarKey, { query: sceneQuery, history: historyOpen, top: sceneScroll.current }) }, [sidebarKey, sceneQuery, historyOpen])
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [navigationOpen, setNavigationOpen] = useState(false)
  useEffect(() => { setNavigationOpen(false) }, [params])
  const [storyboardActions, setStoryboardActions] = useState<HTMLDivElement | null>(null)
  const [objectActions, setObjectActions] = useState<HTMLDivElement | null>(null)
  const navigationToggle = useRef<HTMLButtonElement>(null)
  const [filterHost, setFilterHost] = useState<HTMLDivElement | null>(null)
  const picker = useRef<HTMLDivElement>(null)
  const [sceneSlots, setSceneSlots] = useState(1)
  const sceneToggle = useRef<HTMLButtonElement>(null)
  const divisionButton = useRef<HTMLButtonElement>(null)
  const regionHeading = useRef<HTMLHeadingElement>(null)
  const previousDivision = useRef<boolean>()
  const [divisionActions, setDivisionActions] = useState<HTMLDivElement | null>(null)
  const [notifications, messageContext] = message.useMessage()
  const [updatingDivision, setUpdatingDivision] = useState(false)
  const [retiredSelection, setRetiredSelection] = useState<string>()
  const drafts = useWorkspaceDraftStatus()
  const desktop = Grid.useBreakpoint().lg
  const compact = !Grid.useBreakpoint().md
  const explicitId = params.get('sequence')
  const explicitStep = managementStep(params.get('step'))
  const remembered = readChapterBrowse(projectId, chapterId)
  const current = overview?.sequences ?? []
  const history = overview?.historical_sequences ?? []
  const scenes = [...current, ...history]
  const rememberedScene = current.find(scene => scene.id === remembered.managementSequence)
  const retired = history.find(scene => scene.id === (retiredSelection ?? remembered.managementSequence))
  const division = explicitStep === 'division' || (!explicitId && !current.length && (!explicitStep || !history.length))
  const hasOverview = !!overview
  useLayoutEffect(() => {
    const element = picker.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setSceneSlots(Math.max(0, Math.min(3, Math.floor((entry.contentRect.width - 120) / 168)))))
    observer.observe(element)
    return () => observer.disconnect()
  }, [hasOverview, division])
  const selected = explicitId ? scenes.find(scene => scene.id === explicitId) : !retired ? rememberedScene ?? current[0] : undefined
  const historical = history.some(scene => scene.id === selected?.id)
  const sceneStart = Math.max(0, Math.min(current.length - sceneSlots, current.findIndex(scene => scene.id === selected?.id) - Math.floor(sceneSlots / 2)))
  const visibleScenes = current.slice(sceneStart, sceneStart + sceneSlots)
  const invalidScene = !!overview && !!explicitId && !selected
  const rememberedStep = remembered.managementStep
  const initialStep = (scene?: WorkbenchSceneSummary): ProductionStep =>
    scene?.id === rememberedScene?.id && rememberedStep && rememberedStep !== 'division'
      ? rememberedStep : scene?.canvas_count ? 'storyboard' : 'objects'
  const step = explicitStep && explicitStep !== 'division' ? explicitStep : initialStep(selected)
  const returnSearch = typeof state?.managementReturn === 'string' ? state.managementReturn : undefined
  const divisionTarget = current.find(scene => scene.id === explicitId)?.id
  const loading = !overview && !error
  const hasActive = scenes.some(scene => [scene.object_task, scene.storyboard_task]
    .some(task => task?.status === 'queued' || task?.status === 'running'))

  usePageTitle(overview ? `${overview.title} · 工作台管理` : '工作台管理')
  useEffect(() => {
    let active = true
    void StudioDirectingService.directingChapterWorkbenchManagement({ projectId, chapterId }).then(response => {
      const data = response.data
      if (!data) throw new Error('工作台管理读取失败')
      if (active) {
        setOverview(data)
        setError('')
        setUpdatingDivision(false)
      }
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, chapterId, revision])

  useEffect(() => {
    if (!hasActive) return
    const timer = window.setTimeout(() => setRevision(value => value + 1), 4000)
    return () => window.clearTimeout(timer)
  }, [hasActive, overview, error])

  useEffect(() => {
    if (retired && retired.id === remembered.managementSequence) {
      setRetiredSelection(retired.id)
      saveChapterBrowse(projectId, chapterId, { managementSequence: undefined, managementStep: undefined, managementCanvas: undefined })
    }
    if (!division && selected && !historical) {
      setRetiredSelection(undefined)
      saveChapterBrowse(projectId, chapterId, { managementSequence: selected.id, managementStep: step })
    }
  }, [projectId, chapterId, division, selected, historical, step, retired, remembered.managementSequence])

  const select = (sequenceId: string | undefined, nextStep: WorkbenchManagementStep, returnTo?: string) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (next.get('sequence') !== sequenceId || nextStep !== 'objects') next.delete('objectTask')
      if (next.get('sequence') !== sequenceId || nextStep !== 'storyboard') {
        next.delete('canvas')
        next.delete('storyboardTask')
      }
      next.delete('divisionTask')
      if (sequenceId) next.set('sequence', sequenceId)
      else next.delete('sequence')
      next.set('step', nextStep)
      return next
    }, { state: { ...state, managementReturn: returnTo } })
  }
  const reviewSource = (canvasId?: string) => {
    if (!selected || historical) return
    const previous = new URLSearchParams(params)
    previous.set('sequence', selected.id)
    previous.set('step', step)
    if (canvasId) previous.set('canvas', canvasId)
    select(selected.id, 'division', previous.toString())
  }
  const closeDrawer = () => {
    setDrawerOpen(false)
    sceneToggle.current?.focus({ preventScroll: true })
  }
  useEffect(() => { setDrawerOpen(false) }, [params])
  useEffect(() => { if (historical) setHistoryOpen(true) }, [historical, explicitId])
  useEffect(() => {
    if (!overview) return
    if (previousDivision.current !== undefined && previousDivision.current !== division && document.activeElement === document.body) {
      (regionHeading.current ?? divisionButton.current)?.focus({ preventScroll: true })
    }
    previousDivision.current = division
  }, [overview, division])
  const readingPanel = useRef<HTMLDivElement>(null)
  const browseKey = managementBrowseKey(projectId, chapterId, selected?.id ?? '', step)
  const ready = !!overview
  const hasTarget = !!(params.get('canvas') || params.get('storyboardTask') || params.get('objectTask'))
  useLayoutEffect(() => {
    const panel = readingPanel.current
    if (!panel || division || step === 'storyboard') return
    const top = hasTarget ? 0 : readManagementBrowse(browseKey).top ?? 0
    let restoring = true
    const observer = new ResizeObserver(() => restore())
    const stop = () => { restoring = false; observer.disconnect() }
    const restore = () => {
      panel.scrollTop = top
      if (panel.scrollHeight >= top + panel.clientHeight) stop()
    }
    const remember = () => { if (!restoring) saveManagementBrowse(browseKey, { top: panel.scrollTop }) }
    if (panel.firstElementChild) observer.observe(panel.firstElementChild)
    restore()
    panel.addEventListener('scroll', remember, { passive: true })
    panel.addEventListener('wheel', stop, { passive: true })
    panel.addEventListener('pointerdown', stop)
    panel.addEventListener('keydown', stop)
    return () => {
      if (!restoring) saveManagementBrowse(browseKey, { top: panel.scrollTop })
      stop()
      panel.removeEventListener('scroll', remember)
      panel.removeEventListener('wheel', stop)
      panel.removeEventListener('pointerdown', stop)
      panel.removeEventListener('keydown', stop)
    }
  }, [browseKey, ready, division, hasTarget, step])
  const list = overview && <SceneList overview={overview} selected={selected?.id} historyOpen={historyOpen ?? (historical || !current.length)}
    query={sceneQuery} setQuery={setSceneQuery} scrollTop={sceneScroll}
    setHistoryOpen={setHistoryOpen} onSelect={id => {
      if (id === selected?.id && id === explicitId) closeDrawer()
      else { closeDrawer(); drafts.transition(() => select(id, step)) }
    }} />
  const retiredNotice = retired && (division || !explicitId) && <Alert type="info" showIcon
    message={`原场次“${retired.title}”已转入历史`} action={<div className="management-steps">
      <Button size="small" onClick={() => select(retired.id, 'storyboard')}>查看该历史场次</Button>
      {!!current.length && division && <Button size="small" onClick={() => select(undefined, 'objects')}>选择当前场次</Button>}
    </div>} />
  const loadError = error && <Alert showIcon type="error" message={error} action={<Button size="small" onClick={() => {
    setError('')
    setRevision(value => value + 1)
  }}>重试</Button>} />
  const returnToChapters = () => drafts.transition(() => navigate(`/projects/${projectId}?tab=chapters`, { state: { chapterReturn: chapterId } }))

  const sourceNotice = selected?.source_changed && <Alert type="warning" showIcon message="章节原文已变化，仍使用本场已确认摘录。"
    action={!historical && <Button size="small" onClick={() => reviewSource()}>前往核对场次范围</Button>} />
  const preparationNotice = selected?.preparation_stale && !historical && step !== 'objects' && <Alert type="warning" showIcon
    message="对象准备依据已过时。请重新提取并采用适用对象，再创建新分镜画布。"
    action={<Button size="small" onClick={() => select(selected.id, 'objects')}>更新对象与参考</Button>} />
  const sceneNotices = <>
    {historical && <Alert type="info" showIcon message="此场次已退出当前划分，可查看原有准备和画布。" />}
    <div className="management-scene-notices" aria-label="本场制作提示">
      {preparationNotice}
      {sourceNotice && (preparationNotice ? <details><summary>章节原文也已变化，查看范围核对入口</summary>{sourceNotice}</details> : sourceNotice)}
    </div>
  </>
  const showCanvasList = step === 'storyboard' && !!selected
  const activeStep = division ? 'division' : step
  const chapterHeading = <div className="management-chapter-heading">
    <Button type="text" icon={<ArrowLeftOutlined aria-hidden />} title="返回章节列表" aria-label="返回章节列表" disabled={updatingDivision} onClick={returnToChapters} />
    <strong title={overview?.title}>{overview?.title ?? '工作台管理'}</strong>
  </div>
  const navigation = <nav className="management-flow-links" aria-label="制作步骤">
    {steps.map(({ id, label }) => {
      const tasks = current.flatMap(scene => id === 'objects' ? [scene.object_task] : id === 'storyboard' ? [scene.storyboard_task] : [])
      const failed = tasks.some(task => task?.status === 'failed')
      const running = tasks.some(task => task?.status === 'queued' || task?.status === 'running')
      const changed = current.some(scene => id === 'objects' ? scene.preparation_stale : scene.source_changed)
      const status = !overview ? '正在读取' : failed ? '有任务失败' : running ? '有任务处理中' : changed ? '有依据需要核对' : ''
      const StatusIcon = failed || changed ? ExclamationCircleOutlined : ClockCircleOutlined
      const Icon = id === 'division' ? ScissorOutlined : id === 'objects' ? AppstoreOutlined : LayoutOutlined
      return <Button key={id} type="text" aria-current={activeStep === id ? 'step' : undefined}
        onClick={() => { if (activeStep !== id) drafts.transition(() => {
          const origin = returnSearch && new URLSearchParams(returnSearch)
          if (division && origin && origin.get('step') === id) {
            navigate({ search: returnSearch }, { state: { ...state, managementReturn: undefined } })
          } else select(selected?.id, id)
        }) }}>
        <Icon aria-hidden /><span>{label}</span>{!!status && <Tooltip title={`本章：${status}`}><span className="management-step-status" aria-label={`本章${label}：${status}`}><StatusIcon /></span></Tooltip>}
      </Button>
    })}
  </nav>
  return <WorkspaceLayout className="management-workspace" aria-label="工作台管理">
    {desktop ? <aside className="management-flow-sidebar">{chapterHeading}{navigation}</aside> : <div className="management-flow-trigger">{chapterHeading}<Button ref={navigationToggle} aria-expanded={navigationOpen} aria-label="制作步骤" icon={<MenuOutlined aria-hidden />} onClick={() => setNavigationOpen(true)}>制作步骤</Button><Drawer afterOpenChange={open => { if (!open) navigationToggle.current?.focus({ preventScroll: true }) }} aria-label="制作步骤" title="制作步骤" placement="left" open={navigationOpen} onClose={() => setNavigationOpen(false)}>{navigation}</Drawer></div>}
    <div className="management-flow-content">
    {messageContext}
    {state?.chapterCompositionRetired === true && <Alert type="info" showIcon
      message="章节组合已停用，可在工作台管理中继续准备场次。" />}
    {!overview && loadError}
    {loading && <Spin className="management-loading" aria-label="正在读取工作台管理" />}
    {overview && division && <>
      <PageToolbar className="management-division-heading">
        <h2 ref={regionHeading} tabIndex={-1}>场次划分</h2>
        <div ref={setDivisionActions} className="management-division-action-host" />
      </PageToolbar>
      <WorkspaceScrollPanel className="management-panel">
      {loadError}
      {retiredNotice}
      {invalidScene && <Alert type="error" showIcon message="此场次不属于当前章节或已不可用" />}
      {current.some(scene => scene.source_changed) && <Alert type="warning" showIcon message="章节原文已变化，请核对场次范围。" />}
      {!current.length && <p>保存场次划分后即可进入场次制作。</p>}
      {!current.length && !!history.length && <Button onClick={() => select(undefined, 'storyboard')}>查看历史场次</Button>}
      <WorkbenchDivisionStep {...{ projectId, chapterId }} sequenceId={divisionTarget} refreshKey={divisionRevision}
        actionHost={divisionActions}
        targetTask={params.get('divisionTask')}
        onCloseTask={() => setParams(previous => {
          const next = new URLSearchParams(previous)
          next.delete('divisionTask')
          return next
        }, { replace: true, state: { ...state, directingContextSync: true } })}
        onChanged={(_id, count) => {
          void notifications.success({ key: 'division-save', content: `已保存，共 ${count} 个场次` })
          setUpdatingDivision(true)
          setRevision(value => value + 1)
          if (!drafts.pendingNavigation && !explicitStep) select(divisionTarget, 'division')
        }} />
    </WorkspaceScrollPanel></>}
    {overview && !division && <div className="management-body">
      <div className="management-content">
        <PageToolbar className="management-toolbar">
          <div className="management-identity">
            <h2 id="management-current-scene" ref={regionHeading} tabIndex={-1}>{step === 'objects' ? '对象参考' : '分镜画布'}</h2>
          </div>
          <div ref={picker} className="management-title-scenes" role="group" aria-label="选择场次">
            {!compact && !historical && visibleScenes.map(scene => <Button key={scene.id} type="text" aria-pressed={selected?.id === scene.id} title={`${scene.position + 1}. ${scene.title}`} onClick={() => { if (selected?.id !== scene.id) drafts.transition(() => select(scene.id, step)) }}>{scene.position + 1}. {scene.title}</Button>)}
            {!!scenes.length && <Dropdown trigger={['click']} placement="bottomRight" open={drawerOpen} onOpenChange={open => { if (open) setDrawerOpen(true); else closeDrawer() }}
              dropdownRender={() => <div className="management-scene-popup" role="dialog" aria-label="本章场次" onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); closeDrawer() }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('.management-scene-row'))
                  if (!buttons.length) return
                  event.preventDefault()
                  const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
                  buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
                }
              }}>{list}</div>}>
              <Button ref={sceneToggle} type="text" aria-expanded={drawerOpen} title={selected?.title}>{compact || sceneSlots === 0 || historical ? `${historical ? '历史场次：' : ''}${selected ? `${selected.position + 1}. ${selected.title}` : '选择场次'}` : '全部场次'}<DownOutlined aria-hidden /></Button>
            </Dropdown>}
          </div>
        </PageToolbar>
        {!!selected && <div className="management-browse-toolbar">
          <div ref={setFilterHost} className="management-filter-host" />
          {step === 'objects' ? <div className="management-object-actions" ref={setObjectActions} /> : <div className="management-storyboard-actions" ref={setStoryboardActions} />}
        </div>}
        <WorkspaceScrollPanel ref={readingPanel} className={showCanvasList ? 'management-panel management-storyboard-panel' : 'management-panel'}>
          {!showCanvasList && <>{loadError}{retiredNotice}</>}
          {invalidScene && <Alert type="error" showIcon message="此场次不属于当前章节或已不可用" />}
          {!selected && !invalidScene && <p>{current.length ? '请选择当前场次继续制作。' : '本章没有当前场次，可从历史场次查看已有内容。'}</p>}
          {selected && <section key={selected.id} className="management-scene-production" aria-labelledby="management-current-scene">
            {!showCanvasList && sceneNotices}
            {step === 'objects' && <SceneObjectPreparation {...{ projectId, chapterId }} sequenceId={selected.id}
              editable={!historical && !!selected.source_excerpt.trim()}
              management={{ host: objectActions, filterHost,
                onChange: () => setRevision(value => value + 1), candidateTaskId: params.get('objectTask'),
                clearCandidateTask: () => setParams(previous => {
                  const next = new URLSearchParams(previous)
                  next.delete('objectTask')
                  return next
                }, { replace: true }) }} />}
            {step === 'storyboard' && <WorkbenchCanvasCards {...{ projectId, chapterId, historical }} sequenceId={selected.id} sceneName={selected.title}
              onReviewSource={reviewSource}
              canCreate={!historical && !!selected.source_excerpt.trim()} actionHost={storyboardActions} filterHost={filterHost}
              sceneNotices={<>{loadError}{retiredNotice}{sceneNotices}</>}
              targetCanvas={params.get('canvas')} targetTask={params.get('storyboardTask')}
              onCloseTask={canvasId => setParams(previous => {
                const next = new URLSearchParams(previous)
                next.delete('storyboardTask')
                if (canvasId) next.set('canvas', canvasId)
                return next
              }, { replace: true, state }) }
              onChange={() => setRevision(value => value + 1)} />}
          </section>}
        </WorkspaceScrollPanel>
      </div>
    </div>}
    </div>
  </WorkspaceLayout>
}

export function WorkbenchManagementPage() {
  const { projectId, chapterId } = useParams()
  return projectId && chapterId
    ? <WorkspaceDrafts><ChapterManagement key={JSON.stringify([projectId, chapterId])} projectId={projectId} chapterId={chapterId} /></WorkspaceDrafts>
    : null
}
