/**
 * 「图片提示词生成」**请求字段**的能力探测与组装（纯逻辑，可 `node --test` 直接跑）。
 *
 * 为什么需要它：
 * 用户要求生成时必须接收 ① 项目整体风格 ② 资产结构化资料 ③ 剧本片段与分镜依据
 * ④ 用户对该资产的补充/修改 ⑤ 该资产类型的出图要求。其中 ②③⑤ 由后端按资产/项目自行装配，
 * 前端能负责的是**把手上有的东西送进去**（① 的项目风格、④ 用户的补充、以及该资产的身份）。
 *
 * 但请求模型是后端定的（`ImagePromptPreviewRequest`），多送一个未声明的键可能被拒（422）——
 * 所以这里不硬猜字段名，而是**读后端接口清单（`/openapi.json`）**，
 * 只把后端**确实声明过**的键放进请求：
 *   - 后端已经有 `style_hint` / `extra_instructions` → 现在就能把 ① 和 ④ 送到；
 *   - 新增的 `user_supplement` / `asset_id` 一旦上线，前端**自动**开始使用它们；
 *   - 读不到清单时**一个都不送**（退化成今天的行为，绝不因为多送字段把生成打坏）。
 *
 * 硬口径：探测结果必须如实展示 —— 送的进去就说送的进去，送不进去就说清楚由后端装配，
 * 不假装"已经按项目风格生成了"。
 */

/** 五类请求信息里前端能直接送的那几项。 */
export type PromptRequestFieldKey = 'styleHint' | 'userSupplement' | 'assetId' | 'assetType' | 'negativePrompt'

/** 实体画像条目自己的字段（`EntityProfileInput.profile_source`，本轮后端新增）。 */
export type PromptRequestProfileFieldKey = 'entityProfileSource'

/** 每项信息的候选字段名（按顺序取**第一个**被后端声明过的）。 */
export const PROMPT_REQUEST_FIELD_CANDIDATES: Record<PromptRequestFieldKey, string[]> = {
  styleHint: ['style_hint', 'styleHint', 'project_style', 'projectStyle'],
  userSupplement: [
    'user_supplement',
    'userSupplement',
    'user_note',
    'user_notes',
    'supplement',
    // 后端**今天就有**的字段：没有专用字段时用它承载"用户的补充/修改"
    'extra_instructions',
    'extraInstructions',
  ],
  assetId: ['asset_id', 'assetId', 'entity_id', 'entityId', 'source_asset_id', 'sourceAssetId'],
  assetType: ['asset_type', 'assetType'],
  negativePrompt: ['negative_prompt', 'negativePrompt'],
}

/** 用户语言的信息名（用于"送的进去/送不进去"的说明）。 */
export const PROMPT_REQUEST_FIELD_LABEL: Record<PromptRequestFieldKey | PromptRequestProfileFieldKey, string> = {
  styleHint: '项目整体风格',
  userSupplement: '你的补充/修改',
  assetId: '该资产的身份（后端据此装配它的资料）',
  assetType: '资产类型',
  negativePrompt: '负面提示词',
  entityProfileSource: '画像资料的来源（资产描述 / 没有资料）',
}

/** 实体画像条目里的字段候选（`EntityProfileInput.properties`）。 */
export const PROMPT_REQUEST_PROFILE_FIELD_CANDIDATES: Record<PromptRequestProfileFieldKey, string[]> = {
  entityProfileSource: ['profile_source', 'profileSource'],
}

export type PromptRequestFieldSupport = {
  /** 是否读到了后端接口清单（false = 读不到，按"全都不送"处理） */
  specRead: boolean
  /** 各信息项实际会用哪个键（空串 = 后端没声明，前端不送） */
  keys: Record<PromptRequestFieldKey | PromptRequestProfileFieldKey, string>
}

export const PROMPT_REQUEST_SUPPORT_NONE: PromptRequestFieldSupport = {
  specRead: false,
  keys: {
    styleHint: '',
    userSupplement: '',
    assetId: '',
    assetType: '',
    negativePrompt: '',
    entityProfileSource: '',
  },
}

function declaredProperties(props: Record<string, unknown> | null | undefined): string[] {
  if (!props) return []
  return Object.keys(props)
}

/**
 * 从后端接口清单里读出「图片提示词生成」请求模型声明了哪些字段。
 *
 * 认两条路径（`paths[...].post.requestBody.content['application/json'].schema.$ref`
 * 与直接把结构给进来的写法），读不到就返回 `specRead: false`。
 */
export function readPromptRequestFieldSupport(spec: unknown): PromptRequestFieldSupport {
  if (!spec || typeof spec !== 'object') return PROMPT_REQUEST_SUPPORT_NONE
  const root = spec as Record<string, unknown>
  const paths = (root.paths ?? {}) as Record<string, unknown>
  const entry = (paths['/api/v1/studio/llm/image-prompt/preview'] ?? null) as Record<string, unknown> | null
  const post = (entry?.post ?? null) as Record<string, unknown> | null
  const content = ((post?.requestBody as Record<string, unknown> | undefined)?.content ?? null) as Record<
    string,
    unknown
  > | null
  const json = (content?.['application/json'] ?? null) as Record<string, unknown> | null
  const schema = (json?.schema ?? null) as Record<string, unknown> | null
  const ref = String(schema?.$ref ?? '')
  const schemas = (root.components as Record<string, unknown> | undefined)?.schemas as
    | Record<string, unknown>
    | undefined
  const refName = ref.split('/').pop() ?? ''
  const resolved = refName && schemas ? (schemas[refName] as Record<string, unknown> | undefined) : undefined
  const properties = (resolved?.properties ?? schema?.properties ?? null) as Record<string, unknown> | null
  const declared = declaredProperties(properties)
  if (declared.length === 0) return PROMPT_REQUEST_SUPPORT_NONE
  const keys = {} as Record<PromptRequestFieldKey | PromptRequestProfileFieldKey, string>
  ;(Object.keys(PROMPT_REQUEST_FIELD_CANDIDATES) as PromptRequestFieldKey[]).forEach((key) => {
    const found = PROMPT_REQUEST_FIELD_CANDIDATES[key].find((candidate) => declared.includes(candidate))
    keys[key] = found ?? ''
  })
  // 实体画像条目自己的字段（同一份清单里的 EntityProfileInput）
  const profileSchema = (schemas?.EntityProfileInput ?? null) as Record<string, unknown> | null
  const profileFields = profileSchema?.properties
  const declaredProfile = declaredProperties(profileFields as Record<string, unknown> | null)
  ;(Object.keys(PROMPT_REQUEST_PROFILE_FIELD_CANDIDATES) as PromptRequestProfileFieldKey[]).forEach((key) => {
    const found = PROMPT_REQUEST_PROFILE_FIELD_CANDIDATES[key].find((candidate) => declaredProfile.includes(candidate))
    keys[key] = found ?? ''
  })
  return { specRead: true, keys }
}

export type PromptRequestExtrasInput = {
  support: PromptRequestFieldSupport
  /** 项目整体风格（读不到就空串） */
  styleHint?: string
  /** 用户对该资产的补充/修改 */
  userSupplement?: string
  /** 该资产 id（后端据此装配它的结构化资料与相关剧本片段/分镜） */
  assetId?: string
  assetType?: string
  negativePrompt?: string
}

/**
 * 组装请求里的"额外字段"：**只放后端声明过的键**，且只放非空的值。
 *
 * 返回空对象是正常情况（清单读不到 / 后端还没声明这些字段），
 * 调用方据此仍能照常生成（只是这些信息这次送不进去）。
 */
export function buildPromptRequestExtras(input: PromptRequestExtrasInput): Record<string, string> {
  const extras: Record<string, string> = {}
  const put = (key: PromptRequestFieldKey, value: string | undefined) => {
    const field = input.support.keys[key]
    const text = String(value ?? '').trim()
    if (!field || !text) return
    extras[field] = text
  }
  put('styleHint', input.styleHint)
  put('userSupplement', input.userSupplement)
  put('assetId', input.assetId)
  put('assetType', input.assetType)
  put('negativePrompt', input.negativePrompt)
  return extras
}

/**
 * 用户语言：这次哪些信息能随请求一起送出去、哪些由后端装配。
 *
 * 主界面上只出现这句人话；具体字段名走 `describePromptRequestFields`（技术详情用）。
 */
export function describePromptRequestDelivery(support: PromptRequestFieldSupport, hasUserSupplement = false): string {
  if (!support.specRead) {
    return '这次没能读到后端接口清单：项目风格与你的补充这次不会随请求发出（生成照常进行，资料由后端按项目装配）。'
  }
  const delivered: string[] = []
  const missing: string[] = []
  if (support.keys.styleHint) delivered.push('项目整体风格')
  else missing.push('项目整体风格')
  if (support.keys.userSupplement) {
    if (hasUserSupplement) delivered.push('你的补充')
  } else if (hasUserSupplement) {
    missing.push('你的补充')
  }
  if (support.keys.assetId) delivered.push('该资产的身份（后端据此装配它的资料与相关剧本片段）')
  else missing.push('该资产的身份（后端按项目整体装配）')

  const head = delivered.length > 0 ? `本次会一起提交：${delivered.join('、')}` : '本次没有可以额外提交的信息'
  return missing.length > 0
    ? `${head}；后端还没有接收：${missing.join('、')}（这一侧由后端自行装配，页面不假装已按它生成）。`
    : `${head}。`
}

/* --------------------------- 请求体的组装：画像条目与"目标资产"核对 --------------------------- */

/**
 * 资产名的归一化（比对"后端给我的是不是我要的那个资产"）。
 *
 * 大小写、空白、常见分隔符都不算差异；`道具·旧录音笔` 与 `旧录音笔` 视为同一项
 * （前端展示名里带类型前缀，后端库里只存名字）。
 */
export function normalizeAssetName(name: unknown): string {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000·・.。_\-—]+/g, '')
    .replace(/^(人物|角色|场景|道具|服装)/, '')
}

/** 后端回包里的画像卡/槽位指向的是不是**我们要的那个资产**。 */
export function matchesRequestedAsset(payload: unknown, assetName: string): boolean {
  const wanted = normalizeAssetName(assetName)
  if (!wanted) return false
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const root = payload as Record<string, unknown>
  const slot = (root.slot ?? null) as Record<string, unknown> | null
  const candidates: string[] = []
  if (slot) candidates.push(String(slot.entity_name ?? ''))
  const slots = Array.isArray(root.slots) ? root.slots : []
  slots.forEach((item) => {
    if (item && typeof item === 'object') candidates.push(String((item as Record<string, unknown>).entity_name ?? ''))
  })
  const cards = Array.isArray(root.entity_cards) ? root.entity_cards : []
  cards.forEach((item) => {
    if (item && typeof item === 'object') candidates.push(String((item as Record<string, unknown>).name ?? ''))
  })
  return candidates.some((item) => {
    const got = normalizeAssetName(item)
    if (!got) return false
    return got === wanted || got.includes(wanted) || wanted.includes(got)
  })
}

/**
 * 实体画像条目：把"这段资料是从哪来的"如实标给后端（后端据此判断 `has_structured_profile`）。
 *
 * 只在前端**确实**送的是资产描述时才标 `asset_description`；没有描述就标 `none`
 * （不假装有资料，后端与页面因此都能把"外观信息不足"如实说出来）。
 */
export function buildEntityProfileEntry(args: {
  name: string
  entityType: string
  profile: string
  support: PromptRequestFieldSupport
}): Record<string, string> {
  const entry: Record<string, string> = {
    name: args.name,
    entity_type: args.entityType,
    profile: String(args.profile ?? '').trim(),
  }
  const sourceField = args.support.keys.entityProfileSource
  if (sourceField) {
    entry[sourceField] = entry.profile ? 'asset_description' : 'none'
  }
  return entry
}

/** 技术详情用：本次实际使用的请求字段名。 */
export function describePromptRequestFields(support: PromptRequestFieldSupport): string {
  if (!support.specRead) return '未读到后端接口清单（本次不发送任何额外字段）'
  return (
    (Object.keys(support.keys) as (PromptRequestFieldKey | PromptRequestProfileFieldKey)[])
      .filter((key) => support.keys[key])
      .map((key) => `${PROMPT_REQUEST_FIELD_LABEL[key]} → ${support.keys[key]}`)
      .join('；') || '后端请求模型里没有可用的额外字段'
  )
}

/* --------------------------------- 批量保存（后端"全有或全无"入口） --------------------------------- */

/** 后端批量保存入口的路径（`POST /studio/projects/{project_id}/asset-image-prompts`）。 */
export const ASSET_PROMPT_BATCH_SAVE_PATH_TEMPLATE = '/api/v1/studio/projects/{project_id}/asset-image-prompts'

/** 批量保存入口的可用性（读接口清单判断；读不到就退回逐资产保存）。 */
export type AssetPromptBatchSaveSupport = {
  /** 路径模板（读得到才有值） */
  path: string
  available: boolean
  /** 覆盖已有提示词时的确认字段名（后端 409 里也会给） */
  confirmField: string
}

export const ASSET_PROMPT_BATCH_SAVE_UNAVAILABLE: AssetPromptBatchSaveSupport = {
  path: '',
  available: false,
  confirmField: 'confirm_replace_image_prompt',
}

/**
 * 读接口清单里有没有批量保存入口。
 *
 * 为什么要有探针：这个入口是**后端本轮新加的**，老后端没有；
 * 没有的时候页面必须退回"逐资产保存"（今天的口径），不能直接报一个 404 给用户。
 */
export function readAssetPromptBatchSaveSupport(spec: unknown): AssetPromptBatchSaveSupport {
  if (!spec || typeof spec !== 'object') return ASSET_PROMPT_BATCH_SAVE_UNAVAILABLE
  const paths = ((spec as Record<string, unknown>).paths ?? {}) as Record<string, unknown>
  const found = Object.keys(paths).find((path) => /\/asset-image-prompts$/.test(path) && path.includes('projects'))
  if (!found) return ASSET_PROMPT_BATCH_SAVE_UNAVAILABLE
  return { path: found, available: true, confirmField: 'confirm_replace_image_prompt' }
}

export type AssetPromptBatchSaveItem = {
  asset_type: string
  asset_id: string
  /** 本次要保存的槽位（**合并后**的完整映射，避免整列替换把其它槽位抹掉） */
  image_prompts: Record<string, string>
}

export type AssetPromptBatchSaveBody = {
  items: AssetPromptBatchSaveItem[]
  confirm_replace_image_prompt: boolean
}

/**
 * 批量保存的请求体（**纯函数，可单测**）。
 *
 * 两条硬口径：
 *   1. 只把**真的会写进去**的资产放进来（空 items 不发请求）；
 *   2. `confirm_replace_image_prompt` 只在用户**已经确认覆盖**时才为 true
 *      （后端会拿它当"允许替换已有提示词"的显式开关）。
 */
export function buildAssetPromptBatchSaveBody(args: {
  items: readonly { assetType: string; assetId: string; imagePrompts: Record<string, string> }[]
  confirmedReplace: boolean
}): AssetPromptBatchSaveBody {
  const items: AssetPromptBatchSaveItem[] = args.items
    .map((item) => ({
      asset_type: String(item.assetType ?? '').trim(),
      asset_id: String(item.assetId ?? '').trim(),
      image_prompts: Object.fromEntries(
        Object.entries(item.imagePrompts ?? {})
          .map(([slot, text]) => [slot, String(text ?? '').trim()])
          .filter(([, text]) => Boolean(text)),
      ),
    }))
    .filter((item) => item.asset_type && item.asset_id && Object.keys(item.image_prompts).length > 0)
  return { items, confirm_replace_image_prompt: args.confirmedReplace === true }
}

/** 批量保存里"这一项会覆盖已有提示词"的槽位（用于决定要不要先跟用户确认）。 */
export function collectReplacedSlots(
  existing: Record<string, string> | undefined,
  incoming: Record<string, string>,
): string[] {
  const before = existing ?? {}
  return Object.keys(incoming).filter((slot) => {
    const oldText = String(before[slot] ?? '').trim()
    const newText = String(incoming[slot] ?? '').trim()
    return Boolean(oldText) && oldText !== newText
  })
}
