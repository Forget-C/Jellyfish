import type { SceneVersionContent_Output, SceneVersionRead, SceneVersionSave } from '../../../services/generated'

export type SaveOperation = { versionId: string; body: SceneVersionSave; operationCount: number; videoOnly?: boolean; video?: { unitId: string; requestId: string } }
export type SceneRecovery = {
  format: 1
  projectId: string
  chapterId: string
  sequenceId: string
  base: SceneVersionRead
  content: SceneVersionContent_Output
  undo: SceneVersionContent_Output[]
  pending?: SaveOperation
}
// 整个浏览器只保留这一份未保存现场，成功保存的完整会话历史不持久化。
const key = 'jellyfish:scene-unsaved:local-user'

export function readSceneRecovery(): SceneRecovery | undefined {
  const value = localStorage.getItem(key)
  if (!value) return undefined
  const data = JSON.parse(value) as SceneRecovery
  if (data.format !== 1 || !data.projectId || !data.chapterId || !data.sequenceId || !data.base?.id ||
    typeof data.content?.basis?.text !== 'string' || data.content.basis.source?.kind !== 'chapter' ||
    !Number.isInteger(data.base.revision) || !data.content?.design?.direction?.viewpoint ||
    !Array.isArray(data.content.design.direction.shots) || !Array.isArray(data.undo) ||
    (data.pending && (!data.pending.body?.request_id || data.pending.versionId !== data.base.id ||
      !Number.isInteger(data.pending.operationCount) || (data.pending.videoOnly !== undefined && (typeof data.pending.videoOnly !== 'boolean' || !data.pending.video)) || (data.pending.video && (!data.pending.video.requestId || !data.pending.body.content.units?.some(unit => unit.id === data.pending!.video!.unitId)))))) throw new Error('本地恢复数据无法读取，请明确丢弃后继续')
  return data
}

/** 不允许新编辑覆盖尚未处理的另一个场次／版本现场。 */
export function writeSceneRecovery(data: SceneRecovery) {
  const previous = readSceneRecovery()
  if (previous && (previous.projectId !== data.projectId || previous.sequenceId !== data.sequenceId || previous.base.id !== data.base.id)) {
    throw new Error('另一个场次版本的未保存编辑尚未处理')
  }
  localStorage.setItem(key, JSON.stringify(data))
}

export function clearSceneRecovery() { localStorage.removeItem(key) }
