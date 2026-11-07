import type { CanvasDocument, OutputIdentity } from '../../../services/generated'
import type { createGraphRules, GenerationCard, GenerationEdge } from './graphRules'

/** 恢复与撤销使用当前策略；只补足明确采用，不把候选升级为采用。 */
export function cleanConnectionDocument(original: CanvasDocument, rules: Pick<ReturnType<typeof createGraphRules>, 'connectionPolicy' | 'cardDefinitions' | 'cleanDirectDesignCandidates' | 'sourceOptions'>): CanvasDocument {
  const document = structuredClone(original)
  const endpoint = (source: OutputIdentity, card: GenerationCard, port: string): GenerationEdge => ({ id: '', source_card: source.card_id, source_port: source.port_id, target_card: card.id, target_port: port })
  const valid = (source: OutputIdentity, card: GenerationCard, port: string) => {
    const origin = document.cards?.find(item => item.id === source.card_id)
    if (!origin || source.canvas_id !== document.id || !rules.connectionPolicy(document, endpoint(source, card, port))?.adoption_allowed) return false
    if (card.type?.startsWith('reference.') && (port === 'image_source' && origin.type !== 'content.image' || port === 'name' && origin.type !== card.type.replace('reference.', 'content.'))) return false
    const record = origin as unknown as Record<string, unknown>
    const identity = ['object_id', 'anchor_id', 'blocking_id', 'beat_id', 'event_id', 'shot_id', 'dialogue_id', 'criterion_id'].map(key => record[key]).find(Boolean)
    return ['text', 'image', 'video', 'audio'].includes(source.port_id) || !!identity && identity === source.object_id
  }
  document.edges = document.edges?.filter(edge => rules.connectionPolicy(document, edge)) || []
  const add = (source: OutputIdentity, card: GenerationCard, port: string) => {
    if (!document.edges!.some(edge => edge.source_card === source.card_id && edge.source_port === source.port_id && edge.target_card === card.id && edge.target_port === port)) document.edges!.push({ ...endpoint(source, card, port), id: `connection:${card.id}:${port}:${source.card_id}:${source.port_id}` })
  }
  for (const card of document.cards || []) {
    if ('input_bindings' in card) {
      const bindings = card.input_bindings || []
      const singles = rules.cardDefinitions[card.type || '']?.inputs.filter(port => port.max_sources === 1).map(port => port.id) || []
      const conflicts = new Set(singles.filter(port => new Set(bindings.filter(binding => binding.input_port === port).map(binding => binding.source.object_id || JSON.stringify([binding.source.card_id, binding.source.position]))).size > 1))
      const removed = new Set(bindings.filter(binding => conflicts.has(binding.input_port) || !valid(binding.source, card, binding.input_port)).map(binding => binding.id))
      card.input_bindings = bindings.filter(binding => !removed.has(binding.id))
      if (removed.size && 'prompt' in card) {
        card.prompt = { ...card.prompt, segments: card.prompt?.segments?.filter(segment => segment.kind !== 'reference' || !removed.has(segment.binding_id || '')).map(segment => segment.kind === 'instruction' ? { ...segment, references: segment.references?.filter(reference => !removed.has(reference.binding_id || '')) } : segment) }
        if ('frame_targets' in card) card.frame_targets = card.frame_targets?.filter(target => !removed.has(target.binding_id))
      }
      for (const binding of card.input_bindings) add(binding.source, card, binding.input_port)
    }
    if ('examples' in card) {
      card.examples = card.examples?.filter(example => valid(example.source, card, example.source.port_id + '_example')) as typeof card.examples
      for (const example of card.examples || []) add(example.source, card, example.source.port_id + '_example')
    }
    for (const [key, port] of [['name_binding', 'name'], ['image_binding', 'image_source']] as const) {
      if (!(key in card)) continue
      const record = card as unknown as Record<string, unknown>
      const value = record[key] as { source?: OutputIdentity } | OutputIdentity | null
      const source = key === 'image_binding' ? (value as { source?: OutputIdentity })?.source : value as OutputIdentity | null
      if (!source) continue
      if (valid(source, card, port)) add(source, card, port)
      else if (key === 'image_binding') (value as { source?: OutputIdentity | null }).source = null
      else record[key] = null
    }
    const fields = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(fields)
      else if (value && typeof value === 'object') {
        const record = value as Record<string, unknown>
        const field = record.document as { segments?: { kind: string; source?: OutputIdentity }[] } | undefined
        if (field && Array.isArray(field.segments)) field.segments = field.segments.filter(segment => {
          if (segment.kind !== 'reference' || !segment.source) return true
          if (!valid(segment.source, card, segment.source.port_id)) return false
          add(segment.source, card, segment.source.port_id)
          return true
        })
        Object.entries(record).forEach(([key, item]) => { if (key !== 'document') fields(item) })
      }
    }
    fields(card)
    if ('frame_target' in card && card.frame_target) {
      const source = document.cards?.find(item => item.id === card.frame_target!.card_id)
      const states = source?.type === 'direction.movement' && 'phases' in source ? ['field:movement_start', 'field:end_frame', ...(source.phases || []).map(phase => 'phase:' + phase.id)] : []
      if (states.includes(card.frame_target.state_id || '')) add({ canvas_id: document.id, card_id: card.frame_target.card_id, port_id: 'text', position: 0 }, card, 'text')
      else card.frame_target = null
    }
  }
  for (const edge of [...document.edges]) {
    if (!document.cards?.some(card => card.id === edge.source_card && card.type?.startsWith('direction.'))) continue
    for (const option of rules.sourceOptions(document, edge.source_card, edge.target_card)) {
      const target = document.cards!.find(card => card.id === option.target_card)!
      add({ canvas_id: document.id, card_id: option.source_card, port_id: option.source_port, position: 0 }, target, option.target_port)
    }
  }
  const ids = new Set(document.edges.map(edge => edge.id))
  document.input_order = Object.fromEntries(Object.entries(document.input_order || {}).map(([id, ports]) => [id, Object.fromEntries(Object.entries(ports).map(([port, values]) => [port, values.filter(value => ids.has(value))]))]))
  for (const edge of document.edges) {
    const ports = document.input_order[edge.target_card] ||= {}
    const values = ports[edge.target_port] ||= []
    if (!values.includes(edge.id)) values.push(edge.id)
  }
  const cleaned = rules.cleanDirectDesignCandidates(document)
  return JSON.stringify(cleaned) === JSON.stringify(original) ? original : cleaned
}
