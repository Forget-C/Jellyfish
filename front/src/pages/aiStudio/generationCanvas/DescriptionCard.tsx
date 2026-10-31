import type { CharacterDescriptionCard, PropDescriptionCard, CostumeDescriptionCard, PlaceDescriptionCard } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { CardStatusSummary } from './CardStatusSummary'
import { GenerationCardFrame } from './GenerationCardFrame'
import './descriptionCard.css'

export type DescriptionCardData = CharacterDescriptionCard | PropDescriptionCard | CostumeDescriptionCard | PlaceDescriptionCard
export const DESCRIPTION_CARD_TYPES = ['content.character', 'content.prop', 'content.costume', 'content.place'] as const

export function isDescriptionCard(card: GenerationCard): card is DescriptionCardData {
  return DESCRIPTION_CARD_TYPES.some(type => type === card.type)
}

/** 四类描述共享卡面；沿用 400×172 默认尺寸或既有缓存高度，不采用模型卡几何。 */
export function DescriptionCard({ card, readonly, height }: { card: DescriptionCardData; readonly: boolean; height?: number }) {
  return <GenerationCardFrame label="描述正文预览" height={Math.max(140, (height || 172) - 32) - 2}
    status={<CardStatusSummary card={card} outputs={[]} readonly={readonly} missingImage={false} />}>
    <div className="generation-output-text generation-description-preview"><p className="canvas-card-summary">{card.text || '未填写描述'}</p></div>
  </GenerationCardFrame>
}
