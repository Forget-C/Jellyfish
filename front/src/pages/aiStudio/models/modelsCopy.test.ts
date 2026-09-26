/**
 * 「设置 / 模型页（+ 服务层出口）主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B 第 7 批 · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md`
 *  §4.7「设置 / 模型页（+ 服务层 `services/`）」+ §8.1 区域 7 + §8.1.1 豁免口径）
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * `REGION_FILES`（在文件里逐个列出，共 9 个；本测试**只**扫这些）：
 *
 * | # | 扫描面 | §4.7 点名条目 |
 * |---|---|---|
 * | 1 | `pages/aiStudio/models/ModelManagement.tsx` | 模型管理页容器（页签与页名） |
 * | 2 | `pages/aiStudio/models/ModelsTab.tsx` | 模式 2（`:726,310,312` 参数 JSON / `:691` `GPT-4` 占位符）、模式 5（`:699`） |
 * | 3 | `pages/aiStudio/models/ProvidersTab.tsx` | 模式 4（`:265,540,581` 地址列与 `title` 属性）、模式 2（`:272` AK/SK、`:288,545` 描述）、模式 5（`:684` 友商域名）、`:668` 校验提示 |
 * | 4 | `pages/aiStudio/models/SettingsTab.tsx` | 模式 3（`:108-111` `Debug/Info/Warn/Error` 直渲） |
 * | 5 | `pages/aiStudio/models/constants.ts` | 模式 4（`:25-33` `maskUrl` 失败分支外泄前 20 字符） |
 * | 6 | `pages/Settings.tsx` | 模式 3（`:18,30,34,55,58` i18n key 整页原样上屏 / `Save` / `:44` value 用显示名） |
 * | 7 | `pages/NotFound.tsx` | 模式 3（`:11-13` `title="404"` + 整页英文） |
 * | 8 | `i18n.ts` | R24 第 2 条 / R27 的**根因**（初始语言被 `LanguageDetector` 解析成 `en-US`） |
 * | 9 | `store/useAppStore.ts` | §4.7（`:21` `name: 'Admin'` 直渲在右上角）、R24 第 3 条的角色稳定码 |
 *
 * ⚠️ **`layouts/MainLayout.tsx` 不进扫描面，只做定点断言。**
 * 它含导航名 `'LLM 调试台（开发）'`，而用户已裁定该页「仅开发可见、阶段 B 不投工、
 * 导航入口淡化本轮不改路由」（审计 §9.0-1 + §9.1 第 9 项）。把它拉进扫描面就必须
 * **整文件豁免**，那正是 §8.1.1 禁止的「给豁免开口子」。因此改为定点断言
 * （`Agent管理` 已改中文、右上角用户名/角色已中文、`LLM 调试台（开发）` 按裁定保留）。
 *
 * ⚠️ **本测试不覆盖 `services/**`**：服务层出口由同批的 `services/servicesCopy.test.ts` 负责
 * （它排除 `generated/**`）。两个文件互不替对方背书。
 *
 * ================================ 词表口径（本区域的三个判断） ================================
 *
 * 1. **「供应商」在模型页是业务名词，允许保留。** 审计 §4.7-552 原文：「供应商名属本页核心功能、
 *    允许保留」——这一页就是供应商（生成服务）配置页，页签 / 按钮 / 表头 / 空态全用它。
 *    因此本测试对 `models/**` **逐条豁免这一个词**（不是豁免整文件：UUID、字段名、接口路径、
 *    环境变量名、枚举原值、模型原名、开发术语一律照样扫）。
 *    守卫见「区域词表守卫」一条：豁免只对 `models/**` 生效，「设置页 / 404 / i18n / store」四个
 *    文件仍然按基准表禁 `供应商`。
 * 2. **裸写英文技术词只允许出现在技术配置区块里**（「中文在前、英文括注」的形态处处允许）。
 *    即：`Base URL` / `AK/SK` / `API Key` / `API Secret` 与裸写凭据占位符 `AK` / `SK`
 *    仅允许落在 `ProvidersTab.tsx` 的 `ProviderTechnicalConfigFields` 函数体内
 *    （审计 §4.7-548/549：标签保留（供应商配置页允许技术性最强）），
 *    主区（表格列 / 卡片 / 详情面板）一律「接口地址」「访问密钥」。
 * 3. **`title` / `placeholder` 是扫描面**（审计 §8.1 末段 + §5.5-D 实测）：
 *    `/models` 的 `title` 属性里曾有完整本机地址，悬停即见，纯文本扫描抓不到。
 *
 * ============================== 注释剥离器（不要用朴素正则） ==============================
 *
 * 与 `taskCenterCopy.test.ts` / `chapterStudioCopy.test.ts` 同款：**逐行**处理，永不跨行吞代码
 * （前几批实测：字符串里的块注释起止符会让「先正则去块注释」的朴素实现吞掉几百行，造成假绿）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ENUM_RAW_VALUES,
  MODEL_RAW_NAMES,
  MODEL_CATEGORY,
  PROVIDER_STATUS,
  labelFor,
} from '../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
  type LeakHit,
} from '../components/mainScreenCopyGuard.ts'
import {
  CUSTOM_INTEGRATION_TEXT,
  PROVIDER_STATUS_MAP,
  INVALID_ADDRESS_TEXT,
  LOCAL_ONLY_ADDRESS_NOTE,
  SYSTEM_CREATED_TEXT,
  describeAddress,
  describeCreatedBy,
  describeForList,
  isImplementationDetailText,
  isLocalOnlyAddress,
  maskUrl,
} from './constants.ts'
import { UNKNOWN_ROLE_LABEL, USER_ROLE_LABEL_KEYS, userRoleLabel, useAppStore } from '../../../store/useAppStore.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/models` → `front/src` */
const SRC_ROOT = resolve(HERE, '../../..')

/**
 * 审计 §4.7 对应的**全部**文件（逐个列出，见文件头表格）。
 *
 * 这份表同时是「已登记的文件必须真实存在、且真的被遍历到、数量不许悄悄变」的守卫依据。
 */
const REGION_FILES: readonly string[] = [
  'pages/aiStudio/models/ModelManagement.tsx',
  'pages/aiStudio/models/ModelsTab.tsx',
  'pages/aiStudio/models/ProvidersTab.tsx',
  'pages/aiStudio/models/SettingsTab.tsx',
  'pages/aiStudio/models/constants.ts',
  'pages/Settings.tsx',
  'pages/NotFound.tsx',
  'i18n.ts',
  'store/useAppStore.ts',
]

/** 模型 / 供应商配置页（「供应商」这个词只在这些文件里放行）。 */
const MODEL_PAGE_FILES: readonly string[] = REGION_FILES.filter((rel) =>
  rel.startsWith('pages/aiStudio/models/'),
)

/**
 * 本批**不许**出现在扫描面里的其它批次目录（防止「顺手多扫」替别人背书）。
 *
 * `layouts/` 也在其中：见文件头「MainLayout 不进扫描面」的裁定。
 */
const OTHER_BATCH_PREFIXES: readonly string[] = [
  'pages/aiStudio/assets/',
  'pages/aiStudio/chapter/',
  'pages/aiStudio/shots/',
  'pages/aiStudio/project/',
  'pages/aiStudio/promptFlow/',
  'pages/aiStudio/llmPipeline/',
  'services/',
  'layouts/',
]

/** 全仓唯一的「技术详情」实现（审计 §8.1.1 第 1 条）。 */
const TECHNICAL_DETAIL_WAIVER = 'pages/aiStudio/project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'

/** 技术配置区块的唯一豁免函数（审计 §4.7-548/549；见文件头词表口径第 2 条）。 */
const TECH_CONFIG_FUNCTIONS: readonly string[] = ['ProviderTechnicalConfigFields']

/** 主区渲染标记：它们**绝不**允许落进技术配置豁免区间（防「把主区搬进豁免区蒙混过扫描」）。 */
const MAIN_SCREEN_MARKERS: readonly string[] = [
  'message.error(',
  'message.success(',
  'providerColumns',
  'describeCreatedBy(',
]

/**
 * 区域补充的**后端字段名 / 开发术语正则**（共享基准表里没有、§4.7 与本区域代码会读到的）。
 *
 * 判定只针对**用户可见扫描面**：源码里读这些字段名是正常的，上屏才是模式 2。
 */
const REGION_EXTRA_FIELD_PATTERN =
  /(?<![A-Za-z0-9_])(?:base_url|enum_code|oss_url|generation_type)(?![A-Za-z0-9_])/i

/**
 * 区域补充的**逐字禁词**（比共享基准表更严的一层）。
 *
 * `apimart` / `api.openai.com` / `Nano Banana`：模式 5 的共享词表只收「模型原名」
 * （`MODEL_RAW_NAMES`）与枚举原值，**收不到供应商名 / 友商域名 / 展示名**；
 * `端点` / `门禁` / `契约` / `降级视图` 是审计 §7.4 宽词表点名的**开发术语**。
 */
const REGION_EXTRA_TERMS: readonly string[] = [
  'apimart',
  'api.openai.com',
  'Nano Banana',
  '端点',
  '门禁',
  '契约',
  '降级视图',
  '语料',
]

/**
 * **裸写**英文技术词（未用「（…）」做中文在前括注）。
 *
 * 左侧 `(?<![（(“"'])` 是「允许括注形态」的实现：`接口地址（Base URL）` /
 * `访问密钥（AK/SK）` 是审计 §4.7 明确建议的形态（负向自检里有断言），
 * 而裸写 `title: 'Base URL'` 才是本批要改掉的形态。
 */
const BARE_TECH_TERM_PATTERNS: readonly { readonly term: string; readonly pattern: RegExp }[] = [
  { term: '裸写 Base URL（未「中文在前英文括注」）', pattern: /(?<![（(“"'])Base\s*URL/ },
  { term: '裸写 AK/SK（未「中文在前英文括注」）', pattern: /(?<![（(“"'])AK\s*\/\s*SK/ },
  { term: '裸写 API Key（未「中文在前英文括注」）', pattern: /(?<![（(“"'])API\s*Key/ },
  { term: '裸写 API Secret（未「中文在前英文括注」）', pattern: /(?<![（(“"'])API\s*Secret/ },
]

/** 裸写凭据占位符：整段扫描面**恰好**是 `AK` / `SK`（`placeholder="AK"` 的形态）。 */
const BARE_CREDENTIAL_PLACEHOLDERS: readonly string[] = ['AK', 'SK']

/** 哪些文件允许「供应商」这个词（见文件头词表口径第 1 条）。 */
const PROVIDER_NOUN_ALLOWED_FILES: readonly string[] = MODEL_PAGE_FILES

const CJK_RE = /[\u4e00-\u9fff]/

/* ------------------------------------------------------------------ 工具 */

function readScan(relPath: string): string {
  return readFileSync(resolve(SRC_ROOT, relPath), 'utf8')
}

function regionSources(): Array<{ relPath: string; source: string }> {
  return REGION_FILES.map((relPath) => ({ relPath, source: readScan(relPath) }))
}

/**
 * 只保留代码（去注释），用于「渲染点有没有接上管道」这类**源码级**断言。
 *
 * ⚠️ 逐行处理，永不跨行吞代码（见文件头「注释剥离器」）。
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
 * 区域检查器 = 共享扫描器（模式 1/2/3/4/5 + 基准禁词）**并上**区域补充表
 * （字段名正则 + 开发术语 + 裸写英文技术词 + 裸写凭据占位符）。
 *
 * `allowProviderNoun` = true 时放行「供应商」这一个词（只对 `models/**` 生效）。
 */
export function findRegionLeaks(source: string, options: { allowProviderNoun?: boolean } = {}): RegionHit[] {
  const allowProviderNoun = options.allowProviderNoun === true
  const hits: RegionHit[] = findMainScreenLeaks(source)
    .filter((hit) => !(allowProviderNoun && hit.term === '供应商'))
    .map((hit) => ({ ...hit, source: 'guard' }))
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
    BARE_TECH_TERM_PATTERNS.forEach(({ term, pattern }) => {
      if (pattern.test(surface.text)) {
        hits.push({ line: surface.line, kind: surface.kind, term, text: surface.text, source: 'region' })
      }
    })
    if (BARE_CREDENTIAL_PLACEHOLDERS.includes(surface.text.trim())) {
      hits.push({
        line: surface.line,
        kind: surface.kind,
        term: `裸写凭据占位符「${surface.text.trim()}」`,
        text: surface.text,
        source: 'region',
      })
    }
  })
  return hits
}

/* --------------------------------- 技术配置区块的边界（函数边界，不用行号） */

type LineRange = { readonly name: string; readonly start: number; readonly end: number }

/**
 * 解析 `function NAME(` / `export function NAME(` … 到顶格 `}` 的行号区间（1 基，含首尾）。
 *
 * 用函数边界而不是硬编码行号：审计 §8.1.1 记录过「批 2 记的行号在批 3 开工前已漂移 ~18 行」。
 */
export function functionRanges(source: string, names: readonly string[]): LineRange[] {
  const lines = source.split('\n')
  const ranges: LineRange[] = []
  names.forEach((name) => {
    const startIndex = lines.findIndex((line) => new RegExp(`^(?:export )?function ${name}\\b`).test(line))
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

/** 技术配置豁免区间（只对 `ProvidersTab.tsx` 生效）。 */
function techConfigLines(source: string): Set<number> {
  const exempt = new Set<number>()
  functionRanges(source, TECH_CONFIG_FUNCTIONS).forEach((range) => {
    for (let i = range.start; i <= range.end; i += 1) exempt.add(i)
  })
  return exempt
}

function providerTabSource(): string {
  return readScan('pages/aiStudio/models/ProvidersTab.tsx')
}

/** 区域 0 命中扫描（唯一豁免：`ProvidersTab.tsx` 的技术配置函数体）。 */
function scanRegion(): { offenders: string[]; exemptHitCount: number } {
  const offenders: string[] = []
  let exemptHitCount = 0
  regionSources().forEach(({ relPath, source }) => {
    const exempt = relPath === 'pages/aiStudio/models/ProvidersTab.tsx' ? techConfigLines(source) : new Set<number>()
    findRegionLeaks(source, { allowProviderNoun: PROVIDER_NOUN_ALLOWED_FILES.includes(relPath) }).forEach((hit) => {
      if (exempt.has(hit.line)) {
        exemptHitCount += 1
        return
      }
      offenders.push(...formatLeakHits(relPath, [hit]))
    })
  })
  return { offenders, exemptHitCount }
}

/* --------------------------------------------------------------- 护栏自检 */

test('阶段B⑦护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGION_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('阶段B⑦护栏：§4.7 专项探针的 7 个禁词，逐个注入真实源码都必须被抓到', () => {
  const probes: ReadonlyArray<{ token: string; probe: string }> = [
    { token: 'base_url', probe: 'base_url=https://example.com/v1' },
    { token: 'enum_code', probe: 'enum_code=active' },
    { token: 'oss_url', probe: 'oss_url=oss://bucket/a.png' },
    { token: 'dry_run', probe: 'dry_run' },
    { token: 'api.openai.com', probe: 'https://api.openai.com/v1' },
    { token: 'Nano Banana 2', probe: 'Nano Banana 2' },
    { token: 'AK/SK', probe: 'AK/SK' },
  ]
  /* 用真实源码做底：既证明「文件真的被读到了」，又证明「正则真的在跑」。
     ⚠️ 这里**不能**用 `pages/Settings.tsx` 做底：R24 修完后它整页文案都来自语言包，
     源码里已经没有用户可见字面量（`countScanSurfaces` 为 0），做底等于空跑。 */
  const base = readScan('pages/aiStudio/models/ProvidersTab.tsx')
  const probesMissing: string[] = []
  probes.forEach(({ token, probe }) => {
    const injected = `${base}\nconst __probe__ = () => <div title="${probe}">${probe}</div>\n`
    const hits = findRegionLeaks(injected, { allowProviderNoun: true })
    const caught = hits.some(
      (hit) => hit.text.includes(probe) || hit.text.toLowerCase().includes(token.toLowerCase()),
    )
    if (!caught) probesMissing.push(token)
  })
  assert.deepEqual(
    probesMissing,
    [],
    `这些 §4.7 专项探针禁词没被抓到（扫描器或区域补充表失效）：${probesMissing.join('、')}`,
  )
  assert.ok(countScanSurfaces(base) > 0, '真实源码没提取到任何扫描面')
})

test('阶段B⑦护栏：允许的说法不许被判成泄漏（防过度整改）', () => {
  assert.ok(
    scannerNegativeSelfCheck(),
    '「待确认候选」这类用户拍板放行的业务说法被判成了泄漏 —— 细分口径退化成了整词禁',
  )
  const allowed = [
    /* 模型页的核心功能词汇（审计 §4.7-548/549/552 明确允许保留） */
    '接口地址（Base URL）',
    '访问密钥（AK/SK）',
    '接口地址',
    '访问密钥',
    /* ⚠️ 「访问密钥（API Key）」这句话**不能**放进全局负向表：`key` 本身就是枚举原值
       （`FRAME_TYPE` 的关键帧 `key`），共享词表的整词匹配会在英文括注里命中它 ——
       这是共享扫描器的一个已知假阳性（该文件对本批只读，不改）。
       它的正确性由下面「豁免守卫」一条用**区间内注入探针**证明：括注形态在技术配置
       区块里被吞掉、在主区被报出来。 */
    '供应商',
    '添加供应商',
    '共 3 个供应商',
    /* §4.7 要求对非公网地址额外标注的说法 */
    '仅本机可达，外部服务取不到',
    '（仅本机可达，外部服务取不到）',
    '/（地址格式不合法）',
    /* 本批新写的产品文案 */
    '视频生成',
    '图片生成',
    '已就绪',
    '已配置 3 项',
    '系统预置',
    '由 张三 创建',
    '自定义接入',
    '这条接入说明含技术细节，已收进「技术详情」',
    '调试',
    '常规',
    '警告',
    '错误',
    '读取运行模式状态失败，请稍后重试',
    '剧本文件解析失败，请确认格式（旧版 .doc 请先另存为 DOCX）后重试：提交的内容没有被接受，请检查后重试',
    '服务端出错了，请稍后重试',
    '页面不存在',
    '抱歉，您访问的页面不存在。',
    '返回首页',
  ]
  const offenders = allowed
    .map((text) => ({
      text,
      /* 按**模型页的正式口径**判：放行「供应商」这一个业务名词（见文件头词表口径第 1 条）。 */
      hits: findRegionLeaks(`const __probe__ = () => <div>${text}</div>`, { allowProviderNoun: true }),
    }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些**正确**的说法被误判成泄漏了：\n${offenders.join('\n')}`)

  /* 括注形态与主区裸写形态必须被区别对待 —— 否则上面那些负向断言等于把整类词放行。 */
  assert.ok(
    findRegionLeaks('const __probe__ = () => <div title="Base URL" />').length > 0,
    '裸写 `Base URL` 应当被判成泄漏（只有「（Base URL）」括注形态才放行）',
  )
  assert.ok(
    findRegionLeaks('const __probe__ = () => <Input placeholder="AK" />').length > 0,
    '裸写凭据占位符 `AK` 应当被判成泄漏（只有技术配置区块里才放行）',
  )
})

test('阶段B⑦护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const counts = regionSources().map(({ relPath, source }) => ({
    relPath,
    count: countScanSurfaces(source),
  }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  assert.ok(
    total >= 190,
    `本区域只提取到 ${total} 个用户可见扫描面（登记时实测 210），遍历或提取器可能坏了`,
  )
  /* 模型页五个文件 + 404 页必须有用户可见文案（`pages/Settings.tsx` 除外，见下一条）。 */
  counts
    .filter(
      (item) => item.relPath.startsWith('pages/aiStudio/models/') || item.relPath === 'pages/NotFound.tsx',
    )
    .forEach((item) => {
      assert.ok(item.count > 0, `${item.relPath} 没提取到任何扫描面（文件读取或提取器坏了）`)
    })
  /* R24 修完的**正向特征**：`/settings` 的整页文案全部来自语言包，
     源码里不该再有用户可见字面量（改前那些 `t('settings.title')` 的键名也算扫描面）。 */
  assert.equal(
    counts.find((item) => item.relPath === 'pages/Settings.tsx')?.count,
    0,
    '`pages/Settings.tsx` 又出现了用户可见字面量 —— 系统设置页的文案应当全部走语言包',
  )
})

test('阶段B⑦护栏：JSX 属性值是扫描面的一部分（title / placeholder 悬停即见）', () => {
  const surfaces = regionSources().flatMap(({ source }) => extractScanSurfaces(source))
  const attrs = new Set(
    surfaces.filter((surface) => surface.kind === 'jsx-attr').map((surface) => surface.attr),
  )
  assert.ok(attrs.has('title'), '没提取到 `title` 属性面（悬停即见，§5.5-D 实测的泄漏形态）')
  assert.ok(attrs.has('placeholder'), '没提取到 `placeholder` 属性面')
  assert.ok(attrs.has('label'), '没提取到 `label` 属性面')
  /* 探针：属性值里的禁词必须能被抓到。 */
  const probe = readScan('pages/aiStudio/models/ProvidersTab.tsx')
  const hits = findRegionLeaks(
    `${probe}\nconst __probe__ = () => <div title="https://api.openai.com/v1" placeholder="base_url" />\n`,
    { allowProviderNoun: true },
  )
  assert.ok(
    hits.some((hit) => hit.kind === 'jsx-attr' && hit.text.includes('api.openai.com')),
    '属性值里的友商域名没被扫到',
  )
  assert.ok(
    hits.some((hit) => hit.kind === 'jsx-attr' && hit.term.startsWith('区域字段名')),
    '属性值里的后端字段名没被扫到',
  )
})

/* ------------------------------------------------- ① 主区禁词 0 命中（核心） */

test('§4.7：主区禁词扫描 0 命中（唯一豁免：供应商页技术配置函数体 + 「供应商」这个词）', () => {
  const { offenders, exemptHitCount } = scanRegion()
  assert.deepEqual(
    offenders,
    [],
    `设置 / 模型页区域的主区出现泄漏（模式 1/2/3/4/5/6 或主区禁词）：\n${offenders.join('\n')}`,
  )
  /* 豁免区间**必须吃到恰好这 3 个已登记命中**（逐个点名）：
     ① `key` —— 「访问密钥（API Key）」的英文括注里命中了枚举原值 `key`（共享词表已知假阳性）；
     ②③ 裸写凭据占位符 `AK` / `SK` —— 审计 §4.7-549 允许本页保留凭据字段。
     多一个 / 少一个都要人来复核：多了说明有人往豁免区塞了新东西，
     少了说明豁免边界解错了（那豁免就变成「空转」）。 */
  assert.equal(
    exemptHitCount,
    3,
    `技术配置豁免区间吃到了 ${exemptHitCount} 个命中（登记值 3：key / AK / SK）—— 豁免范围需要复核`,
  )
})

test('§4.7：基准禁词表 + 枚举原值 + 模型原名 + 区域术语，逐个都不出现在扫描面上', () => {
  const offenders: string[] = []
  const exemptByFile: Record<string, Set<number>> = {
    'pages/aiStudio/models/ProvidersTab.tsx': techConfigLines(providerTabSource()),
  }
  regionSources().forEach(({ relPath, source }) => {
    const allowProviderNoun = PROVIDER_NOUN_ALLOWED_FILES.includes(relPath)
    extractScanSurfaces(source).forEach((surface) => {
      if (exemptByFile[relPath]?.has(surface.line)) return
      const lower = surface.text.toLowerCase()
      MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.forEach((term) => {
        if (allowProviderNoun && term === '供应商') return
        if (lower.includes(term.toLowerCase())) {
          offenders.push(`${relPath}:${surface.line} ｜ 基准禁词「${term}」｜ ${surface.text.trim()}`)
        }
      })
      ENUM_RAW_VALUES.forEach((value) => {
        const re = new RegExp(`(?<![A-Za-z0-9_])${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'i')
        if (re.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ 枚举原值「${value}」｜ ${surface.text.trim()}`)
        }
      })
      MODEL_RAW_NAMES.forEach((name) => {
        if (lower.includes(name.toLowerCase())) {
          offenders.push(`${relPath}:${surface.line} ｜ 模型原名「${name}」｜ ${surface.text.trim()}`)
        }
      })
      REGION_EXTRA_TERMS.forEach((term) => {
        if (lower.includes(term.toLowerCase())) {
          offenders.push(`${relPath}:${surface.line} ｜ 区域禁词「${term}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `这些禁词出现在了用户可见文案里：\n${offenders.join('\n')}`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'), '基准表里必须有「供应商」（其余区域仍然禁）')
  assert.ok(ENUM_RAW_VALUES.includes('dry_run'), '枚举词表里应当有 `dry_run`（§4.7 SettingsTab 日志级别同族）')
  assert.ok(ENUM_RAW_VALUES.includes('active'), '枚举词表里应当有供应商状态原值 `active`')
  assert.ok(MODEL_RAW_NAMES.includes('gpt-image-2'), '模型词表里应当有实测泄漏过的模型原名')
})

test('§4.7 区域词表守卫：「供应商」的放行只对模型页生效，其它四个文件仍按基准表禁', () => {
  const probe = 'const __probe__ = () => <div>共 3 个供应商</div>'
  MODEL_PAGE_FILES.forEach((relPath) => {
    assert.equal(
      findRegionLeaks(probe, { allowProviderNoun: true }).length,
      0,
      `${relPath}：模型页应当放行「供应商」（审计 §4.7-552 的页面核心功能词汇）`,
    )
  })
  const nonModelFiles = REGION_FILES.filter((rel) => !MODEL_PAGE_FILES.includes(rel))
  assert.deepEqual(
    nonModelFiles,
    ['pages/Settings.tsx', 'pages/NotFound.tsx', 'i18n.ts', 'store/useAppStore.ts'],
    '非模型页文件表变了 —— 「供应商」的放行范围必须重新复核',
  )
  assert.ok(
    findRegionLeaks(probe, { allowProviderNoun: false }).length > 0,
    '不放开行时「供应商」必须仍然被基准表抓到',
  )
})

/* ---------------------------------------------------------- ② 渲染点口径专项 */

test('§4.7 模式 4：模型页的地址列，可见文本与 `title` 属性必须同口径（§5.5-D 实测点）', () => {
  const source = providerTabSource()
  const code = stripComments(source)
  /* ① 两处 Tooltip / title 都不许再把**原始地址**交出去。 */
  assert.ok(!/title=\{url\}/.test(code), '`title={url}` 又回来了：可见文本掩码、悬停给全文等于掩码白做')
  assert.ok(
    !/title=\{selectedProvider\.base_url\}/.test(code),
    '详情面板的悬停提示又直接给了原始地址',
  )
  assert.ok(
    !/title=\{p\.base_url\}/.test(code),
    '卡片视图的悬停提示又直接给了原始地址',
  )
  /* ② 可见文本与 title 都走唯一实现 `describeAddress`。 */
  const describeUsages = code.match(/describeAddress\(/g) ?? []
  assert.ok(describeUsages.length >= 6, `` + `地址显示口径的调用点只有 ${describeUsages.length} 处（登记时实测 7 处）`)
  assert.ok(!/maskUrl\(/.test(code), '渲染层不许直接用 `maskUrl`（地址口径要经过 `describeAddress`）')
  /* ③ 非公网地址必须额外标注「仅本机可达」（审计 §4.7-552）。 */
  assert.equal(describeAddress('http://127.0.0.1:4321/v1'), `http://***1:4321/v1${LOCAL_ONLY_ADDRESS_NOTE}`)
  assert.ok(LOCAL_ONLY_ADDRESS_NOTE.includes('仅本机可达'))
  assert.ok(LOCAL_ONLY_ADDRESS_NOTE.includes('外部服务取不到'))
  assert.ok(isLocalOnlyAddress('http://10.0.0.8:8000/v1'))
  assert.ok(isLocalOnlyAddress('http://192.168.1.20:8000/v1'))
  /* ④ 公网地址不加「仅本机可达」标注（防过度整改）。 */
  assert.equal(describeAddress('https://api.example.com/v1'), 'https://***le.com/v1')
  assert.ok(!describeAddress('https://api.example.com/v1').includes('仅本机可达'))
  /* ⑤ 地址格式不合法时不许外泄前若干字符（审计 §4.7-555）。 */
  assert.equal(maskUrl('not a url'), INVALID_ADDRESS_TEXT)
  assert.equal(describeAddress('not a url'), INVALID_ADDRESS_TEXT)
  assert.ok(!INVALID_ADDRESS_TEXT.includes('not a url'))
  assert.equal(maskUrl(''), '—')
  /* ⑥ 扫描面专项：属性值里不许出现具体友商域名 / 字段名（探针里已证明抓得到）。 */
  const attrOffenders = extractScanSurfaces(source)
    .filter((surface) => surface.kind === 'jsx-attr')
    .filter((surface) =>
      /api\.openai\.com|Nano Banana|\/api\/v1|localhost|127\.0\.0\.1|apimart|base_url|enum_code|oss_url/i.test(
        surface.text,
      ),
    )
    .map((surface) => `:${surface.line} ｜ ${surface.attr}= ｜ ${surface.text}`)
  assert.deepEqual(attrOffenders, [], `悬停 / 占位属性里有地址或字段名：\n${attrOffenders.join('\n')}`)
})

test('§4.7 模式 4：供应商描述与创建人列不许直渲实现细节 / 运维字段值', () => {
  const code = stripComments(providerTabSource())
  assert.ok(!/\{d \|\| '—'\}/.test(code), '描述列又直接渲染原值（含 `.py` / `/images/generations` 这类实现细节）')
  assert.ok(!/\{p\.description \|\| '—'\}/.test(code), '卡片描述又直接渲染原值')
  assert.ok(!/\{selectedProvider\.description \|\| '—'\}/.test(code), '详情面板描述又直接渲染原值')
  assert.ok(!/\{c \|\| '—'\}/.test(code), '创建人列又直接渲染 `created_by` 原值')
  assert.ok(!/创建：\{p\.created_by\}/.test(code), '卡片里的创建人又直接渲染原值')
  /* 行为级：实现细节形态 → 「自定义接入」，全文另存技术详情。 */
  assert.ok(isImplementationDetailText('基于 image_service_openai_shim.py 转发 /images/generations'))
  assert.ok(isImplementationDetailText('POST /api/v1/studio/x'))
  assert.ok(!isImplementationDetailText('本供应商负责图片与视频生成'))
  assert.equal(describeForList('基于 image_service_openai_shim.py 转发'), CUSTOM_INTEGRATION_TEXT)
  assert.equal(describeForList(''), '—')
  /* 行为级：`integration` 这类服务账号 → 「系统预置」；真人用户名保留但套业务句式。 */
  assert.equal(describeCreatedBy('integration'), SYSTEM_CREATED_TEXT)
  /* 运行时实测（本批只读走查）：模型列表的创建人列显示过 `由 setup 创建` —— 同一类服务账号。 */
  assert.equal(describeCreatedBy('setup'), SYSTEM_CREATED_TEXT)
  assert.equal(describeCreatedBy(''), SYSTEM_CREATED_TEXT)
  assert.equal(describeCreatedBy('zhangsan'), '由 zhangsan 创建')
  /* 源码级：实现细节的**原文**必须落在默认收起的折叠区里（不是被丢掉）。 */
  assert.ok(/<TechnicalDetailSection testId="provider-description-detail">/.test(code))
  assert.ok(/\{selectedProvider\.description\}/.test(code), '实现细节原文被删掉了（报告时说「收进技术详情」就必须真的能查到）')
})

test('§4.7 模式 2：模型页的「参数」不再直渲 JSON，完整值收进默认收起的技术详情', () => {
  const code = stripComments(readScan('pages/aiStudio/models/ModelsTab.tsx'))
  assert.ok(!/title=\{JSON\.stringify\(p\)\}/.test(code), '`Tooltip title={JSON.stringify(p)}` 又回来了')
  assert.ok(!/JSON\.stringify\(p\)\.slice/.test(code), '列表单元格又在截 JSON 直渲')
  assert.ok(/已配置 \$\{count\} 项/.test(code) || /advancedParamCountText\(p\)/.test(code), '列表列必须只说「已配置 N 项」')
  assert.ok(/label="高级参数（技术配置）"/.test(code), '编辑弹窗的 `参数（JSON）` 标签没改成业务说法')
  assert.ok(/<ModelAdvancedParamsDetail params=\{selectedModel\.params\} \/>/.test(code), '完整参数没有收进技术详情折叠区')
  assert.ok(/<TechnicalDetailSection testId="model-advanced-params-detail">/.test(code))
  assert.ok(/placeholder="例如：文本生成模型 A"/.test(code), '模型名占位符还在写死具体友商模型名')
  assert.ok(!/GPT-4/.test(readScan('pages/aiStudio/models/ModelsTab.tsx')), '`GPT-4` 占位符又回来了')
  /* 折叠区渲染点必须落在 `TechnicalDetailSection` 内（只断言「import 了」会放过折叠区外再渲一遍）。 */
  const lines = code.split('\n')
  const jsonLine = lines.findIndex((line) => line.includes('JSON.stringify(params, null, 2)'))
  assert.ok(jsonLine > 0, '找不到完整参数的渲染行')
  const before = lines.slice(0, jsonLine).reverse().findIndex((line) => line.includes('<TechnicalDetailSection'))
  assert.ok(before >= 0 && before < 12, '完整参数的渲染点不在 `TechnicalDetailSection` 里（收起态就看得见）')
})

test('§4.7-R24：`/settings` 不许再出现 `t(\'settings.…\')` 前缀，`value` 不许用翻译结果', () => {
  const raw = readScan('pages/Settings.tsx')
  const code = stripComments(raw)
  assert.ok(
    !/t\(\s*['"]settings\./.test(code),
    '`Settings.tsx` 又写了 `t(\'settings.title\')` —— 默认命名空间已是 `settings`，' +
      '实际查找 `settings:settings.title` 永远 miss，i18next 会把 key 原样回显到页面上（R24 的根因）',
  )
  assert.ok(/t\('title'\)/.test(code), '系统设置的标题必须走默认命名空间键 `t(\'title\')`')
  assert.ok(/t\('nickname'\)/.test(code), '昵称字段标签/占位符必须走 `t(\'nickname\')`')
  assert.ok(/t\('common:save'\)/.test(code), '跨命名空间键保留显式前缀写法（`common:save`）')
  /* R24 第 3 条：`value` 必须是稳定码，显示才用 `t(...)`。 */
  assert.ok(
    !/value:\s*t\(/.test(code),
    '`Settings.tsx` 又把翻译后的显示名当 `value` —— 切语言后下拉会无匹配、原样显示旧值',
  )
  assert.ok(/value:\s*roleCode/.test(code), '角色下拉的 `value` 必须是稳定码')
  assert.ok(/USER_ROLE_LABEL_KEYS/.test(code), '角色码与 i18n 键的映射必须来自 store 里的唯一一份（不许各写一份）')
  /* 行为级：稳定码 ↔ 中文显示名。 */
  assert.equal(USER_ROLE_LABEL_KEYS.admin, 'settings:roleOptions.admin')
  assert.equal(userRoleLabel('admin', () => '系统管理员'), '系统管理员')
  assert.equal(userRoleLabel('', () => 'x'), UNKNOWN_ROLE_LABEL)
  assert.equal(
    userRoleLabel('brand_new_role', (key) => key),
    UNKNOWN_ROLE_LABEL,
    '未登记的角色码被原样回显（`t()` 未命中会把键名吐出来）',
  )
})

test('§4.7-R27 / R24 根因：`i18n.ts` 必须先读用户选择、默认中文，且没有把 `lng` 写死', () => {
  const raw = readScan('i18n.ts')
  const code = stripComments(raw)
  assert.ok(/lng:\s*resolveInitialLanguage\(\)/.test(code), '`i18n.init` 必须显式给初始语言（R24/R27 的根因）')
  assert.ok(
    !/lng:\s*['"]zh-CN['"]/.test(code),
    '把 `lng` 写死成 `\'zh-CN\'` 会让「用户切到英文」失效 —— 必须「先读用户选择、默认 zh-CN」',
  )
  assert.ok(/localStorage\.getItem\(LANGUAGE_STORAGE_KEY\)/.test(code), '初始语言必须读用户存过的选择')
  assert.ok(/LANGUAGE_STORAGE_KEY = 'jellyfish_language'/.test(code), '存储键必须与语言切换下拉写入的键同源')
  assert.ok(/DEFAULT_LANGUAGE: SupportedLanguage = 'zh-CN'/.test(code), '默认语言必须是中文')
  assert.ok(/fallbackLng: DEFAULT_LANGUAGE/.test(code), '`fallbackLng` 必须保留（删掉会让缺键时回落到 en-US）')
  assert.ok(/\.use\(LanguageDetector\)/.test(code), 'LanguageDetector 必须保留（它负责缓存用户的选择）')
  assert.ok(/try\s*\{/.test(code) && /catch/.test(code), '读 localStorage 必须 try/catch（隐私模式 / 无 window 下会抛）')
  assert.ok(/typeof window === 'undefined'/.test(code), '必须处理无 window 的环境（单测 / SSR）')
  assert.ok(/return DEFAULT_LANGUAGE/.test(code), '任何异常路径都必须回落默认中文')
  assert.ok(!/navigator\.language/.test(code), '不许再让浏览器语言参与首屏语言判定（那正是 R24/R27 的根因）')
})

test('§4.7-R27：404 页不硬编状态码，标题是中文，文案仍走 notFound 命名空间', () => {
  const raw = readScan('pages/NotFound.tsx')
  const code = stripComments(raw)
  assert.ok(!/title="404"/.test(code), '`title="404"` 又回来了（硬编状态码对用户没有意义）')
  assert.ok(/title="页面不存在"/.test(code), '404 页标题必须是中文「页面不存在」')
  assert.ok(/useTranslation\('notFound'\)/.test(code), '404 页的命名空间用法本来就是对的（不要改成别的前缀）')
  assert.ok(/t\('subTitle'\)/.test(code) && /t\('backHome'\)/.test(code), '文案必须继续走 notFound 命名空间的键')
  /* 中文键值确实存在（改前整页英文的唯一原因是语言被解析成 en-US，不是缺翻译）。 */
  const zh = JSON.parse(readScan('locales/zh-CN/notFound.json')) as Record<string, string>
  assert.equal(zh.subTitle, '抱歉，您访问的页面不存在。')
  assert.equal(zh.backHome, '返回首页')
})

test('§4.7 模式 3：模型设置页的日志级别选项名必须是中文（`value` 仍是后端原值）', () => {
  const raw = readScan('pages/aiStudio/models/SettingsTab.tsx')
  const code = stripComments(raw)
  ;['Debug', 'Info', 'Warn', 'Error'].forEach((label) => {
    assert.ok(!new RegExp(`label: '${label}'`).test(code), `日志级别选项名还在直渲英文原值 \`${label}\``)
  })
  assert.ok(/'调试'/.test(code) && /'常规'/.test(code) && /'警告'/.test(code) && /'错误'/.test(code))
  /* 写回后端仍必须是原来的原值，否则会破坏契约。 */
  ;['debug', 'info', 'warn', 'error'].forEach((value) => {
    assert.ok(new RegExp(`value: '${value}'`).test(code), `日志级别写回原值 \`${value}\` 丢了（会破坏后端契约）`)
  })
})

/* -------------------------------------------------------- ③ MainLayout 定点断言 */

test('§4.7 模式 3：导航 / 用户名 / 角色已中文化，`LLM 调试台（开发）` 按裁定保留', () => {
  const raw = readFileSync(resolve(SRC_ROOT, 'layouts/MainLayout.tsx'), 'utf8')
  const code = stripComments(raw)
  assert.ok(/'Agent管理'/.test(code) === false, '导航名 `Agent管理` 又回来了（§4.7 模式 3 点名要改中文）')
  assert.ok(/agents: '智能体管理'/.test(raw), '导航名必须改成「智能体管理」')
  assert.ok(
    raw.includes('LLM 调试台（开发）'),
    '`LLM 调试台（开发）` 被改了 —— 用户已裁定该页「仅开发可见、阶段 B 不投工、导航入口淡化本轮不改路由」' +
      '（审计 §9.1 第 9 项），改名属产品命名决策，不在本次治理范围',
  )
  assert.ok(/\{user\.name\}/.test(code), '右上角用户名渲染点不见了（定点断言的落点）')
  assert.ok(
    !/\{user\.role\}/.test(code),
    '右上角又直渲 `user.role` —— 它现在是稳定码（`admin`），必须经 `userRoleLabel` 走 i18n',
  )
  assert.ok(/userRoleLabel\(user\.role, t\)/.test(code), '角色显示必须走 `userRoleLabel`')
  /* store 的默认用户名已中文化（§4.7：`name: 'Admin'` 直渲在右上角）。 */
  assert.equal(useAppStore.getState().user.name, '管理员')
  assert.equal(useAppStore.getState().user.role, 'admin')
  assert.ok(!/name: 'Admin'/.test(readScan('store/useAppStore.ts')))
})

/* ------------------------------------------------------------- ④ 豁免守卫 */

test('阶段B⑦豁免守卫：技术详情折叠实现仍然只有 `TechnicalDetailCollapse.tsx` 一个文件', () => {
  const waiver = readFileSync(resolve(SRC_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  assert.ok(
    waiver.includes('export function TechnicalDetailSection'),
    '豁免文件必须导出统一的技术详情折叠壳',
  )
  const offenders: string[] = []
  MODEL_PAGE_FILES.forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    if (code.includes('技术详情（默认收起）')) offenders.push(`${relPath} 复制了统一折叠壳的标题文案`)
    if (/<details/.test(code)) offenders.push(`${relPath} 自建了 <details> 形态的技术详情`)
    if (/<summary/.test(code)) offenders.push(`${relPath} 自建了 <summary> 形态的技术详情`)
    if (
      relPath.endsWith('.tsx') &&
      code.includes('技术详情') &&
      !code.includes('TechnicalDetailSection')
    ) {
      offenders.push(`${relPath} 里出现了「技术详情」字样，但没有复用 TechnicalDetailSection`)
    }
  })
  assert.deepEqual(offenders, [], `出现了第二套「技术详情」实现，必须改用 TechnicalDetailSection：\n${offenders.join('\n')}`)
  /* 两个用到折叠区的渲染侧文件必须从唯一豁免文件 import。 */
  ;['pages/aiStudio/models/ModelsTab.tsx', 'pages/aiStudio/models/ProvidersTab.tsx'].forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    assert.ok(
      code.includes(
        "import { TechnicalDetailSection } from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'",
      ),
      `${relPath} 必须复用唯一豁免文件的技术详情折叠壳`,
    )
  })
})

test('阶段B⑦豁免守卫：技术配置区块的豁免范围可被解出、不许吞主区、不许为空、有长度上限', () => {
  const source = providerTabSource()
  const ranges = functionRanges(source, TECH_CONFIG_FUNCTIONS)
  assert.equal(
    ranges.length,
    TECH_CONFIG_FUNCTIONS.length,
    `技术配置函数必须存在，实际找到 ${ranges.map((range) => range.name).join('、') || '（无）'}`,
  )
  const range = ranges[0]
  assert.ok(range.end > range.start, `技术配置函数边界解不出来（start=${range.start} end=${range.end}）`)
  const size = range.end - range.start
  /* 长度上限：登记时实测 67 行（8 个表单字段）。上限放到 90，防的是「有人把整屏列表塞进来」；
     真正防止「拿豁免蒙混过关」的是下面那条**主区渲染标记**断言。 */
  assert.ok(size <= 90, `技术配置豁免区间有 ${size} 行，长到足以藏下主区文案（上限 90 行）`)
  const exemptText = source.split('\n').slice(range.start - 1, range.end).join('\n')
  /* 「不许为空」：区间必须真的装着**它声称豁免的技术内容**（否则就是豁免边界解错了）。 */
  assert.ok(/接口地址（Base URL）/.test(exemptText), '豁免区间里没有技术配置标签（豁免边界可能解错了）')
  assert.ok(/访问密钥（API Key）/.test(exemptText), '豁免区间里没有访问密钥字段（豁免边界可能解错了）')
  assert.ok(/placeholder="AK"/.test(exemptText), '豁免区间里没有裸写凭据占位符（豁免边界可能解错了）')
  /* 「不许吞主区」：主区渲染标记一个都不许落进豁免区间。 */
  const swallowed = MAIN_SCREEN_MARKERS.filter((marker) => exemptText.includes(marker))
  assert.deepEqual(
    swallowed,
    [],
    `技术配置豁免区间吞掉了主区渲染标记：${swallowed.join('、')} —— 等于把主区搬进豁免区蒙混过扫描（审计 §8.1.1 第 ④ 条）`,
  )

  /* 豁免的**作用**必须可验证：注入到区间内的禁词被吞掉，注入到区间外的被报出来。 */
  const lines = source.split('\n')
  const insideProbe =
    'const __probe_inside__ = () => <Form.Item label="访问密钥（API Key）"><div>apimart base_url</div></Form.Item>'
  const injectedInside = [...lines.slice(0, range.start), insideProbe, ...lines.slice(range.start)].join('\n')
  const countersInside = 0
  void countersInside
  const insideHits = findRegionLeaks(injectedInside, { allowProviderNoun: true }).filter(
    (hit) => hit.line === range.start + 1,
  )
  assert.ok(insideHits.length > 0, '注入到豁免区间第一行的探针没有被扫描器抓到（扫描器或词表失效）')
  const insideExempt = techConfigLines(injectedInside)
  assert.ok(
    insideHits.every((hit) => insideExempt.has(hit.line)),
    '注入到技术配置区块内的禁词没有被豁免区间覆盖 —— 豁免边界与实际渲染点错位',
  )
  assert.ok(
    insideHits.some((hit) => hit.text.includes('访问密钥（API Key）')),
    '「中文在前英文括注」的形态在技术配置区块内没被吞掉 —— 负向自检里那条排除说明需要复核',
  )
  const outsideProbe = 'const __probe_outside__ = () => <div>apimart base_url</div>'
  const injectedOutside = `${source}\n${outsideProbe}\n`
  const outsideHits = findRegionLeaks(injectedOutside)
  assert.ok(
    outsideHits.some((hit) => hit.line === lines.length + 1),
    '注入到豁免区间**之外**的禁词没被报出来 —— 豁免范围吞了整文件',
  )
})

/* -------------------------------------------------------- ⑤ 扫描范围守卫 */

test('阶段B⑦扫描范围守卫：登记表里的文件真实存在，且都被遍历到', () => {
  const missing = REGION_FILES.filter((relPath) => !existsSync(resolve(SRC_ROOT, relPath)))
  assert.deepEqual(missing, [], `登记表里列了不存在的文件：${missing.join('、')}`)
  const scanned = regionSources().map((item) => item.relPath)
  assert.deepEqual(
    REGION_FILES.filter((relPath) => !scanned.includes(relPath)),
    [],
    '登记在册但没被扫描到的文件',
  )
  /* 不许悄悄把别人的批次扫进来替他们背书。 */
  const intruders = REGION_FILES.filter((relPath) =>
    OTHER_BATCH_PREFIXES.some((prefix) => relPath.startsWith(prefix)),
  )
  assert.deepEqual(intruders, [], `扫描面里混进了其它批次 / 按裁定不进扫描面的文件：${intruders.join('、')}`)
  /* 也不许悄悄缩窄（例如把某个文件从表里删掉就「干净」了）。 */
  assert.equal(
    REGION_FILES.length,
    9,
    `扫描面必须恰好是审计 §4.7 的 9 个文件，实际 ${REGION_FILES.length} 个`,
  )
  assert.ok(
    !REGION_FILES.some((relPath) => relPath.endsWith('.test.ts') || relPath.endsWith('.test.tsx')),
    '扫描面不许包含测试文件自身',
  )
})

test('阶段B⑦扫描范围守卫：`ModelManagement.tsx` / `SettingsTab.tsx` 确实没有本批登记之外的英文漏网', () => {
  const offenders: string[] = []
  ;['pages/aiStudio/models/ModelManagement.tsx', 'pages/aiStudio/models/SettingsTab.tsx'].forEach((relPath) => {
    extractScanSurfaces(readScan(relPath)).forEach((surface) => {
      const text = surface.text.trim()
      /* 共享扫描器的已知提取假阳性：`useState<string>('providers')` 这类泛型/调用写法
         会在 `>…<` 之间留下一段代码（实测提取出 `( ) return (`）。
         只判**看起来像一句文案**的纯英文面（字母 / 空格 / 常见标点，不含括号与大括号）。 */
      if (!/^[A-Za-z][A-Za-z .,!?:;'’-]*$/.test(text)) return
      /* 这两页审计 §4.7 只点名「日志级别英文选项」一条；其余扫描面一律必须是中文。 */
      if (!CJK_RE.test(text)) {
        offenders.push(`${relPath}:${surface.line} ｜ 纯英文扫描面 ｜ ${text}`)
      }
    })
  })
  assert.deepEqual(
    offenders,
    [],
    `这两页出现了纯英文的用户可见文案（本批只登记了日志级别一条，其余都会回写后端原值说明口径变了）：\n${offenders.join('\n')}`,
  )
})

test('阶段B⑦词表守卫：模型页的「供应商状态」显示口径与全仓唯一映射表的差异**已登记**（不许悄悄漂移）', () => {
  /**
   * 本批**没有**统一这两份口径，原因与代价都写在这里（审计 §4.7 未点名、属「同一出口两种口径」的可收项）：
   *   - 模型页 `constants.PROVIDER_STATUS_MAP`：活跃 / 测试中 / 禁用（页面自有的配置页说法）；
   *   - 全仓唯一映射表 `enumLabels.PROVIDER_STATUS`：可用 / 测试中 / 已停用。
   * 统一会改动模型页的可见文案（活跃→可用、禁用→已停用），超出 §4.7 的点名范围，
   * 因此**只登记、不改**；这条断言钉住现状，将来谁改都必须同时改这里（不许静默漂移）。
   */
  assert.equal(PROVIDER_STATUS_MAP.active.text, '活跃')
  assert.equal(PROVIDER_STATUS_MAP.testing.text, '测试中')
  assert.equal(PROVIDER_STATUS_MAP.disabled.text, '禁用')
  assert.equal(labelFor(PROVIDER_STATUS, 'active'), '可用', '唯一映射表的口径变了 —— 需重新评估是否统一')
  assert.equal(labelFor(PROVIDER_STATUS, 'disabled'), '已停用')
  assert.equal(PROVIDER_STATUS_MAP.testing.text, labelFor(PROVIDER_STATUS, 'testing'), '唯一同口径的一项也漂移了')
})

test('阶段B⑦词表守卫：词源与 `enumLabels` 同源，新增枚举 / 模型会自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  MODEL_CATEGORY.values.forEach((value) => {
    assert.ok(CJK_RE.test(labelFor(MODEL_CATEGORY, value)), `模型类别 ${value} 的中文映射缺失`)
  })
  PROVIDER_STATUS.values.forEach((value) => {
    assert.ok(CJK_RE.test(labelFor(PROVIDER_STATUS, value)), `供应商状态 ${value} 的中文映射缺失`)
  })
  const unknownCategory = labelFor(MODEL_CATEGORY, 'brand_new_category')
  assert.ok(CJK_RE.test(unknownCategory) && !unknownCategory.includes('brand_new_category'))
})
