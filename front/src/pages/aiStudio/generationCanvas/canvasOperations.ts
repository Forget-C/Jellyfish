import type { CanvasDocument, CanvasModelCapability, NamedImageReferenceCard } from '../../../services/generated'
import { connect, disconnect, findConnection, cleanDirectDesignCandidates, isIndependentDesignEdge } from './graphRules'
import type { GenerationCard, GenerationEdge } from './graphRules'
import { referenceProtection } from './promptRules'
import { cleanReferenceImageSources } from './referenceCardRules'

type Protection = NonNullable<ReturnType<typeof referenceProtection>>
export type CanvasOperationResult = { document: CanvasDocument; reason?: never; protection?: never } | { reason: string; protection?: Protection; document?: never }
type ConnectionReason = (document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability) => string | undefined

/** Stateless document operations. Callers commit successful results once and retain
 * ownership, confirmation, geometry and history; server validation remains authoritative. */
export function createCanvasOperations({ connectionReason }: { connectionReason: ConnectionReason }) {
  const stackFor = (document: CanvasDocument, id: string) => document.groups?.find(group => group.kind === 'stack' && group.card_ids?.includes(id))
  const addConnection = (document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability): CanvasOperationResult => {
    if (findConnection(document, edge)) return { document }
    const reason = connectionReason(document, edge, capability)
    return reason ? { reason } : { document: connect(document, edge) }
  }
  return {
    clean: (document: CanvasDocument) => cleanDirectDesignCandidates(cleanReferenceImageSources(document)),
    connect: addConnection,
    check(document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability) {
      if (findConnection(document, edge)) return undefined
      const target = document.cards?.find(card => card.id === edge.target_card)
      if (target && 'model_id' in target && !capability) return '模型能力尚未核实，暂不能新建连接'
      return connectionReason(document, edge, capability)
    },
    update(document: CanvasDocument, next: GenerationCard): CanvasOperationResult {
      if (stackFor(document, next.id)) return { reason: '请先解除堆叠后编辑' }
      let changed: CanvasDocument = { ...document, cards: document.cards?.map(card => card.id === next.id ? next : card) }
      if (next.type?.startsWith('model.') && 'input_bindings' in next) {
        for (const edge of document.edges || []) if (edge.target_card === next.id && isIndependentDesignEdge(document, edge) && !next.input_bindings?.some(binding => binding.source.card_id === edge.source_card && binding.source.port_id === edge.source_port && binding.input_port === edge.target_port)) changed = disconnect(changed, edge.id)
      }
      if ('name' in next) changed.cards = changed.cards?.map(card => card.type?.startsWith('reference.') && 'name_binding' in card && card.name_binding?.card_id === next.id ? { ...card, name: next.name } : card)
      // 名称选择或画布选图同次保存直接来源边；既有候选、几何与采用身份不改写。
      if (next.type?.startsWith('reference.')) {
        const reference = next as NamedImageReferenceCard
        const sources = [...(reference.name_binding ? [{ source: reference.name_binding, port: 'name' }] : []), ...(reference.image_binding?.source ? [{ source: reference.image_binding.source, port: 'image_source' }] : [])]
        for (const { source, port } of sources) {
          const edge = { id: crypto.randomUUID(), source_card: source.card_id, source_port: source.port_id, target_card: next.id, target_port: port }
          const result = addConnection(changed, edge)
          if (!result.document) return result
          changed = result.document
        }
      }
      return { document: changed }
    },
    /** Copy incoming candidates with fresh identities while preserving each port's order. */
    copyIncoming(document: CanvasDocument, sourceId: string, copy: GenerationCard): CanvasOperationResult {
      const incoming = (document.edges || []).filter(edge => edge.target_card === sourceId)
      const edgeIds = new Map(incoming.map(edge => [edge.id, crypto.randomUUID()]))
      let changed: CanvasDocument = { ...document, cards: [...(document.cards || []), copy] }
      for (const edge of incoming) {
        const result = addConnection(changed, { ...edge, id: edgeIds.get(edge.id)!, target_card: copy.id })
        if (!result.document) return result
        changed = result.document
      }
      return { document: { ...changed, input_order: { ...changed.input_order, [copy.id]: Object.fromEntries(Object.entries(document.input_order?.[sourceId] || {}).map(([port, ids]) => [port, ids.map(id => edgeIds.get(id)!)])) } } }
    },
    remove(document: CanvasDocument, ids: string[], busyCards: Set<string>, cardLabel: (id: string) => string): CanvasOperationResult {
      const blocked = ids.find(id => stackFor(document, id) || document.edges?.some(edge => edge.source_card === id && stackFor(document, edge.target_card)) || busyCards.has(id))
      if (blocked) return { reason: `${cardLabel(blocked)}：${busyCards.has(blocked) ? '卡片正在运行，结束前不可删除' : '请先解除相关堆叠后删除'}` }
      for (const id of ids) {
        const protection = referenceProtection(document, id)
        if (protection) return { reason: protection.message, protection }
      }
      let next = document
      for (const edge of next.edges || []) if (ids.includes(edge.source_card) || ids.includes(edge.target_card)) next = disconnect(next, edge.id)
      const order = { ...next.input_order }; ids.forEach(id => delete order[id])
      return { document: { ...next, cards: next.cards?.filter(card => !ids.includes(card.id)), input_order: order,
        groups: next.groups?.map(group => ({ ...group, card_ids: group.card_ids?.filter(card => !ids.includes(card)) })) } }
    },
    disconnect(document: CanvasDocument, edge: GenerationEdge): CanvasOperationResult {
      if (stackFor(document, edge.target_card)) return { reason: '请先解除堆叠后删除输入连线' }
      if (referenceProtection(document, edge.source_card, edge.target_card, edge.source_port, edge.target_port)) return { reason: '此连线仍有输入被引用，请先取消引用后再删除' }
      return { document: disconnect(document, edge.id) }
    },
  }
}
