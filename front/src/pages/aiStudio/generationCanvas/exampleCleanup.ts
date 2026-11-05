import type { CanvasDocument } from '../../../services/generated'

const retiredTypes = new Set(['direction.creative_control', 'direction.guidance', 'direction.criterion', 'direction.situation', 'direction.performance', 'direction.performance_rule', 'direction.shot', 'direction.blocking', 'direction.activity', 'direction.environment', 'direction.space_rule', 'direction.continuity', 'direction.fact', 'direction.narrative', 'direction.beat', 'direction.event'])
const ports: Record<string, string> = { image_example: 'image', video_example: 'video', audio_example: 'audio' }

/** 清理编辑和撤销恢复中的旧示例；连接仅转为候选，不制造实际引用。 */
export function cleanExamples(document: CanvasDocument): CanvasDocument {
  const retired = new Set(document.cards?.filter(card => retiredTypes.has(card.type || '')).map(card => card.id))
  const dropped = document.edges?.filter(edge => retired.has(edge.target_card) && ports[edge.target_port]) || []
  if (!dropped.length && !document.cards?.some(card => retired.has(card.id) && 'examples' in card && card.examples?.length)) return document
  const next = structuredClone(document)
  next.cards = next.cards?.map(card => retired.has(card.id) && 'examples' in card ? { ...card, examples: [] } : card)
  const ids = new Set(dropped.map(edge => edge.id))
  next.edges = next.edges?.filter(edge => !ids.has(edge.id)) || []
  next.input_order = Object.fromEntries(Object.entries(next.input_order || {}).map(([id, values]) => [id, Object.fromEntries(Object.entries(values).filter(([port]) => !retired.has(id) || !ports[port]).map(([port, edges]) => [port, edges.filter(edge => !ids.has(edge))]))]))
  for (const edge of dropped) {
    const port = ports[edge.target_port]
    if (edge.source_port !== port || next.edges.some(item => item.source_card === edge.source_card && item.source_port === edge.source_port && item.target_card === edge.target_card && item.target_port === port)) continue
    next.edges.push({ ...edge, target_port: port })
    const order = next.input_order[edge.target_card] ||= {}
    ;(order[port] ||= []).push(edge.id)
  }
  return next
}
