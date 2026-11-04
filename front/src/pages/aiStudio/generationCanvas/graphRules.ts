import type { CanvasCatalog, CanvasDocument, CanvasModelCapability } from '../../../services/generated'

export type GenerationCard = NonNullable<CanvasDocument['cards']>[number]
export type GenerationEdge = NonNullable<CanvasDocument['edges']>[number]
/** 候选四元组身份与几何侧边无关，用于校验去重和定位已有关系。 */
export function findConnection(document: CanvasDocument, edge: GenerationEdge) {
  return document.edges?.find(item => item.source_card === edge.source_card && item.source_port === edge.source_port && item.target_card === edge.target_card && item.target_port === edge.target_port)
}
/** 静态端点来自后端公开目录；这里只组织显示与即时无环提示。 */
export function createGraphRules(catalog: CanvasCatalog) {
  const cardDefinitions = Object.fromEntries(catalog.cards.map(card => [card.type, card]))
  const cardTitles = Object.fromEntries(catalog.cards.map(card => [card.type, card.title]))
  const portLabels = Object.fromEntries(catalog.cards.flatMap(card => [...card.outputs, ...card.inputs].map(port => [port.id, port.label])))
  const outputPorts = (card: GenerationCard) => cardDefinitions[card.type || '']?.outputs.map(port => port.id) || []
  const inputPorts = (card: GenerationCard) => cardDefinitions[card.type || '']?.inputs.map(port => port.id) || []
/** 保存后的既有候选不随模型切换删除；这个判断只用于创建新连接。 */
function connectionReason(document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability): string | undefined {
  const source = document.cards?.find(card => card.id === edge.source_card), target = document.cards?.find(card => card.id === edge.target_card)
  if (!source || !target || !outputPorts(source).includes(edge.source_port) || !inputPorts(target).includes(edge.target_port)) return '连接端点不存在'
  if (target.type?.startsWith('reference.') && edge.target_port === 'image_source' && source.type !== 'content.image') return '参考图仅支持图片内容卡，请先另存为图片内容卡'
  if (target.type?.startsWith('reference.') && edge.target_port === 'name' && source.type !== 'content.' + target.type.split('.')[1]) return '名称候选必须来自同类型描述卡'
  if (source.id === target.id) return '卡片不能连接自身'
  const output = cardDefinitions[source.type || '']?.outputs.find(port => port.id === edge.source_port)
  const input = cardDefinitions[target.type || '']?.inputs.find(port => port.id === edge.target_port)
  if (!output || !input?.accepts.includes(output.value_kind)) return '端口值种类不匹配，不提供隐式转换'
  if (capability && (!capability.input_ports.includes(edge.target_port) || target.type !== `model.${capability.modality}`)) return '所选模型未接入该输入用途'
  const edges = document.edges || []
  if (findConnection(document, edge)) return '同一端口连接已存在'
  const pending = [edge.target_card], seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === edge.source_card) return '候选连接不能形成循环'
    if (!seen.has(id)) { seen.add(id); edges.filter(item => item.source_card === id).forEach(item => pending.push(item.target_card)) }
  }
}

  const sourceOptions = (document: CanvasDocument, sourceId: string, targetId: string): GenerationEdge[] => {
    const source = document.cards?.find(card => card.id === sourceId), target = document.cards?.find(card => card.id === targetId)
    if (!source || !target) return []
    return (cardDefinitions[source.type || '']?.outputs || []).flatMap(output => (cardDefinitions[target.type || '']?.inputs || []).filter(input => input.accepts.includes(output.value_kind)).map(input => ({ id: '', source_card: sourceId, source_port: output.id, target_card: targetId, target_port: input.id })))
  }
  return { catalog, cardDefinitions, cardTitles, portLabels, inputPorts, outputPorts, connectionReason, sourceOptions }
}

/** 设计正文仅在模型独立文本输入中随线生效，业务身份和素材仍为候选。 */
export function isIndependentDesignEdge(document: CanvasDocument, edge: GenerationEdge) {
  const source = document.cards?.find(card => card.id === edge.source_card), target = document.cards?.find(card => card.id === edge.target_card)
  return !!source?.type?.startsWith('direction.') && edge.source_port === 'text' && !!target?.type?.startsWith('model.') && edge.target_port === 'text'
}

/** 设计来源在卡间共享一条来源连接，内部用途边保留原身份和独立顺序。 */
export function sourceConnectionEdges(document: CanvasDocument, edge: GenerationEdge) {
  return document.cards?.some(card => card.id === edge.source_card && card.type?.startsWith('direction.'))
    ? (document.edges || []).filter(item => item.source_card === edge.source_card && item.target_card === edge.target_card) : [edge]
}

export function visibleSourceEdges(document: CanvasDocument) {
  return (document.edges || []).filter(edge => sourceConnectionEdges(document, edge)[0]?.id === edge.id)
}

/** 每个接收端口独立排序；位置、分组和模型身份均不参与排序。 */
export function connect(document: CanvasDocument, edge: GenerationEdge, automatic = true): CanvasDocument {
  const source = document.cards?.find(card => card.id === edge.source_card)
  const independent = isIndependentDesignEdge(document, edge)
  const cards = !automatic ? document.cards : independent ? document.cards?.map(card => card.id === edge.target_card && 'prompt' in card && !card.input_bindings?.some(binding => binding.input_port === 'text' && binding.source.card_id === edge.source_card && binding.source.port_id === 'text') ? { ...card, input_bindings: [...(card.input_bindings || []), { id: 'design:' + edge.id, input_port: 'text', prompt_owned: false, source: { canvas_id: document.id, card_id: edge.source_card, port_id: 'text', position: 0 } }] } : card) : edge.source_port === 'criterion' && edge.target_port === 'acceptance_basis' && source && 'criterion_id' in source
    ? document.cards?.map(card => card.id === edge.target_card && 'input_bindings' in card ? { ...card, input_bindings: [...(card.input_bindings || []).filter(binding => !(binding.input_port === 'acceptance_basis' && binding.source.card_id === source.id)), { id: 'acceptance:' + edge.id, input_port: 'acceptance_basis', source: { canvas_id: document.id, card_id: source.id, port_id: 'criterion', position: 0, object_id: source.criterion_id } }] } : card) : document.cards
  return { ...document, cards, edges: [...(document.edges || []), edge], input_order: { ...document.input_order,
    [edge.target_card]: { ...document.input_order?.[edge.target_card], [edge.target_port]: [...(document.input_order?.[edge.target_card]?.[edge.target_port] || []), edge.id] } } }
}
export function disconnect(document: CanvasDocument, id: string): CanvasDocument {
  const order = Object.fromEntries(Object.entries(document.input_order || {}).map(([card, ports]) => [card,
    Object.fromEntries(Object.entries(ports).map(([port, ids]) => [port, ids.filter(edge => edge !== id)]))]))
  const edge = document.edges?.find(item => item.id === id)
  const cards = edge && isIndependentDesignEdge(document, edge) ? document.cards?.map(card => card.id === edge.target_card && 'input_bindings' in card ? { ...card, input_bindings: card.input_bindings?.filter(binding => !(binding.input_port === 'text' && binding.source.card_id === edge.source_card && binding.source.port_id === 'text')) } : card) : edge?.source_port === 'criterion' && edge.target_port === 'acceptance_basis'
    ? document.cards?.map(card => card.id === edge.target_card && 'input_bindings' in card ? { ...card, input_bindings: card.input_bindings?.filter(binding => !(binding.input_port === edge.target_port && binding.source.card_id === edge.source_card && binding.source.port_id === edge.source_port)) } : card) : document.cards
  return { ...document, cards, edges: document.edges?.filter(edge => edge.id !== id), input_order: order }
}

/** 清理旧的未采用独立设计及验收候选，避免升级时增加生成输入。 */
export function cleanDirectDesignCandidates(document: CanvasDocument): CanvasDocument {
  let next = document
  for (const edge of document.edges || []) {
    if (sourceConnectionEdges(document, edge).length > 1) continue
    if (!isIndependentDesignEdge(document, edge) && (edge.source_port !== 'criterion' || edge.target_port !== 'acceptance_basis')) continue
    const card = document.cards?.find(item => item.id === edge.target_card)
    if (!card || !('input_bindings' in card) || !card.input_bindings?.some(binding => binding.input_port === edge.target_port && binding.source.card_id === edge.source_card && binding.source.port_id === edge.source_port)) next = disconnect(next, edge.id)
    else if (isIndependentDesignEdge(document, edge) && card.input_bindings?.some(binding => binding.source.card_id === edge.source_card && binding.source.port_id === edge.source_port && binding.input_port === edge.target_port && binding.prompt_owned !== false)) next = { ...next, cards: next.cards?.map(item => item.id === card.id && 'input_bindings' in item ? { ...item, input_bindings: item.input_bindings?.map(binding => binding.source.card_id === edge.source_card && binding.source.port_id === edge.source_port && binding.input_port === edge.target_port ? { ...binding, prompt_owned: false } : binding) } : item) }
  }
  return next
}
