/** Shared composer frame for submitting prompts in every experiment modality. */
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { WorkbenchButton } from '../../directing/ui/WorkbenchButton'
import { SendOutlined } from '@ant-design/icons'

type ExperimentComposerProps = {
  appearance?: 'default' | 'workbench'
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
 * workbench 外观只消费宿主工作台 tokens；默认实验页面仍使用原浅色样式。
 */
export function ExperimentComposer({
  options,
  appearance = 'default',
  contextActions,
  children,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  submitLabel = '发送',
}: ExperimentComposerProps) {
  const workbench = appearance === 'workbench'
  return (
    <div className={`mt-3 overflow-hidden rounded-md border transition-colors focus-within:ring-2 ${workbench ? 'focus-within:ring-[var(--wb-focus)]' : 'border-slate-300 bg-white text-slate-900 focus-within:border-blue-500 focus-within:ring-blue-100'}`}
      style={workbench ? { borderColor: 'var(--wb-border)', background: 'var(--wb-surface)', color: 'var(--wb-text)' } : undefined}>
      <div className="p-4">
        {children}
      </div>
      <div className={`flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3 ${workbench ? '' : 'border-slate-200 bg-slate-100/80'}`}
        style={workbench ? { borderColor: 'var(--wb-border)', background: 'var(--wb-inset)' } : undefined}>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          {options}
          {contextActions}
        </div>
        {workbench ? <WorkbenchButton variant="primary" icon={<SendOutlined aria-hidden="true" />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>{submitLabel}</WorkbenchButton> : <Button type="primary" icon={<SendOutlined aria-hidden="true" />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </Button>}
      </div>
    </div>
  )
}
