import type { CanvasResolvedOutput, CanvasRunRead, OutputIdentity } from '../../../services/generated'
import { designReferences } from './designFieldReferences'
import type { GenerationCard } from './graphRules'
import { sourceKey } from './promptRules'

/** 固定以显示中的正式批次定位历史产物，后来的失败或运行节点不能替代它。 */
export function capturedResult(output: CanvasResolvedOutput, runs: CanvasRunRead[]) {
  if (output.available === false || !output.result_set_id) return
  const key = sourceKey(output.source)
  for (const run of runs) for (const node of run.nodes) {
    if (node.status !== 'succeeded' || node.result_set_id !== output.result_set_id || node.card_id !== output.source.card_id) continue
    const position = node.outputs.findIndex(item => sourceKey(item.source) === key)
    if (position >= 0) return { runId: run.id, nodeId: node.id, position }
  }
}

/** 保留引用片段、绑定、用途的身份与顺序，只替换精确的输出身份。 */
export function retargetResultReferences(card: GenerationCard, previous: OutputIdentity, next: OutputIdentity, directlyConnected: boolean): GenerationCard {
  const key = sourceKey(previous)
  const matches = (source?: OutputIdentity | null) => !!source && sourceKey(source) === key
  const copy = structuredClone(card)
  if ('design_media_uses' in copy) {
    for (const use of copy.design_media_uses || []) if (matches(use.source)) use.source = next
  }
  if (!directlyConnected) return copy
  if ('input_bindings' in copy) {
    for (const binding of copy.input_bindings || []) if (matches(binding.source)) binding.source = next
  }
  if ('examples' in copy) {
    for (const example of copy.examples || []) if (matches(example.source)) example.source = next
  }
  if ('name_binding' in copy && matches(copy.name_binding)) copy.name_binding = next
  if ('image_binding' in copy && copy.image_binding && matches(copy.image_binding.source)) copy.image_binding.source = next
  for (const { reference } of designReferences(copy)) if (matches(reference.source)) reference.source = next
  return copy
}
