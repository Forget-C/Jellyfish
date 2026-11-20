import { StudioDirectingService as Directing } from '../../../services/generated'
import type { CanvasRead, CanvasDocument } from '../../../services/generated'
import type { PendingSave } from '../generationCanvas/useGenerationCanvasEditor'
import { queueStoryboardRiskNotice } from './storyboardRiskNotice'

/** 场次采用与撤销的写入由业务宿主提供，共同编辑器只负责串行提交和恢复。 */
export async function persistSceneChange(projectId: string, canvas: CanvasRead, command: PendingSave): Promise<CanvasRead> {
  const scene = command.scene
  if (!scene) throw new Error('missing scene command')
  const scope = { projectId, chapterId: scene.chapterId, sequenceId: scene.sequenceId, taskId: scene.taskId }
  const response = scene.action === 'apply' ? await Directing.directingStoryboardApply({ ...scope, requestBody: scene.choices })
    : await Directing.directingStoryboardRestore({ ...scope, requestBody: { request_id: command.request_id,
      expected_revision: command.expected_revision, direction: scene.action, document: command.document as CanvasDocument } })
  if (response.data?.id !== canvas.id || response.data.revision !== command.expected_revision + 1) throw new Error('invalid scene receipt')
  if (scene.action === 'apply' && scene.choices?.accepted_conflict_ids?.length) queueStoryboardRiskNotice(projectId, canvas.id, scene.taskId)
  return { ...response.data, scene: response.data.scene ?? canvas.scene }
}
