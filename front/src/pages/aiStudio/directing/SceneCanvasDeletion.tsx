import { CanvasDeletionDialog } from '../generationCanvas/CanvasDeletionDialog'
import { generationCanvasEditScope, useSceneEditOwnership } from './useSceneEditOwnership'

/** 管理卡片操作期间临时取得与编辑画布相同的浏览器编辑权。 */
export function SceneCanvasDeletion({ projectId, canvasId, onClose, onDeleted, onFailure }: {
  projectId: string; canvasId: string; onClose: () => void; onDeleted: () => void; onFailure: (reason: string) => void
}) {
  const ownership = useSceneEditOwnership(generationCanvasEditScope(projectId, canvasId))
  const checking = ownership.state === 'checking'
  const blockedReason = checking || ownership.editable ? undefined : ownership.state === 'unsupported'
    ? '浏览器无法确认画布编辑权，请使用支持编辑权保护的浏览器。'
    : '画布正在其他页面编辑，请先在原页面处理并释放编辑权。'
  return <CanvasDeletionDialog {...{ projectId, canvasId, onClose, onDeleted, onFailure, checking, blockedReason }}
    canDelete={ownership.canEdit} />
}
