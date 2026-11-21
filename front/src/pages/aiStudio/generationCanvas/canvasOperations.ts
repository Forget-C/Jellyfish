import { uiText } from '../../../uiText'
import { fixedCanvasSource } from './fixedCanvasSource'
import { cleanConnectionDocument } from './connectionCleanup'
import type { CanvasDocument, CanvasModelCapability, CanvasResolvedOutput, NamedImageReferenceCard } from '../../../services/generated'
import { findConnection, sourceConnectionEdges } from './graphRules'
import { resultScopeIncludes, resultScopeWithPosition, sameResultConnection } from './resultConnections'
import type { GenerationCard, GenerationEdge, createGraphRules } from './graphRules'
import { referenceProtection, sourceKey } from './promptRules'
import { cleanObjectSources } from './objectSourceCleanup'
import { retargetResultReferences } from './detachedResults'

type Protection = NonNullable<ReturnType<typeof referenceProtection>>
export type CanvasOperationResult = { document: CanvasDocument; reason?: never; protection?: never } | { reason: string; protection?: Protection; confirmFrame?: boolean; document?: never }


/** Stateless document operations. Callers commit successful results once and retain
 * ownership, confirmation, geometry and history; server validation remains authoritative. */
export function createCanvasOperations({ connectionReason, sourceOptions, connectionPolicy, cardDefinitions, connect, disconnect, cleanDirectDesignCandidates }: ReturnType<typeof createGraphRules>) {
  const stackFor = (document: CanvasDocument, id: string) => document.groups?.find(group => group.kind === 'stack' && group.card_ids?.includes(id))
  const addConnection = (document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability): CanvasOperationResult => {
    if (findConnection(document, edge)) return { document }
    const reason = connectionReason(document, edge, capability)
    if (reason) return { reason }
    let changed = connect(document, edge)
    // 静态用途随来源开放；模型能力只限制新连接能否建立及实际采用。
    for (const option of sourceOptions(document, edge.source_card, edge.target_card)) {
      if (!findConnection(changed, option)) changed = connect(changed, { ...option, id: crypto.randomUUID(), result_scope: sameResultConnection(edge, option) ? edge.result_scope : undefined }, false)
    }
    return { document: changed }
  }
  const updateResultScope = (document: CanvasDocument, edge: GenerationEdge, position: number, include: boolean) => {
    const scope = resultScopeWithPosition(edge.result_scope, position, include)
    if (scope !== null) return { ...document, edges: document.edges?.map(member => sameResultConnection(member, edge) ? { ...member, result_scope: scope } : member) }
    return (document.edges || []).filter(member => sameResultConnection(member, edge)).reduce((next, member) => disconnect(next, member.id), document)
  }
  return {
    clean: (document: CanvasDocument) => cleanConnectionDocument(cleanObjectSources(document), { connectionPolicy, cardDefinitions, cleanDirectDesignCandidates, sourceOptions }),
    connect: addConnection,
    connectResult(document: CanvasDocument, edge: GenerationEdge, position: number, capability?: CanvasModelCapability): CanvasOperationResult {
      const existing = findConnection(document, edge)
      if (!existing) return addConnection(document, { ...edge, result_scope: { mode: 'only', positions: [position] } }, capability)
      if (resultScopeIncludes(existing.result_scope, position)) return { document }
      const reason = connectionReason(document, edge, capability, true)
      return reason ? { reason } : { document: updateResultScope(document, existing, position, true) }
    },
    disconnectResult(document: CanvasDocument, edge: GenerationEdge, position: number): CanvasOperationResult {
      if (stackFor(document, edge.target_card)) return { reason: '请先解除堆叠后删除输入连线' }
      const protection = referenceProtection(document, connectionPolicy, edge.source_card, edge.target_card, [], { port_id: edge.source_port, position })
      if (protection) return { reason: '此连线仍有输入被引用，请先解除全部引用：' + protection.message, protection }
      const existing = findConnection(document, edge)
      return { document: existing && resultScopeIncludes(existing.result_scope, position)
        ? updateResultScope(document, existing, position, false) : document }
    },
    /** 同一文档快照内移交结果、候选和引用，保留原用途内的实际输入排列。 */
    detachResult(document: CanvasDocument, output: CanvasResolvedOutput, fixed: GenerationCard): CanvasOperationResult {
      const source = output.source, resultSetId = output.result_set_id
      const model = document.cards?.find(card => card.id === source.card_id)
      if (!model || !('prompt' in model) || !resultSetId || source.canvas_id !== document.id || fixed.type !== 'content.' + source.port_id) {
        return { reason: '当前正式结果不可固定' }
      }
      const marker = { position: source.position, result_set_id: resultSetId, content_card_id: fixed.id }
      if (model.detached_results?.some(item => item.position === marker.position && item.result_set_id === resultSetId)) {
        return { reason: '此结果已固定' }
      }
      if (stackFor(document, model.id)) return { reason: '请先解除生成卡堆叠后固定结果' }
      const outgoing = (document.edges || []).filter(edge => edge.source_card === source.card_id
        && edge.source_port === source.port_id && resultScopeIncludes(edge.result_scope, source.position))
      const targets = new Set(outgoing.map(edge => edge.target_card))
      if ([...targets].some(id => stackFor(document, id))) return { reason: '请先解除下游堆叠后固定结果' }
      const nextSource = { canvas_id: document.id, card_id: fixed.id, port_id: source.port_id, position: 0 }
      let next: CanvasDocument = { ...document, cards: [...(document.cards || []).map(card => card.id === model.id
        ? { ...model, detached_results: [...(model.detached_results || []).filter(item => item.position !== marker.position), marker] }
        : retargetResultReferences(card, source, nextSource, targets.has(card.id))), fixed] }
      for (const target of targets) {
        const edge = outgoing.find(item => item.target_card === target)!
        next = updateResultScope(next, edge, source.position, false)
      }
      for (const edge of outgoing) {
        const survives = next.edges?.some(item => item.id === edge.id)
        const replacement = { id: crypto.randomUUID(), source_card: fixed.id, source_port: source.port_id,
          target_card: edge.target_card, target_port: edge.target_port,
          ...(survives ? { order_anchor: { edge_id: edge.id, position: source.position } } : {}) }
        if (!connectionPolicy(next, replacement)) return { reason: '下游的原用途无法接收此固定内容' }
        next = connect(next, replacement, false)
        const priorOrder = document.input_order?.[edge.target_card]?.[edge.target_port] || []
        const siblings = (document.edges || []).filter(item => item.order_anchor?.edge_id === edge.id)
        const siblingIds = new Set(siblings.map(item => item.id))
        const group = [...siblings.map(item => ({ id: item.id, position: item.order_anchor!.position, index: priorOrder.indexOf(item.id) })),
          { id: replacement.id, position: source.position, index: priorOrder.indexOf(edge.id) }]
          .sort((a, b) => a.position - b.position || a.index - b.index).map(item => item.id)
        const order = priorOrder.flatMap(id => id === edge.id ? [...(survives ? [id] : []), ...group] : siblingIds.has(id) ? [] : [id])
        next.input_order = { ...next.input_order, [edge.target_card]: { ...next.input_order?.[edge.target_card], [edge.target_port]: order } }
      }
      return { document: next }
    },
    check(document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability, position?: number) {
      const existing = findConnection(document, edge)
      if (existing && (position === undefined || resultScopeIncludes(existing.result_scope, position))) return undefined
      const target = document.cards?.find(card => card.id === edge.target_card)
      if (target && 'model_id' in target && !capability) return '模型能力尚未核实，暂不能新建连接'
      return connectionReason(document, edge, capability, position !== undefined)
    },
    update(document: CanvasDocument, next: GenerationCard, capability?: CanvasModelCapability): CanvasOperationResult {
      if (fixedCanvasSource(document, next.id)) return { reason: '固定原文不可修改' }
      if (stackFor(document, next.id)) return { reason: '请先解除堆叠后编辑' }
      const previous = document.cards?.find(card => card.id === next.id)
      if ('prompt' in next && previous && 'prompt' in previous && previous.model_id === next.model_id) {
        const bindings = next.input_bindings || []
        const added = bindings.filter(binding => !previous.input_bindings?.some(prior => prior.id === binding.id
          && prior.input_port === binding.input_port && sourceKey(prior.source) === sourceKey(binding.source)))
        if (capability && added.some(binding => !capability.input_ports.includes(binding.input_port))) return { reason: '当前模型不支持新增采用的用途' }
        const singles = cardDefinitions[next.type || '']?.inputs.filter(input => input.max_sources === 1) || []
        const conflict = singles.find(input => added.some(binding => binding.input_port === input.id) && bindings.filter(binding => binding.input_port === input.id).length > 1)
        if (conflict) return { reason: `${conflict.label}只能采用一项，请在来源浮层明确替换` }
      }
      let changed: CanvasDocument = { ...document, cards: document.cards?.map(card => card.id === next.id ? next : card) }
      if ('input_bindings' in next) {
        for (const edge of document.edges || []) if (edge.target_card === next.id && connectionPolicy(document, edge)?.cancel === 'remove_connection' && !next.input_bindings?.some(binding => binding.source.card_id === edge.source_card && binding.source.port_id === edge.source_port && binding.input_port === edge.target_port)) changed = disconnect(changed, edge.id)
      }
      // 已明确选择内容与用途时，一次更新同时补足直接来源边。
      if ('input_bindings' in next) for (const binding of next.input_bindings || []) {
        const edge = { id: crypto.randomUUID(), source_card: binding.source.card_id, source_port: binding.source.port_id, target_card: next.id, target_port: binding.input_port }
        const existing = findConnection(changed, edge)
        if (existing) {
          if (!resultScopeIncludes(existing.result_scope, binding.source.position)) return { reason: '此结果尚未连接' }
          continue
        }
        const result = addConnection(changed, edge)
        if (!result.document) return result
        changed = result.document
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
      let changed: CanvasDocument = { ...document, cards: [...(document.cards || []), copy] }
      for (const edge of incoming) {
        const result = addConnection(changed, { ...edge, id: crypto.randomUUID(), target_card: copy.id, order_anchor: undefined })
        if (!result.document) return result
        changed = result.document
      }
      const newIds = new Map(incoming.map(edge => [edge.id, findConnection(changed, { ...edge, target_card: copy.id })!.id]))
      const anchors = new Map(incoming.flatMap(edge => {
        const old = edge.order_anchor, edgeId = old && newIds.get(old.edge_id)
        return old && edgeId ? [[newIds.get(edge.id)!, { ...old, edge_id: edgeId }]] as const : []
      }))
      const order = Object.fromEntries(Object.entries(document.input_order?.[sourceId] || {}).map(([port, ids]) => [port, ids.map(id => newIds.get(id)!)]))
      return { document: { ...changed,
        edges: changed.edges?.map(edge => anchors.has(edge.id) ? { ...edge, order_anchor: anchors.get(edge.id) } : edge),
        input_order: { ...changed.input_order, [copy.id]: { ...changed.input_order?.[copy.id], ...order } } } }
    },
    remove(document: CanvasDocument, ids: string[], busyCards: Set<string>, cardLabel: (id: string) => string): CanvasOperationResult {
      if (ids.some(id => fixedCanvasSource(document, id))) return { reason: '固定原文不可删除' }
      const blocked = ids.find(id => stackFor(document, id) || document.edges?.some(edge => edge.source_card === id && stackFor(document, edge.target_card)) || busyCards.has(id))
      if (blocked) return { reason: `${cardLabel(blocked)}：${busyCards.has(blocked) ? '卡片正在运行，结束前不可删除' : '请先解除相关堆叠后删除'}` }
      // Only retained consumers can protect a source from a batch deletion.
      for (const id of ids) {
        const protection = referenceProtection(document, connectionPolicy, id, undefined, ids)
        if (protection) {
          const model = document.cards?.some(card => card.id === id && card.type?.startsWith('model.'))
          const message = model ? uiText("{{message}}。如需保留生成结果，请显示结果卡并断开它与生成卡的连线", { message: protection.message }) : protection.message
          return { reason: message, protection: { ...protection, message } }
        }
      }
      let next = document
      for (const edge of next.edges || []) if (ids.includes(edge.source_card) || ids.includes(edge.target_card)) next = disconnect(next, edge.id)
      const order = { ...next.input_order }; ids.forEach(id => delete order[id])
      return { document: { ...next, cards: next.cards?.filter(card => !ids.includes(card.id)), input_order: order,
        groups: next.groups?.map(group => ({ ...group, card_ids: group.card_ids?.filter(card => !ids.includes(card)) })) } }
    },
    disconnect(document: CanvasDocument, edge: GenerationEdge, confirmed = false): CanvasOperationResult {
      if (stackFor(document, edge.target_card)) return { reason: '请先解除堆叠后删除输入连线' }
      const members = sourceConnectionEdges(document, edge)
      const protection = referenceProtection(document, connectionPolicy, edge.source_card, edge.target_card)
      const target = document.cards?.find(card => card.id === edge.target_card)
      const frame = members.some(member => connectionPolicy(document, member)?.disconnect === 'confirm_frame') && target && 'frame_target' in target && target.frame_target?.card_id === edge.source_card
      const blockers = protection?.blockers.filter(item => !frame || item.referenceId !== 'frame_target') || []
      if (blockers.length) return { reason: '此连线仍有输入被引用，请先解除全部引用：' + blockers.map(item => item.message).join('；'), protection: { ...blockers[0], blockers } }
      if (frame && !confirmed) return { reason: '解除定位并断开？', confirmFrame: true }
      let changed = frame ? { ...document, cards: document.cards?.map(card => card.id === edge.target_card && 'frame_target' in card ? { ...card, frame_target: null } : card) } : document
      for (const member of members) changed = disconnect(changed, member.id)
      return { document: changed }
    },
  }
}
