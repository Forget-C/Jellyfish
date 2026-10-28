import type { CanvasDocument, CanvasModelCapability } from '../../../services/generated'

export type GenerationCard = NonNullable<CanvasDocument['cards']>[number]
export type GenerationEdge = NonNullable<CanvasDocument['edges']>[number]
export const cardTitles: Record<string, string> = {
  'reference.character': '角色参考卡', 'reference.place': '场所参考卡', 'reference.prop': '道具参考卡', 'reference.costume': '服装参考卡',
  'content.object': '人物／物件描述卡', 'content.place': '场所描述卡', 'content.text': '文本内容卡', 'content.basis': '原文／创作依据卡', 'content.image': '图片内容卡', 'content.video': '视频内容卡', 'content.audio': '音频内容卡',
  'model.text': '文本模型卡', 'model.image': '图片模型卡', 'model.video': '视频模型卡',
}
export const portLabels: Record<string, string> = { name: '名称关联', image_source: '图片来源', object: '对象引用', text: '文本', image: '参考图片', video: '视频', audio: '音频',
  first_frame: '首帧', last_frame: '尾帧', key_frame: '关键帧', subject_image: '主体图片', subject_video: '主体视频' }
const modality: Record<string, string> = { name: 'object_reference', image_source: 'image', object: 'object_reference', text: 'text', image: 'image', video: 'video', audio: 'audio',
  first_frame: 'image', last_frame: 'image', key_frame: 'image', subject_image: 'image', subject_video: 'video' }
const declaredOutputs: Record<string, string[]> = { 'reference.character': ['image', 'object'], 'reference.place': ['image', 'object'], 'reference.prop': ['image', 'object'], 'reference.costume': ['image', 'object'], 'content.object': ['text', 'object'], 'content.place': ['text', 'object'], 'content.text': ['text'], 'content.basis': ['text'], 'content.image': ['image'], 'content.video': ['video'], 'content.audio': ['audio'], 'model.text': ['text'], 'model.image': ['image'], 'model.video': ['video'] }
export const outputPorts = (card: GenerationCard) => declaredOutputs[card.type || ''] || []
export const inputPorts = (card: GenerationCard) => card.type?.startsWith('reference.') ? ['name', 'image_source'] : card.type === 'model.text' ? ['text'] : card.type === 'model.image' ? ['text', 'image']
  : card.type === 'model.video' ? ['text', 'first_frame', 'last_frame', 'key_frame', 'subject_image', 'subject_video'] : []

/** 保存后的既有候选不随模型切换删除；这个判断只用于创建新连接。 */
export function connectionReason(document: CanvasDocument, edge: GenerationEdge, capability?: CanvasModelCapability): string | undefined {
  const source = document.cards?.find(card => card.id === edge.source_card), target = document.cards?.find(card => card.id === edge.target_card)
  if (!source || !target || !outputPorts(source).includes(edge.source_port) || !inputPorts(target).includes(edge.target_port)) return '连接端点不存在'
  if (source.id === target.id) return '卡片不能连接自身'
  if (modality[edge.source_port] !== modality[edge.target_port]) return '端口模态不匹配，不提供隐式转换'
  if (capability && (!capability.input_ports.includes(edge.target_port) || target.type !== `model.${capability.modality}`)) return '所选模型未接入该输入用途'
  const edges = document.edges || []
  if (edges.some(item => item.source_card === edge.source_card && item.source_port === edge.source_port && item.target_card === edge.target_card && item.target_port === edge.target_port)) return '同一端口连接已存在'
  const pending = [edge.target_card], seen = new Set<string>()
  while (pending.length) {
    const id = pending.pop()!
    if (id === edge.source_card) return '候选连接不能形成循环'
    if (!seen.has(id)) { seen.add(id); edges.filter(item => item.source_card === id).forEach(item => pending.push(item.target_card)) }
  }
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
