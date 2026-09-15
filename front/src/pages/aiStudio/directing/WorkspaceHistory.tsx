import { Alert, Card, Drawer, Space, Tag, Typography } from 'antd'
import type { SequenceCut_Input, WorkspaceRead } from '../../../services/generated'
import { cutStatus, revisionName, revisionReferences } from './workspaceUsage'
import type { ActiveCutState } from './workspaceUsage'

/** 只读片段清单：逐项呈现实际源区间，预演单独标明预计时长。 */
export function CutItems({ cut, workspace }: { cut: SequenceCut_Input; workspace: WorkspaceRead }) {
  return <Space direction="vertical" className="w-full">
    {!cut.items.length && <Typography.Text type="secondary">没有剪辑项</Typography.Text>}
    {cut.items.map((item, index) => <div key={item.id}>
      {'media_range' in item ? <>片段 {index + 1} · {revisionName(workspace.takes, item.take_id, 'Take')} · 源区间 {(item.media_range.source_in_ms / 1000).toFixed(3)}–{(item.media_range.source_out_ms / 1000).toFixed(3)} 秒</>
        : <>片段 {index + 1} · <Tag>预演</Tag>{revisionName(workspace.designs, item.design_revision_id, '设计')} / {item.shot_id} · 预计 {item.estimated_duration_ms / 1000} 秒</>}
    </div>)}
  </Space>
}

export function ActiveCutSummary({ active, workspace }: { active: ActiveCutState; workspace: WorkspaceRead }) {
  if (active.status !== 'ready') return <Alert type={active.status === 'error' ? 'warning' : 'info'} message={active.status === 'error' ? '采用状态暂不可用，请刷新状态重试。' : '正在核对当前采用…'} />
  return <Card size="small" title={active.cut ? `当前采用：${revisionName(workspace.cuts, active.cut.id, '剪辑')} · 已确认` : '当前采用'}>
    {active.cut ? <>
      <Typography.Text>真实素材 {active.cut.content.items.filter(item => 'media_range' in item).length} 项 · 预演 {active.cut.content.items.filter(item => 'design_revision_id' in item).length} 项</Typography.Text>
      <details><summary>查看采用区间与预演</summary><CutItems cut={active.cut.content} workspace={workspace} /></details>
    </> : <Typography.Text>尚未确认采用剪辑；候选素材和草稿不代表当前采用。</Typography.Text>}
  </Card>
}

/** 历史浏览仅呈现快照和真实引用，不切换编辑基线、不调用任何写入接口。 */
export function WorkspaceHistory({ open, onClose, workspace, active }: { open: boolean; onClose: () => void; workspace: WorkspaceRead; active: ActiveCutState }) {
  return <Drawer title="版本与历史（只读）" open={open} onClose={onClose} width={640}>
    <Space direction="vertical" className="w-full" size="large">
      <ActiveCutSummary active={active} workspace={workspace} />
      <Card size="small" title="设计版本">
        {workspace.designs.map(row => <details key={row.id}><summary>{revisionName(workspace.designs, row.id, '设计')} · {row.confirmed_at ? '已确认' : '草稿'} · 修订 {row.version}</summary>
          <p>{row.content.direction.information_change.text || '本场信息变化未填写'}</p>
          <p>引用关系：{revisionReferences(workspace, active, 'design', row.id).join('；') || '暂无计划或预演引用'}</p>
          {row.parent_id && <p>派生自：{revisionName(workspace.designs, row.parent_id, '设计')}</p>}
        </details>)}
        {!workspace.designs.length && <Typography.Text type="secondary">暂无设计版本</Typography.Text>}
      </Card>
      <Card size="small" title="生产计划版本">
        {workspace.plans.map(row => <details key={row.id}><summary>{revisionName(workspace.plans, row.id, '计划')} · {row.confirmed_at ? '已确认' : '草稿'}</summary>
          <p>固定依据：{revisionName(workspace.designs, row.content.design_revision_id, '设计')}</p>
          <p>引用关系：{revisionReferences(workspace, active, 'plan', row.id).join('；') || '暂无提示词或素材引用'}</p>
          {row.content.units.map(unit => <p key={unit.id}>{unit.id} · {unit.coverage.map(item => item.action_scope).join('；')}</p>)}
        </details>)}
        {!workspace.plans.length && <Typography.Text type="secondary">暂无生产计划</Typography.Text>}
      </Card>
      <Card size="small" title="剪辑版本与曾采用区间">
        {workspace.cuts.map(row => <details key={row.id}><summary>{revisionName(workspace.cuts, row.id, '剪辑')} · {cutStatus(row, active)}</summary><CutItems cut={row.content} workspace={workspace} /></details>)}
        {!workspace.cuts.length && <Typography.Text type="secondary">暂无剪辑版本</Typography.Text>}
      </Card>
    </Space>
  </Drawer>
}
