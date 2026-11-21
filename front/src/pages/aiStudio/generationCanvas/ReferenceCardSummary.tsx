import { useUiText } from '../../../uiText'
import type { NamedImageReferenceCard } from '../../../services/generated'

/** 摘要显示已同步的参考映射名称与角度，不展开描述正文。 */
export function ReferenceCardSummary({ card }: { card: NamedImageReferenceCard }) {
  const uiText = useUiText()
  return <p className="canvas-card-summary">{card.name?.trim() || uiText("未命名参考")} · {card.scene_object_source ? uiText("主图") : card.angle || uiText("正面")}</p>
}
