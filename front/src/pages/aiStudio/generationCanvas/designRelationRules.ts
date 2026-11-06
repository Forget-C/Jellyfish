import type { CanvasDocument, CanvasResolvedOutput, InputBinding } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { sourceKey } from './promptRules'

const singles: Record<string, string[]> = {
  situation: ['participant', 'beat', 'shot'], performance: ['participant', 'beat', 'shot'],
  anchor: ['space', 'participant', 'area_anchor', 'change_event', 'trigger_event'],
  blocking: ['space', 'participant', 'area_anchor', 'change_event', 'trigger_event'],
  activity: ['space', 'participant', 'area_anchor', 'change_event', 'trigger_event'],
  space_rule: ['space', 'participant', 'related_event'], continuity: ['space', 'participant', 'related_event'],
  dialogue: ['speaker'], camera: ['shot'], lighting: ['shot'], focus: ['shot'], movement: ['shot'], composition: ['shot'],
}

/** Only connected business ports or retained bindings offer adoption; text references are separate. */
export function candidateRelationPorts(card: GenerationCard, document: CanvasDocument, item: CanvasResolvedOutput) {
  if (['direction.camera', 'direction.lighting', 'direction.focus', 'direction.movement', 'direction.composition', 'direction.visual_style'].includes(card.type || '')) return []
  const excluded = new Set(['text', 'image', 'video', 'audio', 'anchor', 'image_example', 'video_example', 'audio_example', 'acceptance_basis'])
  const payload = item.payload
  const eligible = (port: string) => {
    if (!payload) return false
    if (payload.kind === 'object_reference' && 'category' in payload) return port === 'space' ? payload.category === 'place' : ['participant', 'speaker', 'attention_object', 'focus_object'].includes(port) && ['character', 'prop', 'costume'].includes(payload.category) && (port !== 'speaker' || payload.category !== 'costume')
    if (payload.kind === 'spatial_reference' && 'category' in payload) return payload.category === 'anchor' ? ['position_anchor', 'area_anchor'].includes(port) : payload.category === 'blocking' && port === 'blocking_basis'
    if (payload.kind === 'narrative_reference' && 'category' in payload) return payload.category === 'beat' ? ['beat', 'covered_beat'].includes(port) : payload.category === 'event' ? ['related_event', 'received_event', 'change_event', 'trigger_event'].includes(port) : payload.category === 'shot' && port === 'shot'
    return payload.kind === 'dialogue_reference' && port === 'dialogue_basis' && item.source.port_id === 'dialogue'
  }
  const connected = (document.edges || []).filter(edge => edge.target_card === card.id && edge.source_card === item.source.card_id && edge.source_port === item.source.port_id).map(edge => edge.target_port).filter(eligible)
  const retained = ('input_bindings' in card ? card.input_bindings || [] : []).filter(binding => sourceKey(binding.source) === sourceKey(item.source)).map(binding => binding.input_port)
  return [...new Set([...connected, ...retained])].filter(port => !excluded.has(port))
}

export function isSingleDesignRelation(card: GenerationCard, port: string) {
  return singles[card.type?.replace('direction.', '') || '']?.includes(port) || false
}

/** Replace a single role atomically; removing a role never edits edges or field references. */
export function withDesignRelation(card: GenerationCard, item: CanvasResolvedOutput, port: string): GenerationCard {
  const bindings = 'input_bindings' in card ? card.input_bindings || [] : []
  const existing = bindings.find(binding => binding.input_port === port && sourceKey(binding.source) === sourceKey(item.source))
  const next: InputBinding[] = existing ? bindings.filter(binding => binding.id !== existing.id)
    : [...bindings.filter(binding => !isSingleDesignRelation(card, port) || binding.input_port !== port), { id: crypto.randomUUID(), input_port: port, source: item.source }]
  return { ...card, input_bindings: next } as GenerationCard
}
