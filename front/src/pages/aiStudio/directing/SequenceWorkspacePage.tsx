import { usePageTitle } from '../../../layouts/pageTitle'
import { flushSync } from 'react-dom'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Drawer, Dropdown, Empty, Image, Input, Modal, Space, Spin, Tag, Typography } from 'antd'
import { useLocation, useNavigate, useNavigationType, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, StudioDirectingService } from '../../../services/generated'
import type { AssetSummary, DirectingTaskRead, ProductionPlan_Input, SceneDesign_Input, WorkspaceRead } from '../../../services/generated'
import { SequenceLayout, SequenceNavigation } from './SequenceLayout'
import { SourceProvider } from './Sources'
import type { SourceRead } from '../../../services/generated'
import { DesignEditor } from './DesignEditor'
import { cutDestination } from './workspaceCut'
import { productionRecords, shotProductionTargets, uniqueNewRecord } from './workspaceProduction'
import { WorkbenchToolbar } from './WorkbenchChrome'
import { SequenceSwitcher } from './SequenceSwitcher'
import { ShootFixedInput } from './ShootFixedInput'
import { ShootCandidates } from './ShootCandidates'
import { ShootInstructions } from './ShootInstructions'
import { ShootReview } from './ShootReview'
import { PromptReader } from './PromptReader'
import { ReviewDetails } from './ReviewDetails'
import { contextForPrompt } from './readableText'
import { ReviewRevisionPanel } from './ReviewRevisionPanel'
import { reviewDirectionScope } from './reviewRevision'
import { StyleEditor } from './StyleEditor'
import { SceneAssets } from './SceneAssets'
import { VisualPanel } from './VisualPanel'
import { ContinuityPanel } from './ContinuityPanel'
import { ProductionWorkbench } from './ProductionWorkbench'
import { ShootPreparation } from './ShootPreparation'
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
import { ActiveCutSummary, CutItems } from './WorkspaceHistory'
import { WorkspaceVersionDialog } from './WorkspaceVersionDialog'
import { workspaceVersionEditErrors, type WorkspaceVersionKind, type WorkspaceVersionsSelection } from './workspaceVersions'
import { revisionName, revisionReferences } from './workspaceUsage'
import { WorkspaceDrafts, useWorkspaceDraft, useWorkspaceDraftStatus, WorkspaceWriteBoundary } from './WorkspaceDrafts'
import { WorkspaceStages } from './WorkspaceStages'
import { useWorkspacePreparation } from './useWorkspacePreparation'
import { WorkspaceNextStep } from './WorkspaceNextStep'
import { readSubmittedTasks, rememberSubmittedTask, taskWorkspaceContext, readShootRequests, saveShootRequest, readCompileRequests, saveCompileRequest, readReviewRequests, saveReviewRequest } from './workspaceTaskContext'
import { workspaceGuidance, shootProgressLabel, reviewCanExecute, reviewPacketPassed, pendingReviewResults } from './workspaceGuidance'
import type { GuidanceInput, WorkspaceGuidance } from './workspaceGuidance'
import { withWorkspaceView, workspaceView, workspaceViews } from './workspaceNavigation'
import { readUnitSelection, saveUnitSelection, readWorkspaceContext, restoreSelection, saveWorkspaceContext } from './workspaceContext'
import './workspace.css'

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
  const location = useLocation()
  const [search, setSearch] = useSearchParams()
  const draftStatus = useWorkspaceDraftStatus()
  const pendingNavigation = useRef(draftStatus.pendingNavigation)
  pendingNavigation.current = draftStatus.pendingNavigation
  const view = workspaceView(search.get('view') ?? readWorkspaceContext(projectId, sequenceId).view ?? null)
  const stage = workspaceViews[view].stage
  const changeView = (view: string, target?: string) => {
    const next = withWorkspaceView(initialSearch.current, view)
    if (target) next.set('focus', target); else next.delete('focus')
    setSearch(next); setFocusTarget(target || null)
  }
  const initialSearch = useRef(search)
  initialSearch.current = search
  const [workspace, setWorkspace] = useState<WorkspaceRead>()
  const [sceneAssets, setSceneAssets] = useState<AssetSummary[]>()
  const [sceneAssetsError, setSceneAssetsError] = useState('')
  const [assetReload, setAssetReload] = useState(0)
  const reloadSceneAssets = useCallback(() => setAssetReload(value => value + 1), [])
  useEffect(() => {
    let current = true
    setSceneAssets(undefined); setSceneAssetsError('')
    void StudioDirectingService.directingAssets({ projectId }).then(response => { if (current) setSceneAssets(response.data || []) }).catch(cause => { if (current) setSceneAssetsError(directingError(cause)) })
    return () => { current = false }
  }, [projectId, assetReload])
  usePageTitle(workspace?.sequence.id === sequenceId ? workspace?.sequence.title : undefined)
  const activeCut = useActiveCut(projectId, sequenceId, workspace)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyKind, setHistoryKind] = useState<WorkspaceVersionKind>('design')
  const openHistory = (kind: WorkspaceVersionKind = stage === 'shoot' ? 'plan' : stage) => { setHistoryKind(kind); setHistoryOpen(true) }
  const [shotProduction, setShotProduction] = useState<{ designId: string; shotId: string }>()
  const [contextPanel, setContextPanel] = useState<'source' | 'ai' | 'tasks' | 'help'>()
  useEffect(() => { const open = () => setContextPanel('tasks'); window.addEventListener('sequence-open-task-results', open); return () => window.removeEventListener('sequence-open-task-results', open) }, [])
  const [baseDesign, setBaseDesign] = useState<DesignRevision>()
  const [editingSequenceVersion, setEditingSequenceVersion] = useState<number>()
  const [design, setDesign] = useState<SceneDesign_Input>()
  const [basePlan, setBasePlan] = useState<PlanRevision>()
  const [plan, setPlan] = useState<ProductionPlan_Input>()
  const [preparationDesignId, setPreparationDesignId] = useState<string>()
  const [unavailablePlanId, setUnavailablePlanId] = useState<string>()
  const [unavailableDesignId, setUnavailableDesignId] = useState<string>()
  const [promptId, setPromptId] = useState<string>()
  const [reviewId, setReviewId] = useState<string>()
  const [reviewTaskId, setReviewTaskId] = useState<string>()
  const [unitId, setUnitId] = useState<string>()
  const operationContext = JSON.stringify([projectId, sequenceId, baseDesign?.id, basePlan?.id, unitId, promptId, reviewId, reviewTaskId, view, search.get('focus')])
  const currentOperationContext = useRef(operationContext)
  currentOperationContext.current = operationContext
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const [cutSwitch, setCutSwitch] = useState<{ id: string | null; serial: number }>()
  const [cutSelection, setCutSelection] = useState<{ cut: string | null; take: string | null } | undefined>(() => search.has('cut') ? { cut: search.get('cut') || null, take: search.get('take') || null } : undefined)
  const versionContext = useRef({ workspace, baseDesign, basePlan, unavailableDesignId, unavailablePlanId, cutSelection, search })
  versionContext.current = { workspace, baseDesign, basePlan, unavailableDesignId, unavailablePlanId, cutSelection, search }
  const creative = useWorkspacePreparation('创作想法', `${projectId}:${sequenceId}:creative`, { instruction: '' })
  const instruction = creative.value.instruction
  const [tasks, setTasks] = useState<DirectingTaskRead[]>([])
  const [tasksRetry, setTasksRetry] = useState(0)
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
  const [reviewSubmission, setReviewSubmission] = useState(() => {
    try { return { requests: readReviewRequests(projectId, sequenceId), error: '' } }
    catch { return { requests: [] as ReturnType<typeof readReviewRequests>, error: '无法读取检查提交记录，请先核对任务记录；恢复浏览器存储后刷新重试。' } }
  })
  const [compileSubmission, setCompileSubmission] = useState(() => {
    try { return { requests: readCompileRequests(projectId, sequenceId), error: '' } }
    catch { return { requests: [] as ReturnType<typeof readCompileRequests>, error: '无法读取指令生成记录，请先核对已有版本；恢复浏览器存储后刷新重试。' } }
  })
  const [shootSubmission, setShootSubmission] = useState(() => {
    try { return { requests: readShootRequests(projectId, sequenceId), error: '' } }
    catch { return { requests: [] as ReturnType<typeof readShootRequests>, error: '无法读取试拍提交记录，请先核对任务记录；恢复浏览器存储后刷新重试。' } }
  })
  /** 只在明确选择或保存时加载编辑基线，轮询不覆盖本地工作单。 */
  const selectDesign = useCallback((revision?: DesignRevision, sequenceVersion?: number) => { setUnavailableDesignId(undefined); setEditingSequenceVersion(sequenceVersion); setBaseDesign(revision); setDesign(revision ? structuredClone(revision.content) : undefined) }, [])
  const selectPlan = useCallback((revision?: PlanRevision) => { setUnavailablePlanId(undefined); setBasePlan(revision); setPlan(revision ? structuredClone(revision.content) : undefined); setUnitId(revision?.content.units[0]?.id); setPromptId(undefined); setReviewId(undefined); setReviewTaskId(undefined) }, [])
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
        const requestedDesign = query.get('design') ?? (taskPlan ? restoredPlan?.content.design_revision_id : undefined) ?? context.design
        const restoredDesign = restoreSelection(response.data.designs, requestedDesign ?? null, context.design)
        selectDesign(restoredDesign, response.data.sequence.version)
        if (requestedDesign && !restoredDesign) setUnavailableDesignId(requestedDesign)
        setPreparationDesignId(query.get('prepareDesign') || (!restoredDesign && requestedDesign ? requestedDesign : undefined))
        selectPlan(restoredPlan)
        const requestedPlan = query.get('plan') ?? taskPlan ?? (taskId && !taskContext ? null : context.plan)
        if (requestedPlan && !restoredPlan) setUnavailablePlanId(requestedPlan)
        const restoredUnit = restoreSelection(restoredPlan?.content.units || [], query.get('unit') ?? taskUnit ?? null, taskId && !taskContext ? null : context.unit)
        setUnitId(restoredUnit?.id)
        const matching = productionRecords(response.data, restoredPlan?.id, restoredUnit?.id)
        const restoredPrompt = restoreSelection(matching.prompts, query.get('prompt') ?? taskPrompt ?? null, taskId && !taskContext ? null : context.prompt ?? null)
        setPromptId(restoredPrompt?.id)
        const matchingReviews = productionRecords(response.data, restoredPlan?.id, restoredUnit?.id, restoredPrompt?.id).reviews
        setReviewId(restoreSelection(matchingReviews, query.get('review'), taskId && !taskContext ? null : context.review ?? null)?.id)
        setReviewTaskId(taskId || (restoredPlan && restoredUnit ? readUnitSelection(projectId, sequenceId, restoredPlan.id, restoredUnit.id).reviewTask : undefined))
      }
      return response.data
    } catch (cause) { setError(directingError(cause)) }
  }, [projectId, sequenceId, selectDesign, selectPlan])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (loaded.current !== sequenceId || workspace?.sequence.id !== sequenceId) return
    if (basePlan && unitId) saveUnitSelection(projectId, sequenceId, basePlan.id, unitId, { prompt: promptId, review: reviewId, reviewTask: reviewTaskId })
    const selection = { design: baseDesign?.id ?? unavailableDesignId ?? null, plan: basePlan?.id ?? unavailablePlanId ?? null, prepareDesign: preparationDesignId ?? null, unit: unitId ?? null, prompt: promptId ?? null, review: reviewId ?? null, ...cutSelection }
    saveWorkspaceContext(projectId, sequenceId, { ...selection, ...(search.has('view') ? { view: workspaceView(search.get('view')) } : {}) })
    const next = new URLSearchParams(search)
    for (const [key, value] of Object.entries(selection)) next.set(key, value ?? '')
    if (next.toString() !== search.toString()) setSearch(next, { replace: true, state: { directingContextSync: true } })
  }, [projectId, sequenceId, workspace, baseDesign, basePlan, preparationDesignId, unavailableDesignId, unavailablePlanId, unitId, promptId, reviewId, reviewTaskId, cutSelection, search, setSearch])
  /** 业务按钮共用错误和运行状态，但不自动授权下一步。 */
  const run = async (action: () => Promise<void>, retryInPlace = false) => {
    setBusy(true); setError(''); setIssue(undefined)
    try { await action(); return true } catch (cause) {
      const message = directingError(cause)
      setError(message); setIssue(retryInPlace ? undefined : { message, stage, target: stage === 'shoot' ? plan?.units.some(unit => unit.id === unitId) ? `unit:${unitId}` : 'plan-version' : stage === 'design' ? design ? 'design-editor' : 'design-version' : 'cut-editor', planId: basePlan?.id, unitId })
      return false
    } finally {
      // 先提交编辑基线和请求结束状态，再允许结果写入后的路由跳转。
      flushSync(() => setBusy(false))
    }
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
      const savedWorkspace = response.data
      flushSync(() => {
        setWorkspace(savedWorkspace)
        selectDesign(saved, savedWorkspace.sequence.version)
      })
    }
  })
  /** 生产计划与设计分开确认；参考变化会生成新的计划版本。 */
  const writePlan = async () => {
    if (!plan) throw new Error('没有可保存的计划')
    const response = await StudioDirectingService.directingSaveRevision({ projectId, sequenceId, requestBody: { document: { kind: 'plan', content: plan },
      ...(basePlan?.confirmed_at ? { parent_id: basePlan.id } : basePlan ? { revision_id: basePlan.id, expected_version: basePlan.version } : {}) } })
    if (!response.data) throw new Error('保存计划未返回有效版本')
    if (response.data) {
      const candidates = response.data.plans.filter(row => !workspace?.plans.some(previous => previous.id === row.id))
      const saved = basePlan && !basePlan.confirmed_at ? response.data.plans.find(row => row.id === basePlan.id) : candidates.length === 1 ? candidates[0] : undefined
      if (!saved) throw new Error('未找到已保存的计划版本')
      const savedWorkspace = response.data
      flushSync(() => {
        setWorkspace(savedWorkspace); selectPlan(saved)
        if (saved.content.units.some(unit => unit.id === unitId)) setUnitId(unitId)
      })
      return saved
    }
    throw new Error('未找到已保存的计划版本')
  }
  const savePlan = () => run(async () => { await writePlan() })
  const confirmPlan = () => run(async () => {
    const changed = JSON.stringify(plan) !== JSON.stringify(basePlan?.content)
    const saved = !basePlan || changed ? await writePlan() : basePlan
    try {
      const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: saved.id, requestBody: { expected_version: saved.version } })
      if (!response.data) throw new Error('确认未返回有效版本')
      setWorkspace(response.data); selectPlan(response.data.plans.find(row => row.id === saved.id))
      if (saved.content.units.some(unit => unit.id === unitId)) setUnitId(unitId)
    } catch (cause) { throw new Error(`计划草稿已保存，确认尚未完成：${directingError(cause)}`) }
  }, true)
  const guardDesign = useWorkspaceDraft({ busy, name: '拍摄方案', dirty: !!design && JSON.stringify(design) !== JSON.stringify(baseDesign?.content), save: saveDesign, discard: () => selectDesign(baseDesign, editingSequenceVersion) })
  const guardPlan = useWorkspaceDraft({ busy, preserveOnStageChange: true, name: '生产计划与参考', dirty: !!plan && JSON.stringify(plan) !== JSON.stringify(basePlan?.content), save: savePlan, discard: () => selectPlan(basePlan) })
  const workspaceReady = !!workspace
  useEffect(() => {
    if (!focusTarget || !workspaceReady || view !== focusView.current) return
    const timer = window.setTimeout(() => {
      const target = [...document.querySelectorAll<HTMLElement>('[data-workspace-target]')].find(element => element.dataset.workspaceTarget === focusTarget && element.getClientRects().length > 0)
      if (target) { target.scrollIntoView({ block: 'center' }); target.focus({ preventScroll: true }) }
      setFocusTarget(null)
    }, 400)
    return () => window.clearTimeout(timer)
  }, [focusTarget, view, workspaceReady, location.key])
  const generateDesign = () => run(async () => {
    await StudioDirectingService.directingGenerateDesign({ projectId, sequenceId, requestBody: { instruction, style_revision_id: design?.style_revision_id, revision_id: baseDesign?.id, expected_version: baseDesign?.version } }); await reload()
  })
  const followGuidance = (next: WorkspaceGuidance) => {
    if (next.view === 'source') { navigate(`/projects/${projectId}/chapters/${chapterId}/sequences`); return }
    if (next.target === 'generate-design') { void generateDesign(); return }
    if (next.target === 'tasks') {
      const task = tasks.find(row => row.task_id === next.taskId)
      if (stage === 'shoot' && task && ['directing_review', 'video_generation'].includes(task.kind)) changeView('shoot', task.kind === 'directing_review' ? 'review' : 'shoot-confirm')
      else setContextPanel('tasks')
      return
    }
    if (next.target === 'result') {
      setContextPanel(undefined)
      const task = tasks.find(row => row.task_id === next.taskId)
      if (task?.review?.occurrences.length && task.review.occurrences.every(row => row.plan_revision_id === basePlan?.id && row.unit_id === unitId && row.prompt_revision_id === promptId)) changeView('shoot', 'review')
      else setResult(task)
      return
    }
    setContextPanel(undefined)
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
  const currentPromptPending = pendingTask.some(item => item.planId === basePlan?.id && item.unitId === unitId && (!item.promptId || item.promptId === promptId) && (tasksState !== 'ready' || !tasks.some(task => task.task_id === item.taskId && !['queued', 'running'].includes(task.status))))
  const selectedReview = records.reviews.find(row => row.id === reviewId)
  const pendingReviews = pendingReviewResults(workspace, tasks, basePlan?.id, unitId, promptId)
  const pendingReviewTask = pendingReviews.find(task => task.task_id === reviewTaskId) || (!reviewId && pendingReviews.length === 1 ? pendingReviews[0] : undefined)
  const planDesign = workspace.designs.find(row => row.id === plan?.design_revision_id)
  const designDirty = !!design && JSON.stringify(design) !== JSON.stringify(baseDesign?.content)
  const planDirty = !!plan && JSON.stringify(plan) !== JSON.stringify(basePlan?.content)
  const latestDesign = workspace.designs.find(row => row.id === baseDesign?.id)
  const designStale = !!baseDesign && !!latestDesign && (baseDesign.version !== latestDesign.version || baseDesign.confirmed_at !== latestDesign.confirmed_at)
  const latestPlan = workspace.plans.find(row => row.id === basePlan?.id)
  const planStale = !!basePlan && !!latestPlan && (basePlan.version !== latestPlan.version || basePlan.confirmed_at !== latestPlan.confirmed_at)
  const requestedTask = search.get('task')
  const recoverable = requestedTask ? taskWorkspaceContext(workspace, requestedTask, pendingTask, tasks.find(task => task.task_id === requestedTask)) : undefined
  const pendingCheck = reviewSubmission.requests.find(item => item.prompt === promptId)
  const pendingCompile = compileSubmission.requests.find(item => item.plan === basePlan?.id && item.unit === unitId)
  const pendingShoot = shootSubmission.requests.find(item => item.prompt === promptId && item.review === reviewId)
  const baseGuidance: WorkspaceGuidance = requestedTask && stage === 'shoot' && !basePlan ? {
    title: recoverable ? '本任务的固定输入已可恢复' : '先查看任务记录',
    description: recoverable ? '将恢复该任务真实关联的计划、单元与提示词，不替换为较新版本。' : '暂未取得这个任务的固定输入；不会自动选用其他计划。任务记录仍可查看。',
    label: recoverable ? '载入本任务的固定输入' : '查看定位任务', view: 'shoot', target: recoverable ? 'task-input' : 'tasks', taskId: requestedTask,
  } : workspaceGuidance({ workspace, stage, view, design: baseDesign, plan: basePlan, editingPlan: plan, unitId, promptId, reviewId, reviewTaskId, designStale, planStale, tasks, tasksState, pending: pendingTask, issue })
  const guidance: WorkspaceGuidance = stage === 'shoot' && pendingCompile && !planDirty && !planStale && !workspace.sequence.source_changed ? {
    title: '本次指令生成结果待核实', description: '沿用原请求读取本次指令，不重复生成新版本。', label: '核实本次指令生成', view: 'shoot', target: 'compile', submissionUnknown: true,
  } : stage === 'shoot' && pendingCheck && selectedPrompt && !planDirty && !planStale && !workspace.sequence.source_changed ? {
    title: '本次检查提交结果待核实', description: '沿用原请求恢复检查任务，不发起另一轮检查。', label: '核实本次检查', view: 'shoot', target: 'prompt-review', submissionUnknown: true,
  } : stage === 'shoot' && pendingShoot && ['shoot-confirm', 'take-review', 'tasks'].includes(baseGuidance.target) ? {
    title: '本次试拍提交结果待核实', description: '将沿用同一次提交核实任务，不会创建另一条试拍。', label: '核实本次提交', view: 'shoot', target: 'shoot-confirm', submissionUnknown: true,
  } : baseGuidance
  const unitProgress = Object.fromEntries((plan?.units || []).map(unit => {
    const remembered = basePlan ? readUnitSelection(projectId, sequenceId, basePlan.id, unit.id) : {}
    const matching = productionRecords(workspace, basePlan?.id, unit.id, remembered.prompt)
    const context = unit.id === unitId ? { promptId, reviewId, reviewTaskId } : { promptId: matching.prompt?.id, reviewId: matching.reviews.find(row => row.id === remembered.review)?.id, reviewTaskId: remembered.reviewTask }
    const next = unit.id === unitId ? guidance : workspaceGuidance({ workspace, stage: 'shoot', plan: basePlan, editingPlan: plan, unitId: unit.id, ...context, designStale, planStale, tasks, tasksState, pending: pendingTask })
    const unverifiedCheck = reviewSubmission.requests.some(item => item.prompt === context.promptId)
    const unverifiedCompile = compileSubmission.requests.some(item => item.plan === basePlan?.id && item.unit === unit.id)
    const unverified = shootSubmission.requests.some(item => item.prompt === context.promptId && item.review === context.reviewId)
    return [unit.id, unverifiedCheck || unverifiedCompile || unverified ? '提交待核实' : shootProgressLabel(next, { tasks, ...context })]
  }))
  /** 准备入口复用当前草稿；其他依据需先处理本地修改，不按最新版本猜测。 */
  const prepareShoot = (designId: string) => {
    if (plan?.design_revision_id === designId) { changeView('shoot'); return }
    guardPlan(() => {
      const matching = workspace.plans.filter(row => row.content.design_revision_id === designId)
      selectPlan(matching.length === 1 ? matching[0] : undefined)
      setPreparationDesignId(designId); changeView('shoot')
    })
  }
  const selectUnit = (id: string) => draftStatus.transition(() => {
    if (id === unitId || !basePlan?.content.units.some(row => row.id === id)) return
    const remembered = readUnitSelection(projectId, sequenceId, basePlan.id, id)
    const matching = productionRecords(workspace, basePlan.id, id, remembered.prompt)
    setUnitId(id); setPromptId(matching.prompt?.id)
    setReviewId(matching.reviews.find(row => row.id === remembered.review)?.id)
    setReviewTaskId(remembered.reviewTask)
  })
  /** 写入本次明确查看的结果；按结论定位，保存不隐式开拍。 */
  const applyTaskResult = (task: DirectingTaskRead) => { const operationLocation = window.location.href; let reviewTarget = 'review'; let advance = false; guardDesign(() => { void run(async () => {
      if (!task) return
      let response
      if (task.design) response = await StudioDirectingService.directingApplyDesign({ projectId, sequenceId, requestBody: { task_id: task.task_id } })
      else {
        try {
          response = await StudioDirectingService.directingApplyReview({ projectId, sequenceId, requestBody: { task_id: task.task_id } })
          if (!response.data?.reviews.some(row => row.source_task_id === task.task_id)) throw new Error('保存响应中尚未找到本次检查')
        } catch (cause) {
          // 只读核实原任务；结果不明时保留报告，让用户重试同一幂等保存。
          const recovered = await StudioDirectingService.directingWorkspace({ projectId, sequenceId }).catch(() => undefined)
          if (!recovered?.data?.reviews.some(row => row.source_task_id === task.task_id)) throw new Error(`检查结论尚未核实，可重试保存同一结果。${directingError(cause)}`)
          response = recovered
        }
      }
      if (!response.data) throw new Error('结果未写入有效版本，请重试；现有编辑保持不变。')
      if (!mounted.current || currentSequence.current !== sequenceId) return
      if (response.data) {
        setWorkspace(response.data)
        if (pendingNavigation.current || currentOperationContext.current !== operationContext || window.location.href !== operationLocation) return
        if (task.design) {
          const changed = response.data.designs.filter(row => !workspace.designs.some(previous => previous.id === row.id && previous.version === row.version))
          if (changed.length !== 1) throw new Error('结果已返回多个变化版本，请在设计版本中明确核对；未自动替换编辑。')
          selectDesign(changed[0], response.data.sequence.version)
        }
        else {
          const applied = response.data.reviews.find(row => row.source_task_id === task.task_id)
          if (!applied) throw new Error('请明确选择已写入的审稿版本；未自动拼接执行输入。')
          const occurrence = applied.content.occurrences[0]
          if (occurrence && applied.content.occurrences.every(row => row.plan_revision_id === occurrence.plan_revision_id && row.unit_id === occurrence.unit_id && row.prompt_revision_id === occurrence.prompt_revision_id)) {
            selectPlan(response.data.plans.find(row => row.id === occurrence.plan_revision_id)); setUnitId(occurrence.unit_id)
            setReviewId(applied.id); setPromptId(occurrence.prompt_revision_id)
            reviewTarget = reviewCanExecute(applied, occurrence.prompt_revision_id) ? 'shoot-confirm' : 'review'
          }
        }
      }
      setResult(undefined)
      advance = true
    }, !task.design).then(ok => { if (ok && advance && mounted.current) changeView(task?.design ? 'design' : 'shoot', task?.design ? undefined : reviewTarget) }) }) }
  const compileInstruction = () => {
    const operationLocation = window.location.href
    let advance = false
    return run(async () => {
      if (!basePlan || !unitId) throw new Error('请先选择已确认计划和单元')
      const identity = readCompileRequests(projectId, sequenceId).find(item => item.plan === basePlan.id && item.unit === unitId) || { plan: basePlan.id, unit: unitId, request: crypto.randomUUID() }
      setCompileSubmission({ requests: saveCompileRequest(projectId, sequenceId, identity), error: '' })
      const response = await StudioDirectingService.directingCompile({ projectId, sequenceId, requestBody: { plan_revision_id: basePlan.id, unit_id: unitId, request_id: identity.request } }).catch(cause => {
        if (cause instanceof ApiError && [400, 409, 422].includes(cause.status)) setCompileSubmission({ requests: saveCompileRequest(projectId, sequenceId, identity, true), error: '' })
        throw cause
      })
      const compiled = response.data?.prompts.find(row => row.id === response.data?.compiled_prompt_revision_id && row.content.plan_revision_id === basePlan.id && row.content.unit_id === unitId)
      if (!compiled) throw new Error('指令结果尚未核实，请使用“核实本次指令生成”恢复同一次生成。')
      setCompileSubmission({ requests: saveCompileRequest(projectId, sequenceId, identity, true), error: '' })
      if (!mounted.current || currentSequence.current !== sequenceId) return
      setWorkspace(response.data!)
      if (pendingNavigation.current || currentOperationContext.current !== operationContext || window.location.href !== operationLocation) return
      setPromptId(compiled.id); setReviewId(undefined); setReviewTaskId(undefined); advance = true
    }).then(ok => { if (ok && advance) changeView('shoot', 'prompt-review') })
  }
  const shootUnit = () => run(async () => {
    if (!promptId || !reviewId) throw new Error('请先选择指令和已确认的检查结论')
    const identity = readShootRequests(projectId, sequenceId).find(item => item.prompt === promptId && item.review === reviewId) || { prompt: promptId, review: reviewId, request: crypto.randomUUID() }
    setShootSubmission({ requests: saveShootRequest(projectId, sequenceId, identity), error: '' })
    const response = await StudioDirectingService.directingShoot({ projectId, sequenceId, requestBody: { prompt_revision_id: promptId, review_revision_id: reviewId, request_id: identity.request } })
    if (!response.data?.task_id) throw new Error('试拍提交结果尚未核实，请使用“核实本次提交”恢复同一次任务。')
    const submitted = rememberSubmittedTask(projectId, sequenceId, { taskId: response.data.task_id, planId: frozenPlan?.id, unitId: frozenUnit?.id, promptId })
    setPendingTask(submitted)
    // 先持久化受理身份，再移除未核实请求；存储失败时仍可按原身份恢复。
    if (readSubmittedTasks(projectId, sequenceId).some(item => item.taskId === response.data!.task_id)) setShootSubmission({ requests: saveShootRequest(projectId, sequenceId, identity, true), error: '' })
    await reload()
  }, true)
  const checkInstruction = () => {
    const operationLocation = window.location.href
    let advance = false
    return run(async () => {
      if (!promptId) throw new Error('请先选择要检查的指令')
      const identity = readReviewRequests(projectId, sequenceId).find(item => item.prompt === promptId) || { prompt: promptId, request: crypto.randomUUID() }
      setReviewSubmission({ requests: saveReviewRequest(projectId, sequenceId, identity), error: '' })
      const response = await StudioDirectingService.directingReview({ projectId, sequenceId, promptId, requestBody: { request_id: identity.request } }).catch(cause => {
        if (cause instanceof ApiError && [400, 409, 422].includes(cause.status)) setReviewSubmission({ requests: saveReviewRequest(projectId, sequenceId, identity, true), error: '' })
        throw cause
      })
      if (!response.data?.task_id) throw new Error('检查提交结果尚未核实，请使用“核实本次检查”恢复同一任务。')
      setPendingTask(rememberSubmittedTask(projectId, sequenceId, { taskId: response.data.task_id, planId: frozenPlan?.id, unitId: frozenUnit?.id, promptId }))
      if (readSubmittedTasks(projectId, sequenceId).some(item => item.taskId === response.data!.task_id)) setReviewSubmission({ requests: saveReviewRequest(projectId, sequenceId, identity, true), error: '' })
      await reload()
      if (!mounted.current || pendingNavigation.current || currentOperationContext.current !== operationContext || window.location.href !== operationLocation) return
      setReviewTaskId(response.data.task_id); advance = true
    }).then(ok => { if (ok && advance && mounted.current) changeView('shoot', 'review') })
  }
  const applyVersions = (next: WorkspaceVersionsSelection, kind: WorkspaceVersionKind) => draftStatus.transition(() => {
    // 保存可能派生新版本；完成草稿保护后再读取基线，应用弹窗中明确选择的对象。
    const { workspace, baseDesign, basePlan, unavailableDesignId, unavailablePlanId, cutSelection, search } = versionContext.current
    if (!workspace) return
    const errors = workspaceVersionEditErrors(workspace, next, kind)
    if (errors.length) { setError(errors.join('；')); return }
    if (kind === 'design' || next.design !== (baseDesign?.id || unavailableDesignId || null)) selectDesign(workspace.designs.find(row => row.id === next.design), workspace.sequence.version)
    if (kind === 'plan' || next.plan !== (basePlan?.id || unavailablePlanId || null)) {
      const selected = workspace.plans.find(row => row.id === next.plan)
      selectPlan(selected); setPreparationDesignId(next.design || undefined)
      const rememberedContext = readWorkspaceContext(projectId, sequenceId)
      const unit = selected?.content.units.find(row => rememberedContext.plan === selected.id && row.id === rememberedContext.unit) || selected?.content.units[0]
      if (selected && unit) {
        const remembered = readUnitSelection(projectId, sequenceId, selected.id, unit.id)
        const matching = productionRecords(workspace, selected.id, unit.id, remembered.prompt)
        setUnitId(unit.id); setPromptId(matching.prompt?.id)
        setReviewId(matching.reviews.find(row => row.id === remembered.review)?.id); setReviewTaskId(remembered.reviewTask)
      }
    }
    const currentCut = (cutSelection ? cutSelection.cut : restoreSelection(workspace.cuts, search.get('cut'), readWorkspaceContext(projectId, sequenceId).cut)?.id ?? null)
    if (kind === 'cut' || next.cut !== currentCut) {
      setCutSelection(current => ({ cut: next.cut, take: current?.take || null }))
      setCutSwitch(current => ({ id: next.cut, serial: (current?.serial || 0) + 1 }))
    }
    setHistoryOpen(false)
    changeView(kind === 'plan' ? 'shoot' : kind, kind === 'plan' ? 'plan-version' : kind === 'design' ? 'design-editor' : 'cut-editor')
  })
  const newDesign = () => guardDesign(() => { selectDesign(undefined, workspace.sequence.version); setDesign(emptyDesign()) })
  const productionTargets = shotProduction ? shotProductionTargets(workspace, shotProduction.designId, shotProduction.shotId) : []
  const openShotProduction = (target?: { planId: string; unitId: string }) => {
    if (!shotProduction) return
    const next = withWorkspaceView(search, 'shoot')
    next.set('design', shotProduction.designId); next.set('plan', target?.planId || ''); next.set('unit', target?.unitId || '')
    next.set('prompt', ''); next.set('review', ''); next.delete('task')
    next.set('focus', target ? `unit:${target.unitId}` : 'plan-version'); next.set('returnView', 'design')
    setShotProduction(undefined); setSearch(next)
  }
  const renderSourceRevision = (source: SourceRead) => {
    const matches = (row: { id: string; version: number }) => row.id === source.revision_id && String(row.version) === source.source.version
    const designRevision = workspace.designs.find(matches)
    if (designRevision) return <div style={{ height: 680 }}><DesignEditor active={false} revisionId={designRevision.id} cuts={workspace.cuts} value={designRevision.content} onChange={() => {}} disabled /></div>
    const planRevision = workspace.plans.find(matches)
    if (planRevision) {
      const frozenDesign = workspace.designs.find(row => row.id === planRevision.content.design_revision_id)
      return frozenDesign ? <PlanEditor projectId={projectId} workspace={workspace} design={frozenDesign.content} value={planRevision.content} onChange={() => {}} disabled /> : <Alert type="warning" message="此计划的固定设计暂不可用" />
    }
    const cutRevision = workspace.cuts.find(matches)
    if (cutRevision) return <CutItems workspace={workspace} cut={cutRevision.content} />
    const promptRevision = workspace.prompts.find(matches)
    if (promptRevision) return <PromptReader prompt={promptRevision.content} workspace={workspace} />
    return <Alert type="warning" message="此历史修订未在工作区中找到；当前版本不会代替它展示" />
  }
  return <SourceProvider projectId={projectId} sequenceId={sequenceId} renderRevision={renderSourceRevision}><WorkspaceWriteBoundary busy={busy}><SequenceLayout footer={<><span>{workspace.sequence.title}</span><span>{stage === 'design' ? `${design?.direction.shots.length || 0} 个镜头 · 计划时长` : stage === 'shoot' ? `${plan?.units.length || 0} 个单元 · 候选不自动采用` : '实际媒体与预演分别核对'}</span></>}><div className="sequence-workspace" role="region" aria-label="场次工作区">
    {!['design', 'shoot', 'cut'].includes(view) && <SequenceNavigation><div className="design-navigation"><h2>{stage === 'shoot' ? '试拍工具' : '剪辑与验收'}</h2>{Object.entries(workspaceViews).filter(([key, item]) => item.stage === stage || key === 'ledger').map(([key, item]) => <Button key={key} type="text" aria-pressed={key === view} onClick={() => changeView(key)}>{item.title}</Button>)}<Button onClick={() => setContextPanel('source')}>本场原文</Button></div></SequenceNavigation>}
    {unavailableDesignId && <Alert type="warning" message="链接指定的设计暂不可用，请重新选择版本" action={<Button onClick={() => openHistory('design')}>选择可用设计</Button>} />}
    <WorkspaceVersionDialog open={historyOpen} onClose={() => setHistoryOpen(false)} workspace={workspace} active={activeCut}
      selection={{ design: baseDesign?.id || unavailableDesignId || null, plan: basePlan?.id || unavailablePlanId || null,
        cut: (cutSelection ? cutSelection.cut : restoreSelection(workspace.cuts, search.get('cut'), readWorkspaceContext(projectId, sequenceId).cut)?.id ?? null) }}
      initialKind={historyKind} onApply={applyVersions} />
    <Drawer title={contextPanel === 'source' ? '本场原文与来源' : contextPanel === 'help' ? '当前进展' : 'AI 建议'} width={560} open={!!contextPanel && contextPanel !== 'tasks'} onClose={() => setContextPanel(undefined)}>
      {contextPanel === 'source' && <><Typography.Paragraph style={{ whiteSpace: 'pre-wrap' }}>{workspace.sequence.source_text}</Typography.Paragraph><Button onClick={() => navigate(`/projects/${projectId}/chapters/${chapterId}/sequences`)}>返回场次列表核对原文</Button></>}
      {contextPanel === 'help' && <><WorkspaceNextStep guidance={guidance} busy={busy} running={tasks.filter(task => ['queued', 'running'].includes(task.status)).length} onAction={followGuidance} /><ActiveCutSummary active={activeCut} workspace={workspace} /></>}
      {contextPanel === 'ai' && <Space direction="vertical" style={{ width: '100%' }}>
        {creative.error && <Alert type="warning" message={creative.error} />}
        <p>填写本场创作目标或修改意见。建议生成后，需明确写入草稿并单独确认。</p>
        <Input.TextArea aria-label="创作想法" placeholder="本场希望观众看到什么？也可填写对现有设计的修改意见。" value={instruction} autoSize={{ minRows: 5 }} onChange={event => creative.update({ instruction: event.target.value })} />
        <Button loading={busy} disabled={designDirty || designStale || workspace.sequence.source_changed || !!workspace.task_ids.length && tasksState !== 'ready' || tasks.some(task => task.kind === 'directing_design' && ['queued', 'running'].includes(task.status))} onClick={generateDesign}>生成导演建议</Button>
        {designDirty && <Typography.Text type="warning">请先保存本地修改。</Typography.Text>}
        {tasks.filter(task => task.kind === 'directing_design').map(task => <div key={task.task_id}><Tag>{task.status === 'succeeded' ? '建议已就绪' : task.status === 'failed' ? '生成失败' : task.status === 'cancelled' ? '已取消' : '生成中'}</Tag>{task.design && <Button onClick={() => { setContextPanel(undefined); setResult(task) }}>查看结果</Button>}{task.error && <p>{task.error}</p>}</div>)}
      </Space>}
    </Drawer>
    {reviewSubmission.error && <Alert type="error" message={reviewSubmission.error} />}
    {compileSubmission.error && <Alert type="error" message={compileSubmission.error} />}
    {shootSubmission.error && <Alert type="error" message={shootSubmission.error} />}
    {error && (!issue || issue.stage === stage && (stage !== 'shoot' || issue.planId === basePlan?.id && issue.unitId === unitId)) && <Alert type="error" message={error} closable onClose={() => setError('')} />}
    {workspace.sequence.source_changed && <Alert type="warning" message="章节原文已变化。请回场次列表核对范围后再生成新设计。" />}
    {stage === 'cut' && search.get('returnView') === 'shoot' && <Button onClick={() => { const next = withWorkspaceView(search, 'shoot'); next.delete('returnView'); next.set('focus', 'shoot-confirm'); setSearch(next) }}>返回试拍与候选</Button>}
    {stage === 'shoot' && search.get('returnView') === 'design' && <Button onClick={() => { const next = withWorkspaceView(search, 'design'); next.delete('returnView'); next.delete('focus'); setSearch(next) }}>返回镜头设计</Button>}
    {['design', 'shoot', 'cut'].includes(view) && ['feedback', 'continuity', 'ledger'].includes(search.get('returnView') || '') && <Button onClick={() => { const next = cutDestination(search, { view: search.get('returnView')! }); next.delete('returnView'); setSearch(next) }}>返回问题与记录</Button>}
    <SequenceSwitcher projectId={projectId} chapterId={chapterId} sequenceId={sequenceId} title={workspace.sequence.title} stage={stage}
      actions={<Button className="workspace-versions-entry" aria-label="版本与依据" onClick={() => openHistory()}><span className="workspace-versions-label">版本与依据</span><span className="workspace-versions-short">版本</span></Button>} />
    <WorkspaceStages onContext={key => { if (key === 'refresh') { void reload() } else setContextPanel(key as 'help' | 'source') }} view={view} onChange={changeView} items={[
      { key: 'design', label: '导演设计', children: <div className="sequence-stage-workspace">
        <WorkbenchToolbar data-workspace-target="design-version" tabIndex={-1}>
          <div className="sequence-version-context"><span>{baseDesign ? revisionName(workspace.designs, baseDesign.id, '设计') : unavailableDesignId ? '设计不可用' : '尚无设计'}</span><span>{!design ? '尚无设计' : designDirty ? '草稿 · 未保存' : baseDesign?.confirmed_at ? '已确认' : '草稿 · 已保存'}</span></div>
          <div className="sequence-version-actions"><Dropdown trigger={['click']} menu={{ items: [{ key: 'new', label: '手动起稿', onClick: newDesign }, ...(baseDesign?.confirmed_at ? [{ key: 'derive', label: '从此版本派生草稿', onClick: () => { void saveDesign() } }] : [])] }}><Button className="sequence-secondary-action">＋ 新建设计⌄</Button></Dropdown><Button className="sequence-secondary-action" onClick={() => setContextPanel('ai')}>✧ AI 建议</Button>
            {design && <><Button loading={busy} onClick={saveDesign}>{baseDesign?.confirmed_at ? '保存为新设计草稿' : '保存设计草稿'}</Button>{!baseDesign?.confirmed_at && <Button type="primary" data-workspace-target="design-confirm" disabled={!baseDesign || !!baseDesign.confirmed_at || designDirty || designStale} loading={busy} onClick={() => run(async () => {
              const response = await StudioDirectingService.directingConfirmRevision({ projectId, sequenceId, revisionId: baseDesign!.id, requestBody: { expected_version: baseDesign!.version } })
              if (response.data) { setWorkspace(response.data); selectDesign(response.data.designs.find(row => row.id === baseDesign!.id), response.data.sequence.version) }
            })}>确认本轮设计</Button>}{baseDesign?.confirmed_at && <Button type="primary" disabled={designDirty || designStale} onClick={() => prepareShoot(baseDesign.id)}>{plan?.design_revision_id === baseDesign.id || workspace.plans.filter(row => row.content.design_revision_id === baseDesign.id).length === 1 ? '继续试拍 →' : '准备试拍 →'}</Button>}</>}
            <Dropdown trigger={['click']} menu={{ items: [{ key: 'new', label: '新建设计', children: [{ key: 'manual', label: '手动起稿', onClick: newDesign }, ...(baseDesign?.confirmed_at ? [{ key: 'derive', label: '从此版本派生草稿', onClick: () => { void saveDesign() } }] : [])] }, { key: 'ai', label: 'AI 建议', onClick: () => setContextPanel('ai') }, { key: 'source', label: '本场原文', onClick: () => setContextPanel('source') }, { key: 'tasks', label: '本场任务与结果', onClick: () => setContextPanel('tasks') }, { key: 'refresh', label: '刷新状态', onClick: () => { void reload() } }, { key: 'help', label: '当前进展', onClick: () => setContextPanel('help') }, ...(baseDesign?.confirmed_at ? [{ key: 'shoot', label: '为此设计准备试拍', onClick: () => prepareShoot(baseDesign.id) }] : [])] }}><Button aria-label="更多场次操作">•••</Button></Dropdown>
          </div>
        </WorkbenchToolbar>
        {designStale && <Alert type="warning" message={`当前编辑修订 ${baseDesign!.version}，服务器版本已更新。`} action={<Button onClick={() => guardDesign(() => selectDesign(latestDesign, workspace.sequence.version))}>放弃本地编辑并载入最新设计</Button>} />}
        {baseDesign && !baseDesign.source_current && <Alert type="warning" message="此设计依据的场次范围已变化，请核对内容后保存为当前来源的设计。" />}
        {design ? <DesignEditor assetCatalog={sceneAssets} assetError={sceneAssetsError} onShoot={shotId => { if (baseDesign) setShotProduction({ designId: baseDesign.id, shotId }) }} shootUnavailable={designDirty || !baseDesign ? '先保存当前设计，再核对对应单元。' : designStale ? '请先核对服务器设计版本。' : undefined} rememberContext={{ projectId, sequenceId }} disabled={busy} revisionId={baseDesign?.id} cuts={workspace.cuts} active={view === 'design'} value={design} onChange={setDesign} assets={<><SceneAssets confirmed={!!baseDesign?.confirmed_at} dirty={designDirty} assets={sceneAssets} loadError={sceneAssetsError} onRetry={reloadSceneAssets} onAssetsChange={setSceneAssets} projectId={projectId} sequenceId={sequenceId} design={design} onChange={setDesign} /><StyleEditor projectId={projectId} sequenceId={sequenceId} value={design.style_revision_id} onChange={id => setDesign({ ...design, style_revision_id: id })} /></>} /> : <><SequenceNavigation><h2>场次结构</h2><Button type="text" onClick={() => setContextPanel('source')}>本场原文</Button></SequenceNavigation><div className="sequence-empty"><Empty description="从这场戏的行动与转折开始设计"><Space><Button type="primary" onClick={() => setContextPanel('ai')}>AI 起稿</Button><Button onClick={newDesign}>手动起稿</Button></Space></Empty></div></>}
      </div> },
      { key: 'shoot', label: '单元试拍', children: <ProductionWorkbench onRetryTasks={() => setTasksRetry(value => value + 1)} onGraphNavigate={node => draftStatus.transition(() => {
          const next = new URLSearchParams(search)
          next.set('plan', node.planId); next.set('unit', node.unitId)
          if (node.kind === 'take') { next.set('view', 'cut'); next.set('take', node.objectId); next.set('focus', 'take-review'); next.set('returnView', 'shoot') }
          else {
            next.set('view', 'shoot'); next.set('focus', 'prompt-review')
            const prompt = node.kind === 'prompt' ? node.objectId : workspace.reviews.find(row => row.id === node.objectId)?.content.occurrences.find(row => row.plan_revision_id === node.planId && row.unit_id === node.unitId)?.prompt_revision_id
            next.set('prompt', prompt || ''); next.set('review', node.kind === 'review' ? node.objectId : ''); next.delete('task')
          }
          setSearch(next)
        })} unitProgress={unitProgress} reviewNeedsAttention={!!(pendingReviewTask?.review || selectedReview?.content)?.rows.some(row => row.verdict !== 'pass')} busy={busy} prepareAction={{ label: '保存并确认拍摄准备', run: confirmPlan, disabled: planStale || !plan?.units.length }}
        checkAction={pendingCompile || !records.prompts.length ? { target: 'compile', recovering: !!pendingCompile, label: pendingCompile ? '核实本次指令生成' : '生成试拍指令', run: compileInstruction, disabled: !!compileSubmission.error || !unitId || planDirty || planStale || (!pendingCompile && currentPromptPending) }
          : pendingCheck ? { recovering: true, label: '核实本次检查', run: checkInstruction, disabled: !!reviewSubmission.error || planDirty || planStale }
          : pendingReviewTask ? { label: reviewPacketPassed(pendingReviewTask.review, promptId) ? '确认结论，进入试拍' : '保存检查结论', run: () => applyTaskResult(pendingReviewTask) }
          : selectedPrompt && !records.reviews.length && !pendingReviews.length ? { label: '检查这份指令', run: checkInstruction, disabled: !!reviewSubmission.error || (!pendingCheck && currentPromptPending) || planDirty || planStale }
          : undefined}
        shootAction={{ recovering: !!pendingShoot, label: pendingShoot ? '核实本次提交' : records.takes.some(take => take.prompt_revision_id === promptId) ? '同指令再拍一次' : '开始试拍', run: shootUnit, disabled: !!shootSubmission.error || !selectedPrompt?.confirmed_at || !reviewCanExecute(selectedReview, promptId) || selectedPrompt.content.plan_revision_id !== basePlan?.id || selectedPrompt.content.unit_id !== unitId || planDirty || planStale || (!pendingShoot && currentPromptPending) }} planReady={!!basePlan?.confirmed_at && !planDirty && !planStale} promptId={promptId} reviewId={reviewId} tasks={tasks} submitted={pendingTask} tasksState={tasksState} onOpenTasks={() => setContextPanel('tasks')} focusRequest={focusTarget ? `${location.key}:${focusTarget}` : null} active={view === 'shoot'} workspace={workspace} plan={plan} planId={basePlan?.id} selectedUnitId={unitId} onSelectUnit={selectUnit}
        start={!plan?.units.length ? <ShootPreparation unavailablePlanId={unavailablePlanId} workspace={workspace} currentPlanId={basePlan?.id} designId={plan?.design_revision_id || preparationDesignId || baseDesign?.id} onDesign={id => { if (!plan) { setUnavailablePlanId(undefined); setPreparationDesignId(id) } else guardPlan(() => { selectPlan(undefined); setPreparationDesignId(id) }) }} onBack={() => changeView('design')} onRetry={() => { void reload().then(current => { const restored = current?.plans.find(row => row.id === unavailablePlanId); if (restored) selectPlan(restored) }) }} onPlan={id => guardPlan(() => selectPlan(workspace.plans.find(row => row.id === id)))} onCreate={next => { const apply = () => { setUnavailablePlanId(undefined); if (plan?.design_revision_id !== next.design_revision_id) setBasePlan(undefined); setPlan(next); setUnitId(next.units[0]?.id); setPromptId(undefined); setReviewId(undefined) }; if (plan?.design_revision_id === next.design_revision_id && !plan.units.length) apply(); else guardPlan(apply) }} /> : undefined}
        toolbar={<><Space wrap data-workspace-target="plan-version" tabIndex={-1}><span>{basePlan ? revisionName(workspace.plans, basePlan.id, '计划') : '尚无计划'}</span><Typography.Text type="secondary">依据：{plan ? revisionName(workspace.designs, plan.design_revision_id, '设计') : '尚未选择'}</Typography.Text></Space>
          <Space wrap>{(planDirty || !basePlan?.confirmed_at) && <Button loading={busy} disabled={!plan?.units.length} onClick={savePlan}>{basePlan?.confirmed_at ? '保存为新计划草稿' : '保存生产计划草稿'}</Button>}
          <Dropdown trigger={['click']} menu={{ items: [
            { key: 'new', label: '从已确认设计创建新计划', children: workspace.designs.filter(row => row.confirmed_at).map(row => ({ key: row.id, label: revisionName(workspace.designs, row.id, '设计'), onClick: () => guardPlan(() => { selectPlan(undefined); setPreparationDesignId(row.id) }) })) },
            ...(basePlan?.confirmed_at && !planDirty ? [{ key: 'derive', label: '保存为新计划草稿', onClick: () => { void savePlan() } }] : []),
          ] }}><Button aria-label="更多计划操作">···</Button></Dropdown></Space></>}
        preparation={<>
        {plan && <details><summary>版本与引用</summary><Space direction="vertical">
          <Typography.Text>{planDirty ? '当前编辑：未保存草稿' : '当前查看：'}{basePlan ? ` · ${revisionName(workspace.plans, basePlan.id, '计划')} · ${basePlan.confirmed_at ? '基线已确认，修改将派生新版本' : '草稿'}` : ' · 新计划'} · 固定设计依据：{revisionName(workspace.designs, plan.design_revision_id, '设计')}</Typography.Text>
          {basePlan && <Typography.Text type="secondary">此计划的引用：{revisionReferences(workspace, activeCut, 'plan', basePlan.id).join('；') || '暂无提示词或素材引用'}。查看或编辑不改变已有引用。</Typography.Text>}
        </Space></details>}
        {planStale && <Alert type="warning" message={`当前编辑计划修订 ${basePlan!.version}，服务器版本已更新。`} action={<Button onClick={() => guardPlan(() => selectPlan(latestPlan))}>放弃本地编辑并载入最新计划</Button>} />}
        {plan && planDesign ? <><div data-workspace-target="plan-editor" tabIndex={-1}><PlanEditor assets={sceneAssets} assetError={sceneAssetsError} onReloadAssets={reloadSceneAssets} disabled={busy} planId={basePlan?.id} selectedUnitId={unitId} projectId={projectId} workspace={workspace} design={planDesign.content} value={plan} onChange={setPlan} issue={issue?.stage === 'shoot' && issue.planId === basePlan?.id ? issue : undefined} /></div>

</> : <Alert type="warning" message="当前计划的设计依据不可用，请重试或重新选择计划。" action={<Button onClick={() => { void reload() }}>重试读取依据</Button>} />}
</>}
        prompt={basePlan?.confirmed_at ? records.prompts.length ? <ShootInstructions workspace={workspace} planId={basePlan.id} unitId={unitId} promptId={promptId} reviewId={reviewId} reviewTask={pendingReviewTask} tasks={tasks} onPrompt={(id, source, candidates) => draftStatus.transition(() => { const row = workspace.prompts.find(item => item.id === id); if (row && row.content.plan_revision_id !== basePlan?.id) { selectPlan(workspace.plans.find(item => item.id === row.content.plan_revision_id)); setUnitId(row.content.unit_id) }; setPromptId(id); setReviewId(source?.kind === 'review' ? source.id : undefined); setReviewTaskId(source?.kind === 'task' ? source.id : undefined); if (candidates) changeView('shoot', 'shoot-confirm') })} onReview={(id, taskId) => draftStatus.transition(() => { setReviewId(id); setReviewTaskId(taskId) })} regenerate={<>{!pendingCompile && <Button type="link" data-workspace-target="compile" disabled={!!compileSubmission.error || !unitId || planDirty || planStale || currentPromptPending} loading={busy} onClick={compileInstruction}>重新生成新版本</Button>}<p className="design-secondary">新版本需要重新检查，已有结果保留。</p></>} /> : <Empty description="拍摄准备已确认，使用主操作生成试拍指令。" /> : null}
        adjustment={selectedPrompt ? <ReviewRevisionPanel key={reviewDirectionScope(projectId, sequenceId, promptId || '', selectedReview, pendingReviewTask?.task_id)} scope={reviewDirectionScope(projectId, sequenceId, promptId || '', selectedReview, pendingReviewTask?.task_id)} projectId={projectId} sequenceId={sequenceId} promptId={promptId || ''} reviewSource={pendingReviewTask ? { kind: 'task', id: pendingReviewTask.task_id } : selectedReview ? { kind: 'review', id: selectedReview.id } : undefined} disabled={busy || planDirty || planStale || designStale} onPrepare={() => changeView('shoot', `unit-model:${unitId}`)} onDesign={() => draftStatus.transition(() => { selectDesign(workspace.designs.find(row => row.id === basePlan?.content.design_revision_id), workspace.sequence.version); changeView('design', 'design-editor') })} onTask={taskId => { setPendingTask(rememberSubmittedTask(projectId, sequenceId, { taskId, planId: basePlan?.id, unitId, promptId })); void reload() }} onApplied={(next, nextPlanId, nextPromptId, nextTaskId) => {
            const appliedPlan = next.plans.find(row => row.id === nextPlanId)
            selectDesign(next.designs.find(row => row.id === appliedPlan?.content.design_revision_id), next.sequence.version)
            setPendingTask(rememberSubmittedTask(projectId, sequenceId, { taskId: nextTaskId, planId: nextPlanId, unitId: next.prompts.find(row => row.id === nextPromptId)?.content.unit_id, promptId: nextPromptId })); setWorkspace(next); selectPlan(next.plans.find(row => row.id === nextPlanId)); setPromptId(nextPromptId); setReviewId(undefined); setReviewTaskId(nextTaskId)
          }} packet={pendingReviewTask?.review || selectedReview?.content} workspace={workspace} /> : null}
        review={selectedPrompt ? <Space direction="vertical" className="w-full" data-workspace-target="review" tabIndex={-1}>
          <ShootReview promptName={selectedPrompt ? revisionName(workspace.prompts, selectedPrompt.id, '指令') : '尚未选择指令'} packet={pendingReviewTask?.review || selectedReview?.content} pending={pendingReviewTask} derived={!!selectedReview?.parent_id} busy={busy} workspace={workspace} onResolve={row => { let reason = ''; Modal.confirm({ title: '接受此艺术偏离并记录理由', content: <Space direction="vertical" className="w-full"><ReviewDetails row={row} context={contextForPrompt(workspace, selectedPrompt?.id)} /><Input.TextArea placeholder="说明为什么保留当前方案；结构和模型能力校验仍不可绕过" onChange={event => { reason = event.target.value }} /></Space>, onOk: async () => {
              const response = await StudioDirectingService.directingResolveReview({ projectId, sequenceId, reviewId: selectedReview!.id, requestBody: { role: row.role, occurrence_id: row.occurrence_id, reason } })
              if (response.data) { setWorkspace(response.data); setReviewId(uniqueNewRecord(workspace.reviews, productionRecords(response.data, basePlan?.id, unitId, promptId).reviews)?.id) }
            } }) }} />
          {selectedReview && !pendingReviewTask && !reviewCanExecute(selectedReview, promptId) && <Button disabled={!!reviewSubmission.error || currentPromptPending || planDirty || planStale} loading={busy} onClick={checkInstruction}>重新检查这份指令</Button>}
        </Space> : null}
        execution={selectedPrompt ? <><ShootFixedInput workspace={workspace} prompt={selectedPrompt} review={selectedReview} compact />{!reviewCanExecute(selectedReview, promptId) && <Alert type="info" message="当前指令尚未具备开拍条件。先完成检查与结论确认，已有候选仍可浏览。" />}{pendingShoot && <Alert type="warning" message="本次提交结果尚未核实，使用上方主操作恢复同一次试拍。" />}</> : null}
        candidates={<ShootCandidates key={JSON.stringify([basePlan?.id, unitId])} workspace={workspace} planId={basePlan?.id} unitId={unitId} promptId={promptId} activeCut={activeCut} onCut={id => { const query = new URLSearchParams(search); query.set('view', 'cut'); query.set('take', id); query.set('focus', 'take-review'); query.set('returnView', 'shoot'); setSearch(query) }} />}
        advanced={<>        {basePlan && <><RegroupPanel key={basePlan.id} projectId={projectId} sequenceId={sequenceId} plan={basePlan} disabled={!basePlan.confirmed_at || planDirty || planStale} onChange={next => { setWorkspace(next); selectPlan(next.plans.slice(-1)[0]); setPromptId(undefined); setReviewId(undefined) }} /></>}
</>}
      /> },
      { key: 'continuity', label: '实际连续性', children: <ContinuityPanel key={sequenceId} projectId={projectId} workspace={workspace} /> },
      { key: 'batch', label: '批量拍摄', children: <BatchPanel key={sequenceId} projectId={projectId} workspace={workspace} onSubmitted={reload} /> },
      { key: 'visual', label: '视觉验证', children: <VisualPanel projectId={projectId} workspace={workspace} onSubmitted={reload} /> },
      { key: 'ledger', label: '三本账', children: <LedgerPanel key={sequenceId} projectId={projectId} sequenceId={sequenceId} /> },
      { key: 'feedback', label: '场次验收与返工', children: <FeedbackPanel key={sequenceId} projectId={projectId} workspace={workspace} onRefresh={async () => { await reload() }} /> },
      { key: 'cut', label: '审片与粗剪', children: <CutEditor switchRequest={cutSwitch} key={workspace.sequence.id} projectId={projectId} workspace={workspace} activeCut={activeCut} onChange={setWorkspace} onSelection={setCutSelection} /> },
    ]} />
    <Modal title="镜头对应的试拍单元" open={!!shotProduction} footer={null} onCancel={() => setShotProduction(undefined)}>
      <p>按当前已保存设计精确关联；不同计划中的同名单元分别列出。选择只定位工作区，不执行拍摄。</p>
      {productionTargets.length ? <Space direction="vertical" className="w-full">{productionTargets.map(target => <Button block className="shot-production-target" key={`${target.planId}:${target.unitId}`} onClick={() => openShotProduction(target)}>{target.label} · {target.confirmed ? '已确认' : '草稿'}<small>{target.coverage}</small></Button>)}</Space> : <><Empty description="当前设计中的此镜头尚未关联生产单元" /><p>{workspace.designs.find(row => row.id === shotProduction?.designId)?.confirmed_at ? '可在试拍准备中从本设计创建计划，再配置单元覆盖。' : '请先确认导演设计，然后从该设计创建生产计划。'}</p><Button onClick={() => openShotProduction()}>前往试拍准备</Button></>}
    </Modal>
    <Drawer title="本场任务与结果" width={560} open={contextPanel === 'tasks'} onClose={() => setContextPanel(undefined)} forceRender><DirectingTasks retryKey={tasksRetry} onTake={id => { setContextPanel(undefined); const query = new URLSearchParams(search); query.set('view', 'cut'); query.set('take', id); query.set('focus', 'take-review'); setSearch(query) }} workspace={workspace} selectedTaskId={search.get('task')} onState={setTasksState} onTasks={setTasks} projectId={projectId} taskIds={[...new Set([...workspace.task_ids, ...pendingTask.map(item => item.taskId)])]} onSettled={reload} onResult={task => { setResult(task); setContextPanel(undefined) }} /></Drawer>
    <Modal title={result?.image_file_ids?.length ? '验证图候选' : result?.design ? '导演建议' : '审稿结果'} open={!!result} width={900} onCancel={() => setResult(undefined)} footer={result?.image_file_ids?.length ? null : <Button type="primary" loading={busy} onClick={() => { if (result) applyTaskResult(result) }}>{result?.design ? '写入可编辑草稿' : '保存审稿结论'}</Button>}>
      {error && <Alert type="error" message={error} />}
      {!!result?.image_file_ids?.length && <><Typography.Paragraph>候选图已保存到本项目素材。请在生产计划中明确选择，才会加入本次参考；不会自动替换已确认素材。</Typography.Paragraph>{result.image_file_ids.map(id => <Image key={id} src={buildFileDownloadUrl(id)} alt="验证图候选" />)}</>}
      {result?.design && <DesignEditor active={false} value={result.design} onChange={() => {}} disabled />}
      {result?.review?.rows.map(row => <Card key={row.role + row.occurrence_id} size="small" title={`${roles[row.role]} · ${row.verdict === 'pass' ? '通过' : row.verdict === 'pending' ? '待审' : '需修改'}`}><ReviewDetails row={row} context={contextForPrompt(workspace, result.review?.occurrences.find(item => item.id === row.occurrence_id)?.prompt_revision_id)} /></Card>)}
    </Modal>
  </div></SequenceLayout></WorkspaceWriteBoundary></SourceProvider>
}
