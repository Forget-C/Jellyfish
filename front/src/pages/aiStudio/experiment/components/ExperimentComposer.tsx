import { useUiText } from '../../../../uiText'
/** Shared composer frame for submitting prompts in every experiment modality. */
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { WorkbenchButton } from '../../../../components/workbench/WorkbenchButton'
import { ArrowUpOutlined, SendOutlined } from '@ant-design/icons'

type ExperimentComposerProps = {
  inline?: boolean
  appearance?: 'default' | 'workbench'
  options: ReactNode
  addAction?: ReactNode
  feedback?: ReactNode
  contextActions?: ReactNode
  stopAction?: { label: string; onClick: () => void; loading?: boolean; disabled?: boolean }
  children: ReactNode
  submitting?: boolean
  submitDisabled?: boolean
  onSubmit: () => void
  submitLabel?: string
}

/**
 * 将输入、上下文附件、模型配置与提交动作收纳为单个实验输入框。
 *
 * 选项始终位于底部工具栏，避免模型或提示词选择与当前输入内容脱节。
 * 实验室外观使用应用壳样式，工作台外观沿用宿主 tokens。
 */
export function ExperimentComposer({
  options,
  inline = false,
  appearance = 'default',
  contextActions,
  addAction,
  feedback,
  stopAction,
  children,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  submitLabel,
}: ExperimentComposerProps) {
  const uiText = useUiText()
  const actionLabel = stopAction?.label ?? submitLabel ?? uiText("发送")
  const workbench = appearance === 'workbench'
  if (!workbench) return (
    <div className={inline ? "experiment-composer experiment-composer-inline" : "experiment-composer"}>
      <div className="experiment-composer-input">{children}</div>
      <div className="experiment-composer-toolbar">
        {addAction}
        <div className="experiment-composer-actions">
          {contextActions}
          <div className="experiment-composer-options">{options}</div>
          <Button className="experiment-composer-action" shape="circle" type="primary"
            aria-label={actionLabel} title={stopAction ? uiText("停止生成") : actionLabel}
            icon={stopAction ? <span className="experiment-stop-icon" aria-hidden="true" /> : <ArrowUpOutlined aria-hidden="true" />}
            loading={stopAction ? stopAction.loading : submitting}
            disabled={stopAction ? stopAction.disabled : submitDisabled}
            onClick={stopAction?.onClick ?? onSubmit} />
        </div>
      </div>
      {feedback && <div className="experiment-composer-feedback">{feedback}</div>}
    </div>
  )
  return (
    <div className="mt-3 overflow-hidden rounded-md border transition-colors focus-within:ring-2 focus-within:ring-[var(--wb-focus)]"
      style={{ borderColor: 'var(--wb-border)', background: 'var(--wb-surface)', color: 'var(--wb-text)' }}>
      <div className="p-4">
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3"
        style={{ borderColor: 'var(--wb-border)', background: 'var(--wb-inset)' }}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {options}
          {contextActions}
        </div>
        <WorkbenchButton variant="primary" icon={<SendOutlined aria-hidden="true" />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>{submitLabel ?? uiText("发送")}</WorkbenchButton>
      </div>
    </div>
  )
}
