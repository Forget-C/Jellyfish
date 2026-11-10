import type { CanvasModelCapability, ModelRead } from '../../../services/generated'

/** 两个入口使用相同的默认模型资格，已有模型不被覆盖。 */
export function availableDefaultModel(card: { type?: string; model_id?: string | null }, id?: string | null, models?: ModelRead[]) {
  return !card.model_id && id && models?.some(model => model.id === id && model.category === card.type?.split('.')[1])
    ? id : undefined
}

export function defaultVideoRatio(capability?: CanvasModelCapability) {
  return capability?.ratios?.includes('16:9') ? '16:9' : capability?.ratios?.[0]
}
