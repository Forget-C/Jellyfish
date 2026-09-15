import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Image, Input, Modal, Select, Space, Spin, Tag, Typography } from 'antd'
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { StudioDirectingService } from '../../../services/generated'
import type { DirectingTaskRead, ProductionPlan_Input, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { DesignEditor } from './DesignEditor'
import { productionRecords, uniqueNewRecord } from './workspaceProduction'
import { cutDestination } from './workspaceCut'
import { ReferencePreview } from './ReferencePreview'
import { ReviewDetails } from './ReviewDetails'
import { StyleEditor } from './StyleEditor'
import { SceneAssets } from './SceneAssets'
import { VisualPanel } from './VisualPanel'
import { ContinuityPanel } from './ContinuityPanel'
import { PlanEditor } from './PlanEditor'
import { BatchPanel } from './BatchPanel'
import { RegroupPanel } from './RegroupPanel'
import { LedgerPanel } from './LedgerPanel'
import { FeedbackPanel } from './FeedbackPanel'
import { CutEditor } from './CutEditor'
import { DirectingTasks } from './DirectingTasks'
import { emptyDesign } from './designTemplate'
import { directingError } from './common'
import { buildFileDownloadUrl } from '../assets/utils'
import { useActiveCut } from './useActiveCut'
import { ActiveCutSummary, WorkspaceHistory } from './WorkspaceHistory'
import { revisionName, revisionReferences } from './workspaceUsage'
import { WorkspaceDrafts, useWorkspaceDraft } from './WorkspaceDrafts'
import { WorkspaceStages } from './WorkspaceStages'
import { useWorkspacePreparation } from './useWorkspacePreparation'
import { WorkspaceNextStep } from './WorkspaceNextStep'
import { readSubmittedTasks, rememberSubmittedTask, taskWorkspaceContext } from './workspaceTaskContext'
import { workspaceGuidance, reviewCanExecute } from './workspaceGuidance'
import type { GuidanceInput, WorkspaceGuidance } from './workspaceGuidance'
import { withWorkspaceView, workspaceView, workspaceViews } from './workspaceNavigation'
import { readWorkspaceContext, restoreSelection, saveWorkspaceContext } from './workspaceContext'

type DesignRevision = WorkspaceRead['designs'][number]
type PlanRevision = WorkspaceRead['plans'][number]
const roles: Record<string, string> = { direction: '总导演', performance: '表演指导', staging: '镜内执行', cinematography: '摄影指导', continuity: '场记', prompt: '提示词指导' }

/** 场次设计、试拍和粗剪共享上下文；本地编辑保留起始版本避免覆盖并发修改。 */
export default function SequenceWorkspacePage() {
  const { projectId, sequenceId } = useParams()
  const location = useLocation()
  const navigationType = useNavigationType()
  const query = new URLSearchParams(location.search)
  const identity = JSON.stringify(['design', 'plan', 'unit', 'prompt', 'review', 'cut', 'take', 'task', 'item', 'feedback'].map(key => query.get(key)))
  const context = useRef({ identity, generation: 0 })
  if (identity !== context.current.identity) {
    if (!(navigationType === 'REPLACE' && location.state?.directingContextSync)) context.current.generation += 1
    context.current.identity = identity
  }
  return <WorkspaceDrafts key={`${projectId}:${sequenceId}:${context.current.generation}`}><SequenceWorkspace /></WorkspaceDrafts>
}

function SequenceWorkspace() {
  const { projectId = '', chapterId = '', sequenceId = '' } = useParams()
  const navigate = useNavigate()
  const [search, setSearch] = useSearchParams()
  const view = workspaceView(search.get('view') ?? readWorkspaceContext(projectId, sequenceId).view ?? null)
  const stage = workspaceViews[view].stage
  const changeView = (view: string) => { const next = withWorkspaceView(search, view); next.delete('focus'); setSearch(next) }
  const initialSearch = useRef(search)
  initialSearch.current = search
  const [workspace, setWorkspace] = useState<WorkspaceRead>()
  const activeCut = useActiveCut(projectId, sequenceId, workspace)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [baseDesign, setBaseDesign] = useState<DesignRevision>()
  const [editingSequenceVersion, setEditingSequenceVersion] = useState<number>()
  const [design, setDesign] = useState<SceneDesign_Input>()
  const [basePlan, setBasePlan] = useState<PlanRevision>()
  const [plan, setPlan] = useState<ProductionPlan_Input>()
  const [promptId, setPromptId] = useState<string>()
  const [reviewId, setReviewId] = useState<string>()
  const [unitId, setUnitId] = useState<string>()
  const [cutSelection, setCutSelection] = useState<{ cut: string | null; take: string | null }>()
  const creative = useWorkspacePreparation('创作想法', `${projectId}:${sequenceId}:creative`, { instruction: '' })
  const instruction = creative.value.instruction
  const [tasks, setTasks] = useState<DirectingTaskRead[]>([])
  const [tasksState, setTasksState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pendingTask, setPendingTask] = useState(() => readSubmittedTasks(projectId, sequenceId))
  const [issue, setIssue] = useState<GuidanceInput['issue']>()
  const [focusTarget, setFocusTarget] = useState<string | null>(() => search.get('focus'))
  const focusView = useRef(view)
  const requestedFocus = search.get('focus')
  useEffect(() => { if (requestedFocus) { focusView.current = view; setFocusTarget(requestedFocus) } }, [requestedFocus, view])
  const [result, setResult] = useState<DirectingTaskRead>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const loaded = useRef('')
  const currentSequence = useRef(sequenceId)
  currentSequence.current = sequenceId
  const requestIdentity = useRef<{ prompt: string; review: string; request: string }>()
  /** 只在明确选择或保存时加载编辑基线，轮询不覆盖本地工作单。 */
  const selectDesign = useCallback((revision?: DesignRevision, sequenceVersion?: number) => { setEditingSequenceVersion(sequenceVersion); setBaseDesign(revision); setDesign(revision ? structuredClone(revision.content) : undefined) }, [])
  const selectPlan = useCallback((revision?: PlanRevision) => { setBasePlan(revision); setPlan(revision ? structuredClone(revision.content) : undefined); setUnitId(revision?.content.units[0]?.id); setPromptId(undefined); setReviewId(undefined) }, [])
  /** 状态轮询只更新服务端上下文，编辑版本保持独立。 */
  const reload = useCallback(async () => {
    try {
      const response = await StudioDirectingService.directingWorkspace({ projectId, sequenceId })
      if (!response.data || currentSequence.current !== sequenceId) return
      setWorkspace(response.data)
      if (loaded.current !== sequenceId) {
        loaded.current = sequenceId
        const context = readWorkspaceContext(projectId, sequenceId)
        const query = initialSearch.current
        const taskId = query.get('task')
        const taskContext = taskId ? taskWorkspaceContext(response.data, taskId, readSubmittedTasks(projectId, sequenceId)) : undefined
        const taskPlan = taskContext?.planId
        const taskUnit = taskContext?.unitId
        const taskPrompt = taskContext?.promptId
        const restoredPlan = restoreSelection(response.data.plans, query.get('plan') ?? taskPlan ?? null, taskId && !taskContext ? null : context.plan)
        selectDesign(restoreSelection(response.data.designs, query.get('design') ?? (taskPlan ? restoredPlan?.content.design_revision_id : undefined) ?? null, context.design), response.data.sequence.version)
        selectPlan(restoredPlan)
        const restoredUnit = restoreSelection(restoredPlan?.content.units || [], query.get('unit') ?? taskUnit ?? null, taskId && !taskContext ? null : context.unit)
        setUnitId(restoredUnit?.id)
        const matching = productionRecords(response.data, restoredPlan?.id, restoredUnit?.id)
        const restoredPrompt = restoreSelection(matching.prompts, query.get('prompt') ?? taskPrompt ?? null, taskId && !taskContext ? null : context.prompt ?? null)
        setPromptId(restoredPrompt?.id)
        const matchingReviews = productionRecords(response.data, restoredPlan?.id, restoredUnit?.id, restoredPrompt?.id).reviews
        setReviewId(restoreSelection(matchingReviews, query.get('review'), taskId && !taskContext ? null : context.review ?? null)?.id)
      }
    } catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId, selectDesign, selectPlan])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (loaded.current !== sequenceId || workspace?.sequence.id !== sequenceId) return
    const selection = { design: baseDesign?.id ?? null, plan: basePlan?.id ?? null, unit: unitId ?? null, prompt: promptId ?? null, review: reviewId ?? null, ...cutSelection }
    saveWorkspaceContext(projectId, sequenceId, { ...selection, ...(search.has('view') ? { view: workspaceView(search.get('view')) } : {}) })
    const next = new URLSearchParams(search)
    for (const [key, value] of Object.entries(selection)) next.set(key, value ?? '')
    if (next.toString() !== search.toString()) setSearch(next, { replace: true, state: { directingContextSync: true } })
  }, [projectId, sequenceId, workspace, baseDesign, basePlan, unitId, promptId, reviewId, cutSelection, search, setSearch])
  /** 业务按钮共用错误和运行状态，但不自动授权下一步。 */
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(''); setIssue(undefined)
    try { await action(); return true } catch (cause) {
      const message = directingError(cause)
      setError(message); setIssue({ message, stage, target: stage === 'shoot' ? plan?.units.some(unit => unit.id === unitId) ? `unit:${unitId}` : 'plan-version' : stage === 'design' ? design ? 'design-editor' : 'design-version' : 'cut-editor', planId: basePlan?.id, unitId })
      return false
    } finally { setBusy(false) }
  }
  /** 保存或派生设计，保留用户开始编辑时的版本。 */
  const saveDesign = () => run(async () => {
    if (!design) throw new Error('没有可保存的设计')
    const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: { document: { kind: 'design', content: design }, sequence_version: editingSequenceVersion,
      ...(baseDesign?.confirmed_at ? { parent_id: baseDesign.id } : baseDesign ? { revision_id: baseDesign.id, expected_version: baseDesign.version } : {}) } })
    if (!response.data) throw new Error('保存设计未返回有效版本')
    if (response.data) {
      const saved = baseDesign && !baseDesign.confirmed_at ? response.data.designs.find(row => row.id === baseDesign.id) : response.data.designs.slice(-1)[0]
      if (!saved) throw new Error('未找到已保存的设计版本')
      setWorkspace(response.data)
      selectDesign(saved, response.data.sequence.version)
    }
  })
  /** 生产计划与设计分开确认；参考变化会生成新的计划版本。 */
  const savePlan = () => run(async () => {
    if (!plan) throw new Error('没有可保存的计划')
    const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: { document: { kind: 'plan', content: plan },
      ...(basePlan?.confirmed_at ? { parent_id: basePlan.id } : basePlan ? { revision_id: basePlan.id, expected_version: basePlan.version } : {}) } })
    if (!response.data) throw new Error('保存计划未返回有效版本')
    if (response.data) {
      const saved = basePlan && !basePlan.confirmed_at ? response.data.plans.find(row => row.id === basePlan.id) : response.data.plans.slice(-1)[0]
      if (!saved) throw new Error('未找到已保存的计划版本')
      setWorkspace(response.data); selectPlan(saved)
    }
  })
  const guardDesign = useWorkspaceDraft({ name: '拍摄方案', dirty: !!design && JSON.stringify(design) !== JSON.stringify(baseDesign?.content), save: saveDesign, discard: () => selectDesign(baseDesign, editingSequenceVersion) })
  const guardPlan = useWorkspaceDraft({ name: '生产计划与参考', dirty: !!plan && JSON.stringify(plan) !== JSON.stringify(basePlan?.content), save: savePlan, discard: () => selectPlan(basePlan) })
  const workspaceReady = !!workspace
  useEffect(() => {
    if (!focusTarget || !workspaceReady || view !== focusView.current) return
    const frame = requestAnimationFrame(() => {
      const target = [...document.querySelectorAll<HTMLElement>('[data-workspace-target]')].find(element => element.dataset.workspaceTarget === focusTarget && element.getClientRects().length > 0)
      if (target) { target.scrollIntoView({ block: 'center' }); target.focus({ preventScroll: true }) }
      setFocusTarget(null)
    })
    return () => cancelAnimationFrame(frame)
  }, [focusTarget, view, workspaceReady])
  const generateDesign = () => run(async () => {
    await StudioDirectingService.directingGenerateDesign({ projectId, sequenceId, requestBody: { instruction, style_revision_id: design?.style_revision_id, revision_id: baseDesign?.id, expected_version: baseDesign?.version } }); await reload()
  })
  const followGuidance = (next: WorkspaceGuidance) => {
    if (next.view === 'source') { navigate(`/projects/${projectId}/chapters/${chapterId}/sequences`); return }
    if (next.target === 'generate-design') { void generateDesign(); return }
    if (next.target === 'result') { setResult(tasks.find(task => task.task_id === next.taskId)); return }
    const query = withWorkspaceView(search, next.view)
    if (next.target === 'task-input' && workspace && next.taskId) {
      const context = taskWorkspaceContext(workspace, next.taskId, pendingTask, tasks.find(task => task.task_id === next.taskId))
      if (!context?.planId || !context.unitId) return
      query.set('plan', context.planId); query.set('unit', context.unitId)
      query.delete('design'); query.delete('review')
      if (context.promptId) query.set('prompt', context.promptId); else query.delete('prompt')
      query.set('focus', 'plan-version')
      setSearch(query)
      return
    }
    query.set('focus', next.target)
    if (next.takeId) query.set('take', next.takeId)
    focusView.current = next.view
    setSearch(query); setFocusTarget(next.target)
  }
  if (!workspace || workspace.sequence.id !== sequenceId) return <Space direction="vertical"><Spin />{error && <Alert type="error" message={error} />}</Space>
  const records = productionRecords(workspace, basePlan?.id, unitId, promptId)
  const selectedPrompt = records.prompt
  const frozenPlan = workspace.plans.find(row => row.id === selectedPrompt?.content.plan_revision_id)
  const frozenUnit = frozenPlan?.content.units.find(unit => unit.id === selectedPrompt?.content.unit_id)
  const currentPromptPending = pendingTask.some(item => item.promptId === promptId && workspace.task_ids.includes(item.taskId) && (tasksState !== 'ready' || tasks.some(task => task.task_id === item.taskId && ['queued', 'running'].includes(task.status))))
  const selectedReview = records.reviews.find(row => row.id === reviewId)
  const planDesign = workspace.designs.find(row => row.id === plan?.design_revision_id)
  const designDirty = !!design && JSON.stringify(design) !== JSON.stringify(baseDesign?.content)
  const planDirty = !!plan && JSON.stringify(plan) !== JSON.stringify(basePlan?.content)
  const latestDesign = workspace.designs.find(row => row.id === baseDesign?.id)
  const designStale = !!baseDesign && !!latestDesign && (baseDesign.version !== latestDesign.version || baseDesign.confirmed_at !== latestDesign.confirmed_at)
  const latestPlan = workspace.plans.find(row => row.id === basePlan?.id)
  const planStale = !!basePlan && !!latestPlan && (basePlan.version !== latestPlan.version || basePlan.confirmed_at !== latestPlan.confirmed_at)
  const requestedTask = search.get('task')
  const recoverable = requestedTask ? taskWorkspaceContext(workspace, requestedTask, pendingTask, tasks.find(task => task.task_id === requestedTask)) : undefined
  const guidance: WorkspaceGuidance = requestedTask && stage === 'shoot' && !basePlan ? {
    title: recoverable ? '本任务的固定输入已可恢复' : '先查看任务记录',
    description: recoverable ? '将恢复该任务真实关联的计划、单元与提示词，不替换为较新版本。' : '暂未取得这个任务的固定输入；不会自动选用其他计划。任务记录仍可查看。',
    label: recoverable ? '载入本任务的固定输入' : '查看定位任务', view: 'shoot', target: recoverable ? 'task-input' : 'tasks', taskId: requestedTask,
  } : workspaceGuidance({ workspace, stage, view, design: baseDesign, plan: basePlan, editingPlan: plan, unitId, promptId, reviewId, designStale, planStale, tasks, tasksState, pending: pendingTask, issue })
  return <Space role="region" aria-label="场次工作区" direction="vertical" size="large" style={{ width: '100%', padding: 24 }}>
    <Space wrap><Button onClick={() => navigate(`/projects/${projectId}/chapters/${chapterId}/sequences`)}>返回场次列表</Button><Typography.Title level={3} style={{ margin: 0 }}>{workspace.sequence.title}</Typography.Title><Button onClick={reload}>刷新状态</Button><Button onClick={() => setHistoryOpen(true)}>版本与历史</Button></Space>
    {['design', 'shoot'].includes(view) && ['feedback', 'continuity', 'ledger'].includes(search.get('returnView') || '') && <Button onClick={() => { const next = cutDestination(search, { view: search.get('returnView')! }); next.delete('returnView'); setSearch(next) }}>返回问题与记录</Button>}
    <div><Typography.Title level={4} style={{ margin: 0 }}>把这场戏做成可预览的粗剪</Typography.Title><Typography.Paragraph type="secondary">先确定怎么拍，再生成视频素材，最后选出片段、组成这场戏。</Typography.Paragraph></div>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 340px), 1fr))', gap: 16 }}>
    <WorkspaceNextStep guidance={guidance} busy={busy} running={tasks.filter(task => ['queued', 'running'].includes(task.status)).length} onAction={followGuidance} />
      <Space direction="vertical" style={{ width: '100%' }}>
        <ActiveCutSummary active={activeCut} workspace={workspace} />
    <Card size="small" title="本场原文"><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }} ellipsis={{ rows: 4, expandable: true }}>{workspace.sequence.source_text}</Typography.Paragraph></Card>
      </Space>
    </div>
    <WorkspaceHistory open={historyOpen} onClose={() => setHistoryOpen(false)} workspace={workspace} active={activeCut} />
    {error && (!issue || issue.stage === stage && (stage !== 'shoot' || issue.planId === basePlan?.id && issue.unitId === unitId)) && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    {workspace.sequence.source_changed && <Alert type="warning" message="章节原文已变化。请回场次列表核对范围后再生成新设计。" />}
    <WorkspaceStages view={view} onChange={changeView} items={[
      { key: 'design', label: '导演设计', children: <Space direction="vertical" style={{ width: '100%' }} size="middle">
        <Space wrap data-workspace-target="design-version" tabIndex={-1}><Select aria-label="查看或编辑设计版本" placeholder="选择设计版本" value={baseDesign?.id} style={{ minWidth: 240 }} options={workspace.designs.map((row, index) => ({ value: row.id, label: `设计 ${index + 1} · ${row.confirmed_at ? '已确认' : '草稿'} · 修订 ${row.version}` }))} onChange={id => guardDesign(() => selectDesign(workspace.designs.find(row => row.id === id), workspace.sequence.version))} />
          <Button onClick={() => guardDesign(() => { setBaseDesign(undefined); setEditingSequenceVersion(workspace.sequence.version); setDesign(emptyDesign()) })}>手动起稿</Button></Space>
        {design && <Space direction="vertical">
          <Typography.Text>{designDirty ? '当前编辑：未保存草稿' : '当前查看：'}{baseDesign ? ` · ${revisionName(workspace.designs, baseDesign.id, '设计')} · ${baseDesign.confirmed_at ? '基线已确认，修改将派生新版本' : '草稿'}` : ' · 新设计'}</Typography.Text>
          {baseDesign && <Typography.Text type="secondary">此设计的引用：{revisionReferences(workspace, activeCut, 'design', baseDesign.id).join('；') || '暂无计划或预演引用'}。查看或编辑不改变已有引用。</Typography.Text>}
        </Space>}
        {design && <div data-workspace-target="design-editor" tabIndex={-1}><DesignEditor value={design} onChange={setDesign} /></div>}
        {creative.error && <Alert type="warning" message={creative.error} />}
        <Typography.Text type="secondary">创作想法会自动暂存在本浏览器会话，生成仍需明确点击。</Typography.Text>
        <Input.TextArea placeholder="本场希望观众看到什么？也可填写对现有设计的修改意见。" value={instruction} onChange={event => creative.update({ instruction: event.target.value })} />
        <Button loading={busy} disabled={designDirty || designStale || workspace.sequence.source_changed || !!workspace.task_ids.length && tasksState !== 'ready' || tasks.some(task => task.kind === 'directing_design' && ['queued', 'running'].includes(task.status))} onClick={generateDesign}>生成导演建议</Button>
        {designDirty && <Typography.Text type="warning">请先保存本地修改，再生成建议或确认设计。</Typography.Text>}
        {designStale && <Alert type="warning" message={`当前编辑修订 ${baseDesign!.version}，服务器版本已更新。`} action={<Button onClick={() => guardDesign(() => selectDesign(latestDesign, workspace.sequence.version))}>放弃本地编辑并载入最新设计</Button>} />}
        {baseDesign && !baseDesign.source_current && <Alert type="warning" message="此设计依据的场次范围已变化，请核对内容后保存为当前来源的设计。" />}
        {design && <><details><summary>人物、场所与风格</summary><SceneAssets projectId={projectId} sequenceId={sequenceId} design={design} onChange={setDesign} /><StyleEditor projectId={projectId} sequenceId={sequenceId} value={design.style_revision_id} onChange={id => setDesign({ ...design, style_revision_id: id })} /></details>
          <Space><Button loading={busy} onClick={saveDesign}>{baseDesign?.confirmed_at ? '保存为新设计草稿' : '保存设计草稿'}</Button>
            <Button data-workspace-target="design-confirm" disabled={!baseDesign || !!baseDesign.confirmed_at || designDirty || designStale} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: baseDesign!.id, requestBody: { expected_version: baseDesign!.version } })
              if (response.data) { setWorkspace(response.data); selectDesign(response.data.designs.find(row => row.id === baseDesign!.id), response.data.sequence.version) }
            })}>确认本轮设计</Button>
            {baseDesign?.confirmed_at && <Button onClick={() => guardPlan(() => {
              changeView('shoot'); setBasePlan(undefined); setPlan({ design_revision_id: baseDesign.id, units: [] })
            })}>为此设计准备试拍</Button>}</Space></>}
      </Space> },
      { key: 'shoot', label: '单元试拍', children: <Space direction="vertical" style={{ width: '100%' }} size="large">
        {basePlan && <details><summary>拆分或重组生产计划</summary><RegroupPanel key={basePlan.id} projectId={projectId} sequenceId={sequenceId} plan={basePlan} disabled={!basePlan.confirmed_at || planDirty || planStale} onChange={next => { setWorkspace(next); selectPlan(next.plans.slice(-1)[0]); setPromptId(undefined); setReviewId(undefined) }} /></details>}
        <Space wrap data-workspace-target="plan-version" tabIndex={-1}><Select aria-label="查看或编辑生产计划" placeholder="选择生产计划" value={basePlan?.id} style={{ minWidth: 240 }} options={workspace.plans.map((row, index) => ({ value: row.id, label: `计划 ${index + 1} · ${row.confirmed_at ? '已确认' : '草稿'}` }))} onChange={id => guardPlan(() => selectPlan(workspace.plans.find(row => row.id === id)))} />
          <Select placeholder="从已确认设计创建新计划" style={{ minWidth: 240 }} value={undefined} options={workspace.designs.filter(row => row.confirmed_at).map(row => ({ value: row.id, label: revisionName(workspace.designs, row.id, '设计') }))} onChange={id => guardPlan(() => { setBasePlan(undefined); setPlan({ design_revision_id: id!, units: [] }) })} /></Space>
        {plan && <Space direction="vertical">
          <Typography.Text>{planDirty ? '当前编辑：未保存草稿' : '当前查看：'}{basePlan ? ` · ${revisionName(workspace.plans, basePlan.id, '计划')} · ${basePlan.confirmed_at ? '基线已确认，修改将派生新版本' : '草稿'}` : ' · 新计划'} · 固定设计依据：{revisionName(workspace.designs, plan.design_revision_id, '设计')}</Typography.Text>
          {basePlan && <Typography.Text type="secondary">此计划的引用：{revisionReferences(workspace, activeCut, 'plan', basePlan.id).join('；') || '暂无提示词或素材引用'}。查看或编辑不改变已有引用。</Typography.Text>}
        </Space>}
        {planStale && <Alert type="warning" message={`当前编辑计划修订 ${basePlan!.version}，服务器版本已更新。`} action={<Button onClick={() => guardPlan(() => selectPlan(latestPlan))}>放弃本地编辑并载入最新计划</Button>} />}
        {plan && planDesign ? <><div data-workspace-target="plan-editor" tabIndex={-1}><PlanEditor planId={basePlan?.id} selectedUnitId={unitId} onSelectUnit={id => { setUnitId(id); setPromptId(undefined); setReviewId(undefined) }} projectId={projectId} workspace={workspace} design={planDesign.content} value={plan} onChange={setPlan} issue={issue?.stage === 'shoot' && issue.planId === basePlan?.id ? issue : undefined} /></div>
          <Space><Button loading={busy} disabled={!plan.units.length} onClick={savePlan}>{basePlan?.confirmed_at ? '保存为新计划草稿' : '保存生产计划草稿'}</Button>
            <Button data-workspace-target="plan-confirm" disabled={!basePlan || !!basePlan.confirmed_at || planDirty || planStale} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: basePlan!.id, requestBody: { expected_version: basePlan!.version } })
              if (response.data) { setWorkspace(response.data); selectPlan(response.data.plans.find(row => row.id === basePlan!.id)) }
            })}>确认本次单元与参考</Button></Space>
          {basePlan?.confirmed_at && <Space data-workspace-target="unit-select" tabIndex={-1}><Select aria-label="选择编译单元" style={{ minWidth: 260 }} value={unitId} options={basePlan.content.units.map((unit, index) => ({ value: unit.id, label: `单元 ${index + 1} · ${unit.coverage.map(c => c.action_scope).join('；')}` }))} onChange={id => { setUnitId(id); setPromptId(undefined); setReviewId(undefined) }} />
            <Button data-workspace-target="compile" disabled={!unitId || planDirty || planStale} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingCompile({ projectId, sequenceId, requestBody: { plan_revision_id: basePlan.id, unit_id: unitId! } })
              if (response.data) { setWorkspace(response.data); setPromptId(uniqueNewRecord(workspace.prompts, productionRecords(response.data, basePlan.id, unitId).prompts)?.id); setReviewId(undefined) }
            })}>准备生成指令</Button></Space>}</> : <Alert type="info" message="先确认导演设计，再创建拍摄单元。" />}
        {!!records.takes.length && <Card size="small" title="本单元生成的视频 · 待挑选素材">
          <Space wrap>{records.takes.map((take, index) => <Button key={take.id} onClick={() => { const query = new URLSearchParams(search); query.set('view', 'cut'); query.set('take', take.id); query.set('focus', 'take-review'); setSearch(query) }}>查看视频 {index + 1} · {take.annotation.review_status === 'unreviewed' ? '待审片' : '已有审片记录'}</Button>)}</Space>
          <Typography.Paragraph type="secondary">这里只列所选计划与单元的真实结果；审片结论与剪辑采用分别判断。</Typography.Paragraph>
        </Card>}
        {records.prompts.length > 0 && <Card title="本次生成指令" data-workspace-target="prompt-review" tabIndex={-1}>
          <Space direction="vertical" style={{ width: '100%' }}><Select aria-label="选择生成指令版本" style={{ width: '100%' }} value={selectedPrompt?.id} placeholder="选择本单元的生成指令版本" options={records.prompts.map(row => ({ value: row.id, label: `提示词 ${workspace.prompts.indexOf(row) + 1} · ${row.content.unit_id}` }))} onChange={id => { setPromptId(id); setReviewId(undefined) }} />
            {frozenUnit && <Card size="small" title="本次固定输入">
              <p>模型：{frozenUnit.model_id} · 时长：{frozenUnit.duration_ms / 1000} 秒 · 画幅：{frozenUnit.ratio} · 种子：{String(frozenUnit.parameters?.seed ?? '自动')}</p><details><summary>全部固定参数与版本</summary><p>计划：{frozenPlan?.id} · 单元：{frozenUnit.id} · 指令：{selectedPrompt?.id}</p>{Object.entries(frozenUnit.parameters || {}).map(([key, value]) => <p key={key}>{({ seed: '随机种子', guidance_scale: '提示词引导强度' } as Record<string, string>)[key] || key}：{typeof value === 'object' ? JSON.stringify(value) : String(value)}</p>)}</details>
              {frozenUnit.coverage.map(item => <p key={item.id}>{item.shot_id}：{item.action_scope}</p>)}
              <Space wrap>{!frozenUnit.references.length && <Typography.Text type="secondary">本次未绑定参考素材；能否生成仍以模型校验为准。</Typography.Text>}{[...frozenUnit.references].sort((a, b) => a.ordinal - b.ordinal).map(ref => <Space direction="vertical" key={ref.id}><ReferencePreview reference={ref} /><span>参考 {ref.ordinal + 1} · {({ subject: '主体', first_frame: '首帧', last_frame: '尾帧', key_frame: '关键帧' } as Record<string, string>)[ref.input_role || ''] || '未指定位置'} · {({ identity: '身份', space: '空间', composition: '构图', continuity: '连续性', performance: '表演', sound: '声音' } as Record<string, string>)[ref.purpose]}</span><details><summary>参考来源</summary>{ref.source.kind} · {ref.source.reference} · {ref.source.version}</details><span>{ref.participant_ids.join('、') || '整体画面'}</span></Space>)}</Space>
            </Card>}
            <details><summary>完整生成指令</summary><Input.TextArea readOnly autoSize={{ minRows: 6, maxRows: 18 }} value={selectedPrompt?.content.text} /></details>
            {selectedPrompt && <details><summary>编译来源与去向</summary>{selectedPrompt.content.decisions.map((decision, index) => <p key={index}>{decision.section_path} → {decision.text_excerpt || decision.explanation}</p>)}</details>}
            <Button disabled={!selectedPrompt || currentPromptPending} loading={busy} onClick={() => run(async () => { const response = await StudioDirectingService.directingReview({ projectId, sequenceId, promptId: promptId!, requestBody: {} }); if (response.data) setPendingTask(previous => rememberSubmittedTask(projectId, sequenceId, { taskId: response.data!.task_id, planId: frozenPlan?.id, unitId: frozenUnit?.id, promptId }, previous)); await reload() })}>检查生成指令</Button>
          </Space>
        </Card>}
        {records.reviews.length > 0 && <Card title="审稿与执行确认" data-workspace-target="review" tabIndex={-1}><Space direction="vertical" style={{ width: '100%' }}>
          <Select style={{ width: '100%' }} value={selectedReview?.id} placeholder="选择本次审稿" options={records.reviews.map(row => ({ value: row.id, label: `审稿 ${workspace.reviews.indexOf(row) + 1}${row.parent_id ? ' · 含人工裁决' : ''}` }))} onChange={setReviewId} />
          {selectedReview?.content.rows.map(row => <Card key={row.role + row.occurrence_id} size="small" title={<Space>{roles[row.role]}<Tag color={row.verdict === 'pass' ? 'green' : 'orange'}>{row.verdict === 'pass' ? '通过' : row.verdict === 'pending' ? '待审' : '需修改'}</Tag></Space>}>
            <details open={row.verdict !== 'pass'}><summary>查看检查依据与问题</summary><ReviewDetails row={row} /></details>
            {row.verdict === 'revise' && <Button onClick={() => { let reason = ''; Modal.confirm({ title: '接受此艺术偏离并记录理由', content: <Space direction="vertical" className="w-full"><ReviewDetails row={row} /><Input.TextArea placeholder="说明为什么保留当前方案；结构和模型能力校验仍不可绕过" onChange={event => { reason = event.target.value }} /></Space>, onOk: async () => {
              const response = await StudioDirectingService.directingResolveReview({ projectId, sequenceId, reviewId: selectedReview.id, requestBody: { role: row.role, occurrence_id: row.occurrence_id, reason } })
              if (response.data) { setWorkspace(response.data); setReviewId(uniqueNewRecord(workspace.reviews, productionRecords(response.data, basePlan?.id, unitId, promptId).reviews)?.id) }
            } }) }}>记录人工取舍</Button>}
          </Card>)}
          <Typography.Text type="secondary">执行将使用所选提示词版本固定的模型、范围和参考。新素材仅登记为候选，不自动加入粗剪。</Typography.Text>
          <Button data-workspace-target="shoot-confirm" loading={busy} disabled={!selectedPrompt?.confirmed_at || !reviewCanExecute(selectedReview, promptId) || selectedPrompt.content.plan_revision_id !== basePlan?.id || selectedPrompt.content.unit_id !== unitId || planDirty || planStale || currentPromptPending} onClick={() => run(async () => {
            if (!requestIdentity.current || requestIdentity.current.prompt !== promptId || requestIdentity.current.review !== reviewId) requestIdentity.current = { prompt: promptId!, review: reviewId!, request: crypto.randomUUID() }
            const response = await StudioDirectingService.directingShoot({ projectId, sequenceId, requestBody: { prompt_revision_id: promptId!, review_revision_id: reviewId!, request_id: requestIdentity.current.request } })
            if (response.data) setPendingTask(previous => rememberSubmittedTask(projectId, sequenceId, { taskId: response.data!.task_id, planId: frozenPlan?.id, unitId: frozenUnit?.id, promptId }, previous))
            requestIdentity.current = undefined; await reload()
          })}>确认并开始生成视频</Button>
        </Space></Card>}
      </Space> },
      { key: 'continuity', label: '实际连续性', children: <ContinuityPanel key={sequenceId} projectId={projectId} workspace={workspace} /> },
      { key: 'batch', label: '批量拍摄', children: <BatchPanel key={sequenceId} projectId={projectId} workspace={workspace} onSubmitted={reload} /> },
      { key: 'visual', label: '视觉验证', children: <VisualPanel projectId={projectId} workspace={workspace} onSubmitted={reload} /> },
      { key: 'ledger', label: '三本账', children: <LedgerPanel key={sequenceId} projectId={projectId} sequenceId={sequenceId} /> },
      { key: 'feedback', label: '场次验收与返工', children: <FeedbackPanel key={sequenceId} projectId={projectId} workspace={workspace} onRefresh={reload} /> },
      { key: 'cut', label: '审片与粗剪', children: <CutEditor key={workspace.sequence.id} projectId={projectId} workspace={workspace} activeCut={activeCut} onChange={setWorkspace} onSelection={setCutSelection} /> },
    ]} />
    <DirectingTasks onTake={id => { const query = new URLSearchParams(search); query.set('view', 'cut'); query.set('take', id); query.set('focus', 'take-review'); setSearch(query) }} workspace={workspace} selectedTaskId={search.get('task')} onState={setTasksState} onTasks={setTasks} projectId={projectId} taskIds={workspace.task_ids} onSettled={reload} onResult={setResult} />
    <Modal title={result?.image_file_ids?.length ? '验证图候选' : result?.design ? '导演建议' : '审稿结果'} open={!!result} width={900} onCancel={() => setResult(undefined)} footer={result?.image_file_ids?.length ? null : <Button type="primary" loading={busy} onClick={() => guardDesign(() => { void run(async () => {
      if (!result) return
      const response = result.design
        ? await StudioDirectingService.directingApplyDesign({ projectId, sequenceId, requestBody: { task_id: result.task_id } })
        : await StudioDirectingService.directingApplyReview({ projectId, sequenceId, requestBody: { task_id: result.task_id } })
      if (!response.data) throw new Error('结果未写入有效版本，请重试；现有编辑保持不变。')
      if (response.data) {
        setWorkspace(response.data)
        if (result.design) {
          const changed = response.data.designs.filter(row => !workspace.designs.some(previous => previous.id === row.id && previous.version === row.version))
          if (changed.length !== 1) throw new Error('结果已返回多个变化版本，请在设计版本中明确核对；未自动替换编辑。')
          selectDesign(changed[0], response.data.sequence.version); changeView('design')
        }
        else {
          const applied = uniqueNewRecord(workspace.reviews, response.data.reviews)
          if (!applied) throw new Error('请明确选择已写入的审稿版本；未自动拼接执行输入。')
          const occurrence = applied.content.occurrences[0]
          if (occurrence && applied.content.occurrences.every(row => row.plan_revision_id === occurrence.plan_revision_id && row.unit_id === occurrence.unit_id && row.prompt_revision_id === occurrence.prompt_revision_id)) {
            selectPlan(response.data.plans.find(row => row.id === occurrence.plan_revision_id)); setUnitId(occurrence.unit_id)
            setReviewId(applied.id); setPromptId(occurrence.prompt_revision_id)
          }
          changeView('shoot')
        }
      }
      setResult(undefined)
    }) })}>{result?.design ? '写入可编辑草稿' : '保存审稿结论'}</Button>}>
      {!!result?.image_file_ids?.length && <><Typography.Paragraph>候选图已保存到本项目素材。请在生产计划中明确选择，才会加入本次参考；不会自动替换已确认素材。</Typography.Paragraph>{result.image_file_ids.map(id => <Image key={id} src={buildFileDownloadUrl(id)} alt="验证图候选" />)}</>}
      {result?.design && <DesignEditor value={result.design} onChange={() => {}} disabled />}
      {result?.review?.rows.map(row => <Card key={row.role + row.occurrence_id} size="small" title={`${roles[row.role]} · ${row.verdict === 'pass' ? '通过' : row.verdict === 'pending' ? '待审' : '需修改'}`}><ReviewDetails row={row} /></Card>)}
    </Modal>
  </Space>
}
