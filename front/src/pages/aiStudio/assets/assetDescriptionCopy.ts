/**
 * 资产描述（`description`）的**展示层**中文转述（审计 §4.6 模式 2）。
 *
 * ## 为什么需要它
 *
 * 运行时实测（审计 §4.6 模式 2 / §5.5-E）：场景、演员这类资产的 `description`
 * 由后端**按剧本自动生成**，原样进了主区，用户看到的是：
 *
 * ```
 * 已根据该资产出现的 `segments`、`shots`、台词、`visual_focus`、`continuity_note`
 * 和 `story_function` 生成
 * ```
 *
 * —— 这是「后端生成的 description 原样上屏」：反引号 + 英文字段名给了终端用户，
 * 属模式 2（后端字段名直渲）。审计给出的口径是
 * 「前端应改为『已根据该资产在本集剧本里的出场、台词与作用生成』」。
 *
 * ## 判定口径（**只认已经见过的形状，不猜**）
 *
 * - 描述里**没有** `snake_case` 形式的标识符 → **原样返回**（正常中文描述一个字都不动）；
 * - 有 → 先按整句改写（保留这一句之外的用户内容），再把残留的反引号 / 标识符
 *   收成中文说法（未登记的标识符给中文兜底，**绝不回显原值**，§7.4 兜底口径）。
 *
 * 本模块是**纯字符串处理**（不 import React / antd），既能被组件复用，
 * 也能被 `node --test` 直接加载。
 */

/** 审计 §4.6 模式 2 给出的主区口径（**写死的中文结论，不随后端措辞漂移**）。 */
export const ASSET_AUTO_DESCRIPTION_TEXT = '已根据该资产在本集剧本里的出场、台词与作用生成'

/** 已登记的后端字段名 → 中文说法（出现一次就换一次，句子里读得通）。 */
const DESCRIPTION_FIELD_LABELS: Readonly<Record<string, string>> = {
  segments: '出场片段',
  shots: '镜头',
  shot: '镜头',
  dialogue: '台词',
  dialogues: '台词',
  lines: '台词',
  visual_focus: '画面重点',
  continuity_note: '连贯性说明',
  story_function: '剧情作用',
  scene_purpose: '场景作用',
  character_traits: '人物特征',
  appearance: '外貌',
  props: '道具',
}

/**
 * 后端字段名形态的标识符，两种都算（§4.6 模式 2 的运行时原文同时有这两种）：
 *   1. **反引号包起来的英文 token**：`` `segments` ``、`` `shots` ``；
 *   2. **`snake_case` 连写**：`visual_focus`、`continuity_note`。
 *
 * 只裸一个英文单词（没反引号、没下划线）**不算** —— 中文描述里正常出现英文词不该被改写。
 * ⚠️ **例外见下面 `BARE_FIELD_WORD_RE`**：如果那个裸词是**已登记的字段名**（`segments` / `shots` …），
 * 它就是要换掉的那种泄漏（阶段 B 收尾的运行时实测抓到了这一形态）。
 */
const FIELD_TOKEN_RE = /`[a-z][a-z0-9_]*`|(?<![A-Za-z0-9_`])[a-z][a-z0-9]{2,}(?:_[a-z0-9]{2,})+(?![A-Za-z0-9_`])/g
/** 同一个口径的**不带 `g`** 版本（`test` 不共享 `lastIndex`，避免状态串味）。 */
const HAS_FIELD_TOKEN_RE =
  /`[a-z][a-z0-9_]*`|(?<![A-Za-z0-9_`])[a-z][a-z0-9]{2,}(?:_[a-z0-9]{2,})+(?![A-Za-z0-9_`])/

/**
 * **裸词形态**的已登记字段名（没有反引号、也没有下划线）——但**只在中文语境里**换。
 *
 * 为什么必须补这一条（阶段 B 收尾**运行时实测**发现的漏网）：后端同一份自动描述里还有这种写法 ——
 * `上下文判断来自segments和shots中林希进入、系统激活…等关键情节。`
 * 上面的 `FIELD_TOKEN_RE` 只认「反引号包起来」或「`snake_case` 连写」两种形态，
 * 于是 `segments` / `shots` **原样留在了主区**（场景列表页实测命中）。
 *
 * ## 为什么必须加「中文语境」这个条件（写这条时被自己的测试抓过一次）
 *
 * 同一个字段里**还装着英文提示词**（运行时原文：
 * `基础提示词： cinematic live-action environment, wide establishing shot, 16:9 …`）。
 * 如果无脑把裸词 `shot` 也换掉，就会把 **`wide shot` 改成 `wide 镜头`** ——
 * 那是**真的破坏内容**（用户要复制的英文提示词被改坏），比漏掉一个字段名严重得多。
 *
 * 所以判定条件是：这个词**至少一侧紧邻中文字符**（`[\u4e00-\u9fff]`）。
 * `来自segments和` 命中（左侧「自」是中文）；`wide shot,` 不命中（两侧都是英文/标点）。
 * 并且**只认已经登记在 `DESCRIPTION_FIELD_LABELS` 里的名字**，不是「见到英文单词就换」。
 */
const BARE_REGISTERED_WORDS = Object.keys(DESCRIPTION_FIELD_LABELS)
  .sort((a, b) => b.length - a.length)
  .join('|')
const CJK_CHAR = '\\u4e00-\\u9fff'
const BARE_FIELD_WORD_PATTERN =
  `(?:(?<=[${CJK_CHAR}])(?:${BARE_REGISTERED_WORDS})(?![A-Za-z0-9_])` +
  `|(?<![A-Za-z0-9_])(?:${BARE_REGISTERED_WORDS})(?=[${CJK_CHAR}]))`
const BARE_FIELD_WORD_RE = new RegExp(BARE_FIELD_WORD_PATTERN, 'gi')
/** **不带 `g`** 的版本（同上，避免 `lastIndex` 串味）。 */
const HAS_BARE_FIELD_WORD_RE = new RegExp(BARE_FIELD_WORD_PATTERN, 'i')

/**
 * 「已根据该资产出现的 … 生成」这一整句（含句中的字段名）。
 *
 * 用**非贪婪 + 到「生成」止**的形状匹配，句号可有可无；认不出来就不做整句改写，
 * 只走下面的逐词替换（宁可读起来笨一点，也不许把不认识的内容删掉）。
 */
const AUTO_DESCRIPTION_SENTENCE_RE = /已?根据[^。\n]{0,240}?生成[。.；;]?/g

function labelForFieldToken(token: string): string {
  /* 反引号用 `\u0060` 写：扫描器不认正则字面量，源码里直接出现裸反引号会
     被当成模板串起点，把后面几百行吞成一个「扫描面」（区域护栏实测过）。 */
  const key = token.replace(/\u0060/g, '').trim().toLowerCase()
  return DESCRIPTION_FIELD_LABELS[key] ?? '相关信息'
}

/** 描述里是否含后端字段名形态的标识符（用于「有没有必要转述」的判定与自检）。 */
export function hasInternalFieldToken(text?: string | null): boolean {
  const raw = String(text ?? '')
  if (!raw.trim()) return false
  return HAS_FIELD_TOKEN_RE.test(raw) || HAS_BARE_FIELD_WORD_RE.test(raw)
}

/**
 * 展示层转述：把「后端自动生成句 + 英文字段名」换成中文说法，其余内容原样保留。
 *
 * **幂等**：已经转述过的文本里没有字段名，第二次调用原样返回
 * （所以它可以直接套在会被反复渲染/回填的字段上）。
 */
export function describeAssetDescription(text?: string | null): string {
  const raw = String(text ?? '')
  if (!raw.trim()) return ''
  if (!hasInternalFieldToken(raw)) return raw
  // ① 整句改写（审计给定口径）：句子里的字段名清单不再逐个展开给用户看
  let result = raw.replace(AUTO_DESCRIPTION_SENTENCE_RE, (matched) =>
    hasInternalFieldToken(matched)
      ? `${ASSET_AUTO_DESCRIPTION_TEXT}${/[。.；;]$/.test(matched) ? '。' : ''}`
      : matched,
  )
  // ② 残留的字段名（不在上面那个句式里的）逐个换成中文说法，反引号去掉
  result = result.replace(FIELD_TOKEN_RE, (token) => labelForFieldToken(token))
  // ③ 裸词形态的**已登记**字段名（`上下文判断来自segments和shots中…`，运行时实测的那种写法）
  result = result.replace(BARE_FIELD_WORD_RE, (token) => labelForFieldToken(token))
  return result
}

/* ------------------------------------------------ 资产名的内部前缀（§4.6 模式 1 数据侧形态） */

/**
 * 资产名里的系统前缀（`SCENE_` / `PROP_` / `CHAR_` / `ACTOR_` / `COSTUME_`）。
 *
 * 审计 §4.6 模式 1 的运行时原文：标题 `SCENE_星耀疗养院S级特护病房门外`
 * （前缀 + 内部命名）。审计口径是「**数据侧改名优先**；前端在展示层剥离前缀，
 * 并在技术详情里保留原名」。
 *
 * 本函数只做**展示层**剥离：调用方拿它当 `value` 渲染，保存仍用原始值
 * —— 在可编辑字段上直接改写等于替用户改名（数据变更），不属文案治理范围。
 */
const ASSET_NAME_PREFIX_RE = /^(?:SCENE|PROP|CHAR|CHARACTER|ACTOR|COSTUME|ROLE)[_-]+/i

export function stripAssetNamePrefix(name?: string | null): string {
  const raw = String(name ?? '').trim()
  if (!raw) return ''
  const stripped = raw.replace(ASSET_NAME_PREFIX_RE, '').trim()
  return stripped || raw
}
