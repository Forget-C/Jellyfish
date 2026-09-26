/**
 * **写入范围**与数据隔离（纯逻辑，可 `node --test` 直接跑）。
 *
 * 用户点名的口径：
 *   1. **角色**属项目内资产；**场景 / 道具 / 服装是全局资产** —— 它们的通用资料
 *      保存在全局资产库里，而「剧情身份 / 出场依据 / 本章补充」是按 **项目 + 章节**
 *      隔离保存的。页面要能看出这两者的区别。
 *   2. 要更新**全局资产**时必须**明确展示差异并由用户确认**：
 *      不能默认写回全局，也不能静默覆盖全局的图片提示词。
 *
 * 为什么必须做成纯函数：这三处保存入口（工作台提示词弹窗 / 大模型批量面板 /
 * 资产编辑页）都要用同一份判定与同一套文案，靠肉眼保证一定会飘。
 *
 * 边界：**保存图片提示词落到全局实体行**这件事是后端既有契约
 * （`PATCH /studio/entities/{type}/{id}` 与后端新增的批量入口都写实体行），
 * 前端不能改后端写法；所以前端能做、也必须做的是：
 * **在写之前把"这会写回全局资产"和"新旧差异"摆到用户面前，由用户确认。**
 */

export type AssetScopeType = 'character' | 'scene' | 'prop' | 'costume'

/** 角色属项目内资产；场景 / 道具 / 服装是全局资产。 */
export const PROJECT_SCOPED_ASSET_TYPES: AssetScopeType[] = ['character']

export function isGlobalAssetType(assetType: unknown): boolean {
  const type = String(assetType ?? '').trim() as AssetScopeType
  if (!type) return false
  return !PROJECT_SCOPED_ASSET_TYPES.includes(type)
}

/** 类型名（与页面上其它地方同口径的人话）。 */
const TYPE_LABEL: Record<string, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
  costume: '服装',
}

/** 未登记的类型码的中文兜底（**绝不回显后端原值**，审计 §1.2 模式 3）。 */
export const ASSET_SCOPE_TYPE_FALLBACK_TEXT = '其他类型'

/**
 * 类型名。它的返回值会拼进主区句子（「X 只属于当前项目：改了不影响别的项目」），
 * 所以未登记的类型码**不许原样回显** —— 否则后端换一个类型码，主区就印上英文。
 */
export function assetScopeTypeLabel(assetType: unknown): string {
  const type = String(assetType ?? '').trim()
  if (!type) return ASSET_SCOPE_TYPE_FALLBACK_TEXT
  return TYPE_LABEL[type] ?? ASSET_SCOPE_TYPE_FALLBACK_TEXT
}

/* ------------------------------------------------------------ 页面上的一句说明 */

export type AssetScopeCopy = {
  globalAsset: boolean
  /** 数据范围的一句话（页面直接展示） */
  statement: string
  /** 写入方向的一句话（保存前必读） */
  writeStatement: string
}

/**
 * 数据隔离说明（页面直接用）。
 *
 * 角色：项目内资产，提示词与资料都跟着项目走。
 * 场景/道具/服装：全局资产库里的通用资料 + 按项目+章节隔离的本章依据/补充。
 */
export function describeAssetScopeCopy(assetType: unknown): AssetScopeCopy {
  const globalAsset = isGlobalAssetType(assetType)
  const typeLabel = assetScopeTypeLabel(assetType)
  if (!globalAsset) {
    return {
      globalAsset: false,
      statement: `${typeLabel}只属于当前项目：改了不影响别的项目。`,
      writeStatement: `保存影响范围：只有当前项目用到的这个${typeLabel}。`,
    }
  }
  return {
    globalAsset: true,
    statement:
      `${typeLabel}是所有项目共用：通用资料放在共用资产库里（所有用到它的项目都会看到）；` +
      `「本章依据 / 本章补充」按 项目 + 章节 隔离保存，不会影响别的项目。`,
    writeStatement:
      `保存影响范围：图片提示词会写进所有项目共用的资产库里的这个${typeLabel}（不是只影响本章）。` +
      `已有的提示词不会被自动覆盖：需要你确认后才会替换。`,
  }
}

/* ------------------------------------------------------ 全局资产写回的差异确认 */

export type ScopeDiffLine = {
  slot: string
  /** 已有内容（截断后的展示文本；没有就是空串） */
  before: string
  /** 本次要写入的内容 */
  after: string
  kind: '新增' | '替换'
}

const MAX_DIFF_CHARS = 80

function preview(text: unknown): string {
  const value = String(text ?? '').trim().replace(/\s+/g, ' ')
  if (!value) return ''
  return value.length > MAX_DIFF_CHARS ? `${value.slice(0, MAX_DIFF_CHARS)}…` : value
}

/**
 * 逐槽位差异（`新增` / `替换`）。
 *
 * 只把**真的会变化**的槽位列出来：内容一致的槽位既不显示、也不当作"要覆盖"。
 */
export function buildScopeDiff(
  existing: Record<string, string> | null | undefined,
  incoming: Record<string, string> | null | undefined,
): ScopeDiffLine[] {
  const before = existing ?? {}
  const after = incoming ?? {}
  return Object.keys(after)
    .map((slot) => {
      const oldText = String(before[slot] ?? '').trim()
      const newText = String(after[slot] ?? '').trim()
      if (!newText || oldText === newText) return null
      return {
        slot,
        before: preview(oldText),
        after: preview(newText),
        kind: oldText ? ('替换' as const) : ('新增' as const),
      }
    })
    .filter((item): item is ScopeDiffLine => item !== null)
}

export type GlobalAssetWriteConfirmation = {
  /** 是否需要弹确认框（全局资产 + 确实有变化） */
  required: boolean
  /** 是不是全局资产（页面据此调整按钮文案与提示强度） */
  globalAsset: boolean
  title: string
  lines: string[]
  okText: string
  cancelText: string
  /** 本次会替换掉已有内容的槽位（要显式确认覆盖才行） */
  replacedSlots: string[]
  /** 本次新增的槽位 */
  addedSlots: string[]
}

/**
 * 写回前的确认文案（**全局资产一律要确认**；角色按既有口径只在覆盖时确认）。
 *
 * 口径：
 *   - 全局资产：即使只是"新增"，也要先让用户知道这会写进全局资产库（不能默认写回全局）；
 *   - 已有内容被替换：一定要列出来（差异），并说明旧内容不会留副本；
 *   - 没有任何变化：不用确认（`required: false`）。
 */
export function buildGlobalAssetWriteConfirmation(args: {
  assetType: string
  assetName: string
  existing?: Record<string, string> | null
  incoming?: Record<string, string> | null
}): GlobalAssetWriteConfirmation {
  const globalAsset = isGlobalAssetType(args.assetType)
  const diff = buildScopeDiff(args.existing, args.incoming)
  const replacedSlots = diff.filter((item) => item.kind === '替换').map((item) => item.slot)
  const addedSlots = diff.filter((item) => item.kind === '新增').map((item) => item.slot)
  const name = String(args.assetName ?? '').trim() || '该资产'
  const typeLabel = assetScopeTypeLabel(args.assetType)
  const copy = describeAssetScopeCopy(args.assetType)

  if (diff.length === 0) {
    return {
      required: false,
      globalAsset,
      title: '',
      lines: [],
      okText: '',
      cancelText: '',
      replacedSlots,
      addedSlots,
    }
  }

  const lines: string[] = [copy.writeStatement]
  diff.forEach((item) => {
    if (item.kind === '替换') {
      lines.push(`替换原有提示词：${item.before} → ${item.after}（旧的不会留副本）`)
    } else {
      lines.push(`新增提示词：${item.after}`)
    }
  })
  if (replacedSlots.length > 0) {
    lines.push(`本次会替换 ${replacedSlots.length} 处已有内容（旧内容不留副本）。`)
  }
  // 三件"不许自动覆盖"的事，写回前一律说清（验收会专门核对这三项保持不变）
  lines.push(PRESERVATION_POLICY.uploadedImage)
  lines.push(PRESERVATION_POLICY.primaryImage)
  if (globalAsset) {
    lines.push('确认后才会写入；不确认就什么都不改。')
  }

  return {
    required: globalAsset || replacedSlots.length > 0,
    globalAsset,
    title: globalAsset
      ? `把图片提示词写回全局${typeLabel}「${name}」？`
      : `覆盖「${name}」已有的图片提示词？`,
    lines,
    okText: globalAsset ? '确认保存（含共用资产）' : '确认覆盖',
    cancelText: '取消',
    replacedSlots,
    addedSlots,
  }
}

/**
 * 批量保存（多资产）时的确认文案：把**全局资产**与**项目内资产**分开说清，
 * 并把每个资产的差异列出来（全局资产同样"不默认写回"）。
 */
export type BatchWriteScopeItem = {
  assetType: string
  assetName: string
  existing?: Record<string, string> | null
  incoming?: Record<string, string> | null
}

export type BatchWriteScopeConfirmation = {
  required: boolean
  title: string
  lines: string
  okText: string
  cancelText: string
  /** 有变化的全局资产数 */
  globalCount: number
  /** 有变化的项目内资产数 */
  projectCount: number
  /** 需要显式确认覆盖的槽位数 */
  replacedSlots: number
}

export function buildBatchWriteScopeConfirmation(
  items: readonly BatchWriteScopeItem[],
): BatchWriteScopeConfirmation {
  const diffs = items
    .map((item) => ({
      item,
      diff: buildScopeDiff(item.existing, item.incoming),
    }))
    .filter((entry) => entry.diff.length > 0)

  const globalItems = diffs.filter((entry) => isGlobalAssetType(entry.item.assetType))
  const projectItems = diffs.filter((entry) => !isGlobalAssetType(entry.item.assetType))
  const replaced = diffs.reduce((sum, entry) => sum + entry.diff.filter((d) => d.kind === '替换').length, 0)

  const lines: string[] = []
  if (globalItems.length > 0) {
    lines.push(
      `其中 ${globalItems.length} 项是所有项目共用的资产（场景 / 道具 / 服装）：保存会把图片提示词写进共用资产库，` +
        `所有用到它的项目都会看到；本章依据/补充仍按 项目 + 章节 隔离。`,
    )
    globalItems.forEach((entry) => {
      const detail = entry.diff
        .map((d) => (d.kind === '替换' ? `替换原有提示词：${d.before} → ${d.after}` : `新增提示词：${d.after}`))
        .join('；')
      lines.push(`· ${assetScopeTypeLabel(entry.item.assetType)}「${entry.item.assetName}」：${detail}`)
    })
  }
  if (projectItems.length > 0) {
    lines.push(`另外 ${projectItems.length} 项只属于当前项目（角色）：改了不影响别的项目。`)
  }
  if (replaced > 0) {
    lines.push(`本次会替换 ${replaced} 处已有内容（旧内容不留副本）。`)
  }
  lines.push(PRESERVATION_POLICY.uploadedImage)
  lines.push(PRESERVATION_POLICY.primaryImage)

  return {
    required: diffs.length > 0,
    title:
      globalItems.length > 0
        ? `确认保存？其中 ${globalItems.length} 项会写进所有项目共用的资产库`
        : '确认保存这些资产图片提示词？',
    lines: lines.join('\n'),
    okText: globalItems.length > 0 ? '确认保存（含共用资产）' : '确认保存',
    cancelText: '取消',
    globalCount: globalItems.length,
    projectCount: projectItems.length,
    replacedSlots: replaced,
  }
}

/**
 * 「不可自动覆盖」的三条自检（验收会专门核对这三项保持不变）。
 *
 * 这里只做一件事：把三条边界变成**可断言的对象**，供页面与测试共用，
 * 避免以后有人加"顺手覆盖一下"的逻辑。
 */
export type PreservationPolicy = {
  /** 既有人工提示词：默认不动，覆盖要显式确认 */
  imagePrompt: string
  /** 已上传图片：任何保存/生成动作都不碰 */
  uploadedImage: string
  /** 定版图：只有用户单独确认「设为定版」才会变，且需要二次确认 */
  primaryImage: string
}

export const PRESERVATION_POLICY: PreservationPolicy = {
  imagePrompt: '已有图片提示词默认不被覆盖：只有你显式确认后才会替换，且会先把新旧差异列出来。',
  uploadedImage: '已上传的图片不会被任何保存/生成动作改动（提示词保存只写提示词字段）。',
  primaryImage: '定版图只有在你单独点「设为定版」并确认后才会改变；生成结果不会自动成为定版。',
}

export function describePreservationPolicy(): string[] {
  return [PRESERVATION_POLICY.imagePrompt, PRESERVATION_POLICY.uploadedImage, PRESERVATION_POLICY.primaryImage]
}
