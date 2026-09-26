/**
 * 「广告剧情流程」的取数层（剧情策划页专用）。
 *
 * 为什么不走 OpenAPI generated client
 * ------------------------------------
 * 已提交的 `front/openapi.json` 与源码**已经漂移**（源码 165 个路由装饰器、
 * spec 里只有 138 条 path），`pnpm run openapi:update` 生成出来的 client 里没有本批新端点。
 * 生成目录是自动产物、不该手改，所以这里按 `llmPipelineApi` 的既有做法直接 fetch：
 * 复用它的 `callApi`（GET/POST）与 `GenerationRequestError`（同一套信封解析与错误类型），
 * 只为 PUT 补一个本地薄封装 —— 不往共享的 1400 行模块里加东西，避免多线同时改同一个文件。
 *
 * 能力探测：本批端点是否已上线**靠读 /openapi.json 判断**，不靠"先试着调一次"
 * （那会真的扣钱）。先例见 `assetProductionApi.fetchReferenceReworkAvailability`。
 */

import { OpenAPI } from './generated/core/OpenAPI'
/* `GenerationRequestError` 只用于再导出（`export type`），所以走 `import type`；
   `buildRequestFailure` 是构造出口（值），必须走值导入。 */
import { buildRequestFailure, callApi } from './llmPipelineApi'
import type { GenerationRequestError } from './llmPipelineApi'

const API = '/api/v1/studio'

// ---------------------------------------------------------------------------
// 类型（与后端 schemas/studio/drama_plan.py 一一对应）
// ---------------------------------------------------------------------------

export type DramaBrief = {
  product_name: string
  product_description: string
  selling_points: string[]
  target_audience: string
  genre: string
  tone: string
  duration_seconds: number
  shot_count: number
  brand_voice: string
  mandatory_elements: string[]
  forbidden_elements: string[]
  director_notes: string
}

export type DramaPlanDialogue = { speaker: string; text: string; mode: string }

export type DramaPlanShot = {
  index: number
  title: string
  characters: string[]
  script_excerpt: string
  description: string
  duration: number
  camera_shot: string
  angle: string
  movement: string
  action_beats: string[]
  dialogue: DramaPlanDialogue[]
  product_present: boolean
}

export type DramaPlanNamedAsset = { name: string; profile: Record<string, string>; shot_indexes: number[] }

export type DramaPlan = {
  title: string
  logline: string
  selling_points: string[]
  characters: DramaPlanNamedAsset[]
  scenes: DramaPlanNamedAsset[]
  product: (DramaPlanNamedAsset & { description: string }) | null
  shots: DramaPlanShot[]
  climax: string
  warnings: string[]
}

export type DramaPlanRead = {
  chapter_id: string
  project_id: string
  has_draft: boolean
  status: 'none' | 'running' | 'ok' | 'failed' | string
  brief: DramaBrief
  plan: DramaPlan | null
  error: string
  model: string
  meta: Record<string, unknown>
  claim_expires_at: string
  updated_at: string
  note: string
}

export type DramaPlanConfirm = {
  chapter_id: string
  shots_created: number
  dialog_lines_created: number
  characters_created: number
  scenes_created: number
  product_created: boolean
  shot_product_links: number
  shot_character_links: number
  warnings: string[]
  note?: string
}

export type WorkingChapter = { chapter_id: string; project_id: string; created: boolean; title: string }

/** 空 brief（新建时的默认值）。 */
export function emptyBrief(): DramaBrief {
  return {
    product_name: '',
    product_description: '',
    selling_points: [],
    target_audience: '',
    genre: '',
    tone: '',
    duration_seconds: 0,
    shot_count: 6,
    brand_voice: '',
    mandatory_elements: [],
    forbidden_elements: [],
    director_notes: '',
  }
}

// ---------------------------------------------------------------------------
// PUT 薄封装（callApi 只有 GET/POST；DELETE/PATCH 也各有自己的薄封装，同一习惯）
// ---------------------------------------------------------------------------

async function callApiPut<T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${OpenAPI.BASE}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload: Record<string, unknown> | undefined
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    /* 与 `callApi` 同口径（审计 §4.7 服务层）：`message` 只保留中文结论，
       后端原文 / `detail` / 响应体 / 状态码收进 `GenerationRequestError.technical`。
       本文件是 `callApi` 的同型薄封装，**不在这里另起一套话术** —— 复用同一个构造出口。 */
    throw buildRequestFailure(null, response.status, text, payload)
  }
  return (payload?.data ?? null) as T
}

// ---------------------------------------------------------------------------
// 能力探测：本批端点是否已在后端上线（读 /openapi.json，不试调）
// ---------------------------------------------------------------------------

let availabilityCache: boolean | null = null

export async function fetchDramaPlanAvailability(): Promise<boolean> {
  if (availabilityCache !== null) return availabilityCache
  try {
    const resp = await fetch(`${OpenAPI.BASE}/openapi.json`, { method: 'GET' })
    if (!resp.ok) {
      availabilityCache = false
      return false
    }
    const spec = (await resp.json()) as { paths?: Record<string, unknown> }
    const paths = spec.paths ?? {}
    availabilityCache = Object.keys(paths).some((key) => key.endsWith('/drama-plan/generate'))
  } catch {
    availabilityCache = false
  }
  return availabilityCache
}

/** 仅供测试/热更新后强制重新探测。 */
export function resetDramaPlanAvailability(): void {
  availabilityCache = null
}

// ---------------------------------------------------------------------------
// 端点
// ---------------------------------------------------------------------------

/** 项目里取一个可用空章节（没有就建一个，标题取商品名）。 */
export function resolveWorkingChapter(projectId: string, productName: string): Promise<WorkingChapter> {
  return callApi<WorkingChapter>(`${API}/projects/${encodeURIComponent(projectId)}/drama-plan/chapter`, {
    product_name: productName,
  })
}

/** 读草稿（只读，永不付费）。 */
export function getDramaPlan(chapterId: string): Promise<DramaPlanRead> {
  return callApi<DramaPlanRead>(`${API}/chapters/${encodeURIComponent(chapterId)}/drama-plan`)
}

/** 保存 brief（免费，绝不触发模型调用）。 */
export function saveDramaBrief(chapterId: string, brief: DramaBrief): Promise<DramaPlanRead> {
  return callApiPut<DramaPlanRead>(
    `${API}/chapters/${encodeURIComponent(chapterId)}/drama-plan/brief`,
    brief as unknown as Record<string, unknown>,
  )
}

/** 保存手改后的草稿（免费，只写草稿列）。 */
export function saveDramaDraft(chapterId: string, plan: DramaPlan): Promise<DramaPlanRead> {
  return callApiPut<DramaPlanRead>(
    `${API}/chapters/${encodeURIComponent(chapterId)}/drama-plan/draft`,
    plan as unknown as Record<string, unknown>,
  )
}

/** 生成剧情方案（**会调用 1 次模型**；演练模式下返回占位且不落草稿）。 */
export function generateDramaPlan(chapterId: string): Promise<DramaPlanRead> {
  return callApi<DramaPlanRead>(`${API}/chapters/${encodeURIComponent(chapterId)}/drama-plan/generate`, {})
}

/** 确认落成正式内容（一个事务）。 */
export function confirmDramaPlan(chapterId: string): Promise<DramaPlanConfirm> {
  return callApi<DramaPlanConfirm>(`${API}/chapters/${encodeURIComponent(chapterId)}/drama-plan/confirm`, {})
}

export type { GenerationRequestError }
