import { uiText } from '../../../uiText'
import type { CanvasDocument, CanvasResolvedOutput } from '../../../services/generated'
import { sourceKey } from './promptRules'

export type AssociationSource = {
  id: string
  kind: 'material' | 'design'
  cardType?: string
  outputs: CanvasResolvedOutput[]
}

/** 来源可读与其内部引用有效分别判断，错误同时供方块和溢出入口展示。 */
export function associationIssues(output: CanvasResolvedOutput): { message: string; fieldId?: string }[] {
  const issues: { message: string; fieldId?: string }[] = []
  if (output.available === false) issues.push({ message: uiText("来源输出缺失") })
  if (output.basis_current === false) issues.push({ message: uiText("依据已变") })
  const payload = output.payload
  if (payload && 'reference_issues' in payload) {
    for (const issue of payload.reference_issues || []) issues.push({ message: issue.message, fieldId: issue.field_id })
  }
  if (payload && 'frame_target_state' in payload && payload.frame_target_state?.available === false) issues.push({ message: uiText("画面定位失效"), fieldId: 'frame_target' })
  return issues
}

/** 已连线但尚无输出的来源仍须可见，可定位源卡或解除连接。 */
export function includeConnectedSources(document: CanvasDocument, receiverId: string, outputs: CanvasResolvedOutput[]): CanvasResolvedOutput[] {
  const sources = [...outputs]
  for (const edge of document.edges || []) {
    if (edge.target_card !== receiverId || edge.result_scope || sources.some(output => output.source.canvas_id === document.id && output.source.card_id === edge.source_card && output.source.port_id === edge.source_port)) continue
    const modality = edge.source_port === 'image' || edge.source_port === 'video' || edge.source_port === 'audio' ? edge.source_port : 'text'
    sources.push({ source: { canvas_id: document.id, card_id: edge.source_card, port_id: edge.source_port, position: 0 }, modality, available: false })
  }
  return sources
}

/** 卡片提供的不同用途合并为一个入口，模型的各个实际输出保持独立身份。 */
export function associationSources(document: CanvasDocument, receiverId: string, outputs: CanvasResolvedOutput[]): AssociationSource[] {
  const cards = new Map(document.cards?.map(card => [card.id, card]))
  const order = [...new Set(document.edges?.filter(edge => edge.target_card === receiverId).map(edge => edge.source_card))]
  const grouped = new Map<string, AssociationSource>()
  for (const output of outputs) {
    const card = output.source.canvas_id === document.id ? cards.get(output.source.card_id) : undefined
    const design = card?.type?.startsWith('direction.') || output.payload?.kind === 'design'
    const merge = card && !card.type?.startsWith('model.')
    const id = merge ? JSON.stringify([output.source.canvas_id, output.source.card_id]) : sourceKey(output.source)
    const entry = grouped.get(id)
    if (entry) entry.outputs.push(output)
    else grouped.set(id, { id, cardType: card?.type, kind: design ? 'design' : 'material', outputs: [output] })
  }
  const rank = (entry: AssociationSource) => {
    const index = order.indexOf(entry.outputs[0].source.card_id)
    return index === -1 ? order.length : index
  }
  return [...grouped.values()].sort((left, right) => rank(left) - rank(right)).map(entry => ({ ...entry,
    outputs: [...entry.outputs].sort((left, right) => left.source.position - right.source.position),
  }))
}
