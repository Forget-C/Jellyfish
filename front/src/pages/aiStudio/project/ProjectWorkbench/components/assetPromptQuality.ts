/**
 * 图片提示词的**质量判定与展示规则**（纯逻辑，可 `node --test` 直接跑）。
 *
 * 背景（用户点名）：图片提示词生成结果里大量出现「外观信息不足、需人工补充」，
 * 而页面上却把它当成"提示词已就绪"直接进批量出图 —— 既浪费钱，结果也不对。
 *
 * 硬口径（有单测钉住）：
 *   1. **后端优先**：后端给了结构化判定（`quality.usable === false` + 中文原因/修法）就用它，
 *      原文作为"真实原因"展示（内部标识先经 `maskInternalIds` 屏蔽）；
 *   2. **前端也要能拦住**：后端字段还没上线时，四种不可用情形在本地同样判得出来 ——
 *      空 / 外观信息不足（含"占位""待补充"这类模板痕迹）/ 只有名称+通用摄影词 /
 *      多个资产高度重复；
 *   3. **不确定就不宣称可用**：判不出来时状态是 `unknown`，页面显示「提示词质量未知」，
 *      **不出现**「提示词已就绪」这类说法（`findReadyCopy` 供测试做黑名单断言）；
 *   4. **拦截不是空手拦**：每条不可用都给出「真实原因 + 怎么修」，
 *      批量面板与结果卡片都用同一份文案（`buildQualityNotice`）。
 */

// 带 `.ts` 后缀：本模块要能被 `node --test` 直接加载（Node ESM 不猜扩展名）。
import { maskInternalIds } from '../../../components/maskInternalIds.ts'
// 类型中文名只有一份（`assetPromptSlots.ASSET_PROMPT_TYPE_LABEL`），避免两处各写一套
import { ASSET_PROMPT_TYPE_LABEL } from './assetPromptSlots.ts'

export type PromptQualityStatus = 'usable' | 'unusable' | 'unknown'

/** 不可用/需注意的原因码（与后端结构化 `code` 也会对齐）。 */
export type PromptQualityCode =
  | 'empty'
  | 'insufficient_appearance'
  | 'generic_only'
  | 'duplicated'
  | 'server_blocked'

export type PromptQualityVerdict = {
  status: PromptQualityStatus
  /** 能不能按这条提示词出图（只有 status === 'usable' 才是 true） */
  usable: boolean
  code: PromptQualityCode | ''
  /** 短标签（标签/表格用） */
  label: string
  /** 真实原因（后端结构化中文优先） */
  reason: string
  /** 怎么修（每一条都是可执行的动作） */
  fixes: string[]
  /** 判定来源：server = 后端判定 / local = 前端自查 / none = 没有依据 */
  source: 'server' | 'local' | 'none'
  /** 后端原文（只进「技术详情」） */
  rawReasons: string[]
}

/* ------------------------------------------------------------------ 文案常量 */

export const PROMPT_QUALITY_STATUS_LABEL: Record<PromptQualityStatus, string> = {
  usable: '提示词包含外观信息',
  unusable: '提示词不可用',
  unknown: '质量还没判定',
}

/** 四种不可用情形各自的短标签。 */
export const PROMPT_QUALITY_CODE_LABEL: Record<PromptQualityCode, string> = {
  empty: '提示词为空',
  insufficient_appearance: '外观信息不足，需人工补充',
  generic_only: '只有名称与通用摄影词',
  duplicated: '与其它资产高度重复',
  server_blocked: '服务端判定不可用',
}

/** 每种原因的"怎么修"。 */
export const PROMPT_QUALITY_FIXES: Record<PromptQualityCode, string[]> = {
  empty: [
    '点该项的「填提示词」写清主体外观，或让大模型先生成一条再人工补充',
    '也可以先补全该资产的描述（描述越具体，拼出来的提示词越可用）',
  ],
  insufficient_appearance: [
    '到该资产编辑页补全外观资料：发型 / 服装 / 体型 / 面部特征 / 材质颜色等',
    '补全资料后点「用大模型生成/完善」重新生成提示词，再核对一遍',
    '不要直接拿这条提示词出图：它会画出与设定不符的形象',
  ],
  generic_only: [
    '补写主体外观：年龄、发型、服装、面部特征（场景写空间结构、材质、陈设）',
    '把「正面半身 / 纯白背景 / 画面比例」这类通用词留在后面，但这些不能替代外观描述',
  ],
  duplicated: [
    '逐个打开这些资产，把提示词改成各自独有的外观描述（不同人物不能共用一条）',
    '确认这些资产不是同一个资产重复关联；确实不同就分别补充资料后重新生成',
  ],
  server_blocked: [
    '按上面的原因补齐对应资料后重新生成提示词',
    '补齐前不要出图：这次出图会浪费一次计费调用',
  ],
}

/** 通用摄影 / 画质 / 构图词（它们**不**含外观信息，判定"只有名称+通用词"时会被剥掉）。 */
export const GENERIC_PROMPT_TOKENS: string[] = [
  // —— 后端 `asset_prompt_quality.GENERIC_PROMPT_WORDS` 的那一份（同口径，避免两边判定不一致）——
  // 画幅/景别
  '大特写',
  '中近景',
  '特写',
  '近景',
  '中景',
  '全景',
  '远景',
  '广角',
  'establishing',
  'close-up',
  'close up',
  'medium shot',
  'wide shot',
  'full shot',
  'full body',
  'half body',
  'extreme close-up',
  // 机位/角度
  '平视',
  '俯拍',
  '仰拍',
  '俯视',
  '仰视',
  '过肩',
  'eye level',
  'high angle',
  'low angle',
  'over the shoulder',
  'bird eye',
  // 视角/展示
  '斜侧',
  '正面',
  '侧面',
  '背面',
  '全身',
  '半身',
  'front view',
  'side view',
  'back view',
  'three quarter',
  'reference sheet',
  'reference image',
  '参考图',
  '设定图',
  '资产图',
  '展示',
  '视角',
  '构图',
  '画面',
  '镜头',
  '机位',
  // 光线/画质/风格
  '柔和主光',
  '柔和光',
  '主光',
  '侧光',
  '顺光',
  '逆光',
  '顶光',
  '自然光',
  '打光',
  '超清',
  '高清',
  '高分辨率',
  '清晰',
  '锐利',
  '写实',
  '真实',
  '照片级',
  '电影质感',
  '电影感',
  'cinematic',
  'photorealistic',
  'photoreal',
  'sharp focus',
  'high resolution',
  'detailed skin texture',
  'high consistency',
  'realistic',
  'live-action',
  'live action',
  'real human actor',
  'short drama style',
  'style',
  // 背景/底色
  '干净背景',
  '白色背景',
  '纯白背景',
  '纯色背景',
  '浅灰色背景',
  '中性背景',
  '无背景',
  '留白',
  'clean white background',
  'clean neutral background',
  'clean background',
  'white background',
  'neutral background',
  'plain background',
  'isolated',
  // 负面/排除
  '不要文字',
  '不要水印',
  '无文字',
  '无水印',
  'no text',
  'no watermark',
  'no logo',
  // —— 前端补的英文画质词（后端默认画质词也在这里兜住）——
  'cinematic lighting',
  'detailed',
  '8k',
  '4k',
  'uhd',
  'masterpiece',
  'best quality',
  'highly detailed',
  'ultra detailed',
  'professional photography',
  'depth of field',
  'bokeh',
  'studio lighting',
  'simple background',
  '真实光影',
  '写实风格',
  '超写实',
  '细节丰富',
  '浅景深',
  '景深',
  '虚化',
  '影棚打光',
  '影棚布光',
  '背景干净',
  '正面全身参考图',
  '正面参考图',
  '正面全身',
  '正面半身',
  '正脸半身',
  '画面比例',
]

/** 「外观信息不足」的模板痕迹 / 后端提示词里会出现的说法。 */
export const INSUFFICIENT_APPEARANCE_MARKERS: string[] = [
  '外观信息不足',
  '外观资料不足',
  '信息不足',
  '需人工补充',
  '待人工补充',
  '需要人工补充',
  '待补充',
  '待完善',
  '占位',
  '待模型生成',
  '主体描述待',
  '动作姿态待',
  '场景环境待',
  '缺少外观',
  '无法确定外观',
]

/**
 * 「只有名称 + 通用摄影词」判定的**特征字数下限**。
 *
 * **刻意压到 2**：与后端 `asset_prompt_quality.MIN_SPECIFIC_CHARS = 2` **同一口径**。
 * 这条规则要拦的是**零特征**的内容（资产名 + 景别 + 背景 + 画质词，去掉通用词后一个字都不剩），
 * 而不是给"描述得够不够细"打分 —— 阈值抬高会误伤人工精心写过的短提示词
 * （后端注释里写得很明确：`「雨夜咖啡店，木质吧台」` 这种短文必须放行）。
 *
 * 也就是说：**能拦多严以后端为准**，前端只是后端字段还没上线时的兜底自查。
 */
export const MIN_INFORMATIVE_CORE_LENGTH = 2

/** 两个资产的提示词相似到什么程度算「高度重复」。 */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.9

/**
 * 主界面上**不许**出现的说法（把不可用说成就绪）。
 *
 * ⚠️ 这是**禁语表本身**：数组里必须把被禁的说法原样写出来，否则无从检查。
 * 它属于「词表定义行」的结构性豁免（验收测试 `userFacingCopy.test.ts` 的
 * `TERM_TABLE_CONSTANTS` 已登记），所以里面出现「生成依据」不算主区泄漏 ——
 * 不要为了避开扫描而把表项换成一句没人会写的占位文案。
 */
export const FORBIDDEN_READY_COPY = ['已就绪', '提示词已就绪', '生成依据已就绪']

/** 文案里是否出现了"说成就绪"的说法（测试与自检用）。 */
export function findReadyCopy(text: string): string[] {
  const raw = String(text ?? '')
  return FORBIDDEN_READY_COPY.filter((token) => raw.includes(token))
}

/* ------------------------------------------------------------------ 判定工具 */

function normalizeForCompare(text: string): string {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：,.;:!！?？"'“”‘’()（）[\]【】{}<>《》/\\|+*~`\-—_]/g, '')
}

/**
 * 去掉「通用摄影/画质/构图词 + 资产名」之后剩下的**有信息量的正文**。
 *
 * 这一段才是决定"这个人长什么样 / 这个场景是什么样"的内容；
 * 它太短就说明提示词只有名字和通用词。
 */
export function extractInformativeCore(prompt: string, assetName = ''): string {
  let text = String(prompt ?? '')
  if (!text.trim()) return ''
  const name = String(assetName ?? '').trim()
  if (name) text = text.split(name).join('')
  // 长词先剥（避免 "正面全身参考图" 被 "正面" 先吃掉半截）
  const tokens = [...GENERIC_PROMPT_TOKENS].sort((a, b) => b.length - a.length)
  tokens.forEach((token) => {
    text = text.split(token).join('')
    text = text.split(token.toUpperCase()).join('')
    text = text.split(token.replace(/\s+/g, '')).join('')
  })
  // 数字**不剥**：`35 岁` 这种也是该资产的特征（后端 normalize_for_compare 同样保留数字）
  return text
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。、；：,.;:!！?？"'“”‘’()（）[\]【】{}<>《》/\\|+*~`\-—_=#$%^&@]/g, '')
}

/** 字符 2-gram 集合相似度（Levenshtein 太重，这里用 Jaccard 足够判"高度重复"）。 */
export function promptSimilarity(a: string, b: string): number {
  const left = normalizeForCompare(a)
  const right = normalizeForCompare(b)
  if (!left && !right) return 1
  if (!left || !right) return 0
  if (left === right) return 1
  const grams = (text: string): Set<string> => {
    const set = new Set<string>()
    if (text.length === 1) set.add(text)
    for (let index = 0; index + 1 < text.length; index += 1) set.add(text.slice(index, index + 2))
    return set
  }
  const ga = grams(left)
  const gb = grams(right)
  let intersection = 0
  ga.forEach((gram) => {
    if (gb.has(gram)) intersection += 1
  })
  const union = ga.size + gb.size - intersection
  return union === 0 ? 0 : intersection / union
}

export type DuplicateGroup = { normalized: string; indexes: number[] }

/**
 * 在一组（不同资产的）提示词里找出**高度重复**的那些。
 *
 * 为什么必须跨资产查：同一个模板给每个资产各套一遍时，
 * 单看一条提示词是"完整"的，只有放在一起才看得出它们其实是同一条。
 */
export function findDuplicatedPromptIndexes(
  prompts: readonly (string | null | undefined)[],
  assetNames: readonly string[] = [],
): number[] {
  const entries = prompts.map((prompt, index) => ({
    index,
    prompt: String(prompt ?? ''),
    name: String(assetNames[index] ?? ''),
  }))
  const duplicates = new Set<number>()
  for (let i = 0; i < entries.length; i += 1) {
    const current = entries[i]
    if (!current.prompt.trim()) continue
    for (let j = i + 1; j < entries.length; j += 1) {
      const other = entries[j]
      if (!other.prompt.trim()) continue
      // 同一个资产（同一把 key 的名字也一样）不算"多个资产重复"
      if (current.name && other.name && current.name === other.name) continue
      if (promptSimilarity(current.prompt, other.prompt) >= DUPLICATE_SIMILARITY_THRESHOLD) {
        duplicates.add(current.index)
        duplicates.add(other.index)
      }
    }
  }
  return Array.from(duplicates).sort((a, b) => a - b)
}

/** 后端结构化判定的**读取**（字段名容错；读不到返回 null）。 */
export type ServerPromptQuality = {
  usable: boolean | null
  code: PromptQualityCode | ''
  label: string
  reasons: string[]
  fixes: string[]
  raw: unknown
}

const QUALITY_CONTAINER_KEYS = [
  'quality',
  'prompt_quality',
  'promptQuality',
  'quality_gate',
  'qualityGate',
  'prompt_quality_gate',
  'promptQualityGate',
  'usability',
]

const SERVER_CODE_ALIASES: Record<string, PromptQualityCode> = {
  // —— 后端 `asset_prompt_quality` 的错误码（**权威口径**）——
  empty_prompt: 'empty',
  vague_filler: 'insufficient_appearance',
  name_only_generic: 'generic_only',
  duplicate_prompt_text: 'duplicated',
  near_duplicate_prompt_text: 'duplicated',
  // —— 其它可能的写法（容错）——
  empty: 'empty',
  blank: 'empty',
  prompt_empty: 'empty',
  missing_prompt: 'empty',
  insufficient_appearance: 'insufficient_appearance',
  appearance_insufficient: 'insufficient_appearance',
  insufficient_appearance_info: 'insufficient_appearance',
  need_manual_supplement: 'insufficient_appearance',
  needs_manual_supplement: 'insufficient_appearance',
  manual_supplement_required: 'insufficient_appearance',
  generic: 'generic_only',
  generic_only: 'generic_only',
  template_only: 'generic_only',
  name_and_generic_only: 'generic_only',
  duplicate: 'duplicated',
  duplicated: 'duplicated',
  high_similarity: 'duplicated',
  too_similar: 'duplicated',
  blocked: 'server_blocked',
  unusable: 'server_blocked',
  not_usable: 'server_blocked',
  low_quality: 'server_blocked',
}

function readStringList(value: unknown): string[] {
  if (value === null || value === undefined) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .map((item) => {
      if (typeof item === 'string') return item.trim()
      if (typeof item === 'number') return String(item)
      if (item && typeof item === 'object') {
        const record = item as Record<string, unknown>
        return String(record.message ?? record.text ?? record.reason ?? record.label ?? '').trim()
      }
      return ''
    })
    .filter((item) => item.length > 0)
}

/**
 * 后端「结构化中文错误」的读取（先看对象，再退回字符串里的 JSON）。
 *
 * 后端的错误体是 `{code, message, fix, status_code, ...}`（`PromptQualityIssue.to_read()`），
 * 前端要么直接拿到对象（回包里的 `quality_issues`），要么拿到被拼进消息里的 JSON
 * （保存失败时 `callApi` 会把 `detail` 一起拼进错误文本）。两种都要读得出来。
 */
export type StructuredServerError = {
  code: string
  message: string
  fix: string
  statusCode: number | null
  /** 后端要求的"显式确认覆盖"字段名（409 image_prompt_replace_required 会给） */
  confirmField: string
}

export function readStructuredServerError(value: unknown): StructuredServerError {
  const empty: StructuredServerError = { code: '', message: '', fix: '', statusCode: null, confirmField: '' }
  const fromRecord = (record: Record<string, unknown>): StructuredServerError => ({
    code: String(record.code ?? '').trim(),
    message: String(record.message ?? record.detail ?? record.text ?? '').trim(),
    fix: String(record.fix ?? '').trim(),
    statusCode: typeof record.status_code === 'number' ? record.status_code : null,
    confirmField: String(record.confirm_field ?? '').trim(),
  })
  /** 从文本里把被拼进去的 JSON 抠出来（`callApi` 会把 detail 一起拼进错误消息）。 */
  const fromText = (text: string): StructuredServerError => {
    const trimmed = String(text ?? '').trim()
    if (!trimmed) return empty
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
        const direct = fromRecord(parsed)
        if (direct.code || direct.message || direct.fix) return direct
        const nested = parsed.detail
        if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
          const inner = fromRecord(nested as Record<string, unknown>)
          if (inner.code || inner.message || inner.fix) return inner
        }
      } catch {
        // 不是 JSON：退回纯文本消息（下面统一处理）
      }
    }
    return { ...empty, message: maskInternalIds(trimmed) }
  }
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>
    const issues = Array.isArray(record.quality_issues) ? record.quality_issues : []
    if (issues.length > 0 && issues[0] && typeof issues[0] === 'object') {
      return fromRecord(issues[0] as Record<string, unknown>)
    }
    if (record.code || record.fix) return fromRecord(record)
    const nested = record.detail
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      const inner = fromRecord(nested as Record<string, unknown>)
      if (inner.code || inner.message || inner.fix) return inner
    }
    // Error 对象（或只有 message 的对象）：message 里往往还嵌着后端的 JSON
    const text = String(record.message ?? record.text ?? '').trim()
    if (text) return fromText(text)
    return empty
  }
  return fromText(String(value ?? ''))
}

/**
 * 后端回包 / 错误里的质量判定读取。
 *
 * 认的字段（**后端本轮的正式字段优先**，其余是容错）：
 *   容器：`quality` / `prompt_quality` / `quality_gate` / `usability`，或**槽位本身**
 *   结论：`savable`（后端正式字段，false = 禁止保存/批量出图）/ `usable` / `blocked` / `passed` / `status`
 *   原因：`quality_issues`（后端正式字段：`[{code, message, fix, status_code}]`）
 *        / `reasons` / `blocking_reasons` / `issues` / `errors` / `messages`
 */
export function readServerPromptQuality(payload: unknown): ServerPromptQuality | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const root = payload as Record<string, unknown>
  const candidates: Record<string, unknown>[] = []
  QUALITY_CONTAINER_KEYS.forEach((key) => {
    const value = root[key]
    if (value && typeof value === 'object' && !Array.isArray(value)) candidates.push(value as Record<string, unknown>)
  })
  ;(['meta', 'slot', 'result', 'data'] as const).forEach((wrapper) => {
    const inner = root[wrapper]
    if (!inner || typeof inner !== 'object' || Array.isArray(inner)) return
    const record = inner as Record<string, unknown>
    QUALITY_CONTAINER_KEYS.forEach((key) => {
      const value = record[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) candidates.push(value as Record<string, unknown>)
    })
  })
  // 回包（或槽位）本身就带了 savable / usable / quality_issues 这类字段
  const rootHasVerdict = [
    'savable',
    'is_savable',
    'usable',
    'is_usable',
    'isUsable',
    'prompt_usable',
    'passed',
    'blocked',
    'quality_issues',
  ].some((key) => Object.prototype.hasOwnProperty.call(root, key))
  if (rootHasVerdict) candidates.push(root)
  if (candidates.length === 0) return null

  const raw = candidates[0]
  const usableRaw = raw.savable ?? raw.is_savable ?? raw.usable ?? raw.is_usable ?? raw.isUsable ?? raw.prompt_usable
  let usable: boolean | null = typeof usableRaw === 'boolean' ? usableRaw : null
  if (usable === null && typeof raw.blocked === 'boolean') usable = raw.blocked !== true
  if (usable === null && typeof raw.passed === 'boolean') usable = raw.passed === true
  if (usable === null && typeof raw.ok === 'boolean') usable = raw.ok === true
  const statusRaw = String(raw.status ?? '').trim().toLowerCase()
  if (usable === null && statusRaw) {
    if (['unusable', 'blocked', 'failed', 'error', 'needs_manual_supplement', 'manual_required'].includes(statusRaw)) {
      usable = false
    } else if (['usable', 'ok', 'passed', 'ready'].includes(statusRaw)) {
      usable = true
    }
  }

  // 后端正式字段 `quality_issues`：每一条都有自己的 code / message / fix
  const rawIssues = Array.isArray(raw.quality_issues) ? (raw.quality_issues as unknown[]) : []
  const issueRecords = rawIssues.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item),
  )
  const issueCodes = issueRecords.map((item) => String(item.code ?? '').trim()).filter((item) => item.length > 0)

  const codeRawList = issueCodes.length
    ? issueCodes
    : Array.isArray(raw.codes)
      ? raw.codes
      : Array.isArray(raw.code)
        ? raw.code
        : [raw.code]
  let code: PromptQualityCode | '' = ''
  codeRawList.forEach((item) => {
    if (code) return
    const text = String(item ?? '').trim().toLowerCase()
    if (!text) return
    code = SERVER_CODE_ALIASES[text] ?? ''
  })
  const reasons = [
    ...issueRecords.map((item) => String(item.message ?? '').trim()),
    ...readStringList(raw.blocking_reasons ?? raw.blocked_reasons ?? raw.blockingReasons),
    ...readStringList(
      raw.reasons ?? raw.reason ?? raw.issues ?? raw.errors ?? raw.problems ?? raw.messages ?? raw.message ?? raw.detail,
    ),
  ].filter((item) => item.length > 0)
  const fixes = [
    ...issueRecords.map((item) => String(item.fix ?? '').trim()),
    ...readStringList(raw.fixes ?? raw.how_to_fix ?? raw.howToFix),
    ...readStringList(raw.suggestions ?? raw.fix_suggestions ?? raw.next_steps),
  ].filter((item) => item.length > 0)
  const label = String(raw.label ?? raw.title ?? raw.message ?? '').trim()
  if (usable === null && reasons.length === 0 && fixes.length === 0 && !code && !label) return null
  if (!code && usable === false) code = 'server_blocked'
  return { usable, code, label, reasons, fixes, raw }
}

/* -------------------------------------------------------------- 判定（对外） */

export type PromptQualityInput = {
  /** 本次实际会送出去的提示词；null / undefined = 调用方拿不到（→ unknown） */
  prompt?: string | null
  /** 资产名（剥通用词时要把它去掉，避免"名字本身"被当成外观信息） */
  assetName?: string
  /** 后端结构化判定（`readServerPromptQuality` 的结果，或原始回包片段） */
  serverQuality?: unknown
  /** 后端给的告警原文（没有结构化判定时也会被扫一遍中文标记） */
  serverWarnings?: readonly string[]
  /** 同一批里**其它资产**的提示词（判"多个资产高度重复"用） */
  peerPrompts?: readonly string[]
  /** 自己是否已被跨资产重复检测命中 */
  duplicated?: boolean
}

function maskAll(list: readonly string[]): string[] {
  return list.map((item) => maskInternalIds(item).trim()).filter((item) => item.length > 0)
}

function markerHit(texts: readonly string[]): string {
  const joined = texts.join(' ｜ ')
  return INSUFFICIENT_APPEARANCE_MARKERS.find((marker) => joined.includes(marker)) ?? ''
}

function usableVerdict(): PromptQualityVerdict {
  return {
    status: 'usable',
    usable: true,
    code: '',
    label: PROMPT_QUALITY_STATUS_LABEL.usable,
    reason: '这条提示词里写了主体的外观描述（不是只有名称和通用摄影词），可以按它出图。',
    fixes: [],
    source: 'local',
    rawReasons: [],
  }
}

function unknownVerdict(reason: string): PromptQualityVerdict {
  return {
    status: 'unknown',
    usable: false,
    code: '',
    label: PROMPT_QUALITY_STATUS_LABEL.unknown,
    reason,
    fixes: ['先点该项的「填提示词」确认一下内容，再决定要不要出图'],
    source: 'none',
    rawReasons: [],
  }
}

function unusableVerdict(
  code: PromptQualityCode,
  reason: string,
  options: { source: PromptQualityVerdict['source']; fixes?: readonly string[]; rawReasons?: readonly string[] },
): PromptQualityVerdict {
  return {
    status: 'unusable',
    usable: false,
    code,
    label: PROMPT_QUALITY_CODE_LABEL[code],
    reason: maskInternalIds(reason),
    fixes: maskAll(options.fixes && options.fixes.length > 0 ? options.fixes : PROMPT_QUALITY_FIXES[code]),
    source: options.source,
    rawReasons: maskAll(options.rawReasons ?? []),
  }
}

/**
 * 一条提示词能不能用于出图：**后端判定优先，前端自查兜底，不确定就不宣称可用**。
 *
 * 顺序（每一步都有单测）：
 *   1. 后端明确说不可以用 → 不可用（用后端的中文原因）；
 *   2. 本地判空 → 不可用（空）；
 *   3. 本地/后端文本里出现「外观信息不足、需人工补充」这类标记 → 不可用；
 *   4. 后端明确说可用 → 可用（也可能被 2、3 先行推翻）；
 *   5. 本地判「只有名称 + 通用摄影词」→ 不可用；
 *   6. 跨资产高度重复 → 不可用；
 *   7. 都不命中且提示词非空且含外观信息 → 可用；
 *   8. 拿不到提示词内容 → 未知（不冒充可用，也不编造原因）。
 */
export function resolvePromptQuality(input: PromptQualityInput): PromptQualityVerdict {
  const server = readServerPromptQuality(input.serverQuality)
  const warnings = maskAll([...(input.serverWarnings ?? []), ...(server?.reasons ?? [])])
  const rawPrompt = input.prompt
  const prompt = typeof rawPrompt === 'string' ? rawPrompt : ''
  const knowsPrompt = typeof rawPrompt === 'string'

  if (server && server.usable === false) {
    const detail = warnings[0] ?? server.label ?? ''
    const code: PromptQualityCode = server.code || 'server_blocked'
    return unusableVerdict(
      code,
      detail ||
        `${PROMPT_QUALITY_CODE_LABEL[code]}：服务端判定这条提示词不能用于出图。`,
      { source: 'server', fixes: server.fixes, rawReasons: warnings },
    )
  }

  if (knowsPrompt && !prompt.trim()) {
    return unusableVerdict('empty', '这一项还没有提示词内容。', { source: 'local', rawReasons: warnings })
  }

  const marker = markerHit([prompt, ...warnings])
  if (marker) {
    const detail = warnings.find((item) => INSUFFICIENT_APPEARANCE_MARKERS.some((m) => item.includes(m)))
    return unusableVerdict(
      'insufficient_appearance',
      detail ? `服务端标注：${detail}` : `这条提示词里有「${marker}」的痕迹：主体的外观信息不够，需要你先补充。`,
      { source: detail ? 'server' : 'local', rawReasons: warnings },
    )
  }

  if (server && server.usable === true) {
    const ok = usableVerdict()
    return { ...ok, source: 'server', label: server.label || ok.label }
  }

  if (knowsPrompt) {
    const core = extractInformativeCore(prompt, input.assetName ?? '')
    if (prompt.trim() && core.length < MIN_INFORMATIVE_CORE_LENGTH) {
      return unusableVerdict(
        'generic_only',
        `这条提示词去掉名称与通用摄影词之后只剩 ${core.length} 个字，说明没有写清主体长什么样。`,
        { source: 'local', rawReasons: warnings },
      )
    }
  }

  if (input.duplicated === true) {
    return unusableVerdict('duplicated', '这条提示词与同一批里其它资产高度重复（同一个模板套出来的）。', {
      source: 'local',
      rawReasons: warnings,
    })
  }

  if (knowsPrompt && prompt.trim()) {
    const verdict = usableVerdict()
    return { ...verdict, rawReasons: warnings }
  }

  return unknownVerdict('这次没有拿到这一项的提示词内容，无法判断它能不能用于出图。')
}

/** 质量判定 → 页面提示（批量面板与卡片共用同一份文案）。 */
export type PromptQualityNotice = {
  tone: 'error' | 'warning' | 'info'
  title: string
  /** 正文行（原因 + 怎么修） */
  lines: string[]
  /** 是否允许按这条提示词出图 */
  canGenerate: boolean
}

export function buildQualityNotice(verdict: PromptQualityVerdict): PromptQualityNotice {
  if (verdict.status === 'usable') {
    return {
      tone: 'info',
      title: '提示词包含外观信息',
      lines: [verdict.reason],
      canGenerate: true,
    }
  }
  if (verdict.status === 'unknown') {
    return {
      tone: 'warning',
      title: PROMPT_QUALITY_STATUS_LABEL.unknown,
      lines: [verdict.reason, ...verdict.fixes.map((fix) => `怎么处理：${fix}`)],
      // 未知不硬拦（拿不到数据不该让整批点不动），但页面明确写"未知"，绝不写成就绪
      canGenerate: true,
    }
  }
  return {
    tone: 'error',
    title: `${PROMPT_QUALITY_STATUS_LABEL.unusable}：${verdict.label}`,
    lines: [`原因：${verdict.reason}`, ...verdict.fixes.map((fix) => `怎么修：${fix}`)],
    canGenerate: false,
  }
}

/**
 * 保存提示词失败时的**用户可见文案**。
 *
 * 后端的 409/422 都带结构化中文（`code` / `message` / `fix`），优先用它：
 *   - `image_prompt_replace_required`（409）：已有提示词默认不动，要覆盖必须显式确认；
 *   - `empty_prompt` / `vague_filler` / `name_only_generic`（422）：质量拦截；
 *   - `duplicate_prompt_text` / `near_duplicate_prompt_text`（409）：跨资产重复。
 * 读不出结构化信息时退回原文（已屏蔽内部标识），绝不编造原因。
 */
export function describePromptSaveFailure(error: unknown): {
  code: string
  message: string
  fix: string
  /** 需要用户**显式确认覆盖**（页面据此提示"再点一次确认覆盖"） */
  needsConfirm: boolean
} {
  const raw =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : String(error ?? '')
  const structured = readStructuredServerError(error)
  const fallback = readStructuredServerError(raw)
  const picked = structured.code || structured.message ? structured : fallback
  const message =
    picked.message || `保存提示词失败：${maskInternalIds(raw).trim() || '服务没有给出原因'}`
  return {
    code: picked.code,
    message,
    fix: picked.fix,
    needsConfirm: picked.code === 'image_prompt_replace_required',
  }
}

/* ---------------------------------------------------------------- 批量拦截 */

export type PromptQualityGateAsset = {
  key: string
  id: string
  type: string
  name: string
}

export type PromptQualityGateItem<T extends PromptQualityGateAsset> = {
  asset: T
  prompt: string
  verdict: PromptQualityVerdict
}

export type BatchPromptQualityGate<T extends PromptQualityGateAsset> = {
  /** 不可用（必须拦住） */
  blocked: PromptQualityGateItem<T>[]
  /** 判定为可用 */
  allowed: PromptQualityGateItem<T>[]
  /** 判不出来（不拦，但页面要写明"未知"） */
  unknown: PromptQualityGateItem<T>[]
  /** 其它资产是否与本批高度重复（技术详情用） */
  duplicatedKeys: string[]
}

/**
 * 批量出图前的**质量闸门**：按资产算出"这一条提示词能不能用"。
 *
 * `promptFor(asset)` 返回**本次实际会送出去的**那条提示词
 * （手工改过的优先，其次只读计划里会给的那条）；返回 `null` 表示调用方也拿不到 →
 * 该项进 `unknown`，不硬拦但页面写明未知。
 */
export function buildBatchPromptQualityGate<T extends PromptQualityGateAsset>(args: {
  assets: readonly T[]
  promptFor: (asset: T) => string | null | undefined
  serverQualityFor?: (asset: T) => unknown
  serverWarningsFor?: (asset: T) => readonly string[] | undefined
}): BatchPromptQualityGate<T> {
  const { assets, promptFor, serverQualityFor, serverWarningsFor } = args
  const prompts = assets.map((asset) => {
    const value = promptFor(asset)
    return typeof value === 'string' ? value : null
  })
  const duplicatedIndexes = new Set(
    findDuplicatedPromptIndexes(
      prompts,
      assets.map((asset) => asset.name),
    ),
  )
  const blocked: PromptQualityGateItem<T>[] = []
  const allowed: PromptQualityGateItem<T>[] = []
  const unknown: PromptQualityGateItem<T>[] = []
  const duplicatedKeys: string[] = []
  assets.forEach((asset, index) => {
    const duplicated = duplicatedIndexes.has(index)
    if (duplicated) duplicatedKeys.push(asset.key)
    const verdict = resolvePromptQuality({
      prompt: prompts[index],
      assetName: asset.name,
      serverQuality: serverQualityFor?.(asset),
      serverWarnings: serverWarningsFor?.(asset),
      duplicated,
      peerPrompts: prompts.filter((_, other) => other !== index).map((item) => item ?? ''),
    })
    const item: PromptQualityGateItem<T> = { asset, prompt: prompts[index] ?? '', verdict }
    if (verdict.status === 'unusable') blocked.push(item)
    else if (verdict.status === 'unknown') unknown.push(item)
    else allowed.push(item)
  })
  return { blocked, allowed, unknown, duplicatedKeys }
}

export type PromptQualityGateModal = {
  title: string
  lines: string[]
  /** 空串 = 不显示"继续"按钮（整批都不可用时只能先去修） */
  okText: string
  cancelText: string
  /** 整批都不可用（页面据此只给"知道了"） */
  blockedAll: boolean
}

/**
 * 质量闸门里**允许提交**的资产：可用 + 判不出来（unknown 不硬拦，但页面已写明"未知"）。
 *
 * 不可用的项一个都不提交 —— 这就是「前端先拦」的那一刀（后端还会再兜一层）。
 */
export function selectAssetsForSubmit<T extends PromptQualityGateAsset>(
  gate: BatchPromptQualityGate<T>,
): T[] {
  return [...gate.allowed, ...gate.unknown].map((item) => item.asset)
}

/** 质量闸门 → 二次确认框文案（把"哪一项、为什么、怎么修、跳过多少"说清楚）。 */
export function buildPromptQualityGateModal<T extends PromptQualityGateAsset>(
  gate: BatchPromptQualityGate<T>,
  options: { typeLabel?: (type: string) => string } = {},
): PromptQualityGateModal {
  const typeLabel =
    /* 未登记的类型码也不回显原值（审计 §1.2 模式 3 的同型兜底，与 assetPromptSlots 同口径） */
    options.typeLabel ??
    ((type: string) => ASSET_PROMPT_TYPE_LABEL[type as keyof typeof ASSET_PROMPT_TYPE_LABEL] ?? '其它类型')
  const blocked = gate.blocked
  const lines: string[] = []
  if (blocked.length > 0) {
    lines.push(`有 ${blocked.length} 项资产的提示词不可用，不能直接拿去出图：`)
    blocked.forEach((item) => {
      lines.push(`${item.asset.name}（${typeLabel(item.asset.type)}）：${item.verdict.reason}`)
      item.verdict.fixes.forEach((fix) => lines.push(`　怎么修：${fix}`))
    })
  }
  if (gate.unknown.length > 0) {
    lines.push(
      `另有 ${gate.unknown.length} 项没有拿到提示词内容，无法判断能不能用（不会假装可用）：` +
        gate.unknown.map((item) => item.asset.name).join('、'),
    )
  }
  const blockedAll = blocked.length > 0 && gate.allowed.length === 0 && gate.unknown.length === 0
  return {
    title:
      blocked.length > 0
        ? `有 ${blocked.length} 项资产的提示词不可用，不能直接出图`
        : '这一批的提示词都还需要确认',
    lines,
    okText:
      blocked.length === 0
        ? '知道了'
        : blockedAll
          ? '知道了（先去补提示词）'
          : `只生成可用的另外 ${gate.allowed.length} 项（跳过这 ${blocked.length} 项）`,
    cancelText: blocked.length > 0 && !blockedAll ? '先去补提示词' : '',
    blockedAll,
  }
}

/* -------------------------------------------------- 提示词面板（大模型）展示 */

export type PromptPanelRowLike = {
  name: string
  type: string
  prompt?: string
  draft?: string
  existing?: string
}

/**
 * 大模型提示词面板里一行的质量展示（**不许把不可用写成就绪**）。
 *
 * 优先看本次草稿，其次看已保存的那条；两者都没有时按"未知"处理。
 */
export function describePromptPanelRowQuality(
  row: PromptPanelRowLike,
  options: { serverQuality?: unknown; serverWarnings?: readonly string[] } = {},
): PromptQualityVerdict {
  const draft = String(row.draft ?? '').trim()
  const existing = String(row.existing ?? '').trim()
  const prompt = draft || existing
  const hasAny = Boolean(prompt)
  return resolvePromptQuality({
    prompt: hasAny ? prompt : null,
    assetName: row.name,
    serverQuality: options.serverQuality,
    serverWarnings: options.serverWarnings,
  })
}

/** 面板里「保存到资产」是否该禁用（不可用的提示词不进资产，避免后面被当成可用提示词）。 */
export function canSavePromptToAsset(verdict: PromptQualityVerdict, draft: string): boolean {
  if (!String(draft ?? '').trim()) return false
  return verdict.status !== 'unusable'
}

/* ------------------------------------------- ⑤ 最终提示词之间的差异（批量视图） */

export type PromptDifferenceRow = {
  key: string
  name: string
  typeLabel: string
  prompt: string
  /** 与其它资产的最高相似度（0~1；没有可比对象时为 null） */
  maxSimilarity: number | null
  /** 与谁最像（最高相似度的那一项） */
  closestName: string
  /** 相似度是否已经达到"高度重复" */
  duplicated: boolean
  /** 一行差异说明（页面直接展示） */
  diffLine: string
}

/**
 * ⑤「最终四条提示词及差异」：把本次生成的每条提示词与其它资产的差异算出来。
 *
 * 为什么要有这块：验收要核对"四个资产的提示词**确实不同**"，
 * 而这件事**单看一条提示词是看不出来的** —— 必须并排比。
 * 相似度用 `promptSimilarity`（与质量拦截同一把尺子），达到阈值就点名"高度重复"。
 */
export function summarizePromptDifferences(
  items: readonly { key: string; name: string; type: string; prompt: string }[],
  options: { typeLabel?: (type: string) => string } = {},
): PromptDifferenceRow[] {
  const typeLabel =
    /* 未登记的类型码也不回显原值（审计 §1.2 模式 3 的同型兜底，与 assetPromptSlots 同口径） */
    options.typeLabel ??
    ((type: string) => ASSET_PROMPT_TYPE_LABEL[type as keyof typeof ASSET_PROMPT_TYPE_LABEL] ?? '其它类型')
  return items.map((item, index) => {
    let maxSimilarity: number | null = null
    let closestName = ''
    items.forEach((other, otherIndex) => {
      if (otherIndex === index) return
      if (!String(item.prompt ?? '').trim() || !String(other.prompt ?? '').trim()) return
      const similarity = promptSimilarity(item.prompt, other.prompt)
      if (maxSimilarity === null || similarity > maxSimilarity) {
        maxSimilarity = similarity
        closestName = other.name
      }
    })
    const duplicated = maxSimilarity !== null && maxSimilarity >= DUPLICATE_SIMILARITY_THRESHOLD
    return {
      key: item.key,
      name: item.name,
      typeLabel: typeLabel(item.type),
      prompt: String(item.prompt ?? '').trim(),
      maxSimilarity,
      closestName,
      duplicated,
      diffLine:
        maxSimilarity === null
          ? '没有可对比的其它资产（本批只有这一条或它还是空的）'
          : `与「${closestName}」相似度 ${Math.round(maxSimilarity * 100)}%${
              duplicated ? '（高度重复：模板套用，必须分别改）' : '（差异明显）'
            }`,
    }
  })
}

/** ⑤ 的差异说明列表（喂给「生成依据」面板的那一项）。 */
export function buildPromptDifferenceLines(rows: readonly PromptDifferenceRow[]): string[] {
  return rows.map((row) => `${row.name}（${row.typeLabel}）：${row.diffLine}`)
}
