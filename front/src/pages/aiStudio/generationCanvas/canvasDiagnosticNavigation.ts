import type { CanvasDiagnostic } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { designFieldEntries, isFlatDesign, isVisualDesign } from './designFieldReferences'
import { diagnosticAssociation, diagnosticEdgeId, isWholeCardDiagnostic } from './canvasRelationNavigation'

export type CanvasInspectTarget = {
  cardId: string
  serial: number
  reportId?: string
  diagnostic?: CanvasDiagnostic['target']
}

const imageFields = ['target_ratio', 'resolution_profile', 'count']
const videoFields = ['ratio', 'seconds', 'seed']

/** 只为诊断中的明确控件提供动作；失效片段仍可查看原卡。 */
export function diagnosticControl(card: GenerationCard | undefined, target: CanvasDiagnostic['target']): { action: string; selector?: string } | undefined {
  if (!card) return undefined
  const path = Array.isArray(target.path) ? target.path : undefined
  const [section, field, segment] = path || []
  if (path?.length === 1 && section === 'name' && 'name' in card) return { action: '定位名称', selector: '[data-diagnostic-name]' }
  if (!card.type?.startsWith('model.')) return undefined
  const reference = path?.length === 5 && path[3] === 'references' && typeof path[4] === 'string' ? path[4] : undefined
  const promptSegment = section === 'prompt' && field === 'segments' && (path?.length === 3 || reference)
  const segmentId = promptSegment ? segment : !path ? target.segment_id ?? target.reference_id : undefined
  if (typeof segmentId === 'string') {
    const destination = 'prompt' in card && card.prompt?.segments?.find(item => item.id === segmentId)
    const available = destination && (!reference || destination.kind === 'instruction' && destination.references?.some(item => item.id === reference))
    return available
      ? { action: '定位正文片段', selector: `[data-diagnostic-control="prompt"] [data-segment-id="${CSS.escape(segmentId)}"]` }
      : { action: '查看卡片' }
  }
  if (path?.length === 1 && section === 'prompt') return { action: '定位模型正文', selector: '[data-diagnostic-control="prompt"]' }
  if (path?.length === 1 && section === 'model_id' || path?.length === 2 && section === 'config' && field === 'model_id') {
    return { action: '定位模型配置', selector: '[data-diagnostic-control="model_id"]' }
  }
  const fields = card.type === 'model.image' ? imageFields : card.type === 'model.video' ? videoFields : []
  if (path?.length === 2 && section === 'config' && typeof field === 'string' && fields.includes(field)) {
    return { action: '定位模型配置', selector: `[data-diagnostic-control="${field}"]` }
  }
}

type DesignDiagnosticDestination = { action: '定位设计字段' | '定位运镜阶段'; fieldId: string; segmentId?: string } | { action: '查看卡片'; fieldId?: never }

/** Interpret only design parameter paths. A removed field, phase or reference can still open its card. */
export function diagnosticDesignField(card: GenerationCard, target: CanvasDiagnostic['target'], fields: readonly { id: string }[]): DesignDiagnosticDestination | undefined {
  const path = target.path
  if (!Array.isArray(path) || !path.every(part => typeof part === 'string')) return undefined
  const [section, key, frame, ...rest] = path
  const declared = (id: string) => fields.some(field => field.id === id)
  let fieldId: string
  let phaseId: string | undefined
  if (isFlatDesign(card) && section && (path.length === 1 && declared(section) || path.length === 2 && key === 'document')) fieldId = section
  else if (isVisualDesign(card) && section === 'fields' && key && (path.length === 2 || path.length === 3 && frame === 'document')) fieldId = key
  else if (card.type === 'direction.movement' && section === 'phases' && key && (path.length === 2 || frame === 'frame' && (rest.length === 0 || rest.length === 1 && rest[0] === 'document'))) {
    phaseId = key
    fieldId = `phase:${key}`
  } else return undefined

  const fieldAvailable = phaseId ? 'phases' in card && card.phases?.some(phase => phase.id === phaseId) : declared(fieldId)
  if (!fieldAvailable) return { action: '查看卡片' }
  const segmentId = target.segment_id ?? target.reference_id
  if (segmentId !== undefined) {
    const field = designFieldEntries(card).find(([id]) => id === fieldId)?.[1]
    if (typeof segmentId !== 'string' || !field?.document?.segments?.some(segment => segment.kind === 'reference' && segment.id === segmentId)) return { action: '查看卡片' }
  }
  return { action: phaseId ? '定位运镜阶段' : '定位设计字段', fieldId, segmentId }
}

/** 预检与标题清单共用定位动作的可用范围。 */
export function diagnosticCardAction(card: GenerationCard, target: CanvasDiagnostic['target'], fields: readonly { id: string }[]) {
  if (diagnosticEdgeId(target)) return '定位连线'
  if (diagnosticAssociation(card, target)) return '定位关系'
  if (isWholeCardDiagnostic(target)) return '定位卡片'
  return diagnosticControl(card, target)?.action || diagnosticDesignField(card, target, fields)?.action
}

/** 预检、保存诊断和已有卡片检查共用同一份名称约束。 */
export function duplicateDesignName(card: GenerationCard, cards: readonly GenerationCard[]) {
  if (!['direction.criterion', 'direction.narrative', 'direction.beat', 'direction.event', 'direction.shot'].includes(card.type || '') || !('name' in card)) return false
  const name = card.name?.trim()
  return !!name && cards.some(other => other.id !== card.id && other.type === card.type && 'name' in other && other.name?.trim() === name)
}
