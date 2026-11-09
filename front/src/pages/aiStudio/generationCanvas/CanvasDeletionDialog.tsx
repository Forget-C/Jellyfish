import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Alert, Button, Modal, Spin } from 'antd'
import { ApiError, StudioGenerationCanvasesService as Canvases, type CanvasRead } from '../../../services/generated'
import { directingError } from '../directing/common'
import { WorkbenchModal } from '../directing/ui/WorkbenchModal'

/** 两个入口共同核对保存修订，提交未知时只核实原画布。 */
export function CanvasDeletionDialog({ projectId, canvasId, workbench, checking, blockedReason, errorAction, canDelete, onClose, onDeleted, onFailure }: {
  projectId: string; canvasId: string; workbench?: boolean; checking?: boolean; blockedReason?: string
  errorAction?: ReactNode; canDelete: () => boolean | Promise<boolean>; onClose: () => void; onDeleted: () => void; onFailure: (reason: string) => void
}) {
  const [basis, setBasis] = useState<CanvasRead>()
  const [busy, setBusy] = useState(false)
  const [unknown, setUnknown] = useState(false)
  const [error, setError] = useState('')
  const live = useRef(false)
  const callbacks = useRef({ onClose, onDeleted, onFailure })
  callbacks.current = { onClose, onDeleted, onFailure }
  const available = !checking && !blockedReason

  useEffect(() => {
    live.current = true
    return () => { live.current = false }
  }, [])

  useEffect(() => {
    if (!available || basis) return
    let active = true
    void Canvases.canvasGet({ projectId, canvasId }).then(response => {
      if (!active) return
      if (!response.data) throw new Error('无法核对画布当前保存修订')
      setBasis(response.data)
    }).catch(reason => {
      if (!active) return
      if (reason instanceof ApiError && reason.status === 404) callbacks.current.onDeleted()
      else callbacks.current.onFailure(directingError(reason))
      callbacks.current.onClose()
    })
    return () => { active = false }
  }, [available, basis, projectId, canvasId])

  const confirm = async () => {
    if (!basis || busy || !available || unknown) return
    setBusy(true); setError('')
    let submitted = false
    try {
      if (!await canDelete()) {
        setError('当前无法删除，请核对编辑权、保存状态或活动任务后重试。')
        return
      }
      if (!live.current) return
      submitted = true
      await Canvases.canvasDelete({ projectId, canvasId, expectedRevision: basis.revision })
      if (!live.current) return
      callbacks.current.onDeleted()
      callbacks.current.onClose()
    } catch (reason) {
      if (!live.current) return
      if (!submitted) setError(directingError(reason))
      else if (reason instanceof ApiError && reason.status < 500) {
        if (reason.status === 404) callbacks.current.onDeleted()
        else callbacks.current.onFailure(directingError(reason))
        callbacks.current.onClose()
      } else {
        setUnknown(true)
        setError('删除结果未确认，请核实画布状态后重试')
      }
    } finally { if (live.current) setBusy(false) }
  }

  const verify = async () => {
    if (busy || !unknown) return
    setBusy(true)
    try {
      await Canvases.canvasGet({ projectId, canvasId })
      if (!live.current) return
      callbacks.current.onFailure('画布仍存在；删除尚未完成，可重试')
      callbacks.current.onClose()
    } catch (reason) {
      if (!live.current) return
      if (reason instanceof ApiError && reason.status === 404) {
        callbacks.current.onDeleted()
        callbacks.current.onClose()
      } else setError('画布状态核实失败，删除结果仍未确认，请重试核实')
    } finally { if (live.current) setBusy(false) }
  }

  const Dialog = workbench ? WorkbenchModal : Modal
  return <Dialog open width={480} title="删除画布" onCancel={onClose}
    closable={!busy && !unknown} keyboard={!busy && !unknown} maskClosable={false}
    footer={unknown
      ? <Button type="primary" loading={busy} onClick={() => void verify()}>核实画布状态</Button>
      : <>
        <Button onClick={onClose} disabled={busy}>取消</Button>
        <Button danger type="primary" loading={busy} disabled={!basis || !available}
          onClick={() => void confirm()}>确认删除</Button>
      </>}>
    {checking || (available && !basis) ? <Spin aria-label="正在核对画布状态" /> : null}
    {blockedReason && <Alert type="warning" showIcon message={blockedReason} />}
    {basis && <p>将删除「{basis.document.name}」整张画布及其运行历史。删除后无法恢复，文件及其他使用关系会保留。</p>}
    {error && <Alert type="error" showIcon message={error} action={errorAction} />}
  </Dialog>
}
