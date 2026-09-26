/**
 * 「任务中心与任务通知 主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B 第 4 批 · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md`
 *  §4.4「任务中心与任务通知」+ §6.1 任务号口径 + §8.1 区域 4）
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * 本测试**只**扫描审计 §4.4 逐条点名的这 14 个文件（`REGION_FILES`，在文件里逐个列出）：
 *
 * | # | 扫描面 | §4.4 点名条目 |
 * |---|---|---|
 * | 1 | `components/TaskCenter.tsx` | 模式 1（`:414-415` 渲染咽喉）、模式 3（陈旧 `running` 误导，R16） |
 * | 2 | `components/taskCopy.ts` | 模式 1（`:208` 实体 ID 兜底）、模式 3（`:198` 任务类型英文原值，R15） |
 * | 3 | `components/taskCenterMeta.ts` | 模式 1（`:63,80,87,122,162` 五处 ID 兜底） |
 * | 4 | `components/taskActionHelpers.ts` | 模式 6（`:32,40,41` 后端原文直通管道、`:86,93,117` message 实参） |
 * | 5 | `components/taskResultHelpers.ts` | 模式 6（`:35` `data.error` 透传） |
 * | 6 | `components/taskNotificationHelpers.tsx` | 时间 / 耗时口径（通知与任务中心必须同口径） |
 * | 7 | `components/taskUiStore.ts` | §4.4「合规范本」（取消任务的 message 出口） |
 * | 8 | `components/taskPageContext.ts` | §4.4 列为「无用户可见文案」（本测试钉住这一点） |
 * | 9 | `components/TaskRuntimeProvider.tsx` | 同上 |
 * | 10 | `components/GenerationGateBanner.tsx` | 模式 3（`:62` `状态：{info.state}`）、模式 6（`:43` 真实原因） |
 * | 11 | `components/generationGate.ts` | 模式 4（`:56` 抛错含接口路径）、模式 5（`:100-141` 供应商 / 模型 id） |
 * | 12 | `components/generationStatusCore.ts` | 模式 3（`:161,162,169,305,324`）、模式 4（`:99-101`）、模式 6（`:127`） |
 * | 13 | `components/RealRunModeBadge.tsx` | 模式 4（`:189,201,209,283`）、模式 6（`:64-65,268`） |
 * | 14 | `components/realRunModeCore.ts` | 模式 2（`:159-161,173-174,181`）、模式 3（`:286,249,264,459`）、模式 4（`:139,140`） |
 *
 * ⚠️ **本测试不覆盖 `components/**` 的其它文件**：`enumLabels.ts`、`userFacingMessage.ts`、
 * `maskInternalIds.ts`、`mainScreenCopyGuard.ts`、`userFacingTime.ts` 属**序 1 管道层批次**
 * 的交付物（各有自己的测试：`enumLabels.test.ts` / `userFacingMessage.test.ts` /
 * `maskInternalIds.test.ts`），本测试不为它们背书。
 *
 * ⚠️ **`layouts/MainLayout.tsx` 只做定点断言、整文件不进扫描面**（§4.6-R20 / §7.2 序 4 点名
 * 的那处面包屑兜底）。原因有二：
 *   ① 我的可写范围只限那一处面包屑，而该文件里「LLM 调试台（开发）」这句导航名会被
 *      词表里的 `llm` 原值（大小写不敏感整词）命中 —— 它是 §9.0-1「`llmPipeline` 按仅开发可见
 *      整批降级、导航淡化本轮不改」的既有裁定，不是本批该动的内容；
 *   ② 硬把它拉进扫描面就得整文件豁免，那正是审计 §8.1.1 禁止的「给豁免开口子」。
 * 因此改为对面包屑块做**更强**的定点断言（见 `MainLayout 面包屑` 两条用例）。
 *
 * ================================ 三层模型与豁免（审计 §2.1 / §8.1.1） ================================
 *
 * 主区不许出现第三层内容（内部 ID / 后端字段名 / 英文枚举原值 / 接口路径 / 供应商与模型原名 /
 * 后端错误原文）。本区域第三层内容**只有**两个物理落点，且都不是第二套实现：
 *
 *   1. `components/GenerationGateBanner.tsx` + `components/RealRunModeBadge.tsx` 里
 *      复用全仓唯一的 `TechnicalDetailSection`（`project/ProjectWorkbench/components/workbench/
 *      TechnicalDetailCollapse.tsx`）渲染的默认收起折叠区；
 *   2. `components/realRunModeCore.ts` 里**只生产数据、不渲 JSX** 的四个技术详情生产者函数
 *      （`buildEnableSteps` / `buildRestoreSteps` / `buildHowToEnable` / `buildHowToRestore`）——
 *      审计 §8.1.1 第 2 条规定这类 `.ts` 生产者文件属「机械豁免」，但**必须钉住两条**：
 *      ① 被豁免的函数恰好是这四个（不许把主区文案挪进去蒙混过扫描）；
 *      ② 它们的产物在渲染侧的**全部**消费点都落在默认收起的折叠区内。
 *      本测试用「函数边界」而不是行号圈范围（行号会随任何改动漂移），并逐条钉住上面两条。
 *
 * 覆盖的扫描面形态沿用共享扫描器（`components/mainScreenCopyGuard.ts`，审计 §8.1 硬要求）：
 * JSX 文本节点、**JSX 属性值**（`title` / `placeholder` / `description` / `message` / `label` …，
 * 收起态与悬停态也看得见）、字符串与模板字面量。
 *
 * ============================== 注释剥离器（不要用朴素正则） ==============================
 *
 * 前几批实测：`accept=".jpg,…,image/*"` 这类**字符串里的块注释起止符**会让「先正则去块注释」
 * 的朴素实现从这里开始吞掉几百行，让源码级断言变成**假绿**。所以本文件的 `stripComments`
 * 与 `chapterStudioCopy.test.ts` 一样是**逐行**处理，永不跨行吞代码。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ENUM_RAW_VALUES,
  GENERATION_GATE_STATE,
  MODEL_RAW_NAMES,
  REAL_RUN_AUDIT_ACTION,
  REAL_RUN_OUTLET,
  TASK_KIND,
  TASK_STATUS,
  labelFor,
} from './enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
  type LeakHit,
} from './mainScreenCopyGuard.ts'
import { looksLikeMachineTimestamp, formatUserFacingTime } from './userFacingTime.ts'
import {
  TASK_STALE_ADVICE,
  TASK_STALE_AFTER_HOURS,
  TASK_STALE_STATUS_LABEL,
  assessTaskFreshness,
  resolveRelationTypeLabel,
  resolveTaskSourceLabel,
  resolveTaskTitle,
  taskTimeLabel,
} from './taskCopy.ts'
import { parseRealRunMode } from './realRunModeCore.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/components` → `front/src/pages/aiStudio` */
const AISTUDIO_ROOT = resolve(HERE, '..')
/** `front/src` */
const SRC_ROOT = resolve(AISTUDIO_ROOT, '../..')

/**
 * 审计 §4.4 对应的**全部**文件（逐个列出，见文件头表格）。
 *
 * 这份表同时是「已登记的文件必须真实存在、且真的被遍历到」的范围守卫依据。
 */
const REGION_FILES: readonly string[] = [
  'components/TaskCenter.tsx',
  'components/taskCopy.ts',
  'components/taskCenterMeta.ts',
  'components/taskActionHelpers.ts',
  'components/taskResultHelpers.ts',
  'components/taskNotificationHelpers.tsx',
  'components/taskUiStore.ts',
  'components/taskPageContext.ts',
  'components/TaskRuntimeProvider.tsx',
  'components/GenerationGateBanner.tsx',
  'components/generationGate.ts',
  'components/generationStatusCore.ts',
  'components/RealRunModeBadge.tsx',
  'components/realRunModeCore.ts',
]

/** 本批**不许**出现在扫描面里的其它批次目录（防止「顺手多扫」替别人背书）。 */
const OTHER_BATCH_PREFIXES: readonly string[] = [
  'assets/',
  'chapter/',
  'shots/',
  'project/',
  'models/',
  'services/',
  'promptFlow/',
]

/**
 * 区域补充的**后端字段名**（共享正则里没有、但 §4.4 与本区域代码会读到的）。
 *
 * 判定只针对**用户可见扫描面**：源码里读这些字段名（契约读取代码）是正常的，
 * 上屏才是模式 2。
 */
const REGION_EXTRA_FIELD_PATTERN =
  /(?<![A-Za-z0-9_])(?:service_task_id|provider_id|task_type|enum_code|generation_type|oss_url)(?![A-Za-z0-9_])/i

/**
 * 区域补充的**逐字禁词**（比共享基准表更严的一层）。
 *
 * `apimart` 是生成服务的原始名，共享词表的模式 5 只收「模型原名」
 * （`MODEL_RAW_NAMES`），**收不到供应商名**，所以必须在本区域补一条；
 * 其余几个是 §4.4 逐条点名的开发术语 / 后端字段名，保留在区域表里是为了让失败信息
 * 直接指出是哪一条 §4.4 条目。
 */
const REGION_EXTRA_TERMS: readonly string[] = [
  'apimart',
  'seedance',
  'deepseek',
  '供应商',
  '门禁',
  '任务号',
  '最终提示词',
  '生成依据',
  '端点',
  '契约',
  '降级视图',
]

/**
 * 本区域**唯一**允许出现第三层内容的 `.ts` 生产者函数（审计 §8.1.1 第 2 条）。
 *
 * 这四个函数是「怎么开真实模式 / 怎么关回演练」的**分步命令原文**生产者：
 * 里面必然有 `backend/.env`、`JELLYFISH_*`、`curl http://localhost:8000/api/v1/…`、
 * `data.mode="real"`。审计 §4.4 模式 2/4 的整改口径是「整段收进技术详情」，
 * 而不是删掉这些命令（删了用户就没法照做）。
 */
const TECH_DETAIL_PRODUCER_FUNCTIONS: readonly string[] = [
  'buildEnableSteps',
  'buildRestoreSteps',
  'buildHowToEnable',
  'buildHowToRestore',
]

/** 主区生产者（**绝不**允许落在上面那四个函数的范围内）。 */
const MAIN_SCREEN_PRODUCER_FUNCTIONS: readonly string[] = [
  'dryRunReasonText',
  'notConfirmedReasonText',
  'allowedReasonText',
  'describeMode',
  'buildEnableSummary',
  'buildRestoreSummary',
  'scrubMainScreenText',
  'sourceMainLabelOf',
  'outletLabelOf',
]

/**
 * 第三层内容检查里**显式登记**的两处「不是渲染」的命中（见用例内的注释）。
 *
 * 用显式登记而不是放宽正则：下一批如果有人把原文搬到别处渲染，正则仍然会抓到。
 */
const THIRD_LAYER_RENDER_ALLOWLIST: readonly string[] = [
  '{details.technicalDetail ? (',
  'dataSource={view.outlets}',
]

/** 全仓唯一的「技术详情」实现（审计 §9 第 2 项 / §8.1.1 第 1 条）。 */
const TECHNICAL_DETAIL_WAIVER = 'project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'

const CJK_RE = /[\u4e00-\u9fff]/

/* ------------------------------------------------------------------ 工具 */

/** 转义成正则字面量（用于把第三层 token 拼成「渲染位置」正则）。 */
function escapeRe(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function readScan(relPath: string): string {
  return readFileSync(resolve(AISTUDIO_ROOT, relPath), 'utf8')
}

function regionSources(): Array<{ relPath: string; source: string }> {
  return REGION_FILES.map((relPath) => ({ relPath, source: readScan(relPath) }))
}

/**
 * 只保留代码（去注释），用于「渲染点有没有接上管道」这类**源码级**断言。
 *
 * ⚠️ 为什么不是「先正则去块注释」：见文件头「注释剥离器」一节。
 * 这里逐行处理，只做两件确定安全的事：
 *   1. 丢掉「整行都是注释」的行（`//` / `*` / `/*` / `{/*` 开头，含块注释正文）；
 *   2. 截掉行尾的 `//` 注释，但 `//` 前面是 `:`（`http://`）时不算注释。
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

/* ------------------------------------------- 区域泄漏检查器（共享扫描器 + 区域补充表） */

export type RegionHit = LeakHit & { readonly source: 'guard' | 'region' }

/**
 * 区域检查器 = 共享扫描器（模式 1/2/3/4/5 + 基准禁词）**并上**区域补充表。
 *
 * 为什么要并：共享词表的模式 5 只从 `enumLabels` 的模型映射表取 key，
 * **取不到生成服务（供应商）名**，而 `apimart` 正是 §4.4 模式 5 点名的原文。
 */
export function findRegionLeaks(source: string): RegionHit[] {
  const hits: RegionHit[] = findMainScreenLeaks(source).map((hit) => ({ ...hit, source: 'guard' }))
  extractScanSurfaces(source).forEach((surface) => {
    const lower = surface.text.toLowerCase()
    REGION_EXTRA_TERMS.forEach((term) => {
      if (lower.includes(term.toLowerCase())) {
        hits.push({ line: surface.line, kind: surface.kind, term, text: surface.text, source: 'region' })
      }
    })
    if (REGION_EXTRA_FIELD_PATTERN.test(surface.text)) {
      hits.push({
        line: surface.line,
        kind: surface.kind,
        term: `区域字段名 ${REGION_EXTRA_FIELD_PATTERN.source}`,
        text: surface.text,
        source: 'region',
      })
    }
  })
  return hits
}

/* --------------------------------- 技术详情生产者函数的边界（不用行号，用函数边界） */

type LineRange = { readonly name: string; readonly start: number; readonly end: number }

/**
 * 解析 `export function NAME(` … 到同缩进的 `}` 的行号区间（1 基，含首尾）。
 *
 * 用函数边界而不是硬编码行号：审计 §8.1.1 记录过「批 2 记的行号在批 3 开工前已漂移 ~18 行」，
 * 行号豁免一定会在本批自己的改动里失效。
 */
export function functionRanges(source: string, names: readonly string[]): LineRange[] {
  const lines = source.split('\n')
  const ranges: LineRange[] = []
  names.forEach((name) => {
    const startIndex = lines.findIndex((line) => new RegExp(`^export function ${name}\\b`).test(line))
    if (startIndex < 0) return
    let endIndex = startIndex
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      if (lines[i] === '}') {
        endIndex = i
        break
      }
    }
    ranges.push({ name, start: startIndex + 1, end: endIndex + 1 })
  })
  return ranges
}

/** 哪些行属于「技术详情生产者」（只对 `realRunModeCore.ts` 生效）。 */
function technicalProducerLines(source: string): Set<number> {
  const exempt = new Set<number>()
  functionRanges(source, TECH_DETAIL_PRODUCER_FUNCTIONS).forEach((range) => {
    for (let i = range.start; i <= range.end; i += 1) exempt.add(i)
  })
  return exempt
}

/**
 * 渲染侧 `<TechnicalDetailSection>…</TechnicalDetailSection>` 的行号区间。
 *
 * 用途：钉住「第三层内容的**渲染点**确实落在默认收起的折叠区里」——
 * 只断言「折叠壳被 import 了」会放过「原文同时也在折叠区外渲了一遍」。
 */
export function technicalSectionRanges(source: string): LineRange[] {
  const lines = source.split('\n')
  const ranges: LineRange[] = []
  let start = 0
  lines.forEach((line, index) => {
    if (line.includes('<TechnicalDetailSection')) start = index + 1
    if (start > 0 && line.includes('</TechnicalDetailSection>')) {
      ranges.push({ name: `technical-detail@${start}`, start, end: index + 1 })
      start = 0
    }
  })
  return ranges
}

/** 区域 0 命中扫描（唯一豁免：`realRunModeCore.ts` 的四个技术详情生产者函数体）。 */
function scanRegion(): { offenders: string[]; exemptHitCount: number } {
  const offenders: string[] = []
  let exemptHitCount = 0
  regionSources().forEach(({ relPath, source }) => {
    const exempt = relPath === 'components/realRunModeCore.ts' ? technicalProducerLines(source) : new Set<number>()
    findRegionLeaks(source).forEach((hit) => {
      if (exempt.has(hit.line)) {
        exemptHitCount += 1
        return
      }
      /* 复用共享的格式化出口，保证失败信息形状与其它区域一致 */
      offenders.push(...formatLeakHits(relPath, [hit]))
    })
  })
  return { offenders, exemptHitCount }
}

/* --------------------------------------------------------------- 护栏自检 */

test('阶段B④护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGION_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('阶段B④护栏：§4.4 专项探针的 7 个禁词，逐个注入真实源码都必须被抓到', () => {
  const probes: ReadonlyArray<{ token: string; probe: string }> = [
    { token: 'service_task_id', probe: 'service_task_id=svc-1' },
    { token: 'video', probe: 'video' },
    { token: 'pending', probe: 'pending' },
    { token: 'partial_failed', probe: 'partial_failed' },
    { token: '/api/v1', probe: 'POST /api/v1/studio/image-pipeline/video-submit' },
    { token: '127.0.0.1', probe: 'http://127.0.0.1:8000/health' },
    { token: 'apimart', probe: 'apimart' },
  ]
  /* 用真实源码做底：既证明「文件真的被读到了」，又证明「正则真的在跑」。 */
  const base = readScan('components/TaskCenter.tsx')
  const probesMissing: string[] = []
  probes.forEach(({ token, probe }) => {
    const injected = `${base}\nconst __probe__ = () => <div title="${probe}">${probe}</div>\n`
    const hits = findRegionLeaks(injected)
    const caughtText = hits.some((hit) => hit.text.includes(probe) || hit.text.includes(token))
    const caughtTerm = hits.some(
      (hit) => hit.term.toLowerCase() === token.toLowerCase() || hit.text.toLowerCase().includes(token.toLowerCase()),
    )
    if (!caughtText || !caughtTerm) probesMissing.push(token)
  })
  assert.deepEqual(
    probesMissing,
    [],
    `这些 §4.4 专项探针禁词没被抓到（扫描器或区域补充表失效）：${probesMissing.join('、')}`,
  )
  /* 反向：探针确实是通过「扫描面」被抓到的（不是靠整文件 raw scan 蒙对）。 */
  assert.ok(countScanSurfaces(base) > 0, '真实源码没提取到任何扫描面')
})

test('阶段B④护栏：正确的业务说法不许被判成泄漏（防过度整改）', () => {
  assert.ok(
    scannerNegativeSelfCheck(),
    '「待确认候选」这类用户拍板放行的业务说法被判成了泄漏 —— 细分口径退化成了整词禁',
  )
  const allowed = [
    /* R15：任务类型标签的正确中文口径（枚举原值 `video` 的映射结果） */
    '视频生成',
    '图片生成',
    '后台任务',
    /* R16：陈旧任务的主区状态口径（审计 §4.4 给的就是这个模板） */
    `状态未知（超过 ${TASK_STALE_AFTER_HOURS} 小时未更新）`,
    /* §6.3：部分失败的主区模板 */
    '部分失败（成功 1/共 2）',
    /* 本区域实际使用的其它业务说法 */
    '当前是演练模式：没有发起真实请求',
    '演练模式下不会发起真实请求，也不会产生费用。',
    '改完配置并重启后端进程，角标回到「真实模式」即为成功。',
    '章节：名称读取中',
    '镜头：名称读取中',
    '关联对象：名称读取中',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findRegionLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些**正确**的业务说法被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('阶段B④护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const counts = regionSources().map(({ relPath, source }) => ({
    relPath,
    count: countScanSurfaces(source),
  }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  assert.ok(
    total >= 350,
    `本区域只提取到 ${total} 个用户可见扫描面（登记时实测 379），遍历或提取器可能坏了`,
  )
  const nonEmpty = counts.filter((item) => item.count > 0)
  assert.ok(nonEmpty.length >= 10, `只有 ${nonEmpty.length} 个文件提取到扫描面，可疑`)
  assert.ok(
    counts.some((item) => item.relPath === 'components/taskCopy.ts' && item.count >= 100),
    '`taskCopy.ts` 的扫描面少于 100 个（它装着 10 套任务文案），提取器或遍历一定坏了',
  )
})

test('阶段B④护栏：JSX 属性值是扫描面的一部分（标题 / 悬停提示收起态也看得见）', () => {
  const surfaces = regionSources().flatMap(({ source }) => extractScanSurfaces(source))
  const attrs = new Set(
    surfaces.filter((surface) => surface.kind === 'jsx-attr').map((surface) => surface.attr),
  )
  assert.ok(attrs.has('title'), '没提取到 `title` 属性面（悬停即见，§5.5-D 实测的泄漏形态）')
  assert.ok(attrs.has('description'), '没提取到 `description` 属性面（Alert 正文在收起态也可见）')
  assert.ok(attrs.has('message'), '没提取到 `message` 属性面（Alert 标题）')
  assert.ok(attrs.has('placeholder'), '没提取到 `placeholder` 属性面')
  /* 探针：属性值里的禁词必须能被抓到（否则 §8.1「悬停即见」这条要求就没落地）。 */
  const probe = readScan('components/RealRunModeBadge.tsx')
  const hits = findRegionLeaks(
    `${probe}\nconst __probe__ = () => <div title="apimart /api/v1 任务号">正常</div>\n`,
  )
  assert.ok(
    hits.some((hit) => hit.kind === 'jsx-attr' && hit.term === 'apimart'),
    '属性值里的供应商名没被扫到',
  )
})

/* ------------------------------------------------- ① 主区禁词 0 命中（核心） */

test('§4.4：主区禁词扫描 0 命中（唯一豁免：四个技术详情生产者函数体）', () => {
  const { offenders, exemptHitCount } = scanRegion()
  assert.deepEqual(
    offenders,
    [],
    `任务中心 / 任务通知区域的主区出现泄漏（模式 1/2/3/4/5/6 或主区禁词）：\n${offenders.join('\n')}`,
  )
  /* 豁免**不许变成空转**：如果真的一个命中都没有，说明豁免范围写错了（例如函数边界没解出来）。 */
  assert.ok(
    exemptHitCount >= 5,
    `技术详情生产者函数的豁免区间只吃到 ${exemptHitCount} 个命中 —— 期望它至少吃到 5 个（backend/.env、JELLYFISH_*、/api/v1、real、dry_run），豁免边界可能没解出来`,
  )
})

test('§4.4：基准禁词表 + 枚举原值 + 模型原值 + 区域补充术语，逐个都不出现在扫描面上', () => {
  const surfaces = regionSources().flatMap(({ relPath, source }) =>
    extractScanSurfaces(source).map((surface) => ({ relPath, surface })),
  )
  const exemptByFile: Record<string, Set<number>> = {
    'components/realRunModeCore.ts': technicalProducerLines(readScan('components/realRunModeCore.ts')),
  }
  const offenders: string[] = []
  surfaces.forEach(({ relPath, surface }) => {
    if (exemptByFile[relPath]?.has(surface.line)) return
    const lower = surface.text.toLowerCase()
    MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.forEach((term) => {
      if (lower.includes(term.toLowerCase())) offenders.push(`${relPath}:${surface.line} ｜ 基准禁词「${term}」`)
    })
    ENUM_RAW_VALUES.forEach((value) => {
      const re = new RegExp(`(?<![A-Za-z0-9_])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i')
      if (re.test(surface.text)) offenders.push(`${relPath}:${surface.line} ｜ 枚举原值「${value}」`)
    })
    MODEL_RAW_NAMES.forEach((name) => {
      if (lower.includes(name.toLowerCase())) offenders.push(`${relPath}:${surface.line} ｜ 模型原名「${name}」`)
    })
    REGION_EXTRA_TERMS.forEach((term) => {
      if (lower.includes(term.toLowerCase())) offenders.push(`${relPath}:${surface.line} ｜ 区域禁词「${term}」`)
    })
  })
  assert.deepEqual(offenders, [], `这些禁词出现在了用户可见文案里：\n${offenders.join('\n')}`)
  assert.ok(ENUM_RAW_VALUES.includes('video'), '枚举词表里应当有任务类型原值 `video`（R15）')
  assert.ok(ENUM_RAW_VALUES.includes('partial_failed'), '枚举词表里应当有 `partial_failed`（§6.3）')
  assert.ok(MODEL_RAW_NAMES.includes('seedance-2.0-mini'), '模型词表里应当有实测泄漏过的模型原名')
})

test('§4.4 模式 3：任务时间列 / 通知时间一律走 `userFacingTime` 的唯一实现', () => {
  const copy = stripComments(readScan('components/taskCopy.ts'))
  assert.ok(
    /import \{ formatUserFacingTime \} from '\.\/userFacingTime\.ts'/.test(copy),
    '`taskCopy.ts` 必须复用 `userFacingTime.ts` 的唯一实现，不许自写一份',
  )
  assert.ok(/export function taskTimeLabel/.test(copy), '任务时间的唯一出口 `taskTimeLabel` 必须存在')
  ;['components/TaskCenter.tsx', 'components/taskNotificationHelpers.tsx'].forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    assert.ok(
      !/Intl\.DateTimeFormat/.test(code),
      `${relPath} 又自写了一份时间格式化（同一出口两套口径）—— 必须用 taskTimeLabel`,
    )
    assert.ok(/taskTimeLabel\(/.test(code), `${relPath} 的时间没有走 taskTimeLabel`)
  })
  /* 纯函数级：输出必须是本地时区 `YYYY-MM-DD HH:mm`，不含 ISO 的 `T` / `Z`。 */
  const label = taskTimeLabel(1789629972)
  assert.ok(label !== null)
  assert.match(label, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.ok(!label.includes('T') && !label.includes('Z'), `时间仍然带机器串：${label}`)
  assert.equal(taskTimeLabel(null), null)
  assert.equal(taskTimeLabel(0), null)
  assert.equal(formatUserFacingTime(new Date(1789629972 * 1000).toISOString()), label)
  /* 扫描面上不许出现机器时间串（ISO / RFC3339）。 */
  const machineTimestamps = regionSources()
    .flatMap(({ relPath, source }) =>
      extractScanSurfaces(source).map((surface) => ({ relPath, surface })),
    )
    .filter(({ surface }) => looksLikeMachineTimestamp(surface.text))
    .map(({ relPath, surface }) => `${relPath}:${surface.line} ｜ ${surface.text}`)
  assert.deepEqual(machineTimestamps, [], `主区出现了机器时间串：\n${machineTimestamps.join('\n')}`)
})

test('§4.4 模式 4：`title` / `placeholder` 这类悬停即见的属性里不许有地址与任务号', () => {
  const offenders = regionSources()
    .flatMap(({ relPath, source }) =>
      extractScanSurfaces(source)
        .filter((surface) => surface.kind === 'jsx-attr')
        .map((surface) => ({ relPath, surface })),
    )
    .filter(({ surface }) =>
      /https?:\/\/|localhost|127\.0\.0\.1|\/api\/v1|JELLYFISH_|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i.test(
        surface.text,
      ),
    )
    .map(({ relPath, surface }) => `${relPath}:${surface.line} ｜ ${surface.attr}= ｜ ${surface.text}`)
  assert.deepEqual(offenders, [], `悬停即见的属性里有地址 / 任务号 / 环境变量名：\n${offenders.join('\n')}`)

  /* 角标的悬停 title 取自 `view.description`（运行时实测的形态），
     所以必须在**生产者**这一层就保证它是干净的主区文案。 */
  const payload = {
    guard: {
      dry_run: true,
      real_call_confirmed: false,
      env: 'JELLYFISH_DRY_RUN',
      confirm_env: 'JELLYFISH_REAL_LLM_CONFIRMED',
    },
    mode: 'dry_run',
    mode_label: 'dry_run',
    mode_description: '当前不发任何真实请求，也不会产生费用（JELLYFISH_DRY_RUN 未显式设为 0）。',
    switch_source: 'dotenv',
    switch_source_label: 'backend/.env',
    guard_status_text: 'DRY_RUN=开（JELLYFISH_DRY_RUN，未发起真实调用）',
    mode_doc: 'docs/real-run-mode.md',
  }
  const view = parseRealRunMode(payload)
  assert.equal(view.switchSourceLabel, 'backend/.env', '技术详情层仍要保留原始来源标签')
  assert.ok(
    !/JELLYFISH_|backend\/\.env|https?:\/\/|docs\//.test(view.description),
    `角标悬停文案里仍有机器串：${view.description}`,
  )
  assert.ok(CJK_RE.test(view.description), `角标悬停文案不是中文：${view.description}`)
  assert.equal(view.label, '演练模式', '非中文的 mode_label 必须走本地中文映射表，不许回显原值')
  assert.equal(view.switchSourceMainLabel, '服务器上的配置文件')
  assert.ok(!view.switchSourceMainLabel.includes('backend'), '主区来源说法里不许出现仓库路径')
})

test('§4.4 模式 6：`message.*` 的实参不许是后端原文的裸用', () => {
  const offenders: string[] = []
  ;[
    'components/taskActionHelpers.ts',
    'components/taskResultHelpers.ts',
    'components/taskUiStore.ts',
    'components/taskNotificationHelpers.tsx',
  ].forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    const args = Array.from(code.matchAll(/message\.(?:error|warning|info|success)\(([^\n]*)/g)).map(
      (match) => match[1],
    )
    args.forEach((arg) => {
      if (/\.\s*(message|detail|reason|warnings)\b/.test(arg)) {
        offenders.push(`${relPath} ｜ message.* 实参直接用了后端字段：${arg.trim().slice(0, 90)}`)
      }
    })
  })
  assert.deepEqual(offenders, [], `这些 message 出口还在直渲后端原文（模式 6）：\n${offenders.join('\n')}`)

  /* 管道接线的定点断言（比「没有裸用」更强：要求必须过统一包装层）。 */
  const actions = stripComments(readScan('components/taskActionHelpers.ts'))
  assert.ok(
    /toUserFacingText\(raw,\s*fallbackErrorMessage\)/.test(actions),
    '`defaultTaskActionErrorMessage` 必须把后端原文过三级管道后再给用户',
  )
  assert.ok(
    /toUserFacingText\(candidate,\s*fallbackErrorMessage\)/.test(actions),
    '错误出口（catch 分支）必须再过一次管道 —— 否则换个调用点就漏一次原文',
  )
  const actionErrorFn = /export function defaultTaskActionErrorMessage[\s\S]*?\n}/.exec(actions)
  assert.ok(actionErrorFn, '找不到 `defaultTaskActionErrorMessage`')
  assert.ok(
    !/return raw\b/.test(actionErrorFn[0]),
    '`defaultTaskActionErrorMessage` 仍然把后端原文当返回值直接给用户',
  )
  assert.ok(
    /readRawErrorMessage\(error\)/.test(actionErrorFn[0]),
    '原文提取（`readRawErrorMessage`）与面向用户的出口必须分开：前者进技术详情，后者只给中文',
  )
  const results = stripComments(readScan('components/taskResultHelpers.ts'))
  assert.ok(
    /toUserFacingText\(data\.error/.test(results),
    '`taskResultHelpers` 的 `data.error` 透传给 `onFailed` 前必须过管道（§4.4 模式 6 第 3 条）',
  )
  assert.ok(
    /rememberTechnicalDetail\(/.test(actions),
    '被换成中文结论的后端原文必须记进「技术详情」，不能直接丢掉（否则报障时无从查）',
  )
})

test('§4.4 模式 1：任务中心是整条链路的渲染咽喉，两个字段都必须过掩码；任务号不许上屏', () => {
  const center = stripComments(readScan('components/TaskCenter.tsx'))
  assert.ok(/import \{ maskInternalIds \} from '\.\/maskInternalIds'/.test(center), '必须复用 maskInternalIds')
  assert.ok(/maskTaskText\(task\.title\)/.test(center), '`task.title` 必须过掩码（上游页面可能塞进 ID）')
  assert.ok(/maskTaskText\(task\.sourceLabel\)/.test(center), '`task.sourceLabel` 必须过掩码')
  assert.ok(!/\{task\.title\}/.test(center), '还在直渲 `task.title`')
  assert.ok(!/\{task\.sourceLabel\}/.test(center), '还在直渲 `task.sourceLabel`')
  /* §6.1：任务号只允许两种保留形态 —— React key 与取消接口入参；
     **不能为了「主区干净」把信息直接删掉**（删了就没法报障，也点不了取消）。 */
  const taskIdBraceLines = center
    .split('\n')
    .filter((line) => line.includes('{task.taskId}'))
    .filter((line) => !/key=\{task\.taskId\}/.test(line))
  assert.deepEqual(taskIdBraceLines, [], '任务号被当 JSX 子节点渲染到主区（只允许做 React key）')
  assert.ok(!/title=\{task\.taskId\}/.test(center), '任务号出现在悬停 title 里')
  assert.ok(/key=\{task\.taskId\}/.test(center), '§6.1 允许保留的形态之一丢了：React key')
  assert.ok(/cancelTask\(task\.taskId\)/.test(center), '§6.1 允许保留的形态之一丢了：取消接口入参')

  /* 关联类型的兜底口径：未登记一律「关联对象」，绝不回显 `actor_image` 这类原值。 */
  assert.equal(resolveRelationTypeLabel('actor_image'), '演员图片')
  assert.equal(resolveRelationTypeLabel('shot_frame_image'), '分镜图片')
  const unknownRelation = resolveRelationTypeLabel('brand_new_relation')
  assert.ok(CJK_RE.test(unknownRelation), `未登记关联类型的兜底必须含中文：${unknownRelation}`)
  assert.ok(!unknownRelation.includes('brand_new_relation'), '未登记关联类型被原样回显')
  const meta = stripComments(readScan('components/taskCenterMeta.ts'))
  assert.ok(
    !/\$\{relationType\}：/.test(meta),
    '`taskCenterMeta.ts` 仍然把 `relation_type` 原值拼进主区文案（模式 3）',
  )
  assert.ok(/resolveRelationTypeLabel\(relationType\)/.test(meta), '关联类型必须过 `resolveRelationTypeLabel`')
  assert.equal(resolveTaskSourceLabel('video', 'audit-shot-1'), '镜头视频：名称读取中')
  assert.ok(
    !String(resolveTaskSourceLabel('video', 'audit-shot-1')).includes('audit-shot-1'),
    '取不到业务名时仍然回落渲染实体 ID（§6.1）',
  )
})

test('§4.4 R15：任务类型必须过映射，未登记不回显原值（兜底「后台任务」）', () => {
  assert.equal(resolveTaskTitle('video'), '视频生成')
  assert.equal(resolveTaskTitle('image_generation'), '图片生成')
  assert.equal(resolveTaskTitle('script_merge'), '剧组合并')
  assert.equal(resolveTaskTitle('shot_frame_prompt'), '分镜提示词生成')
  const unknown = resolveTaskTitle('brand_new_task_kind')
  assert.equal(unknown, '后台任务')
  assert.ok(CJK_RE.test(unknown))
  assert.ok(!unknown.includes('brand_new_task_kind'), '未登记的任务类型被原样回显（R15 的老毛病）')
  assert.equal(resolveTaskTitle(undefined), '后台任务')
  assert.equal(resolveTaskTitle(''), '后台任务')
  /* 源码级：旧的英文拼接兜底不许回来。 */
  const copy = stripComments(readScan('components/taskCopy.ts'))
  assert.ok(!/split\('_'\)\.join\(' '\)/.test(copy), '`taskKind.split(\'_\').join(\' \')` 这个英文兜底又回来了')
  assert.ok(/labelFor\(TASK_KIND, taskKind\)/.test(copy), '任务类型必须走唯一映射表 `TASK_KIND`')
  /* 六个任务状态都必须有中文标签，且未登记状态给中文兜底。 */
  TASK_STATUS.values.forEach((value) => {
    const label = labelFor(TASK_STATUS, value)
    assert.ok(CJK_RE.test(label), `任务状态原值 ${value} 的映射不是中文：${label}`)
  })
  const unknownStatus = labelFor(TASK_STATUS, 'brand_new_status')
  assert.ok(CJK_RE.test(unknownStatus) && !unknownStatus.includes('brand_new_status'))
  /* 渲染点：不许把 `task.status` 直接打进 JSX。 */
  const center = stripComments(readScan('components/TaskCenter.tsx'))
  assert.ok(!/\{task\.status\}/.test(center), '还在直渲 `task.status`（枚举原值会上屏）')
  assert.ok(/taskTone\(task, freshness\)/.test(center), '状态标签必须由 `taskTone` 产出（含中文兜底）')
})

test('§4.4 R16：陈旧 `running` 任务改说「状态未知（超过 N 小时未更新）」，且不许凭空造按钮', () => {
  const now = 1_789_629_972_000
  const hoursAgo = (h: number) => Math.floor(now / 1000) - h * 3600
  /* 运行时实测：4 条 `running` 任务分别显示「耗时 2492 小时 30 分」「耗时 800 小时 30 分」
     「耗时 209 小时 42 分」却仍标「运行中」。 */
  assert.equal(assessTaskFreshness({ status: 'running', updatedAtTs: hoursAgo(2492) }, now).stale, true)
  assert.equal(assessTaskFreshness({ status: 'running', updatedAtTs: hoursAgo(216) }, now).stale, true)
  assert.equal(assessTaskFreshness({ status: 'pending', updatedAtTs: hoursAgo(265) }, now).stale, true)
  assert.equal(assessTaskFreshness({ status: 'streaming', updatedAtTs: hoursAgo(10) }, now).stale, true)
  /* 反向：正常任务 / 已结束 / 已请求取消 / 没有时间戳 —— 一律不许误判成「状态未知」。 */
  assert.equal(assessTaskFreshness({ status: 'running', updatedAtTs: hoursAgo(1) }, now).stale, false)
  assert.equal(
    assessTaskFreshness({ status: 'running', updatedAtTs: hoursAgo(TASK_STALE_AFTER_HOURS - 1) }, now).stale,
    false,
  )
  assert.equal(
    assessTaskFreshness({ status: 'running', updatedAtTs: hoursAgo(24), finishedAtTs: hoursAgo(23) }, now).stale,
    false,
  )
  assert.equal(
    assessTaskFreshness(
      { status: 'running', updatedAtTs: hoursAgo(24), cancelRequested: true },
      now,
    ).stale,
    false,
  )
  assert.equal(assessTaskFreshness({ status: 'succeeded', updatedAtTs: hoursAgo(24) }, now).stale, false)
  assert.equal(assessTaskFreshness({ status: 'running' }, now).stale, false, '没有时间戳时不许猜')
  assert.equal(
    assessTaskFreshness({ status: 'running', startedAtTs: hoursAgo(9) }, now).stale,
    true,
    '没有 updatedAtTs 时退化用 startedAtTs 判据',
  )
  assert.equal(TASK_STALE_STATUS_LABEL, `状态未知（超过 ${TASK_STALE_AFTER_HOURS} 小时未更新）`)
  /* 「给动作」：后端没有「标记为已失效」接口，所以只能给「取消」这个真实存在的动作 +
     如实说明缺口（不许凭空造按钮）。 */
  assert.ok(TASK_STALE_ADVICE.includes('取消'), '陈旧任务的建议里必须给出一个**真实存在**的动作')
  assert.ok(TASK_STALE_ADVICE.includes('不支持'), '必须如实说明「手动标记为已失效」当前不支持')
  const center = stripComments(readScan('components/TaskCenter.tsx'))
  assert.ok(/assessTaskFreshness\(task\)/.test(center), '任务卡必须判定陈旧状态')
  assert.ok(/TASK_STALE_STATUS_LABEL/.test(center), '陈旧状态必须用共享常量（不许各写一份）')
  assert.ok(/TASK_STALE_ADVICE/.test(center), '陈旧任务必须给出建议动作')
  assert.ok(
    !/标记为已失效<\/|>\s*标记为已失效/.test(center),
    '凭空造了「标记为已失效」按钮 —— 后端没有对应接口（`film/task_status.py` 只有 cancel 与 task-links/adopt）',
  )
  const copy = stripComments(readScan('components/taskCopy.ts'))
  const rawCopy = readScan('components/taskCopy.ts')
  assert.ok(
    /api\/v1\/routes\/film\/task_status\.py/.test(rawCopy) &&
      /cancel/.test(rawCopy) &&
      /没有[\s\S]{0,40}标记为失效|没有「把陈旧任务标记为失效」/.test(rawCopy),
    '「待后端支持」的登记理由要写在源码注释里（下一个人才知道为什么没有按钮）',
  )
  assert.ok(!/export const TASK_STALE_AFTER_HOURS = 0/.test(copy))
})

test('§4.4 模式 3：陈旧任务的进度条不再显示「进行中」动效，也不再用「已运行 2492 小时」的口气', () => {
  const center = stripComments(readScan('components/TaskCenter.tsx'))
  assert.ok(/freshness\.stale[\s\S]{0,120}'normal'/.test(center), '陈旧任务的进度条必须去掉 active 动效')
  assert.ok(
    /freshness\.stale \? null : elapsed \?/.test(center),
    '陈旧任务不许再显示「耗时 2492 小时」（那是「还在跑」的口气）',
  )
  const notice = stripComments(readScan('components/taskNotificationHelpers.tsx'))
  assert.ok(/assessTaskFreshness\(task\)/.test(notice), '通知与任务中心必须同口径判定陈旧状态')
  assert.ok(/TASK_STALE_STATUS_LABEL/.test(notice), '通知也要用共享的陈旧状态文案')
})

test('§4.4 模式 3/5：演练模式 / 出口 / 审计动作的中文口径只有一个来源（enumLabels）', () => {
  const core = stripComments(readScan('components/realRunModeCore.ts'))
  assert.ok(
    /import \{[\s\S]{0,200}labelFor,?\s*\} from '\.\/enumLabels\.ts'/.test(core) ||
      /labelFor,[\s\S]{0,120}\} from '\.\/enumLabels\.ts'/.test(core),
    '`realRunModeCore.ts` 必须从唯一映射表取中文口径',
  )
  assert.ok(/labelFor\(REAL_RUN_MODE, 'dry_run'\)/.test(core), '`MODE_LABEL` 必须委托 `labelFor`')
  assert.ok(/labelFor\(REAL_RUN_OUTLET, outlet\)/.test(core), '出口名必须委托 `labelFor`（未登记给「其它出口」）')
  assert.ok(
    /labelFor\(REAL_RUN_AUDIT_ACTION, action\)/.test(core),
    '审计动作必须委托 `labelFor`（未登记给「拦截记录」，不回显原值）',
  )
  assert.ok(!/AUDIT_LABELS\[action\] \?\? action/.test(core), '`AUDIT_LABELS[action] ?? action` 这个原值回显又回来了')
  assert.ok(!/OUTLET_LABELS\[outlet\] \?\? outlet/.test(core), '`OUTLET_LABELS[outlet] ?? outlet` 这个原值回显又回来了')
  assert.ok(!/可选: 供应商/.test(core))
  REAL_RUN_OUTLET.values.forEach((outlet) => {
    const label = labelFor(REAL_RUN_OUTLET, outlet)
    assert.ok(CJK_RE.test(label), `出口 ${outlet} 的中文映射缺失`)
  })
  REAL_RUN_AUDIT_ACTION.values.forEach((action) => {
    assert.ok(CJK_RE.test(labelFor(REAL_RUN_AUDIT_ACTION, action)), `审计动作 ${action} 的中文映射缺失`)
  })
  const unknownOutlet = labelFor(REAL_RUN_OUTLET, 'brand_new_outlet')
  assert.ok(!unknownOutlet.includes('brand_new_outlet'), '未登记出口被原样回显')
  /* 后端 `mode_label` 非中文时不许上屏（运行时形态就是 `状态：ready` 那一类）。 */
  const view = parseRealRunMode({
    mode: 'dry_run',
    mode_label: 'dry_run',
    guard: { dry_run: true, real_call_confirmed: false },
  })
  assert.ok(!view.label.includes('dry_run'), '后端给的英文 mode_label 被原样上屏')
})

test('§4.4 模式 2/4：分步命令整段下沉技术详情，主区只留一句中文结论', () => {
  const core = readScan('components/realRunModeCore.ts')
  const ranges = functionRanges(core, TECH_DETAIL_PRODUCER_FUNCTIONS)
  assert.equal(
    ranges.length,
    TECH_DETAIL_PRODUCER_FUNCTIONS.length,
    `四个技术详情生产者函数必须都存在，实际找到 ${ranges.map((r) => r.name).join('、')}`,
  )
  const mainRanges = functionRanges(core, MAIN_SCREEN_PRODUCER_FUNCTIONS)
  assert.equal(
    mainRanges.length,
    MAIN_SCREEN_PRODUCER_FUNCTIONS.length,
    `主区生产者函数必须都存在，实际找到 ${mainRanges.map((r) => r.name).join('、')}`,
  )
  /* ① 豁免范围不许吞掉主区生产者。 */
  const exempt = technicalProducerLines(core)
  const swallowed = mainRanges.filter((range) => {
    for (let i = range.start; i <= range.end; i += 1) if (exempt.has(i)) return true
    return false
  })
  assert.deepEqual(
    swallowed.map((range) => range.name),
    [],
    '主区生产者函数落在技术详情豁免区间里 —— 等于把主区文案挪进豁免区蒙混过扫描（审计 §8.1.1 第 ④ 条）',
  )
  /* ② 主区那一句必须是写死的中文常量，不是后端句子的改写结果（§7.1-8）。 */
  assert.ok(
    /export function buildEnableSummary\(\): string \{\n {2}return '改完配置并重启后端进程/.test(core),
    '「怎么切到真实模式」的主区说明必须是写死的中文常量',
  )
  assert.ok(
    /export function buildRestoreSummary\(\): string \{\n {2}return '改完配置并重启后端进程/.test(core),
    '「怎么关回演练模式」的主区说明必须是写死的中文常量',
  )
  /* ③ 主区原因口径不许再拼环境变量名。 */
  assert.ok(/\['JELLYFISH_/.test(core) === false, '真实模式核心文件里不该出现 JELLYFISH_ 的字符串数组字面量')
  assert.ok(
    /export function dryRunReasonText\(\): string \{/.test(core),
    '`dryRunReasonText` 不许再接收 env（它以前把环境变量名拼进主区句子）',
  )
})

test('§4.4 模式 6：后端原文块不再直渲，且第三层内容全部落在默认收起的折叠区里', () => {
  const badge = readScan('components/RealRunModeBadge.tsx')
  const code = stripComments(badge)
  /* ① 明文标注的「后端原文：」整块必须消失（审计 §4.4 模式 6 第 3 条）。 */
  assert.ok(!code.includes('后端原文：'), '「后端原文：」整块又回来了（明文标注的直渲）')
  assert.ok(!code.includes('details.message'), '`details.message`（后端原文）仍然被直接渲染')
  assert.ok(code.includes('details.technicalDetail'), '后端原文必须改由技术详情层承载')
  /* ② 模拟命中事件的渲染：`detail` / `target` 不许当主区文案（测试夹具里就是
     `POST /api/v1/script-processing/divide 会真实调用大模型` 与 `target: 'llm'`）。 */
  assert.ok(!/\{event\.detail\}/.test(code), '仍然把 `event.detail` 当 JSX 子节点渲染（可在任何位置）')
  assert.ok(!/\{event\.target\}/.test(code), '仍然把 `event.target` 当 JSX 子节点渲染（可在任何位置）')
  assert.ok(/\{event\.reasonText\}/.test(code), '命中记录的主区文案必须用已中文的 `event.reasonText`')
  assert.ok(!/\{row\.reason\}/.test(code), '仍然把出口的机器原因码当 Tag 渲染到主区')
  /* ③ 折叠区确实存在，且第三层内容的渲染点全部落在它里面。 */
  const sections = technicalSectionRanges(badge)
  assert.ok(sections.length >= 3, `` + `渲染侧至少要有 3 个 TechnicalDetailSection（实测 ${sections.length} 个）`)
  const thirdLayerTokens = [
    'view.guardText',
    'view.mode',
    'view.env',
    'view.confirmEnv',
    'view.switchSource',
    'view.switchSourceLabel',
    'view.enableSteps',
    'view.howToEnable',
    'view.restoreSteps',
    'view.howToRestore',
    'view.doc',
    'view.startupWarning',
    'view.outlets',
    'row.reasonDetail',
    'row.reason',
    'event.action',
    'event.reason',
    'event.detail',
    'event.target',
    'details.technicalDetail',
    'loadError',
    'orchestrationStatusUrl()',
  ].map((token) => ({ token, pattern: new RegExp(`(?:\\$\\{|\\{)\\s*${escapeRe(token)}\\b`) }))
  const outside = code
    .split('\n')
    .map((line, index) => ({ line, number: index + 1 }))
    .filter((entry) => thirdLayerTokens.some((item) => item.pattern.test(entry.line)))
    /* 两个**显式登记**的例外（不是放宽断言，是把「不是渲染」的两处点名说清楚）：
       ① 折叠块自身的渲染条件 `{details.technicalDetail ? (` —— 判空才决定要不要渲染折叠区，
          原文只在折叠区**内部**渲染；
       ② 出口表格的入参 `dataSource={view.outlets}` —— 表格三列（出口 / 状态 / 原因）已全部
          中文化，四个出口的原始值清单在折叠区里另列一份。 */
    .filter((entry) => !THIRD_LAYER_RENDER_ALLOWLIST.includes(entry.line.trim()))
    .filter((entry) => !sections.some((range) => entry.number >= range.start && entry.number <= range.end))
    .map((entry) => `:${entry.number} ｜ ${entry.line.trim().slice(0, 100)}`)
  assert.deepEqual(
    outside,
    [],
    `这些第三层内容被渲染在折叠区之外（收起态就看得见）：\n${outside.join('\n')}`,
  )
})

/* -------------------------------------------------------- ② MainLayout 面包屑定点断言 */

test('§4.6-R20 / §7.2 序 4：面包屑兜底禁止回落 URL 段原样（unencoded UUID / 英文段）', () => {
  const layoutPath = resolve(SRC_ROOT, 'layouts/MainLayout.tsx')
  const source = readFileSync(layoutPath, 'utf8')
  const code = stripComments(source)
  assert.ok(!/else label = segment/.test(code), '面包屑兜底仍然回落到 URL 段原样（模式 1/2）')
  assert.ok(/else label = '详情'/.test(code), '未登记路径段必须收敛到「详情」')
  ;['scenes', 'actors', 'props', 'costumes', 'roles'].forEach((segment) => {
    assert.ok(
      new RegExp(`${segment}: '[^']+'`).test(code),
      `资产子路径段 \`${segment}\` 没有登记中文名（运行时实测它原样上屏）`,
    )
  })
  /* 未登记段也不许变成空标签：'详情' 是稳定的中文兜底。 */
  const fallbackMatches = code.match(/label = '详情'/g) ?? []
  assert.equal(fallbackMatches.length, 1, '应当只有一处「详情」兜底')
})

/* ------------------------------------------------------------- ③ 豁免守卫 */

test('阶段B④豁免守卫：技术详情折叠实现仍然只有 `TechnicalDetailCollapse.tsx` 一个文件', () => {
  const waiver = readFileSync(resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  assert.ok(
    waiver.includes('export function TechnicalDetailSection'),
    '豁免文件必须导出统一的技术详情折叠壳',
  )
  const offenders: string[] = []
  REGION_FILES.forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    if (code.includes('技术详情（默认收起）')) offenders.push(`${relPath} 复制了统一折叠壳的标题文案`)
    if (/<details/.test(code)) offenders.push(`${relPath} 自建了 <details> 形态的技术详情`)
    if (/<summary/.test(code)) offenders.push(`${relPath} 自建了 <summary> 形态的技术详情`)
    /* 「出现了技术详情字样却没复用折叠壳」这条只对**渲染侧**（`.tsx`）成立：
       审计 §8.1.1 第 2 条明确 `.ts` 生产者文件属机械豁免（没有 JSX 可渲），
       它们只负责生产数据/文案，由 `.tsx` 放进折叠区。 */
    if (
      relPath.endsWith('.tsx') &&
      code.includes('技术详情') &&
      !code.includes('TechnicalDetailSection')
    ) {
      offenders.push(`${relPath} 里出现了「技术详情」字样，但没有复用 TechnicalDetailSection`)
    }
  })
  assert.deepEqual(offenders, [], `出现了第二套「技术详情」实现，必须改用 TechnicalDetailSection：\n${offenders.join('\n')}`)
  /* 两个渲染侧文件必须从唯一豁免文件 import（不是自己写一份）。 */
  ;['components/RealRunModeBadge.tsx', 'components/GenerationGateBanner.tsx'].forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    assert.ok(
      code.includes(
        "import { TechnicalDetailSection } from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'",
      ),
      `${relPath} 必须复用唯一豁免文件的技术详情折叠壳`,
    )
    assert.ok(/<TechnicalDetailSection/.test(code), `${relPath} 没有渲染 TechnicalDetailSection`)
  })
})

test('阶段B④豁免守卫：技术详情生产者函数的豁免范围可被测试解出，且不空转', () => {
  const core = readScan('components/realRunModeCore.ts')
  const ranges = functionRanges(core, TECH_DETAIL_PRODUCER_FUNCTIONS)
  ranges.forEach((range) => {
    assert.ok(range.end > range.start, `${range.name} 的函数边界解不出来（start=${range.start} end=${range.end}）`)
    assert.ok(
      range.end - range.start < 80,
      `${range.name} 的豁免区间有 ${range.end - range.start} 行，长到足以藏下主区文案`,
    )
  })
  /* 豁免区间里必须真的含第三层内容，否则就是「豁免写错了却仍然绿」。 */
  const exemptText = ranges
    .map((range) => core.split('\n').slice(range.start - 1, range.end).join('\n'))
    .join('\n')
  assert.ok(/backend\/\.env|JELLYFISH_/.test(exemptText), '豁免区间里没有命令 / 环境变量名，豁免边界可能解错了')
  assert.ok(
    /VERIFY_COMMAND|START_COMMAND/.test(exemptText),
    '豁免区间里没有命令常量引用，豁免边界可能解错了',
  )
})

/* -------------------------------------------------------- ④ 扫描范围守卫 */

test('阶段B④扫描范围守卫：登记表里的文件真实存在，且都被遍历到', () => {
  const missing = REGION_FILES.filter((relPath) => !existsSync(resolve(AISTUDIO_ROOT, relPath)))
  assert.deepEqual(missing, [], `登记表里列了不存在的文件：${missing.join('、')}`)
  const scanned = regionSources().map((item) => item.relPath)
  assert.deepEqual(
    REGION_FILES.filter((relPath) => !scanned.includes(relPath)),
    [],
    '登记在册但没被扫描到的文件',
  )
  /* 不许悄悄把别人的批次扫进来替他们背书。 */
  const intruders = REGION_FILES.filter((relPath) => OTHER_BATCH_PREFIXES.some((prefix) => relPath.startsWith(prefix)))
  assert.deepEqual(intruders, [], `扫描面里混进了其它批次的目录：${intruders.join('、')}`)
  /* 也不许悄悄缩窄（例如把某个文件从表里删掉就「干净」了）。 */
  assert.equal(
    REGION_FILES.length,
    14,
    `扫描面必须恰好是审计 §4.4 的 14 个文件，实际 ${REGION_FILES.length} 个`,
  )
  assert.ok(
    !REGION_FILES.some((relPath) => relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')),
    '扫描面不许包含测试文件自身',
  )
})

test('阶段B④扫描范围守卫：`taskPageContext.ts` / `TaskRuntimeProvider.tsx` 确实没有用户可见文案', () => {
  const offenders: string[] = []
  ;['components/taskPageContext.ts', 'components/TaskRuntimeProvider.tsx', 'components/taskResultHelpers.ts'].forEach(
    (relPath) => {
      extractScanSurfaces(readScan(relPath)).forEach((surface) => {
        if (CJK_RE.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ ${surface.text.trim()}`)
        }
      })
    },
  )
  assert.deepEqual(
    offenders,
    [],
    `审计 §4.4 把这三个文件记为「无用户可见文案」，出现了中文文案说明它们的口径变了（需要同步复核）：\n${offenders.join('\n')}`,
  )
})

/* ------------------------------------------------------------- ⑤ 词表守卫 */

test('阶段B④词表守卫：词源与 `enumLabels` 同源，新增枚举自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('任务号'), '主区禁词表里必须有「任务号」（§6.1）')
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'), '主区禁词表里必须有「供应商」')
  assert.ok(GENERATION_GATE_STATE.values.includes('ready'), '生成条件状态表必须覆盖 `ready`（§4.4 模式 3）')
  assert.ok(TASK_KIND.values.includes('video'), '任务类型表必须覆盖 `video`（R15）')
  assert.ok(
    TASK_KIND.values.includes('script_merge') && TASK_KIND.values.includes('script_variant'),
    '任务类型表必须覆盖运行时实测漏出英文的 `script_merge` / `script_variant`',
  )
  GENERATION_GATE_STATE.values.forEach((value) => {
    assert.ok(CJK_RE.test(labelFor(GENERATION_GATE_STATE, value)), `生成条件状态 ${value} 的中文映射缺失`)
  })
})
