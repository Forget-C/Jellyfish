/**
 * LLM 管线前端共享 API 层。
 *
 * 为什么单独放一个模块（而不是直接用 `services/generated`）：
 * - 生成客户端来自 `npm run openapi:update`，而那条脚本依赖 pnpm（本机未安装），
 *   且新增的 `/api/v1/studio/llm/*`、`/api/v1/studio/image-pipeline/*` 尚未进入生成物；
 * - 生成目录是自动产物，不应手改。
 * 因此这里按 `PromptFlowPage` 里已有的做法，用 `OpenAPI.BASE` 拼绝对地址直接 fetch，
 * 并按后端统一信封 `{code, message, data, meta}` 解包：成功取 `data`，失败读 `meta.error`。
 *
 * 生产流程的 5 个页面都从这里取能力，避免每页各写一套。
 */

/* 显式指向 `core/OpenAPI` 而不是目录 `./generated`：目录导入在 Vite 下可用、
   **在 Node ESM（`node --test`）下会报 ERR_UNSUPPORTED_DIR_IMPORT**，
   而本文件的错误构造口径必须能被单测直接验证（审计 §4.7 服务层要求「原文进技术字段」）。
   生成物本身一个字都没改。 */
import { OpenAPI } from './generated/core/OpenAPI.ts'
import {
  extractJuriluDiagnostics as extractJuriluDiagnosticsFromModule,
  type StoryboardAttemptShape,
} from './juriluDiagnostics.ts'

export type AnyRecord = Record<string, any>

/**
 * 一次失败响应的**技术字段**（审计 §4.7「服务层」口径）。
 *
 * 为什么要有它：改前 `callApi` / `callApiDelete` / `callApiPatch` / `parseScriptDocument`
 * 都把「后端原文 + `detail` 的 `JSON.stringify` + 整个响应体 + `HTTP {status}`」
 * 拼进 `error.message`，而页面普遍 `message.error(error.message)` —— 等于把第三层内容
 * （后端错误原文 / 响应体 / 内部 ID）摆到主区（模式 6 + 模式 4）。
 * 现在：**`message` 只保留一句中文结论**，原文全部收进本结构（默认收起的「技术详情」读取）。
 */
export type RequestFailureTechnical = {
  /** HTTP 状态码（主区不显示） */
  readonly status: number
  /** 后端统一信封 `meta.error.message`（或 `payload.message`）原文 */
  readonly backendMessage: string
  /** 后端 `detail` 原值（对象原样保留，供结构化错误读取） */
  readonly detail: unknown
  /** 完整响应体文本（截断到 2000 字；技术详情层用） */
  readonly responseText: string
}

/** 响应体在技术字段里的保留上限（够排查，又不至于把大响应体整份挂内存里）。 */
const RESPONSE_TEXT_LIMIT = 2000

function truncateResponseText(text: string): string {
  const value = String(text ?? '')
  return value.length > RESPONSE_TEXT_LIMIT ? `${value.slice(0, RESPONSE_TEXT_LIMIT)}…` : value
}

/**
 * HTTP 状态码 → **主区中文结论**（产品自己写的句子，不随后端措辞漂移，审计 §7.1-8）。
 *
 * 不含状态码本身、不含接口路径、不含后端原文 —— 这些都在 `RequestFailureTechnical` 里。
 */
export function requestFailureConclusion(status: number): string {
  if (status === 400) return '提交的内容没有被接受，请检查后重试'
  if (status === 401 || status === 403) return '登录或访问凭证已失效，请重新登录后再试'
  if (status === 404) return '要操作的内容不存在，可能已被删除，请刷新后再试'
  if (status === 409) return '当前状态不允许这一步操作，请刷新后再试'
  if (status === 413) return '文件太大，请换一个小一些的文件'
  if (status === 422) return '填写的内容不符合要求，请检查后重试'
  if (status === 429) return '操作太频繁，请稍后再试'
  if (status >= 500) return '服务端出错了，请稍后重试'
  return '这一步没有成功，请稍后重试'
}

/**
 * 带 HTTP 状态码的请求异常。
 *
 * 为什么需要：五类生成状态（演练模式拦截 / 模型未配置 / 参数缺失 / 服务错误 / 正在处理）
 * 要靠状态码区分，而普通 Error 只剩一句 message，前端只能猜。
 * 它继承 Error，所以既有 `catch (e) { e.message }` 的调用方行为不变
 * （**字段名与类型契约不变**：`message` / `status` / `diagnostics` 都在，
 * 只新增 `technical` 与 `detail` 两个技术字段）。
 */
export class GenerationRequestError extends Error {
  status: number
  /** 后端信封 `meta.diagnostics`（脱敏，不含任何凭证）：错误排查用 */
  diagnostics?: Record<string, unknown>
  /**
   * 后端 `detail` 原值（技术字段）。
   *
   * 单独挂一份的理由：既有结构化错误读取（`assetPromptQuality.readStructuredServerError`）
   * 会读 `error.detail` —— 「显式确认覆盖」这类流程靠它，不能因为改了 `message` 就丢。
   */
  detail?: unknown
  /** 后端原文 / 响应体 / 状态码（**技术详情层专用**；主区一句话在 `message`） */
  technical?: RequestFailureTechnical

  constructor(
    message: string,
    status: number,
    diagnostics?: Record<string, unknown>,
    technical?: RequestFailureTechnical,
  ) {
    super(message)
    this.name = 'GenerationRequestError'
    this.status = status
    this.diagnostics = diagnostics
    this.technical = technical
    this.detail = technical?.detail
  }
}

/**
 * 由一次失败响应构造 `GenerationRequestError`（服务层唯一的错误构造出口）。
 *
 * 口径：`message = action ? `${action}：${结论}` : 结论`，**绝不含后端原文 / 状态码 / 响应体**。
 * 导出给同型薄封装（`dramaPlanApi.callApiPut`）复用，避免同一条管道出现两种口径。
 */
export function buildRequestFailure(
  action: string | null,
  status: number,
  text: string,
  payload: AnyRecord | undefined,
  diagnostics?: Record<string, unknown>,
): GenerationRequestError {
  const meta = (payload?.meta ?? {}) as AnyRecord
  const error = (meta.error ?? {}) as AnyRecord
  const technical: RequestFailureTechnical = {
    status,
    backendMessage: String(error.message ?? payload?.message ?? '').trim(),
    detail: payload?.detail,
    responseText: truncateResponseText(text),
  }
  const conclusion = requestFailureConclusion(status)
  return new GenerationRequestError(action ? `${action}：${conclusion}` : conclusion, status, diagnostics, technical)
}

function throwRequestFailure(
  action: string | null,
  status: number,
  text: string,
  payload: AnyRecord | undefined,
  diagnostics?: Record<string, unknown>,
): never {
  throw buildRequestFailure(action, status, text, payload, diagnostics)
}

async function callApi<T = AnyRecord>(path: string, body?: AnyRecord): Promise<T> {
  const response = await fetch(`${OpenAPI.BASE}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let payload: AnyRecord | undefined
  try {
    payload = text ? (JSON.parse(text) as AnyRecord) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    const meta = (payload?.meta ?? {}) as AnyRecord
    throwRequestFailure(
      null,
      response.status,
      text,
      payload,
      (meta.diagnostics as Record<string, unknown> | undefined) ?? undefined,
    )
  }
  return (payload?.data ?? null) as T
}

/**
 * DELETE 版本（草稿清理等端点用；POST 版本见 callApi）。
 *
 * 单独写一个而不是给 callApi 加 method 参数：callApi 的"body 有无决定 GET/POST"
 * 已被十多个调用点依赖，改它等于同时动到所有既有端点。
 */
async function callApiDelete<T = AnyRecord>(path: string): Promise<T> {
  const response = await fetch(`${OpenAPI.BASE}${path}`, { method: 'DELETE' })
  const text = await response.text()
  let payload: AnyRecord | undefined
  try {
    payload = text ? (JSON.parse(text) as AnyRecord) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    throwRequestFailure(null, response.status, text, payload)
  }
  return (payload?.data ?? null) as T
}

/** PATCH 版本（保存类端点用；POST 版本见 callApi）。 */
async function callApiPatch<T = AnyRecord>(path: string, body: AnyRecord): Promise<T> {
  const response = await fetch(`${OpenAPI.BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let payload: AnyRecord | undefined
  try {
    payload = text ? (JSON.parse(text) as AnyRecord) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    throwRequestFailure(null, response.status, text, payload)
  }
  return (payload?.data ?? null) as T
}

/**
 * 生成客户端（`services/generated/core/request.ts`，**自动产物、不手改**）在
 * 未登记状态码上会把**完整响应体**拼进 `ApiError.message`：
 * `Generic Error: status: 409; status text: …; body: {…}`（审计 §4.7 模式 6 + §3.3）。
 *
 * 生成物不许手改 → 在**封装层**统一收口：任何页面把异常交给用户之前，
 * 用本函数取「主区那一句」，原文用 `technicalTextOf` 取（进默认收起的「技术详情」）。
 *
 * ⚠️ 只读不改：**不修改传入的 error 对象**（`message` 原样保留）——
 * 「演练模式拦截」的识别要靠 `body:` 里的 JSON（`generationStatusCore.readErrorCode`），
 * 就地改 `message` 会把这个判定打瞎。
 */
export function toUserFacingApiErrorText(error: unknown, fallback: string): string {
  const status = Number((error as { status?: unknown } | undefined)?.status)
  if (Number.isFinite(status) && status > 0) {
    const conclusion = requestFailureConclusion(status)
    return `${fallback || '这一步没有成功'}：${conclusion}`
  }
  return fallback || '这一步没有成功，请稍后重试'
}

/** 异常的**原文**（技术详情层用；带 `body:` 的响应体也在此，供技术详情展开）。 */
export function technicalTextOf(error: unknown): string {
  if (error instanceof Error) return String(error.message ?? '')
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}


/* ------------------------------------------------------------------ 类型 */

/** 图片提示词的一个槽位（与后端 PromptCategory 一致）。 */
export interface ImagePromptSlot {
  category: string
  label?: string
  entity_name?: string | null
  layers: Record<string, string>
  prompt: string
  negative_prompt: string
  warnings?: string[]
  /**
   * 本次生成**实际用到了什么**（新字段，契约以后端实现为准）。
   *
   * 页面用它渲染默认收起的「生成依据」；后端没有返回时前端**不编造**，
   * 如实显示「本次未提供生成依据」（见 `ProjectWorkbench/components/assetGenerationBasis.ts`）。
   */
  generation_basis?: Record<string, unknown> | null
  /** 同上：容器名也可能是 `basis` / `provenance`（前端几种都认） */
  basis?: Record<string, unknown> | null
  /**
   * 这一条提示词能不能用（新字段，契约以后端实现为准）：
   * `usable: false` + 中文原因（「外观信息不足，需人工补充」等）时，页面会拦住批量出图。
   */
  quality?: Record<string, unknown> | null
  /** 简写形态：后端也可能直接在槽位上给一个布尔量 */
  usable?: boolean | null
  /**
   * **后端本轮质量拦截的正式字段**（`ImagePromptSlotRead.savable`）：
   * false = 这段内容不能保存成「提示词已就绪」，也不能进入批量出图。
   */
  savable?: boolean
  /** 未通过的原因（结构化中文：`{code, message, fix, status_code}`） */
  quality_issues?: Record<string, unknown>[]
  /**
   * 该槽位主体描述的资料来源：
   * `asset_description` / `candidate_profile` / `request` / `none`（没有任何资料，只剩空话兜底）。
   */
  structured_source?: string
}

export interface EntityProfileInput {
  name: string
  entity_type: string
  profile?: string
  base_prompt?: string
  image_prompt?: string
  /** 资产 id（新字段，可选）：后端据此装配该资产的结构化资料与相关剧本片段/分镜 */
  asset_id?: string
}

export interface LlmRunMeta {
  dry_run: boolean
  llm_called: boolean
  latency_ms?: number | null
  raw_output_chars?: number
  json_repairs?: string[]
  dry_run_reason?: string | null
  target?: { model_name?: string; provider_name?: string; base_url?: string } | null
}

export interface ImagePromptPreviewResult {
  shot_id?: string | null
  project_id?: string | null
  shot_text_chars?: number
  slots: ImagePromptSlot[]
  entity_cards?: AnyRecord[]
  warnings: string[]
  meta: LlmRunMeta
  /** 本次生成依据（新字段，可选；容器名可能是 `basis` / `provenance` / `generation_context`） */
  generation_basis?: Record<string, unknown> | null
  basis?: Record<string, unknown> | null
  /** 本次提示词的质量判定（新字段，可选） */
  quality?: Record<string, unknown> | null
}

export interface VideoPromptPreviewResult {
  shot_id?: string | null
  final_prompt: string
  negative_prompt: string
  camera_movement: { key: string; label: string; enum_code?: string | null; db_note?: string }
  camera: { camera_shot: string; angle: string; movement: string; duration?: number | null }
  frame_mode: string
  duration_seconds: number
  subject_action: string
  expression_mood: string
  atmosphere: string
  action_beats: string[]
  warnings: string[]
  meta: LlmRunMeta
}

export interface BindingSuggestion {
  slot: 'characters' | 'scene' | 'props' | 'costumes'
  asset_id: string
  asset_type: string
  asset_name?: string
  confidence: number
  reason: string
  agreement: 'both' | 'llm_only' | 'conflict' | 'heuristic_only'
  tier: 'auto' | 'review' | 'discard'
  already_bound: boolean
  confirm_endpoint: string
}

export interface AssetBindingShot {
  shot_id: string
  index: number
  title: string
  script_excerpt: string
  suggestions: BindingSuggestion[]
  heuristic_suggestions: Record<string, string[]>
  bound: Record<string, string[]>
  warnings: string[]
}

export interface AssetBindingPreviewResult {
  project_id: string
  catalog: AnyRecord[]
  shots: AssetBindingShot[]
  dropped: AnyRecord[]
  unmatched_names: AnyRecord[]
  parse_warnings: string[]
  batch_count: number
  tier_summary: Record<string, number>
  cost_note: string
  meta: LlmRunMeta
}

export interface ImagePlanTarget {
  source_task_id: string
  source_asset_id: string
  asset_type: string
  name: string
  prompt: string
  stage: string
  reference_image: string
  generation_type: string
  aspect_ratio: string
  image_model: string
  object_key_template: string
  /** 提示词实际来源：request / saved（步骤 3 已保存的 image_prompts）/ template。 */
  prompt_source?: 'request' | 'saved' | 'template' | string
  warnings: string[]
}

export interface ImageTaskResult {
  source_asset_id: string
  service_task_id: string
  status: string
  dry_run: boolean
  image_url: string
  oss_url: string
  message: string
}

export type FrameMode = 'single_frame' | 'first_last_frame'

/* ------------------------------------------------------------ 编排层接口 */

/** 九槽位图片提示词生成（只预览，不写库）。 */
export function previewImagePrompts(body: {
  shot_id?: string | null
  shot_text?: string | null
  project_id?: string | null
  entity_profiles?: EntityProfileInput[]
  categories?: string[]
  style_hint?: string
  negative_prompt?: string
  /**
   * 用户对该资产的补充/修改（新字段，可选；后端还没声明这个键时不会发送，
   * 见 `ProjectWorkbench/components/assetPromptRequestContract.ts` 的能力探测）。
   */
  user_supplement?: string
  /** 该资产 id（新字段，可选）：后端据此装配它的结构化资料与相关剧本片段/分镜 */
  asset_id?: string
}): Promise<ImagePromptPreviewResult> {
  return callApi('/api/v1/studio/llm/image-prompt/preview', body as AnyRecord)
}

/** 视频提示词生成（只预览，不写库）。 */
export function previewVideoPrompt(body: {
  shot_id?: string | null
  shot_text?: string | null
  first_frame_image_ref?: string | null
  last_frame_image_ref?: string | null
  camera_movement?: string | null
  duration_seconds?: number | null
  frame_mode?: FrameMode | null
  project_id?: string | null
  entity_profiles?: EntityProfileInput[]
}): Promise<VideoPromptPreviewResult> {
  return callApi('/api/v1/studio/llm/video-prompt/preview', body as AnyRecord)
}

/** 资产关联推荐（只建议，不写库；确认后走既有 link 端点）。 */
export function previewAssetBinding(body: {
  project_id: string
  episode_id?: string
  shot_ids?: string[]
  batch_size?: number
  max_shots?: number
  include_heuristic?: boolean
}): Promise<AssetBindingPreviewResult> {
  return callApi('/api/v1/studio/llm/asset-binding/preview', body as AnyRecord)
}

/* -------------------------------------------------------- 出图 / 出视频 */

/** 出图提交计划（不触网）。 */
export function previewImagePlan(body: {
  project_id: string
  asset_type: 'character' | 'scene' | 'prop'
  stage: 'character_sheet' | 'reference_batch'
  asset_ids?: string[]
  prompt_overrides?: { asset_id: string; prompt: string }[]
  use_primary_reference?: boolean
  aspect_ratio?: string
  image_model?: string
  negative_prompt?: string
}): Promise<{
  project_id: string
  asset_type: string
  stage: string
  targets: ImagePlanTarget[]
  references: AnyRecord[]
  warnings: string[]
  summary: AnyRecord
  dry_run: boolean
}> {
  return callApi('/api/v1/studio/image-pipeline/plan/preview', body as AnyRecord)
}

/** 提交出图任务（受守卫；默认 DRY_RUN 返回占位）。 */
export function submitImagePlan(body: {
  project_id: string
  asset_type: 'character' | 'scene' | 'prop'
  stage: 'character_sheet' | 'reference_batch'
  asset_ids?: string[]
  prompt_overrides?: { asset_id: string; prompt: string }[]
  use_primary_reference?: boolean
  aspect_ratio?: string
  image_model?: string
  negative_prompt?: string
  wait_seconds?: number
  /**
   * 尝试序号（重试失败项时 +1）。
   *
   * 后端幂等键 `source_task_id` 只哈希「项目 + 类型 + 资产 + 提示词前 8 位」，
   * 所以**同一资产同一提示词重试会被上游按既有（失败）任务去重，等于没重试**；
   * 传 1/2/3… 才会拿到**新的**幂等键、真的重新出图。
   * 同一个序号重复提交仍是同一个键（上游去重，不会重复下单），页面侧的在途闸门继续拦住连点。
   * 本次实际使用的键回显在每条结果的 `source_task_id` 上。
   */
  attempt?: number
}): Promise<{
  project_id: string
  results: ImageTaskResult[]
  summary: AnyRecord
  warnings: string[]
  guard_status: string
}> {
  return callApi('/api/v1/studio/image-pipeline/submit', body as AnyRecord)
}

/** 查询出图任务（回读 OSS 地址）。 */
export function queryImageTask(serviceTaskId: string): Promise<AnyRecord> {
  return callApi(`/api/v1/studio/image-pipeline/task/${encodeURIComponent(serviceTaskId)}`)
}

/** 直提出视频的计划预览（不建任务）。 */
export interface VideoPlanFrame {
  role: string
  frame_type: string
  file_id: string
  url: string
  /** **供应商口径**是否可用：本地地址只能变 data URL，对只收 http(s):// / asset:// 的供应商是 false */
  usable: boolean
  /** 引用形态：public / local_data_url / missing / not_found / unreadable */
  ref_kind?: string
  /** 不可用时的具体原因（可直接展示） */
  reason?: string
}

/**
 * 参考音频审计（计划/预览响应里的 `audio` 字段）。
 *
 * 回答的是"**参考音频**（作为输入）会不会进本次供应商请求"，与"**最终成片的音轨**"
 * （供应商侧 `generate_audio` 生成的那条轨）是两件事 —— 后者不在这里表达。
 */
export interface VideoAudioAudit {
  /** 本次请求是否真的会携带（会进 audio_urls） */
  included: boolean
  /** 绑定的音频 file_id（未绑定为空） */
  file_id?: string
  /** 会进请求的地址（公网 http(s) / asset:// / 供应商接受的 data URL）；不携带时为空 */
  url?: string
  /** 解析出的原始地址（可能是本机/内网，仅供技术详情，不会发给供应商） */
  declared_url?: string
  /** 不携带时的原因（本机相对路径 / 内网地址 / 供应商不吃 data URL / 未绑定…） */
  excluded_reason?: string
  reason_code?: string
  how_to_fix?: string
  /** public_url / asset_ref / data_url_inline / not_bound / opt_out / local_path / private_address … */
  state?: string
  vendor_supports_reference_audio?: boolean
  /** 术语澄清：参考音频（输入）≠ 最终成片音轨（输出） */
  note?: string
}

export interface VideoSubmitPlanResult {
  shot_id: string
  provider?: string
  model_name?: string
  resolution?: string
  reference_mode?: string
  reference_image_count?: number
  required_frame_types?: string[]
  frames?: VideoPlanFrame[]
  missing_frame_types?: string[]
  /** 有 file_id 但供应商取不到的帧（与 missing 一样阻止生成） */
  unusable_frame_types?: string[]
  generation_blocked?: boolean
  blocked_reason?: string
  audio_file_id?: string
  audio_url?: string
  audio_opt_out?: boolean
  audio_state?: string
  /** 参考音频审计（只增字段）：included / file_id / url / excluded_reason */
  audio?: VideoAudioAudit
  prompt?: string
  prompt_source?: string
  ratio?: string
  seconds?: number | null
  warnings?: string[]
  guard_status?: string
}

export function previewVideoSubmitPlan(body: {
  shot_id: string
  reference_mode?: string
  prompt?: string
  images?: string[]
  ratio?: string
  duration_seconds?: number | null
}): Promise<AnyRecord> {
  return callApi('/api/v1/studio/image-pipeline/video-plan/preview', body as AnyRecord)
}

/**
 * 采纳生成的图片到资产图片槽位（断点③：落库，刷新后仍在）。
 *
 * 出图提交本身不写库（后端设计如此），所以必须由用户显式采纳才落正式产物。
 * DRY_RUN 的占位地址会被后端拒绝（422）。
 */
export function adoptGeneratedImage(body: {
  entity_type: string
  entity_id: string
  url: string
  image_id?: number | null
  set_primary?: boolean
  /** 该资产已有定版图时会顶掉它 → 必须由用户在确认框里确认后传 true（否则后端 409） */
  confirm_replace_primary?: boolean
  name?: string
}): Promise<AnyRecord> {
  return callApi('/api/v1/studio/image-pipeline/adopt', body as AnyRecord)
}

/** 提示词包导出（图片 + 视频 + 绑定 + 参考图，只读）。 */
export function exportPromptPackage(body: {
  project_id: string
  shot_ids?: string[]
  max_shots?: number
  include_image_prompts?: boolean
  include_video_prompts?: boolean
  include_bindings?: boolean
  format?: 'json' | 'text' | 'markdown'
}): Promise<AnyRecord> {
  return callApi('/api/v1/studio/image-pipeline/prompt-package', body as AnyRecord)
}

/** 守卫状态（页面顶部用来显示「当前是否真实付费调用」）。 */
export function getOrchestrationStatus(): Promise<AnyRecord> {
  return callApi('/api/v1/studio/llm/orchestration/status')
}

/* ------------------------------------------- 章节提取候选（第 2 步产物，只读） */

export interface ChapterAssetCandidateItem {
  candidate_type: string
  type_label: string
  name: string
  aliases: string[]
  shot_count: number
  shot_ids: string[]
  statuses: Record<string, number>
  linked_entity_id: string | null
  existing_asset_id: string | null
  linked_to_project: boolean
  linked_to_shot: boolean
  recommendation: 'link_existing' | 'create_new' | string
}

export interface ChapterAssetCandidates {
  chapter_id: string
  project_id: string
  chapter_title: string
  shot_total: number
  shot_with_candidates: number
  summary: {
    total_candidates?: number
    merged_groups?: number
    by_type?: Record<string, number>
    by_status?: Record<string, number>
    link_existing_count?: number
    create_new_count?: number
  }
  items: ChapterAssetCandidateItem[]
  notes: string[]
}

/* ------------------------------------------------- 剧本文档解析（TXT / MD / DOCX） */

export interface ParsedDocument {
  filename: string
  format: string
  text: string
  char_count: number
  paragraph_count: number
  warnings: string[]
}

/**
 * 解析剧本文档为纯文本。
 *
 * 后端只解析、不落盘、不写库、不上传对象存储（`POST /studio/documents/parse`），
 * 因此演练模式下也能用，且不会产生任何费用。
 * 旧版 `.doc` 会被后端明确拒绝 —— 主区给**产品自己写的结论**（含「另存为 DOCX」这个
 * 可行动作），后端原文只进技术字段（审计 §4.7-581：改前这里连**整个响应体**都当兜底，
 * 且不加任何中文前缀，是最裸的一处）。
 */
export async function parseScriptDocument(file: File): Promise<ParsedDocument> {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${OpenAPI.BASE}/api/v1/studio/documents/parse`, {
    method: 'POST',
    body: form,
  })
  const text = await response.text()
  let payload: AnyRecord | undefined
  try {
    payload = text ? (JSON.parse(text) as AnyRecord) : undefined
  } catch {
    payload = undefined
  }
  if (!response.ok) {
    const meta = (payload?.meta ?? {}) as AnyRecord
    throwRequestFailure('剧本文件解析失败，请确认格式（旧版 .doc 请先另存为 DOCX）后重试', response.status, text, payload,
      (meta.diagnostics as Record<string, unknown> | undefined) ?? undefined)
  }
  return (payload?.data ?? null) as ParsedDocument
}

/** 章节提取候选聚合（只读：不建资产、不写库）。 */
export function fetchChapterAssetCandidates(chapterId: string): Promise<ChapterAssetCandidates> {
  return callApi(`/api/v1/studio/chapters/${encodeURIComponent(chapterId)}/asset-candidates`)
}

/* ------------------------------------------- 章节资产资料（按项目 + 章节持久化那份） */

/**
 * 一条章节资产资料行（`chapter_asset_profiles`）。
 *
 * 这是「资产资料」的**事实来源**：模型产出在 `fields`，人工修改在 `manual_overrides`，
 * 用户补充在 `user_notes`；三者刻意分开，重新分析不会覆盖人工内容。
 * 页面上的「补充/修改资产资料」写的就是 `manual_overrides` / `user_notes`。
 */
export interface ChapterAssetProfileRecord {
  id: number
  project_id: string
  chapter_id: string
  asset_type: string
  type_label: string
  name: string
  name_key: string
  group_key: string
  aliases: string[]
  /** 生效资料（模型资料 ⊕ 人工修改）—— 出图与「生成依据」读的就是它 */
  fields: Record<string, string>
  manual_overrides: Record<string, string>
  user_notes: string[]
  profile_source: string
  plot_identity: string
  temporary_notes: string[]
  shot_refs: Record<string, unknown>[]
  evidence: Record<string, unknown>[]
  asset_id: string | null
  status: string
  status_label: string
  source_hash: string
  source_summary: Record<string, unknown>
  missing_fields: string[]
  missing_visual_fields: string[]
  completeness: number
  generated_at: string | null
  confirmed_at: string | null
  manual_edited_at: string | null
  updated_at: string | null
  has_pending_change?: boolean
}

export interface ChapterAssetProfileRecords {
  chapter_id: string
  project_id: string
  items: ChapterAssetProfileRecord[]
  run: Record<string, unknown> | null
  content_changed: boolean
  summary: Record<string, number | Record<string, number>>
  note: string
}

/** 读本章的资产资料行（只读：不调模型、不写库）。 */
export function fetchChapterAssetProfileRecords(chapterId: string): Promise<ChapterAssetProfileRecords> {
  return callApi(`/api/v1/studio/chapters/${encodeURIComponent(chapterId)}/asset-profiles/records`)
}

/**
 * 保存「补充 / 修改资产资料」（写 `manual_overrides` / `user_notes`）。
 *
 * 只写人工内容：模型侧资料一个字不动，重新分析也不会覆盖它；
 * 本接口**不生成提示词、不生成图片、不覆盖已有提示词**。
 */
export function updateChapterAssetProfileRecord(
  chapterId: string,
  recordId: number,
  body: { fields?: Record<string, string>; notes?: string[]; aliases?: string[] },
): Promise<ChapterAssetProfileRecord> {
  return callApiPatch(
    `/api/v1/studio/chapters/${encodeURIComponent(chapterId)}/asset-profiles/records/${recordId}`,
    body as AnyRecord,
  )
}

/* ------------------------------------------------- 九槽位定义（用于手工填写） */

export interface ImagePromptSlotSpec {
  category: string
  label: string
  entity_type: string | null
  view_hint: string
  subject_source: string
}

let slotSpecsCache: ImagePromptSlotSpec[] | null = null

/**
 * 九槽位图片提示词的确定性定义（来自只读的编排层状态端点，**不触网、不花钱**）。
 *
 * 用途：DRY_RUN 下无法真实调用大模型，但用户仍需要一条把自己的提示词写进
 * `image_prompts` 的路；表单的槽位名必须由后端给，不能在前端硬编码。
 */
export async function fetchImagePromptSlots(): Promise<ImagePromptSlotSpec[]> {
  if (slotSpecsCache) return slotSpecsCache
  const data = await callApi<AnyRecord>('/api/v1/studio/llm/orchestration/status')
  const slots = (data?.image_prompt_slots ?? []) as ImagePromptSlotSpec[]
  slotSpecsCache = slots
  return slots
}

/* ------------------------------------------------- 既有端点的便捷封装 */

/**
 * 保存资产级图片提示词（写到 `<entities>` 表的 `image_prompts` JSON 列）。
 *
 * 该列是本次为「下一步直接读取保存结果」新增的；`PATCH /studio/entities/{type}/{id}`
 * 的后端请求体是宽松 dict，所以不需要重新生成客户端。
 */
export function saveAssetImagePrompts(
  entityType: 'character' | 'scene' | 'prop' | 'costume' | 'actor',
  entityId: string,
  imagePrompts: Record<string, string>,
  extra: AnyRecord = {},
): Promise<AnyRecord> {
  return callApiPatch(
    `/api/v1/studio/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`,
    { image_prompts: imagePrompts, ...extra },
  )
}

/** 读取资产级图片提示词（返回空对象表示还没生成过）。 */
export function getAssetImagePrompts(entity: AnyRecord | null | undefined): Record<string, string> {
  const raw = entity?.image_prompts
  if (!raw || typeof raw !== 'object') return {}
  return raw as Record<string, string>
}

/**
 * 设为定版主图（`is_primary`）。
 *
 * 后端会自动把同一资产下其余行清成 false，所以这里只需把目标行置 true。
 * 此前该字段只有 `character_images` 有列、且未在任何 schema 暴露，
 * 因此通过 HTTP 完全不可达——本次迁移后 5 类图片表都已支持。
 *
 * `confirmReplacePrimary`：后端**不静默替换定版** —— 该资产已有定版图
 * （`is_primary` 且已绑图）时，设版会返回结构化 409；只有用户在确认框里确认过，
 * 才把 `confirm_replace_primary=true` 发出去。默认 false（既有调用方行为不变）。
 */
export function setEntityImagePrimary(
  entityType: 'character' | 'scene' | 'prop' | 'costume' | 'actor',
  entityId: string,
  imageId: number,
  isPrimary = true,
  confirmReplacePrimary = false,
): Promise<AnyRecord> {
  const body: AnyRecord = { is_primary: isPrimary }
  if (confirmReplacePrimary) body.confirm_replace_primary = true
  return callApiPatch(
    `/api/v1/studio/entities/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}/images/${imageId}`,
    body,
  )
}

/** 保存视频提示词到镜头（写 `shot_details.video_prompt` + `video_prompt_source`）。 */
export function saveShotVideoPrompt(
  shotId: string,
  videoPrompt: string,
  source = 'llm',
): Promise<AnyRecord> {
  return callApiPatch(`/api/v1/studio/shot-details/${encodeURIComponent(shotId)}`, {
    video_prompt: videoPrompt,
    video_prompt_source: source,
  })
}

/* --------------------------------------------- 出口A 交付（只读，用于步骤 6 内联预览） */

export interface PromptDeliveryRow {
  shot_id: string
  chapter_id: string
  chapter_label: string
  shot_code: string
  shot_title: string
  video_prompt: string
  video_prompt_source: string
  exportable: boolean
  issue: string
  bound_assets: Record<string, string[]>
  bound_files: Array<Record<string, any>>
}

export interface PromptDeliveryPreview {
  project_id: string
  scope: string
  scope_label: string
  export_sources: string[]
  include_bindings: boolean
  export_source: string
  exportable_count: number
  skipped_count: number
  has_content: boolean
  rows: PromptDeliveryRow[]
  text: string
  note: string
}

/**
 * 交付清单与预览（**纯读**端点，不写库、不触网、不花钱）。
 *
 * 第 6 步「生成与交付」在工作台内联展示它，用户不必跳去「提示词导入/交付」菜单
 * 就能确认"已保存的提示词 + 已绑定的素材"真的进了交付内容。
 */
export function previewPromptDelivery(
  projectId: string,
  chapterId?: string | null,
  scope: 'current_shot' | 'episode' | 'episodes' = 'episode',
  /** 选中镜头范围：给了就只按这些镜头取清单（优先于 chapter_id）。 */
  shotIds?: string[],
): Promise<PromptDeliveryPreview> {
  const query = new URLSearchParams({ scope, include_bindings: 'true' })
  const selected = (shotIds ?? []).filter(Boolean)
  if (selected.length) query.set('shot_ids', selected.join(','))
  if (chapterId) query.set('chapter_id', chapterId)
  return callApi(`/api/v1/studio/prompt-delivery/${encodeURIComponent(projectId)}?${query.toString()}`)
}

/* ------------------------------------------- 直提落库（生成结果 → files → 镜头） */

export interface SubmitVideoResult {
  shot_id: string
  provider?: string
  status: string
  url?: string
  file_id?: string
  provider_task_id?: string
  elapsed_ms?: number
  error?: string
  warnings?: string[]
  guard_status?: string
}

/**
 * 直提出视频（**同进程内联执行**，不经过 Celery 队列）。
 *
 * 与 `/api/v1/film/tasks/video` 的区别：那条链路把任务丢给队列，本机没有 Redis / worker 时
 * 任务只会停在 pending（"点生成没反应"）。这条会真的等到结果。
 * DRY_RUN 下返回 `status: dry_run` 的占位结果，不花钱。
 */
export function submitVideo(body: {
  shot_id: string
  reference_mode: string
  prompt: string
  images?: string[]
  ratio: string
  duration_seconds?: number
  timeout_seconds?: number
}): Promise<SubmitVideoResult> {
  return callApi('/api/v1/studio/image-pipeline/video-submit', body as AnyRecord)
}

/**
 * 把生成结果落库并挂到镜头：登记素材 → 写 `shot.generated_video_file_id`。
 *
 * 直提端点本身不写库（结果只在响应里），不落库的话刷新就没了、交付也读不到。
 * 返回 file_id。
 */
export async function persistGeneratedVideo(shotId: string, url: string, name?: string): Promise<string> {
  const created = await callApi<AnyRecord>('/api/v1/studio/files/external', {
    url,
    name: name || `镜头视频（直提）`,
    type: 'video',
    shot_id: shotId,
    usage_kind: 'generated_video',
  })
  const fileId = String(created?.id ?? '').trim()
  /* 审计 §4.7-533：改前是 `视频已生成但登记素材失败（没有拿到 file_id）` —— 后端字段名
     `file_id` 直接上屏（模式 2）。主区改成产品口径的中文结论 + 可行动作。 */
  if (!fileId) throw new Error('视频已经生成，但没有登记成功；请重试，或打开「技术详情」查看记录')
  await callApiPatch(`/api/v1/studio/shots/${encodeURIComponent(shotId)}`, {
    generated_video_file_id: fileId,
  })
  return fileId
}

export { callApi, callApiPatch }

/* --------------------------------------- 关键帧出图（同进程内联，不走队列） */

export type FrameSubmitFrameType = 'first' | 'key' | 'last'

/** 一个可选的图片模型（关键帧走哪条出图通道）。 */
export interface ImageModelOption {
  id: string
  name: string
  provider_id: string
  description?: string
}

/**
 * 列出可用的**图片**模型。
 *
 * 关键帧用哪条通道出图，直接决定「参考图到底有没有被送出去」：
 * - `model-image2` → 出图服务垫片（本机 4321 → 4173），垫片自己写明 `/images/edits` 的参考图**无法透传**；
 * - `model-gpt-image-2` → APIMart 直连，参考图以 `image_urls`（公网地址）真的送出去。
 */
export async function fetchImageModels(): Promise<ImageModelOption[]> {
  const data = await callApi<AnyRecord>('/api/v1/llm/models?category=image&page=1&page_size=100')
  const items = Array.isArray(data?.items) ? data.items : []
  return items.map((item: AnyRecord) => ({
    id: String(item?.id ?? ''),
    name: String(item?.name ?? ''),
    provider_id: String(item?.provider_id ?? ''),
    description: String(item?.description ?? ''),
  }))
}

export interface FrameSubmitResult {
  shot_id: string
  frame_type: FrameSubmitFrameType
  status: string
  dry_run?: boolean
  task_id?: string
  provider?: string
  provider_task_id?: string
  image_url?: string
  file_id?: string
  image_slot_id?: number | null
  prompt?: string
  prompt_source?: string
  reference_file_ids?: string[]
  /** 供应商/适配层的如实说明，例如垫片回传「参考图未透传」。 */
  provider_notes?: string[]
  elapsed_ms?: number
  error?: string
  warnings?: string[]
  guard_status?: string
  note?: string
}

export interface FramePlanResult {
  shot_id: string
  frame_type: FrameSubmitFrameType
  prompt: string
  prompt_source: string
  reference_file_ids: string[]
  reference_count: number
  target_ratio: string
  target_ratio_source: string
  resolution_profile: string
  provider: string
  model_name: string
  image_slot_id: number | null
  warnings: string[]
  dry_run: boolean
}

/**
 * 关键帧出图计划预览：**只看**这一帧会用哪条提示词（来源）、带哪些参考图、什么画幅。
 *
 * 不触网、不建任务、不写库 —— 用来在花钱之前回答「我保存的提示词到底有没有被用上」。
 */
export function previewFramePlan(body: {
  shot_id: string
  frame_type: FrameSubmitFrameType
  prompt?: string
  images?: string[]
  target_ratio?: string
  resolution_profile?: 'standard' | 'high'
  model_id?: string | null
}): Promise<FramePlanResult> {
  return callApi('/api/v1/studio/image-pipeline/frame-plan/preview', body as AnyRecord)
}

/**
 * 关键帧出图（**同进程内联执行**）。
 *
 * 与 `/studio/image-tasks/shot/{id}/frame-image-tasks` 的区别：那条只建一条 Celery 任务行，
 * 本机没有 broker/worker 时永远停在「排队中」（用户看到的就是"点了生成没反应"）。
 * 这条会真的等到结果，并把图片写进 `shot_frame_images.file_id`（刷新后仍在）。
 * DRY_RUN 下返回 `status: dry_run` 的计划，不花钱、不写库。
 */
export function submitFrameImage(body: {
  shot_id: string
  frame_type: FrameSubmitFrameType
  prompt?: string
  images?: string[]
  target_ratio?: string
  resolution_profile?: 'standard' | 'high'
  model_id?: string | null
  timeout_seconds?: number
}): Promise<FrameSubmitResult> {
  return callApi('/api/v1/studio/image-pipeline/frame-submit', body as AnyRecord)
}

/* ------------------------------- 集级视频提示词看板（进入分镜工作台之前的主入口） */

export type PromptBoardOrigin = 'llm_draft' | 'jurilu_import' | 'external_import' | 'manual'
export type PromptBoardMode = 'fill_empty' | 'overwrite_selected'

export interface PromptBoardShot {
  shot_id: string
  index: number
  code: string
  title: string
  script_excerpt: string
  video_prompt: string
  video_prompt_source: string
  has_prompt: boolean
}

export interface PromptBoardRead {
  chapter_id: string
  shots: PromptBoardShot[]
  summary: { total: number; with_prompt: number; missing: number }
}

/** 集级看板：本集镜头 + 当前提示词与来源（只读）。 */
export function fetchPromptBoard(chapterId: string): Promise<PromptBoardRead> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}`)
}

export interface BoardReadinessRow {
  shot_id: string
  code: string
  index: number
  title: string
  has_prompt: boolean
  video_prompt: string
  video_prompt_source: string
  bound_image_total: number
  bound_image_usable: number
  bound_image_missing_names: string[]
  audio_file_id: string
  audio_opt_out: boolean
  required_frame_types: string[]
  usable_frame_types: string[]
  missing_frame_types: string[]
  /** 有 file_id 但供应商取不到的帧（例如本机地址只能变 data URL） */
  unusable_frame_types?: string[]
  /** 帧不可用/缺失的具体原因（可直接展示） */
  frame_block_reasons?: string[]
  /** 生成是否被参考帧阻断（缺帧 ∪ 帧不可用；text_only 恒为 false） */
  generation_blocked?: boolean
}

/** 集级就绪批量读取（只读、不触网）：顶部三态 / 定位 / 门禁共用这一份数据。 */
export function fetchBoardReadiness(
  chapterId: string,
  referenceMode = 'first',
): Promise<{ chapter_id: string; reference_mode: string; rows: BoardReadinessRow[]; summary: AnyRecord }> {
  return callApi(
    `/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/readiness?reference_mode=${encodeURIComponent(referenceMode)}`,
  )
}

export interface PromptDraftResult {
  shot_id: string
  code?: string
  /** busy = 该镜已有进行中的生成（服务端租约未过期），**未发起付费调用** */
  status: 'draft' | 'dry_run' | 'failed' | 'skipped' | 'error' | 'busy'
  prompt?: string
  draft_token?: string
  reason?: string
  latency_ms?: number
  warnings?: string[]
  /**
   * 草稿是否已落到**服务端**（`shot_video_prompt_drafts`）。
   * 只有 `status="draft"`（真实生成成功）才会是 true —— 演练 / 失败 / 跳过都没有正文可存。
   */
  persisted?: boolean
  /** 生成结束时该镜的服务端草稿状态（与 GET /drafts 的单项同形状） */
  draft?: PromptBoardDraft | null
  claim_expires_at?: string | null
}

/**
 * 单镜生成草稿（真 LLM，只在草稿表落库、**不写正式提示词列**）。
 *
 * `claim_token` 是页面先调 `/drafts/claim` 占到的租约令牌：带上它服务端认出是自己的租约
 * 并直接续租，避免"页面刚占位又被服务端自己判成 busy"。
 */
export function draftVideoPrompt(
  chapterId: string,
  body: { shot_id: string; mode?: PromptBoardMode; claim_token?: string },
): Promise<PromptDraftResult> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/draft`, body as AnyRecord)
}

/* ------------------ 服务端草稿（刷新/中断不丢；绝不写正式提示词列） ------------------ */

/** 逐镜草稿状态：`pending`（未开始，服务端不落行）/ `running` / `ok` / `failed`。 */
export type PromptBoardDraftStatus = 'pending' | 'running' | 'ok' | 'failed'

export interface PromptBoardDraft {
  shot_id: string
  code: string
  index: number
  title: string
  /** 读层状态：没有草稿行=pending；running 但租约失效=pending 且 interrupted=true */
  status: PromptBoardDraftStatus
  /** 库里存的原始状态（pending 时为空串 = 服务端没有这一行） */
  stored_status: string
  /** 上次生成被中断（进程被杀 / 页面关掉），租约已过期 → 可重试 */
  interrupted: boolean
  has_draft: boolean
  prompt: string
  source: string
  error: string
  model: string
  meta: AnyRecord
  /** 服务端签发的大模型草稿令牌；**只有服务端真实生成的正文才有** */
  draft_token: string
  /** 能否按 `llm_draft` 保存（= 有没有令牌） */
  saveable: boolean
  claim_expires_at: string | null
  updated_at: string | null
}

export interface PromptBoardDraftState {
  chapter_id: string
  shots: PromptBoardDraft[]
  summary: { total: number; ok?: number; failed?: number; running?: number; pending?: number }
  note?: string
}

/** 逐镜草稿状态（只读、不触网）：刷新/重新进页面时用它恢复队列。 */
export function fetchPromptBoardDrafts(chapterId: string): Promise<PromptBoardDraftState> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/drafts`)
}

export interface PromptBoardDraftSaveResult {
  chapter_id: string
  created: boolean
  draft: PromptBoardDraft | null
  error?: string
  note?: string
}

/**
 * 保存**一镜**草稿（幂等 upsert；只碰草稿表，**不写正式列**）。
 *
 * `status="failed"` 且不带 `prompt` 时**保留**原有正文 —— 重试失败不会抹掉上一版真金白银的结果。
 */
export function saveShotDraft(
  chapterId: string,
  body: {
    shot_id: string
    status: 'ok' | 'failed'
    prompt?: string
    error?: string
    source?: string
    model?: string
    meta?: AnyRecord
    claim_token?: string
  },
): Promise<PromptBoardDraftSaveResult> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/drafts`, body as AnyRecord)
}

export interface PromptBoardDraftDeleteResult {
  chapter_id: string
  cleared: number
  shot_ids: string[]
}

/** 清草稿（`shot_ids` 为空 = 清整集）。正式列一个字节都不动。 */
export function deleteShotDrafts(chapterId: string, shotIds: string[] = []): Promise<PromptBoardDraftDeleteResult> {
  const ids = shotIds.filter(Boolean)
  const query = ids.length ? `?shot_ids=${encodeURIComponent(ids.join(','))}` : ''
  return callApiDelete(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/drafts${query}`)
}

export interface PromptBoardClaimResult {
  chapter_id: string
  shot_id: string
  code: string
  /** false = 该镜正在生成中（或刚被别人抢到）→ 页面**不要**发起付费调用 */
  claimed: boolean
  claim_token: string
  lease_seconds?: number
  claim_expires_at?: string | null
  reason: string
  blocking_status?: string
  draft?: PromptBoardDraft | null
}

/** 抢占一镜「生成中」租约（服务端闸门：同一镜在租约内只能有一次生成）。 */
export function claimShotDraft(
  chapterId: string,
  body: { shot_id: string; lease_seconds?: number; claim_token?: string },
): Promise<PromptBoardClaimResult> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/drafts/claim`, body as AnyRecord)
}

export interface PromptBoardReleaseResult {
  chapter_id: string
  shot_id: string
  code: string
  released: boolean
  reason: string
  draft?: PromptBoardDraft | null
}

/**
 * 释放租约（不生成这一镜时用）。
 *
 * `error` 留空 = 只放锁、**不动正文也不改状态**：请求被中断时不该把已生成的草稿误标成失败。
 */
export function releaseShotDraft(
  chapterId: string,
  body: { shot_id: string; claim_token?: string; error?: string },
): Promise<PromptBoardReleaseResult> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/drafts/release`, body as AnyRecord)
}

export interface PromptImportEntry {
  number: number | null
  prompt: string
  shot_id: string
  matched_by: string
  status: string
  message: string
}

export interface PromptImportPreview {
  entries: PromptImportEntry[]
  issues: string[]
  save_allowed: boolean
  count_mismatch: boolean
  matched_only_save_allowed: boolean
  shots: PromptBoardShot[]
  summary: { total: number; ok: number; unmatched: number }
}

/** 批量导入解析 + 匹配（**不落库**）：粘贴文本与上传文件都走这里。 */
export function parsePromptImport(chapterId: string, text: string): Promise<PromptImportPreview> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/import-parse`, { text } as AnyRecord)
}

export interface PromptBoardSaveResult {
  applied_count: number
  skipped_count: number
  results: Array<{ shot_id: string; code?: string; applied: boolean; reason: string }>
  error?: string
  source?: string
  /** 保存成功后服务端**自动清掉的草稿数**（草稿使命已完成，留着会让页面显示"还有未保存草稿"） */
  cleared_draft_count?: number
}

/**
 * 确认后批量保存。**来源由流程决定**：调用方只能给出 origin（哪种流程来的），
 * 服务端映射成真实 source；`llm_draft` 的条目必须带后端签发的 draft_token。
 */
export function savePromptBoard(
  chapterId: string,
  body: {
    entries: Array<{ shot_id: string; prompt: string; draft_token?: string; script_id?: string }>
    mode: PromptBoardMode
    origin: PromptBoardOrigin
    selected_shot_ids?: string[]
    allow_partial?: boolean
    /**
     * 巨日禄路径带上**当前选中的那一个**脚本组（**单数**）。
     *
     * 口径（2026-09-20 修正）：页面保存走的是本端点 `/prompt-board/{chapter_id}/save`，
     * 后端在这里**正式**校验脚本组范围 ——
     * - `origin=jurilu_import` 时缺 `script_id` / 格式不合法（像多个）/ 与条目不一致 → 400；
     * - 用复数 `script_ids` 传参会被**明确拒绝**（400 `script_ids_deprecated`），
     *   不是静默忽略 —— 静默忽略会让人误以为"后端已经按恰好一组校验过了"；
     * - 其它来源（`manual` / `external_import` / `llm_draft`）不传即可，照常保存。
     *
     * 表单构造统一走 `buildPromptBoardSaveBody`（纯函数 + 单测），不要在页面里手拼请求体。
     */
    script_id?: string
  },
): Promise<PromptBoardSaveResult> {
  return callApi(`/api/v1/studio/prompt-board/${encodeURIComponent(chapterId)}/save`, body as AnyRecord)
}

/**
 * 下载「出口 A」的 TXT（**真实文件下载**，不走 window.open）。
 *
 * 为什么不用 window.open：
 * 1. 前端 dev server 没有 `/api` 代理，相对地址会被 SPA fallback 接住 → 打开一个 404 页面，
 *    却让人以为"导出成功"；
 * 2. 失败时无法感知：404/500 也会被当成一次成功跳转。
 * 这里用 fetch + Blob + `<a download>`：地址强制指向 `OpenAPI.BASE`（真实后端），
 * 非 2xx 直接抛错由页面提示，成功则触发浏览器的 download 事件并带上后端文件名。
 */
export async function downloadDeliveryTxt(
  projectId: string,
  chapterId: string | null | undefined,
  shotIds: string[],
): Promise<{ url: string; filename: string; bytes: number }> {
  const params = new URLSearchParams()
  const selected = shotIds.filter(Boolean)
  if (selected.length) {
    params.set('scope', 'episode')
    params.set('shot_ids', selected.join(','))
  } else {
    params.set('scope', chapterId ? 'episode' : 'episodes')
  }
  if (chapterId) params.set('chapter_id', chapterId)
  params.set('include_bindings', 'true')
  const base = String(OpenAPI.BASE ?? '').replace(/\/+$/, '')
  const url = `${base}/api/v1/studio/prompt-delivery/${encodeURIComponent(projectId)}/export?${params.toString()}`

  const response = await fetch(url)
  if (!response.ok) {
    /* 审计 §4.7-534：改前 `导出失败：HTTP ${status}（${text.slice(0, 120)}）` ——
       响应体前 120 字里可能含地址 / 字段名（模式 4）。主区只给中文结论，
       状态码与响应体收进技术字段（`technical`）。 */
    const text = await response.text().catch(() => '')
    throwRequestFailure('导出失败，请稍后重试', response.status, text, undefined)
  }
  const blob = await response.blob()
  if (!blob.size) throw new Error('导出失败：服务端返回了空文件，请稍后重试')

  const disposition = response.headers.get('content-disposition') || ''
  const matched = /filename="?([^";]+)"?/i.exec(disposition)
  const filename = matched?.[1] || `${projectId}-prompt.txt`

  const objectUrl = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = objectUrl
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000)
  return { url, filename, bytes: blob.size }
}

export interface JuriluPreviewRow {
  action: string
  order: number
  label: string
  summary: string
  prompt: string
  source: string
  reason?: string
  shot_id?: string
  index?: number
  title?: string
}

/**
 * 巨日禄「脚本组」里的**样例记录**（后端取前几条，给用户核对 msgpack 解析是否正确）。
 * 字段一律可缺：缺了页面就说「未提供」，前端不补默认值。
 */
export interface JuriluScriptSampleRecord {
  seq?: string
  sbid?: string
  /** 提示词正文前 60 字 */
  prompt_head?: string
  /** 提示词正文字数 */
  prompt_length?: number
  /** 摘要前 40 字 */
  summary_head?: string
}

/**
 * 巨日禄「脚本组」= 一个 scriptId 的全部分镜。
 *
 * 背景（2026-09-20 真实验收）：一次「获取整集提示词」第一步会拿到**三个 scriptId**，
 * 第二步共返回 109 条分镜（41 / 37 / 31）。用户明确要求：
 * 分成三个可选择的脚本组、**默认不跨 scriptId 合并**、**用户选一组后**才匹配镜头；
 * 若三个其实是同一脚本的不同版本，标出最新版本并说明依据，但**仍由用户确认**。
 */
export interface JuriluScriptGroup {
  script_id: string
  title: string
  title_source: string
  created_at: string
  updated_at: string
  record_count: number
  seq_min: string
  seq_max: string
  seq_field: string
  sample_records: JuriluScriptSampleRecord[]
  raw_keys: string[]
  likely_newest: boolean
  version_reasons: string[]
  version_hint: string
}

export interface JuriluPreviewResult {
  chapter_id: string
  chapter_shot_count: number
  entry_count: number
  plan_summary: string
  counts: Record<string, number>
  rows: JuriluPreviewRow[]
  diagnostics?: AnyRecord
  warnings?: string[]
  source_url?: string
  /** 抓到的脚本组（`script_ids` 为空时只返回它、`rows` 为空） */
  script_groups?: JuriluScriptGroup[]
  /** 后端回显这次实际用的脚本组 */
  selected_script_ids?: string[]
  /** true = 必须由用户先选组（未选组时后端不做匹配） */
  requires_script_selection?: boolean
  /** 后端的说明文案（例如「默认不跨 scriptId 合并：请先选择一个脚本组」） */
  note?: string
}

/**
 * 巨日禄 Cookie 导入**预览**（抓取 + 配对，**不写库**）。
 * Cookie 只用于本次抓取：不保存、不回显、不写日志（后端已保证）。
 */
/**
 * 从巨日禄抓取失败里提取**脱敏诊断**（阶段 / HTTP 状态 / 是否带 Cookie /
 * 是否额外带 Authorization / 授权模式）。
 *
 * 具体判定已抽到纯函数模块 `./juriluDiagnostics`（可单测）：它按诊断里的真实证据判阶段，
 * 不会像以前那样一律报成 `getScriptPage`。**绝不回显 Cookie / Authorization 内容。**
 */
export function extractJuriluDiagnostics(error: unknown): string {
  return extractJuriluDiagnosticsFromModule(error)
}

export type { StoryboardAttemptShape }

/** 巨日禄导入预览（抓取 + 配对，不写库）。 */
export function previewJuriluImport(
  projectId: string,
  body: {
    chapter_id: string
    url: string
    cookie?: string
    authorization?: string
    auth_mode?: string
    referer?: string
    api_url_override?: string
    create_missing?: boolean
    overwrite?: boolean
    /**
     * 用户选中的脚本组（**空数组 = 还没选组**）。
     * 空数组时后端**只返回 script_groups**、`rows` 为空、`requires_script_selection=true`；
     * 只带一个 id 时**只把那一组**的分镜送去匹配 —— 默认不跨 scriptId 合并。
     */
    script_ids?: string[]
  },
): Promise<JuriluPreviewResult> {
  return callApi(`/api/v1/studio/jurilu-import/${encodeURIComponent(projectId)}/preview`, body as AnyRecord)
}
