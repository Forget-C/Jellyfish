/**
 * 「分镜 / 镜头区（`pages/aiStudio/shots/**`）主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B **第 6 批** · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md`
 *  §4.6（镜头 / 编辑器 / 文件 / 模板 / 编排 / Agent 一节）+ §6.1 + §7.3 + §8.1 区域 6）。
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * | 扫描面 | 覆盖内容 |
 * |---|---|
 * | `pages/aiStudio/shots/**` | 本目录全部非测试源码：`ChapterShotEditPage.tsx`、`ChapterShotsPage.tsx`、
 * `shotStudioCopy.ts`、`components/{ChapterShotAssetBindingSection,ChapterShotAssetConfirmation,`
 * `ChapterShotBasicInfoSection,ChapterShotDialogueConfirmation,ChapterShotPreparationGuide,`
 * `ShotAudioBindingSection}.tsx`、`components/{audioAdmissionCore,bindingRecommendationRules}.ts` |
 *
 * ⚠️ **本区域没有任何行级豁免**：`shots/**` 里出现基准禁词表里的任何一个词就是失败。
 * 之所以能这样，是因为第三层内容全部落在**共享折叠壳** `TechnicalDetailSection` 里
 * （`project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx`，
 * 审计 §8.1.1：组件级豁免全仓只有这一个文件）。
 *
 * ===================== 扫描器**结构性扫不到**的三类（本批手工核对过） =====================
 *
 * 1. **非 JSX 属性、且不含中文的字符串字面量**（`const x = 'oss_url'` 这种不会进扫描面）；
 * 2. **嵌套模板字符串**（内层反引号会让提取器错位）—— 本批用 marker 断言兜底，
 *    错位会**失败**而不是静默放过；
 * 3. **动态插值**（把后端值插进 JSX）—— §5.6 说的泄漏主因。本批的覆盖方式是
 *    「渲染点口径专项」里的点名断言（`{status}` / `{reason}` / `{admission.detail}` 这些形态
 *    逐个钉住），覆盖范围写在每条用例的注释里；**扫不到的剩余部分如实登记**在
 *    「手工核对登记」用例里。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENUM_RAW_VALUES, MODEL_RAW_NAMES } from '../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
} from '../components/mainScreenCopyGuard.ts'
import { SHOT_STATUS, shotStatusLabel } from './shotStudioCopy.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/shots` → `front/src/pages/aiStudio` */
const AISTUDIO_ROOT = resolve(HERE, '..')
const SHOTS_ROOT = HERE

/** 全仓唯一的「技术详情」实现（审计 §8.1.1：组件级豁免只能给一个文件）。 */
const TECHNICAL_DETAIL_WAIVER = 'project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'
/** 本区域应当 import 的折叠壳（相对 `shots/components/`）。 */
const TECHNICAL_DETAIL_IMPORT = '../../project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse'

const ASSET_BINDING = 'components/ChapterShotAssetBindingSection.tsx'
const SHOTS_PAGE = 'ChapterShotsPage.tsx'
const SHOT_EDIT_PAGE = 'ChapterShotEditPage.tsx'
const AUDIO_SECTION = 'components/ShotAudioBindingSection.tsx'

/**
 * 本批纳入扫描面的文件登记表（防止扫描范围被悄悄缩小）。
 *
 * 用途：① 已登记文件必须真实存在且真的被遍历到；② 新增文件必须显式登记
 * （否则「目录遍历」会让范围悄悄变大而没人知道）。
 */
const REGISTERED_FILES: readonly string[] = [
  'ChapterShotEditPage.tsx',
  'ChapterShotsPage.tsx',
  'shotStudioCopy.ts',
  'components/ChapterShotAssetBindingSection.tsx',
  'components/ChapterShotAssetConfirmation.tsx',
  'components/ChapterShotBasicInfoSection.tsx',
  'components/ChapterShotDialogueConfirmation.tsx',
  'components/ChapterShotPreparationGuide.tsx',
  'components/ShotAudioBindingSection.tsx',
  'components/audioAdmissionCore.ts',
  'components/bindingRecommendationRules.ts',
]

/** `shots/**` 的目录结构 —— 每个目录都必须有文件，否则说明遍历被缩窄了。 */
const EXPECTED_DIRS: readonly string[] = ['', 'components']

/**
 * 区域补充的**模式 3/4/6 形态**（共享基准表覆盖不到、而审计 §4.6 点名的）。
 */
const REGION_EXTRA_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: '区域补充: 接口名 existence-check', pattern: /existence-check/i },
  { name: '区域补充: 内部调用口径 llm_called=', pattern: /llm_called/i },
  { name: '区域补充: 内部目标模型口径', pattern: /目标模型\s*[=:：]/ },
  { name: '区域补充: 镜头状态原值', pattern: /(?<![A-Za-z0-9_])(?:pending|generating|ready)(?![A-Za-z0-9_])/ },
  { name: '区域补充: 层级/对账枚举原值', pattern: /(?<![A-Za-z0-9_])(?:auto|review|discard|heuristic_only)(?![A-Za-z0-9_])/ },
  { name: '区域补充: 完整公网地址', pattern: /https?:\/\/[^\s"'`<>）)，。]+/i },
]

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

/** 扫描面：`shots/**` 全部非测试源码（测试文件自身含探针禁词，必须排除）。 */
function scanFiles(): string[] {
  return listSourceFiles(SHOTS_ROOT)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .sort()
}

function relShots(file: string): string {
  return relative(SHOTS_ROOT, file)
}

function readScan(relPath: string): string {
  return readFileSync(resolve(SHOTS_ROOT, relPath), 'utf8')
}

/**
 * 只保留代码（去注释），**逐行**处理（不能用朴素正则去块注释）。
 *
 * 第 3 批实测：`accept=".jpg,…,image/*"` 这种**字符串里的块注释起止符**会让朴素实现
 * 从那里开始吞掉后面几百行代码（假绿）。这里只做两件确定安全的事：
 *   1. 丢掉「整行都是注释」的行；
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

/** 取出某个 `testId` 的折叠块（含标签本身）；找不到直接失败，不许静默空跑。 */
function foldBlock(testId: string, relPath: string): string {
  const code = stripComments(readScan(relPath))
  const start = code.indexOf(`testId="${testId}"`)
  assert.ok(start >= 0, `${relPath} 里找不到 testId="${testId}" 的技术详情折叠块 —— 用例必须跟着更新`)
  const open = code.lastIndexOf('<TechnicalDetailSection', start)
  const close = code.indexOf('</TechnicalDetailSection>', start)
  assert.ok(open >= 0 && close > start, `${relPath} 的 ${testId} 折叠块不闭合`)
  return code.slice(open, close)
}

/**
 * **双向断言**（审计 §9.1-16）：某个 token 必须**只在**技术详情折叠块内出现。
 *
 * 只断言「主区干净」会放过「直接删掉信息」这种假修，所以这里两个方向都要：
 *   ① 折叠块内**必须**命中（原文确实被承载了）；② 块外**必须 0 命中**（主区确实干净了）。
 */
function assertRenderedOnlyInsideTechnicalDetail(
  relPath: string,
  token: string,
  testId: string,
): void {
  const code = stripComments(readScan(relPath))
  const block = foldBlock(testId, relPath)
  assert.ok(block.includes(token), `${relPath}：技术详情块 ${testId} 里没有「${token}」（信息被删掉而不是收起来？）`)
  const outside = code.split(block).join('')
  const hits = outside.split('\n').filter((line) => line.includes(token))
  assert.deepEqual(
    hits.map((line) => line.trim()),
    [],
    `${relPath}：主区仍然出现「${token}」（第三层内容只允许在默认收起的「技术详情」里）`,
  )
}

/* --------------------------------------------------------------- 护栏自检 */

test('区域6 分镜护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGISTERED_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('区域6 分镜护栏：审计 §4.6 点名的形态都能被抓到（DRY_RUN / 槽位 / 供应商 / 枚举原值 / 地址）', () => {
  /* ⚠️ 探针形态有讲究：共享扫描器会把含 `;` `=` `[` `]` `{` `}` 的 `>…<` 片段判成**代码**
     而整段跳过，所以 JSX 文本里**不能**塞 `=`（否则连「槽位」都扫不到 —— 实测踩过）。
     地址 / UUID 这类放 `title=` 属性（悬停即见的扫描面）。 */
  const probe = `
const raw = 'existence-check 返回为空；llm_called=true；目标模型=deepseek-chat'
export function Probe() {
  return (
    <div title="供应商 seedance-2.0-mini https://bucket.oss-cn-hangzhou.aliyuncs.com/prefix/a.png file_id=9f3c1a2b-0000-4000-8000-000000000001">
      层级为预选（auto）；槽位为空；状态为 generating；partial_failed
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

  assert.ok(terms.has('槽位'), '「槽位」没被抓到（审计 §7.3 的扩展词）')
  assert.ok(terms.has('供应商'), '「供应商」没被抓到（含 JSX 属性值，悬停即见）')
  assert.ok(terms.has('模式1 UUID'), 'UUID 没被抓到')
  const surfaceText = surfaces.map((surface) => surface.text).join('\n')
  assert.ok(surfaceText.includes('partial_failed'), '枚举原值 partial_failed 没被抓到')
  assert.ok(
    extraHits.includes('区域补充: 接口名 existence-check'),
    '`existence-check` 没被抓到（审计 §4.6 模式 4 点名的接口名上主区）',
  )
  assert.ok(extraHits.includes('区域补充: 内部调用口径 llm_called='), '`llm_called=` 没被抓到')
  assert.ok(extraHits.includes('区域补充: 镜头状态原值'), '镜头状态原值（generating）没被抓到')
  assert.ok(extraHits.includes('区域补充: 完整公网地址'), '完整公网地址没被抓到')
  // `DRY_RUN` 的显式探针（它在共享表的逐字禁词里，必须扫得到）
  const dryRunProbe = findMainScreenLeaks('const __probe__ = () => <div>当前处于 DRY_RUN 守卫状态</div>')
  assert.ok(
    dryRunProbe.some((hit) => hit.term === 'DRY_RUN'),
    '`DRY_RUN` 没被抓到（审计 §4.6 模式 6 的原文形态）',
  )
})

test('区域6 分镜护栏：用户拍板的业务说法不许被判成泄漏（负向自检）', () => {
  assert.ok(scannerNegativeSelfCheck(), '「待确认候选」这类业务说法被判成了泄漏 —— 词表退化会造成过度整改')
  const allowed: readonly string[] = [
    '待确认',
    '生成中',
    '已就绪',
    '状态待确认',
    '本次建议 12',
    '预选 3',
    '需复核 2',
    '已丢弃 1',
    '关联类别',
    '建议依据',
    '要注意的地方',
    '当前是演练模式：本次没有真实调用模型，也没有产生费用',
    '没有查到该资产是否已存在，请重试',
    '查询资产失败，请重试',
    '分镜提取失败，请稍后重试',
    '已绑定声音（会作为参考音频进入本次请求）',
    '已绑定，但地址是本地/相对路径',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findMainScreenLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些业务说法被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('区域6 分镜护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const files = scanFiles()
  assert.ok(files.length >= REGISTERED_FILES.length, `本区域只找到 ${files.length} 个源码文件，目录遍历可能失效了`)
  const counts = files.map((file) => ({ file, count: countScanSurfaces(readFileSync(file, 'utf8')) }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  assert.ok(total >= 150, `本区域只提取到 ${total} 个用户可见扫描面，明显偏少（遍历或提取器可能坏了）`)
  assert.ok(
    counts.some((item) => relShots(item.file) === SHOT_EDIT_PAGE && item.count >= 40),
    '`ChapterShotEditPage.tsx` 的扫描面少于 40 个，提取器或遍历一定坏了',
  )
})

test('区域6 分镜护栏：JSX 属性值是扫描面的一部分（悬停 / 收起态也看得见，§5.5-D）', () => {
  const surfaces = scanFiles().flatMap((file) => extractScanSurfaces(readFileSync(file, 'utf8')))
  const attrKinds = new Set(
    surfaces.filter((surface) => surface.kind === 'jsx-attr').map((surface) => surface.attr),
  )
  assert.ok(attrKinds.has('title'), '没提取到 `title` 属性面（悬停即见）')
  assert.ok(attrKinds.has('description'), '没提取到 `description` 属性面（Alert 正文在收起态也可见）')
  const probe = findMainScreenLeaks(
    `${readScan(ASSET_BINDING)}\nconst __probe__ = () => <div title="JELLYFISH_DRY_RUN 未关闭">正常</div>\n`,
  )
  assert.ok(
    probe.some((hit) => hit.kind === 'jsx-attr' && hit.term === '模式4 环境变量名'),
    '属性值里的环境变量名没被扫到（「悬停即见」这一类会漏出去）',
  )
})

/* ------------------------------------------- ① 主区禁词 0 命中（核心） */

/**
 * 共享扫描器的**已知假阳性**（逐条登记，沿用 `userFacingCopy.test.ts` 的登记范式）。
 *
 * 为什么需要：共享扫描器把 `>…<` 之间的东西当 JSX 文本节点，于是
 * `</Spin>\n ) : !shot ? (\n <Empty …>` 这段**纯代码**被提取成文本 `) : !shot ? (`，
 * 而 `shot` 恰好是 `TARGET_RATIO_SOURCE` 的一个原值 → 报成「枚举原值直渲」。
 *
 * ⚠️ 这不是「放宽」：登记项必须**当前仍然存在**（否则用例失败，逼人回来清理），
 * 而且只豁免这一条文本，任何新增命中照旧失败。
 */
const SCANNER_FALSE_POSITIVES: readonly {
  readonly file: string
  readonly text: string
  readonly term: string
  readonly why: string
}[] = [
  {
    file: SHOT_EDIT_PAGE,
    text: ') : !shot ? (',
    term: 'shot',
    why: 'JSX 三元表达式的代码片段被当成文本节点；`shot` 是比例来源枚举的一个原值 —— 纯代码，不是渲染值',
  },
]

function isRegisteredFalsePositive(relPath: string, hit: { term: string; text: string }): boolean {
  return SCANNER_FALSE_POSITIVES.some(
    (entry) => entry.file === relPath && entry.term === hit.term && hit.text.trim() === entry.text,
  )
}

test('shots：主区禁词扫描 0 命中（基准表 + 枚举原值 + 模型原名 + 区域补充形态；**无行级豁免**）', () => {
  const offenders: string[] = []
  const seenRegistered = new Set<string>()
  scanFiles().forEach((file) => {
    const relPath = relShots(file)
    const source = readFileSync(file, 'utf8')
    findMainScreenLeaks(source).forEach((hit) => {
      if (isRegisteredFalsePositive(relPath, hit)) {
        seenRegistered.add(`${relPath}|${hit.term}|${hit.text.trim()}`)
        return
      }
      offenders.push(...formatLeakHits(relPath, [hit]))
    })
    extractScanSurfaces(source).forEach((surface) => {
      REGION_EXTRA_PATTERNS.forEach(({ name, pattern }) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ ${surface.kind} ｜ 命中「${name}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `分镜区域主区出现泄漏（模式 1/2/3/4/5/6）：\n${offenders.join('\n')}`)
  // 登记项必须仍然存在（否则说明代码改了，登记表要同步 —— 不许留一条永远豁免的鬼条目）
  const stale = SCANNER_FALSE_POSITIVES.filter(
    (entry) => !seenRegistered.has(`${entry.file}|${entry.term}|${entry.text}`),
  )
  assert.deepEqual(
    stale.map((entry) => `${entry.file} ｜ ${entry.text}`),
    [],
    `这些「假阳性登记」已经不再命中 —— 请核对后删掉登记项（${stale.map((entry) => entry.why).join('；')}）`,
  )
})

test('区域6 分镜词表守卫：词源与 `enumLabels` 同源，新增枚举自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('槽位'), '主区禁词表里必须有「槽位」（§7.3）')
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('DRY_RUN'), '主区禁词表里必须有 `DRY_RUN`')
  ;(['dry_run', 'partial_failed'] as const).forEach((raw) => {
    assert.ok(ENUM_RAW_VALUES.includes(raw), `枚举原值词表里必须有 ${raw}`)
  })
  /* 镜头状态原值（`pending` / `generating` / `ready`）**不在**共享 `enumLabels.ts` 里
     —— 所以本区域自带一张同型表并登记「需追加」（见 `shotStudioCopy.ts` 文件头）。
     这里断言的是：本区域表覆盖了这三个原值，且标签全是中文（不回显原值）。 */
  assert.deepEqual([...SHOT_STATUS.values].sort(), ['generating', 'pending', 'ready'])
  SHOT_STATUS.values.forEach((raw) => {
    const label = shotStatusLabel(raw)
    assert.notEqual(label, raw, `镜头状态 ${raw} 的标签回显了原值`)
    assert.ok(/[\u4e00-\u9fff]/.test(label), `镜头状态 ${raw} 的标签必须是中文：${label}`)
  })
})

/* --------------------------------------- ② 渲染点口径（扫描器看不见的那类） */

test('区域6 渲染点专项：镜头状态走中文映射，未登记状态给中文兜底（不回显原值）', () => {
  assert.equal(shotStatusLabel('pending'), '待确认')
  assert.equal(shotStatusLabel('generating'), '生成中')
  assert.equal(shotStatusLabel('ready'), '已就绪')
  assert.equal(shotStatusLabel('brand_new_state'), SHOT_STATUS.unknown, '未登记状态必须给中文兜底')
  assert.equal(/[a-z]/.test(shotStatusLabel('brand_new_state')), false, '兜底里不许出现英文原值')
  // 渲染点：`statusTag` 必须走映射，而不是直渲 `{status}`
  const page = stripComments(readScan(SHOTS_PAGE))
  assert.ok(
    page.includes('shotStatusLabel(status)'),
    '`statusTag` 必须用 `shotStatusLabel(...)` 渲染（审计 §4.6 模式 3：原来直渲 `{status}`）',
  )
  assert.equal(
    /\{status\}<\/Tag>/.test(page),
    false,
    '`{status}</Tag>` 这种直渲英文原值的形态又回来了',
  )
})

test('区域6 渲染点专项：演练开关原文只进「技术详情」（双向断言，§9.1-16）', () => {
  // ① 资产绑定区的演练 Alert：`DRY_RUN` / 环境变量 / `llm_called` / 目标模型都只允许在折叠块里
  assertRenderedOnlyInsideTechnicalDetail(ASSET_BINDING, '演练原始说明：', 'binding-preview-dry-run-technical-detail')
  assertRenderedOnlyInsideTechnicalDetail(ASSET_BINDING, '是否调用过模型：', 'binding-preview-dry-run-technical-detail')
  assertRenderedOnlyInsideTechnicalDetail(ASSET_BINDING, '目标模型：', 'binding-preview-dry-run-technical-detail')
  const binding = stripComments(readScan(ASSET_BINDING))
  assert.equal(
    /当前处于 DRY_RUN 守卫状态/.test(binding),
    false,
    '「当前处于 DRY_RUN 守卫状态」又回到了主区（审计 §4.6 模式 6 原文）',
  )
  assert.equal(
    /JELLYFISH_DRY_RUN 未关闭/.test(binding),
    false,
    '`JELLYFISH_DRY_RUN 未关闭` 又回到了主区（环境变量名属模式 4）',
  )
  assert.ok(
    binding.includes('当前是演练模式：本次没有真实调用模型，也没有产生费用'),
    '主区必须给出产品自己写的中文结论（演练模式 + 没有费用）',
  )
  // ② 内部的资产池 / 分批口径只允许在折叠块里
  assertRenderedOnlyInsideTechnicalDetail(ASSET_BINDING, '资产池条数：', 'binding-preview-count-technical-detail')
  assertRenderedOnlyInsideTechnicalDetail(ASSET_BINDING, '分批份数：', 'binding-preview-count-technical-detail')
  assert.equal(
    /候选资产数 \$\{/.test(binding),
    false,
    '「候选资产数 N」又回到了主区（审计 §9 第 5 项：候选条数 / 聚合 N 组属后端概念）',
  )
})

test('区域6 渲染点专项：后端成本提示的主区口径（模型名与 DRY_RUN 不进主区，原文进技术详情）', () => {
  /* 运行时实测（本批走查）后端原话：
     `估算 1 批，输入约 850 tokens、输出约 600 tokens（deepseek-chat 量级 < ¥0.1）；DRY_RUN 下不产生任何费用。`
     —— 同一句里既有模型名（模式 5）又有 `DRY_RUN`（模式 3/4）。主区只做两处定点收口：
     括号里的模型名 → 「预计费用 <金额>」；`DRY_RUN` → 「演练模式」。 */
  assertRenderedOnlyInsideTechnicalDetail(
    ASSET_BINDING,
    'hint="服务端给出的费用原话（含内部模型标识与开关状态），只用于核对。"',
    'binding-preview-cost-technical-detail',
  )
  const binding = stripComments(readScan(ASSET_BINDING))
  assert.ok(
    /describePreviewCostNote\(preview\.cost_note\)/.test(binding),
    '成本提示必须过 `describePreviewCostNote(...)`（不能直接渲后端原话）',
  )
  // 折叠块**内**渲染原话是允许的（第三层），所以这里只看块外
  const costBlock = foldBlock('binding-preview-cost-technical-detail', ASSET_BINDING)
  assert.equal(
    /\{preview\.cost_note\}/.test(binding.split(costBlock).join('')),
    false,
    '`{preview.cost_note}` 直接上主区的写法又回来了（模型名 + DRY_RUN 会一起上屏）',
  )
  assert.ok(
    /预计费用 \$1/.test(binding),
    '括号里的模型名必须换成「预计费用 + 金额」（保住金额、去掉模型名）',
  )
  // 主区文案的「接口」也是内部口径（§5.5-G 的残留禁词）→ 已改「这个推荐只读、不写库」
  assert.equal(
    /推荐接口只读不写库/.test(binding),
    false,
    '「推荐接口只读不写库」又回来了（「接口」是内部口径）',
  )
})

test('区域6 渲染点专项：资产绑定表的列名与逐条 reason 口径', () => {
  const binding = stripComments(readScan(ASSET_BINDING))
  assert.ok(binding.includes("title: '建议依据'"), '列名必须是「建议依据」（审计 §4.6 模式 6：原来叫「理由」）')
  assert.equal(/title: '理由'/.test(binding), false, '列名「理由」又回来了')
  assert.ok(binding.includes("title: '关联类别'"), '「槽位」列必须改名（「槽位」是主区禁词，§7.3）')
  assert.ok(
    /\{maskInternalIds\(reason\)\}/.test(binding),
    '逐条建议的后端 reason 必须先过 `maskInternalIds` 再上屏（审计 §4.6 模式 6）',
  )
  assert.ok(
    /message="需要注意的地方"/.test(binding),
    '「后端提示」标题必须改成用户语言（审计 §4.6 模式 6：标题本身就是模式 2）',
  )
  assert.equal(/message="后端提示"/.test(binding), false, '「后端提示」标题又回来了')
})

test('区域6 渲染点专项：接口名与后端原文不再直接进 toast（§4.6 模式 4/6）', () => {
  const editPage = stripComments(readScan(SHOT_EDIT_PAGE))
  assert.equal(
    /message\.error\('existence-check/.test(editPage),
    false,
    '`existence-check` 这种接口名又直接给用户看了（应说「没有查到…，请重试」）',
  )
  assert.ok(
    editPage.includes('没有查到该资产是否已存在，请重试'),
    '`existence-check 返回为空` 必须换成用户语言（审计 §4.6 模式 4）',
  )
  assert.ok(editPage.includes('查询资产失败，请重试'), '`existence-check 调用失败` 必须换成用户语言')
  assert.ok(
    /showUserConclusion\(/.test(editPage),
    '提取类失败必须走统一出口（主区中文结论 + 原文进技术详情），不能 `message.error(后端原文)`',
  )
  assert.equal(
    /message\.error\(defaultTaskActionErrorMessage/.test(editPage),
    false,
    '提取失败的主区文案又变回「直接 message.error(管道结果)」—— 原文没有了折叠层出口',
  )
  const page = stripComments(readScan(SHOTS_PAGE))
  assert.ok(
    /showUserError\(getErrorMessage\(error\)/.test(page),
    '分镜列表页的提取失败必须在出口过统一管道（审计 §4.6 模式 6：`getErrorMessage` 会返回后端原文）',
  )
  assert.equal(
    /message\.error\(getErrorMessage\(error\)\)/.test(page),
    false,
    '`message.error(getErrorMessage(error))` 又回来了（后端原文直上主区）',
  )
  // 音频绑定区：两侧（toast 与 Alert）都已在批 3 接上管道 —— 钉住不许回退
  const audio = stripComments(readScan(AUDIO_SECTION))
  assert.equal(
    /\(e as Error\)\?\.message/.test(audio),
    false,
    '音频区又用 `(e as Error)?.message` 直出后端原文了（批 3 已改成 showUserError）',
  )
  assert.ok(
    /setError\(toUserFacingText\(e, '音频素材加载失败'\)\)/.test(audio),
    '音频素材加载失败必须过 `toUserFacingText`（原文经脱敏后才进 Alert）',
  )
})

test('区域6 渲染点专项：音频准入的地址与「供应商」口径（批 3 成果，钉住不许回退）', () => {
  /* 「供应商」是主区禁词：**用户可见面**（字符串字面量 / JSX 属性）一个都不许有；
     注释里出现（记录「旧文案是『已绑定，但供应商无法访问』」）不算泄漏。 */
  const coreSurfaces = extractScanSurfaces(readScan('components/audioAdmissionCore.ts'))
  const coreOffenders = coreSurfaces
    .filter((surface) => surface.text.includes('供应商'))
    .map((surface) => `:${surface.line} ｜ ${surface.text.trim()}`)
  assert.deepEqual(coreOffenders, [], `音频准入的用户可见文案里又出现了「供应商」：\n${coreOffenders.join('\n')}`)
  const audio = stripComments(readScan(AUDIO_SECTION))
  assert.ok(
    audio.includes(`'${TECHNICAL_DETAIL_IMPORT}'`),
    '音频区的地址出口必须用全仓唯一的折叠壳 `TechnicalDetailSection`',
  )
  assert.ok(
    /admission\.technicalDetail/.test(audio),
    '音频准入的完整地址必须由 `technicalDetail` 承载（主区只说形态）',
  )
})

/* -------------------------------------------------------- ③ 扫描范围守卫 */

test('区域6 扫描范围守卫：登记表里的文件真实存在，且都被目录遍历覆盖到', () => {
  const onDisk = scanFiles().map(relShots)
  const declaredButMissing = REGISTERED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(declaredButMissing, [], `登记表里列了不存在（或已被改名）的文件：${declaredButMissing.join('、')}`)
  assert.ok(onDisk.length >= REGISTERED_FILES.length, '扫描面比登记表还小，说明遍历被缩窄了')
  const undeclared = onDisk.filter((file) => !REGISTERED_FILES.includes(file))
  assert.deepEqual(
    undeclared,
    [],
    `这些 shots/** 源码文件没被登记（新增文件必须显式登记，否则扫描范围会悄悄变大）：${undeclared.join('、')}`,
  )
})

test('区域6 扫描范围守卫：每个目录都有文件（遍历被人为缩窄会立刻失败）', () => {
  const dirs = new Set(
    scanFiles()
      .map((file) => relative(SHOTS_ROOT, dirname(file)))
      .filter((dir) => !dir.startsWith('..')),
  )
  const missing = EXPECTED_DIRS.filter((dir) => !dirs.has(dir))
  assert.deepEqual(
    missing,
    [],
    `这些目录在扫描结果里一个文件都没有，说明目录遍历被缩窄了：${missing.join('、')}（实际：${[...dirs].sort().join('、')}）`,
  )
})

test('区域6 工具自检：注释剥离是逐行的，不会因为字符串里的 `/*` 吞掉后面几百行代码', () => {
  const probe = [
    'const accept = ".mp3,.wav,audio/*"',
    'const 已绑定声音 = 1',
    'const 另一段 = 2',
  ].join('\n')
  const stripped = stripComments(probe)
  assert.ok(stripped.includes('已绑定声音'), '`stripComments` 被字符串里的 `/*` 带偏，吞掉了后面的代码')
  assert.ok(stripped.includes('另一段'), '`stripComments` 吞掉了后续行')
})

/* ------------------------------------------------------------ ④ 豁免守卫 */

test('区域6 豁免守卫：`shots/**` 里不许出现第二套「技术详情」/ 自建 `<details>`', () => {
  const waiver = readFileSync(resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  assert.ok(
    waiver.includes('技术详情（默认收起）'),
    '共享壳的标题文案变了？豁免守卫按它的标题识别「第二套实现」，必须同步',
  )
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relShots(file)
    const code = stripComments(readFileSync(file, 'utf8'))
    if (code.includes('技术详情（默认收起）')) {
      offenders.push(`${relPath} 复制了统一折叠壳的标题文案`)
    }
    if (/<details[\s\S]{0,400}?技术详情/.test(code)) {
      offenders.push(`${relPath} 自建了 <details> 形态的技术详情`)
    }
  })
  assert.deepEqual(offenders, [], `出现了第二套「技术详情」实现，必须改用 TechnicalDetailSection：\n${offenders.join('\n')}`)
})

/* ------------------------------------------- ⑤ 手工核对登记（扫描器看不见的） */

test('区域6 手工核对登记：`shots/**` 里**已知未处理**的动态插值渲染点（不许悄悄增加 / 减少）', () => {
  /**
   * 静态扫描原理上看不见「把后端值插进 JSX」（§5.6），所以逐条手工核对后登记。
   *
   * ## ① 本批已修（**不许回潮**）
   *
   * | 落点 | 改前 | 改后 |
   * |---|---|---|
   * | `ChapterShotsPage` 状态列 | `{status}`（`pending`/`generating`/`ready`） | `shotStatusLabel(status)` |
   * | `ChapterShotsPage` 提取失败 | `message.error(getErrorMessage(error))` | `showUserError(...)` |
   * | `ChapterShotEditPage` 两处 | `existence-check 返回为空 / 调用失败` | 「没有查到该资产是否已存在，请重试」/「查询资产失败，请重试」 |
   * | `ChapterShotEditPage` 两处提取失败 | `message.error(defaultTaskActionErrorMessage(...))` | `showUserConclusion(...)` + 原文进技术详情 |
   * | `ChapterShotAssetBindingSection` | `DRY_RUN 守卫状态` / `JELLYFISH_DRY_RUN` / `llm_called=…` / `后端提示` / 列名「理由」/ 列名「槽位」/ `候选资产数` / `批次` | 全部改中文或收进「技术详情」 |
   * | `ChapterShotAssetBindingSection` 的成本提示 | `（deepseek-chat 量级 < ¥0.1）；DRY_RUN 下不产生任何费用。`（运行时实测原文） | 定点收口为「（预计费用 < ¥0.1）；演练模式下不产生任何费用。」，原话进技术详情 |
   *
   * ## ② 仍未处理（逐条写明为什么）
   *
   * | 落点 | 现状 | 为什么本批不改 |
   * |---|---|---|
   * | `ChapterShotAssetBindingSection` 的 `unmatchedRows[].evidence` 直接拼在「依据：」后面 | 后端自由文本 | 它是**只读展示的证据说明**（中文为主），不在 §4.6 条目里；套 `maskInternalIds` 会改变证据原文，登记为后续建议 |
   * | `admission.detail`（`ShotAudioBindingSection`） | 已由 `audioAdmissionCore` 产出中文形态说明 | 批 3 已收口（地址进 `technicalDetail`）；此处钉住它不许回退 |
   */
  const { bindings, editPage, shotsPage } = {
    bindings: stripComments(readScan(ASSET_BINDING)),
    editPage: stripComments(readScan(SHOT_EDIT_PAGE)),
    shotsPage: stripComments(readScan(SHOTS_PAGE)),
  }
  const resurrected: readonly { readonly marker: string; readonly note: string }[] = [
    { marker: '{status}</Tag>', note: '镜头状态英文原值直渲（§4.6 模式 3）回潮了' },
    { marker: 'message.error(getErrorMessage(error))', note: '后端原文直上 toast（§4.6 模式 6）回潮了' },
    { marker: "message.error('existence-check", note: '接口名上主区（§4.6 模式 4）回潮了' },
    { marker: '当前处于 DRY_RUN 守卫状态', note: 'DRY_RUN 上主区（§4.6 模式 6）回潮了' },
    { marker: 'JELLYFISH_DRY_RUN', note: '环境变量名上主区（§4.6 模式 4）回潮了' },
    { marker: 'llm_called=', note: '`llm_called=` 上主区（§4.6 模式 2）回潮了' },

    { marker: 'message="后端提示"', note: '「后端提示」标题（§4.6 模式 2）回潮了' },
    { marker: "title: '理由'", note: '「理由」列名（§4.6 模式 6）回潮了' },
    { marker: "title: '槽位'", note: '「槽位」列名（§7.3 主区禁词）回潮了' },
  ]
  const back = resurrected.filter((entry) =>
    entry.marker === 'JELLYFISH_DRY_RUN' || entry.marker === 'llm_called='
      ? bindings.includes(entry.marker)
      : bindings.includes(entry.marker) || editPage.includes(entry.marker) || shotsPage.includes(entry.marker),
  )
  assert.deepEqual(
    back.map((entry) => entry.note),
    [],
    `本批已修好的渲染点又回来了：\n${back.map((entry) => entry.note).join('\n')}`,
  )
})
