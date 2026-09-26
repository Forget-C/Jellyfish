/**
 * 「生成依据」的**纯逻辑**（可 `node --test` 直接跑）。
 *
 * 背景（用户点名）：图片提示词生成结果里大量出现「外观信息不足、需人工补充」，
 * 说明**生成时并没有拿到剧本里的资产资料**。所以每次生成之后，用户要能当场看到
 * **这次到底用了什么**，且验收会逐项核对下面五项：
 *
 *   ① 原始剧本与相关分镜
 *   ② 规范化资产资料（含**别名合并结果**）
 *   ③ **项目/章节范围内保存的剧本依据**（场景/道具/服装这类**全局资产**要能与
 *      「全局通用资料」区分开：剧情身份/出场依据/临时补充是按 项目+章节 隔离保存的，
 *      不能把全局资产的通用资料当成本章依据）
 *   ④ 图片提示词接口的**脱敏**请求结构
 *   ⑤ 最终提示词及差异
 *
 * 本模块只做一件事：把这些信息**如实映射**成页面能画的行。
 *
 * 三条硬口径（有单测钉住）：
 *   1. **不编造**：后端没返回、前端也没有的项一律 `provided: false`，
 *      页面显示「本次未提供」（/整块「本次未提供生成依据」），
 *      绝不拿资产名、类型或提示词文本顶上；
 *   2. **后端字段名容错**：后端这一轮用的是 `asset_profile` / `asset_profile_text` /
 *      `aliases` / `display_name` / `shot_refs` / `evidence` / `structured_source` 这套名字
 *      （见 `chapter_asset_profile_confirm.py` 写进候选 payload 的键），
 *      容器名也可能是 `generation_basis` / `basis` / `provenance`，这里都认；
 *   3. **④⑤ 由前端如实提供**：请求结构是"我们这次真的发出去的"、最终提示词是
 *      "这次真的会用的" —— 它们由调用方通过 `GenerationBasisExtras` 传进来，
 *      同样缺就显示「本次未提供」，不假装有。
 */

/** 生成依据的行（顺序就是页面上的顺序，与验收的五项对齐）。 */
export type BasisItemKey =
  | 'scriptAndShots'
  | 'assetProfile'
  | 'globalProfile'
  | 'scopedBasis'
  | 'requestStructure'
  | 'finalPrompts'
  | 'projectStyle'
  | 'userSupplement'
  | 'typeRequirement'

export const BASIS_ITEM_ORDER: BasisItemKey[] = [
  'scriptAndShots',
  'assetProfile',
  'globalProfile',
  'scopedBasis',
  'requestStructure',
  'finalPrompts',
  'projectStyle',
  'userSupplement',
  'typeRequirement',
]

/** 各行的用户语言标签（①~⑤ 直接写在标签里，验收时一眼能对号）。 */
export const BASIS_ITEM_LABEL: Record<BasisItemKey, string> = {
  scriptAndShots: '① 原始剧本与相关分镜',
  assetProfile: '② 规范化资产资料（含别名合并结果）',
  globalProfile: '③-a 所有项目共用的通用资料（不属于本章资料）',
  scopedBasis: '③-b 本章/本项目保存的剧本资料',
  requestStructure: '④ 图片提示词服务的脱敏请求结构',
  finalPrompts: '⑤ 本次真正会用的提示词与差异',
  projectStyle: '项目整体风格',
  userSupplement: '你的补充/修改',
  typeRequirement: '该资产类型的出图要求',
}

/** 面板标题与收起态的那句话。 */
export const BASIS_PANEL_TITLE = '这次用了哪些资料'
export const BASIS_PANEL_HINT = '本次生成实际用到的资料都在这里（默认收起）'
export const BASIS_PANEL_PLACEHOLDER = '暂时没有记录'
export const NO_BASIS_TEXT = '这次没有记录用到的资料'
export const BASIS_ITEM_EMPTY_TEXT = '本次未提供'
export const BASIS_TECHNICAL_TITLE = '技术详情'

/** 返回了资料清单、但每一项都是空的时候的如实说明（不是"没提供"，是"给了但为空"）。 */
export const BASIS_EMPTY_FROM_SERVER_TEXT =
  '这次返回了资料清单，但每一项都是空的：本次生成没有用到项目风格、资产资料、剧本片段或分镜依据。'

/** 拿不到资料清单时的如实说明（不编造、也不假装有）。 */
export const BASIS_ABSENT_TEXT =
  '这次没有返回资料清单，因此看不到本次用了哪些资料（①~③ 由服务端提供）；④ 请求结构与 ⑤ 本次真正会用的提示词是本页自己记录的，没有就是没有。这一块暂时没有内容。'

/** 所有项目共用的资产（场景 / 道具 / 服装）的数据隔离说明（角色只属于当前项目，不适用）。 */
export const GLOBAL_ASSET_SCOPE_NOTE =
  '该资产所有项目共用（场景 / 道具 / 服装）：通用资料保存在共用资产库里；' +
  '「本章资料 / 本章补充」按 项目 + 章节 单独保存，不会影响别的项目。'

export type BasisProfileField = { label: string; value: string }
export type BasisShotRef = { shotId: string; shotIndex: string; title: string }
export type BasisScriptExcerpt = BasisShotRef & { text: string }

/** 别名合并结果（② 的一部分：`张伟（小伟、伟哥）`）。 */
export type BasisAliasMerge = {
  /** 规范化 / 显示名 */
  canonicalName: string
  /** 合并进来的别名 */
  aliases: string[]
}

export type GenerationBasis = {
  /** 是否**拿到了非空**的生成依据（false = 页面上不显示任何"用了什么"的内容） */
  available: boolean
  /** 回包里到底有没有出现依据字段（与 available 区分：给了但为空也是 true） */
  fromServer: boolean
  /** 命中的容器字段名（只进技术详情） */
  containerKey: string
  /** ① 相关分镜（镜头 id / 序号 / 标题） */
  shotRefs: BasisShotRef[]
  /** ① 原始剧本片段（原文摘录，带镜头定位） */
  scriptExcerpts: BasisScriptExcerpt[]
  /** ② 规范化资产资料（字段 → 值） */
  profileFields: BasisProfileField[]
  /** ② 别名合并结果 */
  aliasMerge: BasisAliasMerge
  /** ③-a 全局资产通用资料（全局资产才有内容） */
  globalProfile: string
  /** ③-b 本章/本项目保存的剧本依据（按项目+章节隔离） */
  scopedBasis: string[]
  /** ④ 脱敏请求结构（前端提供 = 本次真的发出去的那份） */
  requestStructure: string
  /** ⑤ 最终提示词（前端提供 = 本次真的会用的那条） */
  finalPrompt: string
  /** ⑤ 与同批其它资产的差异说明（前端按相似度算出来） */
  promptDifferences: string[]
  // —— 其余几项（用户点名过，出图/风格链路也在用）——
  projectStyle: string
  userSupplement: string
  typeRequirement: string
  /**
   * 该资产结构化资料的**来源码**（后端 `structured_source` / `profile_source`）：
   * `asset_description` / `candidate_profile` / `asset_description+candidate_profile` /
   * `request` / `none`（空串 = 后端没给）。
   */
  structuredSource: string
  /** 后端明确说"这份资料里没有可出图的具体信息"（`has_structured_profile === false`） */
  lacksStructuredProfile: boolean
  /** 该资产是不是全局资产（场景/道具/服装） */
  globalAsset: boolean
  /** 后端附带的说明（已屏蔽内部标识） */
  notes: string[]
  /** 上面九项里本次确实没有的（页面显示占位符） */
  missingKeys: BasisItemKey[]
  /** 命中的原始字段名（只进技术详情） */
  fieldNames: string[]
}

/** 结构化资料来源码 → 用户语言（后端 `profile_source` / `structured_source` 的取值）。 */
export const STRUCTURED_SOURCE_LABEL: Record<string, string> = {
  // 2026-09 起，章节资料落在**专用表**（按项目 + 章节持久化，重启不丢、重新提取也不丢）；
  // 后端据此回 `chapter_record` 这一档来源码，页面必须说人话，不能把内部码直接摊给用户看。
  chapter_record: '本章资产资料（按项目 + 章节持久化保存，重启与重新提取都不会丢）',
  'asset_description+chapter_record': '资产描述（全局）+ 本章资产资料（按项目 + 章节持久化保存）',
  chapter_overlay: '本章资产资料（章节隔离层，含剧本片段与出场镜头）',
  'asset_description+chapter_overlay': '资产描述（全局）+ 本章资产资料（章节隔离层）',
  'chapter_overlay+candidate_profile': '本章资产资料 + 结构化资料（都按项目和章节保存）',
  'asset_description+chapter_overlay+candidate_profile':
    '资产描述（全局）+ 本章资产资料 + 结构化资料',
  asset_description: '资产描述（共用资产库里的通用资料）',
  candidate_profile: '结构化资料（按项目和章节保存，含剧本片段与出场镜头）',
  'asset_description+candidate_profile': '资产描述（全局）+ 结构化资料（本章，含剧本片段与出场镜头）',
  request: '调用方传入的资料',
  none: '没有任何资料（只剩空话兜底）',
  script_excerpt: '剧本片段',
  shot_refs: '分镜依据',
  script_window: '剧本上下文窗口（最弱兜底：只从原文截一段，没有结构化资料）',
}

/**
 * 调用方（前端）自己知道的证据：④ 脱敏请求结构、⑤ 最终提示词与差异、全局资产标记。
 *
 * 为什么由前端给：这三样都是"本次真的发生了什么"，后端回包里没有、也不该有；
 * 前端把它们如实填进来，缺了就留空 → 页面显示「本次未提供」。
 */
export type GenerationBasisExtras = {
  /** ④ 本次发给图片提示词接口的**脱敏**请求结构 */
  requestStructure?: string
  /** ⑤ 本次最终采用的那条提示词 */
  finalPrompt?: string
  /** ⑤ 与同批其它资产的差异（例如「与「陆行舟」相似度 92%（高度重复）」） */
  promptDifferences?: readonly string[]
  /** 该资产是不是全局资产（场景/道具/服装） */
  globalAsset?: boolean
}

/* --------------------------------------------------------------- 字段名容错 */

/** 依据容器的候选字段名（后端用哪一个是它的自由，这里都认）。 */
const CONTAINER_KEYS = [
  'generation_basis',
  'generationBasis',
  'basis',
  'prompt_basis',
  'promptBasis',
  'generation_context',
  'generationContext',
  'basis_used',
  'basisUsed',
  'provenance',
  'inputs_used',
  'inputsUsed',
  'used_inputs',
  'usedInputs',
  'materials',
  'context_used',
  'contextUsed',
]

/** 各分项的候选字段名（前几个是后端这一轮**真的在用**的名字）。 */
const FIELD_KEYS: Record<string, string[]> = {
  scriptExcerpts: [
    'script_excerpts',
    'scriptExcerpts',
    'script_excerpt',
    'scriptExcerpt',
    'script_snippets',
    'scriptSnippets',
    'script_quotes',
    'scriptQuotes',
    'script_texts',
    'scriptTexts',
  ],
  shotBasis: [
    'shot_refs',
    'shotRefs',
    'shot_basis',
    'shotBasis',
    'shots',
    'shot_references',
    'shotReferences',
    'related_shots',
    'relatedShots',
    'shot_ids',
    'shotIds',
  ],
  evidence: ['evidence', 'evidence_snippets', 'grounded_evidence'],
  assetProfile: [
    'asset_profile',
    'assetProfile',
    'asset_profile_text',
    'assetProfileText',
    'fields',
    'structured_profile',
    'structuredProfile',
    'profile_fields',
    'profileFields',
    'asset_fields',
    'assetFields',
    'entity_profile',
    'entityProfile',
    'structured_data',
    'structuredData',
  ],
  aliases: ['aliases', 'alias', 'merged_aliases', 'mergedAliases', 'alias_merge', 'aliasMerge'],
  canonicalName: [
    'display_name',
    'displayName',
    'canonical_name',
    'canonicalName',
    'canonical_subject',
    'normalized_name',
  ],
  globalProfile: [
    'global_profile',
    'globalProfile',
    'global_asset_profile',
    'globalAssetProfile',
    'entity_description',
    'asset_description',
    'assetDescription',
  ],
  scopedBasis: [
    'scoped_basis',
    'scopedBasis',
    'chapter_basis',
    'chapterBasis',
    'chapter_script_basis',
    'chapterScriptBasis',
    'project_script_basis',
    'projectScriptBasis',
    'chapter_supplement',
    'chapterSupplement',
    'project_basis',
    'projectBasis',
    'scope_basis',
    'scopeBasis',
  ],
  projectStyle: [
    'project_style',
    'projectStyle',
    'style',
    'style_hint',
    'styleHint',
    'visual_style',
    'visualStyle',
    'project_style_statement',
    'projectStyleStatement',
  ],
  userSupplement: [
    'user_supplement',
    'userSupplement',
    'user_notes',
    'userNotes',
    'user_note',
    'userNote',
    'supplement',
    'user_input',
    'userInput',
    'extra_instructions',
    'extraInstructions',
  ],
  typeRequirement: [
    'asset_type_requirement',
    'assetTypeRequirement',
    'type_requirement',
    'typeRequirement',
    'output_requirement',
    'outputRequirement',
    'asset_requirement',
    'assetRequirement',
    'slot_requirement',
    'slotRequirement',
    'requirement',
  ],
}

const NOTE_KEYS = ['basis_notes', 'basisNotes', 'notes', 'note', 'explanation', 'basis_summary']

/** 结构化资料里**不该画到主界面**的字段（它们属于「技术详情」）。 */
const INTERNAL_FIELD_NAME =
  /(^|_)(ids?|file_id|status|storage_key|oss_url|image_url|source_task_id|service_task_id|created_at|updated_at|linked_entity_id|existing_asset_id|candidate_recommendation|source_kind|grounded|group_key)$/i

/** 已知实体字段的中文名（其余字段名按原样展示，但内部字段会被过滤掉）。 */
const PROFILE_FIELD_LABEL: Record<string, string> = {
  name: '名称',
  title: '名称',
  type: '类型',
  entity_type: '类型',
  asset_type: '类型',
  type_label: '类型',
  description: '描述',
  desc: '描述',
  profile: '画像',
  appearance: '外观',
  look: '外观',
  age: '年龄',
  gender: '性别',
  height: '身高',
  build: '体型',
  hair: '发型',
  face: '面部特征',
  clothing: '服装',
  costume: '服装',
  outfit: '着装',
  accessories: '配饰',
  props: '随身道具',
  weapon: '武器',
  material: '材质',
  color: '颜色',
  size: '尺寸',
  shape: '形状',
  structure: '空间结构',
  furnishing: '陈设',
  lighting: '光线',
  style: '风格',
  atmosphere: '氛围',
  location: '所在地点',
  era: '年代',
  time_of_day: '时间',
  related_plot: '剧情身份',
  identity: '剧情身份',
  role_in_plot: '剧情身份',
  plot_role: '剧情身份',
  story_role: '剧情身份',
  first_appearance: '首次出场',
  shot_refs: '出场镜头',
  notes: '备注',
  tags: '标签',
  aliases: '别名',
  display_name: '显示名',
  summary: '摘要',
  completeness: '完整度',
  missing_fields: '缺的字段',
  missing_visual_fields: '缺的画面字段',
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

function pickRaw(source: Record<string, unknown>, keys: readonly string[]): { key: string; value: unknown } | null {
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue
    const value = source[key]
    if (value === null || value === undefined) continue
    if (typeof value === 'string' && !value.trim()) continue
    if (Array.isArray(value) && value.length === 0) continue
    if (isRecord(value) && Object.keys(value).length === 0) continue
    return { key, value }
  }
  return null
}

function readStringList(value: unknown): string[] {
  if (typeof value === 'string') return value.trim() ? [value.trim()] : []
  if (Array.isArray(value)) return value.flatMap((item) => readStringList(item))
  if (isRecord(value)) {
    const text = textOf(value.text ?? value.snippet ?? value.excerpt ?? value.content ?? value.message ?? value.summary)
    return text ? [text] : []
  }
  return []
}

/** 结构化资料：对象 / 数组 / 字符串三种形态都认，内部字段会被过滤掉。 */
function readProfileFields(value: unknown): BasisProfileField[] {
  const fields: BasisProfileField[] = []
  const push = (label: string, raw: unknown) => {
    const text = Array.isArray(raw) ? raw.map((item) => textOf(item)).filter(Boolean).join('、') : textOf(raw)
    if (!text) return
    if (INTERNAL_FIELD_NAME.test(label)) return
    const known = PROFILE_FIELD_LABEL[label.toLowerCase()]
    /* 未登记的资料键若是机器码形态（`light_tone` 这种），**不许原样当标签**上屏
       （审计 §1.2 模式 3 的同型兜底）；后端自己给的中文标签照旧原样用。 */
    const fallback =
      /^[a-zA-Z][a-zA-Z0-9_]*$/.test(label) ? '其他资料项' : label
    fields.push({ label: known ?? fallback, value: text })
  }
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (isRecord(item)) {
        const label = textOf(item.label ?? item.name ?? item.key ?? item.field)
        const text = textOf(item.value ?? item.content ?? item.text)
        if (label && text) push(label, text)
        else if (!label && text) push('资料', text)
        return
      }
      push('资料', item)
    })
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, raw]) => push(key, raw))
  } else {
    push('资料', value)
  }
  return fields
}

function readShotRefs(value: unknown): BasisShotRef[] {
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) => {
      if (isRecord(item)) {
        const shotId = textOf(item.shot_id ?? item.shotId ?? item.id)
        const index = textOf(item.shot_index ?? item.shotIndex ?? item.index ?? item.no ?? item.seq)
        const title = textOf(item.title ?? item.name ?? item.summary)
        if (!shotId && !index && !title) return null
        return { shotId, shotIndex: index, title }
      }
      const text = textOf(item)
      return text ? { shotId: text, shotIndex: '', title: '' } : null
    })
    .filter((item): item is BasisShotRef => item !== null)
}

function readScriptExcerpts(value: unknown): BasisScriptExcerpt[] {
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) => {
      if (isRecord(item)) {
        const text = textOf(
          item.excerpt ??
            item.text ??
            item.content ??
            item.quote ??
            item.snippet ??
            item.script_excerpt ??
            item.scriptExcerpt,
        )
        if (!text) return null
        return {
          shotId: textOf(item.shot_id ?? item.shotId ?? item.id),
          shotIndex: textOf(item.shot_index ?? item.shotIndex ?? item.index ?? item.no),
          title: textOf(item.title ?? item.name),
          text,
        }
      }
      const text = textOf(item)
      return text ? { shotId: '', shotIndex: '', title: '', text } : null
    })
    .filter((item): item is BasisScriptExcerpt => item !== null)
}

function emptyBasis(extras: GenerationBasisExtras): GenerationBasis {
  return {
    available: false,
    fromServer: false,
    containerKey: '',
    shotRefs: [],
    scriptExcerpts: [],
    profileFields: [],
    aliasMerge: { canonicalName: '', aliases: [] },
    globalProfile: '',
    scopedBasis: [],
    requestStructure: textOf(extras.requestStructure),
    finalPrompt: textOf(extras.finalPrompt),
    promptDifferences: (extras.promptDifferences ?? []).map((item) => textOf(item)).filter((item) => item.length > 0),
    projectStyle: '',
    userSupplement: '',
    typeRequirement: '',
    structuredSource: '',
    lacksStructuredProfile: false,
    globalAsset: extras.globalAsset === true,
    notes: [],
    missingKeys: [...BASIS_ITEM_ORDER],
    fieldNames: [],
  }
}

/** 结构化资料来源的候选字段名（后端 `structured_source` / `profile_source`）。 */
const STRUCTURED_SOURCE_KEYS = ['structured_source', 'structuredSource', 'profile_source', 'profileSource']

/**
 * 从回包里读出「这份资产资料是从哪来的」（后端本轮的正式字段）。
 *
 * `none` / `has_structured_profile === false` 就是"外观信息不足"的机器可读信号 ——
 * 页面把这句话直接写出来，用户就不用猜为什么提示词不可用。
 */
function readStructuredSourceEvidence(payload: Record<string, unknown>): {
  source: string
  lacks: boolean
  fieldKey: string
} {
  const containers: { key: string; value: Record<string, unknown> }[] = [{ key: '(回包根)', value: payload }]
  ;(['slot', 'data', 'meta', 'result'] as const).forEach((wrapper) => {
    const inner = payload[wrapper]
    if (isRecord(inner)) containers.push({ key: wrapper, value: inner })
  })
  for (const container of containers) {
    const picked = pickRaw(container.value, STRUCTURED_SOURCE_KEYS)
    if (picked) {
      const lacksRaw = container.value.has_structured_profile ?? container.value.hasStructuredProfile
      const source = textOf(picked.value)
      return {
        source,
        lacks: lacksRaw === false || source === 'none',
        fieldKey: container.key === '(回包根)' ? picked.key : `${container.key}.${picked.key}`,
      }
    }
  }
  const cards = payload.entity_cards ?? payload.entityCards
  const first = Array.isArray(cards) ? cards[0] : null
  if (isRecord(first)) {
    const picked = pickRaw(first, STRUCTURED_SOURCE_KEYS)
    const lacksRaw = first.has_structured_profile ?? first.hasStructuredProfile
    if (picked || lacksRaw !== undefined) {
      const source = picked ? textOf(picked.value) : ''
      return {
        source,
        lacks: lacksRaw === false || source === 'none',
        fieldKey: picked ? `entity_cards[0].${picked.key}` : 'entity_cards[0].has_structured_profile',
      }
    }
  }
  return { source: '', lacks: false, fieldKey: '' }
}

/**
 * 从后端回包里读出**本次实际用到的生成依据**（并合并调用方提供的 ④⑤）。
 *
 * 入参可以是整个回包、回包里的某个槽位，或直接就是依据对象本身 ——
 * 契约字段名以后端的实现为准，这里用候选表容错读取；读不到就如实留空。
 */
export function readGenerationBasis(payload: unknown, extras: GenerationBasisExtras = {}): GenerationBasis {
  const basis = emptyBasis(extras)

  const finish = (): GenerationBasis => {
    basis.missingKeys = BASIS_ITEM_ORDER.filter((item) => !isBasisItemProvided(basis, item))
    basis.available =
      basis.shotRefs.length > 0 ||
      basis.scriptExcerpts.length > 0 ||
      basis.profileFields.length > 0 ||
      basis.aliasMerge.aliases.length > 0 ||
      basis.aliasMerge.canonicalName !== '' ||
      basis.globalProfile !== '' ||
      basis.scopedBasis.length > 0 ||
      basis.requestStructure !== '' ||
      basis.finalPrompt !== '' ||
      basis.projectStyle !== '' ||
      basis.userSupplement !== '' ||
      basis.typeRequirement !== '' ||
      basis.structuredSource !== ''
    return basis
  }

  if (!isRecord(payload)) return finish()

  // 候选容器：容器字段 → data/meta/slot 里再找一层 → 回包本身就是依据对象
  const candidates: { key: string; value: Record<string, unknown> }[] = []
  const pushCandidate = (key: string, value: unknown) => {
    if (isRecord(value)) candidates.push({ key, value })
  }
  CONTAINER_KEYS.forEach((key) => pushCandidate(key, payload[key]))
  ;(['data', 'meta', 'slot', 'result'] as const).forEach((wrapper) => {
    const inner = payload[wrapper]
    if (!isRecord(inner)) return
    CONTAINER_KEYS.forEach((key) => pushCandidate(`${wrapper}.${key}`, inner[key]))
  })
  const hasAnyField = (source: Record<string, unknown>) =>
    Object.values(FIELD_KEYS).some((keys) => pickRaw(source, keys) !== null)
  if (hasAnyField(payload)) candidates.push({ key: '(回包根)', value: payload })

  if (candidates.length === 0) {
    /**
     * 没有依据容器时，仍要看一眼后端这一轮的**正式来源字段**：
     * `structured_source` / `profile_source`（+ `has_structured_profile`）。
     * 它回答的正是用户那个问题 ——「生成时到底有没有拿到资产资料」。
     */
    const evidence = readStructuredSourceEvidence(payload)
    if (!evidence.source && evidence.fieldKey === '') return finish()
    basis.fromServer = true
    basis.containerKey = evidence.fieldKey
    basis.structuredSource = evidence.source
    basis.lacksStructuredProfile = evidence.lacks
    basis.fieldNames.push(evidence.fieldKey)
    return finish()
  }

  const source = candidates[0]
  const raw = source.value
  basis.fromServer = true
  basis.containerKey = source.key
  basis.fieldNames.push(source.key)

  /* ① 原始剧本与相关分镜 */
  const shotBasis = pickRaw(raw, FIELD_KEYS.shotBasis)
  if (shotBasis) {
    basis.shotRefs = readShotRefs(shotBasis.value)
    basis.fieldNames.push(`${source.key}.${shotBasis.key}`)
  }
  const scriptExcerpts = pickRaw(raw, FIELD_KEYS.scriptExcerpts)
  if (scriptExcerpts) {
    basis.scriptExcerpts = readScriptExcerpts(scriptExcerpts.value)
    basis.fieldNames.push(`${source.key}.${scriptExcerpts.key}`)
  }
  // 模型给的原文依据（`evidence`：snippet + grounded）也算 ① 的原文
  const evidence = pickRaw(raw, FIELD_KEYS.evidence)
  if (evidence) {
    const items = readScriptExcerpts(
      Array.isArray(evidence.value)
        ? evidence.value.map((item) => (isRecord(item) ? { ...item, text: item.snippet ?? item.text } : item))
        : evidence.value,
    )
    const seen = new Set(basis.scriptExcerpts.map((item) => item.text))
    items.forEach((item) => {
      if (seen.has(item.text)) return
      basis.scriptExcerpts.push(item)
      seen.add(item.text)
    })
    basis.fieldNames.push(`${source.key}.${evidence.key}`)
  }
  // 出场镜头有时是简写（`shot_refs: "1、3"`）
  if (basis.shotRefs.length === 0) {
    const nested = pickRaw(raw, ['shot_refs', 'shotRefs', 'shot_labels'])
    if (nested && typeof nested.value === 'string') {
      const refs = readShotRefs(
        String(nested.value)
          .split(/[、,，\s]+/)
          .filter(Boolean)
          .map((item) => ({ shot_index: item.replace(/^#/, '') })),
      )
      if (refs.length > 0) {
        basis.shotRefs = refs
        basis.fieldNames.push(`${source.key}.${nested.key}`)
      }
    }
  }

  /* ② 规范化资产资料（含别名合并结果） */
  const assetProfile = pickRaw(raw, FIELD_KEYS.assetProfile)
  if (assetProfile) {
    basis.profileFields = readProfileFields(assetProfile.value)
    basis.fieldNames.push(`${source.key}.${assetProfile.key}`)
  }
  const rawAliases = pickRaw(raw, FIELD_KEYS.aliases)
  const aliases = rawAliases ? readStringList(rawAliases.value).filter((item) => item !== '无') : []
  const canonical = pickRaw(raw, FIELD_KEYS.canonicalName)
  const canonicalFromDisplay = canonical ? textOf(canonical.value) : ''
  if (aliases.length > 0 || canonicalFromDisplay) {
    // 显示名可能是 `张伟（小伟、伟哥）`：把括号里的也算进别名
    const inParens =
      canonicalFromDisplay
        .match(/（([^）]*)）/)?.[1]
        ?.split(/[、,，]/)
        .map((item) => item.trim()) ?? []
    basis.aliasMerge = {
      canonicalName: canonicalFromDisplay.replace(/（[^）]*）$/, '').trim() || canonicalFromDisplay,
      aliases: Array.from(new Set([...aliases, ...inParens])).filter(
        (item) => item.length > 0 && item !== canonicalFromDisplay,
      ),
    }
    if (rawAliases) basis.fieldNames.push(`${source.key}.${rawAliases.key}`)
    if (canonical) basis.fieldNames.push(`${source.key}.${canonical.key}`)
  }

  /* ③-a 全局资产通用资料 / ③-b 本章-本项目保存的剧本依据 */
  const globalProfile = pickRaw(raw, FIELD_KEYS.globalProfile)
  if (globalProfile) {
    basis.globalProfile = readStringList(globalProfile.value).join('；') || textOf(globalProfile.value)
    basis.fieldNames.push(`${source.key}.${globalProfile.key}`)
  }
  const scopedBasis = pickRaw(raw, FIELD_KEYS.scopedBasis)
  if (scopedBasis) {
    basis.scopedBasis = readStringList(scopedBasis.value)
    basis.fieldNames.push(`${source.key}.${scopedBasis.key}`)
  }

  /* 其余（项目风格 / 用户补充 / 出图要求 / 说明 / 来源） */
  const projectStyle = pickRaw(raw, FIELD_KEYS.projectStyle)
  if (projectStyle) {
    basis.projectStyle = textOf(projectStyle.value)
    basis.fieldNames.push(`${source.key}.${projectStyle.key}`)
  }
  const userSupplement = pickRaw(raw, FIELD_KEYS.userSupplement)
  if (userSupplement) {
    basis.userSupplement = textOf(userSupplement.value)
    basis.fieldNames.push(`${source.key}.${userSupplement.key}`)
  }
  const typeRequirement = pickRaw(raw, FIELD_KEYS.typeRequirement)
  if (typeRequirement) {
    basis.typeRequirement = textOf(typeRequirement.value)
    basis.fieldNames.push(`${source.key}.${typeRequirement.key}`)
  }
  const notes = pickRaw(raw, NOTE_KEYS)
  if (notes) basis.notes = readStringList(notes.value)
  const ownEvidence = pickRaw(raw, STRUCTURED_SOURCE_KEYS)
  if (ownEvidence) {
    basis.structuredSource = textOf(ownEvidence.value)
    const lacksRaw = raw.has_structured_profile ?? raw.hasStructuredProfile
    basis.lacksStructuredProfile = lacksRaw === false || basis.structuredSource === 'none'
    basis.fieldNames.push(`${source.key}.${ownEvidence.key}`)
  } else {
    const evidenceFromPayload = readStructuredSourceEvidence(payload)
    if (evidenceFromPayload.fieldKey) {
      basis.structuredSource = evidenceFromPayload.source
      basis.lacksStructuredProfile = evidenceFromPayload.lacks
      basis.fieldNames.push(evidenceFromPayload.fieldKey)
    }
  }
  return finish()
}

/** 九项里某一项这次有没有内容。 */
export function isBasisItemProvided(basis: GenerationBasis, key: BasisItemKey): boolean {
  switch (key) {
    case 'scriptAndShots':
      return basis.shotRefs.length > 0 || basis.scriptExcerpts.length > 0
    case 'assetProfile':
      // 只有来源码（`structured_source`）也算"这一项有内容"：它就是"资料从哪来"的答案
      return (
        basis.profileFields.length > 0 ||
        basis.aliasMerge.aliases.length > 0 ||
        basis.aliasMerge.canonicalName !== '' ||
        basis.structuredSource.trim() !== ''
      )
    case 'globalProfile':
      return basis.globalProfile.trim() !== ''
    case 'scopedBasis':
      return basis.scopedBasis.length > 0
    case 'requestStructure':
      return basis.requestStructure.trim() !== ''
    case 'finalPrompts':
      return basis.finalPrompt.trim() !== '' || basis.promptDifferences.length > 0
    case 'projectStyle':
      return basis.projectStyle.trim() !== ''
    case 'userSupplement':
      return basis.userSupplement.trim() !== ''
    case 'typeRequirement':
      return basis.typeRequirement.trim() !== ''
    default:
      return false
  }
}

export type BasisItem = {
  key: BasisItemKey
  label: string
  /** 本次确实提供了内容 */
  provided: boolean
  /** 要展示的正文行（未提供时是**一个**占位符，不是编造的内容） */
  lines: string[]
  /** 一行摘要（未提供时是占位符） */
  summary: string
}

/** 分镜一行：`镜头 3（shot-x）：标题`；缺哪段就省略哪段，不编。 */
function describeShotRef(ref: BasisShotRef): string {
  const parts: string[] = []
  if (ref.shotIndex) parts.push(`镜头 ${ref.shotIndex}`)
  if (ref.shotId) parts.push(ref.shotId)
  const head = parts.length === 2 ? `${parts[0]}（${parts[1]}）` : parts[0] ?? ''
  if (ref.title) return head ? `${head}：${ref.title}` : ref.title
  return head || ref.shotId || '（未命名镜头）'
}

/**
 * 九项 → 页面要画的行（**有/无两种情况都不编造**）。
 *
 * 未提供的项：`provided: false`，`lines = [BASIS_ITEM_EMPTY_TEXT]`。
 */
export function buildBasisItems(basis: GenerationBasis): BasisItem[] {
  const empty = (key: BasisItemKey): BasisItem => ({
    key,
    label: BASIS_ITEM_LABEL[key],
    provided: false,
    lines: [BASIS_ITEM_EMPTY_TEXT],
    summary: BASIS_ITEM_EMPTY_TEXT,
  })
  return BASIS_ITEM_ORDER.map((key) => {
    if (!isBasisItemProvided(basis, key)) return empty(key)
    switch (key) {
      case 'scriptAndShots': {
        const lines: string[] = []
        if (basis.shotRefs.length > 0) {
          lines.push(`相关分镜 ${basis.shotRefs.length} 条：`, ...basis.shotRefs.map(describeShotRef))
        }
        if (basis.scriptExcerpts.length > 0) {
          lines.push(`剧本原文 ${basis.scriptExcerpts.length} 处：`)
          basis.scriptExcerpts.forEach((item) => {
            const where = describeShotRef({ shotId: item.shotId, shotIndex: item.shotIndex, title: item.title })
            lines.push(where && where !== item.text ? `${where}：${item.text}` : item.text)
          })
        }
        return {
          key,
          label: BASIS_ITEM_LABEL[key],
          provided: true,
          lines,
          summary: `分镜 ${basis.shotRefs.length} 条 / 原文 ${basis.scriptExcerpts.length} 处`,
        }
      }
      case 'assetProfile': {
        const lines = basis.profileFields.map((field) => `${field.label}：${field.value}`)
        if (lines.length === 0 && basis.structuredSource.trim()) {
          lines.push(`资料来自：${describeStructuredSource(basis.structuredSource)}`)
        }
        if (basis.aliasMerge.canonicalName || basis.aliasMerge.aliases.length > 0) {
          const name = basis.aliasMerge.canonicalName || '（规范化名未给）'
          lines.push(
            basis.aliasMerge.aliases.length > 0
              ? `别名合并结果：${basis.aliasMerge.aliases.join('、')} → ${name}`
              : `规范化名：${name}`,
          )
        }
        if (basis.lacksStructuredProfile) {
          lines.push('这份资料里没有可出图的具体信息（只剩空话兜底）：先把资料补齐，提示词才会真的可用。')
        }
        return {
          key,
          label: BASIS_ITEM_LABEL[key],
          provided: true,
          lines,
          summary:
            basis.profileFields.length > 0
              ? `共 ${basis.profileFields.length} 项资料${
                  basis.aliasMerge.aliases.length > 0 ? ` / 别名合并 ${basis.aliasMerge.aliases.length} 个` : ''
                }`
              : `资料来自：${describeStructuredSource(basis.structuredSource) || '未知来源'}`,
        }
      }
      case 'globalProfile': {
        const text = basis.globalProfile.trim()
        const lines = [text]
        if (basis.globalAsset) {
          lines.push('（该资产所有项目共用：以上是共用资产库里的通用资料，不属于本章资料）')
        }
        return { key, label: BASIS_ITEM_LABEL[key], provided: true, lines, summary: text.slice(0, 40) }
      }
      case 'scopedBasis': {
        const lines = [...basis.scopedBasis]
        if (basis.globalAsset) {
          lines.push('（本章资料/补充按 项目 + 章节 隔离保存；不会影响别的项目）')
        }
        return {
          key,
          label: BASIS_ITEM_LABEL[key],
          provided: true,
          lines,
          summary: `共 ${basis.scopedBasis.length} 条本章资料`,
        }
      }
      case 'requestStructure': {
        const text = basis.requestStructure.trim()
        return {
          key,
          label: BASIS_ITEM_LABEL[key],
          provided: true,
          lines: text.split('\n'),
          summary: '本次实际发出的请求（已脱敏）',
        }
      }
      case 'finalPrompts': {
        const lines: string[] = []
        if (basis.finalPrompt.trim()) lines.push(`本次真正会用的提示词：${basis.finalPrompt.trim()}`)
        if (basis.promptDifferences.length > 0) {
          lines.push(...basis.promptDifferences.map((item) => `与其它资产的差异：${item}`))
        }
        return {
          key,
          label: BASIS_ITEM_LABEL[key],
          provided: true,
          lines,
          summary: basis.promptDifferences.length > 0 ? `差异 ${basis.promptDifferences.length} 条` : '本次采用的那一条',
        }
      }
      case 'projectStyle': {
        const text = basis.projectStyle.trim()
        return { key, label: BASIS_ITEM_LABEL[key], provided: true, lines: [text], summary: text }
      }
      case 'userSupplement': {
        const text = basis.userSupplement.trim()
        return { key, label: BASIS_ITEM_LABEL[key], provided: true, lines: [text], summary: text }
      }
      case 'typeRequirement': {
        const text = basis.typeRequirement.trim()
        return { key, label: BASIS_ITEM_LABEL[key], provided: true, lines: [text], summary: text }
      }
      default:
        return empty(key)
    }
  })
}

/**
 * 结构化资料来源码 → 用户语言。
 *
 * 认不出来的码分两种处理（都**不编造**来源内容）：
 * - 像内部标识（全小写 + 下划线，例如后端新加的 `xxx_yyy`）→ 给一句中文兜底，
 *   并把原始码留给技术详情去查，**不把内部标识摊在用户主流程里**；
 * - 其余（例如 `资产描述` 这种后端直接给的中文）→ 原样显示。
 */
export function describeStructuredSource(code: string): string {
  const key = String(code ?? '').trim()
  if (!key) return ''
  const known = STRUCTURED_SOURCE_LABEL[key]
  if (known) return known
  if (/^[a-z][a-z0-9_+]*$/.test(key)) {
    return '本章资产资料（本页没有登记这种来源码，代码见技术详情）'
  }
  return key
}

/** 收起状态下标题右侧那一行摘要（未提供时就是「本次未提供生成依据」）。 */
export function summarizeGenerationBasis(basis: GenerationBasis): string {
  if (!basis.available) return NO_BASIS_TEXT
  const parts: string[] = []
  if (isBasisItemProvided(basis, 'scriptAndShots')) {
    parts.push(`剧本/分镜 ${basis.shotRefs.length + basis.scriptExcerpts.length} 项`)
  }
  if (isBasisItemProvided(basis, 'assetProfile')) {
    parts.push(
      basis.profileFields.length > 0
        ? `规范化资料 ${basis.profileFields.length} 项`
        : `资料来自：${describeStructuredSource(basis.structuredSource) || '未知来源'}`,
    )
  }
  /* 审计 §4.5「基准禁词命中」（同款 :967-973）：改前是「本章依据 N 条」，按建议口径改成用户语言。 */
  if (isBasisItemProvided(basis, 'scopedBasis')) parts.push(`本章资料 ${basis.scopedBasis.length} 条`)
  if (isBasisItemProvided(basis, 'globalProfile')) parts.push('全局通用资料')
  if (isBasisItemProvided(basis, 'requestStructure')) parts.push('脱敏请求结构')
  if (isBasisItemProvided(basis, 'finalPrompts')) parts.push('本次采用的提示词')
  if (isBasisItemProvided(basis, 'projectStyle')) parts.push('项目风格')
  if (isBasisItemProvided(basis, 'userSupplement')) parts.push('你的补充')
  if (isBasisItemProvided(basis, 'typeRequirement')) parts.push('出图要求')
  return `本次用到：${parts.join(' / ')}`
}

/** 面板正文里那句说明（**只描述观察到的事实**，不解释原因、不编造）。 */
export function describeBasisAvailability(basis: GenerationBasis): string {
  if (basis.available) {
    const missing = basis.missingKeys.map((key) => BASIS_ITEM_LABEL[key])
    return missing.length > 0
      ? `本次生成用到了上面这些资料；本次未提供的：${missing.join('、')}。`
      : '本次生成用到了上面列出的全部资料。'
  }
  return basis.fromServer ? BASIS_EMPTY_FROM_SERVER_TEXT : BASIS_ABSENT_TEXT
}

/** 技术详情用的字段名清单（主界面不展示）。 */
export function describeBasisFieldNames(basis: GenerationBasis): string {
  if (!basis.fromServer) return '本次回包里没有资料清单'
  return basis.fieldNames.join(', ')
}

/**
 * 兜底：把「本次未提供生成依据」这句话在面板上稳定地画出来。
 *
 * 单独一个函数是为了让测试能直接断言"字段没上线时页面上出现的就是这句话"。
 */
export function buildBasisPlaceholderText(basis: GenerationBasis): string {
  return basis.available ? '' : NO_BASIS_TEXT
}

/**
 * ④ 脱敏请求结构：把"本次真的发出去的请求"整理成可展示的文本。
 *
 * 脱敏 = 把内部 ID（UUID 等）替换掉、超长时截断；**字段名照实保留** ——
 * 用户要看的就是"接口到底收到了什么结构"。
 */
export function buildRequestStructureText(body: Record<string, unknown> | null | undefined): string {
  if (!body) return ''
  try {
    return JSON.stringify(body, null, 2)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '（内部 ID 已脱敏）')
      .slice(0, 2000)
  } catch {
    return ''
  }
}
