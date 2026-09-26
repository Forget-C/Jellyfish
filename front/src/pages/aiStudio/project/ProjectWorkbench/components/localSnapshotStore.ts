/**
 * 前端**本地快照存储**的通用件：存储抽象、作用域键、时间戳过期、条数上限、JSON 读写容错。
 *
 * 为什么抽出来：第 2 步工作台已经有两处「把东西存进 `localStorage` 防丢失」的需求 ——
 *   - 「本轮生成结果与进度」`assetRoundStore.ts`（缺陷 D5）；
 *   - 「生成图片提示词的未保存草稿」`workbench/assetPromptDrafts.ts`（真实事故：付费结果被刷新弄丢）。
 * 两处引用的口径必须**完全一致**（7 天过期、60 条上限、"项目 + 集"分键、坏数据静默降级），
 * 各写一套迟早会漂移。于是这里只留纯函数与存储包装，**不含任何业务字段、不碰网络、不碰 React**。
 *
 * 一条贯穿全文件的原则：**坏数据与坏存储都不许让页面炸**。浏览器可能处于隐私模式、
 * 配额可能满、`localStorage` 里可能是别人（旧版本、手改）写进去的脏内容 ——
 * 所有读写要么成功，要么静默返回"没有/没写成"，绝不抛异常。
 */

/** 只依赖这三个方法的存储抽象（浏览器传 `localStorage`，测试传假实现）。 */
export type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
  removeItem: (key: string) => void
}

/** 没有集（章节）时的固定桶名：不是空字符串，避免拼出容易撞上的键。 */
export const NO_CHAPTER_SCOPE = 'all-chapters'

/** 连项目 id 都没有时的兜底段，保证键不会退化成前缀本身。 */
export const UNKNOWN_PROJECT_SCOPE = 'unknown-project'

/** 时间戳允许多少的"未来漂移"（客户端时钟比记录的还早一点，不算过期）。 */
export const MAX_FUTURE_SKEW_MS = 60_000

/** 统一 trim：`null` / `undefined` 都当成空串（不要出现 `"undefined"` 这种键段）。 */
export function cleanId(value: unknown): string {
  return String(value ?? '').trim()
}

/**
 * 作用域存储键：`<前缀>.<项目>.<集>`。
 *
 * 为什么必须按"项目 + 集"分：同一个项目里第 2 步是**集级**的（URL 上的 `?chapter=`），
 * 不带上集就会出现「切到另一集还显示上一集的东西」。
 */
export function scopedStorageKey(prefix: string, projectId: string, chapterId?: string | null): string {
  const project = cleanId(projectId) || UNKNOWN_PROJECT_SCOPE
  const chapter = cleanId(chapterId) || NO_CHAPTER_SCOPE
  return `${prefix}.${project}.${chapter}`
}

/**
 * 解析成普通对象；**任何**坏输入（空串、非 JSON、数组、标量）都返回 null。
 *
 * 返回对象而不是 `unknown`：两处调用方都是"从对象里取字段，取不到就作废"。
 */
export function parseJsonRecord(raw: string | null | undefined): Record<string, unknown> | null {
  const text = String(raw ?? '').trim()
  if (!text) return null
  try {
    const parsed = JSON.parse(text) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
    return parsed as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 时间戳是否**还没过期**。
 *
 * 三条判定（顺序即优先级）：
 *   1. 必须是正数、有限的毫秒时间戳（NaN / 0 / 负数都当无效）；
 *   2. 不能比"现在"晚太多（`maxFutureSkewMs`，默认 60 秒）—— 时钟被改过的时间戳不可信；
 *   3. `now - savedAt` 不得超过 `maxAgeMs`。
 *
 * `maxAgeMs` 是**必填**：写死一个默认值会让人以为"没传就不过期"，那种疏忽只有一个后果 ——
 * 拿几天前的东西冒充"刚才的结果"。
 */
export function isFreshTimestamp(
  savedAt: unknown,
  options: { now?: number; maxAgeMs: number; maxFutureSkewMs?: number },
): boolean {
  const value = Number(savedAt)
  if (!Number.isFinite(value) || value <= 0) return false
  const now = Number.isFinite(options.now) ? Number(options.now) : Date.now()
  const maxAge = Number.isFinite(options.maxAgeMs) ? Number(options.maxAgeMs) : 0
  const skew = Number.isFinite(options.maxFutureSkewMs) ? Number(options.maxFutureSkewMs) : MAX_FUTURE_SKEW_MS
  if (value > now + skew) return false
  return now - value <= maxAge
}

/**
 * 上限裁剪：只保留**最新的 `max` 项**，并保持它们原来的先后顺序。
 *
 * 为什么保留"最新的"而不是"前 N 项"：列表是**按时间追加**的，截断头部才符合
 * "最近一次还能看到"的直觉。同一条时间戳时按原顺序取后面的（更晚写入的算更新）。
 *
 * `timeOf` 是"这一项算什么时候"的取值函数（两处存储的字段名不同，所以由调用方给）。
 */
export function trimNewestBy<T>(items: readonly T[], max: number, timeOf: (item: T) => number): T[] {
  const list = [...items]
  // 非有限的上限（NaN/undefined）当作"不限制"，避免因为一个坏参数把内容全清掉
  const limit = Math.max(0, Math.floor(Number.isFinite(max) ? max : list.length))
  if (list.length <= limit) return list
  if (limit === 0) return []
  const indexed = list.map((item, index) => {
    const raw = Number(timeOf(item))
    return { item, index, time: Number.isFinite(raw) && raw > 0 ? raw : 0 }
  })
  indexed.sort((a, b) => (b.time - a.time !== 0 ? b.time - a.time : b.index - a.index))
  return indexed
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item)
}

/** 读一个键；读不到或存储不可用都返回 null（绝不抛）。 */
export function safeReadItem(storage: StorageLike | null | undefined, key: string): string | null {
  if (!storage) return null
  try {
    return storage.getItem(key)
  } catch {
    return null
  }
}

/** 写一个键；写失败（隐私模式 / 超配额）返回 false，由调用方决定要不要提示（目前一律静默降级）。 */
export function safeWriteItem(storage: StorageLike | null | undefined, key: string, value: string): boolean {
  if (!storage) return false
  try {
    storage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

/** 删一个键；删不掉也不影响使用（下次读取会因为过期/版本不符被作废）。 */
export function safeRemoveItem(storage: StorageLike | null | undefined, key: string): void {
  if (!storage) return
  try {
    storage.removeItem(key)
  } catch {
    // 静默降级
  }
}

/** 浏览器存储（SSR / 隐私模式下可能取不到）。 */
export function getBrowserStorage(): StorageLike | null {
  try {
    if (typeof window === 'undefined') return null
    const storage = window.localStorage
    if (!storage) return null
    return storage
  } catch {
    return null
  }
}
