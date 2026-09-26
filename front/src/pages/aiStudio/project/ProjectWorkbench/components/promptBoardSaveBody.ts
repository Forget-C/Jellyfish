/**
 * 「确认保存」请求体的**纯构造**（无 React、无网络，可直接 `node --test` 单测）。
 *
 * 为什么必须抽成纯函数（2026-09-20 口径修正）：
 * 页面最终保存走的是 `POST /api/v1/studio/prompt-board/{chapter_id}/save`。
 * 这个请求体此前由页面内联拼装，并且用**复数** `script_ids: [matchedScriptId]` 表达
 * "本批属于哪一个脚本组" —— 而后端当时**静默忽略**这个字段，于是页面上"恰好一组"
 * 的约束在真实保存路径上根本不存在后端保证。
 *
 * 现在的契约（后端已按此实现，任何一条都不能只在页面上"看起来对"）：
 * 1. 请求体只出现**单数** `script_id`；复数 `script_ids` **一个字符都不再出现**
 *    （后端收到复数会明确 400，不是静默忽略）；
 * 2. `origin=jurilu_import` 时，请求级 `script_id` 与本批**每一条** entry 的 `script_id`
 *    必须完全一致（跨组混写一律拒绝）；
 * 3. 其它来源（`llm_draft` / `external_import` / `manual`）**两个字段都不出现**
 *    （不是传空串，而是键都不发）。
 *
 * 这里只负责"拼请求体"和"发出去之前的自检"；真正拍板写库的仍是服务端。
 */

import type { PromptBoardMode, PromptBoardOrigin } from '../../../../../services/llmPipelineApi'

/** 进保存请求的一行（`EpisodeVideoPromptBoard` 的 `PreviewRow` 子集）。 */
export interface SaveEntryRow {
  shotId: string
  prompt: string
  /** 该行属于哪个巨日禄脚本组（非巨日禄来源为空 / 未定义） */
  scriptId?: string
  /** 大模型草稿令牌（`origin=llm_draft` 且正文是服务端生成时才有） */
  draftToken?: string
}

export interface PromptBoardSaveEntry {
  shot_id: string
  prompt: string
  draft_token?: string
  script_id?: string
}

/** `/save` 的请求体（与后端 `BoardSaveRequest` 逐字段对齐）。 */
export interface PromptBoardSaveBody {
  entries: PromptBoardSaveEntry[]
  mode: PromptBoardMode
  origin: PromptBoardOrigin
  selected_shot_ids: string[]
  allow_partial: boolean
  /** **单数**脚本组 ID；只有 `origin=jurilu_import` 时出现 */
  script_id?: string
}

export interface BuildSaveBodyInput {
  rows: SaveEntryRow[]
  mode: PromptBoardMode
  origin: PromptBoardOrigin
  /** 当前已匹配的脚本组（页面 `matchedScriptId`）；非巨日禄来源传空即可 */
  matchedScriptId?: string
  selectedShotIds?: string[]
  allowPartial: boolean
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

/**
 * 拼请求体。规则见文件头：
 * - 巨日禄：请求级 `script_id` = 已匹配的那一组；每条 entry 带**同一个** id
 *   （该行自己没有 `scriptId` 时用请求级补齐，绝不"有的带有的不带"）；
 * - 其它来源：`script_id` 与 `entries[].script_id` 的键**都不出现**；
 * - `draft_token` 只有 `origin=llm_draft` 才带（既有口径不变）。
 */
export function buildPromptBoardSaveBody(input: BuildSaveBodyInput): PromptBoardSaveBody {
  const jurilu = input.origin === 'jurilu_import'
  const scriptId = jurilu ? asText(input.matchedScriptId) : ''
  const rows = Array.isArray(input.rows) ? input.rows : []

  const entries: PromptBoardSaveEntry[] = rows.map((row) => {
    const entry: PromptBoardSaveEntry = {
      shot_id: asText(row.shotId),
      prompt: asText(row.prompt),
    }
    if (jurilu) {
      entry.script_id = asText(row.scriptId) || scriptId
    } else if (input.origin === 'llm_draft') {
      const token = asText(row.draftToken)
      if (token) entry.draft_token = token
    }
    return entry
  })

  const body: PromptBoardSaveBody = {
    entries,
    mode: input.mode,
    origin: input.origin,
    selected_shot_ids: (input.selectedShotIds ?? []).map(asText).filter((item) => item !== ''),
    allow_partial: Boolean(input.allowPartial),
  }
  if (jurilu) body.script_id = scriptId
  return body
}

/**
 * 发请求**之前**的脚本组自检：返回 `null` = 可以发，返回中文原因 = 拦下不发。
 *
 * 为什么前端也要拦一道：后端会 400（这是最终保证），但把"哪一条不属于这一组"在页面上
 * 说清楚比让用户吃一个整体失败更好；两边口径必须一致（同一句判定：
 * 请求级必须有组、每条必须与它相同）。
 */
export function juriluScriptScopeError(rows: SaveEntryRow[], matchedScriptId: string): string | null {
  const scriptId = asText(matchedScriptId)
  if (scriptId === '') {
    /* 审计 §4.2：主区文案里不许出现 `script_id` / `scriptId` 这类字段名与内部组编号 */
    return '这次抓取的剧本没有可用的组：默认不跨组合并，本次不发保存请求。'
  }
  const list = Array.isArray(rows) ? rows : []
  for (let index = 0; index < list.length; index += 1) {
    const rowScriptId = asText(list[index]?.scriptId)
    const position = index + 1
    if (rowScriptId === '') {
      return `第 ${position} 条没有所属组：无法确认它属于当前这一组，本次不发保存请求。`
    }
    if (rowScriptId !== scriptId) {
      return `第 ${position} 条属于另一组，与当前选中的组不一致：默认不跨组合并，本次不发保存请求。`
    }
  }
  return null
}
