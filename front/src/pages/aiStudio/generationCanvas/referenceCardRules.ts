import type { CanvasResolvedOutput, NamedImageReferenceCard } from '../../../services/generated'
import type { GenerationCard } from './graphRules'

/** 草稿允许空名和重名保存，但无有效名称时不能用于参考映射。 */
export function referenceNameError(card: NamedImageReferenceCard, cards: GenerationCard[]) {
  const source = card.name_binding && cards.find(item => item.id === card.name_binding?.card_id)
  const name = ((source && 'name' in source ? source.name : card.name) || '').trim()
  if (!name) return '请填写参考名称'
  const angle = (card.angle || '').trim() || '正面'
  return cards.filter(item => {
    if (item.type !== card.type) return false
    const reference = item as NamedImageReferenceCard
    const owner = reference.name_binding && cards.find(source => source.id === reference.name_binding?.card_id)
    const otherName = ((owner && 'name' in owner ? owner.name : reference.name) || '').trim()
    return otherName === name && ((reference.angle || '').trim() || '正面') === angle
  }).length > 1 ? '同类型、同名称、同角度的参考已存在' : ''

}

/** 新增参考图只允许图片内容卡，导入由图片内容卡统一负责。 */
export function referenceImageCompatible(card: NamedImageReferenceCard, source?: GenerationCard) {
  return !!source && source.id !== card.id && source.type === 'content.image'
}

/** 实际图片产物身份包含文件与结果集，保留历史图片时仍可重新选择同一位置的新产物。 */
export function referenceImageKey(image: { file_id?: string | null; source?: CanvasResolvedOutput['source'] | null; result_set_id?: string | null }) {
  return JSON.stringify([image.source || null, image.result_set_id || null, image.file_id])
}
