import type { CanvasDocument, OutputIdentity } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { editorPrompt } from './inputBindings'
import type { EditorPromptDocument as PromptDocument, EditorPromptReference as PromptReference } from './inputBindings'
export type Candidate = { source: OutputIdentity; token: string; available: boolean }
export const sourceKey = (source: OutputIdentity) => JSON.stringify([source.canvas_id, source.card_id, source.port_id, source.object_id || source.position])
export const referencesIn = (prompt?: PromptDocument): PromptReference[] => (prompt?.segments || []).flatMap(segment => segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : [])
export function referenceIssue(document: CanvasDocument, _receiver: GenerationCard, source: OutputIdentity, candidates: Candidate[] = []) {
  if (source.canvas_id !== document.id) return '来源属于其他画布'
  const item = candidates.find(candidate => sourceKey(candidate.source) === sourceKey(source))
  return !item ? '来源未连接' : !item.available ? '来源输出缺失' : ''
}
/** 清理引用与删边/来源可以在同一份最终编辑文档里完成。 */
export function referenceProtection(document: CanvasDocument, sourceCard: string, receiverId?: string, sourcePort?: string) {
  for (const card of document.cards || []) if (('input_bindings' in card || 'image_binding' in card) && (!receiverId || card.id === receiverId)) {
    if ('image_binding' in card && card.image_binding?.source?.card_id === sourceCard && (!sourcePort || card.image_binding.source.port_id === sourcePort))
      return { message: '请先取消或替换已采用主图来源', cardId: card.id, segmentId: 'image', referenceId: 'image' }
    if ('examples' in card) for (const example of card.examples || []) {
      if (example.source.card_id === sourceCard && (!sourcePort || example.source.port_id === sourcePort)) return { message: '请先取消示例关联', cardId: card.id, segmentId: example.id, referenceId: example.id }
    }
    for (const binding of card.input_bindings || []) {
      if (binding.source.canvas_id !== document.id || binding.source.card_id !== sourceCard || sourcePort && binding.source.port_id !== sourcePort) continue
      const ref = referencesIn(editorPrompt(card)).find(reference => reference.binding_id === binding.id)
      return { message: '请先清理 ' + card.id + ' 的实际输入绑定 ' + binding.id, cardId: card.id, segmentId: ref?.id || binding.id, referenceId: ref?.id || binding.id }
    }
    for (const segment of editorPrompt(card).segments || []) {
      const refs = segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : []
      const ref = refs.find(item => item.source.canvas_id === document.id && item.source.card_id === sourceCard && (!sourcePort || item.source.port_id === sourcePort))
      if (ref) return { message: `请先清理 ${card.id} 的引用 ${ref.id}（${segment.kind === 'instruction' ? '指令配置' : '正文'}）`, cardId: card.id, segmentId: segment.id, referenceId: ref.id }
    }
  }
}
