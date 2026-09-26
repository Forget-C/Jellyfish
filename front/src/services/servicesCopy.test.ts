/**
 * 「服务层（`services/**`）出口主区禁词扫描 0 命中 + 错误构造口径」区域级验收测试
 * （阶段 B 第 7 批 · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md`
 *  §4.7「服务层（跨页面传播源 —— 最高杠杆）」+ §8.1 区域 7 + §7.1-7）
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * 扫描面 = `front/src/services/**` **目录遍历**，且：
 *
 * 1. **排除 `services/generated/**`**：那是 `openapi-typescript-codegen` 的自动产物
 *    （审计 §7.1-7 第 4 条：生成物不手改、只在封装层加屏蔽）。本测试**不声称覆盖
 *    `generated/**`**，它一行都没有进扫描面、也没有被改过一个字。
 * 2. 排除本目录的 `*.test.ts`（测试文件自身）。
 *
 * 遍历结果必须与 `REGION_FILES` 逐项相等（数量 + 名单），所以「新增一个 services 文件」
 * 会立刻让这条守卫变红、强制人来复核，而不是被静默跳过。
 *
 * 登记时实测（10 个文件，共 40 个用户可见扫描面 —— 服务层本来就只有少量面向用户的句子）：
 *
 * | # | 文件 | §4.7 点名条目 |
 * |---|---|---|
 * | 1 | `services/llmPipelineApi.ts` | 模式 6（`:58-61` / `:87-90` / `:114-117` / `:581`）、模式 2（`:859`）、模式 4（`:1292`） |
 * | 2 | `services/orchestrationStatusApi.ts` | 模式 6（`:49-52` 后端 message / 响应体原样上行） |
 * | 3 | `services/juriluDiagnostics.ts` | 模式 2/3（`:69,87,90,96,114,116-117` 开发术语与请求头名） |
 * | 4 | `services/dramaPlanApi.ts` | 与 `callApi` **同型**的错误构造（`:140-144`，结构性缺口的兄弟行） |
 * | 5 | `services/http.ts` | axios 封装层（§4.7 提到的三个「错误构造处」之一；无用户文案） |
 * | 6 | `services/openapi.ts` | 生成客户端初始化（无用户文案） |
 * | 7 | `services/aiStudioApi.ts` | 旧 mock 客户端（无用户文案） |
 * | 8 | `services/studioEntities.ts` | 生成客户端薄封装（无用户文案） |
 * | 9 | `services/filmTaskLinks.ts` | 任务链路薄封装（无用户文案） |
 * | 10 | `services/projectAssetReadiness.ts` | 读模型 + 一句中文错误结论 |
 *
 * ================================ 服务层的口径（审计 §4.7 + §7.1-7） ================================
 *
 * 1. **`/api/v1/...` 作为请求参数出现 = 正常，不改**（§7.1-7 第 1 条）。本测试只判
 *    「用户能看到的字符串」：扫描器提取的是 JSX 文本 / 白名单 JSX 属性值 / 含中文的字面量，
 *    所以 `callApi('/api/v1/studio/…')` 这类请求代码天然不在扫描面里（**不是靠放行**）。
 * 2. **`message` 只保留中文结论**，后端原文 / `detail` / 响应体 / HTTP 状态码全部进
 *    `GenerationRequestError.technical` / `OrchestrationStatusError.backendMessage+responseText`
 *    这两个**技术字段**（默认收起的「技术详情」读取）。
 * 3. **本区域没有函数级豁免**：豁免清单必须为空（比「开口子」更强）。
 *    服务层承载「原文」的方式是**数据字段**，不是字符串字面量 ——
 *    这正是它不需要豁免的原因。守卫见「豁免守卫（要求为空）」一条。
 * 4. **共享扫描器的已知边界（诚实声明，见 §5.6）**：它看不见三类东西 ——
 *    ① 不含中文且不是白名单属性的字面量；② 嵌套模板串；③ 动态插值把后端值渲出来的形态。
 *    所以本测试额外做了两件事补它：
 *    - **源码级形状断言**（旧构造写法不许回来）；
 *    - **真跑一次请求层**（stub `globalThis.fetch`），直接断言「`message` 干净 + 原文在技术字段」——
 *      只断言 `message` 干净会放过「把原文直接删掉」，只断言「有技术字段」会放过「message 里也有原文」，
 *      两条必须各自成立（审计 §7.1-8 的成对断言要求）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENUM_RAW_VALUES, MODEL_RAW_NAMES } from '../pages/aiStudio/components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
  type LeakHit,
  type ScanSurface,
} from '../pages/aiStudio/components/mainScreenCopyGuard.ts'
import {
  GenerationRequestError,
  callApi,
  downloadDeliveryTxt,
  parseScriptDocument,
  persistGeneratedVideo,
  requestFailureConclusion,
  technicalTextOf,
  toUserFacingApiErrorText,
} from './llmPipelineApi.ts'
import { OrchestrationStatusError, fetchOrchestrationStatusData } from './orchestrationStatusApi.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVICES_ROOT = HERE

/** 自动产物目录：**不进扫描面、也不许改**（审计 §7.1-7 第 4 条）。 */
const GENERATED_PREFIX = 'generated/'

/** 登记在册的扫描面（见文件头表格）。 */
const REGION_FILES: readonly string[] = [
  'aiStudioApi.ts',
  'dramaPlanApi.ts',
  'filmTaskLinks.ts',
  'http.ts',
  'juriluDiagnostics.ts',
  'llmPipelineApi.ts',
  'openapi.ts',
  'orchestrationStatusApi.ts',
  'projectAssetReadiness.ts',
  'studioEntities.ts',
]

/**
 * 区域补充的**逐字禁词**：共享基准表（12 词）+ 开发术语 + 供应商 / 模型展示名。
 *
 * 服务层是**跨页面传播源**，所以这里比页面区域更严：一句话进了 `message` 就会被十几个页面
 * 的 toast 原样弹出来。
 */
const REGION_EXTRA_TERMS: readonly string[] = [
  'apimart',
  'api.openai.com',
  'Nano Banana',
  '供应商',
  '门禁',
  '任务号',
  '生成依据',
  '槽位',
  '端点',
  '契约',
  '降级视图',
  /* 凭据缩写：**服务层全域禁止**（模型页的技术配置区块是页面侧的事，与这里无关）。 */
  'AK/SK',
]

/** 区域补充的**后端字段名正则**（服务层最容易被拼进错误文本的一批）。 */
const REGION_EXTRA_FIELD_PATTERN =
  /(?<![A-Za-z0-9_])(?:base_url|enum_code|oss_url|generation_type|error_message|raw_keys|storage_key)(?![A-Za-z0-9_])/i

/**
 * **旧构造写法的形状**（改前服务层把后端原文 / `detail` / 响应体 / 状态码拼进 `message` 的形态）。
 *
 * 逐一钉住：只要有人把其中任何一种写回来，这条守卫就红。
 */
const LEGACY_CONSTRUCTION_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  {
    /* 旧写法是「把拼装表达式直接当 `message`」：
       `new GenerationRequestError(String(error.message ?? payload?.message ?? text ?? `HTTP x`) + suffix, …)`。
       新写法把后端原文放进 `backendMessage` **技术字段**（那里出现 `String(error.message ?? …)` 是正常的），
       所以这里钉的是「构造函数的第一个实参是不是拼装表达式」。 */
    name: '异常 message 的实参是拼装表达式（而不是中文结论）',
    pattern: /new (?:GenerationRequestError|OrchestrationStatusError)\(\s*String\(/,
  },
  { name: '把 detail 用 JSON.stringify 拼进 message', pattern: /JSON\.stringify\(detail\)/ },
  { name: 'detail 后缀拼接（`const suffix = detail ? …`）', pattern: /const suffix = detail \?/ },
  { name: '把整个响应体 text 当 message 兜底', pattern: /\?\?\s*text\s*\?\?/ },
  { name: '把 HTTP 状态码拼进用户可见文案', pattern: /（HTTP \$\{|：HTTP \$\{/ },
  { name: '响应体切片上屏', pattern: /text\.slice\(0, 120\)/ },
  { name: '缺少 file_id 的后端字段名文案', pattern: /没有拿到 file_id/ },
]

const CJK_RE = /[\u4e00-\u9fff]/

/* ------------------------------------------------------------------ 工具 */

function walkServices(dir = SERVICES_ROOT, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap((name) => {
    const next = rel ? `${rel}/${name}` : name
    if (statSync(join(dir, next)).isDirectory()) return walkServices(dir, next)
    return [next]
  })
}

/** 扫描面文件（排除 `generated/**` 与测试文件自身）。 */
function scanFileNames(): string[] {
  return walkServices()
    .filter((name) => !name.startsWith(GENERATED_PREFIX))
    .filter((name) => !name.endsWith('.test.ts'))
    .sort()
}

function readScan(relPath: string): string {
  return readFileSync(resolve(SERVICES_ROOT, relPath), 'utf8')
}

function regionSources(): Array<{ relPath: string; source: string }> {
  return scanFileNames().map((relPath) => ({ relPath, source: readScan(relPath) }))
}

/**
 * 只保留代码（去注释），用于源码级形状断言。
 *
 * ⚠️ 逐行处理，永不跨行吞代码（与 `taskCenterCopy.test.ts` / `modelsCopy.test.ts` 同款）。
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

/* ------------------------------------- 区域检查器（共享扫描器 + 区域补充表） */

export type RegionHit = LeakHit & { readonly source: 'guard' | 'region' }

/**
 * 共享提取器的**已知假阳性**（服务层实测两处，都是类型注解、不是文案）：
 * `dramaPlanApi.ts` 的 `( , brief as unknown as Record`、
 * `llmPipelineApi.ts` 的 `| null usable?: boolean …` —— 泛型 `>…<` 之间留下的一段代码
 * 被当成 JSX 文本面，于是 `unknown` / `usable` 这类枚举原值被误判。
 *
 * 判定：**不含中文、不是白名单属性面、且含 `| ; { } ?: as =>` 之一** ⇒ 按代码处理。
 * （共享提取器对本批只读；这条过滤只作用于本区域的判定，`jsx-attr` 面不受影响。）
 */
export function looksLikeCodeFragment(surface: ScanSurface): boolean {
  if (CJK_RE.test(surface.text)) return false
  if (surface.kind === 'jsx-attr') return false
  return /[|;{}]|\?:| as |=>/.test(surface.text)
}

export function findRegionLeaks(source: string): RegionHit[] {
  const hits: RegionHit[] = findMainScreenLeaks(source)
    .filter((hit) => !looksLikeCodeFragment({ kind: hit.kind, text: hit.text, line: hit.line }))
    .map((hit) => ({ ...hit, source: 'guard' }))
  extractScanSurfaces(source)
    .filter((surface) => !looksLikeCodeFragment(surface))
    .forEach((surface) => {
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

/** 区域 0 命中扫描（**没有豁免**：服务层承载原文靠数据字段，不靠字符串豁免）。 */
function scanRegion(): { offenders: string[] } {
  const offenders: string[] = []
  regionSources().forEach(({ relPath, source }) => {
    findRegionLeaks(source).forEach((hit) => {
      offenders.push(...formatLeakHits(relPath, [hit]))
    })
  })
  return { offenders }
}

/* --------------------------------------------------------------- 护栏自检 */

test('阶段B⑦服务层护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGION_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('阶段B⑦服务层护栏：§4.7 专项探针的 7 个禁词，逐个注入真实源码都必须被抓到', () => {
  const probes: ReadonlyArray<{ token: string; probe: string }> = [
    { token: 'base_url', probe: 'base_url=https://example.com/v1' },
    { token: 'enum_code', probe: 'enum_code=active' },
    { token: 'oss_url', probe: 'oss_url=oss://bucket/a.png' },
    { token: 'dry_run', probe: 'dry_run' },
    { token: 'api.openai.com', probe: 'https://api.openai.com/v1' },
    { token: 'Nano Banana 2', probe: 'Nano Banana 2' },
    { token: 'AK/SK', probe: 'AK/SK' },
  ]
  /* 用真实源码做底：既证明「文件真的被读到了」，又证明「正则真的在跑」。 */
  const base = readScan('llmPipelineApi.ts')
  const probesMissing: string[] = []
  probes.forEach(({ token, probe }) => {
    const injected = `${base}\nconst __probe__ = () => <div title="${probe}">${probe}</div>\n`
    const hits = findRegionLeaks(injected)
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

test('阶段B⑦服务层护栏：允许的说法不许被判成泄漏（防过度整改）', () => {
  assert.ok(
    scannerNegativeSelfCheck(),
    '「待确认候选」这类用户拍板放行的业务说法被判成了泄漏 —— 细分口径退化成了整词禁',
  )
  const allowed = [
    /* 服务层改后真正写进去的那些句子（逐句都是产品口径） */
    '服务端出错了，请稍后重试',
    '提交的内容没有被接受，请检查后重试',
    '当前状态不允许这一步操作，请刷新后再试',
    '登录或访问凭证已失效，请重新登录后再试',
    '操作太频繁，请稍后再试',
    '剧本文件解析失败，请确认格式（旧版 .doc 请先另存为 DOCX）后重试',
    '视频已经生成，但没有登记成功；请重试，或打开「技术详情」查看记录',
    '导出失败，请稍后重试',
    '导出失败：服务端返回了空文件，请稍后重试',
    '读取运行模式状态失败，请稍后重试',
    '镜头视频（直提）',
    /* §4.7 要求 jurilu 诊断换成的用户语言（技术详情层） */
    '所在环节 脚本接口',
    '所在环节 分镜接口',
    '脚本接口（未取到脚本编号）',
    '已带登录凭证：是',
    '已附授权头：否',
    '接口返回的内容格式我方没能解析（不是你账号的问题）',
    '接口用了本版本还不支持的内容格式，需要升级后再试',
    '接口调用成功，但这一集确实没有分镜记录（不是账号问题）',
    '凭证携带方式 none',
    '资产准备接口没有返回资产清单',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findRegionLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些**正确**的用户口径被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('阶段B⑦服务层护栏：扫描面确实提取到用户可见文案，不是空跑；`generated/**` 不在扫描面里', () => {
  const counts = regionSources().map(({ relPath, source }) => ({
    relPath,
    count: countScanSurfaces(source),
  }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  assert.ok(
    total >= 30,
    `服务层只提取到 ${total} 个用户可见扫描面（登记时实测 40），遍历或提取器可能坏了`,
  )
  const filesWithCopy = ['llmPipelineApi.ts', 'juriluDiagnostics.ts', 'orchestrationStatusApi.ts']
  filesWithCopy.forEach((relPath) => {
    assert.ok(
      (counts.find((item) => item.relPath === relPath)?.count ?? 0) > 0,
      `${relPath} 没提取到任何扫描面（它是本区域三个「有用户文案」的文件之一）`,
    )
  })
  /* 生成物边界：一个字都不进扫描面，也不许被改（本测试不为它背书）。 */
  const scanned = scanFileNames()
  assert.deepEqual(
    scanned.filter((name) => name.startsWith(GENERATED_PREFIX)),
    [],
    '`services/generated/**` 混进了扫描面 —— 生成物不手改、也不在本测试的覆盖范围内',
  )
  assert.ok(!scanned.some((name) => name.endsWith('.test.ts')), '扫描面不许包含测试文件自身')
})

/* ------------------------------------------------- ① 主区禁词 0 命中（核心） */

test('§4.7 服务层：主区禁词扫描 0 命中（本区域没有豁免）', () => {
  const { offenders } = scanRegion()
  assert.deepEqual(
    offenders,
    [],
    `服务层出现了用户可见的泄漏（模式 1/2/3/4/5/6 或主区禁词）：\n${offenders.join('\n')}`,
  )
})

test('§4.7 服务层：基准禁词表 + 枚举原值 + 模型原名 + 区域术语，逐个都不出现在扫描面上', () => {
  const offenders: string[] = []
  regionSources().forEach(({ relPath, source }) => {
    extractScanSurfaces(source)
      .filter((surface) => !looksLikeCodeFragment(surface))
      .forEach((surface) => {
        const lower = surface.text.toLowerCase()
        MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.forEach((term) => {
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
  assert.deepEqual(offenders, [], `这些禁词出现在了服务层的用户可见文案里：\n${offenders.join('\n')}`)
})

test('§4.7 服务层：请求参数里的 `/api/v1/...` 属正常，不许被当成泄漏（§7.1-7 第 1 条）', () => {
  /* 反证：这些路径确实大量存在于源码里（请求代码），但**不在用户可见扫描面**上。 */
  const source = readScan('llmPipelineApi.ts')
  const pathCount = (source.match(/\/api\/v1\//g) ?? []).length
  assert.ok(pathCount >= 30, `llmPipelineApi.ts 里的请求路径只有 ${pathCount} 处，样本不对`)
  const offenders = extractScanSurfaces(source)
    .filter((surface) => surface.text.includes('/api/v1'))
    .filter((surface) => !looksLikeCodeFragment(surface))
    .map((surface) => `:${surface.line} ｜ ${surface.text.trim().slice(0, 90)}`)
  assert.deepEqual(offenders, [], `请求路径出现在了用户可见扫描面上（那才是泄漏）：\n${offenders.join('\n')}`)
})

/* --------------------------------------- ② 错误构造口径（结构 + 真跑一次） */

test('§4.7 服务层：旧构造写法（后端原文 / detail / 响应体 / 状态码拼进 message）一个都不许回来', () => {
  const offenders: string[] = []
  const errorConstructingFiles = [
    'llmPipelineApi.ts',
    'orchestrationStatusApi.ts',
    'dramaPlanApi.ts',
    'projectAssetReadiness.ts',
    'filmTaskLinks.ts',
    'studioEntities.ts',
  ]
  errorConstructingFiles.forEach((relPath) => {
    const code = stripComments(readScan(relPath))
    LEGACY_CONSTRUCTION_PATTERNS.forEach(({ name, pattern }) => {
      if (pattern.test(code)) offenders.push(`${relPath} ｜ ${name} ｜ ${pattern.source}`)
    })
  })
  assert.deepEqual(offenders, [], `服务层的错误构造又回到了旧写法：\n${offenders.join('\n')}`)
  /* 正向：同型薄封装必须复用**同一个**构造出口，不许各写一套话术。 */
  const dramaPlan = stripComments(readScan('dramaPlanApi.ts'))
  assert.ok(/buildRequestFailure\(null, response\.status, text, payload\)/.test(dramaPlan), '`dramaPlanApi` 必须复用 `buildRequestFailure`')
  assert.ok(
    !/new GenerationRequestError\(/.test(dramaPlan),
    '`dramaPlanApi` 自己拼了一套 `GenerationRequestError`（同一管道出现两种口径）',
  )
  const llm = stripComments(readScan('llmPipelineApi.ts'))
  assert.ok(/throwRequestFailure\(/.test(llm), '三个 `callApi*` 必须走统一的 `throwRequestFailure`')
  assert.ok(/export function buildRequestFailure\(/.test(readScan('llmPipelineApi.ts')))
})

test('§4.7 服务层：`callApi` 的 message 只保留中文结论，原文 / detail / 响应体 / 状态码进技术字段', async () => {
  const nastyBody = JSON.stringify({
    code: 500,
    message: '保存失败：oss_url=https://oss.example.com/a.png file_id=9f3c1a2b-0000-4000-8000-000000000001',
    detail: { code: 'image_prompt_replace_required', message: '后端原文', fix: '带 confirm 再提交', status_code: 409 },
  })
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(nastyBody, { status: 500, statusText: 'Internal Server Error' })) as typeof fetch
  try {
    await assert.rejects(
      () => callApi('/api/v1/studio/anything'),
      (error: unknown) => {
        assert.ok(error instanceof GenerationRequestError, '必须是 `GenerationRequestError`（类型契约不许变）')
        const failure = error as GenerationRequestError
        /* ① message：只允许一句中文结论。 */
        assert.equal(failure.message, '服务端出错了，请稍后重试')
        assert.ok(!/HTTP|oss_url|file_id|9f3c1a2b|\{|detail/.test(failure.message), `message 里混进了原文：${failure.message}`)
        assert.ok(CJK_RE.test(failure.message))
        /* ② 技术字段：后端原文 / 响应体 / 状态码必须**都还在**（否则就是把原文删掉了）。 */
        assert.equal(failure.status, 500)
        assert.equal(failure.technical?.status, 500)
        assert.match(String(failure.technical?.backendMessage), /oss_url/)
        assert.match(String(failure.technical?.responseText), /file_id/)
        assert.match(String(failure.technical?.responseText), /image_prompt_replace_required/)
        /* ③ `detail` 结构化读取的既有口径不许丢（「显式确认覆盖」流程靠它）。 */
        assert.equal((failure.detail as { confirm_field?: string })?.confirm_field, undefined)
        assert.equal((failure.detail as { code?: string })?.code, 'image_prompt_replace_required')
        assert.ok(failure.name === 'GenerationRequestError')
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }

  /* 逐个状态码：结论必须是中文、且不含状态码本身。 */
  const statusSamples = [400, 401, 403, 404, 409, 413, 422, 429, 500, 502, 418]
  statusSamples.forEach((status) => {
    const conclusion = requestFailureConclusion(status)
    assert.ok(CJK_RE.test(conclusion), `状态 ${status} 的结论不是中文：${conclusion}`)
    assert.ok(!conclusion.includes(String(status)), `状态 ${status} 的结论里带了状态码：${conclusion}`)
    assert.ok(!/\/api\/v1|http/.test(conclusion))
    assert.equal(toUserFacingApiErrorText({ status }, '保存失败'), `保存失败：${conclusion}`)
  })
  assert.equal(toUserFacingApiErrorText(new Error('x'), '保存失败'), '保存失败')
  assert.equal(technicalTextOf(new Error('原文')), '原文')
})

test('§4.7 服务层：`parseScriptDocument` / `persistGeneratedVideo` / `downloadDeliveryTxt` 的 message 全部中文化', async () => {
  const originalFetch = globalThis.fetch
  try {
    /* ① 剧本文档解析失败：改前这里把**整个响应体**当兜底且不加中文前缀（§4.7-581）。 */
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ message: 'only_doc_unsupported: 请另存为 DOCX' }), {
        status: 400,
      })) as typeof fetch
    await assert.rejects(
      () => parseScriptDocument(new File(['abc'], 'a.doc')),
      (error: unknown) => {
        const failure = error as GenerationRequestError
        assert.ok(failure instanceof GenerationRequestError)
        assert.match(failure.message, /^剧本文件解析失败/)
        assert.ok(!/only_doc_unsupported|HTTP|\{\}/.test(failure.message), `message 里混进了后端原文：${failure.message}`)
        assert.match(String(failure.technical?.responseText), /only_doc_unsupported/)
        return true
      },
    )

    /* ② 视频登记失败（§4.7-859：改前文案里带着后端字段名 `file_id`）。 */
    globalThis.fetch = (async () => new Response(JSON.stringify({ data: {} }), { status: 200 })) as typeof fetch
    await assert.rejects(
      () => persistGeneratedVideo('shot-1', 'https://example.com/a.mp4', 'x'),
      (error: unknown) => {
        const text = (error as Error).message
        assert.match(text, /视频已经生成，但没有登记成功/)
        assert.ok(!/file_id/.test(text), `message 里又出现了后端字段名：${text}`)
        return true
      },
    )

    /* ③ 导出失败（§4.7-1292：改前把响应体前 120 字拼进 message）。 */
    globalThis.fetch = (async () =>
      new Response('oss_url=https://oss.example.com/x.png /api/v1/studio/files', {
        status: 500,
      })) as typeof fetch
    await assert.rejects(
      () => downloadDeliveryTxt('project-1', 'chapter-1', []),
      (error: unknown) => {
        const failure = error as GenerationRequestError
        assert.equal(failure.message, '导出失败，请稍后重试：服务端出错了，请稍后重试')
        assert.ok(!/oss_url|\/api\/v1|HTTP/.test(failure.message), `message 里混进了响应体：${failure.message}`)
        assert.match(String(failure.technical?.responseText), /oss_url/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('§4.7 服务层：`fetchOrchestrationStatusData` 的 message 中文化，后端 message / 响应体进技术字段', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ message: 'guard 未初始化：JELLYFISH_DRY_RUN=1', data: null }), {
      status: 500,
    })) as typeof fetch
  try {
    await assert.rejects(
      () => fetchOrchestrationStatusData(),
      (error: unknown) => {
        assert.ok(error instanceof OrchestrationStatusError)
        const failure = error as OrchestrationStatusError
        /* 该异常最终在 `RealRunModeBadge` 的默认收起折叠区里渲染；主区那一句必须是中文结论。 */
        assert.equal(failure.message, '读取运行模式状态失败，请稍后重试')
        assert.ok(!/HTTP|JELLYFISH_|guard|500/.test(failure.message), `message 里混进了原文：${failure.message}`)
        assert.equal(failure.status, 500)
        assert.match(failure.backendMessage, /guard 未初始化/)
        assert.match(failure.responseText, /JELLYFISH_DRY_RUN/)
        return true
      },
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})

/* --------------------------------------------------- ③ jurilu 诊断的用户语言 */

test('§4.7 服务层：巨日禄诊断的措辞换成用户语言，且不谎报 / 不泄凭证', async () => {
  const { extractJuriluDiagnostics, resolveJuriluFailureStage } = await import('./juriluDiagnostics.ts')
  const text = extractJuriluDiagnostics({
    diagnostics: {
      script_status: 200,
      script_records_count: 0,
      has_cookie: true,
      has_auth: false,
      auth_header_mode: 'none',
    },
  })
  assert.match(text, /所在环节 脚本接口（未取到脚本编号）/)
  assert.ok(!/接口阶段|scriptId|Cookie|Authorization/.test(text), `诊断里还有开发术语 / 请求头名：${text}`)
  /* 原始环节名仍是**技术字段**（分支判断与单测依赖它），只是不上屏。 */
  assert.deepEqual(resolveJuriluFailureStage({ has_cookie: false, has_auth: false }), {
    stage: 'getScriptPage',
    status: null,
  })
  /* 未登记环节名不许原样回显。 */
  const unknown = extractJuriluDiagnostics({ diagnostics: { stage: 'brandNewStageName', script_status: 200 } })
  assert.ok(CJK_RE.test(unknown), `未登记环节名没有被中文化：${unknown}`)
  assert.ok(!unknown.includes('brandNewStageName'), '未登记环节名被原样回显（§2.1 判定铁律）')
})

/* ------------------------------------------------------------- ④ 豁免守卫 */

test('阶段B⑦服务层豁免守卫：本区域**没有函数级豁免**（豁免必须为空），原文只走数据字段', () => {
  /* ① 豁免清单必须为空：`scanRegion` 里不存在任何「按函数边界放行」的机制。 */
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  /* 探针拼出来，避免这一行把自己匹配上（自匹配会让守卫永远为真）。 */
  const exemptionNeedles = ['technicalProducer' + 'Lines', 'TECH_DETAIL_PRODUCER' + '_FUNCTIONS']
  exemptionNeedles.forEach((needle) => {
    assert.ok(
      !self.includes(needle),
      `本区域测试里出现了「技术详情生产者函数」那套豁免机制（${needle}）—— 服务层不该有函数级豁免`,
    )
  })
  /* ② 服务层承载原文的方式必须是**字段**：这两个类型/字段名是唯一入口。 */
  const llm = readScan('llmPipelineApi.ts')
  assert.ok(/export type RequestFailureTechnical = \{/.test(llm), '`RequestFailureTechnical` 技术字段类型必须存在')
  assert.ok(/readonly backendMessage: string/.test(llm) && /readonly responseText: string/.test(llm))
  assert.ok(/readonly detail: unknown/.test(llm))
  const orchestration = readScan('orchestrationStatusApi.ts')
  assert.ok(/readonly backendMessage: string/.test(orchestration) && /readonly responseText: string/.test(orchestration))
  /* ③ 服务层不许自建第二套「技术详情」UI（§8.1.1 第 1 条）。 */
  regionSources().forEach(({ relPath, source }) => {
    assert.ok(!/<details/.test(source), `${relPath} 自建了 <details> 形态的技术详情`)
    assert.ok(!source.includes('技术详情（默认收起）'), `${relPath} 复制了统一折叠壳的标题文案`)
  })
  /* ④ 生成物一个字都没改：它既不在扫描面，也不许出现「本批改动」痕迹。 */
  const generated = readFileSync(resolve(SERVICES_ROOT, 'generated/core/request.ts'), 'utf8')
  assert.ok(
    generated.includes('Generic Error: status: ${errorStatus}'),
    '`services/generated/core/request.ts` 被改过了 —— 生成物不许手改（本批只在封装层收口）',
  )
})

/* -------------------------------------------------------- ⑤ 扫描范围守卫 */

test('阶段B⑦服务层扫描范围守卫：遍历结果与登记表逐项相等（新增文件会强制复核）', () => {
  const scanned = scanFileNames()
  assert.deepEqual(
    scanned,
    [...REGION_FILES].sort(),
    '扫描面与登记表不一致 —— 新增 / 删除 services 文件必须在本测试里同步登记并复核',
  )
  assert.equal(scanned.length, 10, `扫描面必须恰好是 10 个文件，实际 ${scanned.length} 个`)
  REGION_FILES.forEach((relPath) => {
    assert.ok(countScanSurfaces(readScan(relPath)) >= 0)
  })
})
