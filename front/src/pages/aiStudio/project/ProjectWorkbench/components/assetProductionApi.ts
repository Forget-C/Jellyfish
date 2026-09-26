/**
 * 资产生产区用到的接口封装（**全部是既有端点，没有新增后端**）。
 *
 * 为什么单独一个模块、而不直接用 `services/llmPipelineApi.ts`：
 * 本轮的改动范围不允许动那个共享模块，而它的 `ImageTaskResult` 缺少生产区需要的字段
 * （长期地址 `oss_url`、归一化口径 `outcome`、失败原文 `error_message`）。
 * 这里用**同一个** `callApi`（同一套统一信封解析）补出完整类型，不另写一套请求逻辑。
 *
 * 用到的端点（全部只读或幂等，且都是同进程内联执行，**不进任何队列**）：
 *   - POST /api/v1/studio/image-pipeline/plan/preview   出图计划预览（不触网、不花钱）
 *   - POST /api/v1/studio/image-pipeline/submit         批量提交出图（同步内联；演练模式返回占位）
 *   - GET  /api/v1/studio/image-pipeline/task/{id}      查询任务（回读产物地址）
 *   - POST /api/v1/studio/image-pipeline/adopt          采纳结果到资产图片槽位
 *   - POST /api/v1/studio/files/external                登记外部公网素材（不下载、不存副本）
 *   - POST /api/v1/studio/entities/{type}/{id}/images   新增一张图片槽位（不覆盖现有图片）
 *   - POST /api/v1/studio/llm/image-prompt/preview      大模型生成/完善图片提示词（演练模式返回占位）
 *   - POST /api/v1/studio/image-pipeline/reference-regenerate
 *                                                     **可选返工流程**：使用已有参考图重新生成
 *                                                     （走 Jellyfish 自己的 APIMart 图片通道，
 *                                                     参考图会真的进请求；不是默认主流程）
 */

import { callApi, previewImagePrompts, type ImagePromptSlot } from '../../../../../services/llmPipelineApi'
import { StudioEntitiesApi } from '../../../../../services/studioEntities'
import { OpenAPI } from '../../../../../services/generated'
import { REFERENCE_REWORK_UNAVAILABLE_HINT } from './assetProduction'
import {
  ASSET_PROMPT_BATCH_SAVE_UNAVAILABLE,
  PROMPT_REQUEST_SUPPORT_NONE,
  buildEntityProfileEntry,
  buildPromptRequestExtras,
  matchesRequestedAsset,
  readAssetPromptBatchSaveSupport,
  readPromptRequestFieldSupport,
  type AssetPromptBatchSaveBody,
  type AssetPromptBatchSaveSupport,
  type PromptRequestFieldSupport,
} from './assetPromptRequestContract.ts'
import { buildAssetPromptRequestScope } from './assetPromptRequestScope.ts'

export type AssetImageServiceResult = {
  source_task_id?: string
  source_asset_id?: string
  asset_type?: string
  stage?: string
  service_task_id?: string
  /** 上游原文状态（只进「技术详情」） */
  status?: string
  /** 归一化口径（只进「技术详情」） */
  outcome?: string
  ok?: boolean
  dry_run?: boolean
  image_url?: string
  oss_url?: string
  oss_ready?: boolean
  message?: string
  error_message?: string
  http_status?: number | null
  /**
   * 结果类型标签（新，后端按 `asset_type` 分流返回）：
   * `characterReference`（**仅人物**）/ `sceneAssetImage` / `propAssetImage` / `costumeDesignImage`。
   * 页面用它给结果卡片打「图片类型」标签。
   */
  result_kind?: string
  /** 结果类型的中文标签（新）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图 */
  result_label?: string
  /** 本次结果的画幅（新）：人物参考图固定 16:9（**不是**项目最终视频画幅） */
  aspect_ratio?: string
  /** 画幅来源（新）：character_reference_fixed / request / default */
  aspect_ratio_source?: string
  /** 本次提示词的质量判定（新字段，契约以后端实现为准）：`usable: false` + 中文原因时页面拦截 */
  quality?: unknown
  /** 同上（后端也可能用 `prompt_quality`） */
  prompt_quality?: unknown
  /** 后端给的质量告警原文 */
  prompt_warnings?: string[]
  /** 本次生成依据（新字段）：默认收起的「生成依据」面板读它 */
  generation_basis?: unknown
  /** 同上（容器名可能是 `basis`） */
  basis?: unknown
  detail?: Record<string, unknown>
}

export type AssetImageSubmitResponse = {
  project_id: string
  asset_type: string
  stage: string
  results: AssetImageServiceResult[]
  summary: Record<string, unknown>
  outcome: string
  warnings: string[]
  guard_status: string
}

export type AssetImageTaskQuery = {
  service_task_id: string
  status: string
  oss_url: string
  local_path: string
  images: Record<string, unknown>[]
  error_message: string
  dry_run?: boolean
}

export type AdoptAssetImageResponse = {
  entity_type: string
  entity_id: string
  image_id: number
  file_id: string
  /** 落库后的可访问地址（资产页与实际出图使用的就是它） */
  url: string
  source_url: string
  is_primary: boolean
  name: string
  url_reachable: boolean | null
  url_probe: Record<string, unknown>
  warnings: string[]
}

export type ExternalFileResponse = {
  id: string
  type?: string
  name?: string
  thumbnail?: string
}

export type AssetImagePlanTargetLike = {
  source_task_id: string
  source_asset_id: string
  asset_type: string
  name: string
  prompt: string
  stage: string
  reference_image: string
  aspect_ratio: string
  prompt_source?: string
  warnings?: string[]
  /**
   * 本次会用的提示词的质量判定（新字段，契约以后端实现为准）。
   *
   * 计划是只读的，但它给的正是"这次会送出去的那条提示词"，
   * 所以页面可以直接据此在出图前拦住不可用的提示词（后端还会再兜一层）。
   */
  quality?: unknown
  /** 同上（后端也可能用 `prompt_quality` 这个名字） */
  prompt_quality?: unknown
  /** 后端给的质量告警原文（作为"真实原因"展示） */
  prompt_warnings?: string[]
  /** 本次生成依据（新字段）：默认收起的「生成依据」面板读它 */
  generation_basis?: unknown
  /** 同上（容器名可能是 `basis`） */
  basis?: unknown
}

export type AssetImagePlanPreview = {
  project_id: string
  asset_type: string
  stage: string
  targets: AssetImagePlanTargetLike[]
  references: Record<string, unknown>[]
  warnings: string[]
  summary: Record<string, unknown>
  /**
   * 本次按类型分流的出图口径（新）：`result_kind` / `result_label` / `aspect_ratio` /
   * `aspect_ratio_fixed` / `aspect_ratio_note` / `prompt_template` / `batch_reference_allowed`。
   * 只读计划，不触网；页面据它显示「本次会生成什么类型的图」与人物固定画幅说明。
   */
  strategy?: Record<string, unknown>
  dry_run: boolean
}

export type SubmitAssetImagesBody = {
  project_id: string
  asset_type: 'character' | 'scene' | 'prop'
  asset_ids: string[]
  prompt_overrides?: { asset_id: string; prompt: string }[]
  aspect_ratio: string
  wait_seconds?: number
  /**
   * 尝试序号（0 = 首轮）。
   *
   * 后端会把 `attempt` 混进幂等键：同一提示词原样重试会被出图服务按既有（失败）任务去重
   * ＝等于没重试；`attempt + 1` 才会拿到**新的**键、真的重新出图。
   * 同一个序号重复提交仍是同一个键（上游去重，页面侧的在途闸门继续拦住连点）。
   */
  attempt?: number
}

/**
 * 提交一轮出图（**一个资产一次调用**）。
 *
 * 为什么按资产逐个调用而不是一次提交一批：提交是同步内联执行的，
 * 一批提交时页面只能等到最后才有结果，也无法在资产之间"停止后续"，
 * 更没法给出「生成中 / 排队中 / 失败」的逐项进度。逐项提交让进度与停止都是真的。
 */
/**
 * **默认主流程**：按提示词直接生成参考图（提交给出图服务端点）。
 *
 * `stage` 与 `use_primary_reference` 在这里写死：默认流程不把已有图片当输入传出去
 * （上游真实模型就是"按提示词直接生成参考图"，见 `assetProduction.SUBMIT_STAGE` 注释）。
 * 需要保一致性时走**另一条**流程 `regenerateWithExistingReference`，两者代码名分开。
 */
export function submitAssetImages(body: SubmitAssetImagesBody): Promise<AssetImageSubmitResponse> {
  return callApi('/api/v1/studio/image-pipeline/submit', {
    ...body,
    stage: 'character_sheet',
    use_primary_reference: false,
  } as unknown as Record<string, unknown>)
}

/** 出图计划预览（只读：不触网、不建任务、不写库；默认主流程口径）。 */
export function previewAssetImagePlan(body: {
  project_id: string
  asset_type: 'character' | 'scene' | 'prop'
  asset_ids?: string[]
  aspect_ratio?: string
  /**
   * 章节 ID（可选）：给了后端就按**该章**装配 `generation_basis`（本章资产资料 / 剧本片段 /
   * 出场分镜），页面「生成依据」在**还没生成**时也能看到真实资料；留空则不下发该字段。
   */
  chapter_id?: string
}): Promise<AssetImagePlanPreview> {
  return callApi('/api/v1/studio/image-pipeline/plan/preview', {
    ...body,
    stage: 'character_sheet',
    use_primary_reference: false,
  } as unknown as Record<string, unknown>)
}

/** 查询出图任务（回读产物地址）。 */
export function queryAssetImageTask(serviceTaskId: string): Promise<AssetImageTaskQuery> {
  return callApi(`/api/v1/studio/image-pipeline/task/${encodeURIComponent(serviceTaskId)}`)
}

/** 采纳结果到资产图片槽位（`set_primary` 由调用方显式决定，默认不动定版）。 */
export function adoptAssetImageResult(body: {
  entity_type: 'character' | 'scene' | 'prop' | 'costume'
  entity_id: string
  url: string
  image_id?: number | null
  set_primary?: boolean
  /** 会顶掉该资产已有定版图时，必须由用户确认后传 true（否则后端结构化 409） */
  confirm_replace_primary?: boolean
  name?: string
}): Promise<AdoptAssetImageResponse> {
  return callApi('/api/v1/studio/image-pipeline/adopt', body as unknown as Record<string, unknown>)
}

/** 登记外部公网素材（不下载、不在本地存副本；地址就是资产长期地址）。 */
export function registerExternalImageFile(body: {
  url: string
  name?: string
  project_id?: string | null
  usage_kind?: string
}): Promise<ExternalFileResponse> {
  return callApi('/api/v1/studio/files/external', {
    ...body,
    type: 'image',
  } as unknown as Record<string, unknown>)
}

/**
 * 找一个**空**的图片槽位（`file_id` 为空的行）。
 *
 * 用途：该资产已经有图片时，采纳必须落到空槽位上 —— 采纳端点在不指定槽位时
 * 会复用第一行，那会把现有图片（很可能就是定版图）悄悄换掉。
 */
export async function findEmptyImageSlot(
  entityType: 'character' | 'scene' | 'prop' | 'costume',
  entityId: string,
): Promise<number | null> {
  try {
    const res = await StudioEntitiesApi.listImages(entityType, entityId, { pageSize: 100 })
    const rows = (res.data?.items ?? []) as { id?: number; file_id?: string | null }[]
    const empty = rows.find((row) => typeof row.id === 'number' && !String(row.file_id ?? '').trim())
    return empty && typeof empty.id === 'number' ? empty.id : null
  } catch {
    // 读不到就不冒风险：返回 null，调用方会走"新增一张"的分支（同样不会覆盖）
    return null
  }
}

/** 新增一张图片槽位（不会覆盖现有图片）。 */
export async function createImageSlot(
  entityType: 'character' | 'scene' | 'prop' | 'costume',
  entityId: string,
  fileId: string,
): Promise<{ id: number; file_id: string | null }> {
  const res = await StudioEntitiesApi.createImage(entityType, entityId, {
    file_id: fileId,
    is_primary: false,
  })
  const row = (res.data ?? {}) as { id?: number; file_id?: string | null }
  if (typeof row.id !== 'number') {
    throw new Error('新增图片失败：服务没有返回图片编号')
  }
  return { id: row.id, file_id: row.file_id ?? null }
}

/* ------------------------- 可选返工流程：使用已有参考图重新生成 ------------------------- */

/** 该流程的端点路径（可用性探测与调用共用一处，避免两处不一致）。 */
export const REFERENCE_REGENERATE_PATH = '/api/v1/studio/image-pipeline/reference-regenerate'

export type ReferenceRegenerateBody = {
  project_id: string
  asset_type: 'character' | 'scene' | 'prop' | 'costume'
  asset_id: string
  /** 留空则用该资产已保存的图片提示词 */
  prompt?: string
  /** 已有参考图的槽位 id（与 reference_url 二选一；都不传 = 用该资产的定版/首选图） */
  reference_image_id?: number | null
  reference_url?: string
  target_ratio?: string
  resolution_profile?: 'standard' | 'high'
  attempt?: number
  timeout_seconds?: number
}

export type ReferenceRegenerateResponse = {
  project_id: string
  asset_type: string
  asset_id: string
  asset_name: string
  prompt: string
  prompt_source: string
  reference_image_id?: number | null
  /** 真正送进请求的参考图地址（只进「技术详情」） */
  reference_url: string
  /** 参考图的可读名（页面文案用这个） */
  reference_label: string
  reference_source: string
  attempt: number
  /** 结果类型标签（新，按 asset_type 分流）：characterReference / sceneAssetImage / propAssetImage / costumeDesignImage */
  result_kind?: string
  /** 结果类型的中文标签（新）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图 */
  result_label?: string
  /** 本次使用的画幅（新）：人物参考图固定 16:9（**不是**项目最终视频画幅） */
  aspect_ratio?: string
  /** 画幅来源（新）：character_reference_fixed / request / default */
  aspect_ratio_source?: string
  /** 本次使用的提示词模板名（新，审计用） */
  prompt_template?: string
  /** 同一轮重复点击会直接复用上一轮结果（没有再次调用供应商、没有再次计费） */
  deduplicated: boolean
  source_task_id: string
  results: AssetImageServiceResult[]
  summary: Record<string, unknown>
  outcome: string
  warnings: string[]
  guard_status: string
  paid_call_made: boolean
  note?: string
}

/**
 * **可选返工流程**：用该资产**已有的参考图**重新生成一张。
 *
 * 与默认主流程的分工（用户明确要求，代码名也要分开）：
 * - 默认主流程 `submitAssetImages`（生成参考图）：按提示词直接生成，不传已有图片；
 * - 本流程 `regenerateWithExistingReference`：只有该资产已有参考图、且用户明确要保一致性时用，
 *   参考图会**真的**进请求（走 Jellyfish 自己的图片通道）。
 */
export function regenerateWithExistingReference(body: ReferenceRegenerateBody): Promise<ReferenceRegenerateResponse> {
  return callApi(REFERENCE_REGENERATE_PATH, body as unknown as Record<string, unknown>)
}

export type ReferenceReworkAvailability = {
  available: boolean
  /** 不可用时的如实说明（页面上直接展示；按类型取词的那条由页面用它自己类型的话） */
  reason: string
  /**
   * 原因码：
   *   - `available`：端点已上线；
   *   - `not_deployed`：接口清单里没有这个路径（页面按**当前资产类型**给出提示词，
   *     免得对场景 / 道具也说「重新生成参考图」）；
   *   - `unknown`：读不到接口清单（不知道有没有上线，绝不假装可用）。
   */
  reasonCode: 'available' | 'not_deployed' | 'unknown'
}

let referenceReworkAvailability: ReferenceReworkAvailability | null = null

/**
 * 「使用已有参考图重新生成」是否已上线（**只读探测，不触发任何生成**）。
 *
 * 为什么读 OpenAPI 而不是试着调一次：那个端点会真的出图/花钱，
 * 用它来"探测可用性"等于拿钱试错。这里只读 `/openapi.json` 判断路径是否存在，
 * 端点没上线时前端**禁用并如实说明「该能力正在接入」**，不假装可用。
 */
export async function fetchReferenceReworkAvailability(force = false): Promise<ReferenceReworkAvailability> {
  if (referenceReworkAvailability && !force) return referenceReworkAvailability
  try {
    const response = await fetch(`${OpenAPI.BASE}/openapi.json`)
    if (!response.ok) {
      referenceReworkAvailability = {
        available: false,
        reason: '暂时读不到可用能力清单，无法确认这个功能现在能不能用。',
        reasonCode: 'unknown',
      }
      return referenceReworkAvailability
    }
    const spec = (await response.json()) as { paths?: Record<string, unknown> }
    const available = Boolean(spec?.paths && Object.prototype.hasOwnProperty.call(spec.paths, REFERENCE_REGENERATE_PATH))
    referenceReworkAvailability = {
      available,
      reason: available ? '' : REFERENCE_REWORK_UNAVAILABLE_HINT,
      reasonCode: available ? 'available' : 'not_deployed',
    }
  } catch {
    referenceReworkAvailability = {
      available: false,
      reason: '暂时读不到可用能力清单，无法确认这个功能现在能不能用。',
      reasonCode: 'unknown',
    }
  }
  return referenceReworkAvailability
}

/** 大模型生成/完善**一个**资产的图片提示词（只预览，不写库）。 */
export type AssetPromptPreviewOutcome = {
  prompt: string
  llmCalled: boolean
  warnings: string[]
  latencyMs: number | null
  /**
   * 本次生成依据的原始回包片段（默认收起的「生成依据」面板用它读字段）。
   *
   * **原样透传，前端不加工**：字段还没上线时面板自己会如实显示「本次未提供生成依据」。
   */
  basisPayload: unknown
  /** 本次提示词质量的原始回包片段（后端结构化判定优先） */
  qualityPayload: unknown
  /** 命中的槽位（技术详情用；拿不到就是 null） */
  slot: ImagePromptSlot | null
  /** 后端这次压根没返回可用槽位（例如槽位表里还没有这个类型） */
  slotMissing: boolean
  /**
   * 本次画像资料是**谁装配的**：
   *   - `server`：让后端自己装载（新后端会把「资产描述 + 候选结构化资料 + 剧本片段」拼起来，
   *     这正是"生成时没有拿到剧本里的资产资料"的根因修复）；
   *   - `request`：退回"调用方传入画像"（今天的口径：只有资产描述）；
   *   - `none`：两条都没成。
   */
  profileSource: 'server' | 'request' | 'none'
  /** 一句话说明（页面如实展示：这次资料是哪来的） */
  profileNote: string
  /**
   * ④ 本次**真的发出去**的请求体（页面用它渲染脱敏请求结构）。
   *
   * 只记录结构本身；渲染时会把内部 ID 脱敏，见 `buildRequestStructureText`。
   */
  requestBody: Record<string, unknown>
}

/**
 * **先让后端自己装载资产资料**（新后端 `load_project_entity_profiles(enrich=True)`）。
 *
 * 为什么值得多一步：后端装载时会按「资产描述 → 候选结构化资料（含出场镜头/剧本原文）
 * → 剧本片段」拼画像；只要调用方**别把画像塞进来**，它就会走这条路。
 * 这是用户那个问题（提示词大量"外观信息不足、需人工补充"）的根因修复。
 *
 * **生成范围必须只有这一项**：请求里点名这一项（见 `buildAssetPromptRequestScope`），
 * 并带上当前集。否则后端会把**整个项目/本章**的实体都装成画像卡当上下文 ——
 * 一个没被勾选、又恰好没有资料的空壳资产，会出现在这次生成里，
 * 甚至变成"这一次不能保存"的原因（真实事故）。
 *
 * 安全网：拿回来的槽位必须**确实是这个资产**（名字对得上），否则退回调用方传入画像 ——
 * 宁可少用一点资料，也绝不能把隔壁资产的资料画到它身上。
 */
async function previewWithServerProfiles(args: {
  projectId?: string | null
  /** 当前集：全局资产（场景/道具/服装）的本章资料按它隔离读取 */
  chapterId?: string | null
  assetName: string
  assetId?: string
  assetType?: string
  category: string
  extras: Record<string, string>
}): Promise<{
  slot: ImagePromptSlot
  llmCalled: boolean
  latencyMs: number | null
  warnings: string[]
  requestBody: Record<string, unknown>
} | null> {
  if (!args.projectId) return null
  try {
    // 一次请求只点名这一项（空名字时不下发该字段：宁可少收窄，也不乱点名）
    const scope = buildAssetPromptRequestScope({
      assetName: args.assetName,
      assetId: args.assetId,
      assetType: args.assetType,
    })
    const chapterId = String(args.chapterId ?? '').trim()
    const body: Record<string, unknown> = {
      project_id: args.projectId,
      // 当前集：只读**本章**的资产资料，别的章节写的资料不会串进来
      ...(chapterId ? { chapter_id: chapterId } : {}),
      // 只给名字，不给画像：后端据此在**它自己装载的**画像卡里挑中这个资产
      shot_text: args.assetName,
      // 同时点名：后端的画像卡集合与"资料够不够"的判定都收窄到这一项
      ...(scope.entityNames.length > 0 ? { entity_names: scope.entityNames } : {}),
      categories: [args.category],
      ...args.extras,
    }
    const preview = await previewImagePrompts(body as Parameters<typeof previewImagePrompts>[0])
    const slots: ImagePromptSlot[] = Array.isArray(preview?.slots) ? preview.slots : []
    const matched = slots.find((slot) => String(slot?.category ?? '') === args.category) ?? null
    if (!matched) return null
    if (!matchesRequestedAsset({ slot: matched }, args.assetName)) return null
    return {
      slot: matched,
      // 演练 / 模板结果**绝不能**被当成大模型输出（保存前的守卫靠这个布尔量）
      llmCalled: Boolean(preview?.meta?.llm_called),
      latencyMs: typeof preview?.meta?.latency_ms === 'number' ? preview.meta.latency_ms : null,
      warnings: Array.isArray(preview?.warnings) ? preview.warnings : [],
      requestBody: body,
    }
  } catch {
    // 老后端 / 网络问题：不报错，安静地退回调用方传入画像那条路
    return null
  }
}

export async function previewAssetImagePrompt(args: {
  projectId?: string | null
  /** 当前集（可选）：给了就只读本章的资产资料（全局资产按章节隔离） */
  chapterId?: string | null
  assetType: string
  /** 资产 id（后端声明了才会发送，见 assetPromptRequestContract 的能力探测） */
  assetId?: string
  name: string
  description: string
  category: string
  /** 项目整体风格（`projects.visual_style` + `style`） */
  styleHint?: string
  /** 用户对该资产的补充/修改 */
  userSupplement?: string
  /** 请求字段能力（`fetchPromptRequestSupport()` 的结果；不给就不发额外字段） */
  requestSupport?: PromptRequestFieldSupport
}): Promise<AssetPromptPreviewOutcome> {
  const extras = buildPromptRequestExtras({
    support: args.requestSupport ?? PROMPT_REQUEST_SUPPORT_NONE,
    styleHint: args.styleHint,
    userSupplement: args.userSupplement,
    assetId: args.assetId,
    assetType: args.assetType,
  })
  // ① 先让后端自己装配（含候选结构化资料 + 剧本片段）：这是"生成时真的拿到剧本资料"的关键一步
  const serverProfileSlot = await previewWithServerProfiles({
    projectId: args.projectId,
    chapterId: args.chapterId,
    assetName: args.name,
    assetId: args.assetId,
    assetType: args.assetType,
    category: args.category,
    extras,
  })
  if (serverProfileSlot) {
    return {
      prompt: String(serverProfileSlot.slot.prompt ?? '').trim(),
      llmCalled: serverProfileSlot.llmCalled,
      warnings: serverProfileSlot.warnings,
      latencyMs: serverProfileSlot.latencyMs,
      basisPayload: serverProfileSlot.slot,
      qualityPayload: serverProfileSlot.slot,
      slot: serverProfileSlot.slot,
      slotMissing: false,
      profileSource: 'server',
      profileNote: '本次的资产资料按「资产描述 → 结构化资料 → 剧本片段」自动装配（见「这次用了哪些资料」）。',
      requestBody: serverProfileSlot.requestBody,
    }
  }

  // ② 退回调用方传入画像（老后端 / 后端没挑中这个资产时）
  const body: Record<string, unknown> = {
    project_id: args.projectId ?? null,
    entity_profiles: [
      buildEntityProfileEntry({
        name: args.name,
        entityType: args.assetType,
        profile: args.description,
        support: args.requestSupport ?? PROMPT_REQUEST_SUPPORT_NONE,
      }),
    ],
    categories: [args.category],
    ...extras,
  }
  const preview = await previewImagePrompts(body as Parameters<typeof previewImagePrompts>[0])
  const slots: ImagePromptSlot[] = Array.isArray(preview?.slots) ? preview.slots : []
  const matched = slots.find((slot) => String(slot?.category ?? '') === args.category) ?? slots[0] ?? null
  const hasDescription = Boolean(String(args.description ?? '').trim())
  return {
    prompt: String(matched?.prompt ?? '').trim(),
    llmCalled: Boolean(preview?.meta?.llm_called),
    warnings: Array.isArray(preview?.warnings) ? preview.warnings : [],
    latencyMs: typeof preview?.meta?.latency_ms === 'number' ? preview.meta.latency_ms : null,
    // 依据字段可能在回包根上，也可能在槽位上：两个都给面板，由面板容错读取
    basisPayload: matched ?? preview ?? null,
    qualityPayload: matched ?? preview ?? null,
    slot: matched,
    slotMissing: !matched,
    profileSource: 'request',
    profileNote: hasDescription
      ? '本次的资产资料来自「资产描述」（没有按项目装配结构化资料与剧本片段：这些资料补上后提示词会更准）。'
      : '本次没有可用的资产资料（资产描述是空的，也没有装配到结构化资料）：难怪会出现「外观信息不足」。',
    requestBody: body,
  }
}

/* ------------------------- 资产图片提示词的批量保存（后端"全有或全无"入口） ------------------------- */

/**
 * 批量保存资产图片提示词（`POST /studio/projects/{project_id}/asset-image-prompts`）。
 *
 * 为什么用它而不是逐个 PATCH：后端这一个入口一次事务内做四件事 ——
 * 逐资产质量拦截（422）、**跨资产查重**（409）、覆盖保护、只写变化的槽位（合并写入）。
 * 逐个 PATCH 看不到"两个角色拿到同一段提示词"，还会"部分成功"。
 */
export function saveAssetImagePromptsBatch(
  projectId: string,
  body: AssetPromptBatchSaveBody,
): Promise<Record<string, unknown>> {
  return callApi(
    `/api/v1/studio/projects/${encodeURIComponent(projectId)}/asset-image-prompts`,
    body as unknown as Record<string, unknown>,
  )
}

let batchSaveSupport: AssetPromptBatchSaveSupport | null = null

/** 批量保存入口在不在（读接口清单；读不到就退回逐资产保存，不把 404 甩给用户）。 */
export async function fetchAssetPromptBatchSaveSupport(force = false): Promise<AssetPromptBatchSaveSupport> {
  if (batchSaveSupport && !force) return batchSaveSupport
  try {
    const response = await fetch(`${OpenAPI.BASE}/openapi.json`)
    if (!response.ok) {
      batchSaveSupport = ASSET_PROMPT_BATCH_SAVE_UNAVAILABLE
      return batchSaveSupport
    }
    batchSaveSupport = readAssetPromptBatchSaveSupport(await response.json())
  } catch {
    batchSaveSupport = ASSET_PROMPT_BATCH_SAVE_UNAVAILABLE
  }
  return batchSaveSupport
}

/* ------------------------- 请求字段能力探测（只读接口清单，不触网生成） ------------------------- */

let promptRequestSupport: PromptRequestFieldSupport | null = null

/**
 * 读一次后端接口清单，判断「图片提示词生成」请求模型声明了哪些字段。
 *
 * 为什么这么做：新增的 `user_supplement` / `asset_id` 字段名以后端实现为准，
 * 前端硬猜会 422；读清单则**后端一上线前端就自动开始使用**，
 * 读不到就退化成今天的行为（一个额外字段都不发）。
 */
export async function fetchPromptRequestSupport(force = false): Promise<PromptRequestFieldSupport> {
  if (promptRequestSupport && !force) return promptRequestSupport
  try {
    const response = await fetch(`${OpenAPI.BASE}/openapi.json`)
    if (!response.ok) {
      promptRequestSupport = PROMPT_REQUEST_SUPPORT_NONE
      return promptRequestSupport
    }
    promptRequestSupport = readPromptRequestFieldSupport(await response.json())
  } catch {
    promptRequestSupport = PROMPT_REQUEST_SUPPORT_NONE
  }
  return promptRequestSupport
}
