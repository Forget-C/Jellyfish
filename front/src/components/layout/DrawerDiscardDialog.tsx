import { useRef } from 'react'
import { Button, Modal, Space, Typography } from 'antd'
import { useUiText } from '../../uiText'

type Props = {
  open: boolean
  drawerId: string
  onContinue: () => void
  onDiscard: () => void
}

export function DrawerDiscardDialog({ open, drawerId, onContinue, onDiscard }: Props) {
  const uiText = useUiText()
  const stay = useRef<HTMLButtonElement>(null)

  return (
    <Modal className="drawer-discard-dialog" title={uiText("放弃未保存的修改？")} open={open} centered width="min(360px, calc(100vw - 32px))"
      closable={false} maskClosable={false} onCancel={onContinue}
      afterOpenChange={visible => {
        if (visible) stay.current?.focus({ preventScroll: true })
        else {
          // Keyboard activation of outside navigation can leave the trigger outside the drawer.
          const drawer = document.getElementById(drawerId)
          if (drawer && !drawer.contains(document.activeElement)) drawer.querySelector('button')?.focus({ preventScroll: true })
        }
      }}
      footer={<Space wrap>
        <Button danger onClick={onDiscard}>{uiText("放弃修改")}</Button>
        <Button type="primary" ref={stay} onClick={onContinue}>{uiText("继续编辑")}</Button>
      </Space>}>
      <Typography.Text type="secondary">{uiText("离开后，本次填写的内容将丢失。")}</Typography.Text>
    </Modal>
  )
}
