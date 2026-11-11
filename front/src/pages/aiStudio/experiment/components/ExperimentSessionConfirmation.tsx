import { useRef, useState } from 'react'
import { Alert, Modal } from 'antd'

type ExperimentSessionConfirmationProps = {
  title: string
  description: string
  run?: () => Promise<void>
  failure: string
  onClose: () => void
}

/** Keep the confirmed target visible and retryable when its mutation fails. */
export function ExperimentSessionConfirmation({ title, description, run, failure, onClose }: ExperimentSessionConfirmationProps) {
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const close = () => {
    setFailed(false)
    onClose()
  }

  const confirm = async () => {
    if (!run || pending.current) return
    pending.current = true
    setBusy(true)
    setFailed(false)
    try {
      await run()
      close()
    } catch {
      setFailed(true)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  return <Modal
    title={title}
    open={Boolean(run)}
    okText={title}
    okButtonProps={{ danger: true }}
    cancelButtonProps={{ disabled: busy }}
    confirmLoading={busy}
    closable={!busy}
    keyboard={!busy}
    maskClosable={false}
    onCancel={() => { if (!pending.current) close() }}
    onOk={() => void confirm()}
  >
    <p>{description}</p>
    {failed && <Alert type="error" message={failure} showIcon />}
  </Modal>
}
