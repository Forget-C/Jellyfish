import type { NamedImageReferenceCard } from '../../../services/generated'

/** 摘要显示已同步的参考映射名称与角度，不展开描述正文。 */
export function ReferenceCardSummary({ card }: { card: NamedImageReferenceCard }) {
  return <p className="canvas-card-summary">{card.name?.trim() || '未命名参考'} · {card.scene_object_source ? '主图' : card.angle || '正面'}</p>
}
