import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { EditOutlined, MenuOutlined, MoreOutlined } from '@ant-design/icons'
import { Alert, Button, Drawer, Dropdown, Empty, Grid, Input, Spin } from 'antd'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { usePageTitle } from '../../../layouts/pageTitle'
import { StudioDirectingService, type ChapterWorkbenchManagement, type WorkbenchSceneSummary } from '../../../services/generated'
import {
  legacySceneCanvasLocation, managementStep, readChapterBrowse,
  saveChapterBrowse, type WorkbenchManagementStep,
} from './chapterNavigation'
import { directingError } from './common'
import { SceneObjectPreparation } from './SceneObjectPreparation'
import { SequenceDetails } from './SequenceDetails'
import { WorkbenchCanvasCards } from './WorkbenchCanvasCards'
import { WorkbenchDivisionStep } from './WorkbenchDivisionStep'
import { useWorkspaceDraftStatus, WorkspaceDrafts } from './WorkspaceDrafts'
import './workbench-management.css'

type ProductionStep = Exclude<WorkbenchManagementStep, 'division'>
const steps: { id: ProductionStep; label: string }[] = [
  { id: 'objects', label: '对象与参考〔本场〕' },
  { id: 'storyboard', label: '分镜与画布〔本场〕' },
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
  const matching = (rows: WorkbenchSceneSummary[]) => rows.filter(row => row.title.toLocaleLowerCase().includes(keyword))
  const current = matching(overview.sequences)
  const historical = matching(overview.historical_sequences)
  const rows = (items: WorkbenchSceneSummary[]) => <ul className="management-scenes">
    {items.map(row => <li key={row.id}>
      <button type="button" className="management-scene-row" aria-pressed={row.id === selected} onClick={() => onSelect(row.id)}>
        <span className="management-scene-title">{row.position + 1}. {row.title}</span>
        <span className="management-scene-meta">{row.object_count} 个对象 · {row.canvas_count} 张画布</span>
        {sceneNotices(row).map(notice => <small className="management-scene-notice" key={notice}>{notice}</small>)}
      </button>
    </li>)}
  </ul>
  return <div ref={list} className="management-scene-list" onScroll={event => { scrollTop.current = event.currentTarget.scrollTop }}>
    <Input aria-label="搜索场次" placeholder="按名称搜索场次" allowClear value={query} onChange={event => setQuery(event.target.value)} />
    {current.length ? rows(current) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE}
      description={keyword ? '没有匹配的场次' : '本章尚无场次'} />}
    <Button className="management-history-toggle" type="text" aria-expanded={historyOpen}
      onClick={() => setHistoryOpen(!historyOpen)}>{historyOpen ? '收起历史场次' : '查看历史场次'}</Button>
    {historyOpen && <section aria-label="历史场次">
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
  const [divisionRevision, setDivisionRevision] = useState(0)
  const [divisionView, setDivisionView] = useState('source')
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [historyOpen, setHistoryOpen] = useState<boolean>()
  const [sceneQuery, setSceneQuery] = useState('')
  const sceneScroll = useRef(0)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [storyboardActions, setStoryboardActions] = useState<HTMLDivElement | null>(null)
  const [objectActions, setObjectActions] = useState<HTMLDivElement | null>(null)
  const sceneToggle = useRef<HTMLButtonElement>(null)
  const [savedDivision, setSavedDivision] = useState<{ id: string; count: number }>()
  const [updatingDivision, setUpdatingDivision] = useState(false)
  const [retiredSelection, setRetiredSelection] = useState<string>()
  const drafts = useWorkspaceDraftStatus()
  const desktop = Grid.useBreakpoint().lg
  const explicitId = params.get('sequence')
  const explicitStep = managementStep(params.get('step'))
  const remembered = readChapterBrowse(projectId, chapterId)
  const current = overview?.sequences ?? []
  const history = overview?.historical_sequences ?? []
  const scenes = [...current, ...history]
  const rememberedScene = current.find(scene => scene.id === remembered.managementSequence)
  const retired = history.find(scene => scene.id === (retiredSelection ?? remembered.managementSequence))
  const division = explicitStep === 'division' || (!explicitId && !current.length && (!explicitStep || !history.length))
  const selected = explicitId ? scenes.find(scene => scene.id === explicitId) : !retired ? rememberedScene ?? current[0] : undefined
  const historical = history.some(scene => scene.id === selected?.id)
  const invalidScene = !!overview && !!explicitId && !selected
  const rememberedStep = remembered.managementStep
  const initialStep = (scene?: WorkbenchSceneSummary): ProductionStep =>
    scene?.id === rememberedScene?.id && rememberedStep && rememberedStep !== 'division'
      ? rememberedStep : scene?.canvas_count ? 'storyboard' : 'objects'
  const step = explicitStep && explicitStep !== 'division' ? explicitStep : initialStep(selected)
  const returnSearch = typeof state?.managementReturn === 'string' ? state.managementReturn : undefined
  const returnScene = returnSearch ? current.find(scene => scene.id === new URLSearchParams(returnSearch).get('sequence')) : undefined
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
    if (!division) setSavedDivision(undefined)
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
  const startProduction = () => {
    const scene = current.find(row => row.id === savedDivision?.id) ?? rememberedScene ?? current[0]
    if (retired) select(undefined, 'storyboard')
    else select(scene?.id, scene ? initialStep(scene) : 'storyboard')
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
  const list = overview && <SceneList overview={overview} selected={selected?.id} historyOpen={historyOpen ?? (historical || !current.length)}
    query={sceneQuery} setQuery={setSceneQuery} scrollTop={sceneScroll}
    setHistoryOpen={setHistoryOpen} onSelect={id => {
      if (id === selected?.id && id === explicitId) closeDrawer()
      else select(id, step)
    }} />
  const legacy = selected ? [
    { key: 'director', label: <Link to={legacySceneCanvasLocation(projectId, chapterId, selected.id, 'director')}>旧版导演</Link> },
    { key: 'units', label: <Link to={legacySceneCanvasLocation(projectId, chapterId, selected.id, 'units')}>旧版试拍</Link> },
    { key: 'edit', label: <Link to={legacySceneCanvasLocation(projectId, chapterId, selected.id, 'edit')}>旧版审片与剪辑</Link> },
  ] : []
  const retiredNotice = retired && (division || !explicitId) && <Alert type="info" showIcon
    message={`原场次“${retired.title}”已转入历史`} action={<div className="management-steps">
      <Button size="small" onClick={() => select(retired.id, 'storyboard')}>查看该历史场次</Button>
      {!!current.length && division && <Button size="small" onClick={() => select(undefined, 'objects')}>选择当前场次</Button>}
    </div>} />
  const loadError = error && <Alert showIcon type="error" message={error} action={<Button size="small" onClick={() => {
    setError('')
    setRevision(value => value + 1)
  }}>重试</Button>} />

  return <WorkspaceLayout className="management-workspace" aria-label="工作台管理">
    {overview && <PageToolbar>
      <nav className="management-steps" aria-label="工作台区域">
        <Button aria-current={division ? 'page' : undefined} type={division ? 'default' : 'text'}
          onClick={() => { if (!division) select(undefined, 'division') }}>场次划分</Button>
        <Button aria-current={!division ? 'page' : undefined} type={!division ? 'default' : 'text'}
          disabled={updatingDivision || (!current.length && !history.length)} onClick={() => { if (division) startProduction() }}>场次制作</Button>
      </nav>
    </PageToolbar>}
    {state?.chapterCompositionRetired === true && <Alert type="info" showIcon
      message="章节组合已停用，可在工作台管理中继续准备场次。" />}
    {!overview && loadError}
    {loading && <Spin className="management-loading" aria-label="正在读取工作台管理" />}
    {overview && division && <WorkspaceScrollPanel className="management-panel">
      {loadError}
      <div className="management-scene-heading">
        <h2>本章场次划分</h2>
        {returnScene && <Button disabled={updatingDivision} onClick={() => navigate({ search: returnSearch }, { state: { ...state, managementReturn: undefined } })}>返回该场次制作</Button>}
      </div>
      {retiredNotice}
      {invalidScene && <Alert type="error" showIcon message="此场次不属于当前章节或已不可用" />}
      {current.some(scene => scene.source_changed) && <Alert type="warning" showIcon message="章节原文已变化，请核对场次范围。" />}
      {!current.length && <p>保存场次划分后即可进入场次制作。</p>}
      {!current.length && !!history.length && <Button onClick={() => select(undefined, 'storyboard')}>查看历史场次</Button>}
      {savedDivision && <Alert type="success" showIcon message={`已保存，共 ${savedDivision.count} 个场次`}
        action={!!savedDivision.count && <Button size="small" disabled={updatingDivision || !!drafts.names.length} onClick={startProduction}>进入场次制作</Button>} />}
      <WorkbenchDivisionStep {...{ projectId, chapterId }} sequenceId={divisionTarget} refreshKey={divisionRevision}
        mobileView={divisionView} onMobileView={setDivisionView}
        targetTask={params.get('divisionTask')}
        onCloseTask={() => setParams(previous => {
          const next = new URLSearchParams(previous)
          next.delete('divisionTask')
          return next
        }, { replace: true, state: { ...state, directingContextSync: true } })}
        onSourceSaved={() => setRevision(value => value + 1)}
        onChanged={(id, count) => {
          setSavedDivision({ id, count })
          setUpdatingDivision(true)
          setRevision(value => value + 1)
          if (!drafts.pendingNavigation && !explicitStep) select(divisionTarget, 'division')
        }} />
    </WorkspaceScrollPanel>}
    {overview && !division && <div className="management-body">
      {desktop && <aside className="management-sidebar" aria-label="本章场次">
        <h2>本章场次</h2>
        {list}
      </aside>}
      <div className="management-content">
        <div className="management-production-toolbar">
          <div className="management-scene-heading">
            {selected && <h2 id="management-current-scene">{selected.title}</h2>}
            {historical && <span className="management-scene-meta">历史场次</span>}
            {!desktop && <Button ref={sceneToggle} icon={<MenuOutlined />} aria-expanded={drawerOpen}
              onClick={() => setDrawerOpen(true)}>切换场次</Button>}
            {selected && !historical && <Button type="text" icon={<EditOutlined />} aria-label="编辑场次名称与顺序"
              onClick={() => drafts.transition(() => setEditingMetadata(true))} />}
            {selected && <Dropdown menu={{ items: legacy }} trigger={['click']}>
              <Button type="text" icon={<MoreOutlined />} aria-label="场次更多操作" />
            </Dropdown>}
          </div>
          {selected && <div className="management-header">
            <nav className="management-steps" aria-label="工作台步骤">
              {steps.map(({ id, label }) => <Button key={id} aria-current={step === id ? 'step' : undefined}
                type={step === id ? 'default' : 'text'} onClick={() => { if (step !== id) select(selected.id, id) }}>{label}</Button>)}
            </nav>
            {step === 'objects' && <div className="management-object-actions" ref={setObjectActions} />}
            {step === 'storyboard' && <div ref={setStoryboardActions} />}
          </div>}
        </div>
        <WorkspaceScrollPanel className="management-panel">
          {loadError}
          {retiredNotice}
          {invalidScene && <Alert type="error" showIcon message="此场次不属于当前章节或已不可用" />}
          {!selected && !invalidScene && <p>{current.length ? '请选择当前场次继续制作。' : '本章没有当前场次，可从历史场次查看已有内容。'}</p>}
          {selected && <section key={selected.id} aria-labelledby="management-current-scene">
            {historical && <Alert type="info" showIcon message="此场次已退出当前划分，可查看原有准备和画布。" />}
            {selected.source_changed && <Alert type="warning" showIcon message="章节原文已变化，仍使用本场已确认摘录。"
              action={!historical && <Button size="small" onClick={() => reviewSource()}>前往核对场次范围</Button>} />}
            {selected.preparation_stale && !historical && step !== 'objects' && <Alert type="warning" showIcon
              message="对象准备依据已过时。请重新提取并采用适用对象，再创建新分镜画布。"
              action={<Button size="small" onClick={() => select(selected.id, 'objects')}>更新对象与参考</Button>} />}
            <h3>已确认场次原文摘要</h3>
            <p className="management-excerpt">{selected.source_excerpt || '暂无场次原文'}</p>
            {step === 'objects' && <SceneObjectPreparation {...{ projectId, chapterId }} sequenceId={selected.id}
              editable={!historical && !!selected.source_excerpt.trim()}
              management={{ host: objectActions, onContinue: () => select(selected.id, 'storyboard'),
                onChange: () => setRevision(value => value + 1), candidateTaskId: params.get('objectTask'),
                clearCandidateTask: () => setParams(previous => {
                  const next = new URLSearchParams(previous)
                  next.delete('objectTask')
                  return next
                }, { replace: true }) }} />}
            {step === 'storyboard' && <WorkbenchCanvasCards {...{ projectId, chapterId, historical }} sequenceId={selected.id}
              onReviewSource={reviewSource}
              canCreate={!historical && !!selected.source_excerpt.trim()} actionHost={storyboardActions}
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
      {!desktop && <Drawer afterOpenChange={open => { if (!open) sceneToggle.current?.focus({ preventScroll: true }) }} title="本章场次" placement="left" width="min(320px, 100vw)" open={drawerOpen}
        styles={{ body: { display: 'flex', flexDirection: 'column' } }}
        onClose={closeDrawer}>{list}</Drawer>}
      {editingMetadata && selected && !historical && <SequenceDetails key={selected.id}
        {...{ projectId, chapterId }} sequenceId={selected.id} onClose={() => setEditingMetadata(false)}
        onSaved={() => {
          setEditingMetadata(false)
          setDivisionRevision(value => value + 1)
          setRevision(value => value + 1)
        }}
        onRange={() => {
          setEditingMetadata(false)
          reviewSource()
        }} />}
    </div>}
  </WorkspaceLayout>
}

export function WorkbenchManagementPage() {
  const { projectId, chapterId } = useParams()
  return projectId && chapterId
    ? <WorkspaceDrafts><ChapterManagement key={JSON.stringify([projectId, chapterId])} projectId={projectId} chapterId={chapterId} /></WorkspaceDrafts>
    : null
}
