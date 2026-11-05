import type { CanvasDocument } from '../../../services/generated'

/** 已落地退役的类型；恢复旧编辑记录时同样禁止重建通用对象用途。 */
const retiredObjectTypes = new Set(['direction.criterion'])
const candidatePort = (type: string) => type.startsWith('reference.') || ['content.image', 'model.image'].includes(type) ? 'image'
  : ['content.video', 'model.video'].includes(type) ? 'video'
    : type.startsWith('direction.') || type.startsWith('content.') && !['content.image', 'content.video', 'content.audio'].includes(type) || type === 'model.text' ? 'text' : undefined

/** 只撤回已废弃用途；同源其他采用保持，剩余来源成为合法候选而非自动引用。 */
export function cleanObjectSources(document: CanvasDocument): CanvasDocument {
  const retired = new Set(document.cards?.filter(card => retiredObjectTypes.has(card.type || '')).map(card => card.id))
  const dropped = document.edges?.filter(edge => retired.has(edge.target_card) && edge.target_port === 'effect_object') || []
  if (!dropped.length && !document.cards?.some(card => retired.has(card.id) && 'input_bindings' in card && card.input_bindings?.some(binding => binding.input_port === 'effect_object'))) return document
  const next = structuredClone(document)
  next.cards = next.cards?.map(card => retired.has(card.id) && 'input_bindings' in card ? { ...card, input_bindings: card.input_bindings?.filter(binding => binding.input_port !== 'effect_object') } : card)
  const ids = new Set(dropped.map(edge => edge.id))
  next.edges = next.edges?.filter(edge => !ids.has(edge.id)) || []
  next.input_order = Object.fromEntries(Object.entries(next.input_order || {}).map(([id, ports]) => [id, Object.fromEntries(Object.entries(ports).filter(([port]) => !retired.has(id) || port !== 'effect_object').map(([port, edges]) => [port, edges.filter(edge => !ids.has(edge))]))]))
  for (const edge of dropped) {
    const source = document.cards?.find(card => card.id === edge.source_card)
    const port = candidatePort(source?.type || '')
    if (!port || next.edges.some(item => item.source_card === edge.source_card && item.source_port === port && item.target_card === edge.target_card && item.target_port === port)) continue
    next.edges.push({ ...edge, source_port: port, target_port: port })
    const order = next.input_order[edge.target_card] ||= {}
    ;(order[port] ||= []).push(edge.id)
  }
  return next
}
