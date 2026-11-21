import { useUiText } from '../../../../uiText'
import { Alert, Button, Space } from 'antd'
import type { ExperimentSubmissionNotice } from '../hooks/useExperimentSubmission'

export function ExperimentSubmissionFeedback({ notice, onCheck, onAcknowledge }: {
  notice?: ExperimentSubmissionNotice
  onCheck: () => void
  onAcknowledge: () => void
}) {
  const uiText = useUiText()
  if (!notice) return null
  if (notice.kind === 'rejected') return <Alert type="error" showIcon message={notice.message} />
  if (notice.kind === 'checking') return <p role="status">{notice.accepted ? uiText("正在读取会话历史…") : uiText("正在核对提交结果…")}</p>
  const accepted = notice.kind === 'run-unavailable'
  const description = accepted
    ? uiText("服务端已接收本轮请求，流连接中断前未收到最终状态。请核对会话历史。")
    : uiText("历史中无法确认本轮请求，请核对会话记录后再决定是否提交。")
  return <Alert
    type="warning"
    showIcon
    message={accepted ? uiText("状态暂不可用") : uiText("提交结果未知")}
    description={notice.historyUnavailable ? (accepted ? description + uiText(" 会话历史暂不可用，可重试读取。") : uiText("会话历史暂不可用，可重试读取。")) : description}
    action={<Space wrap>
      <Button size="small" onClick={onCheck}>{accepted ? uiText("重试读取历史") : uiText("重试核对")}</Button>
      <Button size="small" onClick={onAcknowledge}>{uiText("我已核对")}</Button>
    </Space>}
  />
}
