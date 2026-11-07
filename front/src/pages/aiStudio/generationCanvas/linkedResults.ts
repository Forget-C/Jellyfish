import type { CanvasResolvedOutput, CanvasRunRead } from '../../../services/generated'
import type { CanvasPoint } from '../../../components/canvas/geometry'
import type { GraphSize } from '../directing/graphLayout'
import { GENERATION_CARD_SIZE } from './GenerationCardFrame'
import type { GenerationCard, GenerationEdge } from './graphRules'
import { resultScopeIncludes } from './resultConnections'

export type LinkedResult = { id: string; output: CanvasResolvedOutput }

const resultPrefix = (id: string) => `linked-result:${encodeURIComponent(id)}:`
const slot = ({ source }: CanvasResolvedOutput) => JSON.stringify([source.port_id, source.position])

/** 历史只用于确认已有输出位置，不用旧内容填补当前缺失。 */
export function knownResultPositions(runs: CanvasRunRead[]) {
  const known = new Map<string, Map<string, CanvasResolvedOutput>>()
  for (const run of runs) for (const node of run.nodes) {
    if (node.status !== 'succeeded' || !node.result_set_id) continue
    const positions = known.get(node.card_id) || new Map<string, CanvasResolvedOutput>()
    known.set(node.card_id, positions)
    for (const output of node.outputs) positions.set(slot(output), { source: output.source, modality: output.modality, available: false })
  }
  return known
}

/** 结果卡是正式输出的画布投影，身份跟随来源位置，不随文件或运行变化。 */
export function linkedResultCards(cards: GenerationCard[], outputs: Record<string, CanvasResolvedOutput[]> | undefined,
  hidden: Set<string>, edges: GenerationEdge[], known: ReturnType<typeof knownResultPositions>): LinkedResult[] {
  const occupied = new Set(cards.map(card => card.id))
  return cards.filter(card => 'show_result_cards' in card && card.show_result_cards && !hidden.has(card.id)).flatMap(card => {
    const connections = edges.filter(edge => edge.source_card === card.id)
    const values = new Map<string, CanvasResolvedOutput>()
    for (const output of known.get(card.id)?.values() || []) {
      const { source } = output
      if (connections.some(edge => edge.source_port === source.port_id && resultScopeIncludes(edge.result_scope, source.position))) {
        values.set(slot(output), output)
      }
    }
    for (const output of outputs?.[card.id] || []) values.set(slot(output), output)
    const detached = 'detached_results' in card ? card.detached_results || [] : []
    return [...values.values()].sort((a, b) => a.source.position - b.source.position).flatMap(output => {
      const previous = detached.find(item => item.position === output.source.position)
      if (previous && output.result_set_id === previous.result_set_id) return []
      const lineage = previous ? ':' + encodeURIComponent(previous.content_card_id) : ''
      let id = `${resultPrefix(card.id)}${encodeURIComponent(output.source.port_id)}:${output.source.position}${lineage}`
      while (occupied.has(id)) id += ':'
      occupied.add(id)
      return [{ id, output }]
    })
  })
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
