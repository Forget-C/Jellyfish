import { designReferences } from './designFieldReferences'
import type { CanvasDocument, OutputIdentity } from '../../../services/generated'
import type { GenerationCard, createGraphRules } from './graphRules'
import { editorPrompt } from './inputBindings'
import type { EditorPromptDocument as PromptDocument, EditorPromptReference as PromptReference } from './inputBindings'
export type Candidate = { source: OutputIdentity; token: string; displayLabel?: string; available: boolean; name?: string; fileId?: string | null; adopted?: boolean; disabledReason?: string }
export const sourceKey = (source: OutputIdentity) => JSON.stringify([source.canvas_id, source.card_id, source.port_id, source.object_id || source.position])
export const referencesIn = (prompt?: PromptDocument): PromptReference[] => (prompt?.segments || []).flatMap(segment => segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : [])
export function referenceIssue(document: CanvasDocument, _receiver: GenerationCard, source: OutputIdentity, candidates: Candidate[] = []) {
  if (source.canvas_id !== document.id) return '来源属于其他画布'
  const item = candidates.find(candidate => sourceKey(candidate.source) === sourceKey(source))
  return !item ? '来源未连接' : !item.available ? item.disabledReason || '来源输出缺失' : ''
}
export type ConnectionBlocker = { message: string; cardId: string; segmentId: string; referenceId: string }
/** 收集全部保留消费者的依赖；调用方只能原子解除，不做部分删除。 */
export function referenceProtection(document: CanvasDocument, policy: ReturnType<typeof createGraphRules>['connectionPolicy'], sourceCard: string, receiverId?: string, sourcePort?: string, targetPort?: string, removedConsumers: string[] = []) {
  const blockers: ConnectionBlocker[] = []
  const add = (cardId: string, id: string, message: string, segmentId = id) => {
    if (!blockers.some(item => item.cardId === cardId && item.referenceId === id)) blockers.push({ cardId, segmentId, referenceId: id, message })
  }
  for (const card of document.cards || []) {
    if (removedConsumers.includes(card.id) || receiverId && card.id !== receiverId) continue
    if (!sourcePort && 'frame_target' in card && card.frame_target?.card_id === sourceCard) add(card.id, 'frame_target', '请先解除构图的运镜关联')
    for (const { reference, field } of designReferences(card)) if (reference.source.canvas_id === document.id && reference.source.card_id === sourceCard && (!sourcePort || reference.source.port_id === sourcePort) && (!targetPort || document.edges?.some(edge => edge.target_card === card.id && edge.target_port === targetPort && edge.source_card === sourceCard && edge.source_port === reference.source.port_id))) add(card.id, reference.id, `请先清理 ${card.id} 的参数引用 ${field}`)
    if ((!targetPort || targetPort === 'name') && 'name_binding' in card && card.name_binding?.card_id === sourceCard && (!sourcePort || card.name_binding.port_id === sourcePort)) add(card.id, 'name', '请先取消已采用的名称关联')
    if ((!targetPort || targetPort === 'image_source') && 'image_binding' in card && card.image_binding?.source?.card_id === sourceCard && (!sourcePort || card.image_binding.source.port_id === sourcePort)) add(card.id, 'image', '请先取消或替换已采用主图来源')
    if ((!targetPort || targetPort === `${sourcePort}_example`) && 'examples' in card) for (const example of card.examples || []) {
      if (example.source.card_id === sourceCard && (!sourcePort || example.source.port_id === sourcePort)) add(card.id, example.id, '请先取消示例关联')
    }
    for (const binding of 'input_bindings' in card ? card.input_bindings || [] : []) {
      if (targetPort && binding.input_port !== targetPort || binding.source.canvas_id !== document.id || binding.source.card_id !== sourceCard || sourcePort && binding.source.port_id !== sourcePort) continue
      const refs = referencesIn(editorPrompt(card)).filter(reference => reference.binding_id === binding.id)
      const rule = policy(document, { id: '', source_card: sourceCard, source_port: binding.source.port_id, target_card: card.id, target_port: binding.input_port })
      if (!refs.length && rule?.disconnect === 'release') continue
      if (refs.length) for (const ref of refs) add(card.id, ref.id, `请先清理 ${card.id} 的引用 ${ref.id}`)
      else add(card.id, binding.id, '请先清理 ' + card.id + ' 的实际输入绑定 ' + binding.id)
    }
  }
  return blockers.length ? { ...blockers[0], message: blockers.map(item => item.message).join('；'), blockers } : undefined
}
