/** Shared composer frame for submitting prompts in every experiment modality. */
import type { ReactNode } from 'react'
import { Button } from 'antd'
import { SendOutlined } from '@ant-design/icons'

type ExperimentComposerProps = {
  options: ReactNode
  children: ReactNode
  submitting?: boolean
  submitDisabled?: boolean
  onSubmit: () => void
  submitLabel?: string
}

/** Places shared options, modality-specific input, and a consistent submit action in one composer. */
export function ExperimentComposer({
  options,
  children,
  submitting = false,
  submitDisabled = false,
  onSubmit,
  submitLabel = '发送',
}: ExperimentComposerProps) {
  return (
    <div className="pt-4 mt-4 border-t border-gray-100 space-y-3">
      <div>{options}</div>
      {children}
      <div className="flex justify-end">
        <Button type="primary" icon={<SendOutlined />} loading={submitting} disabled={submitDisabled} onClick={onSubmit}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
