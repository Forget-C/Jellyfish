import type { SceneCanvasSummary } from '../../../services/generated'

/** 提取占位画布须先采用完整候选；主动创建的空画布没有提取任务。 */
export function canOpenStoryboardCanvas(canvas: SceneCanvasSummary) {
  return canvas.can_open !== false
}
