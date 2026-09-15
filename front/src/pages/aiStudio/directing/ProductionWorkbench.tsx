import { useWorkbenchDesktop } from './useWorkbenchDesktop'
import { createContext, useContext, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { Alert, Button, Drawer, Empty, Input, Tabs } from 'antd'
import type { DirectingTaskRead, ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import { tasksForUnit } from './workspaceTaskContext'
import type { SubmittedWorkspaceTask } from './workspaceGuidance'
import { SequenceNavigation } from './SequenceLayout'

const InspectorContext = createContext<HTMLElement | null>(null)
export function ProductionParameters({ children }: { children: ReactNode }) {
  const target = useContext(InspectorContext)
  return target ? createPortal(children, target) : null
}

/** 版本控制、单元导航、工作内容和参数检查固定分区，切页不卸载编辑器。 */
export function ProductionWorkbench({ active, focusRequest, tasks, submitted, tasksState, onOpenTasks, plan, planId, workspace, selectedUnitId, onSelectUnit, toolbar, preparation, prompt, review, candidates, fixedInput, advanced }: {
  tasks: DirectingTaskRead[]; submitted: SubmittedWorkspaceTask[]; tasksState: 'loading' | 'ready' | 'error'; onOpenTasks: () => void;
  active: boolean; focusRequest: string | null; plan?: ProductionPlan_Input; planId?: string; workspace: WorkspaceRead; selectedUnitId?: string; onSelectUnit: (id: string) => void;
  toolbar: ReactNode; preparation: ReactNode; prompt: ReactNode; review: ReactNode; candidates: ReactNode; fixedInput: ReactNode; advanced: ReactNode;
}) {
  const [search] = useSearchParams()
  const focus = search.get('focus')
  const [tab, setTab] = useState(() => ['review', 'shoot-confirm'].includes(focus || '') ? 'review' : ['compile', 'prompt-review'].includes(focus || '') || search.get('prompt') ? 'prompt' : 'prepare')
  useEffect(() => { if (!focusRequest) return; if (['review', 'shoot-confirm'].includes(focus || '')) setTab('review'); else if (['compile', 'prompt-review'].includes(focus || '')) setTab('prompt'); else if (focus?.startsWith('unit:') || ['plan-version', 'plan-editor', 'unit-select'].includes(focus || '')) setTab('prepare') }, [focus, focusRequest])
  const [query, setQuery] = useState('')
  const [parameters, setParameters] = useState<HTMLDivElement | null>(null)
  const [open, setOpen] = useState(false)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const previousPlan = useRef(planId)
  useEffect(() => { if (previousPlan.current !== planId && advancedOpen) { setAdvancedOpen(false); setTab('prepare') } previousPlan.current = planId }, [planId, advancedOpen])
  useEffect(() => { if (!active) { setOpen(false); setAdvancedOpen(false) } }, [active])
  const desktop = useWorkbenchDesktop()
  const selectedTasks = tasksForUnit(workspace, tasks, submitted, planId, selectedUnitId)
  const statusSummary = (rows: DirectingTaskRead[]) => (['queued', 'running', 'failed'] as const).flatMap(status => {
    const count = rows.filter(task => task.status === status).length
    return count ? [`${{ queued: '排队', running: '执行中', failed: '失败' }[status]} ${count}`] : []
  }).join(' · ')
  const taskSummary = statusSummary(selectedTasks)

  const inspector = <div className="production-inspector-content"><h2>{tab === 'prepare' ? '单元参数与检查' : '本次固定输入'}</h2><div ref={setParameters} style={{ display: tab === 'prepare' ? undefined : 'none' }} />{tab !== 'prepare' && (fixedInput || <Empty description="选择已编译的指令，查看其冻结输入" />)}</div>
  return <InspectorContext.Provider value={parameters}><div className="sequence-stage-workspace production-workbench">
    {active && <SequenceNavigation><div className="design-navigation"><h2>拍摄单元</h2><Input.Search aria-label="搜索拍摄单元" placeholder="搜索动作范围" value={query} onChange={event => setQuery(event.target.value)} /><div className="production-unit-list">{plan?.units.filter(unit => unit.coverage.map(c => c.action_scope).join(' ').includes(query)).map(unit => {
      const takes = workspace.takes.filter(take => take.plan_revision_id === planId && take.unit_id === unit.id)
      const prompts = workspace.prompts.filter(row => row.content.plan_revision_id === planId && row.content.unit_id === unit.id)
      return <button key={unit.id} aria-pressed={unit.id === selectedUnitId} onClick={() => onSelectUnit(unit.id)}><strong>单元 {String(plan.units.indexOf(unit)+1).padStart(2,'0')}</strong><span>{unit.coverage.map(c => c.action_scope).join('；') || '动作范围待填写'}</span><small>{prompts.length ? '已有指令' : '待编译'} · {takes.length} 个候选</small>{statusSummary(tasksForUnit(workspace, tasks, submitted, planId, unit.id)) && <small>{statusSummary(tasksForUnit(workspace, tasks, submitted, planId, unit.id))}</small>}</button>
    })}{!plan?.units.length && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无拍摄单元" />}</div><Button onClick={() => setAdvancedOpen(true)}>拆分与重组</Button></div></SequenceNavigation>}
    <div className="sequence-version-bar production-version-bar">{toolbar}</div>
    <div className="production-panels"><section className="production-center">
      {tasksState !== 'ready' ? <Alert type={tasksState === 'error' ? 'warning' : 'info'} message={tasksState === 'error' ? '任务状态暂不可用，请核对后再执行' : '正在核对任务状态'} /> : taskSummary && <div className="production-task-summary" role="status" data-unit-task-summary><strong>本单元 · {taskSummary}</strong><Button size="small" onClick={onOpenTasks}>查看任务记录</Button>{selectedTasks.filter(task => task.status === 'failed' && task.error).slice(-1).map(task => <p key={task.task_id}>{task.error}</p>)}</div>}
      <Tabs activeKey={tab} onChange={setTab} items={[
      { key: 'prepare', label: '动作与参考', forceRender: true, children: preparation },
      { key: 'prompt', label: '生成指令', children: prompt || <Empty description="确认本次单元与参考后，准备生成指令" /> },
      { key: 'review', label: '审稿与执行', children: review || <Empty description="先检查生成指令，等待审稿结果" /> },
      { key: 'takes', label: '候选素材', children: candidates || <Empty description="本单元还没有候选视频" /> },
    ]} /></section>{desktop ? <aside className="production-inspector">{inspector}</aside> : <Drawer title="单元参数与检查" open={open} onClose={() => setOpen(false)} width={344} forceRender>{inspector}</Drawer>}</div>
    {!desktop && <Button className="design-detail-trigger" onClick={() => setOpen(true)}>参数与检查</Button>}
    <Drawer title="拆分或重组生产计划" width={640} open={advancedOpen} onClose={() => setAdvancedOpen(false)}>{advanced || <p>请先保存并确认生产计划。</p>}</Drawer>
  </div></InspectorContext.Provider>
}
