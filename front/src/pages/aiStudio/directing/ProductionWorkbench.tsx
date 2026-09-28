import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Alert, Button, Drawer, Empty, Popover, Select } from 'antd'
import type { DirectingTaskRead, ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import { productionRecords } from './workspaceProduction'
import { pendingReviewResults, reviewCanExecute } from './workspaceGuidance'
import { tasksForUnit, taskWorkspaceContext, unitTaskSummary } from './workspaceTaskContext'
import type { SubmittedWorkspaceTask } from './workspaceGuidance'
import { SequenceNavigation } from './SequenceLayout'
import { WorkbenchToolbar, WorkbenchObjectBar, WorkbenchNavigation, WorkbenchInspector, navigationMatches } from './WorkbenchChrome'
import { ShootTaskProgress } from './ShootTaskProgress'
import { revisionName } from './workspaceUsage'

type DetailRequest = { tab: 'text' | 'input' | 'history' | 'checks' | 'candidate'; paths?: string[]; takeId?: string }
export const ProductionDetailContext = createContext<{ target: HTMLElement | null; request?: DetailRequest; show: (request: DetailRequest) => void; close: () => void }>({ target: null, show: () => {}, close: () => {} })

const InspectorContext = createContext<HTMLElement | null>(null)
export function ProductionParameters({ children }: { children: ReactNode }) {
  const target = useContext(InspectorContext)
  return target ? createPortal(children, target) : null
}

type StepAction = { label: string; run: () => void; disabled?: boolean; recovering?: boolean; target?: string }
const steps = [['prepare', '拍摄准备'], ['prompt', '指令检查'], ['takes', '试拍与候选']] as const
const restoreStep = (value?: string | null) => value === 'review' || value === 'takes' ? 'takes' : value === 'prompt' ? 'prompt' : 'prepare'

/** 版本控制、单元导航、工作内容和参数检查固定分区，切页不卸载编辑器。 */
export function ProductionWorkbench({ unitProgress, reviewNeedsAttention, prepareAction, checkAction, shootAction, busy, planReady, promptId, reviewId, active, focusRequest, tasks, submitted, tasksState, onOpenTasks, plan, planId, workspace, selectedUnitId, onSelectUnit, toolbar, start, preparation, prompt, review, execution, candidates, advanced }: {
  unitProgress: Record<string, string>; reviewNeedsAttention: boolean;
  prepareAction: StepAction; checkAction?: StepAction; shootAction: StepAction; busy: boolean; planReady: boolean; promptId?: string; reviewId?: string;
  tasks: DirectingTaskRead[]; submitted: SubmittedWorkspaceTask[]; tasksState: 'loading' | 'ready' | 'error'; onOpenTasks: () => void;
  active: boolean; focusRequest: string | null; plan?: ProductionPlan_Input; planId?: string; workspace: WorkspaceRead; selectedUnitId?: string; onSelectUnit: (id: string) => void;
  start?: ReactNode; toolbar: ReactNode; preparation: ReactNode; prompt: ReactNode; review: ReactNode; execution: ReactNode; candidates: ReactNode; advanced: ReactNode;
}) {
  const [search, setSearch] = useSearchParams()
  const tabsId = useId()
  const focus = search.get('focus')
  const [context] = useState(() => readWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id))
  const [tab, setTab] = useState(() => focus === 'shoot-confirm' ? 'takes' : ['compile', 'prompt-review', 'review'].includes(focus || '') ? 'prompt' : context.shootIdentity === JSON.stringify([planId, selectedUnitId]) && ['prepare', 'prompt', 'review', 'takes'].includes(context.shootTab || '') ? restoreStep(context.shootTab) : search.get('prompt') ? 'prompt' : 'prepare')
  useEffect(() => { if (!focusRequest) return; if (focus === 'shoot-confirm') setTab('takes'); else if (['compile', 'prompt-review', 'review'].includes(focus || '')) setTab('prompt'); else if (focus?.startsWith('unit-model:')) { setTab('prepare'); setOpen(true) } else if (focus?.startsWith('unit:') || ['plan-version', 'plan-editor', 'unit-select'].includes(focus || '')) setTab('prepare') }, [focus, focusRequest])
  const [query, setQuery] = useState(context.shootQuery || '')
  useEffect(() => { saveWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id, { shootTab: tab, shootQuery: query, shootIdentity: JSON.stringify([planId, selectedUnitId]) }) }, [workspace.sequence.project_id, workspace.sequence.id, planId, selectedUnitId, tab, query])
  const scrolling = useWorkspaceScroll(workspace.sequence.project_id, workspace.sequence.id, 'shootScroll', JSON.stringify([planId, selectedUnitId, tab]), '.production-content')
  const inspectorScrolling = useWorkspaceScroll(workspace.sequence.project_id, workspace.sequence.id, 'shootInspectorScroll', JSON.stringify([planId, selectedUnitId, tab]))
  const [parameters, setParameters] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<HTMLDivElement | null>(null)
  const [detailRequest, setDetailRequest] = useState<DetailRequest>()
  const trigger = useRef<HTMLElement>()
  const showDetail = (request: DetailRequest) => { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; setDetailRequest(request); setOpen(true) }
  const closeDetail = () => { setDetailRequest(undefined); setOpen(false); requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus({ preventScroll: true })) }
  useEffect(() => { setDetailRequest(undefined); setOpen(false) }, [planId, selectedUnitId, active])
  useEffect(() => { setDetailRequest(undefined); setOpen(false) }, [tab])
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const previousPlan = useRef(planId)
  useEffect(() => { if (previousPlan.current !== planId && advancedOpen) { setAdvancedOpen(false); setTab('prepare') } previousPlan.current = planId }, [planId, advancedOpen])
  useEffect(() => { if (!active) { setOpen(false); setAdvancedOpen(false) } }, [active])
  const desktop = useWorkbenchDesktop()
  const selectedTasks = tasksForUnit(workspace, tasks, submitted, planId, selectedUnitId)
  const promptTasks = selectedTasks.filter(task => {
    const context = taskWorkspaceContext(workspace, task.task_id, submitted, task)
    return !promptId || !context?.promptId || context.promptId === promptId
  })
  const records = productionRecords(workspace, planId, selectedUnitId, promptId)
  const selectedUnit = plan?.units.find(unit => unit.id === selectedUnitId)
  const shownUnit = records.prompt ? workspace.plans.find(row => row.id === records.prompt?.content.plan_revision_id)?.content.units.find(unit => unit.id === records.prompt?.content.unit_id) : selectedUnit
  const selectedReview = records.reviews.find(row => row.id === reviewId)
  const waitingChecks = pendingReviewResults(workspace, tasks, planId, selectedUnitId, promptId)
  const checkLabel = promptTasks.some(task => task.kind === 'directing_review' && ['queued', 'running'].includes(task.status)) ? '检查中' : selectedReview ? reviewCanExecute(selectedReview, promptId) ? '可开始试拍' : '检查需处理' : waitingChecks.length ? '待确认结论' : records.reviews.length ? '待选择检查' : records.prompt ? '待检查' : records.prompts.length ? '待选择指令' : '待生成指令'
  const inspector = <div className="production-inspector-content" ref={inspectorScrolling}><div hidden={tab !== 'prepare'}><h2>单元参数与检查</h2><div ref={setParameters} /></div><div ref={setDetailTarget} hidden={tab === 'prepare'} /></div>
  const matchesUnit = (unit: NonNullable<ProductionPlan_Input['units']>[number]) => navigationMatches(query, `单元 ${String(plan!.units.indexOf(unit) + 1).padStart(2, '0')}`, ...unit.coverage.map(row => row.action_scope))
  const shownUnits = plan?.units.filter(matchesUnit) || []
  const detailVisible = tab === 'prepare' || !!detailRequest
  const focusProblem = () => { setTab('prompt'); requestAnimationFrame(() => { const row = document.querySelector<HTMLDetailsElement>('.production-center [data-review-problem]'); if (row) { row.open = true; row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }) } }) }
  const go = (step: string) => { setTab(step); if (search.has('focus')) { const next = new URLSearchParams(search); next.delete('focus'); setSearch(next, { replace: true }) } }
  const problemAction = tab === 'prompt' && reviewNeedsAttention
  const reviewing = promptTasks.some(task => task.kind === 'directing_review' && ['queued', 'running'].includes(task.status))
  const shooting = promptTasks.some(task => task.kind === 'video_generation' && ['queued', 'running'].includes(task.status))
  const primary: StepAction | undefined = tab === 'prepare' ? planReady ? { label: '进入指令检查', run: () => go('prompt') } : prepareAction
    : !planReady ? { label: '返回拍摄准备', run: () => go('prepare') }
    : tab === 'takes' ? reviewCanExecute(selectedReview, promptId) ? shooting && !shootAction.recovering ? undefined : shootAction : { label: '去检查指令', run: () => go('prompt') }
    : checkAction?.recovering ? checkAction
    : reviewing ? undefined
    : problemAction ? { label: '处理首个问题', run: focusProblem }
    : checkAction || (reviewCanExecute(selectedReview, promptId) ? { label: '进入试拍', run: () => go('takes') } : undefined)
  const executing = selectedTasks.filter(task => task.kind === 'video_generation' && ['queued', 'running'].includes(task.status)).length
  const stepStatus = [planReady ? '已确认' : '待确认', planReady ? checkLabel : '待准备', `${executing ? `生成中 ${executing} · ` : ''}${records.takes.length} 个候选`]
  const taskSource = (task: DirectingTaskRead) => {
    const context = taskWorkspaceContext(workspace, task.task_id, submitted, task)
    return context?.promptId ? revisionName(workspace.prompts, context.promptId, '指令') : '指令来源待核实'
  }
  return <ProductionDetailContext.Provider value={{ target: detailTarget, request: detailRequest, show: showDetail, close: closeDetail }}><InspectorContext.Provider value={parameters}><div className="sequence-stage-workspace production-workbench">
    {active && <SequenceNavigation><WorkbenchNavigation title="拍摄单元" query={query} onQuery={setQuery} placeholder="搜索单元编号或动作"><div className="production-unit-list">{shownUnits.map(unit => {
      const takes = workspace.takes.filter(take => take.plan_revision_id === planId && take.unit_id === unit.id)
      const runningSummary = unitTaskSummary(tasksForUnit(workspace, tasks, submitted, planId, unit.id).filter(task => ['queued', 'running'].includes(task.status)))
      return <button key={unit.id} aria-pressed={unit.id === selectedUnitId} onClick={() => onSelectUnit(unit.id)}><strong>单元 {String(plan!.units.indexOf(unit)+1).padStart(2,'0')}</strong><span>{unit.coverage.map(c => c.action_scope).join('；') || '动作范围待填写'}</span><small>{unitProgress[unit.id]} · {takes.length} 个候选</small>{runningSummary && <small>{runningSummary}</small>}</button>
    })}{!!plan?.units.length && !shownUnits.length && <div data-navigation-tool><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="没有匹配的单元"><Button onClick={() => setQuery('')}>清除搜索</Button></Empty></div>}{!plan?.units.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无拍摄单元" />}</div>{!start && <><Button type="text" onClick={onOpenTasks}>本场任务记录 · {new Set([...workspace.task_ids, ...submitted.map(item => item.taskId)]).size}</Button><Button onClick={() => setAdvancedOpen(true)}>拆分与重组</Button></>}</WorkbenchNavigation></SequenceNavigation>}
    {!start && <WorkbenchToolbar className="production-version-bar">{toolbar}</WorkbenchToolbar>}
    <div className={`production-panels${start || !detailVisible ? ' is-starting' : ''}${detailRequest ? ' has-instruction' : ''}`}><section className="production-center" ref={scrolling}>
      {query && plan?.units.some(unit => unit.id === selectedUnitId && !matchesUnit(unit)) && <Alert type="info" message="所选单元不在筛选结果中" action={<Button onClick={() => setQuery('')}>清除筛选</Button>} />}
      {tasksState !== 'ready' && <Alert type={tasksState === 'error' ? 'warning' : 'info'} message={tasksState === 'error' ? '任务状态暂不可用，请核对后再执行' : '正在核对任务状态'} />}
      {!start && <WorkbenchObjectBar className="production-next-step"><div className="production-object-heading"><h2><Popover trigger="click" title="本次动作范围" content={<div className="production-action-description">{selectedUnit?.coverage.map(row => row.action_scope).join('；') || '动作范围待填写'}</div>}><button type="button" className="production-action-title" aria-label="查看完整动作范围">{selectedUnit ? `单元 ${String(plan!.units.indexOf(selectedUnit) + 1).padStart(2, '0')}` : '选择拍摄单元'} · {selectedUnit?.coverage.map(row => row.action_scope).join('；') || '选择本次要拍的动作'}</button></Popover></h2><span role="status">{unitProgress[selectedUnitId || ''] || checkLabel}</span>{shownUnit && <p className="shoot-unit-meta">{shownUnit.coverage.length} 个镜头范围 · {shownUnit.duration_ms / 1000} 秒 · {shownUnit.ratio}</p>}</div>{primary && <Button type="primary" disabled={primary.disabled || tasksState !== 'ready' && (primary === checkAction || primary === shootAction) && !primary.recovering} loading={busy} data-workspace-target={primary.target || (tab === 'prepare' ? 'plan-confirm' : tab === 'takes' ? 'shoot-confirm' : 'prompt-review')} onClick={primary.run}>{primary.label}</Button>}</WorkbenchObjectBar>}
      {start || <><div className="production-step-navigation">
        <div className="production-local-tabs production-steps" role="tablist" aria-label="单元试拍步骤" onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const current = steps.findIndex(([key]) => key === tab)
          const index = event.key === 'Home' ? 0 : event.key === 'End' ? 2 : (current + (event.key === 'ArrowRight' ? 1 : 2)) % 3
          go(steps[index][0]); (event.currentTarget.children[index] as HTMLElement).focus()
        }}>{steps.map(([key, label], index) => <button type="button" role="tab" aria-label={label} id={`${tabsId}-${key}`} aria-controls={`${tabsId}-content`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => go(key)}><span className="production-step-number" aria-hidden="true">{index + 1}</span><span>{label}</span><small>{stepStatus[index]}</small></button>)}</div>
        <Select className="production-step-select" aria-label="切换试拍步骤" value={tab} onChange={go} options={steps.map(([value, label], index) => ({ value, label: `第${index + 1}步／共3步 · ${label} · ${stepStatus[index]}` }))} />
      </div><div className="production-content" id={`${tabsId}-content`} role="tabpanel" aria-label={steps.find(([key]) => key === tab)?.[1]}>
        <div hidden={tab !== 'prepare'}>{preparation}</div>
        <div hidden={tab !== 'prompt'}>{prompt}</div>
        {tab === 'prompt' && <><ShootTaskProgress tasks={promptTasks} state={tasksState} kind="review" />{!planReady ? <Empty description="先保存并确认本次拍摄准备" /> : review || (records.prompt && !records.reviews.length && !waitingChecks.length ? <section className="shoot-check-ready" aria-label="待检查的固定依据"><h3>核对这份指令是否可以用于试拍</h3><p>{shownUnit?.coverage.map(row => row.action_scope).join('；') || '动作范围暂不可用'}</p><p>{shownUnit?.references.length ?? 0} 份参考 · {shownUnit ? `${shownUnit.duration_ms / 1000} 秒 · ${shownUnit.ratio}` : '固定准备暂不可用'}</p><p className="design-secondary">检查将覆盖导演设计、表演动作、场面调度、摄影构图、连续性和提示词要求。检查完成后需明确确认结论，再开始试拍。</p></section> : null)}</>}
        {tab === 'takes' && <>{execution || <Alert type="info" message="本次尚无可执行的检查结论。完成准备与指令检查后再开拍，已有候选仍可浏览。" />}<ShootTaskProgress tasks={selectedTasks} state={tasksState} kind="video" sourceLabel={taskSource} />{candidates || <Empty description={executing ? '试拍进行中，真实产出登记后将在此显示' : '本单元还没有候选视频'} />}</>}
      </div></>}

      </section>{!start && <WorkbenchInspector className="production-inspector" visible={detailVisible} title={tab === 'prepare' ? '单元参数与检查' : undefined} closable={tab === 'prepare'} open={open} onClose={closeDetail} width={tab === 'prepare' ? 344 : 440}>{inspector}</WorkbenchInspector>}</div>
    {!desktop && !start && tab === 'prepare' && <Button className="design-detail-trigger" onClick={() => setOpen(true)}>参数与检查</Button>}
    <Drawer title="拆分或重组生产计划" width={640} open={advancedOpen} onClose={() => setAdvancedOpen(false)}>{advanced || <p>请先保存并确认生产计划。</p>}</Drawer>
  </div></InspectorContext.Provider></ProductionDetailContext.Provider>
}
