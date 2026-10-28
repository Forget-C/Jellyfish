import type { CanvasDocument, CanvasModelCapability } from '../../../services/generated'

export type GenerationCard = NonNullable<CanvasDocument['cards']>[number]
export type GenerationEdge = NonNullable<CanvasDocument['edges']>[number]
export const cardTitles: Record<string, string> = {
  'direction.narrative': '叙事概览卡', 'direction.beat': '叙事节拍卡', 'direction.event': '事件与刺激卡', 'direction.shot': '镜头设计卡',
  'direction.anchor': '空间锚点卡', 'direction.blocking': '站位与走位卡', 'direction.activity': '镜内活动卡', 'direction.environment': '环境活动与留白卡',
  'direction.dialogue': '对白卡', 'direction.sound': '声音安排卡',
  'direction.situation': '角色情境卡', 'direction.performance': '人物表演卡', 'direction.performance_rule': '表演规则卡',
  'reference.character': '角色参考卡', 'reference.place': '场所参考卡', 'reference.prop': '道具参考卡', 'reference.costume': '服装参考卡',
  'content.object': '人物／物件描述卡', 'content.place': '场所描述卡', 'content.text': '文本内容卡', 'content.basis': '原文／创作依据卡', 'content.image': '图片内容卡', 'content.video': '视频内容卡', 'content.audio': '音频内容卡',
  'model.text': '文本模型卡', 'model.image': '图片模型卡', 'model.video': '视频模型卡',
}
export const portLabels: Record<string, string> = { speaker: '说话对象', dialogue: '对白引用', audio_example: '音频素材', shot: '镜头对象', event: '事件对象', covered_beat: '覆盖节拍', related_event: '关联事件', blocking_basis: '调度依据', space: '所属空间', anchor: '锚点引用', blocking: '调度引用', position_anchor: '位置锚点', area_anchor: '区域锚点', change_event: '变化事件', trigger_event: '触发事件',  participant: '参与对象', effect_object: '作用对象', beat: '所属节拍', received_event: '接收事件', dialogue_basis: '对白依据', acceptance_basis: '验收依据', image_example: '图片素材', video_example: '视频素材', name: '名称关联', image_source: '图片来源', object: '对象引用', text: '文本', image: '参考图片', video: '视频', audio: '音频',
  first_frame: '首帧', last_frame: '尾帧', key_frame: '关键帧', subject_image: '主体图片', subject_video: '主体视频' }
const modality: Record<string, string> = { speaker: 'object_reference', dialogue: 'dialogue', audio_example: 'audio', shot: 'shot', event: 'event', covered_beat: 'beat', related_event: 'event', blocking_basis: 'blocking', space: 'object_reference', anchor: 'anchor', blocking: 'blocking', position_anchor: 'anchor', area_anchor: 'anchor', change_event: 'event', trigger_event: 'event',  participant: 'object_reference', effect_object: 'object_reference', beat: 'beat', received_event: 'event', dialogue_basis: 'dialogue', acceptance_basis: 'criterion', image_example: 'image', video_example: 'video', name: 'object_reference', image_source: 'image', object: 'object_reference', text: 'text', image: 'image', video: 'video', audio: 'audio',
  first_frame: 'image', last_frame: 'image', key_frame: 'image', subject_image: 'image', subject_video: 'video' }
const declaredOutputs: Record<string, string[]> = { 'direction.dialogue': ['text', 'dialogue'], 'direction.sound': ['text'], 'direction.narrative': ['text'], 'direction.beat': ['text', 'beat'], 'direction.event': ['text', 'event'], 'direction.shot': ['text', 'shot'], 'direction.anchor': ['text', 'anchor'], 'direction.blocking': ['text', 'blocking'], 'direction.activity': ['text'], 'direction.environment': ['text'],  'direction.situation': ['text'], 'direction.performance': ['text'], 'direction.performance_rule': ['text'], 'reference.character': ['image', 'object'], 'reference.place': ['image', 'object'], 'reference.prop': ['image', 'object'], 'reference.costume': ['image', 'object'], 'content.object': ['text', 'object'], 'content.place': ['text', 'object'], 'content.text': ['text'], 'content.basis': ['text'], 'content.image': ['image'], 'content.video': ['video'], 'content.audio': ['audio'], 'model.text': ['text'], 'model.image': ['image'], 'model.video': ['video'] }
export const outputPorts = (card: GenerationCard) => declaredOutputs[card.type || ''] || []
export const inputPorts = (card: GenerationCard) => card.type === 'direction.dialogue' ? ['speaker', 'video_example', 'audio_example'] : card.type === 'direction.sound' ? ['effect_object', 'audio_example'] : card.type === 'direction.narrative' || card.type === 'direction.event' ? ['effect_object'] : card.type === 'direction.beat' ? ['related_event'] : card.type === 'direction.shot' ? ['participant', 'covered_beat', 'related_event', 'blocking_basis', 'acceptance_basis', 'image_example', 'video_example'] : card.type === 'direction.anchor' ? ['space', 'effect_object', 'image_example', 'video_example'] : card.type === 'direction.blocking' ? ['participant', 'position_anchor', 'change_event', 'image_example', 'video_example'] : card.type === 'direction.activity' ? ['participant', 'area_anchor', 'trigger_event', 'effect_object', 'image_example', 'video_example'] : card.type === 'direction.environment' ? ['image_example', 'video_example'] : card.type === 'direction.situation' ? ['participant', 'effect_object'] : card.type === 'direction.performance' ? ['participant', 'effect_object', 'beat', 'received_event', 'dialogue_basis', 'acceptance_basis', 'image_example', 'video_example'] : card.type === 'direction.performance_rule' ? ['effect_object', 'image_example', 'video_example'] : card.type?.startsWith('reference.') ? ['name', 'image_source'] : card.type === 'model.text' ? ['text'] : card.type === 'model.image' ? ['text', 'image']
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
