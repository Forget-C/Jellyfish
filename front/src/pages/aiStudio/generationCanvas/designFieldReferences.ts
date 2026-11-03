import type { ReferenceDesignField, DesignFieldReference, CameraCard, CompositionCard, FocusCard, LightingCard, MovementCard, VisualStyleCard } from '../../../services/generated'
import type { GenerationCard } from './graphRules'

export const visualDesignTypes = ['direction.style', 'direction.camera', 'direction.composition', 'direction.lighting', 'direction.focus', 'direction.movement']
export type VisualDesignCard = CameraCard | CompositionCard | FocusCard | LightingCard | MovementCard | VisualStyleCard
export const isVisualDesign = (card: GenerationCard): card is VisualDesignCard => visualDesignTypes.includes(card.type || '')
export function designFieldEntries(card: GenerationCard): [string, ReferenceDesignField][] {
  if (!isVisualDesign(card)) return []
  return [...Object.entries(card.fields || {}), ...('phases' in card ? (card.phases || []).map(phase => ['phase:' + phase.id, phase.frame] as [string, ReferenceDesignField]) : [])]
}
export const designReferences = (card: GenerationCard, effective = false) => designFieldEntries(card).flatMap(([field, value]) => effective && ['empty', 'not_applicable'].includes(value.state || 'empty') ? [] : (value.document?.segments || []).filter((segment): segment is DesignFieldReference => segment.kind === 'reference').map(reference => ({ field, reference })))
