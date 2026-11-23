import type { CanvasAssistantLayout, CanvasAssistantPoint } from '../../../services/generated'
import type { CanvasArrangementChange } from './useGenerationCanvasEditor'

export type AssistantLayoutOutcome = 'applied' | 'stale' | 'deferred'
type LayoutPlan = { outcome: AssistantLayoutOutcome } | {
  outcome: 'ready'
  arrangement: CanvasArrangementChange
  apply: () => boolean
}

export type AssistantLayoutEditor = {
  positions: () => Record<string, CanvasAssistantPoint> | undefined
  plan: (sourceId: string, proposal: CanvasAssistantLayout) => LayoutPlan
}
