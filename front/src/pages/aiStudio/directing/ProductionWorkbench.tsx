import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Alert, Button, Drawer, Empty, Popover } from 'antd'
import type { DirectingTaskRead, ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import { productionRecords } from './workspaceProduction'
import { pendingReviewResults, reviewCanExecute } from './workspaceGuidance'
import type { WorkspaceGuidance } from './workspaceGuidance'
import { tasksForUnit, taskWorkspaceContext, unitTaskSummary } from './workspaceTaskContext'
import type { SubmittedWorkspaceTask } from './workspaceGuidance'
import { SequenceNavigation } from './SequenceLayout'
import { WorkbenchToolbar, WorkbenchObjectBar, WorkbenchNavigation, WorkbenchInspector, navigationMatches } from './WorkbenchChrome'
import { ShootTaskProgress } from './ShootTaskProgress'

type DetailRequest = { tab: 'text' | 'input' | 'history' | 'checks'; paths?: string[] }
export const ProductionDetailContext = createContext<{ target: HTMLElement | null; request?: DetailRequest; show: (request: DetailRequest) => void; close: () => void }>({ target: null, show: () => {}, close: () => {} })

const InspectorContext = createContext<HTMLElement | null>(null)
export function ProductionParameters({ children }: { children: ReactNode }) {
  const target = useContext(InspectorContext)
  return target ? createPortal(children, target) : null
}

/** 版本控制、单元导航、工作内容和参数检查固定分区，切页不卸载编辑器。 */
export function ProductionWorkbench({ unitProgress, reviewNeedsAttention, primaryAction, busy, guidance, onNext, planReady, promptId, reviewId, active, focusRequest, tasks, submitted, tasksState, onOpenTasks, plan, planId, workspace, selectedUnitId, onSelectUnit, toolbar, start, preparation, prompt, review, execution, candidates, advanced }: {
  unitProgress: Record<string, string>; reviewNeedsAttention: boolean;
  primaryAction?: { label: string; run: () => void; disabled?: boolean }; busy: boolean;
  guidance: WorkspaceGuidance; onNext: (next: WorkspaceGuidance) => void; planReady: boolean; promptId?: string; reviewId?: string;
  tasks: DirectingTaskRead[]; submitted: SubmittedWorkspaceTask[]; tasksState: 'loading' | 'ready' | 'error'; onOpenTasks: () => void;
  active: boolean; focusRequest: string | null; plan?: ProductionPlan_Input; planId?: string; workspace: WorkspaceRead; selectedUnitId?: string; onSelectUnit: (id: string) => void;
  start?: ReactNode; toolbar: ReactNode; preparation: ReactNode; prompt: ReactNode; review: ReactNode; execution: ReactNode; candidates: ReactNode; advanced: ReactNode;
}) {
  const [search] = useSearchParams()
  const tabsId = useId()
  const focus = search.get('focus')
  const [context] = useState(() => readWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id))
  const [tab, setTab] = useState(() => focus === 'shoot-confirm' ? 'review' : ['compile', 'prompt-review', 'review'].includes(focus || '') ? 'prompt' : context.shootIdentity === JSON.stringify([planId, selectedUnitId]) && ['prepare', 'prompt', 'review', 'takes'].includes(context.shootTab || '') ? context.shootTab! : search.get('prompt') ? 'prompt' : 'prepare')
  useEffect(() => { if (!focusRequest) return; if (focus === 'shoot-confirm') setTab('review'); else if (['compile', 'prompt-review', 'review'].includes(focus || '')) setTab('prompt'); else if (focus?.startsWith('unit-model:')) { setTab('prepare'); setOpen(true) } else if (focus?.startsWith('unit:') || ['plan-version', 'plan-editor', 'unit-select'].includes(focus || '')) setTab('prepare') }, [focus, focusRequest])
  const [query, setQuery] = useState(context.shootQuery || '')
  useEffect(() => { saveWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id, { shootTab: tab, shootQuery: query, shootIdentity: JSON.stringify([planId, selectedUnitId]) }) }, [workspace.sequence.project_id, workspace.sequence.id, planId, selectedUnitId, tab, query])
  const scrolling = useWorkspaceScroll(workspace.sequence.project_id, workspace.sequence.id, 'shootScroll', JSON.stringify([planId, selectedUnitId, tab]), '.production-content')
  const inspectorScrolling = useWorkspaceScroll(workspace.sequence.project_id, workspace.sequence.id, 'shootInspectorScroll', JSON.stringify([planId, selectedUnitId, tab]))
  const [parameters, setParameters] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [detailTarget, setDetailTarget] = useState<HTMLDivElement | null>(null)
  const [detailRequest, setDetailRequest] = useState<DetailRequest>()
  const trigger = useRef<HTMLElement>()
  const showDetail = (request: DetailRequest) => { if (!detailRequest) trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined; setDetailRequest(request); setOpen(true) }
  const closeDetail = () => { setDetailRequest(undefined); setOpen(false); requestAnimationFrame(() => trigger.current?.isConnected && trigger.current.focus({ preventScroll: true })) }
  useEffect(() => { setDetailRequest(undefined); setOpen(false) }, [planId, selectedUnitId, active])
  useEffect(() => { if (tab === 'prepare') setDetailRequest(undefined) }, [tab])
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
  const checkLabel = promptTasks.some(task => task.kind === 'directing_review' && ['queued', 'running'].includes(task.status)) ? '检查中' : selectedReview ? reviewCanExecute(selectedReview, promptId) ? '可开始试拍' : '检查需处理' : waitingChecks.length ? '待确认结论' : records.prompt ? '待检查' : '待生成指令'
  const inspector = <div className="production-inspector-content" ref={inspectorScrolling}><div hidden={tab !== 'prepare'}><h2>单元参数与检查</h2><div ref={setParameters} /></div><div ref={setDetailTarget} hidden={tab === 'prepare'} /></div>
  const matchesUnit = (unit: NonNullable<ProductionPlan_Input['units']>[number]) => navigationMatches(query, `单元 ${String(plan!.units.indexOf(unit) + 1).padStart(2, '0')}`, ...unit.coverage.map(row => row.action_scope))
  const shownUnits = plan?.units.filter(matchesUnit) || []
  const detailVisible = tab === 'prepare' || !!detailRequest
  const focusProblem = () => { setTab('prompt'); requestAnimationFrame(() => { const row = document.querySelector<HTMLDetailsElement>('.production-center [data-review-problem]'); if (row) { row.open = true; row.scrollIntoView({ block: 'nearest' }); row.focus({ preventScroll: true }) } }) }
  const problemAction = reviewNeedsAttention && ['result', 'review'].includes(guidance.target)
  const primary = primaryAction && (guidance.target !== 'shoot-confirm' || tab === 'review') ? primaryAction : undefined
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
      {!start && <WorkbenchObjectBar className="production-next-step"><div className="production-object-heading"><h2><Popover trigger="click" title="本次动作范围" content={<div className="production-action-description">{selectedUnit?.coverage.map(row => row.action_scope).join('；') || '动作范围待填写'}</div>}><button type="button" className="production-action-title" aria-label="查看完整动作范围">{selectedUnit ? `单元 ${String(plan!.units.indexOf(selectedUnit) + 1).padStart(2, '0')}` : '选择拍摄单元'} · {selectedUnit?.coverage.map(row => row.action_scope).join('；') || '选择本次要拍的动作'}</button></Popover></h2><span role="status">{unitProgress[selectedUnitId || ''] || checkLabel}</span>{shownUnit && <p className="shoot-unit-meta">{shownUnit.coverage.length} 个镜头范围 · {shownUnit.duration_ms / 1000} 秒 · {shownUnit.ratio}</p>}</div><Button type="primary" disabled={primary?.disabled} loading={busy} data-workspace-target={guidance.target} onClick={() => problemAction ? focusProblem() : primary ? primary.run() : onNext(guidance)}>{problemAction ? '处理首个问题' : primary?.label || guidance.label}</Button></WorkbenchObjectBar>}
      {start || <><div className="production-local-tabs" role="tablist" aria-label="单元工作区" onKeyDown={event => {
        const keys = ['prepare', 'prompt', 'review', 'takes']
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (keys.indexOf(tab) + (event.key === 'ArrowRight' ? 1 : 3)) % 4
        setTab(keys[index]); (event.currentTarget.children[index] as HTMLElement).focus()
      }}>{[['prepare', '拍摄准备'], ['prompt', '指令检查'], ['review', '执行试拍'], ['takes', '候选素材']].map(([key, label]) => <button type="button" role="tab" id={`${tabsId}-${key}`} aria-controls={`${tabsId}-content`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} key={key} onClick={() => setTab(key)}>{label}{key === 'takes' && <small aria-hidden="true">{records.takes.length}</small>}</button>)}</div><div className="production-content" id={`${tabsId}-content`} role="tabpanel" aria-labelledby={`${tabsId}-${tab}`}>
        <div hidden={tab !== 'prepare'}>{preparation}</div>
        <div hidden={tab === 'prepare'}>{prompt}</div>
        {tab === 'prompt' && <><ShootTaskProgress tasks={promptTasks} state={tasksState} kind="review" />{review || (records.prompt ? <p className="design-secondary">{checkLabel} · 检查这份指令，确认它与固定设计、动作和参考一致。</p> : <Empty description={planReady ? '准备生成或选择本单元的指令' : '先确认本次拍摄准备'} />)}</>}
        {tab === 'review' && <><ShootTaskProgress tasks={promptTasks} state={tasksState} kind="video" />{execution || <Empty description="先确认检查结论，再核对本次输入并开始试拍" />}</>}
        {tab === 'takes' && (candidates || <Empty description="本单元还没有候选视频" />)}
      </div></>}
      </section>{!start && <WorkbenchInspector className="production-inspector" visible={detailVisible} title={tab === 'prepare' ? '单元参数与检查' : undefined} closable={tab === 'prepare'} open={open} onClose={closeDetail} width={tab === 'prepare' ? 344 : 440}>{inspector}</WorkbenchInspector>}</div>
    {!desktop && !start && tab === 'prepare' && <Button className="design-detail-trigger" onClick={() => setOpen(true)}>参数与检查</Button>}
    <Drawer title="拆分或重组生产计划" width={640} open={advancedOpen} onClose={() => setAdvancedOpen(false)}>{advanced || <p>请先保存并确认生产计划。</p>}</Drawer>
  </div></InspectorContext.Provider></ProductionDetailContext.Provider>
}
