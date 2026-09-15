export type Preparation = Record<string, string | number | boolean | string[] | Record<string, string>>

const key = (scope: string) => `directing-preparation:v1:${scope}`

/** 只恢复当前表单认识的字段；缓存不包含执行授权，提交时仍须校验版本和输入。 */
export function readPreparation<T extends Preparation>(scope: string, defaults: T): T {
  try {
    const parsed: unknown = JSON.parse(sessionStorage.getItem(key(scope)) || 'null')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return structuredClone(defaults)
    const values = parsed as Record<string, unknown>
    const result = structuredClone(defaults)
    for (const [field, fallback] of Object.entries(defaults)) {
      const value = values[field]
      const valid = Array.isArray(fallback) ? Array.isArray(value) && value.every(item => typeof item === 'string')
        : typeof fallback === 'object' ? !!value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(item => typeof item === 'string')
        : typeof value === typeof fallback && (typeof value !== 'number' || Number.isFinite(value))
      if (valid) Object.assign(result, { [field]: value })
    }
    return result
  } catch { return structuredClone(defaults) }
}

export function writePreparation(scope: string, value: Preparation): boolean {
  try { sessionStorage.setItem(key(scope), JSON.stringify(value)); return true } catch { return false }
}
