import type { CanvasDiagnostic } from '../../../services/generated'
import type { GenerationCard } from './graphRules'
import { designFieldEntries, isFlatDesign, isVisualDesign } from './designFieldReferences'

export type CanvasInspectTarget = {
  cardId: string
  serial: number
  segmentId?: string
  reportId?: string
  diagnostic?: CanvasDiagnostic['target']
}

const imageFields: Record<string, string> = { target_ratio: '图片画幅', resolution_profile: '图片分辨率', count: '图片数量' }
const videoFields: Record<string, string> = { ratio: '视频画幅', seconds: '视频时长（秒）', seed: '随机种子' }

/** 诊断路径映射到已经提供的控件；未知目标继续保留原始路径供调用方处理。 */
export function diagnosticControl(card: GenerationCard | undefined, target: CanvasDiagnostic['target']) {
  if (!card || !Array.isArray(target.path)) return undefined
  const [section, field] = target.path
  if (target.path.length === 1 && section === 'name' && 'name' in card) return { action: '定位名称', selector: '[data-diagnostic-name]' }
  if (!card.type?.startsWith('model.')) return undefined
  let label: string | undefined
  if ((target.path.length === 1 && section === 'model_id') || (target.path.length === 2 && section === 'config' && field === 'model_id')) label = '选择模型'
  else if (target.path.length === 2 && section === 'config') {
    const fields = card.type === 'model.image' ? imageFields : card.type === 'model.video' ? videoFields : undefined
    if (fields && typeof field === 'string' && Object.prototype.hasOwnProperty.call(fields, field)) label = fields[field]
  }
  if (label) return { action: '定位模型配置', selector: `[aria-label="${CSS.escape(label)}"]` }
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

/** 预检、保存诊断和已有卡片检查共用同一份名称约束。 */
export function duplicateDesignName(card: GenerationCard, cards: readonly GenerationCard[]) {
  if (!['direction.criterion', 'direction.narrative', 'direction.beat', 'direction.event', 'direction.shot'].includes(card.type || '') || !('name' in card)) return false
  const name = card.name?.trim()
  return !!name && cards.some(other => other.id !== card.id && other.type === card.type && 'name' in other && other.name?.trim() === name)
}
