import { useUiText } from '../../../uiText'
import { useState } from 'react'
import { Button } from 'antd'
import { CanvasDeletionDialog } from '../generationCanvas/CanvasDeletionDialog'
import { canvasRecoveryKey } from '../generationCanvas/useGenerationCanvasEditor'
import { generationCanvasEditScope, useCanvasEditOwnership } from '../generationCanvas/useCanvasEditOwnership'

/** 管理卡片操作期间临时取得与编辑画布相同的浏览器编辑权。 */
export function SceneCanvasDeletion({ projectId, canvasId, onClose, onDeleted, onFailure, onOpen }: {
  projectId: string; canvasId: string; onClose: () => void; onDeleted: () => void; onFailure: (reason: string) => void; onOpen: () => void
}) {
  const uiText = useUiText()
  const ownership = useCanvasEditOwnership(generationCanvasEditScope(projectId, canvasId))
  const [recoveryBlocked, setRecoveryBlocked] = useState(false)
  const checking = ownership.state === 'checking'
  const blockedReason = checking || ownership.editable ? undefined : ownership.state === 'unsupported'
    ? uiText("浏览器无法确认画布编辑权，请使用支持编辑权保护的浏览器。")
    : uiText("画布正在其他页面编辑，请先在原页面处理并释放编辑权。")
  const canDelete = () => {
    if (!ownership.canEdit()) return false
    let hasDraft: boolean
    try { hasDraft = localStorage.getItem(canvasRecoveryKey(projectId, canvasId)) !== null }
    catch { throw new Error(uiText("无法核实本地恢复记录，请先打开画布处理。")) }
    setRecoveryBlocked(hasDraft)
    if (hasDraft) throw new Error(uiText("画布有未保存的本地内容，请先打开画布处理。"))
    return true
  }
  return <CanvasDeletionDialog {...{ projectId, canvasId, onClose, onDeleted, onFailure, checking, blockedReason }}
    canDelete={canDelete} errorAction={recoveryBlocked &&
      <Button onClick={() => { onClose(); onOpen() }}>{uiText("打开画布处理")}</Button>} />
}
