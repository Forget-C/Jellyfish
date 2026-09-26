/**
 * 主区时间口径（阶段 B 第 2 批：工作台五步）。
 *
 * ## 为什么需要它
 *
 * 审计文档 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md` §4.2 模式 3 点名：
 * 工作台步骤 1 的「更新时间」列**没有 `render`**，于是后端给的
 * `2026-09-26T04:02:58.135Z` 原样上了屏 —— 这是典型的「渲染点把后端值直接渲出来」，
 * 而不是「文案里写死了 ISO 串」，所以改文案字符串没用，必须在**渲染点**换格式。
 *
 * 修复要求是「复用 `ProjectLobby.tsx` 的既有实现」，所以本模块就是那份实现的
 * **唯一**落点：`ProjectLobby.tsx` 与本模块的调用方都从这里取，
 * 全仓不再有第二份 `YYYY-MM-DD HH:mm` 拼装。
 *
 * 口径：
 *   - 空值 / `undefined` → `—`
 *   - 解析不出来 → 原样返回（后端给的本来就是给人看的字符串时不动它）
 *   - 正常 → 本地时区的 `YYYY-MM-DD HH:mm`（不带秒、不带毫秒、不带 `T`/`Z`）
 *
 * 纯函数，不 import React / antd，`node --test` 能直接加载。
 */

/** 无法从后端值里解析出时间时，主区显示这个（不是内部原文）。 */
export const USER_FACING_TIME_EMPTY = '—'

/**
 * 后端时间值 → 主区可显示的中文时间。
 *
 * ⚠️ 绝不把 ISO 串原样返回：`2026-09-26T04:02:58.135Z` 对用户既不可读，
 * 又暴露了后端的时间存储形态（模式 3）。
 */
export function formatUserFacingTime(value?: string | null): string {
  const raw = String(value ?? '').trim()
  if (!raw) return USER_FACING_TIME_EMPTY
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/**
 * 是否是一个「机器时间串」（ISO / RFC3339 之类）——用于测试与排查，
 * 不参与渲染判断（渲染一律走 `formatUserFacingTime`）。
 */
export function looksLikeMachineTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/.test(String(value ?? '').trim())
}
