import type { CanvasResolvedOutput } from '../../../services/generated'
import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { GraphSize } from '../directing/graphLayout'
import { GENERATION_CARD_SIZE } from './GenerationCardFrame'
import type { GenerationCard } from './graphRules'

export type LinkedResult = { id: string; output: CanvasResolvedOutput }

const resultPrefix = (id: string) => `linked-result:${encodeURIComponent(id)}:`

/** 结果卡是正式输出的画布投影，身份跟随来源位置，不随文件或运行变化。 */
export function linkedResultCards(cards: GenerationCard[], outputs: Record<string, CanvasResolvedOutput[]> | undefined, hidden: Set<string>): LinkedResult[] {
  const occupied = new Set(cards.map(card => card.id))
  return cards.flatMap(card => !('show_result_cards' in card) || !card.show_result_cards || hidden.has(card.id) ? [] :
    (outputs?.[card.id] || []).map(output => {
      let id = `${resultPrefix(card.id)}${encodeURIComponent(output.source.port_id)}:${output.source.position}`
      while (occupied.has(id)) id += ':'
      occupied.add(id)
      return { id, output }
    }))
}

/** 收起或等待运行快照时保留已有结果坐标；删除模型时交给既有布局缓存清理。 */
export function retainedResultIds(cards: GenerationCard[], positions: Record<string, CanvasPoint>): string[] {
  const prefixes = cards.filter(card => card.type?.startsWith('model.')).map(card => resultPrefix(card.id))
  return Object.keys(positions).filter(id => prefixes.some(prefix => id.startsWith(prefix)))
}

/** 首次展开从来源右侧找空位，既有卡片和已移动结果均保持原位。 */
export function placeLinkedResults(results: LinkedResult[], positions: Record<string, CanvasPoint>, sizes: Record<string, GraphSize>, retained: Record<string, CanvasPoint> = {}) {
  const placed = { ...positions }
  const sizeOf = (id: string) => sizes[id] || GENERATION_CARD_SIZE
  for (const result of results) {
    const id = result.id, sourceId = result.output.source.card_id
    if (retained[id]) { placed[id] = retained[id]; continue }
    const source = placed[sourceId] || { x: 0, y: 0 }, size = sizeOf(id)
    const x = source.x + sizeOf(sourceId).width + 64
    let y = source.y
    for (const [otherId, point] of Object.entries(placed).sort(([, a], [, b]) => a.y - b.y)) {
      const other = sizeOf(otherId)
      if (x < point.x + other.width + 24 && x + size.width + 24 > point.x
        && y < point.y + other.height + 24 && y + size.height + 24 > point.y) y = point.y + other.height + 24
    }
    placed[id] = { x, y }
  }
  return placed
}
