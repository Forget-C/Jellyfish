import type { CanvasCatalog, CanvasDocument, CanvasModelCapability, CanvasRunRead, ImageContentCard, VideoModelCard } from '../../../services/generated'
import type { GenerationCard } from '../generationCanvas/graphRules'
import { createGraphRules } from '../generationCanvas/graphRules'
import { createCanvasOperations } from '../generationCanvas/canvasOperations'
import type { CanvasSourceItem } from '../generationCanvas/CanvasSourcePopover'
import type { VideoFrameSource } from '../generationCanvas/SaveVideoFrameDialog'

export const continuityPorts = {
  first_frame: '首帧', last_frame: '尾帧', key_frame: '关键帧', subject_image: '主体参考图',
} as const
export type ContinuityPort = keyof typeof continuityPorts

export function storyboardShotIndex(document: CanvasDocument, cardId: string) {
  return document.storyboard?.shots.findIndex(shot => shot.model_card_ids.includes(cardId)) ?? -1
}

/** 结果按前序镜头距离及最新成功运行排序，避免误用同镜片段或当前动态输出。 */
export function continuityResults(document: CanvasDocument, targetId: string, runs: CanvasRunRead[]) {
  const target = storyboardShotIndex(document, targetId)
  return runs.slice().reverse().flatMap(run => run.nodes.flatMap(node => {
    const index = storyboardShotIndex(document, node.card_id)
    if (index < 0 || index >= target || node.status !== 'succeeded' || !node.result_set_id ||
      !document.cards?.some(card => card.id === node.card_id && card.type === 'model.video')) return []
    const shot = document.storyboard!.shots[index]
    const shotCard = document.cards?.find(card => card.id === shot.card_id)
    const shotName = shotCard && 'name' in shotCard && shotCard.name || `镜头 ${index + 1}`
    return node.outputs.flatMap((output, position) => output.modality === 'video' && output.file_id && output.available !== false ? [{
      id: `${node.id}:${position}`, index, recommended: index === target - 1,
      label: `${shotName} · 运行 ${run.id.slice(0, 8)} · 成果 ${position + 1}`,
      source: { source_card_id: node.card_id, source_file_id: output.file_id,
        result: { run_id: run.id, node_id: node.id, position } } satisfies VideoFrameSource,
    }] : [])
  })).sort((left, right) => right.index - left.index)
}

export function activeVisualContinuity(document: CanvasDocument, targetId: string) {
  const record = document.storyboard?.visual_continuity?.[targetId]
  const card = document.cards?.find(item => item.id === targetId)
  const binding = record && card?.type === 'model.video' && 'input_bindings' in card
    ? card.input_bindings?.find(item => item.id === record.binding_id) : undefined
  const frame = binding && document.cards?.find(item => item.id === binding.source.card_id)
  return binding && frame && 'frame_origin' in frame && frame.frame_origin
    ? { record, binding, frame: frame as ImageContentCard, origin: frame.frame_origin } : undefined
}

export function visualContinuitySources(card: GenerationCard, document: CanvasDocument): CanvasSourceItem[] {
  const adopted = activeVisualContinuity(document, card.id)
  if (!adopted) return []
  const { origin } = adopted
  const missing = !document.cards?.some(item => item.id === origin.source_card_id)
  return [{ source: { card_id: origin.source_card_id }, label: '来源视频', position: `${(origin.at_ms / 1000).toFixed(3)} 秒`,
    missing, issue: missing ? '来源卡片已删除或不可用' : undefined }]
}

/** 仅用真实图片及实际用途构建一次可保存变更，不调用运行或写入历史视频。 */
export function applyVisualContinuity(document: CanvasDocument, catalog: CanvasCatalog, capability: CanvasModelCapability,
  targetId: string, frame: ImageContentCard, port: ContinuityPort, subjectName: string, bindingId: string) {
  const target = document.cards?.find(card => card.id === targetId) as VideoModelCard | undefined
  const source = frame.frame_origin && storyboardShotIndex(document, frame.frame_origin.source_card_id)
  const index = storyboardShotIndex(document, targetId)
  if (!document.storyboard || target?.type !== 'model.video' || target.model_id !== capability.model_id ||
    typeof source !== 'number' || source < 0 || source >= index) throw new Error('当前镜头或模型已变化，请重新选择来源')
  if (activeVisualContinuity(document, targetId)) throw new Error('当前镜头已有视觉承接')
  const operations = createCanvasOperations(createGraphRules(catalog))
  const withFrame = { ...document, cards: [...(document.cards || []), frame] }
  const result = operations.update(withFrame, { ...target, input_bindings: [...(target.input_bindings || []),
    { id: bindingId, source: { canvas_id: document.id, card_id: frame.id, port_id: 'image', position: 0 },
      input_port: port, subject_name: port === 'subject_image' ? subjectName : null, prompt_owned: false }],
  }, capability)
  if (!result.document) throw new Error(result.reason)
  return { ...result.document, storyboard: { ...document.storyboard, visual_continuity: {
    ...document.storyboard.visual_continuity, [targetId]: { binding_id: bindingId },
  } } }
}
