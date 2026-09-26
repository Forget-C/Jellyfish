/**
 * 第 2 步「资产准备」工作台的数据契约（**只读一个新接口**）。
 *
 *   `GET /api/v1/studio/chapters/{chapter_id}/asset-workbench`
 *
 * 契约是**冻结**的：后端并行实现期间前端按契约写类型与降级逻辑，
 * 接口还没落地时**如实说"等待后端契约"**并用既有接口拼一个降级视图 ——
 * 绝不伪造契约字段（降级视图里缺少的字段一律留空，不猜）。
 *
 * 本文件**只有类型与纯函数**（可在 `node --test` 里直接跑）；
 * 真正发请求的那一层在 `assetWorkbenchApi.ts`（复用同一个 `callApi`）。
 */

/** 契约路径（可用性探测与调用共用一处，避免两处不一致）。 */
export const ASSET_WORKBENCH_PATH_PREFIX = '/api/v1/studio/chapters'

export function assetWorkbenchPath(chapterId: string): string {
  return `${ASSET_WORKBENCH_PATH_PREFIX}/${encodeURIComponent(chapterId)}/asset-workbench`
}

/* ------------------------------------------------------------------ 契约类型 */

export type AssetWorkbenchAnalysis = {
  generated: boolean
  /** not_generated | generated | stale | records_only */
  status: string
  status_label: string
  content_changed: boolean
  records_total: number
  generated_at: string | null
  hint: string
}

export type AssetWorkbenchSummary = {
  total: number
  by_type: Record<string, number>
  needs_profile: number
  needs_prompt: number
  prompt_ready: number
  prompt_needs_regeneration: number
  generating: number
  failed: number
  has_image: number
  primary: number
  pending_review: number
}

export type AssetWorkbenchShotRef = {
  shot_index: number
  title: string
  script_excerpt: string
}

export type AssetWorkbenchEvidence = {
  snippet: string
  grounded: boolean
}

export type AssetWorkbenchScriptRelation = {
  plot_identity: string
  shot_refs: AssetWorkbenchShotRef[]
  evidence: AssetWorkbenchEvidence[]
}

export type AssetWorkbenchPromptQuality = {
  verdict: string
  reasons: string[]
  needs_regeneration: boolean
}

export type AssetWorkbenchPrompt = {
  /** 内部槽位名（只进「技术详情」） */
  slot: string
  slot_label: string
  text: string
  saved: boolean
  quality?: AssetWorkbenchPromptQuality | null
}

export type AssetWorkbenchImage = {
  has_image: boolean
  has_primary: boolean
  image_id: number | null
  thumbnail: string
  image_count: number
}

export type AssetWorkbenchItemStatus = {
  key: string
  label: string
  reason: string
}

export type AssetWorkbenchItem = {
  asset_type: string
  asset_id: string
  name: string
  /** chapter_record | asset_description | none */
  profile_source: string
  profile_digest: string
  profile_fields: Record<string, string>
  manual_overrides: Record<string, string>
  user_notes: string[]
  script_relation?: AssetWorkbenchScriptRelation | null
  prompt?: AssetWorkbenchPrompt | null
  image?: AssetWorkbenchImage | null
  status?: AssetWorkbenchItemStatus | null
  batch_eligible: boolean
}

export type AssetWorkbenchPendingReview = {
  /** alias_conflict | same_name_other_type | multiple_candidates | costume_without_asset */
  kind: string
  asset_type: string
  name: string
  reason: string
  conflict_code: string
  candidate_count: number
}

/**
 * 技术详情区（默认收起）读的内部字段。
 *
 * 这些字段**只允许**出现在 `TechnicalDetailCollapse.tsx` 里 ——
 * 主界面的禁词测试会挡住它跑到卡片或按钮上（用户点名）。
 */
export type AssetWorkbenchTechnical = {
  candidates_total: number
  candidates_by_type_status: Record<string, Record<string, number>>
  candidate_groups: number
  match_diagnostics: { name: string; reason: string }[]
  notes: string[]
}

export type AssetWorkbenchResponse = {
  chapter_id: string
  project_id: string
  chapter_title: string
  script_chars: number
  analysis: AssetWorkbenchAnalysis
  summary: AssetWorkbenchSummary
  items: AssetWorkbenchItem[]
  pending_review: AssetWorkbenchPendingReview[]
  technical: AssetWorkbenchTechnical
}

/* ---------------------------------------------------------------- 容错归一化 */

function toText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function toTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((row): row is string => typeof row === 'string' && row.trim().length > 0)
}

function toNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function toStringRecord(value: unknown): Record<string, string> {
  const raw = toRecord(value)
  const out: Record<string, string> = {}
  Object.keys(raw).forEach((key) => {
    const text = raw[key]
    if (typeof text === 'string' && text.trim()) out[key] = text
  })
  return out
}

function normalizeNumberRecord(value: unknown): Record<string, number> {
  const raw = toRecord(value)
  const out: Record<string, number> = {}
  Object.keys(raw).forEach((key) => {
    out[key] = toNumber(raw[key])
  })
  return out
}

function normalizeShotRefs(value: unknown): AssetWorkbenchShotRef[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const raw = toRecord(row)
    return {
      shot_index: toNumber(raw.shot_index),
      title: toText(raw.title),
      script_excerpt: toText(raw.script_excerpt),
    }
  })
}

function normalizeEvidence(value: unknown): AssetWorkbenchEvidence[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const raw = toRecord(row)
    return { snippet: toText(raw.snippet), grounded: raw.grounded === true }
  })
}

function normalizeScriptRelation(value: unknown): AssetWorkbenchScriptRelation | null {
  if (!value || typeof value !== 'object') return null
  const raw = toRecord(value)
  return {
    plot_identity: toText(raw.plot_identity),
    shot_refs: normalizeShotRefs(raw.shot_refs),
    evidence: normalizeEvidence(raw.evidence),
  }
}

function normalizePrompt(value: unknown): AssetWorkbenchPrompt | null {
  if (!value || typeof value !== 'object') return null
  const raw = toRecord(value)
  const qualityRaw = toRecord(raw.quality)
  return {
    slot: toText(raw.slot),
    slot_label: toText(raw.slot_label),
    text: toText(raw.text),
    saved: raw.saved === true,
    quality:
      Object.keys(qualityRaw).length > 0
        ? {
            verdict: toText(qualityRaw.verdict),
            reasons: toTextArray(qualityRaw.reasons),
            needs_regeneration: qualityRaw.needs_regeneration === true,
          }
        : null,
  }
}

function normalizeImage(value: unknown): AssetWorkbenchImage | null {
  if (!value || typeof value !== 'object') return null
  const raw = toRecord(value)
  return {
    has_image: raw.has_image === true,
    has_primary: raw.has_primary === true,
    image_id: typeof raw.image_id === 'number' ? raw.image_id : null,
    thumbnail: toText(raw.thumbnail),
    image_count: toNumber(raw.image_count),
  }
}

function normalizeItemStatus(value: unknown): AssetWorkbenchItemStatus | null {
  if (!value || typeof value !== 'object') return null
  const raw = toRecord(value)
  return { key: toText(raw.key), label: toText(raw.label), reason: toText(raw.reason) }
}

function normalizeItem(value: unknown): AssetWorkbenchItem {
  const raw = toRecord(value)
  return {
    asset_type: toText(raw.asset_type),
    asset_id: toText(raw.asset_id),
    name: toText(raw.name),
    profile_source: toText(raw.profile_source),
    profile_digest: toText(raw.profile_digest),
    profile_fields: toStringRecord(raw.profile_fields),
    manual_overrides: toStringRecord(raw.manual_overrides),
    user_notes: toTextArray(raw.user_notes),
    script_relation: normalizeScriptRelation(raw.script_relation),
    prompt: normalizePrompt(raw.prompt),
    image: normalizeImage(raw.image),
    status: normalizeItemStatus(raw.status),
    batch_eligible: raw.batch_eligible === true,
  }
}

function normalizePendingReview(value: unknown): AssetWorkbenchPendingReview[] {
  if (!Array.isArray(value)) return []
  return value.map((row) => {
    const raw = toRecord(row)
    return {
      kind: toText(raw.kind),
      asset_type: toText(raw.asset_type),
      name: toText(raw.name),
      reason: toText(raw.reason),
      conflict_code: toText(raw.conflict_code),
      candidate_count: toNumber(raw.candidate_count),
    }
  })
}

function normalizeTechnical(value: unknown): AssetWorkbenchTechnical {
  const raw = toRecord(value)
  const byTypeStatus = toRecord(raw.candidates_by_type_status)
  const nested: Record<string, Record<string, number>> = {}
  Object.keys(byTypeStatus).forEach((key) => {
    nested[key] = normalizeNumberRecord(byTypeStatus[key])
  })
  const diagnostics = Array.isArray(raw.match_diagnostics) ? raw.match_diagnostics : []
  return {
    candidates_total: toNumber(raw.candidates_total),
    candidates_by_type_status: nested,
    candidate_groups: toNumber(raw.candidate_groups),
    match_diagnostics: diagnostics.map((row) => {
      const item = toRecord(row)
      return { name: toText(item.name), reason: toText(item.reason) }
    }),
    notes: toTextArray(raw.notes),
  }
}

function normalizeAnalysis(value: unknown): AssetWorkbenchAnalysis {
  const raw = toRecord(value)
  return {
    generated: raw.generated === true,
    status: toText(raw.status) || 'not_generated',
    status_label: toText(raw.status_label),
    content_changed: raw.content_changed === true,
    records_total: toNumber(raw.records_total),
    generated_at: typeof raw.generated_at === 'string' ? raw.generated_at : null,
    hint: toText(raw.hint),
  }
}

function normalizeSummary(value: unknown, items: AssetWorkbenchItem[]): AssetWorkbenchSummary {
  const raw = toRecord(value)
  const byType = normalizeNumberRecord(raw.by_type)
  if (Object.keys(byType).length === 0) {
    items.forEach((item) => {
      byType[item.asset_type] = (byType[item.asset_type] ?? 0) + 1
    })
  }
  return {
    total: toNumber(raw.total) || items.length,
    by_type: byType,
    needs_profile: toNumber(raw.needs_profile),
    needs_prompt: toNumber(raw.needs_prompt),
    prompt_ready: toNumber(raw.prompt_ready),
    prompt_needs_regeneration: toNumber(raw.prompt_needs_regeneration),
    generating: toNumber(raw.generating),
    failed: toNumber(raw.failed),
    has_image: toNumber(raw.has_image),
    primary: toNumber(raw.primary),
    pending_review: toNumber(raw.pending_review),
  }
}

/** 把后端回包归一到契约形状（缺字段一律留空 / 0，不猜、不编）。 */
export function normalizeAssetWorkbench(payload: unknown): AssetWorkbenchResponse {
  const raw = toRecord(payload)
  const items = Array.isArray(raw.items) ? raw.items.map(normalizeItem) : []
  return {
    chapter_id: toText(raw.chapter_id),
    project_id: toText(raw.project_id),
    chapter_title: toText(raw.chapter_title),
    script_chars: toNumber(raw.script_chars),
    analysis: normalizeAnalysis(raw.analysis),
    summary: normalizeSummary(raw.summary, items),
    items,
    pending_review: normalizePendingReview(raw.pending_review),
    technical: normalizeTechnical(raw.technical),
  }
}

/* -------------------------------------------------------------------- 取数 */

export type WorkbenchLoadSource = 'contract' | 'degraded'

export type WorkbenchLoadResult = {
  source: WorkbenchLoadSource
  data: AssetWorkbenchResponse
  /** 降级时**如实**告诉用户发生了什么（空串 = 正常走契约） */
  note: string
}

/**
 * 资料还没齐时的说明（**用户语言**）。
 *
 * 审计 §4.2（`AssetWorkbench.tsx:405` + 本文件 `:373,377,467`）点名这一条是
 * 主区最大面积的一处泄漏：原文写的是「等待后端契约」「接口还没有就绪（后端正在按契约实现）」
 * 「降级视图」—— 全是**开发术语**，用户既看不懂也不知道该做什么。
 *
 * 新口径（用户拍板）：只说「资料还在准备中」+ 现在能看到什么 + 什么时候会补齐。
 * 「契约 / 降级视图 / 后端」这些词**不出现在主区**；技术细节在默认收起的「技术详情」里。
 */
export const WORKBENCH_CONTRACT_PENDING_NOTE =
  '本章资产资料还在准备中：先按下面已有的数据查看资产与图片状态。' +
  '资料摘要、剧本关系、待处理项会在资料齐备后自动出现。'

/** 同一件事在顶部那行提示里的**短句**（避免同一段话在屏幕上出现两遍）。 */
export const WORKBENCH_CONTRACT_PENDING_HINT = '本章资产资料还在准备中：先按下面已有的数据查看资产与图片状态。'

/** 「资料还在准备中」时顶部的标题（用户语言；状态标签也用它）。 */
export const WORKBENCH_CONTRACT_PENDING_TITLE = '本章资产资料还在准备中'

/** 重试入口的按钮文案。 */
export const WORKBENCH_CONTRACT_PENDING_RETRY = '重新读取资料'

/* ---------------------------------------------------------------- 降级视图 */

export type DegradedWorkbenchInput = {
  projectId: string
  chapterId: string
  chapterTitle: string
  scriptChars: number
  /** 既有步骤信号里的项目资产（`useProjectStepSignals`，全部是真实数据） */
  assets: readonly DegradedSignalAsset[]
  /** 读取既有接口时的失败原因（空串 = 没失败，只是接口没落地） */
  reason?: string
}

/**
 * 降级视图的输入：**只需要既有接口真的有的那几个字段**。
 *
 * 刻意声明成结构类型而不是直接引用 `ProjectSignalAsset`：
 * ① 这个文件保持零运行时依赖（能被 `node --test` 直接跑）；
 * ② 调用方传 `ProjectSignalAsset[]` 天然兼容，不需要断言。
 */
export type DegradedSignalAsset = {
  id: string
  name: string
  type: string
  hasImage?: boolean
  hasPrimary?: boolean
  hasImagePrompt?: boolean
  imageId?: number | null
  thumbnail?: string
}

/**
 * 用**既有接口**已有的真实字段拼一个降级视图。
 *
 * 只搬运真实存在的字段：`hasImage` / `hasPrimary` / `hasImagePrompt` / `thumbnail`。
 * 契约里没有对应来源的字段（资料摘要、剧本关系、待处理项、技术详情）一律留空 ——
 * **宁可不显示，也不编造**（这是用户对上一轮"伪造就绪"的明确批评）。
 */
export function buildDegradedWorkbench(input: DegradedWorkbenchInput): WorkbenchLoadResult {
  const items: AssetWorkbenchItem[] = input.assets.map((asset) => {
    const hasImg = asset.hasImage === true
    const hasPri = asset.hasPrimary === true
    const key = hasPri ? 'primary' : hasImg ? 'has_image' : asset.hasImagePrompt ? 'ready' : 'needs_prompt'
    const label =
      key === 'primary'
        ? '已定版'
        : key === 'has_image'
          ? '已有图片待选择'
          : key === 'ready'
            ? '可以生成'
            : '待生成提示词'
    return {
      asset_type: asset.type,
      asset_id: asset.id,
      name: asset.name || asset.id,
      profile_source: 'none',
      profile_digest: '',
      profile_fields: {},
      manual_overrides: {},
      user_notes: [],
      script_relation: null,
      prompt: { slot: '', slot_label: '', text: '', saved: asset.hasImagePrompt === true, quality: null },
      image: {
        has_image: hasImg,
        has_primary: hasPri,
        image_id: typeof asset.imageId === 'number' ? asset.imageId : null,
        thumbnail: asset.thumbnail || '',
        image_count: hasImg ? 1 : 0,
      },
      status: { key, label, reason: '' },
      // 降级视图拿不到"提示词是否需要重新生成"，只能按出图服务支持的类型给可批量
      batch_eligible: asset.type !== 'costume',
    }
  })
  const byType: Record<string, number> = {}
  items.forEach((item) => {
    byType[item.asset_type] = (byType[item.asset_type] ?? 0) + 1
  })
  const count = (key: string) => items.filter((item) => item.status?.key === key).length
  const data: AssetWorkbenchResponse = {
    chapter_id: input.chapterId,
    project_id: input.projectId,
    chapter_title: input.chapterTitle,
    script_chars: input.scriptChars,
    analysis: {
      // 降级视图**不假装分析过**：后端没给这个字段就不说"已生成"
      generated: false,
      status: 'not_generated',
      status_label: WORKBENCH_CONTRACT_PENDING_TITLE,
      content_changed: false,
      records_total: 0,
      generated_at: null,
      // 原始读取失败原因只进「技术详情」，主界面那句提示用用户语言
      hint: WORKBENCH_CONTRACT_PENDING_HINT,
    },
    summary: {
      total: items.length,
      by_type: byType,
      needs_profile: 0,
      needs_prompt: count('needs_prompt'),
      prompt_ready: count('ready'),
      prompt_needs_regeneration: 0,
      generating: 0,
      failed: 0,
      has_image: count('has_image'),
      primary: count('primary'),
      pending_review: 0,
    },
    items,
    pending_review: [],
    technical: {
      candidates_total: 0,
      candidates_by_type_status: {},
      candidate_groups: 0,
      match_diagnostics: [],
      notes: [],
    },
  }
  return {
    source: 'degraded',
    data,
    /**
     * ⚠️ `note` 只给**技术详情层**用，不许直接进主区。
     *
     * 它原来是「主区说明 + 后端读取失败原文」拼在一起（`（读取失败原因：…）`），
     * 一旦有人把它渲到 Alert 上就把后端原文漏出去了。读取失败原文现在有**唯一**落点：
     * `TechnicalDetailCollapse` 的「读取失败原因」行（由 `technicalView.loadError` 承接），
     * 所以这里只留用户语言的说明。
     */
    note: WORKBENCH_CONTRACT_PENDING_NOTE,
  }
}
