/**
 * 第 2 步「资产准备」工作台的**纯逻辑**（无 React、无请求，可直接 `node --test`）。
 *
 * 这里放的正是参考项目（`人物及场景生产项目`）里那套**已验证的状态机**：
 *   - 页签过滤（原 `public/index.html:549-552` 的类型页签 + 计数，
 *     页签同时决定下方结果卡显示哪一类）；
 *   - 勾选动作（原 `public/index.html:502-509`：全选 / 清空 / 只选未生成项）；
 *   - 主按钮文案与禁用（原 `public/app.js:850-933` `renderGenerationCommand()`：
 *     由「已选 / 未生成 / 需重新生成 / 生成中」推导，明细行一行汇总）。
 *
 * 与参考项目的**适配点**（不是照抄）：
 *   1. 参考项目按"风格是否过期"推导 stale；Jellyfish 换成后端契约给的
 *      `prompt.quality.needs_regeneration`（旧提示词需要重新生成）；
 *   2. 参考项目只有人物 / 场景 / 道具三个页签，Jellyfish 是人物 / 场景 / 道具 / 服装四类，
 *      且**四类平权**（服装走 Jellyfish 自己的 APIMart 通道，见 assetProduction.SUBMITTABLE_ASSET_TYPES）；
 *      所以服装可以勾选、可以看资料，但不进批量生成；
 *   3. 参考项目把 `provider / 任务号 / 原始状态` 打在卡片副标题上（`labelFor`），
 *      Jellyfish 的用户口径相反：主界面只有用户语言，
 *      内部字段（模型 / 供应商 / 任务号 / file_id / 槽位 / 候选条数 …）只进默认收起的「技术详情」。
 */

import { ASSET_PROFILE_FIELD_SPECS } from '../assetProfileFields.ts'
import { maskInternalIds } from '../../../../components/maskInternalIds.ts'

/** 工作台四类资产的顺序（与出图分页签口径一致）。 */
export type WorkbenchAssetType = 'character' | 'scene' | 'prop' | 'costume'

export const WORKBENCH_TABS: WorkbenchAssetType[] = ['character', 'scene', 'prop', 'costume']

export const WORKBENCH_TAB_LABEL: Record<WorkbenchAssetType, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
  costume: '服装',
}

/** 出图服务只接受人物 / 场景 / 道具：服装可以勾选但不进批量生成。 */
/**
 * 可出图的资产类型：**四类平权**（服装走 Jellyfish 自己的 APIMart 通道，
 * 通道分流由后端按 `asset_type` 决定并如实回报）。
 *
 * 与 `assetProduction.SUBMITTABLE_ASSET_TYPES` 保持一致（那个模块负责请求组装）；
 * 本文件是纯逻辑单测入口，刻意不引入跨模块 import，改一处记得同步另一处。
 */
export const WORKBENCH_SUBMITTABLE_TYPES: WorkbenchAssetType[] = ['character', 'scene', 'prop', 'costume']

export function isWorkbenchSubmittable(type: WorkbenchAssetType): boolean {
  return WORKBENCH_SUBMITTABLE_TYPES.includes(type)
}

/* --------------------------------------------------------------- 资产状态口径 */

/** 契约 `status.key`（后端给出的业务状态口径）。 */
export type WorkbenchStatusKey =
  | 'needs_profile'
  | 'needs_prompt'
  | 'ready'
  | 'generating'
  | 'failed'
  | 'has_image'
  | 'primary'

/**
 * 主界面**唯一**的状态词表（用户点名的那七个词）。
 *
 * 后端 `status.label` 优先；这个表是后端没给 label 时的兜底，
 * 也用于顶部状态计数的标签与测试断言 —— 两处必须同源，否则会出现
 * 「卡片说待补资料、计数说 needs_profile」这种自相矛盾。
 */
export const WORKBENCH_STATUS_LABEL: Record<WorkbenchStatusKey, string> = {
  needs_profile: '待补资料',
  needs_prompt: '待生成提示词',
  ready: '可以生成',
  generating: '生成中',
  failed: '生成失败',
  has_image: '已有图片待选择',
  primary: '已定版',
}

export const WORKBENCH_STATUS_ORDER: WorkbenchStatusKey[] = [
  'needs_profile',
  'needs_prompt',
  'ready',
  'generating',
  'failed',
  'has_image',
  'primary',
]

export type WorkbenchStatusTone = 'default' | 'blue' | 'green' | 'red' | 'gold' | 'purple'

export const WORKBENCH_STATUS_TONE: Record<WorkbenchStatusKey, WorkbenchStatusTone> = {
  needs_profile: 'gold',
  needs_prompt: 'blue',
  ready: 'green',
  generating: 'blue',
  failed: 'red',
  has_image: 'purple',
  primary: 'green',
}

/* ------------------------------------------------------------------ 契约形状 */

/**
 * 工作台资产的最小结构（契约 `items[]` 的子集）。
 *
 * 刻意用"结构类型 + 全部可选"来读：后端字段没落地 / 少字段时页面降级为
 * 「待补资料」而不是崩掉，也不需要 `as any` 到处断言。
 */
export type WorkbenchStatusLike = {
  key?: string
  label?: string
  reason?: string
}

export type WorkbenchPromptQualityLike = {
  verdict?: string
  reasons?: string[]
  needs_regeneration?: boolean
}

export type WorkbenchImageLike = {
  has_image?: boolean
  has_primary?: boolean
  image_id?: number | null
  thumbnail?: string
  image_count?: number
}

export type WorkbenchItemLike = {
  asset_type?: string
  asset_id?: string
  name?: string
  status?: WorkbenchStatusLike | null
  prompt?: { quality?: WorkbenchPromptQualityLike | null; text?: string; saved?: boolean } | null
  image?: WorkbenchImageLike | null
  /** 后端显式给出的"能不能进批量"（需求 8：旧提示词的项为 false） */
  batch_eligible?: boolean
}

export function isWorkbenchAssetType(value: unknown): value is WorkbenchAssetType {
  return typeof value === 'string' && (WORKBENCH_TABS as string[]).includes(value)
}

/** 全页面唯一的资产键（同一项资产只出现一次，靠它保证）。 */
export function workbenchItemKey(item: WorkbenchItemLike): string {
  const type = isWorkbenchAssetType(item.asset_type) ? item.asset_type : 'character'
  return `${type}:${String(item.asset_id ?? '')}`
}

export function workbenchItemType(item: WorkbenchItemLike): WorkbenchAssetType {
  return isWorkbenchAssetType(item.asset_type) ? item.asset_type : 'character'
}

export function workbenchItemName(item: WorkbenchItemLike): string {
  return String(item.name ?? '').trim() || workbenchItemKey(item)
}

/** 该资产的提示词是否**需要重新生成**（需求 8：标出来、给单项入口、不进批量）。 */
export function needsPromptRegeneration(item: WorkbenchItemLike): boolean {
  const quality = item.prompt?.quality ?? null
  if (!quality) return false
  return quality.needs_regeneration === true || String(quality.verdict ?? '') === 'needs_regeneration'
}

/**
 * 该项是否**可以进批量选择**。
 *
 * 两个条件缺一不可：后端显式说可以（`batch_eligible`）+ 提示词不需要重新生成。
 * 需求 8 写死了后者：旧提示词要先重新生成提示词，不能直接拿去出图。
 */
export function isBatchEligible(item: WorkbenchItemLike): boolean {
  if (needsPromptRegeneration(item)) return false
  return item.batch_eligible === true
}

export function hasImage(item: WorkbenchItemLike): boolean {
  return item.image?.has_image === true
}

export function hasPrimary(item: WorkbenchItemLike): boolean {
  return item.image?.has_primary === true
}

/** 业务状态键：后端给了就用后端的，没给就按图片 / 提示词自己推。 */
export function workbenchStatusKey(item: WorkbenchItemLike): WorkbenchStatusKey {
  const raw = String(item.status?.key ?? '')
  if ((WORKBENCH_STATUS_ORDER as string[]).includes(raw)) return raw as WorkbenchStatusKey
  if (needsPromptRegeneration(item)) return 'needs_prompt'
  if (hasPrimary(item)) return 'primary'
  if (hasImage(item)) return 'has_image'
  if (String(item.prompt?.text ?? '').trim()) return 'ready'
  return 'needs_profile'
}

/**
 * 后端给的 `status.label` 能不能直接当主区文案用。
 *
 * 审计 §4.5 模式 3/6 点名 `workbenchState.ts:196` 的 `if (fromServer) return fromServer`：
 * 后端一旦回英文枚举（`ready` / `needs_profile` / `partial_failed`）或
 * `xxx_yyy` 形态的机器码，就会**原样印在卡片上**。
 *
 * 这里做**白名单式**校验：只有「含中文、且不含下划线连写英文码」的短句才放行；
 * 其余一律退回本文件自己的中文状态词表（`WORKBENCH_STATUS_LABEL`），
 * 后端原文不进主区（需要排查时由调用方把它放进默认收起的「技术详情」）。
 */
export function isRenderableStatusLabel(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (!/[\u4e00-\u9fff]/.test(text)) return false
  if (/(?<![A-Za-z0-9_])[a-z]+(?:_[a-z]+){1,}(?![A-Za-z0-9_])/.test(text)) return false
  if (findMainScreenForbiddenTerms(text, MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS).length > 0) return false
  return true
}

/** 业务状态**中文标签**（用户语言；后端 `status.label` 过了白名单才优先）。 */
export function workbenchStatusLabel(item: WorkbenchItemLike): string {
  const fromServer = String(item.status?.label ?? '').trim()
  if (isRenderableStatusLabel(fromServer)) return fromServer
  return WORKBENCH_STATUS_LABEL[workbenchStatusKey(item)]
}

export function workbenchStatusTone(item: WorkbenchItemLike): WorkbenchStatusTone {
  return WORKBENCH_STATUS_TONE[workbenchStatusKey(item)]
}

/* -------------------------------------------------------------------- 页签 */

/** 页签过滤：**页签同时决定结果区显示哪一类**（参考项目同口径）。 */
export function itemsForTab<T extends WorkbenchItemLike>(
  items: readonly T[],
  tab: WorkbenchAssetType,
): T[] {
  return items.filter((item) => workbenchItemType(item) === tab)
}

/* -------------------------------------------------------------------- 计数 */

export type WorkbenchTypeCounts = Record<WorkbenchAssetType, number>

export function emptyTypeCounts(): WorkbenchTypeCounts {
  return { character: 0, scene: 0, prop: 0, costume: 0 }
}

/** 四类资产各多少项（顶部第一行数量）。 */
export function countByType(items: readonly WorkbenchItemLike[]): WorkbenchTypeCounts {
  const counts = emptyTypeCounts()
  items.forEach((item) => {
    counts[workbenchItemType(item)] += 1
  })
  return counts
}

export type WorkbenchStatusCounts = Record<WorkbenchStatusKey, number>

export function emptyStatusCounts(): WorkbenchStatusCounts {
  return {
    needs_profile: 0,
    needs_prompt: 0,
    ready: 0,
    generating: 0,
    failed: 0,
    has_image: 0,
    primary: 0,
  }
}

/** 七个业务状态各多少项（顶部第二行数量）。 */
export function countByStatus(items: readonly WorkbenchItemLike[]): WorkbenchStatusCounts {
  const counts = emptyStatusCounts()
  items.forEach((item) => {
    counts[workbenchStatusKey(item)] += 1
  })
  return counts
}

/** 待处理（`pending_review`）的一句话：入口按钮的文案来源。 */
export function describePendingReview(count: number): string {
  return count > 0 ? `待处理 ${count} 项` : '没有待处理项'
}

/* -------------------------------------------------------------------- 选择 */

export type WorkbenchSelectionAction = 'all' | 'clear' | 'ungenerated'

/** 未生成项 = 可以进批量、且还没有图片的项（需求：只选未生成项按 status/ 可批量推）。 */
export function isUngeneratedItem(item: WorkbenchItemLike): boolean {
  return isBatchEligible(item) && !hasImage(item)
}

/**
 * 三个勾选动作（语义与参考项目 `public/index.html:502-509` 一致）。
 *
 * `scopeType` = 当前页签：全选 / 只选未生成 只作用在本页签，
 * 其它页签的已选项**保留**（切页签不清空用户的选择）。
 */
export function applyWorkbenchSelection(
  items: readonly WorkbenchItemLike[],
  current: readonly string[],
  action: WorkbenchSelectionAction,
  scopeType?: WorkbenchAssetType,
): string[] {
  const known = new Set(items.map(workbenchItemKey))
  const kept = current.filter((key) => known.has(key))
  if (action === 'clear') return []
  const scope = scopeType ? itemsForTab(items, scopeType) : items
  const scopeKeys = (
    action === 'all' ? scope.filter(isBatchEligible) : scope.filter(isUngeneratedItem)
  ).map(workbenchItemKey)
  const next = new Set(kept)
  scopeKeys.forEach((key) => next.add(key))
  return Array.from(next)
}

/* -------------------------------------------------------------- 主操作推导 */

export type WorkbenchAnalysisLike = {
  generated?: boolean
  status?: string
  status_label?: string
  hint?: string
  content_changed?: boolean
  records_total?: number
}

export type WorkbenchCommandCounts = {
  /** 已选总数 */
  selected: number
  /** 已选中「可以生成」的项（没有图片，会走批量生成） */
  generatable: number
  /** 已选中「已有图片」的项（走批量重新生成） */
  regeneratable: number
  /** 已选中、提示词需要重新生成的项（**不进批量**，只提示） */
  needsRegeneration: number
  /** 已选中、正在生成的项 */
  generating: number
  /** 已选中、出图服务不支持的项（当前为空：四类都支持） */
  unsupported: number
  /** 已选中、可进批量但没有提示词的项 */
  withoutPrompt: number
  /** 已选中、**还没有图片提示词**的项（主按钮这时先去做"生成提示词"） */
  needsPrompt: number
}

/**
 * 主按钮这一步到底是哪件事：
 * - ``generate_prompts``：选中项还没有图片提示词 → 先写提示词（每项一次文本模型调用）；
 * - ``rewrite_prompts``：提示词是旧规则下保存的/已过期 → 先重写提示词；
 * - ``generate_images``：提示词可用 → 正常批量出图；
 * - ``none``：暂时没有可执行项（按钮禁用并说明原因）。
 */
export type WorkbenchPrimaryAction = 'generate_prompts' | 'rewrite_prompts' | 'generate_images' | 'none'

export type WorkbenchCommand = {
  /** 推荐操作的标题（一句话） */
  title: string
  /** 主按钮按下去要做的事（见 WorkbenchPrimaryAction） */
  primaryAction: WorkbenchPrimaryAction
  /** 明细行：已选 / 待生成 / 需重新生成 / 生成中 */
  detail: string
  /** 主按钮文案 */
  primaryLabel: string
  primaryDisabled: boolean
  /** 主按钮禁用时**为什么**（用户语言；可用时为空串） */
  primaryDisabledReason: string
  /**
   * 禁用原因对应的**后端原文**（已过 `maskInternalIds`；空串 = 没有原文）。
   *
   * 为什么单列：按 §7.1-8，主区那一句必须是产品自己写死的中文结论，
   * 后端 `analysis.hint` 只能进默认收起的「技术详情」——所以它需要一个**非主区**的出口，
   * 而不是像改前那样直接当 `primaryDisabledReason` 上屏（审计 §4.5 模式 6）。
   */
  primaryDisabledDetail: string
  /**
   * 主按钮**可用**时的一句说明（例如"会调用 3 次文本模型（按次计费）"）。
   *
   * 为什么单列一个字段：`primaryDisabledReason` 按契约在可用时是空串，
   * 但"点了会花几次钱"这件事必须在按钮旁边就看得见（用户明确要求）。
   */
  primaryHint: string
  /** 批量重新生成按钮文案 */
  regenerateLabel: string
  regenerateDisabled: boolean
  /**
   * **「批量生成图」按钮**（需求清单第 2 条第 2 项）。
   *
   * 为什么要单独一个按钮，而不是让主按钮变来变去：主按钮按"下一步真正能做的事"走，
   * 选中项还没有提示词时它就变成「生成图片提示词（N）」——那一刻界面上**没有任何**
   * 批量出图的入口，用户看到的就是"只有批量生成提示词，没有批量生成图"。
   * 这个按钮**常驻**并与「生成图片提示词」并排：已有提示词的项可以直接批量出图。
   */
  generateImagesLabel: string
  generateImagesDisabled: boolean
  /** 该按钮禁用时**为什么**（用户语言；可用时为空串） */
  generateImagesDisabledReason: string
  /** 该按钮**可用**时的一句说明（会花几张图的钱） */
  generateImagesHint: string
  /** 当前选中项里真正会进批量的张数（按钮数字与二次确认同口径） */
  generateImagesCount: number
  counts: WorkbenchCommandCounts
}

export type WorkbenchCommandInput = {
  items: readonly WorkbenchItemLike[]
  selectedKeys: readonly string[]
  /** 本轮是否正在提交 / 生成（来自既有的批量提交与结果状态） */
  busy?: boolean
  analysis?: WorkbenchAnalysisLike | null
}

function countSelected(
  items: readonly WorkbenchItemLike[],
  selectedKeys: readonly string[],
): WorkbenchCommandCounts {
  const selected = new Set(selectedKeys)
  const picked = items.filter((item) => selected.has(workbenchItemKey(item)))
  const counts: WorkbenchCommandCounts = {
    selected: picked.length,
    generatable: 0,
    regeneratable: 0,
    needsRegeneration: 0,
    generating: 0,
    unsupported: 0,
    withoutPrompt: 0,
    needsPrompt: 0,
  }
  picked.forEach((item) => {
    if (needsPromptRegeneration(item)) counts.needsRegeneration += 1
    if (!isWorkbenchSubmittable(workbenchItemType(item))) {
      counts.unsupported += 1
      return
    }
    if (workbenchStatusKey(item) === 'generating') {
      counts.generating += 1
      return
    }
    // 「待生成提示词」= 还没有可用的图片提示词（空 / 被质量拦下）：**先写提示词**才能出图。
    // 用户口径：资料 -> 提示词 -> 生成 -> 结果 -> 定版；主按钮必须跟着"下一步真正能做的事"走。
    const promptText = String(item.prompt?.text ?? '').trim()
    if (!promptText) counts.needsPrompt += 1
    if (!isBatchEligible(item)) return
    if (hasImage(item)) counts.regeneratable += 1
    else if (promptText) counts.generatable += 1
    if (!promptText) counts.withoutPrompt += 1
  })
  return counts
}

/**
 * 主按钮文案与禁用由「已选 / 待生成 / 需重新生成 / 生成中」推导
 * （参考项目 `public/app.js:850-933` `renderGenerationCommand()` 的同一条状态机）。
 *
 * 需求 7 的硬约束也在这里：`analysis.generated === false` 时，
 * **任何**生成类按钮都不得显示为可用态，标题只说「请先分析本章资产」。
 */
export function deriveWorkbenchCommand(input: WorkbenchCommandInput): WorkbenchCommand {
  const counts = countSelected(input.items, input.selectedKeys)
  const analysis = input.analysis ?? null
  const analyzed = analysis ? analysis.generated === true : true
  const busy = input.busy === true

  const detail = [
    `已选 ${counts.selected}`,
    `待写提示词 ${counts.needsPrompt}`,
    `可生成图片 ${counts.generatable}`,
    `提示词需重写 ${counts.needsRegeneration}`,
    `生成中 ${counts.generating}`,
  ].join(' · ')

  if (!analyzed) {
    const hint = String(analysis?.hint ?? '').trim()
    return {
      title: '请先分析本章资产',
      detail,
      primaryLabel: '批量生成选中项',
      primaryAction: 'none',
      primaryDisabled: true,
      /* 审计 §4.5 模式 6（`workbenchState.ts:431` 的 `primaryDisabledReason: hint`）：
         主区这一句必须是**本文件自己写的中文状态机词**，不许是后端 `hint` 的改写结果
         （§7.1-8：`toUserFacingText(后端值)` 只允许当兜底 / 当折叠层原文）。
         后端 hint 原样另存 `primaryDisabledDetail`，由「技术详情」折叠区展示。 */
      primaryDisabledReason: '还没有分析过本章资产：先点「分析本章资产」。',
      primaryDisabledDetail: hint ? maskInternalIds(hint) : '',
      primaryHint: '',
      regenerateLabel: '批量重新生成已选项',
      regenerateDisabled: true,
      generateImagesLabel: '批量生成图',
      generateImagesDisabled: true,
      generateImagesDisabledReason: '还没有分析过本章资产：先点「分析本章资产」。',
      generateImagesHint: '',
      generateImagesCount: 0,
      counts,
    }
  }

  const title = (() => {
    if (counts.selected === 0) return '选择本轮要生产的人物、场景或道具'
    if (counts.needsPrompt > 0) return `${counts.needsPrompt} 项还没有图片提示词`
    if (counts.generatable > 0) return `本轮将处理 ${counts.generatable} 项资产`
    if (counts.generating > 0) return `${counts.generating} 项正在生成`
    if (counts.needsRegeneration > 0) return `${counts.needsRegeneration} 项提示词需要重新生成`
    if (counts.regeneratable > 0) return `所选资产都已有图片（${counts.regeneratable} 项可重新生成）`
    return '所选资产暂时没有可批量执行的项'
  })()

  /* 主按钮：待生成优先；否则说明为什么点不了（不撒谎、也不给假动作）。 */
  let primaryLabel = '批量生成选中项'
  let primaryDisabled = true
  let primaryDisabledReason = ''
  let primaryHint = ''
  // 主操作按"下一步真正能做的事"走：**先提示词，再图片**（资料 -> 提示词 -> 生成 -> 结果 -> 定版）
  let primaryAction: WorkbenchPrimaryAction = 'none'
  if (busy) {
    primaryLabel = '正在提交批量任务…'
    primaryDisabledReason = '本轮还在进行中；要中断后续请点「停止后续」。'
  } else if (counts.needsPrompt > 0) {
    primaryAction = 'generate_prompts'
    primaryLabel = `生成图片提示词（${counts.needsPrompt}）`
    primaryDisabled = false
    primaryHint = `会调用 ${counts.needsPrompt} 次文本模型（按次计费）；生成后请逐项检查再保存。`
  } else if (counts.generatable > 0) {
    primaryAction = 'generate_images'
    primaryLabel = `批量生成选中项（${counts.generatable}）`
    primaryDisabled = false
    primaryHint = `会为 ${counts.generatable} 项生成图片（按张计费，提交前还会再确认一次）。`
  } else if (counts.selected === 0) {
    primaryDisabledReason = '先勾选要生成的资产，或点「只选未生成项」。'
  } else if (counts.generating > 0) {
    primaryLabel = `批量生成中（${counts.generating}）`
    primaryDisabledReason = '选中的资产正在生成，等这一轮跑完再点。'
  } else if (counts.needsRegeneration > 0) {
    primaryAction = 'rewrite_prompts'
    primaryLabel = `重写图片提示词（${counts.needsRegeneration}）`
    primaryDisabled = false
    primaryHint = `这些提示词是旧规则下保存的或已过期；会调用 ${counts.needsRegeneration} 次文本模型（按次计费）。`
  } else {
    primaryDisabledReason = '选中的资产都已有图片：需要再出一张请用「批量重新生成已选项」。'
  }

  const regenerateDisabled = busy || counts.regeneratable === 0
  /* 「批量生成图」按钮：**常驻**，与「生成图片提示词」并排（需求清单第 2 条第 2 项）。
     它的口径与 `keysForRun('generate')` 完全一致 —— 只有"可进批量、还没有图片"的项
     才算数，所以按钮上的数字就是这次真的会出几张图。 */
  const generateImagesCount = counts.generatable
  const generateImagesDisabled = busy || generateImagesCount === 0
  const generateImagesDisabledReason = (() => {
    if (busy) return '本轮还在进行中；要中断后续请点「停止后续」。'
    if (counts.selected === 0) return '先勾选要生成图片的资产，或点「全选本页签」/「只选未生成项」。'
    if (counts.needsPrompt > 0 && counts.generatable === 0) {
      return '选中的资产还没有图片提示词：先点「生成图片提示词」，或换选已经有提示词的项。'
    }
    if (counts.generating > 0) return '选中的资产正在生成，等这一轮跑完再点。'
    return '所选资产都已有图片：需要再出一张请用「批量重新生成已选项」。'
  })()
  const generateImagesHint =
    generateImagesDisabled || generateImagesCount === 0
      ? ''
      : `会为 ${generateImagesCount} 项生成图片（按张计费，提交前还会再确认一次）。`

  return {
    title,
    primaryAction,
    detail,
    primaryLabel,
    primaryDisabled,
    primaryDisabledReason: primaryDisabled ? primaryDisabledReason : '',
    primaryDisabledDetail: '',
    // 可用时也给一句"点了会发生什么/花几次钱"（用户明确要求按钮旁就能看到）
    primaryHint: primaryDisabled ? '' : primaryHint,
    regenerateLabel:
      counts.regeneratable > 0 ? `批量重新生成已选项（${counts.regeneratable}）` : '批量重新生成已选项',
    regenerateDisabled,
    generateImagesLabel:
      generateImagesCount > 0 ? `批量生成图（${generateImagesCount}）` : '批量生成图',
    generateImagesDisabled,
    generateImagesDisabledReason: generateImagesDisabled ? generateImagesDisabledReason : '',
    generateImagesHint,
    generateImagesCount,
    counts,
  }
}

/* ---------------------------------------------------------------- 分析入口 */

export type AnalysisAction = {
  /** 按钮文案：没分析过 = 「分析本章资产」，否则 = 「重新分析本章资产」 */
  label: string
  /** 是不是主按钮 */
  primary: boolean
  /** 旁注（用户语言，来自 analysis.hint） */
  hint: string
  /** 本章内容变了 / 资料过期时的提醒（空串 = 没有提醒） */
  staleNotice: string
}

/**
 * 顶部「分析本章资产 / 重新分析本章资产」的文案与是否主按钮。
 *
 * 参考项目 `#scriptCommandBar` 的口径：唯一主操作区里"推荐的那一个"才是主按钮；
 * 这里"还没分析"→分析是主按钮，"已分析"→分析降级为次要按钮（主按钮让位给批量生成）。
 */
export function deriveAnalysisAction(analysis?: WorkbenchAnalysisLike | null): AnalysisAction {
  const data = analysis ?? null
  const generated = data?.generated === true
  const hint = String(data?.hint ?? '').trim()
  const contentChanged = data?.content_changed === true
  const status = String(data?.status ?? '')
  const stale = generated && (contentChanged || status === 'stale')
  return {
    label: generated ? '重新分析本章资产' : '分析本章资产',
    primary: !generated,
    hint,
    staleNotice: stale
      ? '本章剧本已经改过：重新分析只会更新资料，你手动改过的内容不会被覆盖。'
      : '',
  }
}

/* -------------------------------------------------- 「为什么做不了」的主区说法 */

/**
 * 「这一项为什么现在做不了」的**主区**说法 —— 按业务状态键给一句**本文件自己写的**中文结论。
 *
 * 审计 §4.5 模式 6（`AssetCardGrid.tsx:158` / `AssetDetailDrawer.tsx:63`）：
 * 改前把后端 `status.reason` 原文直接渲在卡片正面 / 抽屉顶部，
 * `assetWorkbenchContract.ts:249-250` 也只是 `toText(raw.reason)`（§7.3 的「未掩码路径」）。
 *
 * 按 §7.1-8，主区那一句必须是**产品自己写的句子**（或由枚举映射产出的名词），
 * 所以这里按**业务状态键**（本文件的状态机，不是后端自由文本）给结论；
 * 后端 `reason` 原文只进默认收起的「技术详情」（由调用方用统一折叠壳渲染）。
 *
 * 只在**确实有原因**时才显示（与改前的显示条件一致，不凭空多出一行）。
 */
export const WORKBENCH_STATUS_NOTICE: Record<WorkbenchStatusKey, string> = {
  needs_profile: '资料还没补齐：补齐后才能生成图片',
  needs_prompt: '还没有可用的图片提示词：先生成提示词再生成图片',
  ready: '这一项可以生成图片',
  generating: '这一项正在生成：等这一轮跑完再操作',
  failed: '上一次没有生成成功：可以重新生成图片',
  has_image: '已有图片待选择：采纳一张后再定版',
  primary: '这一项已经定版',
}

/** 状态原因对应的主区中文结论（没有原因时返回空串 = 整行不显示）。 */
export function workbenchStatusNotice(item: WorkbenchItemLike): string {
  if (!String(item.status?.reason ?? '').trim()) return ''
  return WORKBENCH_STATUS_NOTICE[workbenchStatusKey(item)]
}

/** 提示词需要重新生成时，卡片正面那一句**写死**的说明（后端 reasons 只进技术详情）。 */
export const WORKBENCH_PROMPT_REGENERATION_MAIN_TEXT =
  '这条提示词不足以出图：点「重新生成提示词」后再生成图片。'

/* -------------------------------------------------- 顶部「分析状态」的映射 */

/**
 * `analysis.status`（后端业务键）→ 用户语言。
 *
 * 审计 §4.5 模式 3 点名 `WorkbenchCommandBar.tsx:121`：
 * 改前直接 `{analysis.status_label}`，**没有任何枚举校验** ——
 * 后端回英文（`not_generated` / `ready` / `stale`）就原样印在主区。
 */
const WORKBENCH_ANALYSIS_STATUS_LABEL: Record<string, string> = {
  not_generated: '还没分析',
  generated: '资料已就绪',
  stale: '资料需要更新',
  running: '正在分析',
  failed: '分析失败',
}

/** 后端返回没登记的 `status` 时的中文兜底（绝不回显原值）。 */
export const WORKBENCH_ANALYSIS_STATUS_FALLBACK = '分析结果待确认'

/** 分析状态的中文标签（`analysis` 为空时返回空串 = 不渲染这个标签）。 */
export function workbenchAnalysisStatusLabel(analysis?: WorkbenchAnalysisLike | null): string {
  if (!analysis) return ''
  const key = String(analysis.status ?? '').trim()
  const mapped = WORKBENCH_ANALYSIS_STATUS_LABEL[key]
  if (mapped) return mapped
  /* 没登记的 status：后端 label 只有「含中文且不含机器码」才放行，
     否则一律中文兜底 —— 映射兜底**不许回显原值**（审计 §1.2 模式 3）。 */
  const fromServer = String(analysis.status_label ?? '').trim()
  if (isRenderableStatusLabel(fromServer)) return fromServer
  return WORKBENCH_ANALYSIS_STATUS_FALLBACK
}

/** 顶部「分析状态」那一行的**主区**固定中文句子（不随后端措辞漂移）。 */
export const WORKBENCH_ANALYSIS_HINT_MAIN_READY = '本章资料已分析完成，可以开始生产。'
export const WORKBENCH_ANALYSIS_HINT_MAIN_PENDING = '还没有分析过本章资产：先点「分析本章资产」。'

/** 主区那一句（产品自己写的句子，§7.1-8），后端 `hint` 只进「技术详情」。 */
export function workbenchAnalysisHintMainText(analysis?: WorkbenchAnalysisLike | null): string {
  if (!analysis) return ''
  return analysis.generated === true ? WORKBENCH_ANALYSIS_HINT_MAIN_READY : WORKBENCH_ANALYSIS_HINT_MAIN_PENDING
}

/* ----------------------------------------------------- 主界面禁词（用户点名） */

/**
 * 用户点名的**主页面禁词**：这些只允许出现在默认收起的「技术详情」里。
 *
 * 测试用它检查两处：① 纯函数产出的**全部静态文案**（标题 / 按钮 / 状态 / 计数标签）；
 * ② 主界面组件源码。带内部字段名的那个组件（`TechnicalDetailCollapse.tsx`）是唯一豁免文件。
 */
export const MAIN_SCREEN_FORBIDDEN_TERMS: readonly string[] = [
  '候选',
  '聚合',
  '检查中',
  '槽位',
  '项目内资产',
  '全局资产',
  '提示词质量未知',
  '最终提示词',
  '生成依据',
  '接口名',
  '供应商',
  '任务号',
  'file_id',
  '内部状态',
  'asset_id',
  'service_task_id',
  'source_task_id',
  'oss_url',
  'provider',
]

/**
 * **源码级**扫描用的子集。
 *
 * 为什么比上面短：契约里就带 `asset_id` / `oss_url` 这类字段名，
 * 主界面组件读它们（例如给卡片做 key）是正常的代码，不是给用户看的文案；
 * 而下面这些词在任何形式的用户可见文案里都不该出现，
 * 所以它们连注释与代码字符串都一并禁掉。
 */
export const MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS: readonly string[] = [
  '候选',
  '聚合',
  '检查中',
  '槽位',
  '项目内资产',
  '全局资产',
  '提示词质量未知',
  '最终提示词',
  '生成依据',
  '供应商',
  '任务号',
  'file_id',
]

/** 返回 `text` 命中的禁词（空数组 = 干净）。 */
export function findMainScreenForbiddenTerms(
  text: string,
  terms: readonly string[] = MAIN_SCREEN_FORBIDDEN_TERMS,
): string[] {
  const haystack = String(text ?? '')
  return terms.filter((term) => haystack.includes(term))
}

/* ------------------------------------------------------------ 待处理（复核） */

export type PendingReviewKind =
  | 'alias_conflict'
  | 'same_name_other_type'
  | 'multiple_candidates'
  | 'costume_without_asset'

export const PENDING_REVIEW_KIND_LABEL: Record<PendingReviewKind, string> = {
  alias_conflict: '名称对不上',
  same_name_other_type: '同名不同类型',
  multiple_candidates: '同一项有多个来源',
  costume_without_asset: '服装还没有对应资产',
}

/** 后端给了没登记的 kind 时也不显示英文枚举（退回"需要你确认"）。 */
export function describePendingReviewKind(kind: string): string {
  const key = String(kind ?? '') as PendingReviewKind
  return PENDING_REVIEW_KIND_LABEL[key] ?? '需要你确认'
}

/**
 * 待处理项**主区**那一句：按类型给一句本文件自己写死的中文结论。
 *
 * 审计 §4.5 模式 6（`PendingReviewDrawer.tsx:64`）改前直接渲后端 `row.reason`。
 * 按 §7.1-8，主区只放产品自己写的句子；后端原文（掩码后）由抽屉收进
 * 每行默认收起的「技术详情」，两边各有断言。
 */
export const PENDING_REVIEW_REASON_MAIN_TEXT: Record<PendingReviewKind, string> = {
  alias_conflict: '这一项的名称和已有资产对不上：请确认用哪个名字。',
  same_name_other_type: '有两个同名但类型不同的资产：请确认这一项到底是哪一类。',
  multiple_candidates: '这一项对上了多个来源：请确认保留哪一个。',
  costume_without_asset: '这套服装还没有对应的资产：请先建好资产再继续。',
}

export function pendingReviewReasonMainText(kind: string): string {
  const key = String(kind ?? '') as PendingReviewKind
  return PENDING_REVIEW_REASON_MAIN_TEXT[key] ?? '这一项需要你确认该怎么处理。'
}

/* -------------------------------------------------- 资产资料字段中文标签 */

/**
 * 后端字段表的**唯一事实来源**是 `assetProfileFields.ASSET_PROFILE_FIELD_SPECS`
 * （它由后端 `asset_profiles.py::PROFILE_FIELD_SPECS` 一条测试逐项比对，两边不许漂移）。
 *
 * 审计 §4.5 模式 2（`workbenchState.ts:622-647`）：这里原先**手抄**了一张映射表，
 * 结果与 spec 的键对不上 —— 14 个真实后端键（`relations` / `costume_accessories` /
 * `related_plot` / `shot_refs` / `era_location` / `indoor_outdoor` / `spatial_structure` /
 * `furnishings` / `light_tone` / `atmosphere` / `related_events` / `usage` /
 * `identity_era` / `accessories`）全部查不到标签。
 *
 * 修法按审计 §7.1-2「优先复用既有机制」：**消费**它，不再手抄第二份。
 * （`assetProfileFields.ts` 属区域 6 的可写范围，本批只 import、不编辑。）
 */
const WORKBENCH_PROFILE_FIELD_TYPES = ['character', 'scene', 'prop', 'costume'] as const

const PROFILE_FIELD_LABEL_FROM_SPECS: Record<string, string> = (() => {
  const out: Record<string, string> = {}
  WORKBENCH_PROFILE_FIELD_TYPES.forEach((type) => {
    ASSET_PROFILE_FIELD_SPECS[type].forEach((spec) => {
      // 先出现的类型优先：同一个键在不同类型下标签不同时（例如 `appearance`），
      // 保持「人物优先」的既有观感，不随类型顺序漂移。
      if (!(spec.key in out)) out[spec.key] = spec.label
    })
  })
  return out
})()

/**
 * 早期版本手抄过的**历史别名**。
 *
 * 这些键在 spec 里已经改名（`relation → relations`、`costume_style → costume_accessories`、
 * `space → spatial_structure`、`furnishing → furnishings`、`lighting → light_tone`、
 * `mood → atmosphere`、`accessory → accessories`），但老数据 / 老快照里仍可能出现。
 * 保留它们**不是**开口子：它们给出的仍是中文，去掉反而会让用户少看到一项资料（§3-6）。
 */
const PROFILE_FIELD_LABEL_LEGACY: Record<string, string> = {
  relation: '人物关系',
  costume_style: '服装配饰',
  space: '空间',
  furnishing: '陈设',
  lighting: '光线',
  mood: '氛围',
  accessory: '配饰',
}

/** 详情抽屉里按类型展示资料字段的中文标签（后端字段名不出现在主界面）。 */
export const PROFILE_FIELD_LABEL: Record<string, string> = {
  ...PROFILE_FIELD_LABEL_LEGACY,
  ...PROFILE_FIELD_LABEL_FROM_SPECS,
}

/**
 * 资料字段的中文标签。
 *
 * 未知字段**不许原样返回英文键**（审计 §8.4 点名的「反向锁死」测试就是这条）：
 * 这个函数的返回值是资产详情抽屉里 `Descriptions.Item` 的**标签**，
 * 也就是用户不展开任何折叠就能看见的**主区**，回退成 `custom_field` 这种英文键
 * 等于把后端字段名印在主区（模式 2）。所以未登记时给中文兜底。
 */
export function profileFieldLabel(key: string): string {
  return PROFILE_FIELD_LABEL[String(key ?? '')] ?? '其他资料项'
}

/**
 * 后端 spec 里有、但前端标签表查不到的键（空数组 = 已对齐）。
 *
 * 存在的意义：让护栏能**证明**「标签表与后端唯一事实来源同源」，
 * 而不是只断言某几个键碰巧查得到（审计 §4.5 要求这条对齐是机械可验证的）。
 */
export function profileFieldKeysMissingLabel(): string[] {
  const missing: string[] = []
  WORKBENCH_PROFILE_FIELD_TYPES.forEach((type) => {
    ASSET_PROFILE_FIELD_SPECS[type].forEach((spec) => {
      if (!PROFILE_FIELD_LABEL[spec.key]) missing.push(`${type}.${spec.key}`)
    })
  })
  return missing
}
