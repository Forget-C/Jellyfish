import type { InputBinding, OutputIdentity, PromptDocument, PromptInstruction, PromptReference, PromptText } from '../../../services/generated'
import type { GenerationCard } from './graphRules'

/** 编辑表面可显示来源，但保存的来源权威只在输入绑定中。 */
export type EditorPromptReference = PromptReference & { source: OutputIdentity }
export type EditorPromptInstruction = Omit<PromptInstruction, 'references'> & { references?: EditorPromptReference[] }
export type EditorPromptDocument = { segments?: (PromptText | EditorPromptReference | EditorPromptInstruction)[] }
const key = (source: OutputIdentity) => JSON.stringify([source.canvas_id, source.card_id, source.port_id, source.position])
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
    : segment.kind === 'instruction' ? { ...segment, references: segment.references?.map(hydrate) } : segment) }
}

export function withEditorPrompt(card: GenerationCard, prompt: EditorPromptDocument): GenerationCard {
  if (!('prompt' in card)) return card
  const mentioned = new Set((card.prompt?.segments || []).flatMap(segment => segment.kind === 'reference' ? [segment.binding_id]
    : segment.kind === 'instruction' ? (segment.references || []).map(reference => reference.binding_id) : []))
  // 正文只移除它原先引用而本次取消的绑定，保留输入区独立采用的记录。
  const bindings: InputBinding[] = (card.input_bindings || []).filter(binding => !mentioned.has(binding.id))
  const bind = (reference: EditorPromptReference, command?: string): PromptReference => {
    let input_port = command ? commandPorts[command] || reference.source.port_id : reference.source.port_id
    if (card.type === 'model.video' && ['image', 'video'].includes(input_port)) input_port = 'subject_' + input_port
    if (input_port === 'subject_image' && reference.source.port_id === 'video') input_port = 'subject_video'
    let binding = bindings.find(value => key(value.source) === key(reference.source) && value.input_port === input_port)
    if (!binding) {
      const existing = card.input_bindings?.find(value => key(value.source) === key(reference.source) && value.input_port === input_port)
      binding = { id: existing?.id || crypto.randomUUID(), source: reference.source, input_port }
      bindings.push(binding)
    }
    return { id: reference.id, kind: 'reference', binding_id: binding.id }
  }
  const next: PromptDocument = { segments: (prompt.segments || []).map(segment => segment.kind === 'reference' ? bind(segment)
    : segment.kind === 'instruction' ? { ...segment, references: segment.references?.map(reference => bind(reference, segment.command)) } : segment) }
  return { ...card, prompt: next, input_bindings: bindings }
}
