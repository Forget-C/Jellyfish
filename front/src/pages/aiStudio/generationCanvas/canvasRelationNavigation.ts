import type { CanvasDiagnostic, OutputIdentity } from '../../../services/generated'
import type { GenerationCard } from './graphRules'

/** 只接受诊断给出的稳定连线标识。 */
export function diagnosticEdgeId(target: CanvasDiagnostic['target']) {
  const path = target.path
  return Array.isArray(path) && path.length === 2 && path[0] === 'edges' && typeof path[1] === 'string' ? path[1] : undefined
}

export type AssociationInspection = { serial: number; source?: OutputIdentity | string }

/** 关系诊断只定位已有绑定、构图画面关联或明确的关联区。 */
export function diagnosticAssociation(card: GenerationCard | undefined, target: CanvasDiagnostic['target']): { source?: AssociationInspection['source']; unavailable?: boolean } | undefined {
  const path = target.path
  if (!card || !Array.isArray(path) || !(card.type?.startsWith('direction.') || card.type?.startsWith('model.'))) return undefined
  if (path.length === 1 && path[0] === 'frame_target' && card.type === 'direction.composition') {
    return 'frame_target' in card && card.frame_target ? { source: card.frame_target.card_id } : { unavailable: true }
  }
  if (path.length === 1 && path[0] === 'input_bindings') return {}
  if (path.length === 2 && (path[0] === 'input_bindings' || path[0] === 'frame_targets' && card.type === 'model.image') && typeof path[1] === 'string') {
    const binding = 'input_bindings' in card && card.input_bindings?.find(item => item.id === path[1])
    return binding ? { source: binding.source } : { unavailable: true }
  }
}

/** 无 path 只说明问题归属；空路径明确指向整张卡片。 */
export function isWholeCardDiagnostic(target: CanvasDiagnostic['target']) {
  return Array.isArray(target.path) && target.path.length === 0
}

/** 仅收录诊断提供的相关卡片身份，不从说明或附近连线猜测。 */
export function diagnosticRelatedCards(target: CanvasDiagnostic['target']) {
  const related: unknown[] = Array.isArray(target.related_card_ids) ? target.related_card_ids : []
  return [...new Set([...related, target.source_card_id, target.target_card_id].filter((id): id is string => typeof id === 'string' && !!id))]
}
