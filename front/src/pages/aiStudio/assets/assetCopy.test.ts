/**
 * 「资产编辑页（`pages/aiStudio/assets/**`）主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B **插批** · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md`
 *  §5.5-C 四种泄漏挤在同一行 + §4.6 实体管理 + §6.1 任务号口径 + §8.1 区域 6）。
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * | 扫描面 | 覆盖内容 |
 * |---|---|
 * | `pages/aiStudio/assets/**` | 全部 **17 个非测试源码文件**（含 `components/**`、`tabs/**`、`assetAdapters.ts`、`assetResultSummary.ts`） |
 *
 * ⚠️ **本区域没有任何行级豁免**（比 `chapterStudioCopy.test.ts` 的标记区间更严）：
 * `assets/**` 里出现基准禁词表里的任何一个词就是失败，**没有白名单、没有登记表**。
 * 之所以能做到，是因为第三层内容全部落在**共享折叠壳** `TechnicalDetailSection` 的
 * 子节点里，而那些子节点渲染的是 `buildResultRowTechnicalFields()` 的**动态值**
 * （源码里不出现 `oss_url` 这种字段名文本，见下面的「渲染点口径专项」）。
 *
 * ===================== 扫描器**结构性扫不到**的三类（本批手工核对过） =====================
 *
 * 1. **非 JSX 属性、且不含中文的字符串字面量**（`extractScanSurfaces` 只收「白名单属性」或
 *    「含中文」的字面量 —— 例如 `title="OSS"` 会被收到，但 `const x = 'oss_url'` 不会）；
 * 2. **嵌套模板字符串**（内层反引号会让提取器错位）—— 本批逐行核对过
 *    `AssetEditPageBase.tsx` 的反引号：**没有嵌套模板串**；下面的「工具自检」用例
 *    用 marker 断言兜底，一旦错位会**失败**而不是静默放过；
 * 3. **动态插值**（把后端值插进 JSX）—— 这正是 §5.6 说的泄漏主因，静态扫描原理上看不见。
 *    本批用「渲染点口径专项」里的 `analyzePanelJsx`（逐字符、区分「直渲 / 条件 / 不上屏属性」）
 *    补了这一类，覆盖范围写在那个用例的注释里；
 * 4. **JSX 文本节点里的 `http://…`**：共享扫描器把 `//` 当行注释起点（该行余下被抹白），
 *    所以「文案里直接写地址」这一类它扫不到 —— 本批改用**明文 URL 字面量**检查兜住
 *    （见「渲染点口径专项」最后一段）。
 *    本批手工核对了 `assets/**` 的相关渲染点，覆盖情况写在最后的「手工核对登记」用例里。
 *
 * ================================ 三层模型与豁免（审计 §2.1） ================================
 *
 * - 主区：中文结论 + 动作（「查看图片」这类链接**允许**，但链接可见文本不许是地址）；
 * - 第三层（默认收起）：内部编号、完整地址（含 bucket / prefix / object key）、原始状态值。
 *   本区域**只允许**用共享壳 `TechnicalDetailSection`
 *   （`project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx`，
 *   审计 §9 第 2 项：全仓唯一豁免文件），**不许**在 `assets/**` 里自建第二套 `<details>`。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ENUM_RAW_VALUES,
  MODEL_RAW_NAMES,
} from '../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  VISIBLE_JSX_ATTRS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
} from '../components/mainScreenCopyGuard.ts'
import {
  ASSET_AUTO_DESCRIPTION_TEXT,
  describeAssetDescription,
  hasInternalFieldToken,
  stripAssetNamePrefix,
} from './assetDescriptionCopy.ts'
import {
  ASSET_RESULT_ADDRESS_DRY_RUN_TEXT,
  ASSET_RESULT_ADDRESS_MISSING_TEXT,
  ASSET_RESULT_ADDRESS_SAVED_TEXT,
  ASSET_RESULT_ADDRESS_TEMP_TEXT,
  ASSET_RESULT_VIEW_IMAGE_TEXT,
  ASSET_RESULT_VIEW_TEMP_IMAGE_TEXT,
  buildResultRowTechnicalFields,
  describeResultRowAddress,
  normalizeAssetResultRow,
} from './assetResultSummary.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/assets` → `front/src/pages/aiStudio` */
const AISTUDIO_ROOT = resolve(HERE, '..')
const ASSETS_ROOT = HERE

/** 全仓唯一的「技术详情」实现（审计 §9 第 2 项：豁免只能给一个文件）。 */
const TECHNICAL_DETAIL_WAIVER = 'project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'
/** 本区域应当 import 的折叠壳（相对 `assets/components/`）。 */
const TECHNICAL_DETAIL_IMPORT = '../../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'

/** 结果面板（本批的主目标）所在文件。 */
const ASSET_EDIT_BASE = 'components/AssetEditPageBase.tsx'

/**
 * 本批明确纳入扫描面的文件登记表（防止扫描范围被悄悄缩小）。
 *
 * 新增 `assets/**` 源码文件会自动被目录遍历纳入；这份表的作用是
 * 「已登记的文件必须真实存在、且真的被遍历到」，以及给空转自检提供样本。
 */
const REGISTERED_FILES: readonly string[] = [
  'ActorAssetEditPage.tsx',
  'AssetManager.tsx',
  'CostumeAssetEditPage.tsx',
  'PropAssetEditPage.tsx',
  'SceneAssetEditPage.tsx',
  'assetAdapters.ts',
  'assetDescriptionCopy.ts',
  'assetResultSummary.ts',
  'components/ActorEntityFormModal.tsx',
  'components/AssetEditPageBase.tsx',
  'components/DisplayImageCard.tsx',
  'components/StudioAssetTypeFormModal.tsx',
  'tabs/ActorsTab.tsx',
  'tabs/AssetTypeTab.tsx',
  'tabs/CostumesTab.tsx',
  'tabs/PropsTab.tsx',
  'tabs/ScenesTab.tsx',
  'utils.ts',
]

/** `assets/**` 的目录结构 —— 每个目录都必须有文件，否则说明遍历被缩窄了。 */
const EXPECTED_DIRS: readonly string[] = ['', 'components', 'tabs']

/**
 * 区域补充的**模式 2/4 字段名与形态**（共享基准表里没有、但审计 §5.5-C / §4.6 点名的）。
 *
 * 为什么要单列：共享表的 `模式2 内部字段名` 正则里**没有** `source_asset_id`
 * （`asset_id` 那条的 lookbehind 会被前面的 `_` 挡住），也没有「裸 `oss`」
 * 和「完整公网地址」（基准正则只认本机 / 内网地址）。
 */
const REGION_EXTRA_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: '区域补充: source_asset_id', pattern: /(?<![A-Za-z0-9_])source_asset_id(?![A-Za-z0-9_])/i },
  { name: '区域补充: 裸 oss/OSS', pattern: /(?<![A-Za-z0-9_])oss(?![A-Za-z0-9_])/i },
  {
    /* `character_id` / `scene_id` / `project_id` 这些都在契约里，代码要读它们；
       只有**出现在用户可见文案里**才算泄漏 —— 所以只扫扫描面，不扫标识符。 */
    name: '区域补充: 任意后端 *_id 字段名',
    pattern: /(?<![A-Za-z0-9_])[a-z][a-z0-9]*(?:_[a-z0-9]+)*_id(?![A-Za-z0-9_])/i,
  },
  { name: '区域补充: 完整公网地址', pattern: /https?:\/\/[^\s"'`<>）)，。]+/i },
]

const CJK_RE = /[\u4e00-\u9fff]/

/* ------------------------------------------------------------------ 工具 */

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist') continue
        walk(full)
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue
      out.push(full)
    }
  }
  if (statSync(root).isDirectory()) walk(root)
  return out
}

/** 扫描面：`assets/**` 全部非测试源码。 */
function scanFiles(): string[] {
  return listSourceFiles(ASSETS_ROOT)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .sort()
}

function relAssets(file: string): string {
  return relative(ASSETS_ROOT, file)
}

function readScan(relPath: string): string {
  return readFileSync(resolve(ASSETS_ROOT, relPath), 'utf8')
}

/**
 * 只保留代码（去注释），用于「渲染点有没有接上管道」这类源码级断言。
 *
 * ⚠️ **不能用**「先正则去块注释、再去行注释」的朴素写法：文件里有
 * `accept=".jpg,…,image/*"` 这种**字符串里的块注释起止符**，朴素正则会从那里开始
 * 吞掉后面一大段代码（第 3 批实测：那种实现之后整段 JSX 消失，让源码级断言变成假绿）。
 * 这里改成**逐行**处理，只做两件确定安全的事：
 *   1. 丢掉「整行都是注释」的行（`//` / `*` / `/*` / `{/*` 开头，含块注释正文）；
 *   2. 截掉行尾的 `//` 注释，但 `//` 前面是 `:`（`http://`）时不算注释。
 * 这样永远不会跨行吞代码；代价是「行尾注释里的词可能残留」，本测试的断言模式
 * 都不长在行尾注释里（本批逐条核对过）。
 */
function stripComments(source: string): string {
  const out: string[] = []
  let inBlock = false
  source.split('\n').forEach((line) => {
    const trimmed = line.trim()
    if (inBlock) {
      if (trimmed.includes('*/')) inBlock = false
      out.push('')
      return
    }
    if (trimmed.startsWith('//') || trimmed === '' || trimmed.startsWith('*')) {
      out.push('')
      return
    }
    if (trimmed.startsWith('/*') || trimmed.startsWith('{/*')) {
      if (!trimmed.includes('*/')) inBlock = true
      out.push('')
      return
    }
    const matched = /(^|[^:])\/\//.exec(line)
    out.push(matched ? line.slice(0, matched.index + matched[0].length - 2) : line)
  })
  return out.join('\n')
}

/** 找到 `{` / `(` 等配对符号的收尾下标（跳过字符串 / 模板 / 注释；找不到返回 length）。 */
function matchPair(source: string, openIndex: number): number {
  const open = source[openIndex]
  const close = open === '{' ? '}' : open === '(' ? ')' : open === '[' ? ']' : ''
  if (!close) return openIndex + 1
  let depth = 0
  let i = openIndex
  while (i < source.length) {
    const ch = source[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      i += 1
      while (i < source.length) {
        if (source[i] === '\\') {
          i += 2
          continue
        }
        if (source[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i = Math.min(i + 2, source.length)
      continue
    }
    if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return source.length
}

/**
 * 扫描结果面板的 JSX，产出两样东西：
 *
 * | 产物 | 用途 |
 * |---|---|
 * | `residue` | 抹掉「不上屏的东西」（注释、非可见属性的表达式）之后的残留 —— 用来做**反假绿**断言：真实文案必须还在 |
 * | `printed` | 被判定为「**直接把值打上屏**」的表达式片段（带行号）—— 用来判「内部编号 / 地址有没有直渲」 |
 *
 * ## 为什么不用「朴素正则去块注释」
 *
 * 第 3 批实测：`accept=".jpg,…,image/*"` 这种**字符串里的块注释起止符**会让朴素实现
 * 从那里开始吞掉后面几百行代码（假绿）。所以这里是**逐字符**扫描，字符串 / 模板 /
 * 注释都按各自的语法整体跳过，任何一次跳错都会让 marker 断言失败而不是静默通过。
 *
 * ## 「直渲」是怎么判的
 *
 * 1. **非可见属性的值整段不算**：`key=` / `loading=` / `href=` / `className=` / `onClick=` /
 *    `disabled=` …（`VISIBLE_JSX_ATTRS` 之外的属性）都不上屏，`key={\`${row.x}_${row.y}\`}`
 *    这种形态不算直渲；
 * 2. `{…}` 子插值 / **可见属性**（`title=` / `description=` …，悬停即见）的值：
 *    - 是「值表达式」（裸成员链，或 `A || B` 兜底式）→ 记为**直渲**；
 *    - 是条件 / `map(...)` / JSX 分支 → 本身不打印值，**递归**进去继续判
 *      （这样 `{rows.map((row) => <div>{row.oss_url}</div>)}` 里的那个直渲照样会被抓）；
 * 3. **模板串**里的 `${…}` 是打印文本的一部分 → 记为直渲（但在非可见属性里的不算，见 ①）；
 * 4. 注释不是文案 → 抹掉。
 */
type PanelJsxAnalysis = {
  readonly residue: string
  readonly printed: readonly { readonly text: string; readonly line: number }[]
}

/**
 * 共享白名单（`VISIBLE_JSX_ATTRS`）之外、**其实也上屏**的属性（本地补充，**不改共享文件**）。
 *
 * `footer={<Button>关闭</Button>}` 的内容用户看得见，但共享白名单里没有 `footer`
 * （它是给「收起态 / 悬停态也可见」那一类属性准备的）。共享扫描器仍然能抓到里面的
 * JSX 文本（它按 `>…<` 提取，不看属性上下文），所以这只是本用例的精度补充。
 */
const LOCALLY_VISIBLE_ATTRS: readonly string[] = ['footer']

function isVisibleJsxAttr(attr: string): boolean {
  return VISIBLE_JSX_ATTRS.includes(attr) || LOCALLY_VISIBLE_ATTRS.includes(attr)
}

/** 「值表达式」：裸成员链 / 可选链 / 下标 / 字符串键，或 `A || B`、`A ?? B` 兜底式。 */
function isValueExpression(inner: string): boolean {
  if (inner === '') return false
  if (/[<>]/.test(inner)) return false // JSX / 比较运算
  if (/\?/.test(inner.replace(/\?\?/g, ''))) return false // 三元条件
  if (/\b(?:map|filter|join|find|some|every|reduce|flatMap)\s*\(/.test(inner)) return false
  if (/^[A-Za-z_$][\w$.?[\]'"]*$/.test(inner)) return true
  if (/^[^,()]+(?:\|\||\?\?)[^,()]+$/.test(inner)) return true
  return false
}

function analyzePanelJsx(source: string): PanelJsxAnalysis {
  const chars = source.split('')
  const printed: { text: string; line: number }[] = []
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k += 1) if (chars[k] !== '\n') chars[k] = ' '
  }
  const lineOf = (index: number): number => source.slice(0, index).split('\n').length
  const skipString = (start: number, limit: number): number => {
    const quote = source[start]
    let j = start + 1
    while (j < limit) {
      if (source[j] === '\\') {
        j += 2
        continue
      }
      if (source[j] === quote) return j + 1
      j += 1
    }
    return limit
  }
  const skipLineComment = (start: number, limit: number): number => {
    let j = start
    while (j < limit && source[j] !== '\n') j += 1
    return j
  }
  const skipBlockComment = (start: number, limit: number): number => {
    let j = start + 2
    while (j < limit && !(source[j] === '*' && source[j + 1] === '/')) j += 1
    return Math.min(j + 2, limit)
  }
  /** 这个 `{` 前面紧邻的 `属性名=` 是什么（没有则返回 null）。 */
  const attrNameBefore = (index: number): string | null => {
    const before = source.slice(Math.max(0, index - 80), index)
    const matched = /([A-Za-z][\w-]*)\s*=\s*$/.exec(before)
    return matched ? matched[1].toLowerCase() : null
  }
  const walk = (from: number, to: number): void => {
    let i = from
    while (i < to) {
      const ch = source[i]
      if (ch === '"' || ch === "'") {
        i = skipString(i, to)
        continue
      }
      if (ch === '/' && source[i + 1] === '/') {
        const j = skipLineComment(i, to)
        blank(i, j)
        i = j
        continue
      }
      if (ch === '/' && source[i + 1] === '*') {
        const j = skipBlockComment(i, to)
        blank(i, j)
        i = j
        continue
      }
      if (ch === '`') {
        // 模板串：字面量保留（它就是文案），`${…}` 记为直渲
        let j = i + 1
        while (j < to) {
          if (source[j] === '\\') {
            j += 2
            continue
          }
          if (source[j] === '`') {
            j += 1
            break
          }
          if (source[j] === '$' && source[j + 1] === '{') {
            const end = Math.min(matchPair(source, j + 1), to)
            printed.push({ text: source.slice(j + 2, Math.max(j + 2, end - 1)), line: lineOf(j) })
            j = end
            continue
          }
          j += 1
        }
        i = j
        continue
      }
      if (ch === '{') {
        const end = Math.min(matchPair(source, i), to)
        const inner = source.slice(i + 1, Math.max(i + 1, end - 1)).trim()
        const attr = attrNameBefore(i)
        if (attr !== null && !isVisibleJsxAttr(attr)) {
          // `key=` / `loading=` / `onClick=` … 不上屏 → 整段抹掉（里面的 `${…}` 也不算）
          blank(i, end)
          i = end
          continue
        }
        if (isValueExpression(inner)) {
          printed.push({ text: inner, line: lineOf(i) })
          i = end
          continue
        }
        walk(i + 1, Math.max(i + 1, end - 1))
        i = end
        continue
      }
      i += 1
    }
  }
  walk(0, source.length)
  return { residue: chars.join(''), printed }
}

/** 主区里**不许**被直接打印出来的内部信息（结果面板口径）。 */
const PRINTED_INTERNAL_RE =
  /\b(?:row\.(?:oss_url|source_asset_id|service_task_id)|normalized\.(?:url|rawStatus)|singleGenResult\??\.(?:url|status)|referenceBatchResult\??\.project_id|assetId)\b/

/**
 * 切出结果面板所在的两段 JSX（单张结果弹窗 + 批量结果弹窗）。
 *
 * 用**标题锚点**而不是行号：行号会随任何一次改动漂移（审计的行号 ── `:2316-2328` ──
 * 在本批开工时已经漂到 `:2329-2341`）。锚点不存在时直接断言失败，不会静默空跑。
 */
const SINGLE_RESULT_ANCHOR = 'title="生成结果"'
const BATCH_RESULT_ANCHOR = 'title="按定版图片批量出图结果"'
const BATCH_RESULT_END_ANCHOR = 'title="出图前需要先选一个项目"'

function sliceResultPanel(source: string, from: string, to: string): string {
  const start = source.indexOf(from)
  assert.ok(start >= 0, `找不到锚点 ${from} —— 结果面板标题被改了？本测试必须跟着更新，不许静默空跑`)
  const end = source.indexOf(to, start)
  assert.ok(end > start, `找不到锚点 ${to}（在 ${from} 之后）—— 本测试的切片范围必须显式维护`)
  return source.slice(start, end)
}

/**
 * 每个结果面板的「防假绿标记」：抹白非可见表达式之后，这些文案**必须还在**。
 * 一旦剥离器剥多了（例如被字符串里的 `/*` 带偏、或模板串错位），用例会失败而不是静默通过。
 */
const PANEL_MARKERS: Record<'single' | 'batch', readonly string[]> = {
  single: ['生成结果', '本次使用的提示词', '采纳并设为定版', '没有可采纳的图片地址'],
  batch: ['按定版图片批量出图结果', '本次结果：', '图片长期地址：', '采纳到资产', '提交结果', '只用于排查问题时对照'],
}

function resultPanelRegions(): { single: string; batch: string } {
  const code = stripComments(readScan(ASSET_EDIT_BASE))
  return {
    single: sliceResultPanel(code, SINGLE_RESULT_ANCHOR, BATCH_RESULT_ANCHOR),
    batch: sliceResultPanel(code, BATCH_RESULT_ANCHOR, BATCH_RESULT_END_ANCHOR),
  }
}

/** 找出所有 `<TechnicalDetailSection …>…</TechnicalDetailSection>` 的内容（不嵌套）。 */
function findFoldContents(source: string): string[] {
  const out: string[] = []
  const openRe = /<TechnicalDetailSection\b/g
  let match: RegExpExecArray | null
  while ((match = openRe.exec(source)) !== null) {
    const close = source.indexOf('</TechnicalDetailSection>', match.index)
    assert.ok(close > match.index, '`<TechnicalDetailSection` 没有对应的结束标签（折叠区必须闭合）')
    out.push(source.slice(match.index, close))
    openRe.lastIndex = close
  }
  return out
}

/**
 * 把「技术详情」折叠区的**内容**抹白（保留长度与换行）。
 *
 * 为什么需要：第三层（默认收起）**允许**打印内部编号与完整地址 ——
 * `{assetId ?? '未提供'}` 写在折叠区里是合规的，写在主区才是泄漏。
 * 所以「直渲违规」判定要把折叠区排除在外；而「折叠区里确实保留了信息」
 * 由另一条用例**正面断言**（`buildResultRowTechnicalFields` + 折叠区渲染 `field.value`），
 * 不是为了扫得干净而把信息删掉。
 */
function blankFoldContents(source: string): string {
  const chars = source.split('')
  const openRe = /<TechnicalDetailSection\b/g
  let match: RegExpExecArray | null
  while ((match = openRe.exec(source)) !== null) {
    const close = source.indexOf('</TechnicalDetailSection>', match.index)
    if (close < 0) break
    const end = close + '</TechnicalDetailSection>'.length
    for (let k = match.index; k < end; k += 1) if (chars[k] !== '\n') chars[k] = ' '
    openRe.lastIndex = end
  }
  return chars.join('')
}

/** 主区文案里**不许**出现的字段名 / 地址形态（区域补充，正则见注释）。 */
const REGION_CORE_TOKENS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: 'DRY_RUN 字面量', pattern: /DRY_RUN/ },
  { name: 'dry_run 枚举原值', pattern: /(?<![A-Za-z0-9_])dry_run(?![A-Za-z0-9_])/i },
  { name: 'oss_url 字段名', pattern: /(?<![A-Za-z0-9_])oss_url(?![A-Za-z0-9_])/i },
  { name: '裸 oss / OSS', pattern: /(?<![A-Za-z0-9_])oss(?![A-Za-z0-9_])/i },
  { name: 'source_asset_id 字段名', pattern: /(?<![A-Za-z0-9_])source_asset_id(?![A-Za-z0-9_])/i },
  { name: 'service_task_id 字段名', pattern: /(?<![A-Za-z0-9_])service_task_id(?![A-Za-z0-9_])/i },
]

/**
 * 审计 §5.5-C 的**原文形态**：这几种写法必须从结果面板里彻底消失。
 *
 * 与「残留扫描」互补：残留扫描只看得到「裸成员表达式直渲」，
 * 这一组点名断言覆盖条件分支 / 模板串 / 字面标签这些形态。
 */
const AUDIT_ORIGINAL_FORMS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  { pattern: /oss_url：/, why: '模式 2：字面标签 `oss_url：`（审计 §5.5-C 原文 :2319）' },
  {
    pattern: /<a[^>]*rel="noreferrer"[^>]*>\s*\{row\.oss_url\}/,
    why: '模式 4：完整 OSS 地址同时作链接文本（审计原文 :2321-2322）',
  },
  { pattern: /href=\{row\.oss_url\}/, why: '模式 4：`href` 直连 `row.oss_url`（本批改走 describeResultRowAddress 的主区口径）' },
  { pattern: /DRY_RUN 下为空，未上传 OSS/, why: '模式 3：审计原文 :2328' },
  { pattern: /上游图片地址：\$\{normalized\.url\}/, why: '模式 4：临时地址当可见文本渲染' },
  { pattern: /break-all">\{singleGenResult\?\.url\}/, why: '模式 4：`break-all` 直渲完整地址（审计 §4.6 模式 4）' },
  { pattern: /<span className="ml-3">项目：\{referenceBatchResult\.project_id\}<\/span>/, why: '模式 1/§6.1：项目 UUID 直渲' },
  { pattern: /<span>阶段：reference_batch<\/span>/, why: '模式 2：内部提交类型码直渲' },
  { pattern: /service_task_id：/, why: '模式 2 + §6.1：任务号字段名标签' },
  { pattern: /\{row\.service_task_id \|\| '（空）'\}/, why: '模式 1/§6.1：任务号带兜底直渲' },
  { pattern: /<span className="text-xs text-gray-400">\{row\.source_asset_id\}<\/span>/, why: '模式 1：来源资产 UUID 直渲' },
]

/* --------------------------------------------------------------- 护栏自检 */

test('阶段B插批护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGISTERED_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('阶段B插批护栏：§5.5-C 四种模式对应的禁词都能被抓到（DRY_RUN / oss_url / source_asset_id / 槽位 / 枚举原值 / 完整地址）', () => {
  const probe = `
const rawMessage = '来源资产 source_asset_id=9f3c1a2b-0000-4000-8000-000000000001 没有长期地址'
export function Probe() {
  return (
    <div title="供应商 file_id http://localhost:8000/v1">
      演练模式（DRY_RUN）下为空，未上传 OSS；oss_url 这一格是空的
      https://bucket.oss-cn-hangzhou.aliyuncs.com/prefix/scene/a.png
      九类槽位的提示词；costume；partial_failed
    </div>
  )
}
`
  const surfaces = extractScanSurfaces(probe)
  const baseHits = findMainScreenLeaks(probe)
  const terms = new Set(baseHits.map((hit) => hit.term))
  const extraHits: string[] = []
  surfaces.forEach((surface) => {
    REGION_EXTRA_PATTERNS.forEach(({ name, pattern }) => {
      if (pattern.test(surface.text)) extraHits.push(name)
    })
  })
  const surfaceText = surfaces.map((surface) => surface.text).join('\n')

  assert.ok(terms.has('DRY_RUN'), `DRY_RUN 没被抓到：${JSON.stringify(baseHits)}`)
  assert.ok(terms.has('模式2 内部字段名'), 'oss_url / service_task_id 这类字段名没被抓到')
  assert.ok(terms.has('模式1 UUID'), 'UUID 没被抓到')
  assert.ok(terms.has('模式4 接口路径/URL/本机地址'), '本机地址没被抓到')
  assert.ok(terms.has('槽位'), '「槽位」没被抓到')
  assert.ok(terms.has('供应商'), '「供应商」没被抓到（含 JSX 属性值）')
  assert.ok(surfaceText.includes('costume'), '枚举原值 costume 没被抓到')
  assert.ok(surfaceText.includes('partial_failed'), '枚举原值 partial_failed 没被抓到')
  assert.ok(extraHits.includes('区域补充: source_asset_id'), '`source_asset_id` 没被抓到（共享表里没有这一条）')
  assert.ok(extraHits.includes('区域补充: 裸 oss/OSS'), '裸 `OSS` 没被抓到')
  assert.ok(extraHits.includes('区域补充: 完整公网地址'), '完整公网地址没被抓到')
})

test('阶段B插批护栏：用户拍板的业务说法不许被判成泄漏（负向自检）', () => {
  assert.ok(
    scannerNegativeSelfCheck(),
    '「待确认候选」这类业务说法被判成了泄漏 —— 说明词表退化成整词禁，会造成过度整改',
  )
  const allowed: readonly string[] = [
    '查看图片',
    '查看临时图片',
    '已上传到长期存储',
    '还没有上传到长期存储',
    '当前是演练模式，没有上传长期存储',
    '还没有可查看的图片',
    '图片长期地址：已上传到长期存储',
    '本次结果：成功',
    '部分失败：图片已生成，但没能保存成长期图片，暂时不能采纳',
    '已保存 3 个角度提示词；另有 1 个角度判定不可用，未保存',
    '已采纳到该角度（刷新后仍在）',
    '当前是演练模式：没有真的提交出图',
    '（共 5 条，其中 3 条已保存为长期图片）',
    '地址里没有资产编号，请从项目工作台第 2 步「资产准备」进入',
    '共 3 个提交结果（成功 2/共 3）：',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findMainScreenLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些业务说法被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('阶段B插批护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const files = scanFiles()
  assert.ok(files.length >= REGISTERED_FILES.length, `本区域只找到 ${files.length} 个源码文件，目录遍历可能失效了`)
  const counts = files.map((file) => ({ file, count: countScanSurfaces(readFileSync(file, 'utf8')) }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  assert.ok(total >= 380, `本区域只提取到 ${total} 个用户可见扫描面，明显偏少（遍历或提取器可能坏了）`)
  assert.ok(
    counts.some((item) => relAssets(item.file) === ASSET_EDIT_BASE && item.count >= 200),
    '`AssetEditPageBase.tsx` 的扫描面少于 200 个，提取器或遍历一定坏了',
  )
})

test('阶段B插批护栏：JSX 属性值是扫描面的一部分（悬停 / 收起态也看得见，§5.5-D）', () => {
  const surfaces = scanFiles().flatMap((file) => extractScanSurfaces(readFileSync(file, 'utf8')))
  const attrKinds = new Set(
    surfaces.filter((surface) => surface.kind === 'jsx-attr').map((surface) => surface.attr),
  )
  assert.ok(attrKinds.has('title'), '没提取到 `title` 属性面（悬停即见，§5.5-D 实测的泄漏形态）')
  assert.ok(attrKinds.has('description'), '没提取到 `description` 属性面（Alert 正文在收起态也可见）')
  assert.ok(attrKinds.has('message'), '没提取到 `message` 属性面（Alert 标题）')
  assert.ok(attrKinds.has('placeholder'), '没提取到 `placeholder` 属性面')
  const probe = findMainScreenLeaks(
    `${readScan(ASSET_EDIT_BASE)}\nconst __probe__ = () => <div title="供应商 seedance-2.0-mini">正常</div>\n`,
  )
  assert.ok(
    probe.some((hit) => hit.kind === 'jsx-attr' && hit.term === '供应商'),
    '属性值里的禁词没被扫到（「悬停即见」这一类会漏出去）',
  )
})

/* ------------------------------------------- ① 主区禁词 0 命中（核心） */

test('assets：主区禁词扫描 0 命中（基准表 + 枚举原值 + 模型原名 + 区域补充字段名；**无行级豁免**）', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAssets(file)
    const source = readFileSync(file, 'utf8')
    const hits = findMainScreenLeaks(source)
    offenders.push(...formatLeakHits(relPath, hits))
    // 区域补充：共享表覆盖不到的字段名 / 地址形态
    extractScanSurfaces(source).forEach((surface) => {
      REGION_EXTRA_PATTERNS.forEach(({ name, pattern }) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ ${surface.kind} ｜ 命中「${name}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(
    offenders,
    [],
    `资产编辑页主区出现泄漏（模式 1/2/3/4 或主区禁词）：\n${offenders.join('\n')}`,
  )
})

test('assets：审计 §5.5-C 点名的核心词（DRY_RUN / oss / oss_url / source_asset_id / service_task_id）0 命中', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAssets(file)
    extractScanSurfaces(readFileSync(file, 'utf8')).forEach((surface) => {
      REGION_CORE_TOKENS.forEach(({ name, pattern }) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ ${surface.kind} ｜ 命中「${name}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `这些是第三层内容，主区一个字面量都不许有：\n${offenders.join('\n')}`)
})

test('阶段B插批词表守卫：词源与 `enumLabels` 同源，新增枚举自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('DRY_RUN'), '主区禁词表里必须有 `DRY_RUN`')
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('槽位'), '主区禁词表里必须有「槽位」')
  ;(['dry_run', 'partial_failed', 'costume'] as const).forEach((raw) => {
    assert.ok(ENUM_RAW_VALUES.includes(raw), `枚举原值词表里必须有 ${raw}`)
  })
})

/* --------------------------------------------- ② 渲染点口径（扫描器看不见的那类） */

test('§5.5-C 纯函数口径：主区只给中文结论 + 动作词，完整地址与内部编号只进技术详情字段', () => {
  const ossUrl = 'https://bucket.oss-cn-hangzhou.aliyuncs.com/prefix/scene/9f3c1a2b.png'
  const sourceAssetId = '9f3c1a2b-0000-4000-8000-000000000001'
  const saved = normalizeAssetResultRow({
    outcome: 'succeeded',
    oss_url: ossUrl,
    source_asset_id: sourceAssetId,
    service_task_id: 'svc-1234',
  })
  const savedView = describeResultRowAddress(saved)
  assert.equal(savedView.text, ASSET_RESULT_ADDRESS_SAVED_TEXT, '保存成功时主区必须说「已上传到长期存储」')
  assert.equal(savedView.link?.text, ASSET_RESULT_VIEW_IMAGE_TEXT, '链接可见文本必须是动作词「查看图片」')
  assert.equal(savedView.link?.href, ossUrl, '`href` 仍然可用（链接本身不算泄漏）')
  assert.equal(savedView.link?.text.includes('http'), false, '链接可见文本不许是地址')
  assert.equal(savedView.text.includes('http'), false, '主区结论不许含地址')

  const savedFields = buildResultRowTechnicalFields(saved)
  const byLabel = new Map(savedFields.map((field) => [field.label, field.value]))
  assert.equal(byLabel.get('图片长期地址'), ossUrl, '完整地址（含 bucket / prefix / object key）必须保留在技术详情里')
  assert.equal(byLabel.get('来源资产编号'), sourceAssetId, '来源资产 UUID 必须保留在技术详情里')
  assert.equal(byLabel.get('提交编号'), 'svc-1234', '§6.1：任务号必须保留在技术详情里')
  assert.equal(byLabel.get('原始状态值'), 'succeeded', '枚举原值只进技术详情')
  savedFields.forEach((field) => {
    assert.ok(CJK_RE.test(field.label), `技术详情字段标签必须是中文：${field.label}`)
    assert.equal(/_/.test(field.label), false, `技术详情字段标签不许是后端字段名：${field.label}`)
  })

  // 演练模式：主区说「当前是演练模式，没有上传长期存储」，且不给链接（没有真实图片）
  const dry = describeResultRowAddress(normalizeAssetResultRow({ dry_run: true, status: 'succeeded' }))
  assert.equal(dry.text, ASSET_RESULT_ADDRESS_DRY_RUN_TEXT)
  assert.equal(dry.link, null)
  assert.equal(/DRY_RUN|OSS/.test(dry.text), false, '演练口径里不许出现 DRY_RUN / OSS 字样')

  // 只有临时地址：说清「还没有上传到长期存储」，但仍让用户能打开这张图
  const tempUrl = 'http://localhost:8000/images/tmp-a.png'
  const temp = describeResultRowAddress(normalizeAssetResultRow({ status: 'succeeded', image_url: tempUrl }))
  assert.equal(temp.text, ASSET_RESULT_ADDRESS_TEMP_TEXT)
  assert.equal(temp.link?.text, ASSET_RESULT_VIEW_TEMP_IMAGE_TEXT)
  assert.equal(temp.link?.href, tempUrl)
  assert.equal(temp.text.includes('http'), false)

  // 连地址都没有（失败行）：如实说「还没有可查看的图片」，不糊弄成成功
  const none = describeResultRowAddress(normalizeAssetResultRow({ status: 'failed' }))
  assert.equal(none.text, ASSET_RESULT_ADDRESS_MISSING_TEXT)
  assert.equal(none.link, null)

  // 演练占位地址（`dry-run.invalid`）不可打开：不给链接
  const placeholder = describeResultRowAddress(
    normalizeAssetResultRow({ status: 'succeeded', image_url: 'https://dry-run.invalid/a.png' }),
  )
  assert.equal(placeholder.link, null, '演练占位地址不许给出可点链接')
})

test('§5.5-C 渲染点专项：结果面板不许把 `row.oss_url` / `row.source_asset_id` / `row.service_task_id` 当可见文本渲染', () => {
  const { single, batch } = resultPanelRegions()
  ;[
    { key: 'batch' as const, name: '批量结果面板', region: batch },
    { key: 'single' as const, name: '单张结果弹窗', region: single },
  ].forEach(({ key, name, region }) => {
    const analysis = analyzePanelJsx(region)
    // 防假绿：抹白之后必须还剩大量真实文案，否则「剥多了」会把泄漏一起抹掉
    PANEL_MARKERS[key].forEach((marker) => {
      assert.ok(
        analysis.residue.includes(marker),
        `${name}：抹白非可见表达式后连「${marker}」都不见了 —— 剥离器可能吞掉了整段代码（宁可失败也不许假绿）`,
      )
    })
    /* 违规判定**排除「技术详情」折叠区**：第三层（默认收起）允许打印内部编号与完整地址。
       折叠区里是否**确实**保留了这些信息，由下面「地址与内部编号确实出现在默认收起的
       『技术详情』里」那条用例正面断言。 */
    const offenders = analyzePanelJsx(blankFoldContents(region)).printed
      .filter((item) => PRINTED_INTERNAL_RE.test(item.text))
      .map((item) => `:${item.line} ｜ ${item.text}`)
    assert.deepEqual(
      offenders,
      [],
      `${name}：这些内部编号 / 地址被当成**可见文本**渲染了（主区只给中文结论和「查看图片」这种动作）：\n${offenders.join('\n')}`,
    )
  })

  // 审计原形一条一条点名（条件分支 / 模板串 / 字面标签这些残留扫描看不到）
  const code = stripComments(readScan(ASSET_EDIT_BASE))
  const offenders = AUDIT_ORIGINAL_FORMS.filter(({ pattern }) => pattern.test(code)).map(({ why }) => why)
  assert.deepEqual(offenders, [], `审计 §5.5-C 的原文形态还在：\n${offenders.join('\n')}`)

  /* 另加一条**独立**于共享扫描器的检查：这个文件里不许出现明文 URL 字面量。
     为什么需要它：共享扫描器会把 JSX 文本节点里的 `http://…` 当成**行注释起点**
     （`//` → 该行余下被抹白），所以「文案里直接写地址」这一类它其实扫不到。
     正则字面量 `/^https?:\/\//i` 里是 `\/\/`（转义），不会被这条检查误伤。 */
  const literalUrls = readScan(ASSET_EDIT_BASE).match(/https?:\/\/[^\s"'`<>)]+/g) ?? []
  assert.deepEqual(
    literalUrls,
    [],
    `资产编辑页源码里出现了明文地址字面量（模式 4）：\n${literalUrls.join('\n')}`,
  )
})

test('§5.5-C 渲染点专项：链接可见文本是动作词，不是完整地址', () => {
  const { batch, single } = resultPanelRegions()
  // 批量行：<a …href={addressView.link.href}…>{addressView.link.text}</a>
  assert.ok(
    /href=\{addressView\.link\.href\}[\s\S]{0,200}?>\s*\{addressView\.link\.text\}\s*<\/a>/.test(batch),
    '批量结果行的链接必须走 `describeResultRowAddress`（href 可用、可见文本是动作词）',
  )
  assert.equal(
    />\s*\{row\.oss_url\}\s*</.test(batch),
    false,
    '链接可见文本仍然是完整地址（审计 §5.5-C 模式 4 的原文形态）',
  )
  // 单张弹窗：图片用 <img> 给用户看，地址不再以文本出现
  assert.ok(/<img src=\{singleGenResult\.url\}/.test(single), '单张结果必须仍然把图片本身给用户看（不许靠删信息过关）')
  assert.equal(
    /className="[^"]*break-all[^"]*">\{singleGenResult\?\.url\}/.test(single),
    false,
    '单张弹窗还在用 `break-all` 直渲完整地址（审计 §4.6 模式 4）',
  )
  assert.ok(
    /<span className="font-mono break-all">\{singleGenResult\?\.url \|\| '未返回'\}<\/span>/.test(single),
    '完整地址必须保留在「技术详情」折叠区里（信息不许被删掉）',
  )
})

test('§5.5-C 渲染点专项：地址与内部编号确实出现在默认收起的「技术详情」里（不是靠删信息过关）', () => {
  const code = stripComments(readScan(ASSET_EDIT_BASE))
  const folds = findFoldContents(code)
  assert.ok(folds.length >= 2, `结果面板里只找到 ${folds.length} 个技术详情折叠区，单张 + 批量行至少各一个`)

  // ① 折叠区必须由共享壳渲染，且渲染的是纯函数抽出来的第三层字段
  assert.ok(
    folds.some((fold) => fold.includes('technicalFields.map') || fold.includes('singleGenTechnicalFields.map')),
    '折叠区必须渲染 `buildResultRowTechnicalFields(...)` 的字段（否则就是「把信息删掉」而不是「收起来」）',
  )
  assert.ok(
    folds.some((fold) => /\{field\.label\}/.test(fold) && /\{field\.value\}/.test(fold)),
    '折叠区必须同时渲染字段标签与**原值**（原值里就是 UUID / 完整地址）',
  )
  // ② 第三层字段的来源函数必须真的读这些后端字段（纯函数里读，不是主区文案里写）
  const summarySource = readScan('assetResultSummary.ts')
  ;['oss_url', 'source_asset_id', 'service_task_id'].forEach((key) => {
    assert.ok(
      summarySource.includes(`'${key}'`),
      `\`buildResultRowTechnicalFields\` 必须把这几个后端字段收进技术详情：${key}`,
    )
  })
  // ③ 行为级：给一条真实形状的行，第三层必须拿到完整地址与两个内部编号
  const normalized = normalizeAssetResultRow({
    outcome: 'succeeded',
    oss_url: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/a/b/c.png?x=1',
    source_asset_id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee',
    service_task_id: 'svc-9',
    status: 'succeeded',
  })
  const values = buildResultRowTechnicalFields(normalized).map((field) => field.value)
  assert.ok(values.includes('https://bucket.oss-cn-hangzhou.aliyuncs.com/a/b/c.png?x=1'), '完整地址没进技术详情')
  assert.ok(values.includes('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), '来源资产编号没进技术详情')
  assert.ok(values.includes('svc-9'), '提交编号没进技术详情')
})

test('§5.5-C 渲染点专项：技术详情**默认收起**（共享壳不带 open，调用点也不许自己加）', () => {
  const shell = readFileSync(resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  const detailsMatch = /<details[^>]*>/.exec(shell)
  assert.ok(detailsMatch, '共享折叠壳必须用原生 `<details>` 实现（收起态由浏览器保证）')
  const detailsTag = detailsMatch ? detailsMatch[0] : ''
  assert.equal(/\bopen\b/.test(detailsTag), false, '共享壳的 `<details>` 带了 `open` —— 那就不叫默认收起了')
  assert.ok(shell.includes('export function TechnicalDetailSection'), '共享壳必须导出 `TechnicalDetailSection`')
  const code = stripComments(readScan(ASSET_EDIT_BASE))
  findFoldContents(code).forEach((fold) => {
    assert.equal(/\bopen\b/.test(fold.slice(0, fold.indexOf('>'))), false, '调用点给折叠区加了 `open`')
  })
  // 收起态可见的 hint 也必须干净（§2.1 判定铁律：折叠标题在收起状态下也可见）
  const hints = code.match(/hint="[^"]*"/g) ?? []
  assert.ok(hints.length >= 1, '至少应当给结果行的折叠区写一句收起态可见的说明')
  hints.forEach((hint) => {
    const hits = findMainScreenLeaks(`const __probe__ = () => <div hint=${hint} />`)
    assert.deepEqual(hits, [], `折叠区的 hint 在收起态也可见，必须干净：${hint}`)
  })
})

test('阶段B插批工具自检：注释剥离是逐行的，不会因为字符串里的 `/*` 吞掉后面几百行代码', () => {
  const probe = [
    'const accept = ".jpg,.jpeg,.png,image/*"',
    'const 已关联场景 = 1',
    'const 另一段 = 2',
  ].join('\n')
  const stripped = stripComments(probe)
  assert.ok(stripped.includes('已关联场景'), '`stripComments` 被字符串里的 `/*` 带偏，吞掉了后面的代码')
  assert.ok(stripped.includes('另一段'), '`stripComments` 吞掉了后续行')
  const analysis = analyzePanelJsx(probe)
  assert.ok(analysis.residue.includes('已关联场景'), '`analyzePanelJsx` 的残留计算被字符串里的 `/*` 带偏')
  assert.ok(analysis.residue.includes('另一段'), '`analyzePanelJsx` 吞掉了后续行')
  // 抹白自检：抹白必须**保留长度与换行**，否则行号与行级断言都会错位
  assert.equal(analysis.residue.length, probe.length, '抹白后长度变了（应当用空格占位）')
  assert.equal(analysis.residue.split('\n').length, probe.split('\n').length, '抹白后行数变了')
  /* 「直渲」判定自检：`{row.oss_url}` 这种裸成员表达式必须被判成直渲；
     `row.oss_url ? '有图' : '没图'` 是条件、`key={\`${row.oss_url}\`}` 是不上屏的 key，
     两者都不许被判成直渲（否则会用假阳性把下一个人逼去改对的代码）。 */
  const probe2 = [
    'const a = <div>{row.oss_url}</div>',
    "const b = <div title={row.oss_url ? '有图' : '没图'} />",
    'const c = <div key={`${row.oss_url}`} />',
    'const d = <a href={row.oss_url}>查看图片</a>',
  ].join('\n')
  const analysis2 = analyzePanelJsx(probe2)
  assert.deepEqual(
    analysis2.printed.map((item) => item.text),
    ['row.oss_url'],
    '「直渲」判定不对：只有 `{row.oss_url}`（JSX 子插值）算直渲；条件、`key=`、`href=` 都不算',
  )
})

/* -------------------------------------------------------- ③ 扫描范围守卫 */

test('阶段B插批扫描范围守卫：登记表里的文件真实存在，且都被目录遍历覆盖到', () => {
  const onDisk = scanFiles().map(relAssets)
  const declaredButMissing = REGISTERED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(declaredButMissing, [], `登记表里列了不存在（或已被改名）的文件：${declaredButMissing.join('、')}`)
  assert.ok(onDisk.length >= REGISTERED_FILES.length, '扫描面比登记表还小，说明遍历被缩窄了')
  const undeclared = onDisk.filter((file) => !REGISTERED_FILES.includes(file))
  assert.deepEqual(
    undeclared,
    [],
    `这些 assets/** 源码文件没被登记（新增文件必须显式登记，否则扫描范围会悄悄变大而没人知道）：${undeclared.join('、')}`,
  )
})

test('阶段B插批扫描范围守卫：每个目录都有文件（遍历被人为缩窄会立刻失败）', () => {
  const dirs = new Set(
    scanFiles()
      .map((file) => relative(ASSETS_ROOT, dirname(file)))
      .filter((dir) => !dir.startsWith('..')),
  )
  const missing = EXPECTED_DIRS.filter((dir) => !dirs.has(dir))
  assert.deepEqual(
    missing,
    [],
    `这些目录在扫描结果里一个文件都没有，说明目录遍历被缩窄了：${missing.join('、')}（实际：${[...dirs].sort().join('、')}）`,
  )
})

/* ------------------------------------------------------------ ④ 豁免守卫 */

test('阶段B插批豁免守卫：`assets/**` 里不许出现第二套「技术详情」/ 自建 `<details>`', () => {
  const waiverPath = resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER)
  const waiver = readFileSync(waiverPath, 'utf8')
  assert.ok(
    waiver.includes('技术详情（默认收起）'),
    '共享壳的标题文案变了？豁免守卫按它的标题识别「第二套实现」，必须同步',
  )
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAssets(file)
    const code = stripComments(readFileSync(file, 'utf8'))
    if (code.includes('技术详情（默认收起）')) {
      offenders.push(`${relPath} 复制了统一折叠壳的标题文案`)
    }
    if (/<details[\s\S]{0,400}?技术详情/.test(code)) {
      offenders.push(`${relPath} 自建了 <details> 形态的技术详情`)
    }
    if (/<details[\s\S]{0,400}?技术详情[\s\S]{0,400}?<\/details>/.test(code)) {
      offenders.push(`${relPath} 自建了 <details> 形态的技术详情`)
    }
  })
  // 结果面板必须用共享壳，而不是自己搓一个折叠区
  const panel = stripComments(readScan(ASSET_EDIT_BASE))
  assert.ok(
    panel.includes(`from '${TECHNICAL_DETAIL_IMPORT}'`),
    '结果面板必须 import **全仓唯一**的折叠壳 `TechnicalDetailSection`（审计 §9 第 2 项）',
  )
  assert.deepEqual(offenders, [], `出现了第二套「技术详情」实现，必须改用 TechnicalDetailSection：\n${offenders.join('\n')}`)
})

/* ------------------------------------------- ⑤ 手工核对登记（扫描器看不见的） */

test('第6批：后端自动生成描述的中文转述 + 资产名系统前缀剥离（纯函数口径）', () => {
  /* 审计 §4.6 模式 2 的**运行时原文**（真库数据 `SCENE_暗巷地下诊所内外` 的 description）：
     后端把内部字段名清单直接写进了描述，页面原样上屏。 */
  const raw =
    '资产：暗巷地下诊所内外\n资产描述：该场景是暗巷地下诊所的内外环境。, 已根据该资产出现的 segments、shots、台词、visual_focus、continuity_note 和 story_function 生成'
  const cleaned = describeAssetDescription(raw)
  assert.ok(
    cleaned.includes(ASSET_AUTO_DESCRIPTION_TEXT),
    `后端自动生成句必须换成中文口径：${cleaned}`,
  )
  assert.equal(
    /[a-z]{3,}(?:_[a-z0-9]+)+/.test(cleaned),
    false,
    `转述后不许残留 snake_case 形态的字段名：${cleaned}`,
  )
  assert.equal(/segments|shots\b/.test(cleaned), false, `转述后不许残留英文字段名清单：${cleaned}`)
  assert.ok(cleaned.includes('资产：暗巷地下诊所内外'), '同一段描述里的正常内容必须原样保留（不许整段删掉）')
  // 幂等：已经转述过的文本再跑一次不变（所以它能直接套在会被反复渲染的字段上）
  assert.equal(describeAssetDescription(cleaned), cleaned, '转述函数必须幂等')
  // 反向：普通中文描述一个字都不许动
  assert.equal(describeAssetDescription('走廊尽头有一盏红色的警示灯。'), '走廊尽头有一盏红色的警示灯。')
  assert.equal(hasInternalFieldToken('走廊尽头有一盏红色的警示灯。'), false)

  /* 名称前缀（审计 §4.6 模式 1 数据侧形态）：真库 id/name 是 `SCENE_星耀疗养院…` */
  assert.equal(stripAssetNamePrefix('SCENE_星耀疗养院S级特护病房门外'), '星耀疗养院S级特护病房门外')
  assert.equal(stripAssetNamePrefix('PROP_医用剪刀'), '医用剪刀')
  assert.equal(stripAssetNamePrefix('CHAR_战凛'), '战凛')
  assert.equal(stripAssetNamePrefix('星耀疗养院'), '星耀疗养院', '没有前缀的名字必须原样返回')
  assert.equal(stripAssetNamePrefix('SCENE_'), 'SCENE_', '剥完为空时必须回退原名（不许把名字清空）')
})

test('第6批渲染点专项：名称 / 描述在**展示层**转述，原文进「技术详情」（双向）', () => {
  const code = stripComments(readScan(ASSET_EDIT_BASE))
  // 主区（可编辑字段）走展示层函数：名称剥前缀、描述转述
  assert.ok(
    /value=\{stripAssetNamePrefix\(formName\)\}/.test(code),
    '名称输入框必须显示剥离前缀后的名字（审计 §4.6 模式 1 数据侧）',
  )
  assert.ok(
    /value=\{describeAssetDescription\(formDesc\)\}/.test(code),
    '描述输入框必须显示转述后的中文（审计 §4.6 模式 2）',
  )
  assert.ok(
    /onChange=\{\(e\) => setFormName\(e\.target\.value\)\}/.test(code),
    '名称的 onChange 必须仍然写原始值（在可编辑字段上直接改写等于替用户改名 → 数据变更）',
  )
  // 折叠区：原文必须真的在默认收起层里（不是删信息）
  const folds = findFoldContents(code)
  const descFold = folds.find((fold) => fold.includes('testId="asset-description-technical-detail"'))
  assert.ok(descFold, '必须有一个承载「描述原文」的技术详情折叠块')
  assert.ok(
    descFold.includes('{asset.description}'),
    '描述折叠块里必须渲染**后端原始描述**（否则就是「把信息删掉」而不是「收起来」）',
  )
  assert.ok(
    folds.some((fold) => fold.includes('资产原名：{asset?.name')),
    '页级技术详情必须保留资产原名（审计 §4.6 模式 1：「原名进技术详情」）',
  )
  assert.equal(
    /className="font-mono">\{asset\.description\}/.test(code),
    false,
    '后端原始描述不许出现在折叠区之外',
  )
})

test('第6批手工核对登记：`assets/**` 的**已知未处理**动态插值渲染点（不许悄悄增加 / 减少）', () => {
  /**
   * 静态扫描**原理上**看不见「把后端值插进 JSX」（§5.6：泄漏的主因），
   * 所以每批都要逐条手工核对并登记。第 6 批的登记表分两段：
   *
   * ## ① 上一批的登记项：本批已修（**不许回潮**）
   *
   * | 上一批登记（未修） | 本批改成 |
   * |---|---|
   * | 工具栏「资产类型：`{assetNavigateRelationType}`」（`scene` 原值） | 走 `labelFor(ASSET_TYPE, …)` → 「场景」 |
   * | 工具栏「项目作用域：`{resolvedProjectId}`」（UUID） | 「所属项目：<项目名>」（名称读不到时给中文占位，**不回显编号**） |
   * | 角度卡片 `ID {slot.image.id}`（「ID 23」） | 主区给「已出图」，编号进页级「技术详情」 |
   * | 备选图标题 `` `图片 ${candidate.id}` `` | 「历史生成图（第 N 张）」 |
   * | 资产标题旁 `{asset.id ? <Tag>{asset.id}</Tag> : null}` | 删除主区 Tag，编号进页级「技术详情」 |
   *
   * ## ② 仍然未处理（**逐条写明为什么不属本批可写范围**）
   *
   * | 落点 | 现状 | 为什么本批不改 |
   * |---|---|---|
   * | `describePromptSaveFailure(error)` 的 `message` / `fix` 直上 toast（`handleSaveImagePrompts`） | 后端结构化错误原文出口 | 该函数在 `project/ProjectWorkbench/components/assetPromptQuality.ts`（**区域 2/5 的可写范围**），按「不许跨目录改」只登记 |
   * | `PromptQualityAlert` 的 `verdict.reason` | 同上（`assetPromptQuality.ts` 产出） | 同上 |
   * | 全局资产写入确认弹窗的 `writeScope.lines` | 同上（`assetWriteScope.ts` 产出） | 同上 |
   * | 名称 / 描述输入框：**展示层**已转述（`stripAssetNamePrefix` / `describeAssetDescription`），但保存仍写原始值 | 可编辑字段 | 在可编辑字段上直接改写并保存 = 替用户改数据（改名 / 改描述），属数据变更、不属文案治理；已用「展示层转述 + 原名进技术详情」覆盖主区 |
   *
   * 这条用例的作用不是「放行」，而是**上锁**：登记项一旦被改动（修好或改坏），
   * 断言会失败，逼着下一个人回来更新这张表。
   */
  const code = stripComments(readScan(ASSET_EDIT_BASE))
  // ① 上一批登记项：修好的形态一个字都不许回来
  const resurrected: readonly { readonly marker: string; readonly note: string }[] = [
    {
      marker: '`资产类型：${assetNavigateRelationType}`',
      note: '工具栏「资产类型：scene」枚举原值直渲（§4.6 模式 1）回潮了',
    },
    {
      marker: '`项目作用域：${resolvedProjectId}`',
      note: '工具栏「项目作用域：<UUID>」直渲（§4.6 模式 1）回潮了',
    },
    { marker: 'ID {slot.image.id}', note: '角度卡片「ID 23」数字 ID 直渲（§4.6 模式 1）回潮了' },
    { marker: '`图片 ${candidate.id}`', note: '备选图标题数字 ID 直渲（§4.6 模式 1）回潮了' },
    { marker: '{asset?.id ? <Tag>{asset.id}</Tag> : null}', note: '资产标题旁内部 ID Tag 直渲（§4.6 模式 1）回潮了' },
    { marker: '项目作用域：请先从项目工作台', note: '「项目作用域」这条内部实现口径（§5.5-E）回潮了' },
    { marker: '生成客户端代码后重试', note: '把开发命令 `openapi:update` 给终端用户看（§4.6 模式 4）回潮了' },
  ]
  const back = resurrected.filter((entry) => code.includes(entry.marker))
  assert.deepEqual(
    back.map((entry) => entry.note),
    [],
    `本批已修好的渲染点又回来了：\n${back.map((entry) => entry.note).join('\n')}`,
  )
  // ② 登记在册的「仍未处理」出口必须还在（否则说明它被改动了，登记表要同步）
  const stillThere: readonly { readonly marker: string; readonly note: string }[] = [
    { marker: 'describePromptSaveFailure(error)', note: '结构化保存失败的原文出口（属 ProjectWorkbench 可写范围，只登记）' },
    { marker: 'writeScope.lines.map', note: '全局资产写入确认弹窗的行（文案由 assetWriteScope.ts 产出，只登记）' },
  ]
  const missing = stillThere.filter((entry) => !code.includes(entry.marker))
  assert.deepEqual(
    missing.map((entry) => entry.note),
    [],
    `登记在册的「仍未处理」出口找不到了 —— 要么被处理了（请更新登记表），要么被改名了：\n${missing
      .map((entry) => entry.note)
      .join('\n')}`,
  )
  // ③ 本批新增的第三层出口必须真的在（不是靠删信息过关）：页级技术详情含编号与原始取值
  const folds = findFoldContents(code)
  assert.ok(
    folds.some((fold) => fold.includes('资产编号：') && fold.includes('资产类型（原始取值）：')),
    '页级「技术详情」必须承载资产编号与资产类型原始取值（否则就是删信息而不是收起来）',
  )
  assert.ok(
    folds.some((fold) => fold.includes('已出图角度的图片编号：')),
    '角度图片编号必须保留在默认收起的技术详情里（§4.6 模式 1 要求收起来、不是删掉）',
  )
  // ④ §5.5-C 已修的那一类同样不许回潮（沿用上一批的断言，**不放宽**）
  const { batch, single } = resultPanelRegions()
  ;[batch, single].forEach((region) => {
    assert.equal(
      /阶段：reference_batch/.test(region),
      false,
      '结果面板顶部的内部提交类型码又回到了主区（插批已把它收进「技术详情」）',
    )
    assert.equal(
      /资产：\{assetId/.test(region),
      false,
      '结果面板顶部的资产 UUID 又回到了主区（插批已把它收进「技术详情」）',
    )
    assert.equal(
      /oss_url：|项目作用域：\{resolvedProjectId\}/.test(region),
      false,
      '结果面板主区又出现了字段名标签 / UUID 直渲（审计 §5.5-C 模式 2/1）',
    )
  })
})
