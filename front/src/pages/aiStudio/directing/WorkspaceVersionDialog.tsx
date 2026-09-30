import { Alert, Button, Modal } from 'antd'
import type { WorkspaceRead } from '../../../services/generated'
import { ActiveCutSummary, WorkspaceHistory } from './WorkspaceHistory'
import { revisionName, type ActiveCutState } from './workspaceUsage'
import { workspaceVersionErrors, type WorkspaceVersionKind, type WorkspaceVersionsSelection } from './workspaceVersions'

/** 弹窗中的浏览独立于编辑上下文；明确编辑才由页面保护草稿并应用目标版本。 */
export function WorkspaceVersionDialog({ open, onClose, workspace, active, selection, initialKind, onApply }: {
  open: boolean; onClose: () => void; workspace: WorkspaceRead; active: ActiveCutState;
  selection: WorkspaceVersionsSelection; initialKind: WorkspaceVersionKind; onApply: (next: WorkspaceVersionsSelection, kind: WorkspaceVersionKind) => void
}) {
  const errors = workspaceVersionErrors(workspace, selection)
  const plan = workspace.plans.find(row => row.id === selection.plan)
  return <Modal className="workspace-version-dialog" title="版本与依据" open={open} onCancel={onClose} destroyOnClose width={1040} style={{ maxWidth: 'calc(100vw - 24px)' }} footer={<Button onClick={onClose}>关闭</Button>}>
    {open && <>
    <div className="workspace-version-context">
      <p>编辑上下文：{selection.design ? revisionName(workspace.designs, selection.design, '设计') : '尚无设计'} ｜ {selection.plan ? revisionName(workspace.plans, selection.plan, '计划') : '尚无计划'} ｜ {selection.cut ? revisionName(workspace.cuts, selection.cut, '剪辑') : '新剪辑草稿'}</p>
      {plan && <p>计划固定依据：{revisionName(workspace.designs, plan.content.design_revision_id, '设计')}。进入其他设计编辑时，不匹配的计划选择将清空，原计划保留。</p>}
      {errors.map(error => <Alert key={error} type="warning" message={error} />)}
      <details><summary>{active.status !== 'ready' ? '当前采用待核对' : active.cut ? `当前采用：${revisionName(workspace.cuts, active.cut.id, '剪辑')}` : '尚未采用剪辑'}</summary><ActiveCutSummary active={active} workspace={workspace} /></details>
    </div>
    <WorkspaceHistory key={workspace.sequence.id} embedded open onClose={onClose} workspace={workspace} active={active} initialKind={initialKind} selection={selection} onEdit={onApply} />
    </>}
  </Modal>
}
