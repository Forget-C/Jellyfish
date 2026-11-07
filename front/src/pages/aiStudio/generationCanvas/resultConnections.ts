import type { CanvasResultScope } from '../../../services/generated'
import type { GenerationEdge } from './graphRules'

/** A scope is shared by every compatible use of the same source output port. */
export const sameResultConnection = (a: GenerationEdge, b: GenerationEdge) =>
  a.source_card === b.source_card && a.source_port === b.source_port && a.target_card === b.target_card

export function resultScopeIncludes(scope: GenerationEdge['result_scope'], position: number): boolean {
  return !scope || scope.positions.includes(position) === (scope.mode === 'only')
}

/** null removes an exhausted explicit scope; undefined restores the whole source. */
export function resultScopeWithPosition(scope: GenerationEdge['result_scope'], position: number, include: boolean): CanvasResultScope | null | undefined {
  const mode = scope?.mode || 'except'
  const positions = new Set(scope?.positions || [])
  if (include === (mode === 'only')) positions.add(position)
  else positions.delete(position)
  return positions.size ? { mode, positions: [...positions].sort((a, b) => a - b) } : mode === 'only' ? null : undefined
}
