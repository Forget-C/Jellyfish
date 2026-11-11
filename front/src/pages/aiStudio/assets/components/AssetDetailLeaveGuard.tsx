import { Alert, Button, Modal, Space } from 'antd'
import { useCallback, useRef, useState } from 'react'
import { useBeforeUnload, useBlocker } from 'react-router-dom'

type Props = {
  closeRequested?: boolean
  onContinue?: () => void
  onClose?: () => void | Promise<void>
  dirty: boolean
  busy: boolean
  detecting: boolean
  canCancelDetection: boolean
  cancellingDetection: boolean
  partialSave: boolean
  save: () => Promise<boolean>
  cancelDetection: () => Promise<boolean>
}

/** 独立资产详情注册路由保护，内嵌档案继续由工作台统一管理。 */
export function AssetDetailLeaveGuard({ closeRequested = false, onContinue, onClose, dirty, busy, detecting, canCancelDetection, cancellingDetection, partialSave, save, cancelDetection }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const lock = useRef(false)
  const continueButton = useRef<HTMLButtonElement>(null)
  const blocker = useBlocker(({ currentLocation, nextLocation }) =>
    (currentLocation.pathname !== nextLocation.pathname || currentLocation.search !== nextLocation.search)
    && (dirty || busy || detecting || partialSave),
  )
  useBeforeUnload(useCallback(event => {
    if (dirty || busy || detecting || partialSave) { event.preventDefault(); event.returnValue = '' }
  }, [dirty, busy, detecting, partialSave]))
  const stay = () => {
    if (lock.current || busy) return
    setError('')
    if (blocker.state === 'blocked') blocker.reset()
    onContinue?.()
  }
  const leave = async (saveFirst: boolean) => {
    if ((!closeRequested && blocker.state !== 'blocked') || lock.current || busy || detecting) return
    lock.current = true
    setSubmitting(true)
    setError('')
    try {
      if (saveFirst && !await save()) { setError('保存未完整完成，请处理页面提示后重试。'); return }
      if (blocker.state === 'blocked') blocker.proceed()
      else await onClose?.()
    } catch { setError('保存失败，编辑内容已保留。') }
    finally { lock.current = false; setSubmitting(false) }
  }
  return <Modal title={busy ? '当前操作尚未完成' : detecting ? '智能检测进行中' : '离开资产详情'}
    open={closeRequested || blocker.state === 'blocked'} zIndex={2100} maskClosable={false}
    closable={!busy && !submitting} keyboard={!busy && !submitting} onCancel={stay}
    afterOpenChange={open => { if (open) continueButton.current?.focus() }}
    footer={<Space wrap>
      <Button ref={continueButton} disabled={busy || submitting} onClick={stay}>{detecting ? '继续等待' : '继续编辑'}</Button>
      {detecting ? <Button disabled={!canCancelDetection || cancellingDetection || submitting} onClick={async () => {
        if (lock.current) return
        lock.current = true
        setSubmitting(true)
        setError('')
        try { if (!await cancelDetection()) setError('取消检测失败，请重试或继续等待。') }
        finally { lock.current = false; setSubmitting(false) }
      }}>{cancellingDetection ? '等待取消确认' : '取消检测'}</Button> : <>
        <Button danger disabled={busy || submitting} onClick={() => void leave(false)}>{dirty ? '放弃修改并离开' : partialSave ? '离开（档案已保存）' : '离开'}</Button>
        {(dirty || partialSave) && <Button type="primary" disabled={busy} loading={submitting} onClick={() => void leave(true)}>{partialSave && !dirty ? '重试视角准备并离开' : '保存并离开'}</Button>}
      </>}
    </Space>}>
    <p>{busy ? '请等待当前保存或提交完成，再决定是否离开。' : detecting ? '检测结束或取消确认后，再处理未保存的修改。取消请求已受理不代表检测已经结束。' : dirty ? '当前有未保存的修改，请选择保存、放弃或继续编辑。' : '当前没有未保存的表单修改。'}</p>
    {partialSave && <Alert type="warning" message="档案已保存，图片视角准备未完成。离开不会撤销已保存的档案。" />}
    {error && <Alert type="error" message={error} />}
  </Modal>
}
