import { Alert, Button, Checkbox, Empty, Select } from 'antd'
import type { ProductionPlan_Input, WorkspaceRead } from '../../../services/generated'
import { revisionName } from './workspaceUsage'
import { useWorkspacePreparation } from './useWorkspacePreparation'

/** 进入阶段只读；用户明确选定设计和镜头后才建立未保存的试拍草稿。 */
export function ShootPreparation({ workspace, designId, currentPlanId, unavailablePlanId, onDesign, onPlan, onCreate, onBack, onRetry }: {
  workspace: WorkspaceRead; designId?: string; currentPlanId?: string; unavailablePlanId?: string; onDesign: (id: string) => void;
  onPlan: (id: string) => void; onCreate: (plan: ProductionPlan_Input) => void;
  onBack: () => void; onRetry: () => void;
}) {
  const design = workspace.designs.find(row => row.id === designId)
  const confirmed = workspace.designs.filter(row => row.confirmed_at)
  const plans = workspace.plans.filter(row => !!designId && row.content.design_revision_id === designId && row.id !== currentPlanId)
  const selection = useWorkspacePreparation('试拍镜头选择', `${workspace.sequence.project_id}:${workspace.sequence.id}:shoot-start:${designId || 'none'}`, { shots: [] as string[] })
  const shots = design?.content.direction.shots.filter(shot => selection.value.shots.includes(shot.id)) || []
  return <section className="shoot-preparation" aria-label="试拍准备起点" data-workspace-target="plan-version" tabIndex={-1}>
    <h2>{design?.confirmed_at ? `基于${revisionName(workspace.designs, design.id, '设计')}准备试拍` : '先选择已确认的导演设计'}</h2>
    {unavailablePlanId && <Alert type="warning" message="所选生产计划不可用，未自动改用其他版本" description="请重试读取，或明确选择下方的已有计划、设计依据。" action={<Button onClick={onRetry}>重试读取计划</Button>} />}
    {selection.error && <Alert type="warning" message={selection.error} />}
    {designId && !design ? <Alert type="warning" message="当前设计依据不可用，不能用其他版本代替" action={<Button onClick={onRetry}>重试读取设计</Button>} /> : !design?.confirmed_at && <p>当前设计尚未确认。可以返回导演设计，或明确选择其他已确认版本。</p>}
    {!!confirmed.length && <Select aria-label="试拍设计依据" placeholder="选择已确认设计" value={design?.confirmed_at ? design.id : undefined} options={confirmed.map(row => ({ value: row.id, label: revisionName(workspace.designs, row.id, '设计') }))} onChange={onDesign} />}
    {!design?.confirmed_at ? <Button onClick={onBack}>返回导演设计</Button> : <>
      {!!plans.length && <div className="shoot-existing-plans"><h3>已有试拍计划</h3>{plans.map(row => <Button block key={row.id} onClick={() => onPlan(row.id)}>继续{revisionName(workspace.plans, row.id, '计划')} · {row.confirmed_at ? '已确认' : '草稿'} · {row.content.units.length} 个单元</Button>)}</div>}
      {workspace.plans.some(row => row.content.design_revision_id !== design.id) && <p className="design-secondary">其他设计版本已有计划；这里只列出与当前设计版本匹配的计划。</p>}
      <h3>{plans.length ? '或建立新的试拍草稿' : '选择本次要试拍的镜头'}</h3>
      <p>一镜一个单元。同一镜头可试拍多次，单元内可进一步调整动作范围或组合镜头。</p>
      <div className="shoot-shot-selection">{design.content.direction.shots.map((shot, index) => <Checkbox key={shot.id} checked={selection.value.shots.includes(shot.id)} onChange={event => selection.update({ shots: event.target.checked ? [...selection.value.shots, shot.id] : selection.value.shots.filter(id => id !== shot.id) })}>
        <strong>镜头 {index + 1}</strong><span>{shot.visible_result.text || '动作待明确'}</span><small>预计 {(shot.estimated_duration_ms || 0) / 1000} 秒</small>
      </Checkbox>)}</div>
      {!design.content.direction.shots.length && <Empty description="此设计尚无镜头，请返回导演设计补充" />}
      <p className="design-secondary">建立草稿不会开始生成。模型、实际生成时长与参考素材将在下一步核对。</p>
      <Button type="primary" disabled={!shots.length} onClick={() => onCreate({ design_revision_id: design.id, units: shots.map(shot => ({
        id: `unit-${crypto.randomUUID()}`, coverage: [{ id: `coverage-${crypto.randomUUID()}`, shot_id: shot.id, beat_ids: [...shot.beat_ids], event_ids: [...shot.event_ids], action_scope: shot.visible_result.text || '请描述本次要拍的动作范围' }],
        model_id: '', duration_ms: 5000, ratio: '16:9', references: [], capability: { multi_shot: 'unknown' },
      })) })}>建立试拍草稿 · {shots.length} 个单元</Button>
    </>}
  </section>
}
