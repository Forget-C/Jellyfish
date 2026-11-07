import type { CanvasDocument, OutputIdentity, InputBinding, PromptReference } from '../../../services/generated'
import { sourceKey } from './promptRules'
import { visibleSourceEdges } from './graphRules'
import type { createGraphRules, GenerationCard, GenerationEdge } from './graphRules'

/** 恢复与撤销使用当前策略；只补足明确采用，不把候选升级为采用。 */
export function cleanConnectionDocument(original: CanvasDocument, rules: Pick<ReturnType<typeof createGraphRules>, 'connectionPolicy' | 'cardDefinitions' | 'cleanDirectDesignCandidates' | 'sourceOptions'>): CanvasDocument {
  const document = structuredClone(original)
  const endpoint = (source: OutputIdentity, card: GenerationCard, port: string): GenerationEdge => ({ id: '', source_card: source.card_id, source_port: source.port_id, target_card: card.id, target_port: port })
  const valid = (source: OutputIdentity, card: GenerationCard, port: string) => {
    const origin = document.cards?.find(item => item.id === source.card_id)
    if (!origin || origin.id === card.id || source.canvas_id !== document.id || !rules.connectionPolicy(document, endpoint(source, card, port))?.adoption_allowed) return false
    if (card.type?.startsWith('reference.') && (port === 'image_source' && origin.type !== 'content.image' || port === 'name' && origin.type !== card.type.replace('reference.', 'content.'))) return false
    const record = origin as unknown as Record<string, unknown>
    const identity = ['object_id', 'anchor_id', 'blocking_id', 'beat_id', 'event_id', 'shot_id', 'dialogue_id', 'criterion_id'].map(key => record[key]).find(Boolean)
    return ['text', 'image', 'video', 'audio'].includes(source.port_id) || !!identity && identity === source.object_id
  }
  const endpoints = new Set<string>()
  document.edges = document.edges?.filter(edge => {
    const key = JSON.stringify([edge.source_card, edge.source_port, edge.target_card, edge.target_port])
    if (edge.source_card === edge.target_card || endpoints.has(key) || !rules.connectionPolicy(document, edge)) return false
    endpoints.add(key)
    return true
  }) || []
  const add = (source: OutputIdentity, card: GenerationCard, port: string) => {
    if (!document.edges!.some(edge => edge.source_card === source.card_id && edge.source_port === source.port_id && edge.target_card === card.id && edge.target_port === port)) document.edges!.push({ ...endpoint(source, card, port), id: `connection:${card.id}:${port}:${source.card_id}:${source.port_id}` })
  }
  for (const card of document.cards || []) {
    if ('input_bindings' in card) {
      const bindings = card.input_bindings || []
      const singles = rules.cardDefinitions[card.type || '']?.inputs.filter(port => port.max_sources === 1).map(port => port.id) || []
      const eligible = bindings.filter(binding => valid(binding.source, card, binding.input_port))
      const conflicts = new Set(singles.filter(port => new Set(eligible.filter(binding => binding.input_port === port).map(binding => sourceKey(binding.source))).size > 1))
      const kept = new Map<string, InputBinding>()
      const remapped = new Map<string, string>()
      for (const binding of eligible) {
        if (conflicts.has(binding.input_port)) continue
        const frame = 'frame_targets' in card && card.frame_targets?.find(target => target.binding_id === binding.id)
        const key = JSON.stringify([binding.input_port, sourceKey(binding.source), binding.subject_name || '', frame ? frame.state_id : null])
        const canonical = kept.get(key)
        if (!canonical) kept.set(key, binding)
        else {
          remapped.set(binding.id, canonical.id)
          if (binding.prompt_owned === false) canonical.prompt_owned = false
        }
      }
      card.input_bindings = [...kept.values()]
      const retained = new Set(card.input_bindings.map(binding => binding.id))
      const removed = new Map(bindings.filter(binding => !retained.has(binding.id) && !remapped.has(binding.id)).map(binding => [binding.id, binding]))
      if ((removed.size || remapped.size) && 'prompt' in card) {
        const fallback = (ref: PromptReference) => {
          const source = removed.get(ref.binding_id || '')!.source
          const label = ({ image: '图片', video: '视频', audio: '音频' } as Record<string, string>)[source.port_id] || '文本'
          return { id: ref.id, kind: 'text' as const, text: `@${label}〔引用失效：${source.card_id}〕` }
        }
        const redirect = (ref: PromptReference) => ({ ...ref, binding_id: remapped.get(ref.binding_id || '') || ref.binding_id })
        const segments: NonNullable<typeof card.prompt>['segments'] = []
        for (const segment of card.prompt?.segments || []) {
          if (segment.kind === 'reference') segments.push(removed.has(segment.binding_id || '') ? fallback(segment) : redirect(segment))
          else if (segment.kind === 'instruction') {
            segments.push({ ...segment, references: segment.references?.filter(ref => !removed.has(ref.binding_id || '')).map(redirect) })
            segments.push(...(segment.references || []).filter(ref => removed.has(ref.binding_id || '')).map(fallback))
          } else segments.push(segment)
        }
        card.prompt = { ...card.prompt, segments }
        if ('frame_targets' in card) card.frame_targets = card.frame_targets?.filter(target => retained.has(target.binding_id))
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
        if (field && Array.isArray(field.segments)) for (const segment of field.segments) {
          if (segment.kind === 'reference' && segment.source && valid(segment.source, card, segment.source.port_id)) add(segment.source, card, segment.source.port_id)
        }
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
  for (const edge of visibleSourceEdges(document)) {
    for (const option of rules.sourceOptions(document, edge.source_card, edge.target_card)) {
      const target = document.cards!.find(card => card.id === option.target_card)!
      add({ canvas_id: document.id, card_id: option.source_card, port_id: option.source_port, position: 0 }, target, option.target_port)
    }
  }
  const byId = new Map(document.edges.map(edge => [edge.id, edge]))
  document.input_order = Object.fromEntries(Object.entries(document.input_order || {}).flatMap(([id, ports]) => {
    const card = document.cards?.find(item => item.id === id)
    if (!card) return []
    const inputs = new Set(rules.cardDefinitions[card.type || '']?.inputs.map(port => port.id))
    return [[id, Object.fromEntries(Object.entries(ports).filter(([port]) => inputs.has(port)).map(([port, values]) => [
      port, [...new Set(values)].filter(value => {
        const edge = byId.get(value)
        return edge?.target_card === id && edge.target_port === port
      }),
    ]))]]
  }))
  for (const edge of document.edges) {
    const ports = document.input_order[edge.target_card] ||= {}
    const values = ports[edge.target_port] ||= []
    if (!values.includes(edge.id)) values.push(edge.id)
  }
  const cleaned = rules.cleanDirectDesignCandidates(document)
  return JSON.stringify(cleaned) === JSON.stringify(original) ? original : cleaned
}
