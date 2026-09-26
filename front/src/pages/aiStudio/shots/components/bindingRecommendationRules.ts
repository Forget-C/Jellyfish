/**
 * 资产绑定建议的**默认勾选口径**（唯一实现）。
 *
 * 用户不需要理解关联表或后台结构：系统按当前项目已有资产给出建议，
 * 明确匹配的默认勾选，多候选/冲突的必须由人决定。
 *
 * 规则（与页面帮助文案必须逐字一致）：
 * - 默认勾选 = 「层级 = 预选（auto）」且「尚未绑定」；
 * - 「需复核（review）」「已丢弃（discard）」以及已经绑定过的候选一律默认不勾选；
 * - 「确认全部推荐」只批量确认**默认勾选**的那些，不会替用户决定冲突项。
 */

export type BindingSuggestionLike = {
  tier: 'auto' | 'review' | 'discard' | string
  agreement?: string | null
  already_bound?: boolean | null
}

/** 是否默认勾选（预选 + 未绑定）。 */
export function isDefaultChecked(row: BindingSuggestionLike): boolean {
  return row.tier === 'auto' && !row.already_bound
}

/** 「确认全部推荐」要写入的那些：与默认勾选同一口径。 */
export function autoConfirmableRows<T extends BindingSuggestionLike>(rows: readonly T[]): T[] {
  return rows.filter((row) => isDefaultChecked(row))
}

/**
 * 是否需要用户自己判断（多候选 / 冲突 / 已绑定）。
 *
 * 页面据此给出提示：这些不会自动勾选，必须人工看过后再决定。
 */
export function requiresUserChoice(row: BindingSuggestionLike): boolean {
  if (isDefaultChecked(row)) return false
  if (row.agreement === 'conflict') return true
  return true
}

/** 一句话说明某条建议为什么需要人工确认（用于列表提示）。 */
export function describeRecommendationReason(row: BindingSuggestionLike): string {
  if (isDefaultChecked(row)) return '明确匹配，已默认勾选'
  if (row.agreement === 'conflict') return '与现有绑定冲突，需要你决定'
  if (row.tier === 'discard') return '置信度太低，已丢弃'
  if (row.already_bound) return '已经绑定过，需要你确认是否调整'
  return '需复核，需要你判断'
}
