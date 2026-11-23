import type { GenerationCard } from './graphRules'
import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { CanvasResolvedOutput } from '../../../services/generated'
export type CardClipboard = { schema: 1; projectId: string; cards: GenerationCard[]; positions: CanvasPoint[] }
export type CardReference = { canvasId: string; cardIds: string[] }
const referencePrefix = 'jellyfish:cards:1:'

export function writeCardReference(reference: CardReference) {
  return navigator.clipboard?.writeText(referencePrefix + JSON.stringify(reference))
}

export function readCardReference(text: string): CardReference | undefined {
  if (!text.startsWith(referencePrefix)) return
  try {
    const value: CardReference = JSON.parse(text.slice(referencePrefix.length))
    if (typeof value.canvasId === 'string' && Array.isArray(value.cardIds) && value.cardIds.length > 0 &&
      value.cardIds.length <= 200 && value.cardIds.every(id => typeof id === 'string' && id.length > 0)) return value
  } catch { /* Paste unrecognized text as supplied. */ }
}

const storageKey = (projectId: string) => `jellyfish:card-clipboard:${projectId}`
/** 所有采用都必须显式解除；候选边不属于卡片配置，不影响资格。 */
export function copyRestriction(card: GenerationCard): string | undefined {
  const hasReference = (value: unknown): boolean => {
    if (!value || typeof value !== 'object') return false
    if (Array.isArray(value)) return value.some(hasReference)
    const record = value as Record<string, unknown>
    if ('canvas_id' in record && 'card_id' in record || record.kind === 'reference') return true
    return Object.entries(record).some(([key, child]) => key !== 'origin' && hasReference(child))
  }
  return hasReference(card) ? '请先解除卡片的真实引用；失效绑定也需解除' : undefined
}
export function readCardClipboard(projectId: string): CardClipboard | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(storageKey(projectId)) || 'null') as CardClipboard | null
    if (value?.schema === 1 && value.projectId === projectId && value.cards.length && value.cards.length === value.positions.length && value.cards.every(card => card && typeof card.id === 'string' && typeof card.type === 'string' && !copyRestriction(card)) && value.positions.every(point => point && Number.isFinite(point.x) && Number.isFinite(point.y))) return value
  } catch { /* 无法读取时保持粘贴禁用。 */ }
}
export function writeCardClipboard(value: CardClipboard) { sessionStorage.setItem(storageKey(value.projectId), JSON.stringify(value)) }
/** 捕获当前结果内容，交给普通内容卡剪贴板。粘贴时才分配持久身份。 */
export function resultClipboardCard(id: string, output: CanvasResolvedOutput): GenerationCard | undefined {
  if (output.available === false) return undefined
  if (output.modality === 'text') return output.text ? { id, type: 'content.text', text: output.text } : undefined
  if (output.file_id) return { id, type: `content.${output.modality}`, file_id: output.file_id }
}

/** 副本具有新的领域身份；文件本身复用，运行成果按新卡 ID 自然隔离。 */
export function cloneCard(card: GenerationCard): GenerationCard {
  const copy = structuredClone(card)
  copy.id = crypto.randomUUID()
  for (const key of ['object_id', 'beat_id', 'event_id', 'shot_id', 'anchor_id', 'blocking_id', 'dialogue_id', 'criterion_id'] as const) {
    if (key in copy && copy[key as keyof typeof copy]) Object.assign(copy, { [key]: crypto.randomUUID() })
  }
  if ('origin' in copy) delete copy.origin
  if ('frame_origin' in copy) delete copy.frame_origin
  if ('detached_results' in copy) delete copy.detached_results
  return copy
}
