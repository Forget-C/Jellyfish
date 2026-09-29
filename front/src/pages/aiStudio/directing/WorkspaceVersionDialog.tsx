import { useEffect, useState } from 'react'
import { Alert, Card, Modal, Select, Space, Tabs, Typography } from 'antd'
import type { PlannedCutItem, WorkspaceRead } from '../../../services/generated'
import { WorkspaceHistory } from './WorkspaceHistory'
import { revisionName, type ActiveCutState } from './workspaceUsage'
import { selectWorkspaceVersion, workspaceVersionErrors, type WorkspaceVersionsSelection } from './workspaceVersions'

/** 弹窗只维护待选值；明确应用才经过页面草稿保护并切换编辑上下文。 */
export function WorkspaceVersionDialog({ open, onClose, workspace, active, selection, onApply }: {
  open: boolean; onClose: () => void; workspace: WorkspaceRead; active: ActiveCutState;
  selection: WorkspaceVersionsSelection; onApply: (next: WorkspaceVersionsSelection) => void
}) {
  const [pending, setPending] = useState(selection)
  const [tab, setTab] = useState('selection')
  useEffect(() => { if (open) { setPending(selection); setTab('selection') } }, [open])
  const errors = workspaceVersionErrors(workspace, pending)
  const update = (kind: keyof WorkspaceVersionsSelection, id?: string) => setPending(current => selectWorkspaceVersion(workspace, current, kind, id || null))
  const plans = workspace.plans.filter(row => row.content.design_revision_id === pending.design)
  const design = workspace.designs.find(row => row.id === pending.design)
  const plan = workspace.plans.find(row => row.id === pending.plan)
  const cut = workspace.cuts.find(row => row.id === pending.cut)
  const previews = cut?.content.items.filter((item): item is PlannedCutItem => !('take_id' in item)) || []
  const sources = cut ? [...new Set(cut.content.items.flatMap(item => {
    if ('take_id' in item) {
      const take = workspace.takes.find(row => row.id === item.take_id)
      return [take ? revisionName(workspace.plans, take.plan_revision_id, '计划') : '素材来源不可用']
    }
    return [`预演 · ${revisionName(workspace.designs, item.design_revision_id, '设计')}`]
  }))] : []
  const createdTime = (value?: string | null) => value && !Number.isNaN(Date.parse(value)) ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '未提供'
  const options = (rows: Array<{ id: string; confirmed_at: string | null }>, all: typeof rows, name: string) => rows.map(row => ({ value: row.id, label: `${revisionName(all, row.id, name)} · ${row.confirmed_at ? '已确认' : '草稿'}` }))
  return <Modal className="workspace-version-dialog" title="版本与依据" open={open} onCancel={onClose} width={960} style={{ maxWidth: 'calc(100vw - 24px)' }}
    okText="切换工作上下文" cancelText="取消" onOk={() => onApply(pending)} okButtonProps={{ disabled: errors.length > 0 || tab !== 'selection' }}>
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'selection', label: '切换版本' }, { key: 'history', label: '查看与比较' }]} />
    {tab === 'history' ? <WorkspaceHistory embedded open={open} onClose={onClose} workspace={workspace} active={active} /> : <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Typography.Text type="secondary">选择的是正在查看或编辑的版本；不会确认版本或改变当前采用。</Typography.Text>
      {errors.map(error => <Alert key={error} type="warning" message={error} />)}
      <Card size="small" title="设计 → 关联计划">
        <Space direction="vertical" style={{ width: '100%' }}>
          <Select aria-label="选择设计版本" allowClear placeholder="尚无设计" value={pending.design || undefined} style={{ width: '100%' }}
            options={options(workspace.designs, workspace.designs, '设计')} onChange={id => update('design', id)} />
          {design && <Typography.Text type="secondary">设计创建时间：{createdTime(design.created_at)}</Typography.Text>}
          {design?.parent_id && <Typography.Text type="secondary">设计派生自：{revisionName(workspace.designs, design.parent_id, '设计')}</Typography.Text>}
          <Select aria-label="选择生产计划版本" allowClear placeholder="此设计尚未选择计划" value={pending.plan || undefined} style={{ width: '100%' }}
            options={options(plans, workspace.plans, '计划')} onChange={id => update('plan', id)} />
          {plan && <Typography.Text type="secondary">计划创建时间：{createdTime(plan.created_at)}</Typography.Text>}
          {plan?.parent_id && <Typography.Text type="secondary">计划派生自：{revisionName(workspace.plans, plan.parent_id, '计划')}</Typography.Text>}
          <Select aria-label="从所有计划定位依据" placeholder="按历史计划查找固定设计" value={undefined} style={{ width: '100%' }}
            options={options(workspace.plans, workspace.plans, '计划')} onChange={id => update('plan', id)} />
        </Space>
      </Card>
      <Card size="small" title="独立剪辑">
        <Select aria-label="选择剪辑版本" allowClear placeholder="新剪辑草稿" value={pending.cut || undefined} style={{ width: '100%' }}
          options={options(workspace.cuts, workspace.cuts, '剪辑')} onChange={id => update('cut', id)} />
        <p>实际来源：{sources.join('、') || '尚无片段'}</p>
        {!!previews.length && <p>预演预计共 {previews.reduce((total, item) => total + item.estimated_duration_ms, 0) / 1000} 秒，不能代表真实素材覆盖。</p>}
        {cut && <p>剪辑创建时间：{createdTime(cut.created_at)}</p>}
        {cut?.parent_id && <p>剪辑派生自：{revisionName(workspace.cuts, cut.parent_id, '剪辑')}</p>}
        <Typography.Text type="secondary">当前采用：{active.status !== 'ready' ? '待核对' : active.cut ? revisionName(workspace.cuts, active.cut.id, '剪辑') : '尚未采用'}</Typography.Text>
      </Card>
    </Space>}
  </Modal>
}
