/** 历史输入回填操作，避免整块消息气泡成为容易误触的交互区域。 */
import { RedoOutlined } from '@ant-design/icons'
import { Button, Tooltip } from 'antd'

type ExperimentHistoryRestoreButtonProps = {
  disabled?: boolean
  onRestore: () => void
}

/**
 * 在历史用户消息 footer 的右侧显示回填操作。
 *
 * 图标由气泡整体的悬浮或焦点状态控制显示，因此正文与媒体预览可以继续按其
 * 原有行为使用；仅明确点击该操作时才会恢复编辑草稿。
 */
export function ExperimentHistoryRestoreButton({ disabled = false, onRestore }: ExperimentHistoryRestoreButtonProps) {
  return (
    <Tooltip title="回填到输入框">
      <Button
        aria-label="回填到输入框"
        className="opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        disabled={disabled}
        icon={<RedoOutlined />}
        onClick={onRestore}
        shape="circle"
        size="small"
      />
    </Tooltip>
  )
}
