/**
 * 第 2 步「资产准备」→ **资产生产区**的纯逻辑（可单测）。
 *
 * 为什么单独抽一个模块：这一步的动作大多是"会花钱 / 会替换已有定版"的判断，
 * 判定必须可测、可复用，不能散在 JSX 里靠肉眼保证。这里只放纯函数与用户文案，
 * 不 import 任何 React / 网络模块，所以 `node --test` 能直接跑。
 *
 * 硬边界（用户点名，测试锁定）：
 *   A. 批量生成的默认勾选与默认提交范围**只包含没有图片的资产**，不覆盖已有图片/已有定版图；
 *   B. 对已有图片的资产「重新生成」、或把结果「设为定版」而该资产**已有定版**时，
 *      必须二次确认（写清会替换什么、会不会产生费用）。
 *
 * 文案口径（用户要求）：本模块产出的**每一句面向用户的文字**都不含内部字段
 * （`status` / `file_id` / 任务号 / 模型名 / 供应商名 / 「门禁」这类开发术语）。
 * `collectUserFacingTexts()` 把所有静态文案汇总出来，供测试做黑名单断言；
 * 后端回传的动态文本统一走三级管道展示：`maskInternalIds()`（去 ID）→
 * `sanitizeUserText()`（去内部术语）→ `humanizeBackendMessage()`（业务化改写），
 * 见 `components/userFacingMessage.ts`。
 */

// 带 `.ts` 后缀：本模块要能被 `node --test` 直接加载（Node ESM 不猜扩展名），
// tsconfig 已开 allowImportingTsExtensions，Vite 也照常解析。
// 阶段 B ①：不再只做 ID 掩码——掩码之后还要去内部术语 + 业务化改写
import { toUserFacingText } from '../../../components/userFacingMessage.ts'
import {
  BATCH_REFERENCE_FLOW_LABEL,
  IMAGE_ASSET_TYPE_ORDER,
  buildAspectRatioNotice,
  buildAspectRatioStatement,
  buildBatchActionLabel,
  buildBatchConfirmTitle,
  groupAssetsByType,
  isImageAssetType,
  resolveResultKind,
  resolveResultLabel,
  resultArtifactCopy,
  supportsBatchReference,
  BATCH_REFERENCE_ALLOWED_BY_ASSET_TYPE,
  CHARACTER_ONLY_RESULT_KIND,
  CHARACTER_REFERENCE_RATIO,
  RESULT_KIND_BY_ASSET_TYPE,
  RESULT_LABEL_BY_ASSET_TYPE,
  RESULT_NOUN_BY_ASSET_TYPE,
  type ImageAssetType,
} from './assetResultKind.ts'

/**
 * 单条失败的**主区兜底句**（审计 §6.3 表「单条结果」口径）。
 *
 * 三级管道都过不干净时用它 —— 宁可少说一句，也不把后端原文摆给用户看。
 */
export const FALLBACK_FAILURE_TEXT = '生成失败（图片没成功保存，暂时不能采纳）'

/* ------------------------------------------- 按资产类型的生产口径（用户点名要有） */

/**
 * 类型 → **图片提示词槽位**（= 生图实际读取的那一列 `image_prompts[<slot>]`）。
 *
 * 后端按 `asset_type` 分流到各自的提示词模板/尺寸/结果类型；前端这一侧至少要把
 * "读哪一列提示词"钉死，避免四类资产共用同一条提示词。
 */
export const PROMPT_SLOT_BY_ASSET_TYPE: Record<ProductionAssetType, string> = {
  character: 'character_image_front',
  scene: 'scene_image_front',
  prop: 'prop_image_front',
  costume: 'costume_image_front',
}

export type AssetTypeProductionSpec = {
  assetType: ProductionAssetType
  /** 类型名：人物 / 场景 / 道具 / 服装 */
  assetText: string
  /** 提示词槽位（`image_prompts` 的键） */
  promptSlot: string
  /** 机器可读结果类型（人物 = characterReference，其余各用各的） */
  resultKind: string
  /** 结果类型中文标签：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图 */
  resultLabel: string
  /** 按钮与确认框里的简称（只有人物叫「参考图」） */
  noun: string
  /** 该类型的默认出图比例（人物固定 16:9，其余跟随本次选择） */
  aspectRatio: string
  /** 比例是否**固定**（不跟随项目/镜头/用户选择） */
  aspectRatioFixed: boolean
  /** 「按定版图片批量出图」是否对该类型开放（只有人物） */
  batchReferenceAllowed: boolean
}

/**
 * 类型 → 生产口径（提示词槽位 / 结果类型 / 标签 / 尺寸）。
 *
 * 这是**唯一**的一份映射：卡片、列表、确认框、按钮文案都从这里取，
 * 避免出现"场景被标成人物参考图"这类错标。
 */
export function assetTypeProductionSpec(assetType: ProductionAssetType): AssetTypeProductionSpec {
  const copy = resultArtifactCopy(assetType)
  const fixed = assetType === 'character'
  return {
    assetType,
    assetText: copy.assetText,
    promptSlot: PROMPT_SLOT_BY_ASSET_TYPE[assetType],
    resultKind: RESULT_KIND_BY_ASSET_TYPE[assetType],
    resultLabel: RESULT_LABEL_BY_ASSET_TYPE[assetType],
    noun: RESULT_NOUN_BY_ASSET_TYPE[assetType],
    aspectRatio: fixed ? CHARACTER_REFERENCE_RATIO : '',
    aspectRatioFixed: fixed,
    batchReferenceAllowed: BATCH_REFERENCE_ALLOWED_BY_ASSET_TYPE[assetType],
  }
}

/** 全部四类的生产口径（按人物 / 场景 / 道具 / 服装顺序）。 */
export function assetTypeProductionSpecs(): AssetTypeProductionSpec[] {
  return ASSET_TYPE_ORDER.map((assetType) => assetTypeProductionSpec(assetType))
}

/**
 * 错标自检：**非人物**类型的结果类型/标签里一旦出现「参考图」或 `characterReference`，
 * 就把这条问题报出来（空数组 = 全部正确）。
 *
 * 对应硬要求：「场景 / 道具 / 服装绝不能被标成 characterReference」。
 */
export function collectTypeNamingProblems(
  specs: readonly AssetTypeProductionSpec[] = assetTypeProductionSpecs(),
): string[] {
  const problems: string[] = []
  specs.forEach((spec) => {
    if (spec.assetType === 'character') return
    const haystack = `${spec.resultKind} ${spec.resultLabel} ${spec.noun}`
    if (haystack.includes('参考图')) problems.push(`${spec.assetType}：标签里出现「参考图」（${spec.resultLabel}）`)
    if (haystack.includes(CHARACTER_ONLY_RESULT_KIND)) {
      problems.push(`${spec.assetType}：结果类型被标成 ${CHARACTER_ONLY_RESULT_KIND}`)
    }
    if (spec.batchReferenceAllowed) problems.push(`${spec.assetType}：不该开放「按定版图片批量出图」`)
  })
  return problems
}

/* ------------------------------------------------------------------ 基础口径 */

/**
 * 出图链路涉及的资产类型。
 *
 * 直接复用 `assetResultKind.ImageAssetType`（**同一个人物/场景/道具/服装口径**）：
 * 结果类型标签、画幅来源、按类型文案都从那里取，全前端只有一份分流表。
 */
export type ProductionAssetType = ImageAssetType

/** 分页签顺序：人物 / 场景 / 道具 / 服装。 */
export const ASSET_TYPE_ORDER: ProductionAssetType[] = ['character', 'scene', 'prop', 'costume']

/** 分页签标题（用户语言）。 */
export const ASSET_TYPE_LABEL: Record<ProductionAssetType, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
  costume: '服装',
}

/**
 * 现在**四类都能出图**（人物 / 场景 / 道具 / 服装）：
 *
 * - 人物 / 场景 / 道具 → 上游出图服务（它的契约只有这三类，改不了）；
 * - **服装 → Jellyfish 自己的 APIMart 图片通道**（服装设定图口径，不套用人物/场景模板）。
 *
 * 通道分流由后端按 `asset_type` 决定并如实回报（`channel` / `channel_label`），
 * 前端只需要"四类平权"地允许提交。历史上这里只允许三类、并让服装显示
 * 「暂不支持批量出图」—— 现在那条限制已经随服装链路补齐而移除。
 */
export const SUBMITTABLE_ASSET_TYPES: ProductionAssetType[] = ['character', 'scene', 'prop', 'costume']

export function isSubmittableAssetType(type: ProductionAssetType): boolean {
  return SUBMITTABLE_ASSET_TYPES.includes(type)
}

/**
 * 出图服务 V0 是「单资产单图」，一次只出一张 —— 这是对端契约，不是我们的选择。
 * 所以「张数」在界面上如实说明，不给一个点了没用的选项。
 */
export const IMAGES_PER_ASSET = 1

export type ProductionAsset = {
  /** `${type}:${id}`，全页面唯一的资产键 */
  key: string
  id: string
  type: ProductionAssetType
  name: string
  /** 已有图片（图片表里 `file_id` 非空） */
  hasImage: boolean
  /** 已设为定版 */
  hasPrimary: boolean
  /** 已保存图片提示词 */
  hasImagePrompt: boolean
  /** 当前首选图的行 ID（「设为定版」的默认目标）；null = 还没有图片 */
  imageId: number | null
  /** 现有图片地址（用于结果卡片旁边的对照） */
  thumbnail: string
  /** 还有待确认的提取候选 */
  hasPendingCandidate: boolean
}

export function assetKeyOf(type: ProductionAssetType, id: string): string {
  return `${type}:${id}`
}

/** 步骤信号里的资产 → 生产区资产（只做字段搬运，不改判定）。 */
export function toProductionAssets(
  assets: readonly {
    id: string
    name: string
    type: ProductionAssetType
    hasImage: boolean
    hasPrimary: boolean
    hasImagePrompt: boolean
    imageId: number | null
    thumbnail: string
    hasPendingCandidate: boolean
  }[],
): ProductionAsset[] {
  return assets.map((asset) => ({
    key: assetKeyOf(asset.type, asset.id),
    id: asset.id,
    type: asset.type,
    name: asset.name || asset.id,
    hasImage: asset.hasImage === true,
    hasPrimary: asset.hasPrimary === true,
    hasImagePrompt: asset.hasImagePrompt === true,
    imageId: typeof asset.imageId === 'number' ? asset.imageId : null,
    thumbnail: asset.thumbnail || '',
    hasPendingCandidate: asset.hasPendingCandidate === true,
  }))
}

/* -------------------------------------------------------------------- 选择 */

export type SelectionAction = 'all' | 'clear' | 'ungenerated'

/** 「未生成项」= 还没有任何图片的资产（**不含**已有图片但未定版的资产）。 */
export function isUngenerated(asset: ProductionAsset): boolean {
  return asset.hasImage !== true
}

/** 默认勾选范围：只选没有图片的资产（硬边界 A）。 */
export function selectUngenerated(assets: readonly ProductionAsset[]): string[] {
  return assets.filter(isUngenerated).map((asset) => asset.key)
}

/**
 * 工具条三个动作。
 *
 * `scopeType` = 当前分页签：全选 / 只选未生成 只作用在本分页签上，
 * 其它分页签的已选项**保留**（跨分页签累加，避免切页签把用户的选择清掉）。
 */
export function applySelectionAction(
  assets: readonly ProductionAsset[],
  current: readonly string[],
  action: SelectionAction,
  scopeType?: ProductionAssetType,
): string[] {
  const known = new Set(assets.map((asset) => asset.key))
  const kept = current.filter((key) => known.has(key))
  if (action === 'clear') return []
  const scope = scopeType ? assets.filter((asset) => asset.type === scopeType) : assets
  const scopeKeys =
    action === 'all' ? scope.map((asset) => asset.key) : scope.filter(isUngenerated).map((asset) => asset.key)
  const next = new Set(kept)
  scopeKeys.forEach((key) => next.add(key))
  return Array.from(next)
}

export type SelectionSummary = {
  /** 已选资产数 */
  total: number
  /** 人物 / 场景 / 道具 / 服装各多少项 */
  byType: Record<ProductionAssetType, number>
  /** 可提交给出图服务的资产数（排除服装） */
  submittableCount: number
  /** 选中的服装项数（出图服务不支持，提交前会明确告知并跳过） */
  unsupportedCount: number
  /** 预计生成的图片数量（每个可提交资产 1 张） */
  estimatedImages: number
  /** 其中已经**有图片**的项数（属于「重新生成」，会覆盖/新增结果，需二次确认） */
  withExistingImage: number
  /** 其中已经**有定版图**的项数（重新生成不会静默替换定版） */
  withExistingPrimary: number
  /** 其中还没有图片的项数（默认范围） */
  ungenerated: number
  /** 其中还没有图片提示词的项数（会退化为确定性模板拼装） */
  withoutPrompt: number
  /** 已选资产（按类型顺序稳定排序） */
  assets: ProductionAsset[]
}

function emptyByType(): Record<ProductionAssetType, number> {
  return { character: 0, scene: 0, prop: 0, costume: 0 }
}

/** 选择范围与预计张数（确认框里的每一个数字都来自这里，不另行估算）。 */
export function summarizeSelection(
  assets: readonly ProductionAsset[],
  selectedKeys: readonly string[],
): SelectionSummary {
  const selected = new Set(selectedKeys)
  const picked = assets.filter((asset) => selected.has(asset.key))
  const byType = emptyByType()
  picked.forEach((asset) => {
    byType[asset.type] += 1
  })
  const submittable = picked.filter((asset) => isSubmittableAssetType(asset.type))
  return {
    total: picked.length,
    byType,
    submittableCount: submittable.length,
    unsupportedCount: picked.length - submittable.length,
    estimatedImages: submittable.length * IMAGES_PER_ASSET,
    withExistingImage: submittable.filter((asset) => asset.hasImage).length,
    withExistingPrimary: submittable.filter((asset) => asset.hasPrimary).length,
    ungenerated: submittable.filter((asset) => !asset.hasImage).length,
    withoutPrompt: submittable.filter((asset) => !asset.hasImagePrompt).length,
    assets: picked,
  }
}

/* ---------------------------------------------------------------- 生成设置 */

export type GenerationSettings = {
  /** 画面比例 */
  aspectRatio: string
}

export const ASPECT_RATIO_OPTIONS = [
  { label: '16:9 横屏', value: '16:9' },
  { label: '9:16 竖屏', value: '9:16' },
  { label: '1:1 方形', value: '1:1' },
  { label: '4:3 横屏', value: '4:3' },
  { label: '3:4 竖屏', value: '3:4' },
] as const

export const DEFAULT_ASPECT_RATIO = '16:9'

/**
 * 提交给出图服务时**固定**使用的阶段值：`character_sheet` = 不把已有图片当输入传出去。
 *
 * 口径（用户 2026-09 拍板，最高优先级）：
 * 上游「人物及场景生产」的**真实模型就是"按提示词直接生成参考图"**
 * （其代码明写"人物直接生成 16:9 参考图模式：合并人物主图提示词与参考图布局，一次生成"，
 * 结果进参考图库，用户再从结果里挑一张设为人物主图/定版）。
 *
 * 所以 Jellyfish 的**默认主流程 = 生成参考图**：按（可编辑的）图片提示词直接生成，
 * 走的就是既有的 `POST /studio/image-pipeline/submit`（提交给上游服务端点），
 * 不需要新出口、也不需要上游把已有图片当输入再生成。
 *
 * 另有**可选返工流程**「使用已有参考图重新生成」（`regenerate_with_existing_reference`）：
 * 只有该资产**已有参考图**、且用户明确要保一致性时才用，走 Jellyfish 自己已验证的
 * APIMart 图片通道（把公网可用的参考图真的传进请求），**不是**上游服务端点。
 */
export const SUBMIT_STAGE: 'character_sheet' | 'reference_batch' = 'character_sheet'

/** 出图方式的**如实陈述**（默认主流程的原文口径，页面与确认框都用它）。 */
export const OUTPUT_MODE_STATEMENT = '出图方式：按提示词直接生成参考图（默认）'

/** 两条流程的**代码名分开**（不要合成一个含糊的 use_reference 开关）。 */
export type ProductionFlow = 'generate_reference_image' | 'regenerate_with_existing_reference'

export const FLOW_LABEL: Record<ProductionFlow, string> = {
  generate_reference_image: '生成参考图',
  regenerate_with_existing_reference: '使用已有参考图重新生成',
}

/** 默认主流程（批量与单项生成都用它）。 */
export const DEFAULT_FLOW: ProductionFlow = 'generate_reference_image'

/**
 * 「使用已有参考图重新生成」的前置条件：该资产**已经有参考图**。
 *
 * 没有参考图的资产根本谈不上"用已有参考图重新生成"，按钮就该是禁用的。
 */
export function canRegenerateWithExistingReference(asset: Pick<ProductionAsset, 'hasImage'> | undefined): boolean {
  return asset?.hasImage === true
}

/** 端点还没上线时的如实说明（前端必须优雅降级，不能假装可用）。 */
export const REFERENCE_REWORK_UNAVAILABLE_HINT =
  '这个能力还在接入中，暂时不能用；可以先点「重新生成参考图」。'

/** 默认生成设置：16:9（出图方式固定为"按提示词直接生成参考图"）。 */
export function defaultGenerationSettings(): GenerationSettings {
  return { aspectRatio: DEFAULT_ASPECT_RATIO }
}

/**
 * 设置的一句话说明（用户语言）。
 *
 * `assetType` 决定"生成的是什么图"：人物 = 参考图，场景/道具/服装 = 各自的资产图/设定图。
 * 不给类型时按人物（历史口径，旧调用方与测试不用改）。
 */
export function describeSettings(
  settings: GenerationSettings,
  assetType: ProductionAssetType = 'character',
): string {
  return [
    resultArtifactCopy(assetType).outputModeStatement,
    `画面比例 ${settings.aspectRatio}`,
    `每个资产 ${IMAGES_PER_ASSET} 张（出图服务一次只出一张）`,
  ].join('；')
}

/**
 * 该链路不支持某类型时的说明（按类型取词，**不让场景/道具出现「参考图」**）。
 *
 * 历史文案对所有类型都说「生成参考图」，服装/道具用户会以为是同一种图。
 */
export function supportHint(assetType: ProductionAssetType): string {
  return resultArtifactCopy(assetType).unsupportedHint
}

/** 按类型取的「一张结果」的按钮文案（生成参考图 / 生成场景资产图 …）。 */
export function generateActionLabel(assetType: ProductionAssetType, operation: BatchOperation = 'generate'): string {
  const copy = resultArtifactCopy(assetType)
  return operation === 'regenerate' ? copy.regenerateAction : copy.generateAction
}

/** 按类型取的返工入口文案（使用已有参考图重新生成 / 使用已有场景资产图重新生成）。 */
export function existingImageActionLabel(assetType: ProductionAssetType): string {
  return resultArtifactCopy(assetType).existingImageAction
}

/**
 * 端点还没上线时的如实说明（**按类型取词**：场景/道具不说「参考图」）。
 */
export function referenceReworkUnavailableHint(assetType: ProductionAssetType = 'character'): string {
  return `这个能力还在接入中，暂时不能用；可以先点「${resultArtifactCopy(assetType).regenerateAction}」。`
}

/** 「按定版图片批量出图」对该类型的如实说明（只有人物开放）。 */
export function batchReferenceHint(assetType: ProductionAssetType): string {
  return resultArtifactCopy(assetType).batchReferenceHint
}

/** 「批量生成 / 批量重新生成」按钮文案（按类型；混选时列出每个类型各多少项）。 */
export function batchActionLabel(
  assets: readonly Pick<ProductionAsset, 'type'>[],
  operation: BatchOperation,
): string {
  return buildBatchActionLabel(groupAssetsByType(assets), operation)
}

/** 「按定版图片批量出图」的按钮文案（只有人物开放）。 */
export function batchReferenceActionLabel(count: number): string {
  return `${BATCH_REFERENCE_FLOW_LABEL}（${count}）`
}

/** 该类型是否允许走「按定版图片批量出图」（只有人物，与后端同口径）。 */
export function canBatchWithReference(assetType: ProductionAssetType): boolean {
  return supportsBatchReference(assetType)
}

/* ------------------------------------------------------ 二次确认（硬边界 B） */

export type BatchOperation = 'generate' | 'regenerate'
export type RuntimeMode = 'dry_run' | 'real'

export const COST_WARNING_REAL =
  '当前是真实模式：确认后会把请求发给出图服务并真实出图，按张计费，会产生真实费用。'
export const COST_WARNING_DRY_RUN =
  '当前是演练模式：不会真的调用出图服务、不产生费用；返回的是占位结果，不能采纳进资产。'

export function operationLabel(operation: BatchOperation): string {
  return operation === 'regenerate' ? '重新生成' : '生成'
}

/** 已有图片的资产做「重新生成」时必须二次确认（硬边界 B）。 */
export function requiresRegenerateConfirmation(assets: readonly ProductionAsset[]): boolean {
  return assets.some((asset) => asset.hasImage)
}

export type ConfirmationPlan = {
  /** 是否需要弹二次确认 */
  required: boolean
  /** 是否被阻止（提交前就拦住，并说明原因） */
  blocked: boolean
  blockedReason: string
  title: string
  lines: string[]
  costWarning: string
  okText: string
  cancelText: string
}

export type BatchConfirmationInput = {
  scope: SelectionSummary
  settings: GenerationSettings
  mode: RuntimeMode
  operation: BatchOperation
  /** 项目自己的最终视频画幅（`projects.default_video_ratio`）：用来把「人物参考图固定 16:9」说清 */
  projectVideoRatio?: string | null
  /** 只读计划里的 `aspect_ratio_source`（命中人物固定口径时是 `character_reference_fixed`） */
  aspectRatioSource?: string | null
  /** 只读计划里的画幅值 */
  aspectRatioValue?: string | null
}

/**
 * 批量提交前的确认文案（要求 12）。
 *
 * 规则：
 * - **真实模式**一律二次确认（要花钱）；
 * - 批量（多于 1 项）一律二次确认（范围与张数要当面核对）；
 * - **重新生成**（选中项里有已有图片的资产）一律二次确认（硬边界 B）；
 * - 演练模式下单个未生成项的「生成」不弹框（不花钱、不覆盖任何东西）。
 *
 * 按类型分流（用户点名）：混选时**按 asset_type 分组**逐条写清"这一组会生成什么图"，
 * 场景 / 道具的结果**不叫参考图**；人物那组另外写出「人物参考图固定 16:9，不等于项目最终视频画幅」。
 */
export function buildBatchConfirmation(input: BatchConfirmationInput): ConfirmationPlan {
  const { scope, settings, mode, operation } = input
  const label = operationLabel(operation)
  const groups = groupAssetsByType(scope.assets.filter((asset) => isSubmittableAssetType(asset.type)))

  if (scope.submittableCount === 0) {
    return {
      required: false,
      blocked: true,
      blockedReason:
        scope.total === 0
          ? '还没有选择要生成的资产。'
          : '本次选中的资产里没有可以直接出图的类型：目前人物、场景、道具、服装都可以生成（服装走服装设定图口径）。',
      title: `无法${label}`,
      lines: [],
      costWarning: '',
      okText: '知道了',
      cancelText: '',
    }
  }

  const required =
    mode === 'real' ||
    scope.total > 1 ||
    operation === 'regenerate' ||
    scope.withExistingImage > 0

  const lines: string[] = [
    `本次选择资产 ${scope.total} 项：人物 ${scope.byType.character}、场景 ${scope.byType.scene}、道具 ${scope.byType.prop}、服装 ${scope.byType.costume}`,
    `本次可出图 ${scope.submittableCount} 项，预计生成图片 ${scope.estimatedImages} 张`,
  ]
  if (groups.length > 1) {
    lines.push('本次混选了多个类型，会「按类型分组」分几批提交')
  }
  groups.forEach((group) => {
    lines.push(
      `${group.copy.assetText} ${group.count} 项：${operationLabel(operation)}${group.copy.noun}` +
        `（结果类型：${group.copy.label}）`,
    )
  })
  // 「按定版图片批量出图」只对人物开放：非人物类型如实说明会被忽略，不静默按人物处理
  groups
    .filter((group) => !group.batchReferenceAllowed)
    .forEach((group) => lines.push(group.copy.batchReferenceHint))
  if (scope.unsupportedCount > 0) {
    lines.push(
      `服装 ${scope.unsupportedCount} 项本次不会提交：出图服务目前只接受人物、场景、道具，服装图片请在资产页手工上传或生成`,
    )
  }
  if (operation === 'regenerate' || scope.withExistingImage > 0) {
    lines.push(
      `其中已有图片的资产 ${scope.withExistingImage} 项会走「重新生成」：新结果会作为一张新图片保存，` +
        '不会自动替换现有图片，也不会动现有定版图（要换定版由你手动确认）',
    )
  }
  if (scope.withExistingPrimary > 0) {
    lines.push(`其中已有定版图的资产 ${scope.withExistingPrimary} 项：本次只新增结果，定版图保持不变`)
  }
  if (scope.ungenerated > 0) {
    lines.push(`其中还没有图片的资产 ${scope.ungenerated} 项会直接生成第一张结果图`)
  }
  // 出图方式如实陈述（按类型取词：人物 = 参考图，场景/道具 = 各自的资产图）
  lines.push(
    groups.length === 1
      ? describeSettings(settings, groups[0].assetType)
      : `出图方式：按提示词直接生成各自的图（${groups
          .map((group) => `${group.copy.assetText} = ${group.copy.label}`)
          .join('，')}）；画面比例 ${settings.aspectRatio}；每个资产 ${IMAGES_PER_ASSET} 张（出图服务一次只出一张）`,
  )
  // 人物参考图固定 16:9（≠ 项目最终视频画幅）：本次含人物时必须写在确认框里
  const ratioNotice = buildAspectRatioNotice({
    assetTypes: groups.map((group) => group.assetType),
    projectRatio: input.projectVideoRatio,
    source: input.aspectRatioSource,
    ratio: input.aspectRatioValue,
  })
  if (ratioNotice.applies) lines.push(ratioNotice.line)
  if (scope.withoutPrompt > 0) {
    lines.push(`其中 ${scope.withoutPrompt} 项还没有保存过图片提示词，本次会用资产描述拼装提示词`)
  }

  return {
    required,
    blocked: false,
    blockedReason: '',
    title: buildBatchConfirmTitle(groups, operation),
    lines,
    costWarning: mode === 'real' ? COST_WARNING_REAL : COST_WARNING_DRY_RUN,
    okText: mode === 'real' ? `确认真实生成（${scope.estimatedImages} 张）` : `确认生成（${scope.estimatedImages} 张）`,
    cancelText: '取消',
  }
}

/** 设为定版：该资产**已有定版**时必须二次确认（硬边界 B）。 */
export function requiresPrimaryReplaceConfirmation(asset: Pick<ProductionAsset, 'hasPrimary'> | undefined): boolean {
  return asset?.hasPrimary === true
}

export type ReferenceReworkConfirmation = {
  required: boolean
  title: string
  lines: string[]
  costWarning: string
  okText: string
  cancelText: string
}

/**
 * 「使用已有参考图重新生成」的二次确认文案（用户点名要）。
 *
 * 必须写清三件事：**用哪张图作为输入**、**会替换/新增什么**、**会不会产生费用**。
 * 这是可选返工流程：走 Jellyfish 自己的图片通道（参考图会真的进请求），与默认主流程无关。
 */
export function buildRegenerateWithReferenceConfirmation(args: {
  assetName: string
  /** 会用哪张图（可读名；具体地址只进「技术详情」） */
  referenceLabel: string
  mode: RuntimeMode
  /** 资产类型：决定"这张图叫什么"（人物 = 参考图；场景/道具/服装用各自的图名） */
  assetType?: ProductionAssetType
}): ReferenceReworkConfirmation {
  const copy = resultArtifactCopy(args.assetType ?? 'character')
  const lines = [
    `会把这张已有${copy.noun}（${args.referenceLabel}）作为输入传给图片模型`,
    `这一步是为了保持同一个${copy.assetText}的一致性；默认主流程「${copy.generateAction}」不依赖已有图片`,
    `新的结果会作为新的一张图片保存，不会替换现有${copy.noun}，也不会动现有定版图`,
    args.mode === 'real'
      ? '这张已有图片必须公网可访问：提交前会先探测可达性，取不到就不提交、也不产生费用'
      : '演练模式：不会真的把已有图片发出去，返回的是占位结果',
  ]
  return {
    required: true,
    title: `使用「${args.assetName}」已有的${copy.noun}重新生成一张？`,
    lines,
    costWarning:
      args.mode === 'real'
        ? '当前是真实模式：确认后会把已有图片真的传进请求并重新出图，按张计费，会产生真实费用。'
        : '当前是演练模式：不会真的调用图片模型、不产生费用；返回的是占位结果。',
    okText: args.mode === 'real' ? '确认真实生成（会产生费用）' : '确认重新生成',
    cancelText: '取消',
  }
}

export type PrimaryConfirmationPlan = {
  required: boolean
  title: string
  lines: string[]
  costWarning: string
}

/**
 * 「设为定版」的确认文案。
 *
 * 说实话：换定版本身**不产生出图费用**（只是改一个标识）。
 * 注意口径：默认主流程是"按提示词直接生成参考图"，定版图是资产对外确认使用的那张图；
 * 需要保一致性时走**可选返工流程**「使用已有参考图重新生成」（单独入口 + 二次确认）。
 */
export function buildPrimaryReplaceConfirmation(args: {
  assetName: string
  currentPrimaryNote?: string
  isFromGeneratedResult: boolean
}): PrimaryConfirmationPlan {
  return {
    required: true,
    title: `把这张设为「${args.assetName}」的定版图？`,
    lines: [
      args.currentPrimaryNote
        ? `该资产已有定版图（${args.currentPrimaryNote}），设为定版会替换掉它作为"定版"的身份`
        : '该资产已有定版图，设为定版会替换掉它作为"定版"的身份',
      '原图片不会被删除，仍在资产里，随时可以切回来',
      args.isFromGeneratedResult
        ? '这张是本次生成的结果，会先保存进该资产的图片再设为定版'
        : '这张来自该资产已有的图片',
      '定版图是该资产对外确认使用的那张图，后续环节以它为准',
      '需要保持同一人物/场景一致性时，用卡片上的「使用已有参考图重新生成」（会另行确认）',
    ],
    costWarning: '替换定版本身不产生出图费用；只有之后再点「生成」才会产生费用。',
  }
}

/* ---------------------------------------------------------- 在途闸门 / 幂等 */

export type SubmitGateReason = 'in_flight' | 'already_submitted_same_prompt'

export type SubmitGateDecision =
  | { allowed: true }
  | { allowed: false; reason: SubmitGateReason; message: string }

export type AssetSubmitGate = {
  /** 同一资产同一轮不得重复提交（防止连点重复付费） */
  begin: (assetKey: string) => SubmitGateDecision
  /** 提交返回后登记后端的幂等键（同资产 + 同提示词 = 同一把键） */
  finish: (assetKey: string, sourceTaskId: string) => void
  /** 释放在途标记（失败/异常时也要释放，否则该资产永远点不动） */
  release: (assetKey: string) => void
  /** 该资产的幂等键是否已经提交过（相同提示词 → 服务端会直接复用已有结果） */
  submittedKeys: () => string[]
  isInFlight: (assetKey: string) => boolean
}

/**
 * 在途闸门。
 *
 * 两层防重复：
 *  1. **本闸门**：同一资产在"提交中"期间再点一次会被拒绝（连点不重复付费）；
 *  2. **后端幂等键**（`build_source_task_id`：同项目 + 同资产 + 同提示词）：
 *     换一轮再提交同一提示词时，出图服务会直接返回已有任务，不再重复生成。
 *     所以这里记录已提交过的键，命中时如实提示用户"服务会复用已有结果"，
 *     而不是默默再发一次请求。
 */
export function createAssetSubmitGate(): AssetSubmitGate {
  const inFlight = new Set<string>()
  const submitted = new Set<string>()
  return {
    begin(assetKey: string): SubmitGateDecision {
      if (inFlight.has(assetKey)) {
        return {
          allowed: false,
          reason: 'in_flight',
          message: '这一项正在提交中，已忽略重复点击（不会重复生成）。',
        }
      }
      inFlight.add(assetKey)
      return { allowed: true }
    },
    finish(assetKey: string, sourceTaskId: string) {
      inFlight.delete(assetKey)
      const key = String(sourceTaskId || '').trim()
      if (key) submitted.add(key)
    },
    release(assetKey: string) {
      inFlight.delete(assetKey)
    },
    submittedKeys() {
      return Array.from(submitted)
    },
    isInFlight(assetKey: string) {
      return inFlight.has(assetKey)
    },
  }
}

/**
 * 同一提示词是否已经提交过（幂等键相同）。
 *
 * 命中时**不是拦死**，而是把话说清楚：出图服务会返回已有结果，
 * 想出一张新的图需要改提示词（界面上的「重新生成」会自动加一句变化要求）。
 */
export function findIdempotentReuse(
  submittedKeys: readonly string[],
  sourceTaskId: string,
): boolean {
  const key = String(sourceTaskId || '').trim()
  return Boolean(key) && submittedKeys.includes(key)
}

/**
 * 尝试序号上限（与后端 `ImageSubmitRequest.attempt` 的 0..99 对齐）。
 */
export const MAX_ATTEMPT = 99

/**
 * 本次尝试的序号（0 = 首轮）。
 *
 * 语义：**本次是第几次尝试**（0 基）＝ 这个资产之前已经尝试过几次。
 * 首轮必须是 0（这样与只读计划里回显的幂等键一致）；每提交一次就把计数 +1，
 * 于是重试 / 重新生成自然拿到新的序号 → 后端算出一个新的幂等键 → 真的再出一张。
 */
export function attemptForNextTry(previousAttempts: number): number {
  const previous = Number.isFinite(previousAttempts) ? Math.max(0, Math.floor(previousAttempts)) : 0
  return Math.min(MAX_ATTEMPT, previous)
}

export type AttemptPlan = {
  /** 本次要用的提示词（**原样**，不再往提示词里塞任何东西） */
  prompt: string
  /** 本次的尝试序号（0 = 首轮） */
  attempt: number
  /** 给用户看的一句话：这次到底会怎么生成 */
  note: string
  /** 是否是一次"再来一张"（attempt > 0） */
  isRetry: boolean
}

/**
 * 「重新生成 / 重试失败项」的提交参数。
 *
 * 为什么用尝试序号、而不是往提示词里加字：
 * 出图服务的幂等键是「项目 + 资产 + 提示词」（外加尝试序号）。
 * 同一提示词原样再提交只会拿回上一次的结果（失败的话连失败都不变），
 * 所以重试/重生成必须换一个键——后端为此提供了 `attempt`（序号混进哈希）。
 * 这样**提示词保持干净**，界面上展示的提示词与实际送出的完全一致。
 */
export function buildAttemptPlan(
  basePrompt: string,
  options: { hasEditedPrompt: boolean; previousAttempt: number },
): AttemptPlan {
  const base = String(basePrompt || '').trim()
  const attempt = attemptForNextTry(options.previousAttempt)
  if (!base) {
    return {
      prompt: '',
      attempt,
      note: '这一项还没有提示词，会按资产描述拼装提示词后再生成。',
      isRetry: attempt > 0,
    }
  }
  if (options.hasEditedPrompt) {
    return {
      prompt: base,
      attempt,
      note: '本次使用你在「编辑提示词」里改过的提示词（会作为一条新提示词提交）。',
      isRetry: attempt > 0,
    }
  }
  return {
    prompt: base,
    attempt,
    note:
      attempt > 0
        ? `这是第 ${attempt + 1} 次尝试：用同一条提示词再生成一张参考图（出图服务会为本次尝试分配新的任务，不会把上一次的结果直接还给你）。`
        : '这次会用上面这条提示词直接生成参考图；同一条提示词如果之前提交过，出图服务会复用已有结果。',
    isRetry: attempt > 0,
  }
}

/* -------------------------------------------------------------- 任务与进度 */

export type ProductionTaskStatus =
  | 'queued'
  | 'submitting'
  | 'generating'
  | 'done'
  | 'failed'
  | 'dry_run'
  | 'stopped'

export type ProductionTask = {
  /** 一张结果卡片一个键：`${assetKey}#${round}`（同一资产多轮即多张卡片） */
  key: string
  assetKey: string
  assetId: string
  assetType: ProductionAssetType
  assetName: string
  round: number
  /** 这一项走的是哪条流程（默认主流程 / 可选返工流程） */
  flow: ProductionFlow
  /** 这一项是第几次尝试（0 = 首轮）。重试/重新生成会 +1，后端据此换一个新的幂等键 */
  attempt: number
  operation: BatchOperation
  status: ProductionTaskStatus
  /** 后端幂等键（来自出图计划，前端不自己拼） */
  sourceTaskId: string
  /** 出图服务任务号（内部值，只进「技术详情」） */
  serviceTaskId: string
  /** 本次实际使用的提示词（用户可编辑，可见） */
  prompt: string
  /** 归一化口径（内部值，只进「技术详情」） */
  outcome: string
  /**
   * 结果类型标签（**消费后端回包**）：`characterReference` / `sceneAssetImage` /
   * `propAssetImage` / `costumeDesignImage`。卡片上的图片类型标签由它 + `resultLabel` 决定。
   */
  resultKind: string
  /** 结果类型的中文标签（后端 `result_label`）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图 */
  resultLabel: string
  /** 本次结果使用的画幅（人物参考图固定 16:9，**不是**项目最终视频画幅） */
  aspectRatio: string
  /** 画幅来源（`character_reference_fixed` = 命中人物固定口径） */
  aspectRatioSource: string
  ossUrl: string
  imageUrl: string
  /** 失败原因（已做内部标识屏蔽，可直接展示） */
  errorMessage: string
  /** 正常结果的说明（例如「结果暂存在出图服务本机，采纳后才会落到资产图片里」） */
  note: string
  /**
   * 本次提示词质量的**原始回包片段**（新字段，契约以后端实现为准）。
   *
   * 结果卡片用它判"这条提示词能不能用于出图"：后端给了结构化判定就以后端为准，
   * 没给就本地按「空 / 外观信息不足 / 只有名称+通用词 / 多个资产高度重复」自查。
   */
  promptQuality?: unknown
  /** 后端给的质量告警原文（作为"真实原因"展示；内部标识会先屏蔽） */
  promptWarnings?: string[]
  /**
   * 本次生成依据的**原始回包片段**（新字段）：默认收起的「生成依据」面板读它。
   *
   * 没有这个字段时面板如实显示「本次未提供生成依据」，绝不用资产名/类型顶上。
   */
  promptBasis?: unknown
  /** 采纳后落到资产图片槽位的地址与行 ID */
  adoptedUrl: string
  adoptedImageId: number | null
  /** 这张结果是否已被设为该资产的定版 */
  isPrimary: boolean
  createdAt: number
  updatedAt: number
}

export const TASK_STATUS_LABEL: Record<ProductionTaskStatus, string> = {
  queued: '待提交',
  submitting: '正在提交',
  generating: '正在生成',
  done: '已完成',
  failed: '生成失败',
  dry_run: '演练占位',
  stopped: '已停止',
}

export type TaskStatusTone = 'default' | 'blue' | 'green' | 'red' | 'gold'

export function describeTaskStatus(status: ProductionTaskStatus): { label: string; tone: TaskStatusTone } {
  const label = TASK_STATUS_LABEL[status] ?? TASK_STATUS_LABEL.failed
  const tone: TaskStatusTone =
    status === 'done' ? 'green' : status === 'failed' ? 'red' : status === 'dry_run' ? 'gold' : status === 'stopped' ? 'default' : 'blue'
  return { label, tone }
}

export type TaskProgressSummary = {
  total: number
  done: number
  failed: number
  generating: number
  queued: number
  stopped: number
  dryRun: number
  /** 已经跑完（含失败/停止/演练占位）的条数 */
  finished: number
  percent: number
  hasFailure: boolean
  failureReasons: string[]
}

/**
 * 进度数字（要求 7）。全部来自真实的任务状态，不估算、不编造：
 * 总数 / 已完成 / 失败 / 生成中 / 待提交 / 已停止 / 演练占位。
 *
 * 「待提交」而不是「排队中」：出图是**同进程内联执行**的（本机没有 broker/worker），
 * 不存在真正的队列，写"排队中"会让人以为后台有个 worker 在跑。
 */
export function summarizeTaskProgress(tasks: readonly ProductionTask[]): TaskProgressSummary {
  const counts = { done: 0, failed: 0, generating: 0, queued: 0, stopped: 0, dryRun: 0 }
  const reasons: string[] = []
  tasks.forEach((task) => {
    switch (task.status) {
      case 'done':
        counts.done += 1
        break
      case 'failed':
        counts.failed += 1
        // 审计 §4.2 模式 6：**收集时就脱敏**（与同文件 describeFailureReason 同一口径），
        // 否则 `failureReasons` 会在生产区顶部与结果卡片里直渲后端原文。
        if (task.errorMessage) reasons.push(toUserFacingText(task.errorMessage, FALLBACK_FAILURE_TEXT))
        break
      case 'generating':
      case 'submitting':
        counts.generating += 1
        break
      case 'queued':
        counts.queued += 1
        break
      case 'stopped':
        counts.stopped += 1
        break
      case 'dry_run':
        counts.dryRun += 1
        break
      default:
        break
    }
  })
  const total = tasks.length
  const finished = counts.done + counts.failed + counts.stopped + counts.dryRun
  return {
    total,
    ...counts,
    finished,
    percent: total === 0 ? 0 : Math.round((finished / total) * 100),
    hasFailure: counts.failed > 0,
    failureReasons: Array.from(new Set(reasons)).slice(0, 3),
  }
}

export type ProgressLine = { label: string; value: number; tone: TaskStatusTone }

/** 进度条上方的那排数字（用户语言）。 */
export function describeProgressLines(summary: TaskProgressSummary): ProgressLine[] {
  return [
    { label: '总数', value: summary.total, tone: 'default' },
    { label: '已完成', value: summary.done, tone: 'green' },
    { label: '生成中', value: summary.generating, tone: 'blue' },
    { label: '待提交', value: summary.queued, tone: 'blue' },
    { label: '失败', value: summary.failed, tone: summary.failed > 0 ? 'red' : 'default' },
    { label: '已停止', value: summary.stopped, tone: 'default' },
    { label: '演练占位', value: summary.dryRun, tone: 'gold' },
  ]
}

/**
 * 停止本轮：**只把"还没开始"的项标成已停止**。
 *
 * 已经完成的卡片、已经采纳/设为定版的结果一个都不动（要求 9）。
 * 正在跑的那一项也不动 —— 出图服务没有取消接口，这一张会跑完。
 */
export function applyStopToQueue(tasks: readonly ProductionTask[]): ProductionTask[] {
  return tasks.map((task) => (task.status === 'queued' ? { ...task, status: 'stopped' } : task))
}

/** 停止时给用户的一句话（写清"停的是什么、什么跑完"）。 */
export function describeStopEffect(summary: TaskProgressSummary): string {
  const parts = [`已停止后续：还没提交的 ${summary.queued} 项不会开始`]
  if (summary.generating > 0) parts.push(`正在生成的 ${summary.generating} 项会跑完，不能中途取消`)
  parts.push(`已完成的 ${summary.done} 项结果会保留`)
  return parts.join('；')
}

/** 本轮是否有还在跑的项（用于按钮态与轮询开关）。 */
export function hasUnsettledTasks(tasks: readonly ProductionTask[]): boolean {
  return tasks.some((task) => task.status === 'submitting' || task.status === 'generating' || task.status === 'queued')
}

/**
 * 结果卡片的展示顺序：**已停止的排在最后**，默认只展示最近的 `maxVisible` 张。
 *
 * 为什么要这样排：用户点「停止后续」之后，未开始的项会变成"已停止"。
 * 若按插入顺序展示，一堆"已停止"的占位卡片会把**已完成的结果**挤出可视区，
 * 看起来像"结果丢了"——而实际一条都没丢（进度数字里也照样能看到已完成数量）。
 */
export function orderCardsForDisplay(
  tasks: readonly ProductionTask[],
  options: { showAll: boolean; maxVisible: number },
): ProductionTask[] {
  const stopped = tasks.filter((task) => task.status === 'stopped')
  const active = tasks.filter((task) => task.status !== 'stopped')
  if (options.showAll) return [...active, ...stopped]
  const pool = active.length > 0 ? active : stopped
  const limit = Math.max(0, options.maxVisible)
  return pool.slice(Math.max(0, pool.length - limit))
}

/* -------------------------------------------------------- 结果 → 任务状态 */

export type SubmitResultLike = {
  source_task_id?: string
  source_asset_id?: string
  /** 结果所属资产类型（回包里就有；没有时由调用方按资产补） */
  asset_type?: string
  service_task_id?: string
  status?: string
  outcome?: string
  ok?: boolean
  dry_run?: boolean
  image_url?: string
  oss_url?: string
  oss_ready?: boolean
  message?: string
  error_message?: string
  /** 结果类型标签（新，后端按 asset_type 分流返回）：characterReference / sceneAssetImage / … */
  result_kind?: string
  /** 结果类型的中文标签（新）：人物参考图 / 场景资产图 / 道具资产图 / 服装设定图 */
  result_label?: string
  /** 本次结果的画幅（新）：人物参考图固定 16:9 */
  aspect_ratio?: string
  /** 画幅来源（新）：character_reference_fixed / request / default */
  aspect_ratio_source?: string
}

export type NormalizedResult = {
  status: ProductionTaskStatus
  outcome: string
  /** 面向用户的原因/说明（已屏蔽内部标识） */
  reason: string
  /** 是否已经拿到长期资产地址（OSS URL） */
  hasLongTermAddress: boolean
  serviceTaskId: string
  ossUrl: string
  imageUrl: string
  sourceTaskId: string
  /** 结果类型（后端回包优先，回包里没有时按资产类型兜底） */
  resultKind: string
  resultLabel: string
  aspectRatio: string
  aspectRatioSource: string
}

/** 演练占位地址的不可达域名（与后端 `adopt.PLACEHOLDER_URL_MARKERS` 同口径）。 */
export const PLACEHOLDER_URL_MARKERS = ['dry-run.invalid']

export function isPlaceholderUrl(url: string): boolean {
  const text = String(url || '')
  return PLACEHOLDER_URL_MARKERS.some((marker) => text.includes(marker))
}

/** 本机 / 内网地址（上游与浏览器都取不到的那种）。 */
const PRIVATE_HOST_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^0\.0\.0\.0$/,
  /^\[?::1\]?$/,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /\.local$/i,
]

/**
 * 是否是**公网可访问**的绝对地址。
 *
 * 为什么需要：出图服务的产物有两种形态 —— 已上传长期存储（可以当长期资产）
 * 和只存在出图服务本机（`http://localhost:4173/images/xxx.png`）。
 * 后者虽然也是 `http://` 开头，但**不是长期资产地址**，
 * 拿它去登记外链素材只会得到一张别人打不开的图。
 */
export function isPubliclyReachableUrl(url: string): boolean {
  const text = String(url || '').trim()
  if (!/^https?:\/\//i.test(text)) return false
  let host = ''
  try {
    host = new URL(text).hostname
  } catch {
    return false
  }
  if (!host) return false
  return !PRIVATE_HOST_PATTERNS.some((pattern) => pattern.test(host))
}

/** 失败原因：优先上游真话，其次按归一化口径给出可执行的说明；一律屏蔽内部标识。 */
export function describeFailureReason(result: Pick<SubmitResultLike, 'error_message' | 'message' | 'outcome'>): string {
  const text = String(result.error_message || result.message || '').trim()
  // 三级管道（§7.1-6）：① 去 ID → ② 去内部术语 → ③ 业务化改写 → 中文兜底
  if (text) return toUserFacingText(text, FALLBACK_FAILURE_TEXT)
  if (String(result.outcome || '') === 'partial_failed') {
    return '图片已经生成，但没有完成长期存储，因此暂时不可用；可以稍后刷新这一项，或重新生成。'
  }
  return '生成失败，但没有拿到具体原因；可在结果卡片上点「查看详情」核对。'
}

/**
 * 提交响应（单条结果）→ 任务状态。
 *
 * `assetType` 用来兜底结果类型标签：后端**已经**回了 `result_kind` / `result_label`（优先采用），
 * 但演练模式或老版本回包可能缺字段，缺字段时按资产类型取本类型的标签，
 * 绝不让场景 / 道具的结果被显示成「参考图」。
 */
export function resolveResultStatus(
  result: SubmitResultLike,
  assetType: ProductionAssetType = 'character',
): NormalizedResult {
  const outcome = String(result.outcome || '')
  const serviceTaskId = String(result.service_task_id || '')
  const ossUrl = String(result.oss_url || '')
  const imageUrl = String(result.image_url || '')
  const sourceTaskId = String(result.source_task_id || '')
  // 回包里的 asset_type 优先（同一批里可能出现不同类型），并做一次白名单校验
  const type: ProductionAssetType = isImageAssetType(result.asset_type) ? result.asset_type : assetType
  const base = {
    outcome,
    serviceTaskId,
    ossUrl,
    imageUrl,
    sourceTaskId,
    hasLongTermAddress: Boolean(ossUrl),
    resultKind: resolveResultKind(type, result.result_kind),
    resultLabel: resolveResultLabel(type, result.result_label, result.result_kind),
    aspectRatio: String(result.aspect_ratio || ''),
    aspectRatioSource: String(result.aspect_ratio_source || ''),
  }
  if (result.dry_run === true || outcome === 'dry_run') {
    return {
      ...base,
      status: 'dry_run',
      reason: '演练模式返回的是占位结果，没有真实生成图片；关闭演练模式并确认真实调用后才会真的出图。',
    }
  }
  if (outcome === 'failed' || outcome === 'partial_failed') {
    return { ...base, status: 'failed', reason: describeFailureReason(result) }
  }
  if (outcome === 'running' || outcome === 'unknown' || (!outcome && result.ok !== false && serviceTaskId)) {
    if (serviceTaskId) {
      return { ...base, status: 'generating', reason: '已提交给出图服务，正在生成；可以点「刷新进度」查看结果。' }
    }
    return {
      ...base,
      status: 'failed',
      reason: '出图服务没有返回可继续查询的任务，请在「查看详情」里核对该次响应。',
    }
  }
  if (ossUrl) {
    return { ...base, status: 'done', reason: '' }
  }
  if (imageUrl) {
    return {
      ...base,
      status: 'done',
      reason: '结果暂存在出图服务本机，采纳后才会落到资产图片里（长期地址）。',
    }
  }
  if (serviceTaskId) {
    return { ...base, status: 'generating', reason: '已提交给出图服务，正在生成；可以点「刷新进度」查看结果。' }
  }
  return { ...base, status: 'failed', reason: describeFailureReason(result) }
}

/* -------------------------------------------------------- 提交结果去重/挑选 */

export type SubmitResultRow = SubmitResultLike & { source_asset_id?: string }

/**
 * 一次提交返回多条结果时的**去重**。
 *
 * 为什么要去重：同一个资产在项目里有多个关联行时，后端组装出的提交目标会出现
 * **重复条目**（同一个资产、同一把幂等键）。它们各自是一次真实的后端调用，
 * 但出图服务按幂等键只会有一个任务，所以页面必须按幂等键合并，
 * 否则进度数字（总数/完成/失败）会被重复条目放大。
 */
export function dedupeResults<T extends SubmitResultRow>(results: readonly T[]): T[] {
  const byKey = new Map<string, T>()
  const order: string[] = []
  results.forEach((row, index) => {
    const key = String(row.source_task_id || '').trim() || `__row_${index}`
    const current = byKey.get(key)
    if (!current) {
      byKey.set(key, row)
      order.push(key)
      return
    }
    if (resultRank(row) > resultRank(current)) byKey.set(key, row)
  })
  return order.map((key) => byKey.get(key) as T)
}

/** 结果"信息量"排序：有长期地址 > 有结果地址 > 有任务号 > 其它。 */
function resultRank(row: SubmitResultRow): number {
  if (String(row.oss_url || '')) return 3
  if (String(row.image_url || '')) return 2
  if (String(row.service_task_id || '')) return 1
  return 0
}

/** 从一次提交的多条结果里挑出「某一个资产」的代表结果。 */
export function pickResultForAsset<T extends SubmitResultRow>(
  results: readonly T[],
  assetId: string,
): T | null {
  const deduped = dedupeResults(results)
  const own = deduped.filter((row) => String(row.source_asset_id || '') === assetId)
  const pool = own.length > 0 ? own : deduped
  if (pool.length === 0) return null
  return pool.reduce((best, row) => (resultRank(row) > resultRank(best) ? row : best), pool[0])
}

/** 查询任务（回读产物）→ 任务补丁。 */export function resolveTaskQueryPatch(query: {
  status?: string
  oss_url?: string
  local_path?: string
  error_message?: string
  dry_run?: boolean
  images?: Record<string, unknown>[]
}): Pick<ProductionTask, 'status' | 'ossUrl' | 'imageUrl' | 'errorMessage' | 'outcome'> | null {
  const rawStatus = String(query.status || '').trim().toLowerCase()
  const ossUrl = String(query.oss_url || '')
  const localPath = String(query.local_path || '')
  if (query.dry_run === true || rawStatus === 'dry_run') {
    return { status: 'dry_run', ossUrl: '', imageUrl: '', errorMessage: '', outcome: 'dry_run' }
  }
  if (rawStatus === 'succeeded' || rawStatus === 'success' || rawStatus === 'completed' || rawStatus === 'done') {
    return { status: 'done', ossUrl, imageUrl: localPath, errorMessage: '', outcome: 'ok' }
  }
  if (rawStatus === 'failed' || rawStatus === 'partial_failed' || rawStatus === 'error' || rawStatus === 'timeout') {
    return {
      status: 'failed',
      ossUrl,
      imageUrl: localPath,
      errorMessage: describeFailureReason({ error_message: query.error_message, outcome: rawStatus }),
      outcome: rawStatus,
    }
  }
  return { status: 'generating', ossUrl, imageUrl: localPath, errorMessage: '', outcome: rawStatus || 'running' }
}

/* ------------------------------------------------------------------ 采纳 */

export type AdoptionPlan =
  | { mode: 'adopt'; imageId: number | null; reason: string }
  | { mode: 'new_slot'; reason: string }
  | { mode: 'blocked'; reason: string }

/**
 * 「采纳」的落点决策（**不得静默替换现有定版图**）。
 *
 * 背景：采纳端点在不传目标槽位时会复用该资产的**第一行**图片槽位
 * （`is_primary` 也保持原样）。对已有图片的资产而言，那意味着悄悄把现有
 * 图片（很可能就是定版图）换掉。所以这里分三种情况：
 *
 * - 该资产还没有图片 → 直接采纳到（空）槽位，安全；
 * - 该资产已有图片，但存在空槽位 → 采纳到那个空槽位，不动任何现有图片；
 * - 该资产已有图片且没有空槽位 → 用"登记外链素材 + 新建图片槽位"的方式新增一张，
 *   绝不覆盖（这需要长期可访问的地址；只有本机地址时明确拦住并说明原因）。
 */
export function planAdoption(args: {
  asset: Pick<ProductionAsset, 'hasImage' | 'imageId' | 'name'>
  url: string
  emptySlotId: number | null
}): AdoptionPlan {
  const url = String(args.url || '').trim()
  if (!url) {
    return {
      mode: 'blocked',
      reason: '这次结果没有可用的图片地址（演练模式不会产生真实图片），暂时无法采纳。',
    }
  }
  if (isPlaceholderUrl(url)) {
    return {
      mode: 'blocked',
      reason: '这是演练模式返回的占位地址，不是真实图片，不能采纳进资产。',
    }
  }
  if (!args.asset.hasImage) {
    return {
      mode: 'adopt',
      imageId: args.asset.imageId ?? null,
      reason: '该资产还没有参考图，会用这张作为它的第一张参考图（不会成为定版，除非你单独确认）。',
    }
  }
  if (args.emptySlotId !== null) {
    return { mode: 'adopt', imageId: args.emptySlotId, reason: '该资产已有图片，新图会单独存一份，不动现有图片。' }
  }
  const isPublic = isPubliclyReachableUrl(url)
  if (!isPublic) {
    return {
      mode: 'blocked',
      reason:
        '该资产已经有图片，而这次结果只有出图服务本机地址；为避免覆盖现有图片，没有自动采纳。请到资产编辑页手工上传这张图。',
    }
  }
  return { mode: 'new_slot', reason: '该资产已有图片，会新增一张图片（现有图片与定版图都保持不变）。' }
}

/* ------------------------------------------------------------ 顶部状态文案 */

export type ProductionTone = TaskStatusTone

export type ProductionHeadline = {
  label: string
  tone: ProductionTone
  detail: string
}

export type ProductionHeadlineInput = {
  assets: readonly ProductionAsset[]
  progress: TaskProgressSummary
  /**
   * **已就绪**的资产数。
   *
   * 「就绪」的判定必须与步骤摘要（`assetPrepStatus.resolveAssetPrepStatus`）完全一致
   * （有提示词 + 有图片 + 已定版），否则会出现「本区说已定版、顶部摘要说未就绪」这种自相矛盾。
   */
  readyCount: number
}

/**
 * 本区顶部状态（要求 13）。只产出用户语言，取值只有这几种：
 * 可以开始提取 / 可以生成图片 / 正在生成 / 生成失败 / 已有图片，待设为定版 / 已定版。
 */
/** 一轮全是演练占位时的补充说明（标签不变，只在明细里把话说清楚）。 */
export const DRY_RUN_ROUND_NOTE =
  '本轮返回的是演练占位结果（没有真实出图）：演练模式下不能采纳、也不能设为定版。'

function withDryRunNote(detail: string, progress: TaskProgressSummary): string {
  if (progress.dryRun > 0 && progress.done === 0 && progress.failed === 0) {
    return `${detail}${DRY_RUN_ROUND_NOTE}`
  }
  return detail
}

export function resolveProductionHeadline(input: ProductionHeadlineInput): ProductionHeadline {
  const { assets, progress, readyCount } = input
  if (assets.length === 0) {
    return {
      label: '可以开始提取',
      tone: 'gold',
      detail: '项目里还没有人物 / 场景 / 道具 / 服装资产：先在上面把剧本里的角色/场景/道具/服装确认下来，再回来准备图片。',
    }
  }
  if (progress.generating > 0 || progress.queued > 0) {
    return {
      label: '正在生成',
      tone: 'blue',
      detail: `本轮共 ${progress.total} 项：正在生成 ${progress.generating} 项，待提交 ${progress.queued} 项，已完成 ${progress.done} 项。`,
    }
  }
  if (progress.failed > 0) {
    const reason = progress.failureReasons[0] || '失败原因未提供'
    return {
      label: '生成失败',
      tone: 'red',
      detail: `本轮有 ${progress.failed} 项生成失败：${reason}（可以在对应结果卡片上单独重试）`,
    }
  }
  const allReady = assets.length > 0 && readyCount === assets.length
  if (allReady) {
    return {
      label: '已定版',
      tone: 'green',
      detail: `全部 ${assets.length} 项资产都已定版，可以进入下一步（镜头视频提示词）。`,
    }
  }
  const hasImageNoPrimary = assets.some((asset) => asset.hasImage && !asset.hasPrimary)
  if (hasImageNoPrimary) {
    const count = assets.filter((asset) => asset.hasImage && !asset.hasPrimary).length
    return {
      label: '已有图片，待设为定版',
      tone: 'blue',
      detail: `有 ${count} 项资产已经有图片但还没定版：定版图是该资产对外确认使用的那张图，请挑一张设为定版。`,
    }
  }
  const ungenerated = assets.filter(isUngenerated).length
  if (ungenerated > 0) {
    return {
      label: '可以生成图片',
      tone: 'gold',
      detail: withDryRunNote(
        `还有 ${ungenerated} 项资产没有图片：默认只勾选未生成项，选好后点「批量生成选中项」。`,
        progress,
      ),
    }
  }
  const withoutPrompt = assets.filter((asset) => !asset.hasImagePrompt).length
  return {
    label: '可以生成图片',
    tone: 'gold',
    detail: withDryRunNote(
      withoutPrompt > 0
        ? `图片都已就绪，但还有 ${withoutPrompt} 项资产没有保存图片提示词：可以点「填提示词」或让大模型生成，再决定要不要重新生成。`
        : `图片与提示词都已就绪，但还有 ${assets.length - readyCount} 项资产没有定版：请挑一张满意的图设为定版。`,
      progress,
    ),
  }
}

/* -------------------------------------------------------- 内部标识黑名单自检 */

/**
 * 用户界面里**不允许出现**的内部标识（第三部分要求四）。
 * 只用于测试自检：任何面向用户的静态文案都不该命中它们。
 */
export const INTERNAL_TOKEN_BLACKLIST = [
  'file_id',
  'storage_key',
  'asset_id',
  'source_task_id',
  'service_task_id',
  'oss_url',
  'image_url',
  'status',
  'status:',
  'dry_run',
  'dry-run',
  'partial_failed',
  'queued',
  'running',
  'ready',
  // 模型名 / 供应商名一律不进主界面（用户点名）
  'gpt-image',
  'image2',
  'deepseek',
  'apimart',
  'provider',
  'celery',
  'build_source_task_id',
  '门禁',
]

/**
 * 主界面**不许出现**的误导说法。
 *
 * 口径（用户明确要求）：默认主流程就是「按提示词直接生成参考图」。所以：
 * - 主界面**不再出现上一版的错误说法**（那个词会让人以为要传输入图；文案黑名单测试里逐条钉住）；
 * - 也不许说「参考图不参与」「不使用参考图」这类把默认流程说反的话。
 */
export const MISLEADING_COPY_PATTERNS: RegExp[] = [
  /垫图/,
  /参考图不参与/,
  /不使用参考图/,
  /不接参考图/,
  /不接线参考图/,
  /图生图/,
]

/**
 * 文案里是否出现误导说法。
 *
 * 注意：这两条正则本身必须写出被禁的词（否则无从检查），
 * 所以「文案黑名单」源码扫描测试会把本文件里这几行**显式排除**。
 */
export function findMisleadingCopy(text: string): string[] {
  const raw = String(text ?? '')
  return MISLEADING_COPY_PATTERNS.filter((pattern) => pattern.test(raw)).map((pattern) => pattern.source)
}

/** 批量检查（测试与自检用）：返回所有含误导说法的文案。 */
export function collectMisleadingCopy(texts: readonly string[]): string[] {
  return texts.filter((text) => findMisleadingCopy(text).length > 0)
}

/**
 * 汇总本模块产出的所有静态用户文案（测试用）。
 *
 * 动态文案（后端错误原文）不在这里 —— 它们统一经三级管道处理（见 `describeFailureReason`）。
 */
export function collectUserFacingTexts(): string[] {
  const assets: ProductionAsset[] = [
    {
      key: 'character:a',
      id: 'a',
      type: 'character',
      name: '甲',
      hasImage: false,
      hasPrimary: false,
      hasImagePrompt: false,
      imageId: null,
      thumbnail: '',
      hasPendingCandidate: false,
    },
    {
      key: 'scene:b',
      id: 'b',
      type: 'scene',
      name: '乙',
      hasImage: true,
      hasPrimary: true,
      hasImagePrompt: true,
      imageId: 7,
      thumbnail: '/x.png',
      hasPendingCandidate: false,
    },
    {
      key: 'costume:c',
      id: 'c',
      type: 'costume',
      name: '丙',
      hasImage: true,
      hasPrimary: false,
      hasImagePrompt: true,
      imageId: 9,
      thumbnail: '/y.png',
      hasPendingCandidate: false,
    },
  ]
  const texts: string[] = [
    ...Object.values(ASSET_TYPE_LABEL),
    ...Object.values(TASK_STATUS_LABEL),
    ...Object.values(ASPECT_RATIO_OPTIONS).map((item) => item.label),
    describeSettings({ aspectRatio: DEFAULT_ASPECT_RATIO }),
    describeSettings({ aspectRatio: '9:16' }),
    OUTPUT_MODE_STATEMENT,
    COST_WARNING_REAL,
    COST_WARNING_DRY_RUN,
    operationLabel('generate'),
    operationLabel('regenerate'),
    TASK_STATUS_LABEL.queued,
  ]
  const scope = summarizeSelection(assets, assets.map((asset) => asset.key))
  const confirmation = buildBatchConfirmation({
    scope,
    settings: { aspectRatio: DEFAULT_ASPECT_RATIO },
    mode: 'real',
    operation: 'regenerate',
  })
  texts.push(confirmation.title, confirmation.costWarning, confirmation.okText, confirmation.cancelText, ...confirmation.lines)
  const dryConfirmation = buildBatchConfirmation({
    scope,
    settings: { aspectRatio: DEFAULT_ASPECT_RATIO },
    mode: 'dry_run',
    operation: 'generate',
  })
  texts.push(dryConfirmation.title, dryConfirmation.costWarning, dryConfirmation.okText, ...dryConfirmation.lines)
  const primary = buildPrimaryReplaceConfirmation({ assetName: '乙', isFromGeneratedResult: true })
  texts.push(primary.title, primary.costWarning, ...primary.lines)
  // 可选返工流程的确认文案（真实 / 演练两种模式）+ 降级说明 + 两条流程的名字
  ;([{ mode: 'real' }, { mode: 'dry_run' }] as const).forEach(({ mode }) => {
    const rework = buildRegenerateWithReferenceConfirmation({
      assetName: '乙',
      referenceLabel: '该资产的定版图',
      mode,
    })
    texts.push(rework.title, rework.costWarning, rework.okText, rework.cancelText, ...rework.lines)
  })
  texts.push(
    ...Object.values(FLOW_LABEL),
    REFERENCE_REWORK_UNAVAILABLE_HINT,
    ...Object.values(TASK_STATUS_LABEL),
  )

  // —— 按类型的结果类型文案（图片类型标签 / 按钮 / 确认框 / 画幅说明）——
  // 这些文案会被「场景/道具不得出现参考图」与「内部标识黑名单」两组测试逐个检查，
  // 所以必须全部登记进来，而不是只测手工挑的几句。
  IMAGE_ASSET_TYPE_ORDER.forEach((type) => {
    const copy = resultArtifactCopy(type)
    texts.push(
      copy.assetText,
      copy.label,
      copy.noun,
      copy.generateAction,
      copy.regenerateAction,
      copy.existingImageAction,
      copy.existingImageInputLabel,
      copy.outputModeStatement,
      copy.aspectRatioNote,
      copy.unsupportedHint,
      copy.batchReferenceHint,
      generateActionLabel(type, 'regenerate'),
      existingImageActionLabel(type),
      referenceReworkUnavailableHint(type),
      describeSettings({ aspectRatio: DEFAULT_ASPECT_RATIO }, type),
    )
  })
  texts.push(batchActionLabel(assets, 'generate'), batchActionLabel(assets, 'regenerate'))
  texts.push(
    buildAspectRatioStatement('16:9'),
    buildAspectRatioStatement('9:16'),
    buildAspectRatioStatement(''),
    buildRegenerateWithReferenceConfirmation({
      assetName: '乙',
      referenceLabel: '该资产当前的定版图片',
      mode: 'dry_run',
      assetType: 'scene',
    }).title,
  )

  // —— 顶部状态的每一种取值都要被覆盖（含"正在生成""生成失败"）——
  const ungeneratedOnly = assets.filter((asset) => !asset.hasImage)
  const progressCases: TaskProgressSummary[] = [
    summarizeTaskProgress([]),
    summarizeTaskProgress([makeSampleTask({ status: 'generating' })]),
    summarizeTaskProgress([makeSampleTask({ status: 'failed', errorMessage: '上游返回失败' })]),
  ]
  const assetCases: ProductionAsset[][] = [[], ungeneratedOnly, assets]
  const primaryCountCases = [0, 1, 3]
  assetCases.forEach((assetCase) => {
    progressCases.forEach((progress) => {
      primaryCountCases.forEach((readyCount) => {
        const headline = resolveProductionHeadline({ assets: assetCase, progress, readyCount })
        texts.push(headline.label, headline.detail)
      })
    })
  })

  texts.push(
    ...describeProgressLines(summarizeTaskProgress([])).map((line) => line.label),
    describeStopEffect(summarizeTaskProgress([makeSampleTask({ status: 'generating' })])),
    ...['queued', 'submitting', 'generating', 'done', 'failed', 'dry_run', 'stopped'].map(
      (status) => describeTaskStatus(status as ProductionTaskStatus).label,
    ),
    // 失败原因的兜底文案（不带后端原文的那两条分支）
    describeFailureReason({ outcome: 'partial_failed' }),
    describeFailureReason({ outcome: 'failed' }),
    // 「重新生成」的提示词说明
    buildAttemptPlan('甲：正面全身参考图', { hasEditedPrompt: false, previousAttempt: 0 }).note,
    buildAttemptPlan('甲：正面全身参考图', { hasEditedPrompt: true, previousAttempt: 0 }).note,
    buildAttemptPlan('', { hasEditedPrompt: false, previousAttempt: 0 }).note,
    // 采纳的三个分支说明
    planAdoption({ asset: assets[0], url: '', emptySlotId: null }).reason ?? '',
  )
  return texts.filter((text) => typeof text === 'string' && text.length > 0)
}

/** 造一条样例任务（仅测试与文案自检用）。 */
export function makeSampleTask(patch: Partial<ProductionTask> = {}): ProductionTask {
  const assetType = (patch.assetType ?? 'character') as ProductionAssetType
  return {
    key: 'character:a#1',
    assetKey: 'character:a',
    assetId: 'a',
    assetType,
    assetName: '甲',
    round: 1,
    flow: DEFAULT_FLOW,
    attempt: 0,
    operation: 'generate',
    status: 'queued',
    sourceTaskId: '',
    serviceTaskId: '',
    prompt: '',
    outcome: '',
    resultKind: resolveResultKind(assetType, patch.resultKind),
    resultLabel: resolveResultLabel(assetType, patch.resultLabel, patch.resultKind),
    aspectRatio: patch.aspectRatio ?? '',
    aspectRatioSource: patch.aspectRatioSource ?? '',
    ossUrl: '',
    imageUrl: '',
    errorMessage: '',
    note: '',
    adoptedUrl: '',
    adoptedImageId: null,
    isPrimary: false,
    createdAt: 0,
    updatedAt: 0,
    ...patch,
  }
}
