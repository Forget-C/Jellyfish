import type { NamedImageReferenceCard, CanvasResolvedOutput } from '../../../services/generated'
import { useCardCandidates } from './useCardCandidates'
import { sourceKey } from './promptRules'

/** 卡面名称来自本卡独立对象及已明确绑定的直接身份，不读取候选描述。 */
export function ReferenceCardSummary({ card, projectId, canvasId, revision, published }: {
  card: NamedImageReferenceCard; projectId: string; canvasId: string; revision?: number; published?: Record<string, CanvasResolvedOutput[]>
}) {
  const resolved = useCardCandidates(projectId, canvasId, card.id, revision, published, false)
  const names = new Map((card.objects || []).map(object => [object.object_id, object.name]))
  for (const output of resolved.candidates) {
    const payload = output.payload
    if (payload?.kind !== 'object_reference' || !('object_id' in payload) || !('name' in payload) || !payload.object_id || !payload.name) continue
    const selected = (card.input_bindings || []).some(binding => binding.input_port === 'name' && sourceKey(binding.source) === sourceKey(output.source))
    if (selected) names.set(payload.object_id, payload.name)
  }
  return <p className="canvas-card-summary">{[...names.values()].filter(Boolean).join('、') || (resolved.loading ? '名称读取中' : resolved.error ? '名称待核实' : '未绑定名称')} · {card.angle || '正面'}</p>
}
