import type { CanvasDocument, OutputIdentity, PromptDocument, PromptReference } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
export type Candidate = { source: OutputIdentity; token: string; available: boolean }
export const sourceKey = (source: OutputIdentity) => JSON.stringify([source.canvas_id, source.card_id, source.port_id, source.position])
export const referencesIn = (prompt?: PromptDocument): PromptReference[] => (prompt?.segments || []).flatMap(segment => segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : [])
const labels: Record<string, string> = { text: '文本', image: '图片', video: '视频', audio: '音频' }
/** 候选身份不按文件合并，缺失位置只为已有引用保留。 */
export function promptCandidates(document: CanvasDocument, receiver: GenerationCard): Candidate[] {
  const refs = referencesIn('prompt' in receiver ? receiver.prompt : undefined), result: Candidate[] = [], seen = new Set<string>(), counts: Record<string, number> = {}
  for (const ids of Object.values(document.input_order?.[receiver.id] || {})) for (const id of ids) {
    const edge = document.edges?.find(item => item.id === id), card = document.cards?.find(item => item.id === edge?.source_card)
    if (!edge || !card) continue
    const available = 'text' in card ? !!card.text : 'file_id' in card && !!card.file_id && !card.uploading
    const sources: OutputIdentity[] = available ? [{ canvas_id: document.id, card_id: card.id, port_id: edge.source_port, position: 0 }] : []
    for (const ref of refs) if (ref.source.canvas_id === document.id && ref.source.card_id === card.id && ref.source.port_id === edge.source_port && !sources.some(source => sourceKey(source) === sourceKey(ref.source))) sources.push(ref.source)
    for (const source of sources.sort((a, b) => a.position - b.position)) {
      const key = sourceKey(source)
      if (seen.has(key)) continue
      seen.add(key); counts[source.port_id] = (counts[source.port_id] || 0) + 1
      result.push({ source, token: `@${labels[source.port_id]}${counts[source.port_id]}`, available: available && source.position === 0 })
    }
  }
  return result
}
export function referenceIssue(document: CanvasDocument, receiver: GenerationCard, source: OutputIdentity) {
  if (source.canvas_id !== document.id) return '来源属于其他画布'
  const item = promptCandidates(document, receiver).find(candidate => sourceKey(candidate.source) === sourceKey(source))
  return !item ? '来源未连接' : !item.available ? '来源输出缺失' : ''
}
/** 清理引用与删边/来源可以在同一份最终编辑文档里完成。 */
export function referenceProtection(document: CanvasDocument, sourceCard: string, receiverId?: string, sourcePort?: string) {
  for (const card of document.cards || []) if ('prompt' in card && (!receiverId || card.id === receiverId)) {
    for (const segment of card.prompt?.segments || []) {
      const refs = segment.kind === 'reference' ? [segment] : segment.kind === 'instruction' ? segment.references || [] : []
      const ref = refs.find(item => item.source.canvas_id === document.id && item.source.card_id === sourceCard && (!sourcePort || item.source.port_id === sourcePort))
      if (ref) return { message: `请先清理 ${card.id} 的引用 ${ref.id}（${segment.kind === 'instruction' ? '指令配置' : '正文'}）`, cardId: card.id, segmentId: segment.id, referenceId: ref.id }
    }
  }
}
