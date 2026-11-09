import { useEffect, useRef, useState } from 'react'
import { EditOutlined, MenuOutlined, MoreOutlined } from '@ant-design/icons'
import { Alert, Button, Drawer, Dropdown, Empty, Grid, Input, Spin } from 'antd'
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { PageToolbar, WorkspaceLayout, WorkspaceScrollPanel } from '../../../components/layout/PageLayout'
import { usePageTitle } from '../../../layouts/pageTitle'
import { StudioDirectingService, type ChapterWorkbenchManagement, type WorkbenchSceneSummary } from '../../../services/generated'
import {
  chapterLocation, legacySceneCanvasLocation, managementStep, readChapterBrowse,
  saveChapterBrowse, type WorkbenchManagementStep,
} from './chapterNavigation'
import { directingError } from './common'
import { SceneObjectPreparation } from './SceneObjectPreparation'
import { SequenceDetails } from './SequenceDetails'
import { WorkbenchCanvasCards } from './WorkbenchCanvasCards'
import { WorkbenchDivisionStep } from './WorkbenchDivisionStep'
import { useWorkspaceDraftStatus, WorkspaceDrafts } from './WorkspaceDrafts'
import './workbench-management.css'

const steps: { id: WorkbenchManagementStep; label: string }[] = [
  { id: 'division', label: '场次划分〔本章〕' },
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
  return notices
}

function SceneList({ overview, selected, historyOpen, setHistoryOpen, onSelect }: {
  overview: ChapterWorkbenchManagement; selected?: string; historyOpen: boolean
  setHistoryOpen: (open: boolean) => void; onSelect: (id: string) => void
}) {
  const [query, setQuery] = useState('')
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
  return <div className="management-scene-list">
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
  const [editingMetadata, setEditingMetadata] = useState(false)
  const [historyOpen, setHistoryOpen] = useState<boolean>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [storyboardActions, setStoryboardActions] = useState<HTMLDivElement | null>(null)
  const [objectActions, setObjectActions] = useState<HTMLDivElement | null>(null)
  const sceneToggle = useRef<HTMLButtonElement>(null)
  const search = useRef('')
  search.current = params.toString()
  const savedSelection = useRef<{ id: string; search: string }>()
  const drafts = useWorkspaceDraftStatus()
  const desktop = Grid.useBreakpoint().lg
  const explicitId = params.get('sequence')
  const remembered = readChapterBrowse(projectId, chapterId)
  const scenes = overview ? [...overview.sequences, ...overview.historical_sequences] : []
  const rememberedScene = scenes.find(scene => scene.id === remembered.managementSequence)
  const selected = explicitId !== null ? scenes.find(scene => scene.id === explicitId) : rememberedScene ?? overview?.sequences[0]
  const historical = !!overview?.historical_sequences.some(scene => scene.id === selected?.id)
  const invalidScene = overview && explicitId !== null && !selected
  const step = selected ? managementStep(params.get('step')) ??
    (rememberedScene ? remembered.managementStep : undefined) ?? 'division' : 'division'
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
        const saved = savedSelection.current
        savedSelection.current = undefined
        if (saved && saved.search === search.current) {
          const id = data.sequences.find(row => row.id === saved.id)?.id ?? data.sequences[0]?.id
          const query = new URLSearchParams(saved.search)
          if ((query.get('sequence') ?? undefined) !== id) {
            if (id) query.set('sequence', id)
            else query.delete('sequence')
            query.set('step', 'division')
            navigate({ search: query.toString() }, { replace: true, state: { directingContextSync: true } })
          }
        }
      }
    }).catch(cause => { if (active) setError(directingError(cause)) })
    return () => { active = false }
  }, [projectId, chapterId, revision, navigate])

  useEffect(() => {
    if (!hasActive) return
    const timer = window.setTimeout(() => setRevision(value => value + 1), 4000)
    return () => window.clearTimeout(timer)
  }, [hasActive, overview, error])

  useEffect(() => {
    if (selected) saveChapterBrowse(projectId, chapterId, { managementSequence: selected.id, managementStep: step })
  }, [projectId, chapterId, selected, step])

  const select = (sequenceId: string | undefined, nextStep: WorkbenchManagementStep) => {
    setParams(previous => {
      const next = new URLSearchParams(previous)
      if (next.get('sequence') !== sequenceId || nextStep !== 'objects') next.delete('objectTask')
      if (sequenceId) next.set('sequence', sequenceId)
      else next.delete('sequence')
      next.set('step', nextStep)
      return next
    })
  }
  const closeDrawer = () => {
    setDrawerOpen(false)
    // Closing during the opening animation can skip the drawer's focus callback.
    sceneToggle.current?.focus({ preventScroll: true })
  }
  const list = overview && <SceneList overview={overview} selected={selected?.id} historyOpen={historyOpen ?? historical}
    setHistoryOpen={setHistoryOpen} onSelect={id => {
      if (overview.historical_sequences.some(scene => scene.id === id)) setHistoryOpen(true)
      select(id, step)
      closeDrawer()
    }} />
  const legacy = selected ? [
    { key: 'director', label: <Link to={legacySceneCanvasLocation(projectId, chapterId, selected.id, 'director')}>旧版导演</Link> },
    { key: 'units', label: <Link to={legacySceneCanvasLocation(projectId, chapterId, selected.id, 'units')}>旧版试拍</Link> },
    { key: 'edit', label: <Link to={legacySceneCanvasLocation(projectId, chapterId, selected.id, 'edit')}>旧版审片与剪辑</Link> },
  ] : []
  const action = overview && !invalidScene && step === 'objects' &&
    <div className="management-object-actions" ref={setObjectActions} />

  return <WorkspaceLayout className="management-workspace" aria-label="工作台管理">
    <PageToolbar title="工作台管理">
      {overview && <span className="management-chapter-name">{overview.title}</span>}
      <div className="app-page-actions"><Link to={chapterLocation(projectId, chapterId)}>返回章节</Link></div>
    </PageToolbar>
    {state?.chapterCompositionRetired === true && <Alert type="info" showIcon
      message="章节组合已停用，可在工作台管理中继续准备场次。" />}
    {error && <Alert showIcon type="error" message={error} action={<Button size="small" onClick={() => {
      setError('')
      setRevision(value => value + 1)
    }}>重试</Button>} />}
    {loading && <Spin className="management-loading" aria-label="正在读取工作台管理" />}
    {overview && <div className="management-body">
      {desktop && <aside className="management-sidebar" aria-label="本章场次">
        <h2>本章场次</h2>
        {list}
      </aside>}
      <div className="management-content">
        <header className="management-header">
          {!desktop && <Button ref={sceneToggle} icon={<MenuOutlined />} aria-expanded={drawerOpen}
            onClick={() => setDrawerOpen(true)}>切换场次</Button>}
          <nav className="management-steps" aria-label="工作台步骤">
            {steps.map(({ id, label }) => <Button key={id} aria-current={step === id ? 'step' : undefined}
              type={step === id ? 'default' : 'text'} disabled={id !== 'division' && !selected}
              onClick={() => select(invalidScene ? explicitId ?? undefined : selected?.id, id)}>{label}</Button>)}
          </nav>
          {action}
          {step === 'storyboard' && selected && <div ref={setStoryboardActions} />}
        </header>
        <WorkspaceScrollPanel className="management-panel">
          {invalidScene ? <Alert type="error" showIcon message="此场次不属于当前章节或已不可用" />
            : <>
              {selected && <section key={selected.id} aria-labelledby="management-current-scene">
                <div className="management-scene-heading">
                  <h2 id="management-current-scene">{selected.title}</h2>
                  {historical && <span className="management-scene-meta">历史场次</span>}
                  {!historical && <Button type="text" icon={<EditOutlined />} aria-label="编辑场次名称与顺序"
                    onClick={() => drafts.transition(() => setEditingMetadata(true))} />}
                  <Dropdown menu={{ items: legacy }} trigger={['click']}>
                    <Button type="text" icon={<MoreOutlined />} aria-label="场次更多操作" />
                  </Dropdown>
                </div>
                {historical && <Alert type="info" showIcon message="此场次已退出当前划分，可查看原有准备和画布。" />}
                {selected.source_changed && <Alert type="warning" showIcon message="章节原文已变化，仍使用本场已确认摘录。"
                  action={step !== 'division' && <Button size="small" onClick={() => select(selected.id, 'division')}>前往核对场次范围</Button>} />}
                {selected.preparation_stale && !historical && step !== 'objects' && <Alert type="warning" showIcon
                  message="对象准备依据已过时。请重新提取并采用适用对象，再创建新分镜画布。"
                  action={<Button size="small" onClick={() => select(selected.id, 'objects')}>更新对象与参考</Button>} />}
                {(step !== 'division' || historical || selected.source_changed) && <>
                  <h3>已确认场次原文摘要</h3>
                  <p className="management-excerpt">{selected.source_excerpt || '暂无场次原文'}</p>
                </>}
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
                  canCreate={!historical && !!selected.source_excerpt.trim()} actionHost={storyboardActions}
                  onChange={() => setRevision(value => value + 1)} />}
              </section>}
              {step === 'division' && <WorkbenchDivisionStep {...{ projectId, chapterId }}
                sequenceId={historical ? undefined : selected?.id} refreshKey={divisionRevision}
                onSourceSaved={() => setRevision(value => value + 1)}
                onChanged={id => {
                  if (!drafts.pendingNavigation) savedSelection.current = { id, search: search.current }
                  setRevision(value => value + 1)
                }} />}
            </>}
        </WorkspaceScrollPanel>
      </div>
      {!desktop && <Drawer title="本章场次" placement="left" width="min(320px, 100vw)" open={drawerOpen}
        onClose={closeDrawer}>{list}</Drawer>}
      {editingMetadata && selected && !historical && <SequenceDetails key={selected.id} compact
        {...{ projectId, chapterId }} sequenceId={selected.id} onClose={() => setEditingMetadata(false)}
        onSaved={() => {
          setEditingMetadata(false)
          setDivisionRevision(value => value + 1)
          setRevision(value => value + 1)
        }}
        onRange={() => {
          setEditingMetadata(false)
          select(selected.id, 'division')
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
