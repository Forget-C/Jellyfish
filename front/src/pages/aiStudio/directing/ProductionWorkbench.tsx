import { readWorkspaceContext, saveWorkspaceContext } from './workspaceContext'
import { useWorkspaceScroll } from './useWorkspaceScroll'
import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Alert, Button, Drawer, Empty, Input, Tabs } from 'antd'
import type { DirectingTaskRead, ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import { productionRecords } from './workspaceProduction'
import { pendingReviewResults, reviewCanExecute } from './workspaceGuidance'
import type { WorkspaceGuidance } from './workspaceGuidance'
import { tasksForUnit, taskWorkspaceContext, unitTaskSummary } from './workspaceTaskContext'
import type { SubmittedWorkspaceTask } from './workspaceGuidance'
import { SequenceNavigation } from './SequenceLayout'
import { ShootTaskProgress } from './ShootTaskProgress'

const InspectorContext = createContext<HTMLElement | null>(null)
export function ProductionParameters({ children }: { children: ReactNode }) {
  const target = useContext(InspectorContext)
  return target ? createPortal(children, target) : null
}

/** 版本控制、单元导航、工作内容和参数检查固定分区，切页不卸载编辑器。 */
export function ProductionWorkbench({ unitProgress, primaryAction, busy, guidance, onNext, planReady, promptId, reviewId, active, focusRequest, tasks, submitted, tasksState, onOpenTasks, plan, planId, workspace, selectedUnitId, onSelectUnit, toolbar, start, preparation, prompt, review, execution, candidates, fixedInput, advanced }: {
  unitProgress: Record<string, string>;
  primaryAction?: { label: string; run: () => void; disabled?: boolean }; busy: boolean;
  guidance: WorkspaceGuidance; onNext: (next: WorkspaceGuidance) => void; planReady: boolean; promptId?: string; reviewId?: string;
  tasks: DirectingTaskRead[]; submitted: SubmittedWorkspaceTask[]; tasksState: 'loading' | 'ready' | 'error'; onOpenTasks: () => void;
  active: boolean; focusRequest: string | null; plan?: ProductionPlan_Input; planId?: string; workspace: WorkspaceRead; selectedUnitId?: string; onSelectUnit: (id: string) => void;
  start?: ReactNode; toolbar: ReactNode; preparation: ReactNode; prompt: ReactNode; review: ReactNode; execution: ReactNode; candidates: ReactNode; fixedInput: ReactNode; advanced: ReactNode;
}) {
  const [search] = useSearchParams()
  const focus = search.get('focus')
  const [context] = useState(() => readWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id))
  const [tab, setTab] = useState(() => focus === 'shoot-confirm' ? 'review' : ['compile', 'prompt-review', 'review'].includes(focus || '') ? 'prompt' : context.shootIdentity === JSON.stringify([planId, selectedUnitId]) && ['prepare', 'prompt', 'review', 'takes'].includes(context.shootTab || '') ? context.shootTab! : search.get('prompt') ? 'prompt' : 'prepare')
  useEffect(() => { if (!focusRequest) return; if (focus === 'shoot-confirm') setTab('review'); else if (['compile', 'prompt-review', 'review'].includes(focus || '')) setTab('prompt'); else if (focus?.startsWith('unit-model:')) { setTab('prepare'); setOpen(true) } else if (focus?.startsWith('unit:') || ['plan-version', 'plan-editor', 'unit-select'].includes(focus || '')) setTab('prepare') }, [focus, focusRequest])
  const [query, setQuery] = useState(context.shootQuery || '')
  useEffect(() => { saveWorkspaceContext(workspace.sequence.project_id, workspace.sequence.id, { shootTab: tab, shootQuery: query, shootIdentity: JSON.stringify([planId, selectedUnitId]) }) }, [workspace.sequence.project_id, workspace.sequence.id, planId, selectedUnitId, tab, query])
  const scrolling = useWorkspaceScroll(workspace.sequence.project_id, workspace.sequence.id, 'shootScroll', JSON.stringify([planId, selectedUnitId, tab]), '.ant-tabs-content-holder')
  const inspectorScrolling = useWorkspaceScroll(workspace.sequence.project_id, workspace.sequence.id, 'shootInspectorScroll', JSON.stringify([planId, selectedUnitId, tab]))
  const [parameters, setParameters] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
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
  const checkLabel = promptTasks.some(task => task.kind === 'directing_review' && ['queued', 'running'].includes(task.status)) ? '检查中' : selectedReview ? '结论已保存' : waitingChecks.length > 1 ? '待选择检查' : waitingChecks.length ? '待确认结论' : records.prompt ? '待检查' : records.prompts.length ? '待选择' : '待生成'
  const stepLabel = (title: string, status: string) => <span className="production-step-label">{title}<small aria-hidden="true">{status}</small></span>

  const inspector = <div className="production-inspector-content" ref={inspectorScrolling}><h2>{tab === 'prepare' ? '单元参数与检查' : '本次固定输入'}</h2><div ref={setParameters} style={{ display: tab === 'prepare' ? undefined : 'none' }} />{tab !== 'prepare' && (fixedInput || <Empty description="选择已编译的指令，查看其冻结输入" />)}</div>
  return <InspectorContext.Provider value={parameters}><div className="sequence-stage-workspace production-workbench">
    {active && <SequenceNavigation><div className="design-navigation"><h2>拍摄单元</h2>{!start && <Input.Search aria-label="搜索拍摄单元" placeholder="搜索动作范围" value={query} onChange={event => setQuery(event.target.value)} />}<div className="production-unit-list">{plan?.units.filter(unit => unit.coverage.map(c => c.action_scope).join(' ').includes(query)).map(unit => {
      const takes = workspace.takes.filter(take => take.plan_revision_id === planId && take.unit_id === unit.id)
      const runningSummary = unitTaskSummary(tasksForUnit(workspace, tasks, submitted, planId, unit.id).filter(task => ['queued', 'running'].includes(task.status)))
      return <button key={unit.id} aria-pressed={unit.id === selectedUnitId} onClick={() => onSelectUnit(unit.id)}><strong>单元 {String(plan.units.indexOf(unit)+1).padStart(2,'0')}</strong><span>{unit.coverage.map(c => c.action_scope).join('；') || '动作范围待填写'}</span><small>{unitProgress[unit.id]} · {takes.length} 个候选</small>{runningSummary && <small>{runningSummary}</small>}</button>
    })}{!plan?.units.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无拍摄单元" />}</div>{!start && <><Button type="text" onClick={onOpenTasks}>本场任务记录 · {new Set([...workspace.task_ids, ...submitted.map(item => item.taskId)]).size}</Button><Button onClick={() => setAdvancedOpen(true)}>拆分与重组</Button></>}</div></SequenceNavigation>}
    {!start && <div className="sequence-version-bar production-version-bar">{toolbar}</div>}
    <div className={`production-panels${start ? ' is-starting' : ''}`}><section className="production-center" ref={scrolling}>
      {query && plan?.units.some(unit => unit.id === selectedUnitId && !unit.coverage.map(row => row.action_scope).join(' ').includes(query)) && <Alert type="info" message="所选单元不在筛选结果中" action={<Button onClick={() => setQuery('')}>清除筛选</Button>} />}
      {tasksState !== 'ready' && <Alert type={tasksState === 'error' ? 'warning' : 'info'} message={tasksState === 'error' ? '任务状态暂不可用，请核对后再执行' : '正在核对任务状态'} />}
      {!start && <div className="production-next-step" role="status"><span><h2>{selectedUnit ? `单元 ${String(plan!.units.indexOf(selectedUnit) + 1).padStart(2, '0')}` : '选择拍摄单元'} · {selectedUnit?.coverage.map(row => row.action_scope).join('；') || '选择本次要拍的动作'}</h2>{shownUnit && <p className="shoot-unit-meta">{shownUnit.coverage.length} 个镜头范围 · {shownUnit.duration_ms / 1000} 秒 · {shownUnit.ratio}</p>}<strong>{guidance.title}</strong><small>{guidance.description}</small></span><Button type="primary" disabled={primaryAction?.disabled} loading={busy} data-workspace-target={guidance.target} onClick={() => primaryAction && (guidance.target !== 'shoot-confirm' || tab === 'review') ? primaryAction.run() : onNext(guidance)}>{primaryAction && (guidance.target !== 'shoot-confirm' || tab === 'review') ? primaryAction.label : guidance.label}</Button></div>}
      {start || <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'prepare', label: stepLabel('拍摄准备', planReady ? '已确认' : '待确认'), forceRender: true, children: preparation },
      { key: 'prompt', label: stepLabel('指令与检查', checkLabel), children: <>{!review && <ShootTaskProgress tasks={promptTasks} state={tasksState} kind="review" />}{prompt ? <>{review}{prompt}</> : <Empty description="确认本次单元与参考后，准备生成指令" />}{review && <ShootTaskProgress tasks={promptTasks} state={tasksState} kind="review" />}</> },
      { key: 'review', label: stepLabel('执行试拍', promptTasks.some(task => task.kind === 'video_generation' && ['queued', 'running'].includes(task.status)) ? '视频生成中' : !planReady ? '待确认准备' : reviewCanExecute(selectedReview, promptId) ? '待开拍' : waitingChecks.length ? '待确认结论' : records.reviews.length ? '待核对' : '待检查'), children: <><ShootTaskProgress tasks={promptTasks} state={tasksState} kind="video" />{execution || <Empty description="先确认检查结论，再核对本次输入并开始试拍" />}</> },
      { key: 'takes', label: stepLabel('候选素材', `${records.takes.length} 个候选`), children: candidates || <Empty description="本单元还没有候选视频" /> },
    ]} />}</section>{!start && (desktop ? <aside className="production-inspector">{inspector}</aside> : <Drawer title="单元参数与检查" open={open} onClose={() => setOpen(false)} width={344} forceRender>{inspector}</Drawer>)}</div>
    {!desktop && !start && <Button className="design-detail-trigger" onClick={() => setOpen(true)}>参数与检查</Button>}
    <Drawer title="拆分或重组生产计划" width={640} open={advancedOpen} onClose={() => setAdvancedOpen(false)}>{advanced || <p>请先保存并确认生产计划。</p>}</Drawer>
  </div></InspectorContext.Provider>
}
