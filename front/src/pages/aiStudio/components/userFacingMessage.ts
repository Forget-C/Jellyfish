/**
 * 统一的「用户可见 message」包装层 + 业务化改写层（阶段 B ①共享基建）。
 *
 * ## 为什么需要它
 *
 * 审计文档 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md` 统计出
 * **模式 6（后端原文直渲）74 条**，其中约 20 条是 `catch → message.error(err.message)`
 * 的同型复制（§3.1）。所以修法不能逐个改调用点，而要改**管道**：
 * 管道改完后，大量 `message.error(后端原文)` 的调用点自动受益（§7.1-5）。
 *
 * ## 固定的三级顺序（顺序不能换，§7.1-6）
 *
 * ```
 * ① maskInternalIds       去 ID：UUID / file_id= / storage_key= / 裸字段名
 * ② sanitizeUserText      去内部术语句：DRY_RUN / JELLYFISH_ / 门禁 / 模型名 …
 * ③ humanizeBackendMessage 业务化改写：把后端措辞换成前端自己的中文结论
 * ④ 用户兜底中文          三步都过完仍不干净 → USER_FACING_FALLBACK
 * ```
 *
 * ⚠️ 为什么必须有第 ③ 步（运行时验证得出的硬要求，§5.5-G）：
 * `maskInternalIds` 的职责边界是**只做 ID 掩码与字段名替换，不改写后端原始措辞**。
 * 实例：后端 `该帧槽位没有 file_id：请先上传或生成该帧。`
 * → 掩码后 `该帧槽位没有 文件编号：请先上传或生成该帧。`
 * —— `file_id` 换掉了 ✅，但「**槽位**」这个禁词原样留下，整句也仍是后端措辞。
 *
 * ## 两层输出（审计 §2.1 三层信息模型）
 *
 * - **主区**：只出 `title`（一句中文结论，用户要决定的事）；
 * - **技术详情层**：`detail` 是掩码 + 洗过之后的原文，供默认收起的折叠区展开查看。
 *
 * 本模块**不 import React / antd 于模块顶层**（`node --test` 要能直接加载），
 * toast 所需的 antd `message` 在**调用时**动态 import。
 */

import { maskInternalIds } from './maskInternalIds.ts'
import { sanitizeUserText } from '../project/ProjectWorkbench/components/userFacingStatus.ts'
import { FRAME_TYPE, REFERENCE_MODE, labelFor } from './enumLabels.ts'

/** 三步都过完仍不干净时的中文兜底（**绝不把原文漏给用户**）。 */
export const USER_FACING_FALLBACK = '这一步没有成功，请稍后重试，或展开「技术详情」查看原始信息。'

/** 技术详情层用的指路说明（主区文案尾部统一带这一句，用户知道去哪看原文）。 */
export const TECHNICAL_DETAIL_HINT = '原始信息已收进「技术详情」'

/* --------------------------------------------------------------- ③ 业务化改写 */

/**
 * 整句改写规则：把后端措辞换成前端自己的中文结论。
 *
 * 每条都来自审计文档点名的运行时实例（§5.5-F/G、§4.3 的帧 / 音频 / 准备度相关），
 * 或来自后端源码里的真实字符串（`video_submit.py` / `shot_video_readiness.py`）——
 * **不是凭空编的**，所以左值同时容忍「掩码前」与「掩码后」两种写法。
 */
const SENTENCE_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly replace: string }> = [
  // ── §5.5-G / R13：帧槽位缺文件（后端 video_submit.py:158）──
  {
    pattern: /该帧(?:槽位|图片角度)\s*没有\s*(?:file_id|文件编号)[：:]\s*(?:请先上传或生成该帧。?)?/g,
    replace: '这一帧还没有文件：请先上传或生成该帧',
  },
  {
    pattern: /该帧还没有文件[：:]\s*(?:槽位|图片角度)存在但没有\s*(?:file_id|文件编号)[（(][^）)]*[）)]/g,
    replace: '这一帧还没有文件：请先上传或生成该帧',
  },
  // ── 缺帧提示（后端 prompt_board.py:1060 / video_submit.py 缺帧警告）──
  {
    pattern:
      /当前参考模式[「"][^」"]*[」"]还缺这些帧[：:]\s*[^。]*。[^。]*。?/g,
    replace: '这一镜还缺参考帧：请到「关键帧与参考图」补齐，或换一种不需要它的参考方式',
  },  {
    pattern: /缺少参考帧[：:]\s*([^\s（(]+)[（(]该帧(?:槽位|图片角度)还没有文件[）)]/g,
    replace: '缺少$1（这一帧还没有文件）',
  },
  // ── §5.5-F：音频送不出去 ──
  {
    pattern: /供应商取不到这条声音[，,]?\s*本次生成请求不会携带它。?/g,
    replace: '这条声音这次送不出去：生成服务取不到它',
  },
  // ── §4.3 模式 5：参考帧供应商取不到 ──
  {
    pattern:
      /参考(?:帧|图)(?:供应商无法访问|供应商取不到)[：:]?\s*帧文件是本机\/相对地址[^。]*。?[^。]*。?/g,
    replace: '参考图目前取不到：这张图只存在本机，上传到公网地址后再设为该帧，或改用纯文本模式',
  },
  {
    pattern: /参考帧已上传但供应商无法访问[：:]\s*/g,
    replace: '参考帧已上传但当前服务取不到：',
  },
  {
    pattern: /(首帧|尾帧|关键帧|参考帧|中间帧)供应商取不到/g,
    replace: '$1取不到（当前服务读不到这张图）',
  },
  {
    pattern: /已存在但供应商取不到/g,
    replace: '已上传但当前服务取不到这张图',
  },
  // ── §4.3 准备度（后端 shot_video_readiness.py 的 _check message）──
  { pattern: /未配置默认视频模型，无法检查供应商/g, replace: '还没有配置视频模型，无法检查生成服务' },
  { pattern: /默认视频模型不存在，无法检查供应商/g, replace: '配置的视频模型已失效，无法检查生成服务' },
  { pattern: /默认模型不是视频类别，无法检查供应商/g, replace: '配置的模型不是视频模型，无法检查生成服务' },
  { pattern: /未配置默认视频模型/g, replace: '还没有配置视频模型' },
  { pattern: /默认视频模型不存在[：:]\s*\S*/g, replace: '配置的视频模型已失效，请到「模型管理」重新指定' },
  { pattern: /默认模型不是视频类别[：:]\s*\S*/g, replace: '配置的模型不是视频模型，请到「模型管理」重新指定' },
  { pattern: /视频模型供应商不存在[：:]\s*\S*/g, replace: '视频模型对应的生成服务已失效，请到「模型管理」重新指定' },
  { pattern: /视频模型供应商缺少 api_key[：:]?\s*\S*/gi, replace: '视频模型对应的生成服务还没有配置访问密钥' },
  { pattern: /视频模型供应商可用/g, replace: '视频模型与生成服务都可用' },
  { pattern: /视频提示词为空/g, replace: '这条还没有可用的提示词' },
  { pattern: /未知参考模式[：:]\s*\S+/g, replace: '参考方式无法识别，请重新选择' },
  // ── 时长 / 画幅 ──
  {
    pattern: /请求时长\s*\d+s?\s*低于模型下限[^。]*。?/g,
    replace: '这条时长太短，已按最短时长提交',
  },
  {
    pattern: /请求时长\s*(\d+)s?\s*超出[^。]*上限\s*\d+s[^。]*。?/g,
    replace: '这条时长超出上限，已按上限 $1 秒提交',
  },
  { pattern: /未指定 ratio[^。]*。?/g, replace: '没有指定画幅，已按默认画幅提交' },
  // ── 模型 / 供应商名（模式 5）──
  {
    pattern: /模型表里没有短视频模型[「"][^」"]*[」"][^。]*。?/g,
    replace: '指定的视频方案不可用，已退回默认视频方案',
  },
  {
    pattern: /实际使用的模型[「"][^」"]*[」"]与固定策略[「"][^」"]*[」"]不一致[^。]*。?/g,
    replace: '实际使用的视频方案与既定方案不一致，请联系管理员确认',
  },
  {
    pattern: /provider[「"][^」"]*[」"]不在[^。]*白名单[^。]*。?/gi,
    replace: '当前的视频生成服务不在支持范围内，真实提交会失败，请联系管理员',
  },
  {
    pattern: /声音绑定解析失败[（(][^）)]*[）)][，,]?\s*本次生成不携带音频。?/g,
    replace: '这段声音这次送不出去：没有解析成功，本次生成不会带上它',
  },
  // ── 交付预览的后端补充说明（`prompt_delivery.py:67-68`，运行时实测上主区的那一句）──
  {
    pattern:
      /[「"“]?完整任务（含资产）[」"”]?模式的\s*(?:imported_size|imported_resolution|recommended_duration)(?:\s*[、/·]\s*(?:imported_size|imported_resolution|recommended_duration))*\s*(?:等)?\s*(?:元信息)?\s*在[^。]*?没有(?:等价列|对应字段)[，,]?\s*因此(?:未提供|没有提供)。?/g,
    replace: '「完整任务（含资产）」模式里还有几项信息本项目暂时用不到，因此没有提供',
  },
]

/** 词级改写规则（句级没命中时兜底，纯防残留禁词）。 */
const WORD_RULES: ReadonlyArray<{ readonly pattern: RegExp; readonly replace: string }> = [
  // §7.3：这两个词是 maskInternalIds 之后仍会残留的禁词
  { pattern: /推荐接口/g, replace: '推荐结果' },
  { pattern: /接口/g, replace: '服务' },
  { pattern: /槽位/g, replace: '图片角度' },
  { pattern: /供应商/g, replace: '生成服务' },
  { pattern: /后端/g, replace: '服务端' },
]

/**
 * 把枚举原值（帧类型 / 参考方式 / 任务类型）换成中文。
 *
 * 后端会在中文句子里嵌英文 code（例：`参考帧「first」不可用：…`、
 * `当前参考模式「text_only」…`、任务类型标签漏出 `video`）。
 * 这里按**词边界**替换，避免误伤 `first_frame_prompt` 这类标识符。
 */
function replaceEnumTokens(text: string): string {
  let result = text
  const groups: ReadonlyArray<{ readonly spec: typeof FRAME_TYPE; readonly only: readonly string[] }> = [
    { spec: FRAME_TYPE, only: ['first', 'last', 'key', 'keyframe', 'mid', 'middle'] },
    // 长的参考方式放前面：`first_last_key` 必须先于 `first_last` 被替换。
    { spec: REFERENCE_MODE, only: ['text_only', 'first_last_key', 'first_last'] },
  ]
  // 注意：这里**刻意不收** TASK_KIND 的 `video` / `image`——
  // 它们在 `gpt-image-2` 这种模型名里也会命中词边界，会把模型名改坏。
  // 任务类型的中文化走 `labelFor(TASK_KIND, ...)`（taskCopy.ts），不经过本函数。
  groups.forEach(({ spec, only }) => {
    only.forEach((raw) => {
      const pattern = new RegExp(`(?<![A-Za-z0-9_])${raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'gi')
      result = result.replace(pattern, () => labelFor(spec, raw))
    })
  })
  return result
}

/** 是否还残留内部标识 / 内部术语（用于决定要不要走兜底）。 */
function stillDirty(text: string): boolean {
  if (!text.trim()) return true
  if (maskInternalIds(text) !== text) return true
  if (sanitizeUserText(text, '') !== text) return true
  // 兜底再查一次「原样返回英文枚举」的可能：整句里还有下划线连写英文 code
  if (/(?<![A-Za-z0-9_])[a-z]+(?:_[a-z]+){1,}(?![A-Za-z0-9_])/.test(text)) return true
  return false
}

/**
 * **业务化改写层**：把「掩码后仍不可读 / 仍含禁词」的后端句子整体换成前端自己的中文结论。
 *
 * 输入可以是任意后端动态文本（`reason` / `warnings[]` / `excluded_reason` / `detail`）。
 * 输出保证：不含内部 ID、不含禁词、不含英文枚举原值。
 * **识别不了的原文一律原样返回**（由上层 `toUserFacingText` 决定是否换兜底），
 * 所以本函数可以安全地当作「润色器」单独使用。
 */
export function humanizeBackendMessage(text: string): string {
  let result = String(text ?? '')
  if (!result.trim()) return ''
  SENTENCE_RULES.forEach(({ pattern, replace }) => {
    result = result.replace(pattern, replace)
  })
  result = replaceEnumTokens(result)
  // 句级规则跑完仍含禁词 → 逐个词替换（宁可读起来笨一点，也不许把禁词上屏）
  const hitsWordLevel =
    /推荐接口|接口|槽位|供应商|后端/.test(result) || /(?<![A-Za-z0-9_])(?:file_id|storage_key)(?![A-Za-z0-9_])/.test(result)
  if (hitsWordLevel) {
    WORD_RULES.forEach(({ pattern, replace }) => {
      result = result.replace(pattern, replace)
    })
  }
  return result.replace(/\s{2,}/g, ' ').trim()
}

/* ------------------------------------------------------------- 三步管道出口 */

/**
 * 后端原文 → 主区可显示的一句话（四级顺序，固定）。
 *
 * 三步都过完仍不干净 → 返回 `fallback`（默认 `USER_FACING_FALLBACK`）。
 * **永不返回内部 ID / 禁词 / 英文枚举原值。**
 */
export function toUserFacingText(raw: unknown, fallback: string = USER_FACING_FALLBACK): string {
  const source =
    typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String((raw as Error)?.message ?? raw)
  if (!source.trim()) return fallback
  // ① 去 ID
  const masked = maskInternalIds(source)
  // ② 去内部术语（`sanitizeUserText` 洗完为空/仍脏时会给它自己的兜底，这里传空串以便自己判断）
  const sanitized = sanitizeUserText(masked, '')
  const base = sanitized.trim() ? sanitized : masked
  // ③ 业务化改写
  const humanized = humanizeBackendMessage(base)
  // ④ 兜底
  if (stillDirty(humanized)) return fallback
  return humanized
}

/** 主区 + 技术详情两层的结构化输出。 */
export type UserFacingMessage = {
  /** 主区：一句中文结论 */
  readonly title: string
  /** 技术详情层：掩码 + 洗过后的原文（收进默认收起的折叠区） */
  readonly detail: string
}

/**
 * 构造 `{ title, detail }`（不弹 toast，供 JSX 直接渲染 Alert / 折叠区的内容）。
 *
 * - `title` = 三步管道后的中文结论；
 * - `detail` = 原文经 `maskInternalIds` + `sanitizeUserText` 的结果（未做人话改写，
 *   保留原始措辞以便排查），原文为空时给空串。
 */
export function buildUserFacingMessage(raw: unknown, fallback: string = USER_FACING_FALLBACK): UserFacingMessage {
  const source =
    typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String((raw as Error)?.message ?? raw)
  const detail = source.trim() ? sanitizeUserText(maskInternalIds(source), '（原始信息无法读取）') : ''
  return { title: toUserFacingText(source, fallback), detail }
}

/* ------------------------------------------- 技术详情层的「最近一次原始信息」 */

export type TechnicalDetailEntry = {
  /** 主区当时给用户看的中文结论 */
  readonly title: string
  /** 掩码后的原文 */
  readonly detail: string
  /** 发生时间（ISO） */
  readonly at: string
  /** 出处的业务名（例如「生成视频」「保存声音绑定」） */
  readonly scope: string
}

/** 只保留最近 N 条，避免长期挂着内存。 */
const TECHNICAL_DETAIL_LIMIT = 20
let technicalDetailLog: TechnicalDetailEntry[] = []

/** 记一条技术详情（供默认收起的「技术详情」折叠区读取）。 */
export function rememberTechnicalDetail(entry: {
  title: string
  detail: string
  scope?: string
  at?: string
}): TechnicalDetailEntry {
  const record: TechnicalDetailEntry = {
    title: String(entry.title ?? ''),
    detail: String(entry.detail ?? ''),
    scope: String(entry.scope ?? ''),
    at: entry.at ?? new Date().toISOString(),
  }
  technicalDetailLog = [record, ...technicalDetailLog].slice(0, TECHNICAL_DETAIL_LIMIT)
  return record
}

/** 读取技术详情日志（最新在前）。 */
export function readTechnicalDetails(): readonly TechnicalDetailEntry[] {
  return technicalDetailLog
}

/** 清空技术详情日志（切换页面 / 测试用）。 */
export function clearTechnicalDetails(): void {
  technicalDetailLog = []
}

/* ------------------------------------------------------------------ toast 出口 */

type MessageKind = 'error' | 'warning' | 'info' | 'success'

/** toast 级别（`showUserConclusion` 的入参类型，导出以便调用点复用同一份级别口径）。 */
export type UserMessageKind = MessageKind

/** toast 输出接口（默认走 antd `message`；测试注入假实现以便断言「主区只出中文结论」）。 */
export type UserMessageNotifier = (kind: MessageKind, title: string) => void | Promise<void>

let notifier: UserMessageNotifier | null = null

/**
 * 注入 / 清除 toast 实现。
 *
 * 为什么做成可注入：① 本模块要被 `node --test` 直接加载，而 antd 的静态 `message`
 * 在无 DOM 的 Node 里会抛 `document is not defined`，测试必须能替换掉它；
 * ② 「主区只出中文结论」这条契约需要能被断言。
 */
export function setUserMessageNotifier(next: UserMessageNotifier | null): void {
  notifier = next
}

async function emit(kind: MessageKind, title: string): Promise<void> {
  try {
    if (notifier) {
      await notifier(kind, title)
      return
    }
    // 动态 import：本模块要被 `node --test` 直接加载，antd 不能在模块顶层被拉进来。
    const { message } = await import('antd')
    message[kind](title)
  } catch {
    // 弹提示失败绝不能让业务逻辑跟着失败（例如无 DOM 环境 / 提示组件未挂载）。
  }
}

async function show(
  kind: MessageKind,
  raw: unknown,
  fallback: string,
  scope: string,
): Promise<UserFacingMessage> {
  const result = buildUserFacingMessage(raw, fallback)
  if (result.detail) rememberTechnicalDetail({ title: result.title, detail: result.detail, scope })
  await emit(kind, result.title)
  return result
}

/**
 * 失败提示的统一出口：**主区只出中文结论，原文进技术详情**。
 *
 * 典型迁移：`message.error(err.message)` → `void showUserError(err, '保存失败')`。
 * 返回值是 `{ title, detail }`，调用方需要把 `detail` 渲染进折叠区时可以直接用。
 */
export function showUserError(raw: unknown, fallback: string, scope = ''): Promise<UserFacingMessage> {
  return show('error', raw, fallback, scope)
}

/** 需要注意的提示（同上口径；主区只出中文结论）。 */
export function showUserWarning(raw: unknown, fallback: string, scope = ''): Promise<UserFacingMessage> {
  return show('warning', raw, fallback, scope)
}

/** 中性提示。原文同样只进技术详情。 */
export function showUserInfo(raw: unknown, fallback: string, scope = ''): Promise<UserFacingMessage> {
  return show('info', raw, fallback, scope)
}

/** 成功提示（成功文案本身就是中文结论，不走原文管道）。 */
export function showUserSuccess(text: string): void {
  void emit('success', String(text ?? ''))
}

/* ------------------------------- 产品自己写的中文结论 + 原文进技术详情（成对文案入口） */

/**
 * 主区给**产品自己写的中文结论**、后端原文只进技术详情层（审计 §7.1-6 的成对文案）。
 *
 * ## 为什么还需要这个入口（与 `showUserError` / `showUserWarning` 的分工）
 *
 * `showUserError` / `showUserWarning` 的主区文案是**后端句子过管道后的改写结果**
 * （`toUserFacingText`）。后端句子一旦「脏」（含 `DRY_RUN=` / 环境变量 / 地址），
 * 管道会整句丢弃并退回 `fallback` —— 于是用户本来就该看到的那个中文结论
 * 变成了通用句（「这一步没有成功，请稍后重试」），这是**信息削减**。
 *
 * 本入口把两个职责拆开：
 * - **主区**：调用方直接给一句产品自己写的中文结论（具体、可据以行动），
 *   不再由后端句子派生；
 * - **技术详情层**：后端原文经 `maskInternalIds` 后写入「最近一次原始信息」
 *   （`readTechnicalDetails` 读取），默认收起的折叠区可以展开查。
 *   ⚠️ 这一层**只掩内部 ID、不做洗句**：技术详情层的定义就是「允许放内部信息
 *   （接口路径、环境变量名、后端错误原文）」（审计 §2.1），把它洗掉就等于用户再也查不到原文。
 *
 * ⚠️ 本函数**不改** `toUserFacingText` / `buildUserFacingMessage` 的既有兜底规则，
 * 其它区域的行为一个字节都不受影响。
 */
export function showUserConclusion(
  kind: MessageKind,
  conclusion: string,
  raw?: unknown,
  scope = '',
): Promise<UserFacingMessage> {
  const title = String(conclusion ?? '').trim() || USER_FACING_FALLBACK
  const source =
    typeof raw === 'string' ? raw : raw === null || raw === undefined ? '' : String((raw as Error)?.message ?? raw)
  const detail = source.trim() ? maskInternalIds(source) : ''
  if (detail) rememberTechnicalDetail({ title, detail, scope })
  return emit(kind, title).then(() => ({ title, detail }))
}
