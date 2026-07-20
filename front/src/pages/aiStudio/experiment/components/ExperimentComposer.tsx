/** Shared composer frame for submitting prompts in every experiment modality. */
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

type ExperimentComposerProps = {
  options: ReactNode
  contextActions?: ReactNode
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
 */
export function ExperimentComposer({
  options,
  contextActions,
  children,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  submitLabel = '发送',
}: ExperimentComposerProps) {
  return (
    <div className="mt-5 overflow-hidden rounded-2xl border-2 border-slate-300 bg-slate-50/80 text-slate-900 shadow-md transition-colors focus-within:border-blue-500 focus-within:ring-4 focus-within:ring-blue-100">
      <div className="p-4">
        {children}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-slate-100/80 px-4 py-3">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {options}
          {contextActions}
        </div>
        <Button type="primary" icon={<SendOutlined />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
