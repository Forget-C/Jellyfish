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
  if (target.type?.startsWith('reference.') && source.type?.startsWith('reference.') && target.type !== source.type) return '参考图片类别与目标参考卡不匹配'
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

  return { catalog, cardDefinitions, cardTitles, portLabels, inputPorts, outputPorts, connectionReason }
}

/** 每个接收端口独立排序；位置、分组和模型身份均不参与排序。 */
export function connect(document: CanvasDocument, edge: GenerationEdge): CanvasDocument {
  return { ...document, edges: [...(document.edges || []), edge], input_order: { ...document.input_order,
    [edge.target_card]: { ...document.input_order?.[edge.target_card], [edge.target_port]: [...(document.input_order?.[edge.target_card]?.[edge.target_port] || []), edge.id] } } }
}
export function disconnect(document: CanvasDocument, id: string): CanvasDocument {
  const order = Object.fromEntries(Object.entries(document.input_order || {}).map(([card, ports]) => [card,
    Object.fromEntries(Object.entries(ports).map(([port, ids]) => [port, ids.filter(edge => edge !== id)]))]))
  return { ...document, edges: document.edges?.filter(edge => edge.id !== id), input_order: order }
}
