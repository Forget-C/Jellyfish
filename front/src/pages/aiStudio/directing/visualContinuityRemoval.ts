import type { CanvasContinuitySuspension, CanvasDocument, CanvasModelCapability, PromptInstruction, PromptReference, VideoModelCard } from '../../../services/generated'
import { bindingReferences } from '../generationCanvas/inputBindings'
import { activeVisualContinuity, subjectSuspensionLabels } from './visualContinuityRules'

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right)
const appendAtSavedPositions = <T>(live: T[], saved?: Record<string, T>) => {
  const next = [...live]
  for (const [position, item] of Object.entries(saved || {})) next.splice(Number(position), 0, item)
  return next
}

function restorePrompt(model: VideoModelCard, saved: CanvasContinuitySuspension) {
  const changes = Object.values(saved.prompt_segments || {})
  if (!changes.length) return model.prompt
  const suspended = new Set(Object.values(saved.input_bindings || {}).map(binding => binding.id))
  const old = new Map(changes.map(segment => [segment.id, segment]))
  const after = (segment: PromptReference | PromptInstruction) => {
    if (segment.kind === 'reference') return undefined
    const references = (segment.references || []).filter(ref => !ref.binding_id || !suspended.has(ref.binding_id))
    return references.length ? { ...segment, references } : undefined
  }
  const live = model.prompt?.segments || []
  const expected = (saved.prompt_order || []).filter(id => !old.has(id) || after(old.get(id)!))
  if (!same(live.map(segment => segment.id), expected)) return undefined
  const byId = new Map(live.map(segment => [segment.id, segment]))
  if (changes.some(segment => !same(after(segment), byId.get(segment.id)))) return undefined
  return { segments: (saved.prompt_order || []).map(id => old.get(id) ?? byId.get(id)!) }
}

/** 恢复只补回明确暂停的内容；当前素材、其他用途和已编辑正文保持原样。 */
export function planVisualContinuityRemoval(document: CanvasDocument, targetId: string, capability?: CanvasModelCapability) {
  const storyboard = document.storyboard
  const record = storyboard?.visual_continuity?.[targetId]
  const card = document.cards?.find(item => item.id === targetId) as VideoModelCard | undefined
  if (!storyboard || !record || card?.type !== 'model.video') return undefined
  const active = activeVisualContinuity(document, targetId)
  const suspension = !record.restored ? record.suspended : undefined
  if (!active && !suspension) return undefined
  const removalIssue = active && bindingReferences(card, active.binding.id).length
    ? '当前承接已被正文或指令引用，请先解除对应引用。' : undefined
  const without = { ...card, input_bindings: (card.input_bindings || []).filter(item => item.id !== active?.binding.id) }
  const update = (next: VideoModelCard, restored: boolean): CanvasDocument => {
    const relations = { ...storyboard.visual_continuity }
    if (record.suspended) relations[targetId] = { ...record, binding_id: null, restored: restored || record.restored }
    else delete relations[targetId]
    return { ...document, cards: document.cards?.map(item => item.id === targetId ? next : item),
      storyboard: { ...storyboard, visual_continuity: relations } }
  }
  const base = { removalIssue, active: !!active, labels: suspension ? subjectSuspensionLabels(document,
      { ...card, prompt: { segments: Object.values(suspension.prompt_segments || {}) } }, suspension) : [],
    without: !removalIssue && active ? update(without, false) : undefined }
  if (!suspension) return { ...base, restoreIssues: [], restored: undefined }
  const bindings = Object.values(suspension.input_bindings || {}), uses = Object.values(suspension.design_media_uses || {})
  const items = [...bindings, ...uses], retained = [...without.input_bindings, ...(without.design_media_uses || [])]
  const restoreIssues: string[] = []
  if (!capability || card.model_id !== suspension.model_id || capability.model_id !== card.model_id)
    restoreIssues.push('当前模型与停用时不同或能力不可用。')
  if (capability && items.some(item => !capability.input_ports.includes(item.input_port)))
    restoreIssues.push('当前模型不支持部分待恢复用途。')
  if (capability && !capability.supports_subject_reference_with_frame_reference && retained.some(item =>
    ['first_frame', 'last_frame', 'key_frame'].includes(item.input_port)))
    restoreIssues.push('当前仍有其他帧参考，不能同时恢复主体参考。')
  if (items.some(item => !document.cards?.some(source => source.id === item.source.card_id)))
    restoreIssues.push('部分来源卡片已移除。')
  if (bindings.some(item => !document.edges?.some(edge => edge.source_card === item.source.card_id &&
    edge.source_port === item.source.port_id && edge.target_card === targetId && edge.target_port === item.input_port &&
    (!edge.result_scope || edge.result_scope.positions.includes(item.source.position) === (edge.result_scope.mode === 'only')))))
    restoreIssues.push('部分原参考连接已改变，请在模型卡重新采用。')
  if (items.some(item => retained.some(current => current.id === item.id || (
    current.input_port === item.input_port && same(current.source, item.source) &&
    (current.subject_name || '').trim().toLowerCase() === (item.subject_name || '').trim().toLowerCase()))))
    restoreIssues.push('已有同一来源与用途或相同采用身份，请先核对当前输入。')
  const prompt = restorePrompt(without, suspension)
  if (!prompt && Object.keys(suspension.prompt_segments || {}).length)
    restoreIssues.push('相关正文引用、指令或顺序已修改，请在模型卡手动采用。')
  const restored = removalIssue || restoreIssues.length ? undefined : update({
    ...without, prompt: prompt ?? without.prompt,
    input_bindings: appendAtSavedPositions(without.input_bindings, suspension.input_bindings),
    design_media_uses: appendAtSavedPositions(without.design_media_uses || [], suspension.design_media_uses),
  }, true)
  return { ...base, restoreIssues, restored }
}
