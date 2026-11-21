import { useUiText } from '../../../../uiText'
import { useCallback, useId, type ReactNode } from 'react'
import { Button, Drawer, Space } from 'antd'
import './experiment-reference.css'

export type ExperimentReferenceHandle = { open: (trigger?: HTMLElement | null) => void }

type ExperimentReferencePanelProps = {
  open: boolean
  title: string
  applyLabel: string
  applyDisabled?: boolean
  previewOpen?: boolean
  onApply: () => void
  onCancel: () => void
  onAfterClose?: () => void
  children: ReactNode
}

/** 图片与视频共用的参考配置抽屉。各模态保留自己的临时选择和角色校验。 */
export function ExperimentReferencePanel({ open, title, applyLabel, applyDisabled, previewOpen, onApply, onCancel, onAfterClose, children }: ExperimentReferencePanelProps) {
  const uiText = useUiText()
  const titleId = useId()
  // 当前 Drawer 版本不会将标题关联到 role="dialog"。
  const labelPanel = useCallback((node: HTMLSpanElement | null) => {
    node?.closest('[role="dialog"]')?.setAttribute('aria-labelledby', titleId)
  }, [titleId])
  return <Drawer
    title={<span id={titleId} ref={labelPanel}>{title}</span>}
    open={open}
    placement="right"
    width="var(--experiment-reference-panel-width)"
    rootClassName="experiment-reference-panel app-detail-drawer"
    keyboard={!previewOpen}
    onClose={onCancel}
    afterOpenChange={visible => { if (!visible) onAfterClose?.() }}
    footer={<Space className="experiment-reference-footer">
      <Button onClick={onCancel} aria-label={uiText("取消参考配置")}>{uiText("取消")}</Button>
      <Button type="primary" disabled={applyDisabled} onClick={onApply}>{applyLabel}</Button>
    </Space>}
  >
    {children}
  </Drawer>
}
