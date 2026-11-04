import type { NarrativeOverviewCard, NarrativeBeatCard, NarrativeEventCard, ShotDesignCard, CharacterSituationCard, CharacterPerformanceCard, PerformanceRuleCard, SpatialAnchorCard, BlockingDirectionCard, InFrameActivityCard, EnvironmentActivityCard, ReferenceDesignField, DesignFieldReference, CameraCard, CompositionCard, FocusCard, LightingCard, MovementCard, VisualStyleCard } from '../../../services/generated'
import type { GenerationCard } from './graphRules'

export const visualDesignTypes = ['direction.style', 'direction.camera', 'direction.composition', 'direction.lighting', 'direction.focus', 'direction.movement']
export const performanceDesignTypes = ['direction.situation', 'direction.performance', 'direction.performance_rule', 'direction.anchor', 'direction.blocking', 'direction.activity', 'direction.environment']
export type PerformanceDesignCard = CharacterSituationCard | CharacterPerformanceCard | PerformanceRuleCard | SpatialAnchorCard | BlockingDirectionCard | InFrameActivityCard | EnvironmentActivityCard
export const isPerformanceDesign = (card: GenerationCard): card is PerformanceDesignCard => performanceDesignTypes.includes(card.type || '')
export const narrativeDesignTypes = ['direction.narrative', 'direction.beat', 'direction.event', 'direction.shot']
export type NarrativeDesignCard = NarrativeOverviewCard | NarrativeBeatCard | NarrativeEventCard | ShotDesignCard
export type FlatDesignCard = PerformanceDesignCard | NarrativeDesignCard
export const isFlatDesign = (card: GenerationCard): card is FlatDesignCard => isPerformanceDesign(card) || narrativeDesignTypes.includes(card.type || '')
export const isReferenceDesign = (card: GenerationCard): card is VisualDesignCard | FlatDesignCard => isVisualDesign(card) || isFlatDesign(card)
export type VisualDesignCard = CameraCard | CompositionCard | FocusCard | LightingCard | MovementCard | VisualStyleCard
export const isVisualDesign = (card: GenerationCard): card is VisualDesignCard => visualDesignTypes.includes(card.type || '')
export function designFieldEntries(card: GenerationCard): [string, ReferenceDesignField][] {
  if (isFlatDesign(card)) return Object.entries(card).filter((entry): entry is [string, ReferenceDesignField] => !!entry[1] && typeof entry[1] === 'object' && !Array.isArray(entry[1]) && 'state' in entry[1])
  if (!isVisualDesign(card)) return []
  return [...Object.entries(card.fields || {}), ...('phases' in card ? (card.phases || []).map(phase => ['phase:' + phase.id, phase.frame] as [string, ReferenceDesignField]) : [])]
}
export const designReferences = (card: GenerationCard, effective = false) => designFieldEntries(card).flatMap(([field, value]) => effective && ['empty', 'not_applicable'].includes(value.state || 'empty') ? [] : (value.document?.segments || []).filter((segment): segment is DesignFieldReference => segment.kind === 'reference').map(reference => ({ field, reference })))
