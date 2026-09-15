import { Button, Card, Space, Typography } from 'antd'
import type { WorkspaceGuidance } from './workspaceGuidance'
import { useWorkspaceDraftStatus } from './WorkspaceDrafts'

export function WorkspaceNextStep({ guidance, busy, running, onAction }: { guidance: WorkspaceGuidance; busy: boolean; running: number; onAction: (guidance: WorkspaceGuidance) => void }) {
  const drafts = useWorkspaceDraftStatus()
  return <Card size="small" title="下一步" role="region" aria-label="下一步引导">
    <Space direction="vertical" style={{ width: '100%' }}>
      <Typography.Text strong>{drafts.names.length ? '先处理未保存的修改' : guidance.title}</Typography.Text>
      <Typography.Text>{drafts.names.length ? drafts.names.join('、') + '尚未保存。保存不会确认版本或开始生成。' : guidance.description}</Typography.Text>
      <Button type="primary" loading={busy} onClick={() => drafts.names.length ? drafts.resolve() : onAction(guidance)}>{drafts.names.length ? '处理未保存修改' : guidance.label}</Button>
      {running > 0 && <Typography.Text type="secondary">本场有 {running} 个任务等待或执行中；其他独立单元仍可操作。</Typography.Text>}
    </Space>
  </Card>
}
