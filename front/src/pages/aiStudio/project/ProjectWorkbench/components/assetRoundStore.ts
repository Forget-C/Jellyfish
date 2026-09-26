/**
 * 第 2 步「资产准备」→ 本轮生成结果与进度的**前端持久化**（缺陷 D5）。
 *
 * 现象：生成结果后刷新页面，**结果卡片与进度标签消失**（定版 / 图片 / 提示词 / 顶部状态都还在，
 * 因为它们在后端）；用户看到的像是"结果丢了"。
 *
 * 做法（都在前端，**不新增后端接口、不写数据库**）：
 *   - 把「本轮生成结果与进度」（`ProductionTask[]`）序列化进 `localStorage`；
 *   - 键按 **project_id + chapter_id** 分开（换项目 / 换集互不串）；
 *   - 快照带**时间戳**，超期（默认 7 天）直接作废；条数有**上限**（默认 60 条，保留最新的）；
 *   - 恢复是**只读**的：`planRoundRestore()` 明确返回 `shouldSubmit: false`，
 *     并且把刷新前"还没跑完"的项（待提交 / 正在提交 / 正在生成）标成**已停止**，
 *     附一句"不会自动重新提交"的说明 —— 恢复动作绝不会再次计费。
 *
 * 为什么必须这么小心：出图是真实付费调用。若"恢复"顺手把在途项重新提交一遍，
 * 刷新一次就等于再花一次钱。所以恢复路径里**没有任何提交/轮询入口**，只有纯函数与读写。
 *
 * 实现位置：TTL / 上限裁剪 / 序列化容错 / `StorageLike` 都来自 `localSnapshotStore.ts`
 * （与「提示词草稿」`workbench/assetPromptDrafts.ts` 共用同一套口径），本文件只保留
 * 「本轮结果」自己的字段与恢复语义。
 */

import type { ProductionTask, ProductionTaskStatus } from './assetProduction.ts'
// 通用件（TTL / 上限 / 序列化容错 / 存储抽象）在两处本地草稿里共用，见 localSnapshotStore.ts
import {
  cleanId,
  getBrowserStorage,
  isFreshTimestamp,
  parseJsonRecord,
  safeReadItem,
  safeRemoveItem,
  safeWriteItem,
  scopedStorageKey,
  trimNewestBy,
  type StorageLike,
} from './localSnapshotStore.ts'

export const ROUND_STORE_PREFIX = 'jellyfish.asset-production.round'
export const ROUND_STORE_VERSION = 1
/** 一次最多存多少条结果（超出只保留最新的）。 */
export const ROUND_STORE_MAX_TASKS = 60
/** 快照最长保留时间（超过就作废，避免拿几天前的进度当"本轮"）。 */
export const ROUND_STORE_TTL_MS = 7 * 24 * 60 * 60 * 1000

/**
 * 存储抽象与浏览器存储都来自 `localSnapshotStore.ts`，这里**原样转出**：
 * 既有调用方（`AssetProductionArea` / `assetRoundStore.test.ts`）从本模块引用它们，
 * 不能让它们的导入路径失效。
 */
export type { StorageLike }
export { getBrowserStorage }
/** 「没有集」的桶名与键拼装规则共用一份（`localSnapshotStore.ts`），避免两处各写一套。 */
export { NO_CHAPTER_SCOPE } from './localSnapshotStore.ts'

export type RoundSnapshot = {
  version: number
  projectId: string
  /** 集（章节）ID；空串 = 该项目下不分集的那个桶 */
  chapterId: string
  /** 写入时间戳（毫秒） */
  savedAt: number
  tasks: ProductionTask[]
}

/**
 * 存储键：按 **project_id + chapter_id** 分键（拼接规则见 `scopedStorageKey`）。
 *
 * 为什么带上集：同一个项目里，第 2 步是**集级**的（URL 上的 `?chapter=`），
 * 不带上集就会出现「切到另一集还显示上一集的结果卡片」。
 */
export function roundStoreKey(projectId: string, chapterId?: string | null): string {
  return scopedStorageKey(ROUND_STORE_PREFIX, projectId, chapterId)
}

/** 排序用时间：优先 `updatedAt`，其次 `createdAt`（取不到按 0）。 */
function taskTime(task: Pick<ProductionTask, 'updatedAt' | 'createdAt'>): number {
  const updated = Number(task?.updatedAt)
  if (Number.isFinite(updated) && updated > 0) return updated
  const created = Number(task?.createdAt)
  return Number.isFinite(created) && created > 0 ? created : 0
}

/**
 * 上限裁剪：只保留**最新的 `max` 条**，并保持它们原来的先后顺序。
 *
 * 注意保留的是"最新的"而不是"前 N 条"：结果卡片是按轮次追加的，
 * 截断头部才符合"最近一轮能看到"的直觉。通用实现在 `trimNewestBy`。
 */
export function trimRoundTasks<T extends Pick<ProductionTask, 'updatedAt' | 'createdAt'>>(
  tasks: readonly T[],
  max: number = ROUND_STORE_MAX_TASKS,
): T[] {
  const limit = Number.isFinite(max) ? max : ROUND_STORE_MAX_TASKS
  return trimNewestBy(tasks, limit, taskTime)
}

/** 组装快照（含裁剪）。 */
export function buildRoundSnapshot(args: {
  projectId: string
  chapterId?: string | null
  tasks: readonly ProductionTask[]
  savedAt?: number
  max?: number
}): RoundSnapshot {
  return {
    version: ROUND_STORE_VERSION,
    projectId: cleanId(args.projectId),
    chapterId: cleanId(args.chapterId),
    savedAt: Number.isFinite(args.savedAt) ? Number(args.savedAt) : Date.now(),
    tasks: trimRoundTasks(args.tasks, args.max ?? ROUND_STORE_MAX_TASKS),
  }
}

export function serializeRoundSnapshot(snapshot: RoundSnapshot): string {
  return JSON.stringify(snapshot)
}

function isTaskLike(value: unknown): value is ProductionTask {
  const row = value as Partial<ProductionTask> | null
  return Boolean(row && typeof row === 'object' && typeof row.key === 'string' && row.key.length > 0)
}

/**
 * 反序列化 + 校验。
 *
 * 必须**同时**满足才算有效（否则返回 null，页面就当没有可恢复的内容）：
 *   1. 是合法 JSON、版本号一致；
 *   2. project_id 与 chapter_id 与**当前页面**一致（不同项目/不同集绝不串）；
 *   3. 快照没过期（`savedAt` 在 TTL 内，且不是未来时间）；
 *   4. `tasks` 是数组（逐条过滤掉结构不对的行）。
 */
export function parseRoundSnapshot(
  raw: string | null | undefined,
  expected: { projectId: string; chapterId?: string | null; now?: number; maxAgeMs?: number },
): RoundSnapshot | null {
  const parsed = parseJsonRecord(raw)
  if (!parsed) return null
  const snapshot = parsed as Partial<RoundSnapshot>
  if (Number(snapshot.version) !== ROUND_STORE_VERSION) return null
  if (cleanId(snapshot.projectId) !== cleanId(expected.projectId)) return null
  if (cleanId(snapshot.chapterId) !== cleanId(expected.chapterId)) return null
  const savedAt = Number(snapshot.savedAt)
  const maxAge = Number.isFinite(Number(expected.maxAgeMs)) ? Number(expected.maxAgeMs) : ROUND_STORE_TTL_MS
  if (!isFreshTimestamp(savedAt, { now: expected.now, maxAgeMs: maxAge })) return null
  const tasks = Array.isArray(snapshot.tasks) ? snapshot.tasks.filter(isTaskLike) : []
  return {
    version: ROUND_STORE_VERSION,
    projectId: cleanId(snapshot.projectId),
    chapterId: cleanId(snapshot.chapterId),
    savedAt,
    tasks: trimRoundTasks(tasks, ROUND_STORE_MAX_TASKS),
  }
}

/** 刷新前"还没跑完"的三种状态。 */
export const UNFINISHED_TASK_STATUSES: ProductionTaskStatus[] = ['queued', 'submitting', 'generating']

/** 恢复时给"刷新前还没跑完"的项补的那句话（说清不会被重新提交）。 */
export const RESTORED_UNFINISHED_NOTE =
  '这条在刷新前还没跑完：只是把当时的进度原样显示出来，不会自动重新提交、也不会再次计费；要再出一张请点「重新生成」。'

export type RoundRestorePlan = {
  /** 是否真的恢复出了内容 */
  restored: boolean
  /**
   * **永远为 false**：恢复是只读的，不需要（也不允许）因为恢复而提交任何出图请求。
   * 页面据此绝不触发提交/轮询，测试也据此断言"恢复不产生提交动作"。
   */
  shouldSubmit: false
  savedAt: number
  tasks: ProductionTask[]
  /** 给用户看的一句话（没有恢复内容时为空串） */
  note: string
  /** 被标成"已停止"的未完成项条数 */
  unfinishedCount: number
}

/**
 * 恢复计划（纯函数）。
 *
 * 两件事：
 *   1. 把在途状态（待提交 / 正在提交 / 正在生成）改成**已停止**并补上说明 ——
 *      刷新后并没有真的在跑，继续显示"正在生成"是假话，而且会让整区的按钮一直被禁用；
 *   2. 返回 `shouldSubmit: false`，页面**只做只读恢复**。
 */
export function planRoundRestore(snapshot: RoundSnapshot | null): RoundRestorePlan {
  if (!snapshot || snapshot.tasks.length === 0) {
    return { restored: false, shouldSubmit: false, savedAt: 0, tasks: [], note: '', unfinishedCount: 0 }
  }
  let unfinishedCount = 0
  const tasks = snapshot.tasks.map((task) => {
    if (!UNFINISHED_TASK_STATUSES.includes(task.status)) return task
    unfinishedCount += 1
    return { ...task, status: 'stopped' as ProductionTaskStatus, note: RESTORED_UNFINISHED_NOTE }
  })
  const note =
    unfinishedCount > 0
      ? `已恢复上次的 ${tasks.length} 张结果与进度（只读，不会重新提交）：其中 ${unfinishedCount} 项在刷新前没跑完，已标为「已停止」。`
      : `已恢复上次的 ${tasks.length} 张结果与进度（只读，不会重新提交）。`
  return {
    restored: true,
    shouldSubmit: false,
    savedAt: snapshot.savedAt,
    tasks,
    note,
    unfinishedCount,
  }
}

/** 从存储读 + 校验 + 生成恢复计划（**只读**：绝不写入、绝不提交）。 */
export function loadRoundPlan(
  storage: StorageLike | null | undefined,
  key: string,
  expected: { projectId: string; chapterId?: string | null; now?: number },
): RoundRestorePlan {
  const raw = safeReadItem(storage, key)
  return planRoundRestore(parseRoundSnapshot(raw, expected))
}

/** 写入快照（空列表 = 清掉，不留下空壳）。写失败（隐私模式/超配额）一律静默降级。 */
export function saveRoundToStorage(
  storage: StorageLike | null | undefined,
  key: string,
  args: { projectId: string; chapterId?: string | null; tasks: readonly ProductionTask[]; savedAt?: number },
): boolean {
  if (!storage) return false
  if (args.tasks.length === 0) {
    clearRoundFromStorage(storage, key)
    return false
  }
  return safeWriteItem(storage, key, serializeRoundSnapshot(buildRoundSnapshot(args)))
}

export function clearRoundFromStorage(storage: StorageLike | null | undefined, key: string): void {
  safeRemoveItem(storage, key)
}
