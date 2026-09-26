/**
 * 「大模型生成图片提示词」面板的**纯逻辑**（可 `node --test` 直接跑）。
 *
 * 抽出来的原因（缺陷 D1）：面板拉取「已保存提示词」时，用
 * `loaded.find(i => i.key === row.key) ?? row` **整行替换**了原行，
 * 而拉回来的对象只有 `{ key, existing }` —— 于是 name / type / supported / category 全丢，
 * 界面上变成「undefined（undefined）」、槽位显示「不支持（无槽位）」、复选框被禁用、不能生成，
 * 有提示词的资产有几项就坏几项，还误报「有 N 个资产类型没有大模型槽位」。
 *
 * 修法是**按 key 合并**（`{ ...row, ...found }`）。这里把合并与文案拼装都做成纯函数，
 * 于是「合并后 name / 类型 / 槽位仍保留、且不会出现 undefined 文案」可以用测试钉住，
 * 而不是只靠肉眼看界面。
 *
 * ---------------------------------------------------------------------------
 * 槽位口径（本轮修正）：**道具不再显示「不支持（无槽位）」**
 *
 * 事实：`PromptCategory.prop_image_front`（道具正面图片）一直在后端枚举里，
 * 出图分流表 `asset_strategies` 也早就用 `prop_image_front` 读道具的提示词列，
 * 缺的只是「大模型槽位表」（`image_prompt_slot_specs()`）里的那一条 —— 后端正在补。
 *
 * 所以本模块分**两个维度**如实表达，不再用一个 `supported` 把两件事混在一起：
 *   - `supported`：这个类型**有没有提示词槽位**（能不能选、能不能保存）——
 *     四类资产（人物 / 场景 / 道具 / 服装）全部 true；
 *   - `generateSupported`：**后端槽位表**里有没有这一项（能不能让大模型一键生成）——
 *     以接口返回的槽位表为准；表里还没有时**如实说明**「正在补，先手工填写并保存」，
 *     而不是显示成「不支持（无槽位）」这种死胡同。
 *
 * 槽位名与中文名**优先取后端槽位表**（`resolveAssetPromptSlot`），内置表只作兜底 ——
 * 后端补上道具槽位后，页面会自动跟着变，不需要前端再改一处硬编码。
 */

export type AssetPromptAssetType = 'character' | 'scene' | 'prop' | 'costume'

/**
 * 资产类型 → 生成提示词时使用的槽位（= 生图计划读取的那一列）。
 *
 * 四类是**同一张表**（照后端 `asset_strategies` 的 `prompt_slot` 口径），
 * 道具这一项与其它三类平权：`prop_image_front`（后端 `PromptCategory` 里本来就有）。
 */
export const ASSET_PROMPT_CATEGORY: Partial<Record<AssetPromptAssetType, string>> = {
  character: 'character_image_front',
  scene: 'scene_image_front',
  prop: 'prop_image_front',
  costume: 'costume_image_front',
}

/** 槽位类别的中文名（后端槽位表没给 label 时的兜底）。 */
export const ASSET_PROMPT_CATEGORY_LABEL: Record<string, string> = {
  character_image_front: '角色正面图片',
  scene_image_front: '场景正面图片',
  prop_image_front: '道具正面图片',
  costume_image_front: '服装正面图片',
}

export const ASSET_PROMPT_UNSUPPORTED_SLOT_TEXT = '暂时不能一键生成'
export const ASSET_PROMPT_UNSUPPORTED_STATE_TEXT = '这一类资产暂时不能一键生成'
export const ASSET_PROMPT_EMPTY_EXISTING_TEXT = '—'
/** 未登记的槽位码 / 类型码的中文兜底（**绝不回显后端原值**，审计 §1.2 模式 3）。 */
export const ASSET_PROMPT_SLOT_FALLBACK_TEXT = '图片提示词'
export const ASSET_PROMPT_TYPE_FALLBACK_TEXT = '其它类型'

/** 资产类型的中文名（与 `assetProduction.ASSET_TYPE_LABEL` 同口径）。 */
export const ASSET_PROMPT_TYPE_LABEL: Record<AssetPromptAssetType, string> = {
  character: '人物',
  scene: '场景',
  prop: '道具',
  costume: '服装',
}

/**
 * 面板行的**最小形状**：合并必须保住这些字段，否则就是 D1 那个 bug。
 *
 * 泛型参数让真实行（含 status / draft / warnings …）原样透传，合并只动 `existing`。
 */
export type PromptSlotRowLike = {
  key: string
  name: string
  type: string
  supported: boolean
  category: string
  existing: string
  /** 槽位中文名（来自后端槽位表；没有时由内置表兜底） */
  label?: string
  /** 后端槽位表里有没有这一项（能否一键让大模型生成） */
  generateSupported?: boolean
  /** 这个类型的资产用哪个槽位（供保存 / 生成使用） */
  generateBlockedReason?: string
}

/** 拉回来的「已保存提示词」补丁（只有这两个字段，**绝不能**拿来整行替换）。 */
export type LoadedAssetPrompt = {
  key: string
  existing: string
  /**
   * 该资产**已保存的全部槽位**（可选；面板保存时用它合并写回）。
   *
   * 保存接口是"整列替换"，只发一个槽位会抹掉该资产其它槽位，
   * 所以这里把整份已保存内容一起带回来，合并只动命中的那一行。
   */
  existingMap?: Record<string, string>
}

/** 后端槽位表的一行（`/studio/llm/orchestration/status` 的 `image_prompt_slots`）。 */
export type AssetPromptSlotSpecLike = {
  category?: string
  label?: string
  entity_type?: string | null
  view_hint?: string
  subject_source?: string
}

/**
 * 把拉回来的已保存提示词**合并**进原行（D1 的修复本体）。
 *
 * 三条不变量（有单测）：
 *   1. 行数不变、顺序不变（按 key 对齐）；
 *   2. name / type / supported / category 等原字段一个都不丢；
 *   3. 只有命中 key 的行的 `existing` 被更新，其余行原样返回。
 */
export function mergeLoadedAssetPrompts<T extends PromptSlotRowLike>(
  rows: readonly T[],
  loaded: readonly LoadedAssetPrompt[],
): T[] {
  const patchByKey = new Map<string, LoadedAssetPrompt>()
  loaded.forEach((item) => {
    patchByKey.set(String(item.key), item)
  })
  return rows.map((row) => {
    const patch = patchByKey.get(row.key)
    if (!patch) return row
    const next = { ...row, existing: String(patch.existing ?? '') }
    return patch.existingMap ? { ...next, existingMap: patch.existingMap } : next
  })
}

/* --------------------------------------------------------- 槽位解析（吃后端表） */

export type ResolvedAssetPromptSlot = {
  /** 生图实际读取的列名（`image_prompts[<slot>]`） */
  category: string
  /** 槽位中文名（后端槽位表优先） */
  label: string
  /** 有没有槽位：能勾选、能保存（四类资产都为 true） */
  supported: boolean
  /** 后端槽位表里有没有这一项：能否一键让大模型生成 */
  generateSupported: boolean
  /** 槽位名 / 中文名是否来自后端槽位表 */
  fromServer: boolean
  /** 生成不可用时的如实说明（可用时为空串） */
  generateBlockedReason: string
}

/** 内置兜底：该资产类型读哪一列（与后端 `asset_strategies` 的 `prompt_slot` 一致）。 */
export function builtinPromptSlotFor(assetType: AssetPromptAssetType): string {
  return ASSET_PROMPT_CATEGORY[assetType] ?? ''
}

/**
 * 内置兜底的中文槽位名。
 *
 * 审计 §4.5 模式 3（`:236` 同款）：改前是 `ASSET_PROMPT_CATEGORY_LABEL[category] ?? category`，
 * 未登记的槽位码（`xxx_image_front` 这种后端原值）会原样回显到表里。
 * 现在未登记统一「图片提示词」—— **绝不回显原值**（§1.2 模式 3 的口径）。
 */
export function builtinPromptSlotLabel(category: string): string {
  return ASSET_PROMPT_CATEGORY_LABEL[category] ?? ASSET_PROMPT_SLOT_FALLBACK_TEXT
}

/** 后端槽位表里是否有这个资产类型的**正面**槽位（先按 entity_type + `_front` 精确匹配）。 */
export function findServerSlotSpec(
  assetType: string,
  serverSpecs?: readonly AssetPromptSlotSpecLike[] | null,
): AssetPromptSlotSpecLike | undefined {
  const specs = Array.isArray(serverSpecs) ? serverSpecs : []
  const own = specs.filter((spec) => String(spec?.entity_type ?? '') === assetType)
  if (!own.length) return undefined
  return own.find((spec) => String(spec?.category ?? '').endsWith('_front')) ?? own[0]
}

/**
 * 解析某类资产在**提示词面板**里的槽位。
 *
 * 为什么不再用一个布尔量：把「有没有槽位」与「后端槽位表里有没有这一项」混在一起，
 * 道具就会显示成「不支持（无槽位）」——而它其实只是后端槽位表还没补上，
 * 手工填写 + 保存（以及补上之后的生成）本来都该是通的。
 */
export function resolveAssetPromptSlot(
  assetType: AssetPromptAssetType,
  serverSpecs?: readonly AssetPromptSlotSpecLike[] | null,
): ResolvedAssetPromptSlot {
  const builtinCategory = builtinPromptSlotFor(assetType)
  const spec = findServerSlotSpec(assetType, serverSpecs)
  if (spec) {
    const category = String(spec.category ?? '').trim() || builtinCategory
    return {
      category,
      label: String(spec.label ?? '').trim() || builtinPromptSlotLabel(category),
      supported: Boolean(category),
      generateSupported: true,
      fromServer: true,
      generateBlockedReason: '',
    }
  }
  if (!builtinCategory) {
    return {
      category: '',
      label: '',
      supported: false,
      generateSupported: false,
      fromServer: false,
      generateBlockedReason: '这一类暂时不能一键生成：先手工填写并保存。',
    }
  }
  return {
    category: builtinCategory,
    label: builtinPromptSlotLabel(builtinCategory),
    supported: true,
    generateSupported: false,
    fromServer: false,
    generateBlockedReason:
      '这一类暂时还不能一键生成：' +
      '可以先用「填提示词」手工填写并保存，保存后出图会直接读它；以后这里就能一键生成。',
  }
}

/* -------------------------------------------------------------------- 文案 */

/** 资产列的文案：`韩虹（人物）` —— 不许出现 undefined。 */
export function describePromptRowAsset(row: Pick<PromptSlotRowLike, 'name' | 'type'>): string {
  const name = String(row.name ?? '').trim() || '（未命名资产）'
  const rawType = String(row.type ?? '').trim()
  // 未登记的资产类型码也不回显原值（审计 §4.5 模式 3 的同型兜底）
  const type = rawType
    ? (ASSET_PROMPT_TYPE_LABEL as Record<string, string>)[rawType] ?? ASSET_PROMPT_TYPE_FALLBACK_TEXT
    : ASSET_PROMPT_TYPE_FALLBACK_TEXT
  return `${name}（${type}）`
}

/** 槽位列的文案：有槽位显示中文槽位名，没有槽位才显示「不支持（无槽位）」。 */
export function describePromptRowSlot(row: Pick<PromptSlotRowLike, 'supported' | 'category' | 'label'>): string {
  if (!row.supported) return ASSET_PROMPT_UNSUPPORTED_SLOT_TEXT
  const category = String(row.category ?? '').trim()
  if (!category) return ASSET_PROMPT_UNSUPPORTED_SLOT_TEXT
  const label = String(row.label ?? '').trim()
  if (label) return label
  return ASSET_PROMPT_CATEGORY_LABEL[category] ?? ASSET_PROMPT_SLOT_FALLBACK_TEXT
}

/** 「已有提示词」列的文案：N 字 / —。 */
export function describePromptRowExisting(row: Pick<PromptSlotRowLike, 'existing'>): string {
  const text = String(row.existing ?? '').trim()
  return text ? `${text.length} 字` : ASSET_PROMPT_EMPTY_EXISTING_TEXT
}

/** 状态列在「没有槽位」时的那句话。 */
export function describePromptRowState(row: Pick<PromptSlotRowLike, 'supported'>): string {
  return row.supported ? '' : ASSET_PROMPT_UNSUPPORTED_STATE_TEXT
}

/**
 * 状态列里关于「能不能一键生成」的**如实**说明（空串 = 后端槽位表里有，可以生成）。
 *
 * 这一条取代了过去道具那一行的「不支持（无槽位）」死胡同文案。
 */
export function describePromptRowGenerateHint(
  row: Pick<PromptSlotRowLike, 'supported' | 'generateSupported' | 'generateBlockedReason'>,
): string {
  if (!row.supported) return ''
  if (row.generateSupported === true) return ''
  return String(row.generateBlockedReason ?? '').trim() || '这一项暂时不能一键生成，只能手工填写并保存。'
}

export type UnsupportedSlotAlert = {
  count: number
  message: string
  description: string
}

/**
 * 「有 N 项资产没有提示词槽位」的提示。
 *
 * 只有**真的**没有槽位的行才计数 —— D1 的 bug 会让所有行都被误算进来，
 * 上一版还把道具固定当成"没有槽位"（现在道具已有 `prop_image_front` 槽位，不再计数）。
 * 返回 null 表示不该显示这条提示。
 */
export function buildUnsupportedSlotAlert(
  rows: readonly Pick<PromptSlotRowLike, 'supported' | 'type'>[],
): UnsupportedSlotAlert | null {
  const types = Array.from(
    new Set(rows.filter((row) => !row.supported).map((row) => String(row.type ?? '').trim() || '未知类型')),
  )
  const count = rows.filter((row) => !row.supported).length
  if (count === 0) return null
  const typeText = types
    .map((type) => (ASSET_PROMPT_TYPE_LABEL as Record<string, string>)[type] ?? ASSET_PROMPT_TYPE_FALLBACK_TEXT)
    .join('、')
  return {
    count,
    message: `有 ${count} 项资产还没有可用的图片提示词`,
    description: `这些类型暂时不能一键生成：${typeText}。这类资产请直接在资产编辑页手工维护图片。`,
  }
}

/**
 * 后端槽位表里还没有、但**手工填写与保存链路已经可用**的类型（如未补槽位前的道具）。
 *
 * 面板会把这些行标成「可手工填写并保存」，而不是「不支持」。
 */
export function describeServerSlotPendingNote(
  rows: readonly Pick<PromptSlotRowLike, 'supported' | 'generateSupported' | 'type'>[],
): string {
  const pending = Array.from(
    new Set(
      rows
        .filter((row) => row.supported && row.generateSupported !== true)
        .map((row) => (ASSET_PROMPT_TYPE_LABEL as Record<string, string>)[String(row.type)] ?? ASSET_PROMPT_TYPE_FALLBACK_TEXT),
    ),
  )
  if (pending.length === 0) return ''
  return `这些类型暂时不能一键生成：${pending.join('、')}；可以手工填写并保存到资产，保存后出图会直接读它。`
}

/**
 * 一行文案里是否出现了 `undefined` / `null` 这类未定义痕迹。
 *
 * 面板的 bug 表现就是「undefined（undefined）」——测试用它当断言，
 * 任何字段被整行替换掉都会被抓出来。
 */
export function findUndefinedCopy(text: string): boolean {
  return /\bundefined\b|\bnull\b|NaN/.test(String(text ?? ''))
}
