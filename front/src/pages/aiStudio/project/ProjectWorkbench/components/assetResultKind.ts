/**
 * 按 `asset_type` 分流的**结果类型口径**（前端唯一的一份，纯函数、可单测）。
 *
 * 为什么要有这个模块：
 * 后端 `image-pipeline/submit` 与 `reference-regenerate` 的回包**早就带了**
 * `result_kind` / `result_label` / `aspect_ratio_source`（见
 * `backend/app/services/studio/image_pipeline/asset_strategies.py`：人物 → `characterReference`
 * ／「人物参考图」；场景 → `sceneAssetImage`／「场景资产图」；道具 → `propAssetImage`／「道具资产图」；
 * 服装 → `costumeDesignImage`／「服装设定图」），但前端以前**一个字段都没消费**，
 * 于是页面上所有类型都被说成「参考图」，场景与道具的结果卡片也没有图片类型标签。
 *
 * 硬口径（用户点名，测试锁定）：
 *   1. **消费回包**：`result_kind` / `result_label` 优先，回包里没有时按本表兜底（按类型取，不猜成「参考图」）；
 *   2. **`characterReference` 是人物专用**：别的类型拿到这个值一律**忽略**并退回本类型的标签
 *      （后端有测试钉住不许发生，前端也不能把错标签画到卡片上）；
 *   3. **场景 / 道具 / 服装的用户可见文案里不出现「参考图」字样**：它们的图叫
 *      场景资产图 / 道具资产图 / 服装设定图；
 *   4. **「按定版图片批量出图」只对人物开放**（`batchReferenceAllowed`，与后端
 *      `batch_reference_allowed` 同口径）：场景 / 道具 / 服装走这条路时**明确说明会被忽略**，
 *      不静默按人物处理；
 *   5. **人物参考图固定 16:9，不等于项目最终视频画幅**（见 `buildAspectRatioNotice`）：
 *      这是人物参考图（设定图）的出图口径，项目 `default_video_ratio` 是成片口径，两者不能混用。
 */

/** 出图链路涉及的资产类型（与后端 `SUPPORTED_ASSET_TYPES` 同集合）。 */
export type ImageAssetType = 'character' | 'scene' | 'prop' | 'costume'

export const IMAGE_ASSET_TYPE_ORDER: ImageAssetType[] = ['character', 'scene', 'prop', 'costume']

/**
 * 类型的中文名。
 *
 * 与 `assetProduction.ASSET_TYPE_LABEL` **必须逐字相同**（有单测钉住），
 * 这里单独放一份只是为了让本模块能同时被资产编辑页（`assets/**`）直接引用，
 * 不必把整个生产区模块拖进去。
 */
export const IMAGE_ASSET_TYPE_TEXT: Record<ImageAssetType, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
  costume: '服装',
}

/** 后端按类型分流出的**机器可读**结果类型标签。 */
export const RESULT_KIND_BY_ASSET_TYPE: Record<ImageAssetType, string> = {
  character: 'characterReference',
  scene: 'sceneAssetImage',
  prop: 'propAssetImage',
  costume: 'costumeDesignImage',
}

/** 各类型标签的底色（卡片 / 分组标签用；人物用紫色，与"资产类型"标签区分）。 */
export const RESULT_TONE_BY_ASSET_TYPE: Record<ImageAssetType, 'purple' | 'blue' | 'gold' | 'cyan'> = {
  character: 'purple',
  scene: 'blue',
  prop: 'gold',
  costume: 'cyan',
}

/** 结果类型的中文标签（= 后端 `result_label`）。 */
export const RESULT_LABEL_BY_ASSET_TYPE: Record<ImageAssetType, string> = {
  character: '人物参考图',
  scene: '场景资产图',
  prop: '道具资产图',
  costume: '服装设定图',
}

/**
 * 各类结果在**按钮 / 确认框**里的简称。
 *
 * 只有人物叫「参考图」；场景 / 道具 / 服装各用自己的图名 ——
 * 这就是「不得让场景 / 道具出现参考图字样」这条要求的落点。
 */
export const RESULT_NOUN_BY_ASSET_TYPE: Record<ImageAssetType, string> = {
  character: '参考图',
  scene: '场景资产图',
  prop: '道具资产图',
  costume: '服装设定图',
}

/** 人物专用标签：别的类型一律不许用它（后端与前端各有测试钉住）。 */
export const CHARACTER_ONLY_RESULT_KIND = 'characterReference'

/** 「按定版图片批量出图」（旧文案里的「参考图批量」）**只对人物开放**。 */
export const BATCH_REFERENCE_ALLOWED_BY_ASSET_TYPE: Record<ImageAssetType, boolean> = {
  character: true,
  scene: false,
  prop: false,
  costume: false,
}

/**
 * 这条链路的名字。
 *
 * 刻意选了一个**任何类型都能用**的说法：「按定版图片批量出图」——
 * 既不使用上一版的错误词（那会让人以为要传输入图），也不写成「参考图批量」
 * （那会让场景 / 道具被说成人物参考图）。
 */
export const BATCH_REFERENCE_FLOW_LABEL = '按定版图片批量出图'

export function isImageAssetType(value: unknown): value is ImageAssetType {
  return typeof value === 'string' && (IMAGE_ASSET_TYPE_ORDER as readonly string[]).includes(value)
}

export function isCharacterOnlyResultKind(kind: unknown): boolean {
  return String(kind ?? '').trim() === CHARACTER_ONLY_RESULT_KIND
}

/** 该类型是否允许「按定版图片批量出图」（只有人物 True，与后端同口径）。 */
export function supportsBatchReference(assetType: ImageAssetType): boolean {
  return BATCH_REFERENCE_ALLOWED_BY_ASSET_TYPE[assetType] === true
}

/**
 * 结果类型的**机器可读**标签：优先用后端回包，其次按类型兜底。
 *
 * 防御：`characterReference` 是人物专用 —— 场景 / 道具 / 服装即使拿到这个值也**不采用**，
 * 一律退回本类型的标签。否则卡片上会出现「场景 = 人物参考图」这种自相矛盾的标签。
 */
export function resolveResultKind(assetType: ImageAssetType, serverKind?: unknown): string {
  const server = String(serverKind ?? '').trim()
  if (!server) return RESULT_KIND_BY_ASSET_TYPE[assetType]
  if (assetType !== 'character' && isCharacterOnlyResultKind(server)) {
    return RESULT_KIND_BY_ASSET_TYPE[assetType]
  }
  return server
}

/**
 * 后端回包的标签能不能直接上卡片。
 *
 * 审计 §4.5 模式 3（`assetResultKind.ts:146` 的 `return server`）：
 * 改前后端只要回一个前端不认识的 `result_label`（英文枚举原值 / `scene_asset_image`
 * 这种机器码），就会**原样印在结果卡片的「图片类型」标签上**。
 *
 * 判据：登记过的中文标签放行；**含中文且不含机器码**的新标签也放行（后端加新中文说法不用改前端）；
 * 其余（英文 / 下划线机器码 / 空）一律退回本类型的兜底标签。
 */
const KNOWN_RESULT_LABELS: readonly string[] = Object.values(RESULT_LABEL_BY_ASSET_TYPE)

export function isRenderableResultLabel(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (KNOWN_RESULT_LABELS.includes(text)) return true
  if (!/[\u4e00-\u9fff]/.test(text)) return false
  return !/(?<![A-Za-z0-9_])[a-z]+(?:_[a-z]+){1,}(?![A-Za-z0-9_])/.test(text)
}

/**
 * 结果类型的中文标签（卡片上的「图片类型」标签）：优先用后端回包 `result_label`。
 *
 * 同样对人物专用标签做防御：非人物类型不许显示「人物参考图」。
 * 另外按审计 §4.5 的建议口径：**不认识的 label 退回本类型的兜底标签**，不回显后端原值。
 */
export function resolveResultLabel(
  assetType: ImageAssetType,
  serverLabel?: unknown,
  serverKind?: unknown,
): string {
  if (assetType !== 'character' && isCharacterOnlyResultKind(serverKind)) {
    return RESULT_LABEL_BY_ASSET_TYPE[assetType]
  }
  const server = String(serverLabel ?? '').trim()
  if (!server) return RESULT_LABEL_BY_ASSET_TYPE[assetType]
  if (assetType !== 'character' && server.includes('人物参考图')) {
    return RESULT_LABEL_BY_ASSET_TYPE[assetType]
  }
  if (!isRenderableResultLabel(server)) return RESULT_LABEL_BY_ASSET_TYPE[assetType]
  return server
}

/* ------------------------------------------------------------------ 卡片标签 */

export type ResultKindTag = {
  /** 机器可读标签（只进技术详情） */
  kind: string
  /** 卡片上显示的中文标签 */
  label: string
  /** 标签底色（人物用紫色，与资产类型标签区分） */
  tone: 'purple' | 'blue' | 'gold' | 'cyan'
  /** 是否用的是后端回包的值（否则是本地按类型兜底） */
  fromServer: boolean
}

/** 结果卡片上的**图片类型标签**（消费回包的 `result_kind` / `result_label`）。 */
export function buildResultKindTag(
  assetType: ImageAssetType,
  server?: { resultKind?: unknown; resultLabel?: unknown },
): ResultKindTag {
  const fromServer = Boolean(String(server?.resultKind ?? '').trim() || String(server?.resultLabel ?? '').trim())
  return {
    kind: resolveResultKind(assetType, server?.resultKind),
    label: resolveResultLabel(assetType, server?.resultLabel, server?.resultKind),
    tone: RESULT_TONE_BY_ASSET_TYPE[assetType],
    fromServer,
  }
}

/* --------------------------------------------------------------- 文案（按类型） */

export type ResultArtifactCopy = {
  assetType: ImageAssetType
  /** 类型名：人物 / 场景 / 道具 / 服装 */
  assetText: string
  /** 机器可读结果类型 */
  kind: string
  /** 图片类型标签：人物参考图 / 场景资产图 / … */
  label: string
  /** 标签底色（分组标签与卡片一致） */
  tone: 'purple' | 'blue' | 'gold' | 'cyan'
  /** 按钮与确认框里的简称：参考图 / 场景资产图 / … */
  noun: string
  /** 「按定版图片批量出图」是否对该类型开放（只有人物） */
  batchReferenceAllowed: boolean
  /** 生成一张：生成参考图 / 生成场景资产图 */
  generateAction: string
  /** 再生成一张：重新生成参考图 / 重新生成场景资产图 */
  regenerateAction: string
  /** 用已有图片返工：使用已有参考图重新生成 / 使用已有场景资产图重新生成 */
  existingImageAction: string
  /** 返工输入的可读名：作为输入的参考图 / 作为输入的场景资产图 */
  existingImageInputLabel: string
  /** 出图方式的一句话（按类型，不把场景/道具说成参考图） */
  outputModeStatement: string
  /** 人物专属：固定画幅的提示（其它类型为空串） */
  aspectRatioNote: string
  /** 该类型不能走默认出图链路时的说明（含服装） */
  unsupportedHint: string
  /** 「按定版图片批量出图」对该类型的如实说明 */
  batchReferenceHint: string
}

/** 默认出图链路支持的类型（与后端 `SERVICE_ASSET_TYPES` 同集合）。 */
export const SUBMITTABLE_IMAGE_ASSET_TYPES: ImageAssetType[] = ['character', 'scene', 'prop']

export function isSubmittableImageAssetType(assetType: ImageAssetType): boolean {
  return SUBMITTABLE_IMAGE_ASSET_TYPES.includes(assetType)
}

export function resultArtifactCopy(
  assetType: ImageAssetType,
  server?: { resultKind?: unknown; resultLabel?: unknown },
): ResultArtifactCopy {
  const kind = resolveResultKind(assetType, server?.resultKind)
  const label = resolveResultLabel(assetType, server?.resultLabel, server?.resultKind)
  const noun = RESULT_NOUN_BY_ASSET_TYPE[assetType]
  const assetText = IMAGE_ASSET_TYPE_TEXT[assetType]
  const submittable = isSubmittableImageAssetType(assetType)
  const batchReferenceAllowed = supportsBatchReference(assetType)
  return {
    assetType,
    assetText,
    kind,
    label,
    tone: RESULT_TONE_BY_ASSET_TYPE[assetType],
    noun,
    batchReferenceAllowed,
    generateAction: `生成${noun}`,
    regenerateAction: `重新生成${noun}`,
    existingImageAction: `使用已有${noun}重新生成`,
    existingImageInputLabel: `作为输入的${noun}`,
    outputModeStatement: `出图方式：按提示词直接生成${noun}（默认）`,
    aspectRatioNote: assetType === 'character' ? CHARACTER_REFERENCE_FIXED_STATEMENT : '',
    unsupportedHint: submittable
      ? `按提示词直接生成图片这条链路目前只支持人物、场景、道具；${assetText}可以到「项目工作台 → 第 2 步 资产准备」里生成。`
      : '按提示词直接生成图片这条链路目前只支持人物、场景、道具；服装可以先把已有图片设为定版，或到资产页手工上传。',
    batchReferenceHint: batchReferenceAllowed
      ? `${BATCH_REFERENCE_FLOW_LABEL}会对人物开放：会把该人物当前的定版图片作为输入一起发出去。`
      : `${BATCH_REFERENCE_FLOW_LABEL}只对人物开放；${noun}按提示词直接生成，本次不会带上已有图片（不会按人物口径处理）。`,
  }
}

/* ------------------------------------------------------------- 按类型分组提交 */

export type AssetTypeGroup<T> = {
  assetType: ImageAssetType
  /** 分组标题：人物 3 项（人物参考图） */
  title: string
  count: number
  items: T[]
  copy: ResultArtifactCopy
  /** 「按定版图片批量出图」是否对该组开放（只有人物 True，与后端同口径） */
  batchReferenceAllowed: boolean
}

/**
 * 把选中的资产**按 asset_type 分组**（顺序固定：人物 → 场景 → 道具 → 服装）。
 *
 * 为什么必须分组：出图提交接口一次只接受**一个** asset_type，混选时把不同类型当成同一批
 * 同一个口径提交，会让场景 / 道具的结果被说成「参考图」，也会让确认框里的张数与类型对不上。
 */
export function groupAssetsByType<T extends { type: string }>(assets: readonly T[]): AssetTypeGroup<T>[] {
  return IMAGE_ASSET_TYPE_ORDER.map((assetType) => {
    const items = assets.filter((asset) => asset.type === assetType)
    return {
      assetType,
      items,
      count: items.length,
      copy: resultArtifactCopy(assetType),
      batchReferenceAllowed: supportsBatchReference(assetType),
      title: `${IMAGE_ASSET_TYPE_TEXT[assetType]} ${items.length} 项（${RESULT_LABEL_BY_ASSET_TYPE[assetType]}）`,
    }
  }).filter((group) => group.count > 0)
}

/** 一行把每个类型各多少项说清楚（确认框与按钮共用）。 */
export function describeGroupBreakdown(groups: readonly AssetTypeGroup<unknown>[]): string {
  return groups.map((group) => `${RESULT_LABEL_BY_ASSET_TYPE[group.assetType]} ${group.count}`).join(' / ')
}

/** 只有一个类型时用它自己的简称；混选时列出每个类型的标签，不把场景/道具并进「参考图」。 */
export function describeGroupNoun(groups: readonly AssetTypeGroup<unknown>[]): string {
  if (groups.length === 0) return ''
  if (groups.length === 1) return groups[0].copy.noun
  return describeGroupBreakdown(groups)
}

export type BatchOperationKind = 'generate' | 'regenerate'

/** 批量按钮文案（`批量生成参考图（3）` / 混选：`批量生成（人物参考图 2 / 场景资产图 1）`）。 */
export function buildBatchActionLabel(
  groups: readonly AssetTypeGroup<unknown>[],
  operation: BatchOperationKind,
): string {
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  const verb = operation === 'regenerate' ? '批量重新生成' : '批量生成'
  if (groups.length === 0) return `${verb}（0）`
  if (groups.length === 1) {
    return `${verb}${resultArtifactCopy(groups[0].assetType).noun}（${total}）`
  }
  return `${verb}（${describeGroupBreakdown(groups)}）`
}

/** 批次确认框标题：混选时明确说「按类型分组」，不只报一个总数。 */
export function buildBatchConfirmTitle(
  groups: readonly AssetTypeGroup<unknown>[],
  operation: BatchOperationKind,
): string {
  const total = groups.reduce((sum, group) => sum + group.count, 0)
  const verb = operation === 'regenerate' ? '确认重新生成这' : '确认生成这'
  if (groups.length <= 1) {
    const noun = groups.length === 1 ? resultArtifactCopy(groups[0].assetType).noun : ''
    return `${verb} ${total} 项资产的${noun}？`
  }
  return `${verb} ${total} 项资产？（按类型分组：${describeGroupBreakdown(groups)}）`
}

/* ------------------------------------------------- 人物参考图固定画幅（用户点名） */

/** 人物参考图（设定图）的固定画幅 —— 写死，不跟随项目/镜头。 */
export const CHARACTER_REFERENCE_RATIO = '16:9'

/** 后端画幅来源取值：`character_reference_fixed` = 命中人物固定口径。 */
export const CHARACTER_REFERENCE_RATIO_SOURCE = 'character_reference_fixed'

/** 用户点名要写在页面上的那句话（批次确认框与生产区各一处）。 */
export const CHARACTER_REFERENCE_FIXED_STATEMENT = '人物参考图固定 16:9，不等于项目最终视频画幅'

/** 后端 `aspect_ratio_note` 的原文口径（只进技术详情，主界面用上面那句人话）。 */
export const CHARACTER_REFERENCE_RATIO_SERVER_NOTE =
  '16:9 是人物参考图（设定图）的画幅，不是项目最终视频画幅；项目 default_video_ratio / 镜头视频比例都不会影响它'

export type AspectRatioNotice = {
  /** 本次是否适用（= 本次含人物，且画幅来自固定口径） */
  applies: boolean
  /** 人物参考图的固定画幅 */
  referenceRatio: string
  /** 项目自己的最终视频画幅（`projects.default_video_ratio`；读不到时为空串） */
  projectRatio: string
  /** 两者是否确实不同 */
  differs: boolean
  /** 写在**批次确认框**里的一行（applies=false 时为空串） */
  line: string
  /** 写在**生产区说明**里的那句话（applies=false 时为空串） */
  statement: string
}

/**
 * 「人物参考图固定 16:9」这句话的正文（**同时给出项目自己的画幅**，两者不同要能一眼看出）。
 *
 * 为什么要同时给两个值：用户看到「16:9」很容易以为项目成片也是 16:9。
 * 只写固定值等于把项目画幅藏起来；两个值都写、并说明各自用途，才不会误导。
 */
export function buildAspectRatioStatement(
  projectRatio: string,
  referenceRatio: string = CHARACTER_REFERENCE_RATIO,
): string {
  const project = String(projectRatio ?? '').trim()
  if (!project) {
    return `${CHARACTER_REFERENCE_FIXED_STATEMENT}；本项目还没有设置最终视频画幅，暂时没有可比的值。`
  }
  if (project === referenceRatio) {
    return (
      `${CHARACTER_REFERENCE_FIXED_STATEMENT}；本项目最终视频画幅也是 ${project}：数值相同，` +
      `但用途不同 —— 参考图的 ${referenceRatio} 是人物参考图（设定图）的出图口径，成片按项目画幅 ${project} 出。`
    )
  }
  return (
    `${CHARACTER_REFERENCE_FIXED_STATEMENT}；本项目最终视频画幅是 ${project}，与参考图的 ${referenceRatio} 不一样：` +
    `${referenceRatio} 只用来出一张能进人物参考图库的图，成片仍按 ${project} 出。`
  )
}

/**
 * 只读计划（`/plan/preview` 的 `strategy`）→ 画幅来源。
 *
 * `strategy.to_read()` 给出的字段是 `aspect_ratio` / `aspect_ratio_fixed` / `aspect_ratio_note`
 * （**没有** `aspect_ratio_source`；后者是提交结果的字段）。命中人物固定口径时
 * `aspect_ratio_fixed === true`，这里把它翻译成同一个来源取值，页面就能用同一套判断。
 */
export function aspectRatioSourceFromStrategy(strategy?: Record<string, unknown> | null): string {
  if (!strategy) return ''
  return strategy.aspect_ratio_fixed === true ? CHARACTER_REFERENCE_RATIO_SOURCE : ''
}

/**
 * 本次是否需要写「人物参考图固定 16:9」这句话。
 *
 * 条件：**本次含人物**，且画幅来源是人物固定口径（回包 `aspect_ratio_source ===
 * 'character_reference_fixed'`；没有任何回包时按固定口径处理，因为这本来就是写死的）。
 */
export function buildAspectRatioNotice(args: {
  assetTypes: readonly string[]
  /** 项目自己的最终视频画幅（`projects.default_video_ratio`） */
  projectRatio?: string | null
  /** 后端计划/回包里的 `aspect_ratio_source` */
  source?: string | null
  /** 后端计划/回包里的画幅值 */
  ratio?: string | null
}): AspectRatioNotice {
  const types = args.assetTypes.filter(isImageAssetType)
  const source = String(args.source ?? '').trim()
  const requested = String(args.ratio ?? '').trim()
  const fromFixedSource =
    source === '' ||
    source === CHARACTER_REFERENCE_RATIO_SOURCE ||
    (source === 'request' && requested === CHARACTER_REFERENCE_RATIO)
  const applies = types.includes('character') && fromFixedSource
  const projectRatio = String(args.projectRatio ?? '').trim()
  const statement = applies ? buildAspectRatioStatement(projectRatio) : ''
  return {
    applies,
    referenceRatio: CHARACTER_REFERENCE_RATIO,
    projectRatio,
    differs: applies && projectRatio !== '' && projectRatio !== CHARACTER_REFERENCE_RATIO,
    line: applies ? `本次包含人物：${statement}` : '',
    statement,
  }
}
