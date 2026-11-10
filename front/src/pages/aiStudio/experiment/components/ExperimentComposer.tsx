/** Shared composer frame for submitting prompts in every experiment modality. */
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { WorkbenchButton } from '../../directing/ui/WorkbenchButton'
import { SendOutlined } from '@ant-design/icons'

type ExperimentComposerProps = {
  appearance?: 'default' | 'workbench'
  options: ReactNode
  contextActions?: ReactNode
  secondaryAction?: ReactNode
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
  appearance = 'default',
  contextActions,
  secondaryAction,
  children,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  submitLabel = '发送',
}: ExperimentComposerProps) {
  const workbench = appearance === 'workbench'
  if (!workbench) return (
    <div className="experiment-composer">
      <div className="experiment-composer-input">{children}</div>
      <div className="experiment-composer-toolbar">
        <div className="experiment-composer-options">{options}{contextActions}</div>
        <div className="experiment-composer-submit">
          {secondaryAction}
          <Button type="primary" icon={<SendOutlined aria-hidden="true" />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>{submitLabel}</Button>
        </div>
      </div>
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
        <WorkbenchButton variant="primary" icon={<SendOutlined aria-hidden="true" />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>{submitLabel}</WorkbenchButton>
      </div>
    </div>
  )
}
