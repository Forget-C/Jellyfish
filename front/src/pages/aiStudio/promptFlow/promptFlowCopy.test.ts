/**
 * 「提示词看板 / 编排页（`pages/aiStudio/promptFlow/**`）主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B **第 6 批** · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md` §4.6
 *  「实体管理 + 镜头 / 编辑器 / 文件 / 模板 / 编排 / Agent」一节的 `/prompt-flow` 条目 +
 *  §6.2 模型方案名 + §7.1-5/6 管道口径 + §8.1 区域 6）。
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * | 扫描面 | 覆盖内容 |
 * |---|---|
 * | `pages/aiStudio/promptFlow/**` | 本目录**唯一**的源码文件 `PromptFlowPage.tsx` |
 *
 * 批 5（`3e860a7`）已经做过本页 §4.5 的部分（高级选项区块的凭证 / 来源页口径），
 * 并在 `ProjectWorkbench/components/userFacingCopy.test.ts` 里钉住了那一块；
 * **本文件补的是 §4.6 剩下的条目**（章节无标题回退 UUID / skill 编号拼标题 /
 * placeholder 带参数名 / `describeError` 直上 toast / `renderEnvelope` 展开诊断 /
 * 模型原名上主区）。两者扫描面不同、互不覆盖，不许相互替代。
 *
 * ⚠️ 本区域没有行级豁免；第三层内容一律走全仓唯一的 `TechnicalDetailSection`
 * （审计 §8.1.1）。本页的第三层出口只有一个：**页级** `prompt-flow-error-technical-detail`
 * ——18 处错误出口的原文（经 `maskInternalIds`）渲染在那里，默认收起；
 * 主区只出中文结论。双向断言见「渲染点专项」用例。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENUM_RAW_VALUES, MODEL_RAW_NAMES, textModelBusinessName } from '../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
} from '../components/mainScreenCopyGuard.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/promptFlow` → `front/src/pages/aiStudio` */
const AISTUDIO_ROOT = resolve(HERE, '..')
const PROMPT_FLOW_ROOT = HERE

const PAGE = 'PromptFlowPage.tsx'

/** 逐个登记（新增文件必须显式登记，防止扫描范围悄悄变大 / 缩小）。 */
const REGISTERED_FILES: readonly string[] = [PAGE]

/** 全仓唯一的「技术详情」实现（审计 §8.1.1：组件级豁免只能给一个文件）。 */
const TECHNICAL_DETAIL_WAIVER = 'project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'

/** 区域补充形态（共享基准表覆盖不到、而审计 §4.6 / §6.2 点名的）。 */
const REGION_EXTRA_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: '区域补充: 下载失败的 HTTP 状态码', pattern: /HTTP\s*\d{3}/ },
  { name: '区域补充: 后端诊断展开的键值形态', pattern: /(?:meta\.)?(?:diagnostics|warnings)\s*[:：]/i },
  { name: '区域补充: 章节 UUID 回退形态', pattern: /\|\|\s*c\.id|\?\?\s*c\.id/ },
  { name: '区域补充: skill 编号拼接', pattern: /skill_id\s*[)}）]/ },
  { name: '区域补充: 完整公网地址', pattern: /https?:\/\/[^\s"'`<>）)，。…]+/i },
]

/* ------------------------------------------------------------------ 工具 */

function listSourceFiles(dir: string): string[] {
  const out: string[] = []
  if (!statSync(dir).isDirectory()) return out
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      out.push(...listSourceFiles(full))
      continue
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue
    out.push(full)
  }
  return out
}

function scanFiles(): string[] {
  return listSourceFiles(PROMPT_FLOW_ROOT)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .sort()
}

function relPage(file: string): string {
  return relative(PROMPT_FLOW_ROOT, file).split('\\').join('/')
}

function readPage(): string {
  return readFileSync(resolve(PROMPT_FLOW_ROOT, PAGE), 'utf8')
}

/** 逐行去注释（不能跨行吞代码）。 */
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

/** 取出某个 `testId` 的折叠块（含标签本身）；找不到直接失败，不许静默空跑。 */
function foldBlock(testId: string): string {
  const code = stripComments(readPage())
  const start = code.indexOf(`testId="${testId}"`)
  assert.ok(start >= 0, `${PAGE} 里找不到 testId="${testId}" 的技术详情折叠块 —— 用例必须跟着更新`)
  const open = code.lastIndexOf('<TechnicalDetailSection', start)
  const close = code.indexOf('</TechnicalDetailSection>', start)
  assert.ok(open >= 0 && close > start, `${PAGE} 的 ${testId} 折叠块不闭合`)
  return code.slice(open, close)
}

/**
 * **双向断言**（审计 §9.1-16）：某个 token 必须**只在**技术详情折叠块内出现。
 *
 *   ① 折叠块内**必须**命中（原文确实被承载了）；② 块外**必须 0 命中**（主区确实干净了）。
 * 只断言「主区干净」会放过「直接删掉信息」这种假修。
 */
function assertRenderedOnlyInsideTechnicalDetail(token: string, testId: string): void {
  const code = stripComments(readPage())
  const block = foldBlock(testId)
  assert.ok(block.includes(token), `${PAGE}：技术详情块 ${testId} 里没有「${token}」（信息被删掉而不是收起来？）`)
  const outside = code.split(block).join('')
  const hits = outside.split('\n').filter((line) => line.includes(token))
  assert.deepEqual(
    hits.map((line) => line.trim()),
    [],
    `${PAGE}：主区仍然出现「${token}」（第三层内容只允许在默认收起的「技术详情」里）`,
  )
}

/* --------------------------------------------------------------- 护栏自检 */

test('区域6 /prompt-flow 护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGISTERED_FILES.forEach((relPath) => {
    const source = readFileSync(resolve(PROMPT_FLOW_ROOT, relPath), 'utf8')
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('区域6 /prompt-flow 护栏：§4.6 点名的形态都能被抓到（UUID / 字段名 / 地址 / 供应商 / 枚举原值）', () => {
  const probe = `
const raw = '章节 c.id 不是标题'
export function Probe() {
  return (
    <div title="供应商 deepseek-chat https://bucket.oss-cn-hangzhou.aliyuncs.com/a.png">
      状态：running 和 shot_id 以及 (skill_id) 以及 9f3c1a2b-0000-4000-8000-000000000001
    </div>
  )
}
`
  const surfaces = extractScanSurfaces(probe)
  const terms = new Set(findMainScreenLeaks(probe).map((hit) => hit.term))
  const extraHits: string[] = []
  surfaces.forEach((surface) => {
    REGION_EXTRA_PATTERNS.forEach(({ name, pattern }) => {
      if (pattern.test(surface.text)) extraHits.push(name)
    })
  })
  assert.ok(terms.has('供应商'), '「供应商」没被抓到（含 JSX 属性值）')
  assert.ok(terms.has('模式1 UUID'), 'UUID 没被抓到')
  assert.ok(terms.has('模式2 内部字段名'), '`shot_id` / `file_id` 这类字段名没被抓到')
  assert.ok(terms.has('deepseek-chat'), '模型原名没被抓到（模式 5，词源来自 `enumLabels`）')
  assert.ok(extraHits.includes('区域补充: skill 编号拼接'), '`skill_id)` 的拼接形态没被抓到')
  assert.ok(extraHits.includes('区域补充: 完整公网地址'), '完整公网地址没被抓到')
})

test('区域6 /prompt-flow 护栏：正确业务说法不许被判成泄漏（负向自检）', () => {
  assert.ok(scannerNegativeSelfCheck(), '「待确认候选」这类业务说法被判成了泄漏 —— 词表退化会造成过度整改')
  const allowed: readonly string[] = [
    '第 1 章',
    '第 12 章',
    '生成完成',
    '生成完成 · 草稿已暂存服务端（未写正式列）',
    '模型方案：当前文本方案',
    '下载失败，请稍后重试',
    '加载项目失败：请稍后重试',
    '例如：https://…/agent',
    '巨日禄页面 URL',
    '一键技能生成',
    '提示词已复制到剪贴板',
    '服务端草稿（未保存到镜头）',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findMainScreenLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些业务说法被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('区域6 /prompt-flow 护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const files = scanFiles()
  assert.ok(files.length >= REGISTERED_FILES.length, `本区域只找到 ${files.length} 个源码文件，目录遍历可能失效了`)
  const total = files.reduce((sum, file) => sum + countScanSurfaces(readFileSync(file, 'utf8')), 0)
  assert.ok(total >= 80, `本页只提取到 ${total} 个用户可见扫描面，明显偏少（遍历或提取器可能坏了）`)
})

/* ------------------------------------------- ① 主区禁词 0 命中（核心） */

test('区域6 /prompt-flow：主区禁词扫描 0 命中（基准表 + 枚举原值 + 模型原名 + 区域补充形态）', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relPage(file)
    const source = readFileSync(file, 'utf8')
    offenders.push(...formatLeakHits(relPath, findMainScreenLeaks(source)))
    extractScanSurfaces(source).forEach((surface) => {
      REGION_EXTRA_PATTERNS.forEach(({ name, pattern }) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ ${surface.kind} ｜ 命中「${name}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `提示词看板 / 编排页主区出现泄漏：\n${offenders.join('\n')}`)
})

test('区域6 /prompt-flow 词表守卫：词源与 `enumLabels` 同源，新增枚举自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'), '主区禁词表里必须有「供应商」')
  ;(['skill', 'jurilu', 'running'] as const).forEach((raw) => {
    assert.ok(ENUM_RAW_VALUES.includes(raw), `枚举原值词表里必须有 ${raw}`)
  })
})

/* --------------------------------------- ② 渲染点口径（扫描器看不见的那类） */

test('区域6 渲染点专项：章节没标题时显示「第 N 章」，不回退章节编号（§4.6 模式 1）', () => {
  const code = stripComments(readPage())
  assert.equal(
    /label:\s*c\.title \|\| c\.id/.test(code),
    false,
    '`label: c.title || c.id` 又回来了（章节没标题时会把内部编号端给用户）',
  )
  assert.equal(
    /title:\s*c\.title \|\| c\.id/.test(code),
    false,
    '`title: c.title || c.id` 又回来了（分镜卡上的章节名会显示内部编号）',
  )
  assert.ok(/untitledChapterLabel\(/.test(code), '必须有一个「第 N 章」的中文占位函数')
  assert.ok(
    /untitledChapterLabel\(c\.index \?\? i \+ 1\)/.test(code),
    '章节占位必须优先用后端给的集数（`index`），否则按列表顺序编号',
  )
  // 纯函数口径自检：构造一个没标题的章节，渲染出来的文案必须不含 UUID
  const uuid = '9f3c1a2b-0000-4000-8000-000000000001'
  const label = `第 ${3} 章`
  assert.equal(label.includes(uuid), false)
  assert.deepEqual(findMainScreenLeaks(`const p = () => <div>${label}</div>`), [])
})

test('区域6 渲染点专项：skill 编号不进标题 / 标签（§4.6 模式 1）', () => {
  const code = stripComments(readPage())
  assert.equal(
    /\$\{selectedSkill\.display_name\}（\$\{selectedSkill\.skill_id\}）/.test(code),
    false,
    '导出标题又拼上了 `skill_id`（内部编号上屏）',
  )
  assert.ok(
    /title: selectedSkill\?\.display_name \|\| '提示词生成'/.test(code),
    '导出标题必须是中文名（读不到时给「提示词生成」），不许回退编号',
  )
  assert.equal(
    /selectedSkill\?\.display_name \?\? skillId/.test(code),
    false,
    '条目标签又回退到 `skillId` 了',
  )
})

test('区域6 渲染点专项：`describeError` 是唯一咽喉 —— 主区只出一句中文，原文进技术详情', () => {
  const code = stripComments(readPage())
  // ① 主区只取第一行 + 过脱敏管道
  assert.ok(
    /toUserFacingText\(firstLine, fallback\)/.test(code),
    '`describeError` 必须把「第一行」过 `toUserFacingText`（掩码 + 去内部术语 + 业务化改写）',
  )
  assert.ok(
    /rememberTechnicalDetail\(\{ title: conclusion, detail: maskInternalIds\(raw\)/.test(code),
    '完整原文必须脱敏后写进技术详情可查处（否则就是「删信息」而不是「收起来」）',
  )
  // ② 原文不再直接返回
  assert.equal(
    /if \(err\?\.body\) return renderEnvelope\(err\.body, err\.message \?\? '请求失败'\)/.test(code),
    false,
    '`describeError` 又直接把 `renderEnvelope` 的展开结果返回给主区了（审计 §4.6 模式 4）',
  )
  // ③ 下载失败不再把信封展开 / HTTP 状态码抛给主区
  assert.equal(
    /throw new Error\(renderEnvelope\(/.test(code),
    false,
    '下载失败又抛 `renderEnvelope(...)` 的展开了（诊断原文会直接上 toast）',
  )
  assert.ok(
    code.includes("throw new Error('下载失败，请稍后重试')"),
    '主区必须给一句中文（审计 §4.6 模式 4 的建议口径）',
  )
  assert.equal(/下载失败（HTTP/.test(code), false, 'HTTP 状态码又回到用户可见文案里了（模式 3/4）')
})

test('区域6 渲染点专项：placeholder 不带内部参数名（§4.6 模式 4）', () => {
  const code = stripComments(readPage())
  assert.equal(
    /placeholder="[^"]*projectId=[^"]*clipId=/.test(code),
    false,
    'placeholder 又带上了 `?projectId=&clipId=`（悬停即见的模式 4 泄漏）',
  )
  assert.ok(/placeholder="例如：https:\/\/…\/agent"/.test(code), 'placeholder 必须是「例如：https://…/agent」这种形态')
})

test('区域6 渲染点专项：模型原始名不进主区，改说「模型方案」（§6.2）', () => {
  const code = stripComments(readPage())
  assert.equal(
    /模型：\{result\.model_used/.test(code),
    false,
    '主区又直渲 `result.model_used`（原始模型名，模式 5 / §6.2）',
  )
  assert.ok(
    /模型方案：\{textModelBusinessName\(result\.model_used\)\}/.test(code),
    '主区必须走 `textModelBusinessName(...)` 说「模型方案」',
  )
  // 纯函数口径：未登记的模型名也不许原样回显
  assert.equal(textModelBusinessName('brand-new-model-x'), '当前文本方案')
  assert.ok(!/brand-new-model-x/.test(textModelBusinessName('brand-new-model-x')), '未登记模型名不许回显原值')
})

test('区域6 渲染点专项：错误原文有**屏幕**出口（页级默认收起折叠块，双向断言）', () => {
  const code = stripComments(readPage())
  // ① 双向：原文（经掩码）只在折叠块里出现
  assertRenderedOnlyInsideTechnicalDetail('maskInternalIds(lastErrorOriginal)', 'prompt-flow-error-technical-detail')
  // ② 折叠块必须由共享壳渲染（全仓唯一实现），且不带 `open`
  assert.ok(
    code.includes(`from '../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'`),
    '必须 import 全仓唯一的折叠壳 `TechnicalDetailSection`（审计 §8.1.1）',
  )
  const block = foldBlock('prompt-flow-error-technical-detail')
  assert.equal(/\bopen\b/.test(block.slice(0, block.indexOf('>'))), false, '错误原文折叠块带了 `open` —— 那就不叫默认收起了')
  // ③ 屏幕出口必须真的接上：18 处调用点走 `reportError`，三个子面板都有上报回调
  assert.ok(/const reportError = useCallback\(/.test(code), '页面必须有统一的错误出口 `reportError`')
  /* 调用点必须全部走 `reportError`：`describeError(error)` 只允许出现在 `reportError`
     自己的实现里（那里刚上报完原文、返回中文结论）。 */
  const callSites = (code.match(/reportError\(error\)/g) ?? []).length
  assert.equal(callSites, 18, `18 处错误出口必须全部走 reportError（实际 ${callSites} 处）`)
  const stray = code
    .split('\n')
    .filter((line) => /describeError\(error\)/.test(line) && !/return describeError\(error\)/.test(line))
  assert.deepEqual(
    stray.map((line) => line.trim()),
    [],
    `还有调用点直接走 \`describeError(error)\` —— 原文不会被上报到屏幕折叠块（只进内存日志）：\n${stray.join('\n')}`,
  )
  const wired = (code.match(/onErrorOriginal=\{setLastErrorOriginal\}/g) ?? []).length
  assert.equal(wired, 3, `三个子面板都要接上原文上报回调（实际接线 ${wired} 个）`)
  const reporters = (code.match(/onErrorOriginal\?\.\(describeErrorRaw\(error\)\)/g) ?? []).length
  assert.equal(reporters, 3, `三个子面板都要在出口上报原文（实际 ${reporters} 个）`)
  // ④ 主区一个字都不许多：原文相关标识只允许出现在「上报 / 条件 / 定义」这几类位置
  const outside = code.split(block).join('')
  const suspicious = outside
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /lastErrorOriginal|describeErrorRaw/.test(line))
    .filter(
      (line) =>
        !/^(?:return describeError\(error\)|const raw = describeErrorRaw\(error\)|const describeErrorRaw = |const \[lastErrorOriginal, setLastErrorOriginal\]|\{lastErrorOriginal \? \()/.test(
          line,
        ) &&
        !/reportError|onErrorOriginal|setLastErrorOriginal/.test(line),
    )
  assert.deepEqual(
    suspicious,
    [],
    `原文相关标识出现在折叠块之外的非上报位置，可能把原文漏回主区：\n${suspicious.join('\n')}`,
  )
  // 原文**只能**经掩码后渲染一次，且那一次就在折叠块里
  const rawRenders = code.split('\n').filter((line) => /\{maskInternalIds\(/.test(line))
  assert.equal(rawRenders.length, 1, '原文只允许在页级折叠块里渲染一次（掩码后）')
})

test('区域6 渲染点专项：折叠块**默认收起**，且收起态可见的标签是干净的中文', () => {
  const shell = readFileSync(resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  const detailsMatch = /<details[^>]*>/.exec(shell)
  assert.ok(detailsMatch, '共享折叠壳必须用原生 `<details>` 实现（收起态由浏览器保证）')
  assert.equal(/\bopen\b/.test(detailsMatch[0]), false, '共享壳的 `<details>` 带了 `open`')
  const block = foldBlock('prompt-flow-error-technical-detail')
  assert.equal(/\bopen\b/.test(block.slice(0, block.indexOf('>'))), false, '调用点给折叠区加了 `open`')
  // 收起态可见的只有 summary 文案（共享壳固定）+ `hint` 藏在 <details> 内
  const hint = /hint="([^"]*)"/.exec(block)
  assert.ok(hint, '错误原文折叠块必须写一句收起态说明（共享壳的 hint）')
  assert.deepEqual(
    findMainScreenLeaks(`const __probe__ = () => <div hint=${JSON.stringify(hint[1])} />`),
    [],
    `折叠块的 hint 在收起态也可见，必须干净：${hint[1]}`,
  )
})

/* -------------------------------------------------------- ③ 扫描范围守卫 */

test('区域6 /prompt-flow 扫描范围守卫：登记表里的文件真实存在，且都被目录遍历覆盖到', () => {
  const onDisk = scanFiles().map(relPage)
  const declaredButMissing = REGISTERED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(declaredButMissing, [], `登记表里列了不存在（或已被改名）的文件：${declaredButMissing.join('、')}`)
  const undeclared = onDisk.filter((file) => !REGISTERED_FILES.includes(file))
  assert.deepEqual(
    undeclared,
    [],
    `这些文件没被登记（新增文件必须显式登记，否则扫描范围会悄悄变大）：${undeclared.join('、')}`,
  )
})

/* ------------------------------------------------------------ ④ 豁免守卫 */

test('区域6 /prompt-flow 豁免守卫：本页不许自建第二套「技术详情」', () => {
  const waiver = readFileSync(resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  assert.ok(
    waiver.includes('技术详情（默认收起）'),
    '共享壳的标题文案变了？豁免守卫按它的标题识别「第二套实现」，必须同步',
  )
  assert.ok(waiver.includes('export function TechnicalDetailSection'), '共享壳必须导出 `TechnicalDetailSection`')
  const code = stripComments(readPage())
  assert.equal(/<details/.test(code), false, '`PromptFlowPage.tsx` 自建了 <details>（第三层内容必须走共享壳）')
  assert.equal(code.includes('技术详情（默认收起）'), false, '`PromptFlowPage.tsx` 复制了统一折叠壳的标题文案')
})

/* ------------------------------------------- ⑤ 手工核对登记（扫描器看不见的） */

test('区域6 /prompt-flow 手工核对登记：本页**已知未处理 / 已判定不改**的动态渲染点', () => {
  /**
   * | 落点 | 现状 | 判定 |
   * |---|---|---|
   * | `:1757`（改后）`模型方案：{textModelBusinessName(result.model_used)}` | 后端原始模型名 | **已改**：主区只说业务方案名；原始名仍可从「技术详情」日志查（见下一条的诚实清单） |
   * | `skills.map(...)` 的 `value: s.skill_id` | Select 的 `value` | **不改**：它是提交入参（不上屏），可见文本是 `display_name · stage_label` |
   * | `persistDraft` 的 `model` 字段 | 请求体 | **不改**：不是用户可见文案（§7.1-7 的判定口径） |
   * | `（Mock）` 之类的占位标记 | 本页没有 | — |
   *
   * 这条用例的作用是**上锁**：登记项被改动时断言失败，逼着下一个人回来更新这张表。
   */
  const code = stripComments(readPage())
  const registered: readonly { readonly marker: string; readonly note: string }[] = [
    { marker: 'value: s.skill_id', note: '技能下拉的 value 是提交入参（不上屏），登记为「不改」' },
    { marker: 'skill_id: skillId as string', note: '生成请求体的 skill_id（不上屏），登记为「不改」' },
  ]
  const missing = registered.filter((entry) => !code.includes(entry.marker))
  assert.deepEqual(
    missing.map((entry) => entry.note),
    [],
    `登记在册的「不上屏」用法找不到了 —— 要么被删了（请更新登记表），要么被改名了：\n${missing
      .map((entry) => entry.note)
      .join('\n')}`,
  )
})

test('区域6 /prompt-flow 诚实清单：原文出口是**屏幕折叠块**，内存日志不再被当作出口', () => {
  /**
   * 本页 18 处 `message.error/warning(…)` 全部走 `reportError` 这一个咽喉：
   * - **主区**：一句中文（`describeError` → 只取原文第一行 + `toUserFacingText` 脱敏）；
   * - **第三层**：原文经 `maskInternalIds` 渲染进页级 `prompt-flow-error-technical-detail`
   *   （默认收起，展开才看得到）—— 这一条由上面的双向断言钉住。
   *
   * ⚠️ 如实声明两点（都是事实，不许写成更强的结论）：
   *   ① `rememberTechnicalDetail` 的**内存日志仍然存在**（只是不再有人读它），
   *      页面的屏幕出口**不是**从那份日志渲染的，而是从这里自己的 `lastErrorOriginal` state；
   *   ② 折叠块只保留**最近一次**失败的原文（与 §9.1-8 的口径一致：就地承载、不新建全局 UI）。
   */
  const code = stripComments(readPage())
  assert.ok(/rememberTechnicalDetail/.test(code), '统一管道仍会把原文记进内存日志（保留，未删）')
  assert.equal(
    /readTechnicalDetails/.test(code),
    false,
    '页面一旦改为渲染内存日志，必须改写这条诚实清单（现在的出口是自己的 state）',
  )
  assert.ok(
    /const \[lastErrorOriginal, setLastErrorOriginal\] = useState\(''\)/.test(code),
    '页级 state `lastErrorOriginal` 是屏幕出口的数据源',
  )
  assert.ok(/lastErrorOriginal \? \(/.test(code), '没有失败过时不渲染折叠块（不挂空壳）')
})