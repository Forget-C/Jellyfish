import { useRef, useState } from 'react'
import { Alert } from 'antd'
import type { CanvasVideoFrameRequest, ImageContentCard } from '../../../services/generated'
import { StudioGenerationCanvasesService as Canvases } from '../../../services/generated'
import { WorkbenchButton as Button } from '../../../components/workbench/WorkbenchButton'
import { WorkbenchDialogActions, WorkbenchModal } from '../../../components/workbench/WorkbenchModal'
import { apiErrorMessage } from '../../../services/apiErrorMessage'
import { VideoFramePicker } from './VideoFramePicker'

export type VideoFrameSource = Omit<CanvasVideoFrameRequest, 'request_id' | 'at_ms'>

export function SaveVideoFrameDialog({ source, projectId, canvasId, disabled, onSave, onClose }: {
  source: VideoFrameSource
  projectId: string
  canvasId: string
  disabled: boolean
  onSave: (card: ImageContentCard) => Promise<boolean>
  onClose: () => void
}) {
  const [atMs, setAtMs] = useState<number>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef<{ atMs: number; requestId: string; card?: ImageContentCard }>()
  const submitting = useRef(false)
  const submit = async () => {
    if (atMs === undefined || disabled || submitting.current) return
    submitting.current = true
    setBusy(true); setError('')
    const request = pending.current?.atMs === atMs ? pending.current : { atMs, requestId: crypto.randomUUID() }
    pending.current = request
    try {
      if (!request.card) {
        const response = await Canvases.canvasPrepareVideoFrame({ projectId, canvasId,
          requestBody: { ...source, at_ms: atMs, request_id: request.requestId } })
        if (!response.data) throw new Error('无法读取选帧素材')
        request.card = response.data
      }
      if (await onSave(request.card)) onClose()
      else setError('图片尚未保存，请核对画布状态后重试')
    } catch (cause) {
      setError(apiErrorMessage(cause))
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  return <WorkbenchModal title="选帧为图片" open width={640} closable={!busy} maskClosable={!busy} keyboard={!busy}
    onCancel={onClose} footer={<WorkbenchDialogActions secondary={<Button disabled={busy} onClick={onClose}>取消</Button>}>
      <Button variant="primary" disabled={disabled || atMs === undefined} loading={busy} onClick={() => void submit()}>保存为图片</Button>
    </WorkbenchDialogActions>}>
    <VideoFramePicker fileId={source.source_file_id} disabled={busy || disabled} onPosition={setAtMs} />
    {error && <Alert type="error" message={error} />}
  </WorkbenchModal>
}
