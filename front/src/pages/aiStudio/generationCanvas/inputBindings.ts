import type { InputBinding, OutputIdentity, PromptDocument, PromptInstruction, PromptReference, PromptText } from '../../../services/generated'
import type { GenerationCard } from './graphRules'

/** 编辑表面可显示来源，但保存的来源权威只在输入绑定中。 */
export type EditorPromptReference = PromptReference & { source: OutputIdentity }
export type EditorPromptInstruction = Omit<PromptInstruction, 'references'> & { references?: EditorPromptReference[] }
export type EditorPromptDocument = { segments?: ((PromptText & { literal?: boolean }) | EditorPromptReference | EditorPromptInstruction)[] }
const key = (source: OutputIdentity) => JSON.stringify([source.canvas_id, source.card_id, source.port_id, source.object_id || source.position])
const commandPorts: Record<string, string> = { 首帧参考: 'first_frame', 尾帧参考: 'last_frame', 关键帧参考: 'key_frame', 主体参考: 'subject_image' }

export function editorPrompt(card: GenerationCard): EditorPromptDocument {
  if (!('prompt' in card)) return { segments: [] }
  const bindings = new Map((card.input_bindings || []).map(binding => [binding.id, binding]))
  const hydrate = (reference: PromptReference): EditorPromptReference => {
    const legacy = reference as EditorPromptReference
    const source = bindings.get(reference.binding_id || '')?.source || legacy.source
    return { ...reference, source }
  }
  return { segments: (card.prompt?.segments || []).map(segment => segment.kind === 'reference' ? hydrate(segment)
    : segment.kind === 'instruction' ? { ...segment, parameters: segment.command === '主体参考' ? { ...segment.parameters, name: bindings.get(segment.references?.[0]?.binding_id || '')?.subject_name ?? segment.parameters?.name ?? '' } : segment.parameters, references: segment.references?.map(hydrate) } : segment) }
}

export function withEditorPrompt(card: GenerationCard, prompt: EditorPromptDocument): GenerationCard {
  if (!('prompt' in card)) return card
  const mentioned = new Set((card.prompt?.segments || []).flatMap(segment => segment.kind === 'reference' ? [segment.binding_id]
    : segment.kind === 'instruction' ? (segment.references || []).map(reference => reference.binding_id) : []))
  // 正文只移除它原先引用而本次取消的绑定，保留输入区独立采用的记录。
  const bindings: InputBinding[] = (card.input_bindings || []).filter(binding => !mentioned.has(binding.id) || binding.prompt_owned === false)
    .map(binding => !mentioned.has(binding.id) ? { ...binding, prompt_owned: binding.prompt_owned ?? false } : binding)
  const bind = (reference: EditorPromptReference, command?: string, subject_name?: string): PromptReference => {
    let input_port = command ? commandPorts[command] || reference.source.port_id : reference.source.port_id
    if (card.type === 'model.video' && ['image', 'video'].includes(input_port)) input_port = 'subject_' + input_port
    if (input_port === 'subject_image' && reference.source.port_id === 'video') input_port = 'subject_video'
    let binding = bindings.find(value => key(value.source) === key(reference.source) && value.input_port === input_port && (value.subject_name || '') === (subject_name || ''))
    if (!binding) {
      const existing = card.input_bindings?.find(value => key(value.source) === key(reference.source) && value.input_port === input_port && (value.subject_name || '') === (subject_name || ''))
      binding = { ...existing, id: existing?.id || crypto.randomUUID(), source: reference.source, input_port, subject_name, prompt_owned: existing?.prompt_owned ?? (!existing || mentioned.has(existing.id)) }
      bindings.push(binding)
    }
    return { id: reference.id, kind: 'reference', binding_id: binding.id }
  }
  const next: PromptDocument = { segments: (prompt.segments || []).map(segment => segment.kind === 'reference' ? bind(segment)
    : segment.kind === 'instruction' ? { ...segment, references: segment.references?.map(reference => bind(reference, segment.command, segment.command === '主体参考' ? String(segment.parameters?.name || '').trim() : undefined)) } : { id: segment.id, kind: segment.kind, text: segment.text }) }
  if (card.type === 'model.video') {
    const order = new Map((card.input_bindings || []).map((binding, index) => [binding.id, index]))
    bindings.sort((left, right) => (order.get(left.id) ?? Infinity) - (order.get(right.id) ?? Infinity))
  }
  return { ...card, prompt: next, input_bindings: bindings }
}

/** 取消采用前列出正文和指令依赖；普通编辑不能静默删除引用。 */
export function bindingReferences(card: GenerationCard, id: string) {
  if (!('prompt' in card)) return []
  return (card.prompt?.segments || []).flatMap(segment => segment.kind === 'reference'
    ? segment.binding_id === id ? [{ segmentId: segment.id, referenceId: segment.id, label: '正文引用' }] : []
    : segment.kind === 'instruction' ? (segment.references || []).filter(ref => ref.binding_id === id).map(ref => ({ segmentId: segment.id, referenceId: ref.id, label: `${segment.command}指令引用` })) : [])
}

/** 解除没有显式引用的采用，仅移除绑定拥有的配置，保留候选来源。 */
export function withoutInputBinding(card: GenerationCard, id: string): GenerationCard {
  if (!('prompt' in card) || bindingReferences(card, id).length) return card
  return { ...card, ...('frame_targets' in card ? { frame_targets: card.frame_targets?.filter(target => target.binding_id !== id) } : {}), input_bindings: card.input_bindings?.filter(binding => binding.id !== id) }
}
