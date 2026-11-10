import { Alert, Button, Space } from 'antd'
import type { ExperimentSubmissionNotice } from '../hooks/useExperimentSubmission'

export function ExperimentSubmissionFeedback({ notice, onCheck, onAcknowledge }: {
  notice?: ExperimentSubmissionNotice
  onCheck: () => void
  onAcknowledge: () => void
}) {
  if (!notice) return null
  if (notice.kind === 'rejected') return <Alert type="error" showIcon message={notice.message} />
  if (notice.kind === 'checking') return <p role="status">正在核对提交结果…</p>
  return <Alert
    type="warning"
    showIcon
    message="提交结果未知"
    description={notice.historyUnavailable ? '会话历史暂不可用，可重试读取。' : '历史中无法确认本轮请求，请核对会话记录后再决定是否提交。'}
    action={<Space wrap>
      <Button size="small" onClick={onCheck}>重试核对</Button>
      <Button size="small" onClick={onAcknowledge}>我已核对</Button>
    </Space>}
  />
}
