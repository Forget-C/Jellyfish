/**
 * 第 2 步工作台「生成图片提示词」的**浏览器本地草稿**（纯逻辑，无 React / 无网络，可 `node --test`）。
 *
 * 修的是什么（真实事故）：用户在工作台点了「生成图片提示词（4）」→ 4 次**真实付费**的
 * 文本模型调用都跑完了，但还没点「保存到资产」页面就被关掉 / 刷新 —— 4 条已经付过费的
 * 提示词**全丢**：资产的提示词列还是空的，服务端也没有可恢复的草稿表，钱花了、东西没了。
 *
 * 口径（用户明确要求「保存前可以检查和修改结果」）：**不能**改成"生成完自动落库"。
 * 要做的是**草稿防丢失** —— 生成结果必须活过刷新 / 关页面，但仍然只有用户显式点
 * 「保存到资产」才会写进资产。于是：
 *   1. 任何一次成功生成的结果**立即**写入本地草稿（`localStorage`，**不发任何网络请求、不写库**）；
 *      同一项目 + 同一集 + 同一资产 + 同一槽位是**同一个键，最后一版为准**；
 *   2. 再次打开面板时草稿回填到编辑器里，并标注「草稿（未保存）」；
 *   3. 某一行保存成功后**删掉那一行草稿**（不留"已保存"与"草稿"两份让人分不清）；
 *   4. 草稿带时间戳，超过 7 天作废（与 `assetRoundStore.ts` 同一口径）；
 *      一个键（项目 + 集）最多 60 条，超出丢最旧；键按 `project_id + chapter_id` 隔离。
 *
 * 一条不能踩的线：**恢复路径是只读的**。`planAssetPromptDraftRestore()` 恒定返回
 * `shouldSave: false` / `shouldGenerate: false`，读的时候一个字节都不写；面板里也不存在
 * "恢复完顺手保存或重新生成"的入口 —— 刷新一次绝不能再花一次钱，
 * 也绝不能把用户还没确认的内容写进资产。测试按标记切片扫描面板源码来钉住这一点。
 *
 * 存什么：**只存用户看得见的东西** —— 正文、生成时间、是不是真的调用了文本模型、
 * 耗时、后端本来就上屏的告警、以及生成时的质量结论（中文文案）。回包里的原始片段
 * （可能带内部标识、任务号、文件标识）**不进草稿**；恢复时的质量判定照旧由页面重新算。
 */

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
} from '../localSnapshotStore.ts'

/** 存储抽象由 `localSnapshotStore.ts` 统一提供，这里转出给调用方（面板与测试）。 */
export type { StorageLike }

export const ASSET_PROMPT_DRAFT_PREFIX = 'jellyfish.asset-prompt.drafts'
export const ASSET_PROMPT_DRAFT_VERSION = 1
/** 草稿最长保留时间（与第 2 步「本轮结果」同一口径：7 天）。 */
export const ASSET_PROMPT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000
/** 一个键（项目 + 集）最多保留多少条草稿（超出丢最旧的）。 */
export const ASSET_PROMPT_DRAFT_MAX_ENTRIES = 60

/** 时间戳缺失时前端补的那句话里要写的天数（别把 7 写死在文案里）。 */
export const ASSET_PROMPT_DRAFT_TTL_DAYS = Math.round(ASSET_PROMPT_DRAFT_TTL_MS / (24 * 60 * 60 * 1000))

/**
 * 一条草稿：**一份没保存的提示词**（资产 + 槽位 + 正文 + 生成时的那点信息）。
 *
 * 字段全部是"用户语言"能对上号的东西，没有接口路径 / 模型名 / 任务号 / 文件标识 / 内部字段名。
 */
export type AssetPromptDraftEntry = {
  /** 资产类型（角色 / 场景 / 道具 / 服装） */
  assetType: string
  assetId: string
  /** 资产名：恢复时用来兜底显示（资产清单拿不到名字时也不至于只剩一串 id） */
  assetName: string
  /** 槽位：同一资产的不同槽位是**各自独立**的草稿 */
  slot: string
  /** 提示词正文（用户还没检查 / 修改过的那一版） */
  prompt: string
  /** 这次是不是真的调用了文本模型（演练结果不许当成大模型产物保存） */
  llmCalled: boolean
  /** 这次生成花了多久（毫秒；取不到就是 null） */
  latencyMs: number | null
  /** 生成时后端给的告警（本来就是给用户看的文案） */
  warnings: string[]
  /**
   * 生成时的**依据摘要**（一句话，用户语言：本次用到了项目风格 / 规范化资料几项 / 剧本分镜几项…）。
   *
   * 只存这一句"给人看"的摘要，**不存回包原始片段** —— 原始片段里可能有内部标识、任务号、
   * 文件标识这些不该进草稿的东西。整份依据回包在刷新后确实看不到了，页面会如实说
   * 「本次未提供生成依据」，而不是把摘要冒充成依据。
   */
  basisSummary: string
  /** 生成时的质量结论（中文标签） */
  qualityLabel: string
  /** 生成时的质量原因（中文，用户可见） */
  qualityReason: string
  /** 生成时这条能不能保存到资产（不可用的不许保存，恢复后也不许绕过） */
  savable: boolean
  /** 生成时间戳（毫秒） */
  savedAt: number
}

export type AssetPromptDraftSnapshot = {
  version: number
  projectId: string
  /** 集（章节）ID；空串 = 该项目下不分集的那个桶 */
  chapterId: string
  /** 最近一次写入时间（= 最新那条草稿的时间） */
  savedAt: number
  entries: AssetPromptDraftEntry[]
}

/** 存储键：按 `project_id + chapter_id` 分键（换项目 / 换集互不串）。 */
export function assetPromptDraftStoreKey(projectId: string, chapterId?: string | null): string {
  return scopedStorageKey(ASSET_PROMPT_DRAFT_PREFIX, projectId, chapterId)
}

/** 一条草稿在同一个键里的身份：**资产类型 + 资产 + 槽位**。 */
export function assetPromptDraftEntryKey(entry: {
  assetType?: unknown
  assetId?: unknown
  slot?: unknown
}): string {
  return `${cleanId(entry.assetType)}:${cleanId(entry.assetId)}::${cleanId(entry.slot)}`
}

function stringList(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .slice(0, limit)
}

/**
 * 单条草稿的**消毒**（读回时逐条过一遍）。
 *
 * 判定为无效（返回 null）只有四种情况，都是"这条草稿根本没法用"：
 *   1. 不是对象；2. 资产 / 槽位缺失（不知道该回填到哪一行）；3. 正文是空的（恢复出一行空草稿是误导）；
 *   4. 时间戳无效（没法判过期）。
 * 其余缺字段一律按安全默认值补：读不出的字段**不许让整条草稿作废**（那是已经付过费的内容）。
 */
export function sanitizeAssetPromptDraftEntry(value: unknown): AssetPromptDraftEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  const assetType = cleanId(row.assetType)
  const assetId = cleanId(row.assetId)
  const slot = cleanId(row.slot)
  if (!assetType || !assetId || !slot) return null
  const prompt = typeof row.prompt === 'string' ? row.prompt : ''
  if (!prompt.trim()) return null
  const savedAt = Number(row.savedAt)
  if (!Number.isFinite(savedAt) || savedAt <= 0) return null
  const latency = Number(row.latencyMs)
  return {
    assetType,
    assetId,
    assetName: cleanId(row.assetName) || assetId,
    slot,
    prompt,
    llmCalled: row.llmCalled === true,
    latencyMs: Number.isFinite(latency) && latency >= 0 ? latency : null,
    warnings: stringList(row.warnings),
    basisSummary: cleanId(row.basisSummary),
    qualityLabel: cleanId(row.qualityLabel),
    qualityReason: cleanId(row.qualityReason),
    // 只有**明确写成 false** 才算"生成时就不许保存"；字段缺失不拦（否则一条旧草稿会莫名其妙存不进去）
    savable: row.savable !== false,
    savedAt,
  }
}

/** 上限裁剪：只保留**最新的 `max` 条**，保持先后顺序。 */
export function trimAssetPromptDraftEntries(
  entries: readonly AssetPromptDraftEntry[],
  max: number = ASSET_PROMPT_DRAFT_MAX_ENTRIES,
): AssetPromptDraftEntry[] {
  const limit = Number.isFinite(max) ? max : ASSET_PROMPT_DRAFT_MAX_ENTRIES
  return trimNewestBy(entries, limit, (entry) => entry.savedAt)
}

/** 组装快照（含裁剪）。`savedAt` 不给就用最新那条草稿的时间。 */
export function buildAssetPromptDraftSnapshot(args: {
  projectId: string
  chapterId?: string | null
  entries: readonly AssetPromptDraftEntry[]
  savedAt?: number
  max?: number
}): AssetPromptDraftSnapshot {
  const entries = trimAssetPromptDraftEntries(args.entries, args.max ?? ASSET_PROMPT_DRAFT_MAX_ENTRIES)
  const newest = entries.reduce((max, entry) => Math.max(max, entry.savedAt), 0)
  return {
    version: ASSET_PROMPT_DRAFT_VERSION,
    projectId: cleanId(args.projectId),
    chapterId: cleanId(args.chapterId),
    savedAt: Number.isFinite(Number(args.savedAt)) ? Number(args.savedAt) : newest || Date.now(),
    entries,
  }
}

export function serializeAssetPromptDraftSnapshot(snapshot: AssetPromptDraftSnapshot): string {
  return JSON.stringify(snapshot)
}

/**
 * 反序列化 + 校验（**只读**：不写、不删、不发请求）。
 *
 * 必须同时满足才算有效（否则返回 null，页面就当没有可恢复的草稿）：
 *   1. 是合法 JSON、版本号一致；
 *   2. `project_id` / `chapter_id` 与**当前页面**一致（不同项目 / 不同集绝不串）；
 *   3. 至少还有一条**没过期**的草稿（过期 = 超过 7 天，或时间戳在将来）。
 *
 * 单条坏数据只丢那一条，不让整份作废 —— 里面每一行都是花过钱的。
 *
 * `includeExpired` 只给**删除**用（见 `removeAssetPromptDraftFromStorage`）：
 * 过期只该影响"要不要显示出来"，绝不该影响"能不能删掉"。
 */
export function parseAssetPromptDraftSnapshot(
  raw: string | null | undefined,
  expected: {
    projectId: string
    chapterId?: string | null
    now?: number
    maxAgeMs?: number
    max?: number
    includeExpired?: boolean
  },
): AssetPromptDraftSnapshot | null {
  const parsed = parseJsonRecord(raw)
  if (!parsed) return null
  if (Number(parsed.version) !== ASSET_PROMPT_DRAFT_VERSION) return null
  if (cleanId(parsed.projectId) !== cleanId(expected.projectId)) return null
  if (cleanId(parsed.chapterId) !== cleanId(expected.chapterId)) return null
  const maxAge = Number.isFinite(Number(expected.maxAgeMs))
    ? Number(expected.maxAgeMs)
    : ASSET_PROMPT_DRAFT_TTL_MS
  const entries = (Array.isArray(parsed.entries) ? parsed.entries : [])
    .map(sanitizeAssetPromptDraftEntry)
    .filter((entry): entry is AssetPromptDraftEntry => entry !== null)
    .filter((entry) =>
      expected.includeExpired === true ? true : isFreshTimestamp(entry.savedAt, { now: expected.now, maxAgeMs: maxAge }),
    )
  if (entries.length === 0) return null
  const snapshot = buildAssetPromptDraftSnapshot({
    projectId: cleanId(parsed.projectId),
    chapterId: cleanId(parsed.chapterId),
    entries,
    savedAt: entries.reduce((max, entry) => Math.max(max, entry.savedAt), 0),
    max: expected.max,
  })
  return snapshot
}

/**
 * 合并一条草稿：**同一资产 + 同一槽位覆盖**（最后一版为准），排序为"旧的在前"，
 * 再按上限裁掉最旧的（`trimNewestBy` 保留最新的那些）。
 */
export function upsertAssetPromptDraftEntry(
  entries: readonly AssetPromptDraftEntry[],
  entry: AssetPromptDraftEntry,
  max: number = ASSET_PROMPT_DRAFT_MAX_ENTRIES,
): AssetPromptDraftEntry[] {
  const byKey = new Map<string, AssetPromptDraftEntry>()
  entries.forEach((item) => byKey.set(assetPromptDraftEntryKey(item), item))
  const key = assetPromptDraftEntryKey(entry)
  // 先删再插：这一条移到"最新"的位置
  byKey.delete(key)
  byKey.set(key, entry)
  const ordered = [...byKey.values()].sort((a, b) => a.savedAt - b.savedAt)
  return trimAssetPromptDraftEntries(ordered, max)
}

/** 存储不可用时返回 null（读取一律静默降级成"没有草稿"）。 */
function resolveStorage(storage: StorageLike | null | undefined): StorageLike | null {
  if (storage === undefined) return getBrowserStorage()
  return storage ?? null
}

/** 读回草稿（**只读**：绝不写入、绝不删除、绝不发请求）。 */
export function readAssetPromptDraftEntries(
  storage: StorageLike | null | undefined,
  key: string,
  expected: {
    projectId: string
    chapterId?: string | null
    now?: number
    maxAgeMs?: number
    max?: number
    includeExpired?: boolean
  },
): AssetPromptDraftEntry[] {
  const snapshot = parseAssetPromptDraftSnapshot(safeReadItem(resolveStorage(storage), key), expected)
  return snapshot ? snapshot.entries : []
}

/**
 * 写入**一条**草稿（生成成功后立刻调用）。
 *
 * 同一资产 + 同一槽位覆盖旧的那一版；同时顺手丢掉已过期的、并裁到上限。
 * 空正文 / 缺资产信息 / 时间戳无效 → 不入库（返回 false）。
 * 存储不可用（隐私模式 / 超配额）→ 静默返回 false，**绝不抛异常打断生成流程**。
 */
export function saveAssetPromptDraftToStorage(
  storage: StorageLike | null | undefined,
  key: string,
  args: {
    projectId: string
    chapterId?: string | null
    entry: AssetPromptDraftEntry
    now?: number
    max?: number
  },
): boolean {
  const target = resolveStorage(storage)
  if (!target) return false
  const entry = sanitizeAssetPromptDraftEntry(args.entry)
  if (!entry) return false
  const max = args.max ?? ASSET_PROMPT_DRAFT_MAX_ENTRIES
  const existing = readAssetPromptDraftEntries(target, key, {
    projectId: args.projectId,
    chapterId: args.chapterId,
    now: args.now,
    max,
  })
  const entries = upsertAssetPromptDraftEntry(existing, entry, max)
  if (entries.length === 0) return false
  const snapshot = buildAssetPromptDraftSnapshot({
    projectId: args.projectId,
    chapterId: args.chapterId,
    entries,
    savedAt: entry.savedAt,
    max,
  })
  return safeWriteItem(target, key, serializeAssetPromptDraftSnapshot(snapshot))
}

/**
 * 删掉草稿（某一行**保存成功后**清掉它，避免"已保存"与"草稿"两份并存误导）。
 *
 * `target` 给了就只删那一行（资产 + 槽位）；没给就清掉整个键。
 * 删空了就把键一起删掉（不留空壳）。返回是否真的删掉了内容。
 *
 * 读的时候**带上过期的行**（`includeExpired`）：过期只该决定"要不要显示"，
 * 绝不该让"用户保存成功后清草稿"这件事做不到（那会留下两份让人分不清的内容）。
 */
export function removeAssetPromptDraftFromStorage(
  storage: StorageLike | null | undefined,
  key: string,
  args: {
    projectId: string
    chapterId?: string | null
    target?: { assetType: string; assetId: string; slot: string } | null
    now?: number
    max?: number
  },
): boolean {
  const target = resolveStorage(storage)
  if (!target) return false
  const existing = readAssetPromptDraftEntries(target, key, {
    projectId: args.projectId,
    chapterId: args.chapterId,
    now: args.now,
    includeExpired: true,
  })
  if (existing.length === 0) {
    // 读不出来（键不存在 / 已过期 / 换项目）也别留着脏数据
    if (!args.target) safeRemoveItem(target, key)
    return false
  }
  if (!args.target) {
    safeRemoveItem(target, key)
    return true
  }
  const dropKey = assetPromptDraftEntryKey(args.target)
  const kept = existing.filter((entry) => assetPromptDraftEntryKey(entry) !== dropKey)
  if (kept.length === existing.length) return false
  if (kept.length === 0) {
    safeRemoveItem(target, key)
    return true
  }
  const snapshot = buildAssetPromptDraftSnapshot({
    projectId: args.projectId,
    chapterId: args.chapterId,
    entries: kept,
    max: args.max,
  })
  safeWriteItem(target, key, serializeAssetPromptDraftSnapshot(snapshot))
  return true
}

/* ------------------------------------------------------------------ 恢复（只读） */

/** 面板里的行（能对上草稿的部分：类型 + 资产 + 槽位）。 */
export type AssetPromptDraftRowLike = {
  type: string
  id: string
  category: string
}

export type AssetPromptDraftMatch<T extends AssetPromptDraftRowLike> = {
  row: T
  entry: AssetPromptDraftEntry
}

/**
 * 把草稿对上资产行：**只有类型 + 资产 + 槽位全都对得上**才回填。
 *
 * 对不上的（资产被删了 / 这次只列出了选中的那几项）不去创建新行 —— 页面只显示真实存在的资产，
 * 但条数要如实报出来（`orphanCount`），别让用户以为草稿没了。
 */
export function matchAssetPromptDraftEntries<T extends AssetPromptDraftRowLike>(
  rows: readonly T[],
  entries: readonly AssetPromptDraftEntry[],
): { matched: Array<AssetPromptDraftMatch<T>>; orphanCount: number } {
  const byKey = new Map<string, T>()
  rows.forEach((row) => byKey.set(assetPromptDraftEntryKey({ assetType: row.type, assetId: row.id, slot: row.category }), row))
  const matched: Array<AssetPromptDraftMatch<T>> = []
  const usedRows = new Set<string>()
  let orphanCount = 0
  entries.forEach((entry) => {
    const key = assetPromptDraftEntryKey(entry)
    const row = byKey.get(key)
    if (!row || usedRows.has(key)) {
      orphanCount += 1
      return
    }
    usedRows.add(key)
    matched.push({ row, entry })
  })
  return { matched, orphanCount }
}

/**
 * 恢复计划（纯函数）。
 *
 * `shouldSave` / `shouldGenerate` **恒定 false**：草稿就是"已经生成过、还没保存"的内容，
 * 恢复它既不该写资产、也不该重新生成（重新生成要再花一次钱）。
 * 页面据此只做一件事：把正文回填到编辑器里，等用户自己点「保存到资产」。
 */
export type AssetPromptDraftRestorePlan = {
  restored: boolean
  shouldSave: false
  shouldGenerate: false
  entries: AssetPromptDraftEntry[]
  /** 最新那条草稿的生成时间（没有恢复内容时为 0） */
  savedAt: number
  /** 给用户看的一句话（没有恢复内容时为空串） */
  note: string
  /** 草稿对不上这次列出的资产（没显示出来，但草稿仍在浏览器里） */
  orphanCount: number
}

export function planAssetPromptDraftRestore(
  entries: readonly AssetPromptDraftEntry[],
  options: { orphanCount?: number; now?: number } = {},
): AssetPromptDraftRestorePlan {
  const list = (entries ?? []).filter((entry) => Boolean(sanitizeAssetPromptDraftEntry(entry)))
  if (list.length === 0) {
    return { restored: false, shouldSave: false, shouldGenerate: false, entries: [], savedAt: 0, note: '', orphanCount: 0 }
  }
  const orphanCount = Number.isFinite(Number(options.orphanCount)) ? Math.max(0, Number(options.orphanCount)) : 0
  const savedAt = list.reduce((max, entry) => Math.max(max, entry.savedAt), 0)
  const time = describeAssetPromptDraftTime(savedAt, options.now)
  let note =
    `已从本机草稿恢复 ${list.length} 条还没保存的提示词（生成于 ${time}）。` +
    `恢复是只读的：不会自动保存到资产，也不会重新生成、不会再次计费；` +
    `草稿在本机最多留 ${ASSET_PROMPT_DRAFT_TTL_DAYS} 天，请检查（可以改）后点「保存到资产」。`
  if (orphanCount > 0) {
    note +=
      `另有 ${orphanCount} 条草稿不属于这次列出的资产，暂未显示（它们仍然留在这台机器的浏览器里：` +
      `重新勾选那些资产、再打开这个面板就能看到）。`
  }
  return {
    restored: true,
    shouldSave: false,
    shouldGenerate: false,
    entries: list,
    savedAt,
    note,
    orphanCount,
  }
}

/** 从存储读 + 校验 + 生成恢复计划（**只读**：绝不写入、绝不提交）。 */
export function loadAssetPromptDraftRestorePlan(
  storage: StorageLike | null | undefined,
  key: string,
  expected: {
    projectId: string
    chapterId?: string | null
    /** 这次列出的资产行：用来算"有几条草稿对不上"（不影响读取本身） */
    rows?: readonly AssetPromptDraftRowLike[]
    now?: number
    maxAgeMs?: number
  },
): AssetPromptDraftRestorePlan {
  const entries = readAssetPromptDraftEntries(storage, key, expected)
  const orphanCount = expected.rows
    ? matchAssetPromptDraftEntries(expected.rows, entries).orphanCount
    : 0
  return planAssetPromptDraftRestore(entries, { orphanCount, now: expected.now })
}

/** 面板用的一步到位版本（键由 项目 + 集 算出来，存储默认取浏览器 `localStorage`）。 */
export function loadAssetPromptDraftPlan(args: {
  projectId: string
  chapterId?: string | null
  rows?: readonly AssetPromptDraftRowLike[]
  now?: number
  storage?: StorageLike | null
}): AssetPromptDraftRestorePlan {
  return loadAssetPromptDraftRestorePlan(
    args.storage === undefined ? getBrowserStorage() : args.storage,
    assetPromptDraftStoreKey(args.projectId, args.chapterId),
    args,
  )
}

/** 面板用的一步到位版本：生成成功后立刻存一条草稿。 */
export function saveAssetPromptDraft(args: {
  projectId: string
  chapterId?: string | null
  entry: AssetPromptDraftEntry
  now?: number
  storage?: StorageLike | null
}): boolean {
  return saveAssetPromptDraftToStorage(
    args.storage === undefined ? getBrowserStorage() : args.storage,
    assetPromptDraftStoreKey(args.projectId, args.chapterId),
    args,
  )
}

/** 面板用的一步到位版本：某一行保存到资产成功后，清掉那一行草稿。 */
export function clearAssetPromptDraft(args: {
  projectId: string
  chapterId?: string | null
  target: { assetType: string; assetId: string; slot: string }
  now?: number
  storage?: StorageLike | null
}): boolean {
  return removeAssetPromptDraftFromStorage(
    args.storage === undefined ? getBrowserStorage() : args.storage,
    assetPromptDraftStoreKey(args.projectId, args.chapterId),
    args,
  )
}

/* -------------------------------------------------------------- 回填与展示 */

/** 恢复一条草稿时写进行里的字段（页面直接展开用）。 */
export type RestoredDraftRowFields = {
  draft: string
  status: 'generated'
  llmCalled: boolean
  latencyMs: number | null
  warnings: string[]
  /** 这一行的正文来自本机草稿（渲染「草稿（未保存）」标签） */
  restoredFromDraft: true
  /** 恢复当时的正文：用来判"用户改过没有"（改过之后当时的质量判定就不适用了） */
  restoredPrompt: string
  restoredSavable: boolean
  restoredQualityLabel: string
  restoredQualityReason: string
  /** 生成时的依据摘要（用户语言一句话；整份依据回包不重复保存） */
  restoredBasisSummary: string
  restoredAt: number
  error: string
}

/**
 * 草稿 → 行字段。
 *
 * `status: 'generated'` 是刻意的：它表示"有一版正文等你检查"，**不表示已经保存**；
 * 页面会额外打上「草稿（未保存）」标签把它和绿色「已保存」区分开。
 */
export function buildRestoredDraftRowFields(entry: AssetPromptDraftEntry): RestoredDraftRowFields {
  return {
    draft: entry.prompt,
    status: 'generated',
    llmCalled: entry.llmCalled,
    latencyMs: entry.latencyMs,
    warnings: entry.warnings,
    restoredFromDraft: true,
    restoredPrompt: entry.prompt,
    restoredSavable: entry.savable,
    restoredQualityLabel: entry.qualityLabel,
    restoredQualityReason: entry.qualityReason,
    restoredBasisSummary: entry.basisSummary,
    restoredAt: entry.savedAt,
    error: '',
  }
}

/** 生成时间 → 人话（今天显示「今天 14:05」，其它天显示「09-18 14:05」）。 */
export function describeAssetPromptDraftTime(savedAt: unknown, now: number = Date.now()): string {
  const value = Number(savedAt)
  if (!Number.isFinite(value) || value <= 0) return '时间未知'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '时间未知'
  const pad = (input: number) => String(input).padStart(2, '0')
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  const reference = new Date(Number.isFinite(now) ? Number(now) : Date.now())
  const sameDay =
    date.getFullYear() === reference.getFullYear() &&
    date.getMonth() === reference.getMonth() &&
    date.getDate() === reference.getDate()
  return sameDay ? `今天 ${clock}` : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`
}

/**
 * 恢复来的草稿**能不能保存**（不能绕过生成时的质量拦截）。
 *
 *   - 不是恢复来的草稿（本次刚生成的）→ 不在这里管；
 *   - 恢复的正文已经被用户改过（或这一行又生成过一次）→ 当时的判定不再适用，按现在的正文重新判；
 *   - 没改过、且生成当时就被判"不可用" → 继续保持不许保存，并把当时的原因说出来。
 */
export function resolveRestoredDraftSaveGuard(row: {
  restoredFromDraft?: boolean
  restoredPrompt?: string
  restoredSavable?: boolean
  restoredQualityReason?: string
  draft?: string
}): { blocked: boolean; reason: string } {
  if (row.restoredFromDraft !== true) return { blocked: false, reason: '' }
  if (String(row.draft ?? '') !== String(row.restoredPrompt ?? '')) return { blocked: false, reason: '' }
  if (row.restoredSavable !== false) return { blocked: false, reason: '' }
  return {
    blocked: true,
    reason: cleanId(row.restoredQualityReason) || '这条提示词在生成时就被判为不可用',
  }
}

/** 行内那句说明：草稿是什么时候生成的、当时判成什么（用户改过内容后当时的判定不再适用）。 */
export function buildRestoredDraftLine(
  row: {
    restoredFromDraft?: boolean
    restoredAt?: number
    restoredPrompt?: string
    restoredQualityLabel?: string
    restoredBasisSummary?: string
    draft?: string
  },
  now: number = Date.now(),
): string {
  if (row.restoredFromDraft !== true) return ''
  const parts = [`本机草稿（未保存）· 生成于 ${describeAssetPromptDraftTime(row.restoredAt, now)}`]
  const label = cleanId(row.restoredQualityLabel)
  if (label) {
    const edited = String(row.draft ?? '') !== String(row.restoredPrompt ?? '')
    parts.push(edited ? `生成时的判定「${label}」（你改过内容，这条判定不再适用）` : `生成时的判定「${label}」`)
  }
  // 依据摘要：只回显这一句用户语言；整份依据回包没保存，页面照旧显示「本次未提供生成依据」
  const basis = cleanId(row.restoredBasisSummary)
  if (basis) parts.push(`生成时的依据：${basis}`)
  return parts.join(' · ')
}
