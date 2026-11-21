import { useUiText } from '../../../uiText'
import type { CharacterDescriptionCard, PropDescriptionCard, CostumeDescriptionCard, PlaceDescriptionCard } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { CardStatusSummary } from './CardStatusSummary'
import { TextCardPreview } from './TextCardPreview'
import './descriptionCard.css'

export type DescriptionCardData = CharacterDescriptionCard | PropDescriptionCard | CostumeDescriptionCard | PlaceDescriptionCard
export const DESCRIPTION_CARD_TYPES = ['content.character', 'content.prop', 'content.costume', 'content.place'] as const

export function isDescriptionCard(card: GenerationCard): card is DescriptionCardData {
  return DESCRIPTION_CARD_TYPES.some(type => type === card.type)
}

/** 四类描述共享摘要和底部状态。 */
export function DescriptionCard({ card, readonly }: { card: DescriptionCardData; readonly: boolean }) {
  const uiText = useUiText()
  return <TextCardPreview label={uiText("描述正文预览")} text={card.text || '未填写描述'}
    status={<CardStatusSummary card={card} outputs={[]} readonly={readonly} missingImage={false} />} />
}
