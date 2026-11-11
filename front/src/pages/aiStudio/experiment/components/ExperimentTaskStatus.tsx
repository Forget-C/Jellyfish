import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, LoadingOutlined, StopOutlined } from '@ant-design/icons'
import { Button } from 'antd'

const states = {
  queued: { label: '排队', icon: ClockCircleOutlined, tone: 'neutral' },
  running: { label: '生成中', icon: LoadingOutlined, tone: 'active' },
  succeeded: { label: '已完成', icon: CheckCircleOutlined, tone: 'success' },
  failed: { label: '失败', icon: CloseCircleOutlined, tone: 'error' },
  cancelled: { label: '已取消', icon: StopOutlined, tone: 'neutral' },
}

type ExperimentTaskStatusProps = {
  status?: string
  progress?: number | null
  unavailable?: boolean
  onRetry?: () => void
}

/** 状态使用任务已知值，读取失败不会改写最后一次可靠状态。 */
export function ExperimentTaskStatus({ status, progress, unavailable, onRetry }: ExperimentTaskStatusProps) {
  const key = status === 'pending' ? 'queued' : status
  const state = key && Object.prototype.hasOwnProperty.call(states, key) ? states[key as keyof typeof states] : undefined
  const showProgress = key === 'running' && typeof progress === 'number' && Number.isFinite(progress) && progress >= 0 && progress <= 100
  return <>
    {state ? <span className={`experiment-task-status experiment-task-status-${state.tone}`} role="status">
      <state.icon aria-hidden="true" /> {state.label}{showProgress ? ` ${progress}%` : ''}
    </span> : null}
    {unavailable || !state ? <span className="experiment-task-read-state">
      <span role="status">状态暂不可用</span>
      {onRetry ? <Button type="link" size="small" onClick={onRetry}>重试读取状态</Button> : null}
    </span> : null}
  </>
}
