/**
 * 「主区禁词扫描」的共享扫描器（阶段 B 验收基建，审计 §8.1）。
 *
 * ## 为什么不能只扫 raw source
 *
 * 先例 `workbenchState.test.ts` 是「硬编码 6 个文件 + 整文件 raw source 扫 12 个词」。
 * 那套做法在往「目录遍历 + 单一豁免」升级时会立刻炸：契约读取代码里**合法地**写着
 * `service_task_id` / `oss_url` / `asset_id` 这些字段名（审计 §8.1 也承认
 * 「这些在契约里就带，代码读它们属正常」）。
 *
 * 更关键的是**第 2/3 轮运行时发现的硬要求**（§8.1 末段、§5.5-D）：
 * `/models` 的 `title` 属性里有完整本机地址，**悬停即见**，而纯文本扫描抓不到。
 * 所以扫描面必须显式覆盖：
 *
 * | 扫描面 | 覆盖内容 |
 * |---|---|
 * | JSX 文本节点 | `>…<` 之间的字面量 |
 * | **JSX 属性值** | `title=` / `tooltip=` / `placeholder=` / `alt=` / `aria-label=` / `description=` / `message=` / `okText=` |
 * | 字符串字面量 | 模块级常量、`message.*` 实参、模板串 |
 *
 * ## 词表三段合一（§8.1）
 *
 * 1. **模式 1/2/4 正则**：UUID、内部字段名、接口路径 / URL / 本机地址、环境变量名；
 * 2. **模式 3 枚举原值**：**直接 import `enumLabels.ts` 的 key 全集**，
 *    保证映射表与测试同源，将来新增枚举自动纳入；
 * 3. **模式 2/5 逐字禁词**：主区禁词表 + 内部术语表（含 `供应商` / `门禁` / 模型原名）。
 *
 * ## 扫描器自身必须有「空转自检」
 *
 * 沿用 `userFacingCopy.test.ts:105-111` 的用例：**证明扫描器真的能扫到东西**，
 * 否则会出现「文件不存在 / 正则写错 ＝ 干净」的假绿（审计 §8.1 明确要求）。
 * 本模块因此把「注入一个已知禁词必须被抓到」做成了可调用的自检函数。
 *
 * 本模块是**纯字符串处理**（不 import fs / React / antd），
 * 所以既能被 `node --test` 直接加载，也能在需要时被浏览器侧复用。
 */

import { ENUM_RAW_VALUES, MODEL_RAW_NAMES } from './enumLabels.ts'

/* ------------------------------------------------------------- 扫描面提取 */

export type ScanSurfaceKind = 'string-literal' | 'template-literal' | 'jsx-text' | 'jsx-attr'

export type ScanSurface = {
  readonly kind: ScanSurfaceKind
  /** 提取出来的文本（已去掉定界引号）；`jsx-attr` 时是属性名 */
  readonly text: string
  /** 在源文件里的起始行号（1 基，便于报错定位） */
  readonly line: number
  /** `jsx-attr` 专有：属性名（例如 `title` / `placeholder`） */
  readonly attr?: string
}

export type ExtractOptions = {
  /** 是否把注释也当成扫描面（默认 false：注释不是用户可见文案） */
  readonly includeComments?: boolean
}

/**
 * **收起状态也可见** 的 JSX 属性白名单（审计 §8.1 表格 + 本仓既有用法）。
 *
 * 用**白名单**而不是黑名单的理由：`className` / `style` 里全是 Tailwind 类名
 * （`text-[11px]`、`mr-0` 这种），`href` / `to` / `src` 里是路由模板与请求地址 ——
 * 用黑名单永远漏；用白名单则「没登记进来的属性」自动退化成「只有当它含中文时才看」，
 * 恰好符合「只有用户能看到的字面量才算主区」这一判定口径（§7.1-7）。
 */
export const VISIBLE_JSX_ATTRS: readonly string[] = [
  'title',
  'tooltip',
  'placeholder',
  'alt',
  'aria-label',
  'description',
  'message',
  'oktext',
  'canceltext',
  'label',
  'emptytext',
  'content',
  'hint',
  'note',
  'caption',
  'subtitle',
  'help',
  'extra',
  'summary',
  'header',
]

const CJK_RE = /[\u4e00-\u9fff]/

/** 字符是否是 JSX 属性名的一部分（`aria-label` 里的 `-` 也算）。 */
function isAttrChar(ch: string): boolean {
  return /[A-Za-z0-9_-]/.test(ch)
}

/**
 * 回头看这个字符串字面量是不是某个 `属性名="…"` 的值。
 *
 * 只看**紧邻的前文**（`attrName` + 可选空白的 `=`），避免把别处的赋值误判成属性。
 */
function detectJsxAttr(sourceBefore: string): string | null {
  let i = sourceBefore.length - 1
  while (i >= 0 && /\s/.test(sourceBefore[i])) i -= 1
  if (i < 0 || sourceBefore[i] !== '=') return null
  i -= 1
  while (i >= 0 && /\s/.test(sourceBefore[i])) i -= 1
  const end = i + 1
  while (i >= 0 && isAttrChar(sourceBefore[i])) i -= 1
  const attr = sourceBefore.slice(i + 1, end)
  return attr || null
}

/** 把 source 里的注释与字符串字面量「抹白」，保留换行，便于后续按正则找 JSX 文本节点。 */
function blankCommentsAndStrings(source: string, surfaces: ScanSurface[], includeComments: boolean): string {
  const out: string[] = []
  let i = 0
  let line = 1
  const n = source.length

  const pushBlank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) out.push(source[k] === '\n' ? '\n' : ' ')
  }

  while (i < n) {
    const ch = source[i]
    const next = source[i + 1]

    if (ch === '/' && next === '/') {
      const start = i
      while (i < n && source[i] !== '\n') i += 1
      if (includeComments) surfaces.push({ kind: 'string-literal', text: source.slice(start + 2, i), line })
      pushBlank(start, i)
      continue
    }
    if (ch === '/' && next === '*') {
      const start = i
      const startLine = line
      i += 2
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) {
        if (source[i] === '\n') line += 1
        i += 1
      }
      i = Math.min(i + 2, n)
      if (includeComments) {
        surfaces.push({ kind: 'string-literal', text: source.slice(start + 2, Math.max(start + 2, i - 2)), line: startLine })
      }
      pushBlank(start, i)
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      const startLine = line
      const start = i
      // 只在**同行**里回头看属性名，跨行赋值不会被误判
      const lineStart = source.lastIndexOf('\n', start) + 1
      const attr = detectJsxAttr(source.slice(lineStart, start))
      i += 1
      let value = ''
      while (i < n) {
        const c = source[i]
        if (c === '\\') {
          value += source.slice(i, i + 2)
          if (source[i + 1] === '\n') line += 1
          i += 2
          continue
        }
        if (c === quote) {
          i += 1
          break
        }
        if (c === '\n') {
          line += 1
          if (quote !== '`') {
            i += 1
            break
          }
        }
        value += c
        i += 1
      }
      /* `console.warn('[tag] …')` 这类**开发者日志**不是用户可见文案，不参与扫描。 */
      const isConsoleLogArg = /console\.\w+\(\s*$/.test(source.slice(lineStart, start))
      /* 模板串里的 `${…}` 是**代码表达式**，不是文案字面量：
         `` `镜头：${shot.title}` `` 命中并不代表泄漏（真正的泄漏是「把值渲出来」，
         静态扫字面量本来就看不见）。所以先把表达式挖掉、只留字面量部分 ——
         这样枚举原值的**整词**匹配才不会误伤 `shot.title` 这类标识符。 */
      const literalOnly = value.replace(/\$\{[^}]*\}/g, ' ')
      const isVisibleAttr =
        !isConsoleLogArg && attr !== null && VISIBLE_JSX_ATTRS.includes(attr.toLowerCase())
      const kind: ScanSurfaceKind = isVisibleAttr
        ? 'jsx-attr'
        : quote === '`'
          ? 'template-literal'
          : 'string-literal'
      // 非白名单字面量：**只有含中文才当成用户文案**（§7.1-7 的判定口径）
      if (!isConsoleLogArg && (isVisibleAttr || CJK_RE.test(value))) {
        surfaces.push(
          kind === 'jsx-attr'
            ? { kind, text: value, line: startLine, attr: attr ?? '' }
            : { kind, text: literalOnly, line: startLine },
        )
      }
      pushBlank(start, i)
      continue
    }
    if (ch === '\n') line += 1
    out.push(ch)
    i += 1
  }
  return out.join('')
}

/**
 * 从 TSX 源码里提取**全部用户可见扫描面**。
 *
 * 三步：
 *   1. 抹白注释与字符串字面量，同时把字面量按「是否白名单 JSX 属性 / 是否含中文」分类；
 *   2. 在抹白后的文本里找 JSX 文本节点（`>…<` 之间）；
 *   3. 丢掉空白面。
 *
 * 注意 `title="…"` / `placeholder="…"` 这类**纯英文也能上屏**的属性
 * 走白名单、不受「必须含中文」限制 —— 这正是 §5.5-D 实测 `title="http://***1:4321/v1"`
 * 能被抓到的原因。
 */
export function extractScanSurfaces(source: string, options: ExtractOptions = {}): ScanSurface[] {
  const includeComments = options.includeComments === true
  const surfaces: ScanSurface[] = []
  const blanked = blankCommentsAndStrings(source, surfaces, includeComments)

  const jsxTextRe = />([^<>{}]+)</g
  let match: RegExpExecArray | null
  while ((match = jsxTextRe.exec(blanked)) !== null) {
    const text = match[1].replace(/\s+/g, ' ').trim()
    if (!text) continue
    // 排除 `=>` 造成的假 JSX 文本
    const before = blanked.slice(Math.max(0, match.index - 1), match.index + 1)
    if (before === '=>') continue
    /* 排除「跨过了代码」的假 JSX 文本：真正的 JSX 文本节点里不会有 `; = [ ] { }`，
       而代码（`const [x, setX] = useState(...)`）一定有 —— 这是区分二者的可靠特征。 */
    if (/[;=[\]{}]/.test(text)) continue
    /* 再排除一类：`>…<` 之间夹着**对象字面量属性写法**的代码片段。
       实例（`ChapterStudio.tsx` 批量菜单）：提取出来的是
       `, label: , disabled: selectedShotIds.length` —— 里面其实一个字的用户文案都没有，
       但 `disabled` 会被枚举词表命中（`providerStatus` 的原值之一），变成假泄漏。
       判定：**不含中文** 且形如 `标识符:` / `标识符,`（JSX 文本里不会长这样）。 */
    if (!CJK_RE.test(text) && /[A-Za-z_$][\w$.]*\s*[,:]/.test(text)) continue
    if (text.length > 400) continue
    const line = blanked.slice(0, match.index).split('\n').length
    surfaces.push({ kind: 'jsx-text', text, line })
  }

  return surfaces.filter((surface) => surface.text.trim().length > 0)
}

/* ----------------------------------------------------------------- 词表 */

export type ForbiddenPattern = { readonly name: string; readonly pattern: RegExp }

/**
 * 模式 1（内部 ID/UUID 直渲）、模式 2（后端字段名直渲）、模式 4（路径 / URL / 本机地址 / 环境变量）。
 *
 * 判定方法（§7.1-7）：只判**用户能看到的字符串**，
 * 源码里作为参数传给请求函数的路径不算 —— 扫描面本身已经是「用户可见文本」，
 * 所以这里可以放心用宽正则。
 */
export const MAIN_SCREEN_FORBIDDEN_PATTERNS: readonly ForbiddenPattern[] = [
  { name: '模式1 UUID', pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  {
    name: '模式2 内部字段名',
    pattern:
      /(?<![A-Za-z0-9_])(?:file_id|storage_key|task_id|service_task_id|source_task_id|provider_task_id|video_task_id|provider_id|asset_id|shot_id|chapter_id|project_id|raw_keys|oss_url)(?![A-Za-z0-9_])/i,
  },
  {
    name: '模式4 接口路径/URL/本机地址',
    pattern: /\/api\/v1|https?:\/\/(?:localhost|127\.0\.0\.1|192\.168\.|10\.)|(?<![A-Za-z0-9_])localhost(?![A-Za-z0-9_])|(?<![A-Za-z0-9_])127\.0\.0\.1(?![A-Za-z0-9_])/i,
  },
  { name: '模式4 环境变量名', pattern: /JELLYFISH_[A-Z_]+/ },
  { name: '模式4 仓库文件路径', pattern: /\bbackend\/\.env\b|docs\/real-run-mode\.md|SIX_STEP_ACCEPTANCE\.md/ },
  {
    /* 「候选」的细分口径（审计 §9 第 5 项 + 用户拍板）：
       **禁**「候选条数 / 聚合 N 组 / 候选状态 / 候选 id」这类后端概念，
       **放行**「待确认候选」这类用户能懂的业务说法 —— 否则会出现
       「为避开一个词改 30 处文案」的过度整改。 */
    name: '模式2 候选计数/后端概念',
    pattern:
      /候选\s*(?:条数|数量|状态|id|ID|编号)|\d+\s*(?:条|组|项|个)\s*候选|候选\s*\d+\s*(?:条|组|项|个)/,
  },
]

/**
 * 模式 2/5 的逐字禁词。
 *
 * 前 12 个是 `workbenchState.ts` 的 `MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS`（全仓既有基准），
 * 后面是 `userFacingStatus.ts` 的 `FORBIDDEN_INTERNAL_TERMS` 里**属于文案层**的部分。
 *
 * 注意：这里**不收** `asset_id` / `oss_url` / `provider` 这类「契约里就带、代码要读」的词 ——
 * 它们由上面的正则负责，且只在出现于**用户可见字符串**时才判定。
 */
export const MAIN_SCREEN_FORBIDDEN_TERMS: readonly string[] = [
  // 既有基准（12 词）——注意「候选」按细分口径走上面的正则，不在这里整词禁
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
  // 内部术语表里属于文案层的
  '门禁',
  'DRY_RUN',
  'provider_id',
]

/** 逐字禁词去重后的最终表。 */
export const MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS: readonly string[] = Array.from(
  new Set(MAIN_SCREEN_FORBIDDEN_TERMS),
)

/**
 * 模式 3 的枚举原值清单 —— **直接来自 `enumLabels.ts`**（§8.1 第 2 点），
 * 保证「映射表」与「测试词表」同源：映射表新增一个原值，扫描自动开始盯它。
 */
export const MAIN_SCREEN_FORBIDDEN_ENUM_VALUES: readonly string[] = ENUM_RAW_VALUES

/**
 * 模式 5 的模型原名清单 —— 同样来自 `enumLabels.ts` 的映射表 key 全集（§8.1 第 4 点），
 * 避免「将来新增模型」时词表漏掉。
 */
export const MAIN_SCREEN_FORBIDDEN_MODEL_NAMES: readonly string[] = MODEL_RAW_NAMES

/** 转义成正则字面量。 */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 在一段**用户可见文本**里找禁词。
 *
 * 枚举原值 / 模型原名按**整词**匹配（`(?<![A-Za-z0-9_])…(?![A-Za-z0-9_])`），
 * 避免把 `first_frame_prompt` 这类标识符误判成帧类型原值 `first`。
 */
export function findLeakTermsInText(text: string): string[] {
  const haystack = String(text ?? '')
  if (!haystack.trim()) return []
  const hits: string[] = []

  MAIN_SCREEN_FORBIDDEN_PATTERNS.forEach(({ name, pattern }) => {
    if (pattern.test(haystack)) hits.push(name)
  })
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.forEach((term) => {
    if (haystack.toLowerCase().includes(term.toLowerCase())) hits.push(term)
  })
  const wordish = (values: readonly string[]): void => {
    values.forEach((value) => {
      const re = new RegExp(`(?<![A-Za-z0-9_])${escapeRe(value)}(?![A-Za-z0-9_])`, 'i')
      if (re.test(haystack)) hits.push(value)
    })
  }
  wordish(MAIN_SCREEN_FORBIDDEN_ENUM_VALUES)
  wordish(MAIN_SCREEN_FORBIDDEN_MODEL_NAMES)

  return hits
}

/* ----------------------------------------------------------------- 主入口 */

export type LeakHit = {
  /** 源文件里的行号（1 基） */
  readonly line: number
  readonly kind: ScanSurfaceKind
  readonly term: string
  /** 命中的那段用户可见文本 */
  readonly text: string
}

/**
 * 扫描一份 TSX/TS 源码里的**主区泄漏**。
 *
 * 只扫「用户可见文本面」（JSX 文本 / JSX 属性值 / 字符串与模板字面量），
 * 不扫 code 标识符 —— 这正是 §8.1 的扫描面要求，也是升级到
 * 「目录遍历 + 单一豁免」时不会误伤契约读取代码的前提。
 */
export function findMainScreenLeaks(source: string, options: ExtractOptions = {}): LeakHit[] {
  const surfaces = extractScanSurfaces(source, options)
  const hits: LeakHit[] = []
  surfaces.forEach((surface) => {
    findLeakTermsInText(surface.text).forEach((term) => {
      hits.push({ line: surface.line, kind: surface.kind, term, text: surface.text })
    })
  })
  return hits
}

/** 把命中渲染成 `文件:行号 ｜ 扫描面 ｜ 命中词 ｜ 原文`。 */
export function formatLeakHits(file: string, hits: readonly LeakHit[]): string[] {
  return hits.map((hit) => `${file}:${hit.line} ｜ ${hit.kind} ｜ 命中「${hit.term}」｜ ${hit.text.trim()}`)
}

/* ------------------------------------------------------------- 空转自检 */

/**
 * 扫描器**自身有效**的自检（§8.1 硬要求：防「扫不到东西＝干净」的假绿）。
 *
 * 做法：往真实源码尾部注入一段一定含禁词的 JSX，然后断言它必须被抓到。
 * 用**真实文件内容**做底，能同时证明「文件真的被读到了」和「正则真的在跑」。
 *
 * @returns 没有抓到任何命中时返回 `false`（调用方据此让测试失败）
 */
export function scannerSelfCheck(source: string): boolean {
  const probe = `${source}\nconst __probe__ = () => <div title="供应商 file_id 9f3c1a2b-0000-4000-8000-000000000001">候选 12 条 partial_failed</div>\n`
  const hits = findMainScreenLeaks(probe)
  const terms = new Set(hits.map((hit) => hit.term))
  return (
    terms.has('供应商') &&
    terms.has('模式2 候选计数/后端概念') &&
    terms.has('partial_failed') &&
    hits.some((hit) => hit.term === '模式1 UUID') &&
    hits.some((hit) => hit.term === '模式2 内部字段名')
  )
}

/**
 * 「待确认候选」这类**放行**的业务说法（审计 §9 第 5 项）必须**不被**判成泄漏，
 * 否则细分口径就退化成「整词禁候选」，会出现过度整改。
 *
 * 与 `scannerSelfCheck` 配对使用：一个证明扫描器能抓到，一个证明扫描器不过度抓。
 */
export function scannerNegativeSelfCheck(): boolean {
  const probe =
    '本集还有 3 项待确认候选；请确认这些待确认候选后继续。这一步已核对完成。'
  return findMainScreenLeaks(`const __probe__ = () => <div>${probe}</div>`).length === 0
}

/** 扫描面数量（用于断言「确实提取到了东西」）。 */
export function countScanSurfaces(source: string): number {
  return extractScanSurfaces(source).length
}
