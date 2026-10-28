import type { CanvasDocument, OutputIdentity } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { editorPrompt } from './inputBindings'
import type { EditorPromptDocument as PromptDocument, EditorPromptReference as PromptReference } from './inputBindings'
export type Candidate = { source: OutputIdentity; token: string; available: boolean }
export const sourceKey = (source: OutputIdentity) => JSON.stringify([source.canvas_id, source.card_id, source.port_id, source.position])
export const referencesIn = (prompt?: PromptDocument): PromptReference[] => (prompt?.segments || []).flatMap(segment => segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : [])
export function referenceIssue(document: CanvasDocument, _receiver: GenerationCard, source: OutputIdentity, candidates: Candidate[] = []) {
  if (source.canvas_id !== document.id) return '来源属于其他画布'
  const item = candidates.find(candidate => sourceKey(candidate.source) === sourceKey(source))
  return !item ? '来源未连接' : !item.available ? '来源输出缺失' : ''
}
/** 清理引用与删边/来源可以在同一份最终编辑文档里完成。 */
export function referenceProtection(document: CanvasDocument, sourceCard: string, receiverId?: string, sourcePort?: string) {
  for (const card of document.cards || []) if ('prompt' in card && (!receiverId || card.id === receiverId)) {
    for (const segment of editorPrompt(card).segments || []) {
      const refs = segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : []
      const ref = refs.find(item => item.source.canvas_id === document.id && item.source.card_id === sourceCard && (!sourcePort || item.source.port_id === sourcePort))
      if (ref) return { message: `请先清理 ${card.id} 的引用 ${ref.id}（${segment.kind === 'instruction' ? '指令配置' : '正文'}）`, cardId: card.id, segmentId: segment.id, referenceId: ref.id }
    }
  }
}
