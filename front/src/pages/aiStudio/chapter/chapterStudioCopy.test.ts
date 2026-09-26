/**
 * 「ChapterStudio 主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B 第 3 批 · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md`
 *  §4.3「ChapterStudio（`pages/aiStudio/chapter/**`）」63 条 + §8.1 区域 3）
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * | 扫描面 | 覆盖内容 |
 * |---|---|
 * | `pages/aiStudio/chapter/**` | `ChapterStudio.tsx`、`chapterIndexing.ts`、`components/**`、`prep/**` 的**全部非测试源码** |
 * | `pages/aiStudio/shots/components/ShotAudioBindingSection.tsx` | 审计把这两个文件**登记在 §4.3**（虽然物理上在 `shots/components/`），所以属本批范围 |
 * | `pages/aiStudio/shots/components/audioAdmissionCore.ts` | 同上 |
 *
 * ⚠️ **本测试不覆盖 `shots/**` 的其它文件**（那是审计 §4.6 / 第 6 批的范围）。
 * `shots/components/` 下还有 `ChapterShotAssetBindingSection.tsx`、`audioAdmissionCore.test.ts`、
 * `bindingRecommendationRules*.ts` 等 —— 它们**不在**本测试的扫描面里，本测试不为它们背书。
 *
 * 覆盖的扫描面形态沿用共享扫描器（`components/mainScreenCopyGuard.ts`，审计 §8.1 硬要求）：
 * JSX 文本节点、**JSX 属性值**（`title` / `placeholder` / `description` / `message` / `label` …，
 * 收起态与悬停态也看得见）、字符串与模板字面量。
 *
 * ================================ 三层模型与豁免（审计 §2.1） ================================
 *
 * 主区不许出现第三层内容（内部 ID / 后端字段名 / 英文枚举原值 / 接口路径 / 供应商与模型原名 /
 * 后端错误原文）。本区域**唯一**允许出现它们的落点是 `ChapterStudio.tsx` 里默认收起的
 * 「技术详情」折叠块 —— 它不是第二套实现，而是既有 `ShotProductionWorkspace` 的
 * `technical` 折叠项（`STEP_OPEN_KEYS` 里**没有** `technical`），审计 §4.3「已判定合规（勿动）」
 * 明确要求**不要改**那两块内容：
 *
 *   1. `ShotProductionWorkspace` 的 `technical` 折叠项（默认收起）；
 *   2. `kf_specs` 分块（只由 `technical` 渲染）。
 *
 * 因此这两处在源码里用显式标记圈出范围（`>>> 技术详情层开始` … `<<< 技术详情层结束`），
 * 本测试按**标记区间**逐行豁免，而不是硬编码行号（行号会随任何一次改动漂移）。
 * 标记只加在 `ChapterStudio.tsx`，并有一条测试专门钉住「标记确实存在且区间非空」。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ENUM_RAW_VALUES,
  MODEL_RAW_NAMES,
  REFERENCE_MODE,
  VIDEO_READINESS_CHECK,
  labelFor,
  modelBusinessName,
  videoPromptSourceLabel,
} from '../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
} from '../components/mainScreenCopyGuard.ts'
import { maskInternalIds } from '../components/maskInternalIds.ts'
import {
  clearTechnicalDetails,
  readTechnicalDetails,
  setUserMessageNotifier,
  showUserConclusion,
  toUserFacingText,
} from '../components/userFacingMessage.ts'
import { frameTypeLabel } from './components/shotStatusText.ts'
import {
  FRAME_BLOCK_FALLBACK_TEXT,
  describeFrameBlockReason,
} from './components/shotReadiness.ts'
import {
  AUDIO_NOT_REACHABLE_TITLE,
  describeAudioAdmission,
} from '../shots/components/audioAdmissionCore.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/chapter` → `front/src` */
const SRC_ROOT = resolve(HERE, '../../..')
const AISTUDIO_ROOT = resolve(SRC_ROOT, 'pages/aiStudio')
const CHAPTER_ROOT = resolve(AISTUDIO_ROOT, 'chapter')

/** 审计把这两个 `shots/components/` 文件登记在 §4.3（本批范围）。 */
const SHOTS_IN_BATCH_FILES: readonly string[] = [
  'shots/components/ShotAudioBindingSection.tsx',
  'shots/components/audioAdmissionCore.ts',
]

/**
 * 本批明确纳入扫描面的文件登记表（防止扫描范围被悄悄缩小）。
 *
 * 新增 `chapter/**` 源码文件会自动被目录遍历纳入；这份表的作用是
 * 「已登记的文件必须真实存在、且真的被遍历到」，以及给空转自检提供样本。
 */
const REGISTERED_FILES: readonly string[] = [
  'chapter/ChapterStudio.tsx',
  'chapter/chapterIndexing.ts',
  'chapter/components/ChapterRawTextEditorModal.tsx',
  'chapter/components/ChapterStudioBatchToolbar.tsx',
  'chapter/components/ChapterStudioMaintenancePanel.tsx',
  'chapter/components/ChapterStudioReadinessDiagnosisPanel.tsx',
  'chapter/components/ChapterStudioVideoReadinessPanel.tsx',
  'chapter/components/ExportScopeModal.tsx',
  'chapter/components/ShotBoundFilesPanel.tsx',
  'chapter/components/ShotProductionWorkspace.tsx',
  'chapter/components/StudioStepProgressStrip.tsx',
  'chapter/components/VideoPromptLlmPanel.tsx',
  'chapter/components/shotReadiness.ts',
  'chapter/components/shotStatusText.ts',
  'chapter/components/useShotRequestPlan.ts',
  'chapter/prep/usePrepFlow.ts',
  ...SHOTS_IN_BATCH_FILES,
]

/** `chapter/**` 的目录结构 —— 每个目录都必须有文件，否则说明遍历被缩窄了。 */
const EXPECTED_DIRS: readonly string[] = ['', 'components', 'prep']

/**
 * 技术详情层的**源码标记**（只出现在 `ChapterStudio.tsx`）。
 *
 * 为什么用标记而不是行号：审计 §8.1 说「`technical` 块所在文件需按行豁免」，
 * 但硬编码行号在任何一次改动后都会失效（本批自己就把行号挪过）。标记是稳定且自解释的。
 */
const TECH_LAYER_START = '>>> 技术详情层开始'
const TECH_LAYER_END = '<<< 技术详情层结束'

const TECH_LAYER_WAIVER_FILE = 'chapter/ChapterStudio.tsx'

/** 全仓唯一的「技术详情」实现（审计 §9 第 2 项：豁免只能给一个文件）。 */
const TECHNICAL_DETAIL_WAIVER = 'project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'

/**
 * §4.3 点名的**开发术语**（比共享词表更严的一层）。
 *
 * 它们不是「内部 ID / 字段名」，而是**开发过程词汇**：用户看不懂，审计 §4.3 逐条点名要换掉。
 * 其中「槽位」「供应商」「生成依据」「最终提示词」「检查中」已在共享基准表里，这里保留是为了
 * 让本区域的失败信息能直接指出是哪一条 §4.3 条目。
 */
const CHAPTER_DEV_TERMS: readonly string[] = [
  '槽位',
  '供应商',
  '契约',
  '降级视图',
  '后端槽位表',
  '接口还没有就绪',
  '演练模式（DRY_RUN）',
  '生成依据',
  '最终提示词',
  '检查中',
]

/** 区域补充的字段名（共享正则里没有、但审计 §4.3 逐条点名的）。 */
const CHAPTER_EXTRA_FIELD_PATTERNS: readonly RegExp[] = [
  /(?<![A-Za-z0-9_])(?:prompt_source|guard_status|guardStatus|target_ratio_source|frame_block_reasons|excluded_reason|provider_notes|video_prompt_source|raw_keys|audio_urls|generate_audio)(?![A-Za-z0-9_])/i,
]

/** 主区文案里不许插值的内部编号（审计 §6.1 任务号口径）。 */
/**
 * 阶段 B 第 3 批收尾（审计 §4.3 模式 4 / §3.4）：**主区禁「地址 / 存储形态」**。
 *
 * 与共享禁词表配套的第二张表 —— 完整 URL、存储形态（`asset://` / `data:`）、
 * 本地存储路径（`/files/...`）、本机 / 内网地址都属于第三层，
 * 只允许出现在默认收起的「技术详情」里。
 */
const MAIN_SCREEN_ADDRESS_PATTERNS: readonly RegExp[] = [
  /https?:\/\//i,
  /asset:\/\//i,
  /data:[a-z]+\//i,
  /\/files\//i,
  /(?<![A-Za-z0-9_])localhost(?![A-Za-z0-9_])/i,
  /127\.0\.0\.1/,
  /192\.168\./,
  /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/,
]

const INTERNAL_ID_INTERPOLATION_RE =
  /\$\{[^}]*\b(?:task_id|service_task_id|source_task_id|provider_task_id|video_task_id|file_id|asset_id|shot_id|chapter_id|project_id)\b[^}]*\}/

const CJK_RE = /[\u4e00-\u9fff]/

/* ------------------------------------------------------------------ 工具 */

function listSourceFiles(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string) => {
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

/** 扫描面：`chapter/**` 非测试源码 + 两个登记在 §4.3 的 `shots/components/` 文件。 */
function scanFiles(): string[] {
  const chapterFiles = listSourceFiles(CHAPTER_ROOT).filter((file) => !/\.test\.tsx?$/.test(file))
  const shotsFiles = SHOTS_IN_BATCH_FILES.map((relPath) => resolve(AISTUDIO_ROOT, relPath))
  return [...chapterFiles, ...shotsFiles].sort()
}

function relAiStudio(file: string): string {
  return relative(AISTUDIO_ROOT, file)
}

function readScan(relPath: string): string {
  return readFileSync(resolve(AISTUDIO_ROOT, relPath), 'utf8')
}

/**
 * 只保留代码（去注释），用于「渲染点有没有接上管道」这类源码级断言。
 *
 * ⚠️ **不能用**「先正则去块注释、再去行注释」的朴素写法：`ChapterStudio.tsx` 里有
 * `accept=".jpg,…,image/*"` 这种**字符串里的块注释起止符**，朴素正则会从那里开始
 * 吞掉后面一大段代码（本批实测：那种实现之后 `已关联场景` 这类代码整段消失，
 * 让「源码级断言」变成假绿）。这里改成**逐行**处理，且只做两件确定安全的事：
 *   1. 丢掉「整行都是注释」的行（`//` / `*` / `/*` / `{/*` 开头，含块注释正文）；
 *   2. 截掉行尾的 `//` 注释，但 `//` 前面是 `:`（`http://`）时不算注释。
 * 这样永远不会跨行吞代码，代价是行尾注释里的词可能残留 —— 本测试的断言模式
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

/* ------------------------------------------------- 技术详情层标记区间（豁免） */

/**
 * 解析源码里 `>>> 技术详情层开始` … `<<< 技术详情层结束` 之间的行号集合。
 *
 * 标记本身所在的行也算进区间（它的注释里写着「技术详情」四个字，但没有禁词）。
 */
export function technicalLayerLines(source: string): Set<number> {
  const lines = source.split('\n')
  const exempt = new Set<number>()
  let depth = 0
  lines.forEach((line, index) => {
    if (line.includes(TECH_LAYER_START)) depth = 1
    if (depth > 0) exempt.add(index + 1)
    if (line.includes(TECH_LAYER_END)) depth = 0
  })
  return exempt
}

/**
 * 去掉 `ChapterStudio.tsx` 里由源码标记圈出的技术详情层区间。
 *
 * 用途：断言「原文/地址只在某个 `TechnicalDetailSection` 里」时，
 * 页面上**既有**的那两块默认收起的技术层（`technical` / `kf_specs`）是合法出口，要排除掉。
 * 必须在 `stripComments` **之前**用（标记写在注释行上）。
 */
function withoutTechnicalLayerRegion(source: string): string {
  const keep: string[] = []
  let depth = 0
  source.split('\n').forEach((line) => {
    if (line.includes(TECH_LAYER_START)) depth = 1
    if (depth === 0) keep.push(line)
    if (line.includes(TECH_LAYER_END)) depth = 0
  })
  return keep.join('\n')
}

/**
 * 钉住「某个原文/地址的渲染表达式**只**出现在指定的技术详情折叠块里」。
 *
 * 为什么两个方向都要断言（审计 §7.1-8）：
 * - 只断言「主区干净」会放过「直接把信息删掉」——用户再也查不到原文；
 * - 只断言「折叠块里有」会放过「同时也在主区铺了一遍」。
 * 所以：块内必须命中，块外必须 0 命中。
 */
function assertRenderedOnlyInsideTechnicalDetail(source: string, token: RegExp, testId: string): void {
  const openTag = `<TechnicalDetailSection testId="${testId}"`
  const start = source.indexOf(openTag)
  assert.ok(start !== -1, `找不到技术详情折叠块 ${testId}（原文/地址的屏幕出口）`)
  const end = source.indexOf('</TechnicalDetailSection>', start)
  assert.ok(end > start, `${testId} 折叠块没有闭合`)
  /* 「由同一个 token 把关的条件表达式」也算第三层的一部分：
     `{原文非空 ? <TechnicalDetailSection …>…` 里的那个条件本身不会把内容渲出来。 */
  const brace = source.lastIndexOf('{', start)
  const guard = brace === -1 ? '' : source.slice(brace, start)
  const guardIsToken = brace !== -1 && new RegExp(`^\\{\\s*${token.source}`).test(guard)
  const boxStart = guardIsToken ? brace : start
  const inside = source.slice(boxStart, end)
  const outside = source.slice(0, boxStart) + source.slice(end)
  assert.ok(token.test(inside), `${testId} 折叠块里没有渲染预期的原文/地址：${token}`)
  const leaked = (outside.match(new RegExp(token.source, 'g')) ?? []).length
  assert.equal(
    leaked,
    0,
    `${token} 在 ${testId} 折叠块之外出现了 ${leaked} 次 —— 原文/地址会铺在主区`,
  )
}

/* --------------------------------------------------------------- 护栏自检 */

test('阶段B③护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGISTERED_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('阶段B③护栏：审计 §4.3 的那一类禁词（槽位 / 供应商 / 枚举原值 / 接口路径 / DRY_RUN）都能被抓到', () => {
  const probe = `
export function Probe() {
  return (
    <div title="供应商 file_id">
      该帧槽位没有文件编号，四类槽位的建议…推荐接口只读不写库
      未通过 · extraction_ready；演练模式（DRY_RUN）未真实出图
      POST /api/v1/studio/image-pipeline/video-submit
      jurilu / manual_workspace / seedance-2.0-mini
      9f3c1a2b-0000-4000-8000-000000000001
    </div>
  )
}
`
  const hits = findMainScreenLeaks(probe)
  const terms = new Set(hits.map((hit) => hit.term))
  const surfaceText = hits.map((hit) => hit.text).join('\n')
  assert.ok(terms.has('槽位'), `「槽位」没被抓到：${JSON.stringify(hits)}`)
  assert.ok(terms.has('供应商'), `「供应商」没被抓到（含 JSX 属性值）：${JSON.stringify(hits)}`)
  assert.ok(terms.has('extraction_ready'), `准备度检查项 code 没被抓到：${JSON.stringify(hits)}`)
  assert.ok(terms.has('DRY_RUN'), `DRY_RUN 没被抓到：${JSON.stringify(hits)}`)
  assert.ok(terms.has('模式4 接口路径/URL/本机地址'), `接口路径没被抓到：${JSON.stringify(hits)}`)
  assert.ok(surfaceText.includes('jurilu') && surfaceText.includes('manual_workspace'), '提示词来源原值没被抓到')
  assert.ok(surfaceText.includes('seedance-2.0-mini'), '模型原名没被抓到')
  assert.ok(terms.has('模式1 UUID'), 'UUID 没被抓到')
  assert.ok(terms.has('模式2 内部字段名'), '内部字段名没被抓到')
})

test('阶段B③护栏：用户拍板放行的业务说法（「待确认候选」这一类）不许被判成泄漏', () => {
  assert.ok(
    scannerNegativeSelfCheck(),
    '「待确认候选」这类业务说法被判成了泄漏 —— 说明「候选」的细分口径退化成整词禁，会造成过度整改',
  )
  assert.ok(
    !MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('候选'),
    '「候选」不应作为整词进禁词表（细分口径：只禁「候选条数 / 聚合 N 组 / 候选状态」这类后端概念）',
  )
  // 本区域实际使用的几个业务说法，必须一个都不判成泄漏
  const allowed = [
    '本集还有 3 项待确认候选；请确认后再继续。',
    '待确认提取到的资产需要逐条确认。',
    '待确认对白的主确认入口在分镜编辑页。',
    '已上传但当前服务取不到这张图。',
    '这条声音这次送不出去：生成服务取不到它。',
    '当前镜头已满足视频生成条件，可以生成。',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findMainScreenLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些业务说法被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('阶段B③护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const files = scanFiles()
  assert.ok(files.length >= 18, `本区域只找到 ${files.length} 个源码文件，目录遍历可能失效了`)
  const counts = files.map((file) => ({ file, count: countScanSurfaces(readFileSync(file, 'utf8')) }))
  const total = counts.reduce((sum, item) => sum + item.count, 0)
  assert.ok(total >= 800, `本区域只提取到 ${total} 个用户可见扫描面，明显偏少（遍历或提取器可能坏了）`)
  const nonEmpty = counts.filter((item) => item.count > 0)
  assert.ok(nonEmpty.length >= 15, `只有 ${nonEmpty.length} 个文件提取到扫描面，可疑`)
  assert.ok(
    counts.some((item) => relAiStudio(item.file) === 'chapter/ChapterStudio.tsx' && item.count >= 500),
    '`ChapterStudio.tsx`（7688 行）的扫描面少于 500 个，提取器或遍历一定坏了',
  )
})

test('阶段B③护栏：JSX 属性值是扫描面的一部分（标题 / 悬停提示收起态也看得见）', () => {
  const surfaces = scanFiles().flatMap((file) => extractScanSurfaces(readFileSync(file, 'utf8')))
  const attrKinds = new Set(surfaces.filter((surface) => surface.kind === 'jsx-attr').map((surface) => surface.attr))
  assert.ok(attrKinds.has('title'), '没提取到 `title` 属性面（悬停即见，§5.5-D 实测的泄漏形态）')
  assert.ok(attrKinds.has('placeholder'), '没提取到 `placeholder` 属性面')
  assert.ok(attrKinds.has('description'), '没提取到 `description` 属性面（Alert 正文在收起态也可见）')
  assert.ok(attrKinds.has('message'), '没提取到 `message` 属性面（Alert 标题）')
  assert.ok(attrKinds.has('label'), '没提取到 `label` 属性面（Descriptions / 折叠标题）')
  // 探针：属性值里的禁词必须能被抓到（否则 §8.1 的「悬停即见」要求就没有落地）
  const probe = readScan('chapter/components/ChapterStudioVideoReadinessPanel.tsx')
  const hits = findMainScreenLeaks(`${probe}\nconst __probe__ = () => <div title="供应商 seedance-2.0-mini">正常</div>\n`)
  assert.ok(
    hits.some((hit) => hit.kind === 'jsx-attr' && hit.term === '供应商'),
    '属性值里的禁词没被扫到',
  )
})

/* ------------------------------------------- ① 主区禁词 0 命中（核心） */

test('ChapterStudio：主区禁词扫描 0 命中（唯一豁免：技术详情层标记区间）', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    const source = readFileSync(file, 'utf8')
    const exempt =
      relPath === TECH_LAYER_WAIVER_FILE ? technicalLayerLines(source) : new Set<number>()
    const hits = findMainScreenLeaks(source).filter((hit) => !exempt.has(hit.line))
    offenders.push(...formatLeakHits(relPath, hits))
  })
  assert.deepEqual(
    offenders,
    [],
    `ChapterStudio 主区出现泄漏（模式 1/2/3/4/5/6 或主区禁词）：\n${offenders.join('\n')}`,
  )
})

test('ChapterStudio：审计 §4.3 点名的开发术语不再出现在任何用户可见文案里', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    const source = readFileSync(file, 'utf8')
    const exempt =
      relPath === TECH_LAYER_WAIVER_FILE ? technicalLayerLines(source) : new Set<number>()
    extractScanSurfaces(source).forEach((surface) => {
      if (exempt.has(surface.line)) return
      CHAPTER_DEV_TERMS.forEach((term) => {
        if (surface.text.includes(term)) {
          offenders.push(`${relPath}:${surface.line} ｜ 命中「${term}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `这些是开发术语，主区不许出现（审计 §4.3 逐条点名）：\n${offenders.join('\n')}`)
})

test('ChapterStudio：审计 §4.3 点名的后端字段名不再出现在任何用户可见文案里', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    const source = readFileSync(file, 'utf8')
    const exempt =
      relPath === TECH_LAYER_WAIVER_FILE ? technicalLayerLines(source) : new Set<number>()
    extractScanSurfaces(source).forEach((surface) => {
      if (exempt.has(surface.line)) return
      CHAPTER_EXTRA_FIELD_PATTERNS.forEach((pattern) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ 命中「${pattern.source}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `这些字段名只允许出现在默认收起的「技术详情」里：\n${offenders.join('\n')}`)
})

test('§6.1 任务号 / 内部编号口径：含中文的主区文案里不许插值内部编号（技术详情层除外）', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    // 用**原始源码**逐行匹配：`stripComments` 会删行、破坏行号与豁免区间的对应关系
    const source = readFileSync(file, 'utf8')
    const exempt =
      relPath === TECH_LAYER_WAIVER_FILE ? technicalLayerLines(source) : new Set<number>()
    source.split('\n').forEach((line, index) => {
      if (exempt.has(index + 1)) return
      // 纯注释行不是用户可见文案
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return
      ;(line.match(/`(?:\\.|[^`\\])*`/g) ?? []).forEach((text) => {
        if (!CJK_RE.test(text)) return
        if (!INTERNAL_ID_INTERPOLATION_RE.test(text)) return
        /* `${row.file_id ? '文件已就绪' : '（无文件）'}` 这种**三元条件式**不会把编号打出来
           （`file_id` 只当条件用），只判真正会渲出值的插值。 */
        const printed = (text.match(/\$\{[^}]*\}/g) ?? []).filter(
          (slot) => !slot.includes('?') && INTERNAL_ID_INTERPOLATION_RE.test(slot),
        )
        if (printed.length) {
          offenders.push(`${relPath}:${index + 1} ｜ ${printed.join(' ')} ｜ ${text.trim().slice(0, 120)}`)
        }
      })
    })
  })
  assert.deepEqual(
    offenders,
    [],
    `这些用户可见文案把内部编号插了进来（§6.1：一律进技术详情）：\n${offenders.join('\n')}`,
  )
})

/* --------------------------------------------- ② 渲染点口径（扫描器看不见的那类） */

test('视频准备度面板：不许回显 `check.key`，未登记项整行隐藏（§4.3 模式 3 / R7）', () => {
  const source = stripComments(readScan('chapter/components/ChapterStudioVideoReadinessPanel.tsx'))
  assert.ok(
    source.includes('videoReadinessCheckLabel('),
    '必须用 `videoReadinessCheckLabel` 做映射（未登记项返回 null）',
  )
  assert.ok(
    /\.filter\(\(check\) => videoReadinessCheckLabel\(check\.key\) !== null\)/.test(source),
    '未登记的检查项必须被**过滤掉**（隐藏整行），而不是回显 `check.key`',
  )
  /* `key={check.key}` 是 React 的 key，**不上屏**，不算泄漏；真正的泄漏是把 key 当文案渲出来。
     所以逐行判定：凡是出现 `check.key` 的行，只允许是 React key 或映射函数入参。 */
  const suspicious = source
    .split('\n')
    .filter((line) => line.includes('check.key'))
    .filter(
      (line) =>
        !/key=\{check\.key\}/.test(line) &&
        !/videoReadinessCheckLabel\(check\.key\)/.test(line),
    )
  assert.deepEqual(
    suspicious,
    [],
    '面板里把 `check.key` 当文案渲染出来了 —— 运行时形态就是整排 `未通过 · extraction_ready`',
  )
  assert.ok(!/title=\{check\.key\}/.test(source), 'Tooltip 的 title 也不能直接打 `check.key`')
  // 纯函数级：映射表必须覆盖后端 7 个 `_check`，且未登记项给的是 null（不是原值）
  assert.equal(VIDEO_READINESS_CHECK.values.length, 7)
  assert.equal(labelFor(VIDEO_READINESS_CHECK, 'extraction_ready'), '已提取分镜')
  assert.equal(labelFor(VIDEO_READINESS_CHECK, 'some_future_check'), '其它前置条件')
})

test('视频准备度面板：参考模式不许回显 `text_only`（§4.3 模式 3 / R8）', () => {
  const source = stripComments(readScan('chapter/components/ChapterStudioVideoReadinessPanel.tsx'))
  assert.ok(
    /labelFor\(REFERENCE_MODE,\s*videoReferenceMode\)/.test(source),
    '参考模式必须过 `labelFor(REFERENCE_MODE, …)`，不许原样打 `{videoReferenceMode}`',
  )
  assert.ok(!/\{videoReferenceMode\}/.test(source), '仍然原样渲染 `videoReferenceMode`')
  assert.equal(labelFor(REFERENCE_MODE, 'text_only'), '纯文本（不用参考帧）')
  assert.notEqual(labelFor(REFERENCE_MODE, 'text_only'), 'text_only')
  assert.equal(labelFor(REFERENCE_MODE, 'brand_new_mode'), '未识别的参考方式')
})

test('帧类型映射：未登记帧类型不许回显原值（§4.3 模式 3 / R10）', () => {
  assert.equal(frameTypeLabel('first'), '首帧')
  assert.equal(frameTypeLabel('mid'), '中间帧')
  assert.equal(frameTypeLabel('last'), '尾帧')
  const unknown = frameTypeLabel('brand_new_frame_type')
  assert.ok(CJK_RE.test(unknown), `未登记帧类型的兜底必须含中文，实际「${unknown}」`)
  assert.ok(!unknown.includes('brand_new_frame_type'), `未登记帧类型被原样回显：${unknown}`)
  assert.ok(!/\$\{key\} 帧/.test(stripComments(readScan('chapter/components/shotStatusText.ts'))))
})

test('准备度文案：缺失 / 取不到的帧类型都过映射，后端原因只进技术详情（§4.3 模式 3/4/5/6）', () => {
  const source = stripComments(readScan('chapter/components/shotReadiness.ts'))
  assert.ok(
    !/absentFrames\.join\('、'\)/.test(source),
    '`absentFrames.join` 会打出 `first` 这类帧类型原值 —— 必须过 `frameTypeLabel`',
  )
  assert.ok(/absentFrames\.map\(frameTypeLabel\)/.test(source), '缺少帧的类型必须过 `frameTypeLabel`')
  assert.ok(/blockedFrames\.map\(frameTypeLabel\)/.test(source), '取不到的帧的类型必须过 `frameTypeLabel`')
  assert.ok(
    !source.includes('供应商'),
    '「参考帧已上传但供应商无法访问」是主区禁词（§4.3 模式 5），必须改业务说法',
  )
  /* 第 3 批收尾：旧断言只要求「过三级管道」，但 `toUserFacingText` 不会去掉地址 ——
     后端 `reference_preflight` 的本机 / 内网原因里**带 host**（`192.168.1.9`），
     相对路径那条会写 `/files/...`。所以断言改成更强的一对：
     ①主区不再拼「后端句子的改写结果」；②后端原文必须走 `technicalDetails`（技术详情层）。 */
  assert.ok(
    !/missing\.push\(toUserFacingText\(reason/.test(source),
    '主区仍在把后端原因过管道后直接拼进 `missing`（那是后端文本，且可能带地址）',
  )
  assert.ok(
    /describeFrameBlockReason\(reason\)/.test(source),
    '帧不可用原因必须先过 `describeFrameBlockReason`（分类成产品自己写的中文结论）',
  )
  assert.ok(
    /technicalDetails\.push\(described\.technicalDetail\)/.test(source),
    '后端原因原文必须进 `technicalDetails`（默认收起的「技术详情」层）',
  )
  // 纯函数级：本机 / 内网原因的主区结论不含地址，原句只在技术详情里
  const local = describeFrameBlockReason('参考图指向本机 / 内网地址（192.168.1.9），只有这台机器能打开，上游取不到。')
  assert.ok(!/192\.168\./.test(local.mainText), `主区结论里还有地址：${local.mainText}`)
  assert.ok(!/https?:\/\//.test(local.mainText), `主区结论里还有 URL：${local.mainText}`)
  assert.match(local.technicalDetail, /192\.168\.1\.9/)
  const relative = describeFrameBlockReason('参考图是本机 / 项目内相对路径（公网匿名访问取不到），这正是「本机可读、上游 404」的成因。')
  assert.ok(!/\/files\/|相对路径原文/.test(relative.mainText), `主区结论里还有存储形态：${relative.mainText}`)
  assert.ok(CJK_RE.test(local.mainText), '主区结论必须是中文')
  // 反向断言：认不出来的原因也要给产品自己的中文兜底（不回显后端原句）
  const unknown = describeFrameBlockReason('上游返回了一个没见过的原因')
  assert.equal(unknown.mainText, FRAME_BLOCK_FALLBACK_TEXT)
  assert.ok(!unknown.mainText.includes('上游返回了一个没见过的原因'))
  // 空原因不产生任何主区噪音
  assert.deepEqual(describeFrameBlockReason(''), { mainText: '', technicalDetail: '' })
})

test('守卫状态 / 提示词来源 / 画幅来源必须过映射，不许原值上屏（§4.3 模式 3 同族）', () => {
  const source = stripComments(readScan('chapter/ChapterStudio.tsx'))
  // guard_status
  assert.ok(
    !/\$\{requestPlan\.plan\.guard_status\}/.test(source),
    '主区还在直渲 `requestPlan.plan.guard_status`（自由文本，可能带 DRY_RUN=… / 环境变量名）',
  )
  assert.ok(/describeGuardStatus\(/.test(source), '`guard_status` 必须过 `describeGuardStatus`')
  // prompt_source
  assert.ok(
    !/\{requestPlan\.plan\.prompt_source \|\| '—'\}/.test(source),
    '主区还在直渲 `prompt_source`（`jurilu` / `manual_workspace` 会原样上屏）',
  )
  assert.ok(
    /videoPromptSourceLabel\(requestPlan\.plan\.prompt_source\)/.test(source),
    '`prompt_source` 必须过 `videoPromptSourceLabel`',
  )
  // target_ratio_source
  assert.ok(
    /labelFor\(TARGET_RATIO_SOURCE,\s*keyframePlanPreview\.target_ratio_source\)/.test(source),
    '`target_ratio_source` 必须过 `labelFor(TARGET_RATIO_SOURCE, …)`',
  )
  assert.ok(!/\$\{keyframePlanPreview\.target_ratio_source\}/.test(source), '仍在直渲 `target_ratio_source`')
  // provider / model_name：主区只出业务名
  assert.ok(!/\{`供应商：/.test(source), '主区还在打「供应商：…」标签（§6.2 口径：从主区移除）')
  assert.ok(/videoModelBusinessName\(/.test(source), '模型必须过 `videoModelBusinessName` 业务化')
  assert.ok(
    !/\$\{keyframePlanPreview\.provider/.test(source),
    '主区还在插值原始 `provider`（§6.2：原始 provider 只进技术详情）',
  )
})

test('同一字段同口径：已保存提示词来源在「① 工作区」与弹窗里都走同一份映射（§4.3 模式 3）', () => {
  const source = stripComments(readScan('chapter/ChapterStudio.tsx'))
  const offenders = (source.match(/来源：\$\{[^}]*\}/g) ?? []).filter(
    (text) => !text.includes('videoPromptSourceLabel('),
  )
  assert.deepEqual(
    offenders,
    [],
    '这些「来源：…」没走 videoPromptSourceLabel（同一字段在两处口径不一致）：' + offenders.join(' / '),
  )
  const mapped = source.match(/来源：\$\{videoPromptSourceLabel\(/g) ?? []
  assert.ok(
    mapped.length >= 2,
    `只有 ${mapped.length} 处「来源：…」接了映射 —— 工作区 ① 与提示词预览弹窗必须都接（审计点名 :6366 与 :7465）`,
  )
  // 纯函数级：来源码与模型原名一个都不许回显
  assert.equal(videoPromptSourceLabel('jurilu'), '巨日禄导入')
  assert.equal(videoPromptSourceLabel('manual_workspace'), '人工编辑')
  const unknownSource = videoPromptSourceLabel('brand_new_source')
  assert.ok(CJK_RE.test(unknownSource), `未登记来源码的兜底必须含中文：${unknownSource}`)
  assert.ok(!unknownSource.includes('brand_new_source'), `未登记来源码被原样回显：${unknownSource}`)
  assert.equal(videoPromptSourceLabel(''), '', '空来源返回空串，调用方用自己的「未标记」兜底')
})

test('R13：掩码后不许残留「槽位」「接口」这类中文内部词汇（§4.3 模式 2 第 5 条）', () => {
  // 后端原句（运行时实测形态）
  const raw = '该帧槽位没有 file_id：请先上传或生成该帧。四类槽位的建议…推荐接口只读不写库。'
  const masked = maskInternalIds(raw)
  assert.equal(masked.includes('槽位'), false, '掩码后仍残留「槽位」—— 审计 R13 的原样复现')
  assert.equal(masked.includes('接口'), false, '掩码后仍残留「接口」—— 审计 R13 的原样复现')
  // 完整管道（掩码 → 洗句 → 业务化改写）之后必须是中文结论，且不含内部 ID
  const facing = toUserFacingText(raw, '这一帧还没有文件：请先上传或生成该帧')
  assert.equal(facing.includes('槽位'), false, `管道出口仍含「槽位」：${facing}`)
  assert.equal(facing.includes('接口'), false, `管道出口仍含「接口」：${facing}`)
  assert.equal(facing.includes('file_id'), false, `管道出口仍含 file_id：${facing}`)
  assert.ok(CJK_RE.test(facing), `管道出口不是中文：${facing}`)
  // 反向断言：干净的文案不许被改动（防过度屏蔽）
  assert.equal(maskInternalIds('本镜已具备生成条件：提示词与参考帧齐全'), '本镜已具备生成条件：提示词与参考帧齐全')
})

test('模式 2 补充：主区不留英文内部术语（Guidance / PromptFlowPage）与后端表名（悬停即见也算）', () => {
  // 只判「用户可见文本面」：`guidanceLevelSummary` 这类**代码标识符**不是文案
  const surfaces = extractScanSurfaces(readScan('chapter/ChapterStudio.tsx'))
  const banned = ['Guidance', 'PromptFlowPage', 'shot_frame_images', 'shot_details']
  const offenders = surfaces
    .filter((surface) => banned.some((term) => surface.text.includes(term)))
    .map((surface) => `:${surface.line} ${surface.text.trim().slice(0, 80)}`)
  assert.deepEqual(
    offenders,
    [],
    `主区文案里还有内部术语 / 后端标识（审计 §2.3 模式 2、§5.5-D「悬停即见」）：\n${offenders.join('\n')}`,
  )
  // 悬停即见的 Tooltip 也要干净（§5.5-D：`title` 里的地址悬停就看得见，字段名同理）
  const tooltips = surfaces.filter((surface) => surface.kind === 'jsx-attr' && surface.attr === 'title')
  const dirtyTooltips = tooltips
    .filter((surface) => /[a-z]+_[a-z]+/.test(surface.text))
    .map((surface) => `:${surface.line} ${surface.text.trim().slice(0, 80)}`)
  assert.deepEqual(dirtyTooltips, [], `这些悬停提示里含后端字段/表名：\n${dirtyTooltips.join('\n')}`)
})

test('模式 1 回落：参考图 / 场景 / 角色名称读取失败时一律给中文兜底（§4.3 模式 1 第 2-4 条）', () => {
  const source = stripComments(readScan('chapter/ChapterStudio.tsx'))
  const offenders = [
    [/shotLinkedAssetNameByFileId\.get\(fid\) \?\? fid/, '`?? fid` 会把 file_id 端上正文与悬停 title'],
    [/sceneNameMap\[linkedSceneId\] \?\? linkedSceneId/, '`?? linkedSceneId` 会把场景内部 ID 端上屏'],
    [/characterNameMap\[cid\] \?\? cid/, '`?? cid` 会把角色内部 ID 端上屏'],
  ]
    .filter(([pattern]) => (pattern as RegExp).test(source))
    .map(([, reason]) => reason as string)
  assert.deepEqual(offenders, [], `这些回落会把内部编号端上主区（§4.3 模式 1）：\n${offenders.join('\n')}`)
  assert.ok(
    /shotLinkedAssetNameByFileId\.get\(fid\) \?\? '（未命名参考图）'/.test(source),
    '参考图名读取失败要给中文兜底',
  )
  assert.ok(
    /title=\{shotLinkedAssetNameByFileId\.get\(fid\) \?\? '（未命名参考图）'\}/.test(source),
    '悬停 title 与正文必须同口径（标题也是主区）',
  )
  assert.ok(source.includes('（场景名称读取失败）'), '场景名读取失败要给中文兜底')
  assert.ok(source.includes('（角色名称读取失败）'), '角色名读取失败要给中文兜底')
})

test('ShotBoundFilesPanel：资产名 / 声音名 / 槽位都不许用内部编号兜底（§4.3 模式 1）', () => {
  const source = stripComments(readScan('chapter/components/ShotBoundFilesPanel.tsx'))
  assert.ok(!/row\.asset_name \|\| row\.asset_id/.test(source), '`{row.asset_name || row.asset_id}` 会把内部编号端上主区')
  assert.ok(!/audioRow\.asset_name \|\| audioRow\.asset_id/.test(source), '声音行同理')
  assert.ok(!/row\.slot_label \|\| row\.slot/.test(source), '`|| row.slot` 的兜底会是 `characters` / `scene` 这类原值')
  assert.ok(source.includes('（资产名称读取失败）'), '资产名读取失败要给中文兜底')
  assert.ok(source.includes('（声音名称读取失败）'), '声音名读取失败要给中文兜底')
  // 同一文件两条错误路径口径必须一致：都过三级管道
  const toUserFacingCount = (source.match(/toUserFacingText\(/g) ?? []).length
  assert.ok(toUserFacingCount >= 2, `ShotBoundFilesPanel 只有 ${toUserFacingCount} 处管道出口，两条错误路径要一致`)
  assert.ok(!/err instanceof Error \? err\.message/.test(source), '仍然直传 `err.message`（模式 6）')
})

test('声音绑定区块：长段落与状态文案都不含禁词，后端原文出口接了管道（§4.3 模式 4/5/6 + R11/R12）', () => {
  const section = stripComments(readScan('shots/components/ShotAudioBindingSection.tsx'))
  const core = stripComments(readScan('shots/components/audioAdmissionCore.ts'))
  assert.ok(!section.includes('seedance'), '主区长段落还在写模型名 `seedance`')
  assert.ok(!section.includes('audio_urls'), '主区长段落还在写接口字段 `audio_urls`')
  assert.ok(!section.includes('SIX_STEP_ACCEPTANCE'), '主区长段落还在写仓库文件名')
  assert.ok(!section.includes('asset://'), '主区长段落还在写存储形态 `asset://`')
  assert.ok(!section.includes('/files/'), '主区长段落还在写存储路径 `/files/...`')
  assert.ok(!section.includes('type=audio'), '素材库弹窗还在写后端字段形态 `type=audio`')
  assert.ok(!section.includes('files.type=audio'), '空态文案还在写后端字段 `files.type=audio`')

  // R12：纯文本渲染的常量里不许留 markdown 星号（会字面显示成星号）
  assert.ok(!core.includes('**'), '`audioAdmissionCore.ts` 的用户可见常量里还有 markdown `**`（R12 字面显示星号）')

  // 模式 6：后端原文出口必须过管道，且标题用单一常量
  assert.ok(/AUDIO_NOT_REACHABLE_TITLE/.test(core), '「取不到」的标题必须只有一个定义（单一定义）')
  assert.ok(!core.includes("'已绑定，但供应商无法访问'"), '标题里仍有主区禁词「供应商」')
  /* 第 3 批收尾（审计 §4.3 模式 4 / §7.1-6）：旧断言只要求 `excluded_reason` 过三级管道，
     但后端那句话里**带地址**（`…是本地/相对地址（/files/files/voice.mp3）：供应商抓不到。`），
     管道只掩内部 ID、不会去掉 `/files/...`。断言改成更强的一对：
     ①主区只用产品自己写的中文结论（按原因码分类）；②原文（掩码后）只进 `technicalDetail`。 */
  assert.ok(
    !/detail: text\(audit\.excluded_reason\)/.test(core),
    '主区仍在放后端 `excluded_reason` 的改写结果（它带地址）',
  )
  assert.ok(
    /detail: EXCLUDED_MAIN_TEXT\[reasonCode\] \|\| EXCLUDED_MAIN_FALLBACK/.test(core),
    '主区的「取不到」结论必须来自产品自己的文案表（EXCLUDED_MAIN_TEXT）',
  )
  assert.ok(
    /technicalDetail: technicalDetailOf\(\[rawNote\(audit\.excluded_reason\), rawNote\(audit\.how_to_fix\)\]\)/.test(core),
    '后端 `excluded_reason` / `how_to_fix` 原文必须进技术详情层（`technicalDetail`）',
  )
  // 主区出口（**用户可见扫描面**，不是整份源码）里不许出现地址 / 存储形态：
  // 用扫描面而不是 raw source，是因为文件里合法地写着 `127\.0\.0\.1` 这类**正则字面量**
  // （`PRIVATE_HOST_RE`）—— 它不是用户可见文案。
  const coreAddressOffenders = extractScanSurfaces(readScan('shots/components/audioAdmissionCore.ts'))
    .filter((surface) => MAIN_SCREEN_ADDRESS_PATTERNS.some((pattern) => pattern.test(surface.text)))
    .map((surface) => `:${surface.line} ${surface.text.trim().slice(0, 100)}`)
  assert.deepEqual(
    coreAddressOffenders,
    [],
    `audioAdmissionCore.ts 的用户可见文案里出现了地址 / 存储形态：\n${coreAddressOffenders.join('\n')}`,
  )
  assert.ok(
    /showUserError\(/.test(section),
    '`ShotAudioBindingSection.tsx` 的错误出口必须走统一 message 包装层',
  )
  assert.ok(!/\(e as Error\)\?\.message/.test(section), '仍然直传 `(e as Error)?.message`（模式 6）')
})

/* --------------------------------- 第 3 批收尾（任务 A / B / C）：地址与成对文案 */

test('任务A/C：主区禁「地址 / 存储形态」扫描 —— chapter/** + audioAdmissionCore.ts 0 命中', () => {
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    const source = readFileSync(file, 'utf8')
    const exempt = relPath === TECH_LAYER_WAIVER_FILE ? technicalLayerLines(source) : new Set<number>()
    extractScanSurfaces(source).forEach((surface) => {
      if (exempt.has(surface.line)) return
      MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ 命中 ${pattern} ｜ ${surface.text.trim().slice(0, 120)}`)
        }
      })
    })
  })
  assert.deepEqual(
    offenders,
    [],
    `主区出现了地址 / 存储形态（审计 §4.3 模式 4：一律进默认收起的「技术详情」）：\n${offenders.join('\n')}`,
  )
  // 空转自检：这张表必须真的能抓到东西（否则「0 命中」毫无意义）
  const probe = 'const __probe__ = () => <div>本次请求携带的地址：asset://project-1/voice-asset-1（http://127.0.0.1:8000/files/a.mp3）</div>'
  assert.ok(
    MAIN_SCREEN_ADDRESS_PATTERNS.some((pattern) => pattern.test(probe)),
    '地址词表失效了：探针里的 asset:// 与 127.0.0.1 都没被判成命中',
  )
})

test('任务A：音频准入的地址只进技术详情层，主区一个地址都不许有（§4.3 模式 4 / §3.4）', () => {
  const cases: Array<{ label: string; audit: Parameters<typeof describeAudioAdmission>[0] }> = [
    { label: '携带（公网）', audit: { included: true, state: 'public_url', url: 'https://cdn.example.com/a.mp3' } },
    { label: '携带（素材引用）', audit: { included: true, state: 'asset_ref', url: 'asset://project-1/voice-asset-1' } },
    { label: '携带（内嵌）', audit: { included: true, state: 'data_url_inline', url: 'data:audio/mpeg;base64,AAAA' } },
    {
      label: '取不到（本机路径）',
      audit: {
        included: false,
        file_id: 'f-1',
        state: 'local_path',
        reason_code: 'local_path',
        excluded_reason: '已绑定声音，但它解析出的是本地/相对地址（/files/files/voice.mp3）：供应商抓不到。',
        how_to_fix: '把音频上传到公网（OSS 等）后重新绑定。',
      },
    },
    { label: '未绑定', audit: { included: false, file_id: '', state: 'not_bound', reason_code: 'not_bound' } },
  ]
  const offenders: string[] = []
  cases.forEach(({ label, audit }) => {
    const view = describeAudioAdmission(audit)
    const mainSurface = [view.tag, view.title, view.detail, view.fix, view.terminology].join('｜')
    MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
      if (pattern.test(mainSurface)) offenders.push(`${label}：主区命中 ${pattern} → ${mainSurface}`)
    })
  })
  assert.deepEqual(offenders, [], `音频准入的主区仍有地址：\n${offenders.join('\n')}`)
  // 地址确实落在技术详情层（asset:// 与本地路径两种形态都要有）
  assert.match(
    describeAudioAdmission({ included: true, state: 'asset_ref', url: 'asset://project-1/voice-asset-1' }).technicalDetail,
    /asset:\/\/project-1\/voice-asset-1/,
  )
  assert.match(
    describeAudioAdmission({ included: false, file_id: 'f-1', state: 'local_path', reason_code: 'local_path', excluded_reason: '本地/相对地址（/files/files/voice.mp3）' })
      .technicalDetail,
    /\/files\/files\/voice\.mp3/,
  )
  // 主区结论仍是**产品自己写的中文**（不是后端句子的改写结果）
  const blocked = describeAudioAdmission({
    included: false,
    file_id: 'f-1',
    state: 'local_path',
    reason_code: 'local_path',
    excluded_reason: '已绑定声音，但它解析出的是本地/相对地址（/files/files/voice.mp3）：供应商抓不到。',
  })
  assert.equal(blocked.title, AUDIO_NOT_REACHABLE_TITLE)
  assert.match(blocked.detail, /本机或只是相对路径/)
  assert.ok(!blocked.detail.includes('抓不到'), '主区结论不能是后端句子的改写结果')
})

test('任务B(a)：provider_notes 原文在屏幕上有出口 —— 只在默认收起的折叠块里（§7.1-6）', () => {
  const raw = readScan('chapter/ChapterStudio.tsx')
  const source = stripComments(withoutTechnicalLayerRegion(raw))
  // 主区：不再把后端原话过管道当主区文案（走 showUserConclusion 给产品结论）
  assert.ok(!/showUserWarning\(notes\[0\]/.test(source), 'provider_notes 仍在把后端原话当主区文案')
  assert.ok(/showUserConclusion\(/.test(source), 'provider_notes 的主区必须是产品自己写的中文结论')
  // 原文必须有**屏幕出口**（不是只写内存日志）：存储 + 渲染 + 掩码，三件都在
  assert.ok(
    /lastProviderNotes: result\.provider_notes \?\? \[\]/.test(source),
    '生成结果必须把 provider_notes 存进卡片状态（否则折叠块没有数据可渲）',
  )
  assertRenderedOnlyInsideTechnicalDetail(
    source,
    /st\.lastProviderNotes\.map\([\s\S]{0,160}?maskInternalIds\(String\(note\)\)/,
    'keyframe-provider-note-detail',
  )
})

test('任务B(b)：⑥ 生成视频的 plan.warnings 原文只在默认收起的折叠块里（§7.1-6）', () => {
  const raw = readScan('chapter/ChapterStudio.tsx')
  const source = stripComments(withoutTechnicalLayerRegion(raw))
  // 主区：产品自己写的中文结论（带条数），不再逐条渲染后端文本
  assert.ok(/这次提交计划有 \$\{requestPlan\.plan\.warnings\.length\} 条需要注意的地方/.test(source), '主区缺少产品结论')
  assert.ok(
    !/requestPlan\.plan\.warnings\.slice\(0, 4\)/.test(source),
    '主区还在逐条渲染后端 warnings',
  )
  assertRenderedOnlyInsideTechnicalDetail(
    source,
    /requestPlan\.plan\.warnings\.map\([\s\S]{0,160}?maskInternalIds\(warning\)/,
    'video-plan-warning-detail',
  )
})

test('任务B(c)：绑定区地址的屏幕出口就是那个折叠块（主区无地址 + 折叠层有地址）', () => {
  const source = stripComments(readScan('shots/components/ShotAudioBindingSection.tsx'))
  assertRenderedOnlyInsideTechnicalDetail(
    source,
    /admission\.technicalDetail/,
    'audio-admission-technical-detail',
  )
  // 反向：纯函数级确认「有地址时折叠层真的有地址」（防「什么都没渲染」的假绿）
  const view = describeAudioAdmission({
    included: true,
    state: 'asset_ref',
    url: 'asset://project-1/voice-asset-1',
  })
  assert.match(view.technicalDetail, /asset:\/\/project-1\/voice-asset-1/)
  MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
    assert.ok(
      !pattern.test([view.tag, view.title, view.detail, view.fix, view.terminology].join('｜')),
      `主区出现了地址 / 存储形态：${pattern}`,
    )
  })
})

test('任务B(d)：`ShotReadiness.missing` / `technicalDetails` 的「无渲染点」登记在源码里', () => {
  // 这句登记写在 /** */ 注释里 → 必须用**原始源码**（`stripComments` 会丢掉块注释正文）
  const source = readScan('chapter/components/shotReadiness.ts')
  assert.ok(
    /technicalDetails: string\[\]/.test(source),
    '`technicalDetails`（后端原文的技术详情出口）必须保留在结果类型里',
  )
  assert.ok(
    /本字段当前没有渲染点/.test(source),
    '必须在字段旁写明「当前无渲染点；将来谁渲染 missing，请一并渲染 technicalDetails」',
  )
})

test('任务A：音频地址在绑定区有渲染点，且只落在默认收起的「技术详情」折叠壳里（§4.3 模式 4）', () => {
  const section = stripComments(readScan('shots/components/ShotAudioBindingSection.tsx'))
  // 主区两处只用 `describeAudioAdmission` 的产品结论（detail / fix / tag / title）
  assert.ok(/\{admission\.detail\}/.test(section), '主区必须显示中文结论（admission.detail）')
  assert.ok(/admission\.fix/.test(section), '主区必须显示「怎么修」（admission.fix）')
  /* 具体地址必须有落点，且**所有**引用都落在统一折叠壳里。
     判定方式：从「折叠壳的条件表达式」到「盒尾」这一段之外，不许再出现任何
     `admission.technicalDetail` —— 那才是"地址被铺在主区"。 */
  const boxStart = section.indexOf('<TechnicalDetailSection')
  const boxEnd = section.indexOf('</TechnicalDetailSection>')
  assert.ok(boxStart !== -1 && boxEnd > boxStart, '绑定区没有用统一的技术详情折叠壳')
  const condStart = section.lastIndexOf('{admission.technicalDetail', boxStart)
  assert.ok(condStart !== -1, '地址折叠块必须由 admission.technicalDetail 控制显隐')
  const outsideBox = section.slice(0, condStart) + section.slice(boxEnd + '</TechnicalDetailSection>'.length)
  assert.deepEqual(
    outsideBox.match(/admission\.technicalDetail/g) ?? [],
    [],
    '主区还有地方在渲染 admission.technicalDetail（地址会直接铺在主区）',
  )
  assert.ok(
    /import \{ TechnicalDetailSection \} from '\.\.\/\.\.\/project\/ProjectWorkbench\/components\/workbench\/TechnicalDetailCollapse'/.test(section),
    '必须从全仓唯一的 TechnicalDetailCollapse 导入折叠壳（不许自建第二套）',
  )
  assert.ok(
    /testId="audio-admission-technical-detail"/.test(section),
    '地址折叠块要有可定位的 testId（便于验收与排障）',
  )
  // 折叠块的 hint（收起态可见）必须干净：不给地址、不给存储形态、不给禁词
  const hint = /hint="([^"]+)"/.exec(section)
  assert.ok(hint, '地址折叠块必须有收起态可见的说明')
  MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
    assert.ok(!pattern.test(hint[1]), `折叠块 hint 里出现了地址 / 存储形态：${hint[1]}`)
  })
  assert.ok(CJK_RE.test(hint[1]), `折叠块 hint 必须是中文：${hint[1]}`)
})

test('任务B：三处成对文案 —— 主区是产品自己写的中文结论，后端原文进技术详情层', () => {
  const source = stripComments(readScan('chapter/ChapterStudio.tsx'))
  // ① `provider_notes` 出口：不再走「后端句子过管道」的 showUserWarning
  assert.ok(
    !/showUserWarning\(notes\[0\]/.test(source),
    '`provider_notes` 仍在把后端原话过管道后当主区文案（应改用 showUserConclusion）',
  )
  assert.ok(/showUserConclusion\(/.test(source), '`provider_notes` 出口必须给产品自己写的中文结论')
  assert.ok(/notes\.join\('\\n'\)/.test(source), '后端原话必须原样喂给技术详情层（不是丢弃）')
  // ② 关键帧提交计划的 warnings：主区不再逐条渲染后端文本
  assert.ok(
    !/keyframePlanPreview\.warnings\.slice\(0, 4\)/.test(source),
    '关键帧提交计划的 warnings 仍在主区逐条渲染后端文本（旧实现还只显示前 4 条）',
  )
  assert.ok(
    /<TechnicalDetailSection testId="keyframe-plan-warning-detail"[\s\S]{0,400}?maskInternalIds\(String\(item\)\)/.test(source),
    '关键帧提交计划的 warnings 原文必须掩码后进技术详情折叠壳',
  )
  assert.ok(
    /<TechnicalDetailSection testId="video-pinned-plan-warning-detail"[\s\S]{0,400}?maskInternalIds\(item\)/.test(source),
    '视频直提计划的 warnings 原文必须掩码后进技术详情折叠壳',
  )
  // ⑥ 生成视频里的「补充说明」是同一族 `plan.warnings`：实机走查抓到过一句英文后端原文，
  // 所以这条出口也必须换成产品自己的中文结论（原文已在 technical 块的「后端原始提示」里）
  assert.ok(
    !/requestPlan\.plan\.warnings\.slice\(0, 4\)/.test(source),
    '⑥ 生成视频的 warnings 仍在主区逐条渲染后端文本',
  )
  assert.ok(
    /这次提交计划有 \$\{requestPlan\.plan\.warnings\.length\} 条需要注意的地方/.test(source),
    '⑥ 生成视频的 warnings 必须给产品自己写的中文结论',
  )
  // 两处 warnings 的主区都要有「产品自己写的中文结论」（不再由后端句子派生）
  assert.ok(
    /这次的提交计划有 \$\{keyframePlanPreview\.warnings\.length\} 条需要注意的地方/.test(source),
    '关键帧提交计划的主区必须给一句产品自己写的中文结论（带条数）',
  )
  assert.ok(
    /这次的提交计划有 \$\{videoPinnedPlan\.warnings\.length\} 条需要注意的地方/.test(source),
    '视频直提计划的主区必须给一句产品自己写的中文结论（带条数）',
  )
  // ③ 两处 warnings 都必须收进**复用**的技术详情折叠壳（不是自建 details）
  const technicalDetailUses = source.match(/<TechnicalDetailSection/g) ?? []
  assert.ok(
    technicalDetailUses.length >= 3,
    `ChapterStudio 只用了 ${technicalDetailUses.length} 处统一折叠壳（帧原因 / 关键帧计划 / 视频计划至少要 3 处）`,
  )
  assert.ok(
    /import \{ TechnicalDetailSection \} from '\.\.\/project\/ProjectWorkbench\/components\/workbench\/TechnicalDetailCollapse'/.test(source),
    '必须从全仓唯一的 TechnicalDetailCollapse 导入折叠壳',
  )
  // 主区的两句产品结论必须是中文，且不含地址
  const mainCopy = [
    '生成服务对这次结果有额外说明（可能没有按你选的参考图出图）。建议先核对再采用；原始说明见「技术详情」。',
  ]
  mainCopy.forEach((text) => {
    assert.ok(CJK_RE.test(text), `主区结论必须是中文：${text}`)
    MAIN_SCREEN_ADDRESS_PATTERNS.forEach((pattern) => {
      assert.ok(!pattern.test(text), `主区结论里出现地址 / 存储形态：${text}`)
    })
  })
})

test('任务B：showUserConclusion 主区只收到产品结论，后端原文只进技术详情日志', async () => {
  const emitted: Array<{ kind: string; title: string }> = []
  clearTechnicalDetails()
  setUserMessageNotifier((kind, title) => {
    emitted.push({ kind, title })
  })
  try {
    const conclusion = '生成服务对这次结果有额外说明（可能没有按你选的参考图出图）。建议先核对再采用；原始说明见「技术详情」。'
    // 后端原话是「脏」的：含 DRY_RUN= / file_id / UUID —— 过通用管道会被整句丢弃
    const raw = 'DRY_RUN=1 file_id=1ebace78-b083-49fe-a86b-d17c524e501d 参考图未透传，回退使用了非 OSS 地址。'
    const result = await showUserConclusion('warning', conclusion, raw, '生成关键帧')
    assert.equal(emitted.length, 1, '主区 must 只弹一条提示')
    assert.equal(emitted[0].title, conclusion, '主区必须收到产品自己写的中文结论')
    assert.ok(!emitted[0].title.includes('DRY_RUN'), '主区不许出现 DRY_RUN')
    assert.equal(result.title, conclusion)
    const log = readTechnicalDetails()
    assert.equal(log.length, 1, '后端原文必须写入技术详情日志')
    assert.ok(
      !log[0].detail.includes('1ebace78-b083-49fe-a86b-d17c524e501d'),
      `技术详情层也不许留 UUID（掩码必须生效）：${log[0].detail}`,
    )
    assert.ok(!log[0].detail.includes('file_id='), `技术详情层不许留字段名赋值形态：${log[0].detail}`)
    assert.match(log[0].detail, /参考图未透传/, '技术详情层要保留后端措辞，便于排查')
    assert.equal(log[0].scope, '生成关键帧', '技术详情日志要标出处，便于定位')
    // 反向：没有原文时不留日志，也不把结论退化成通用兜底
    clearTechnicalDetails()
    await showUserConclusion('warning', conclusion, '', '生成关键帧')
    assert.equal(readTechnicalDetails().length, 0, '没有后端原文时不该写技术详情日志')
    assert.equal(emitted.length, 2)
    assert.equal(emitted[1].title, conclusion)
  } finally {
    setUserMessageNotifier(null)
    clearTechnicalDetails()
  }
})

/* -------------------------------------------------------- ③ 扫描范围守卫 */

test('阶段B③扫描范围守卫：登记表里的文件真实存在，且都被目录遍历覆盖到', () => {
  const onDisk = scanFiles().map(relAiStudio)
  const declaredButMissing = REGISTERED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(declaredButMissing, [], `登记表里列了不存在（或已被改名）的文件：${declaredButMissing.join('、')}`)
  const unscanned = REGISTERED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(unscanned, [], `登记在册但没被扫描到的文件：${unscanned.join('、')}`)
  // 目录遍历必须覆盖到 `chapter/**` 的每一层，而不是只扫登记的那几个
  assert.ok(onDisk.length >= REGISTERED_FILES.length, '扫描面比登记表还小，说明遍历被缩窄了')
})

test('阶段B③扫描范围守卫：每个目录都有文件（遍历被人为缩窄会立刻失败）', () => {
  const dirs = new Set(
    scanFiles()
      .map((file) => relative(CHAPTER_ROOT, dirname(file)))
      .filter((dir) => !dir.startsWith('..')),
  )
  const missing = EXPECTED_DIRS.filter((dir) => !dirs.has(dir))
  assert.deepEqual(
    missing,
    [],
    `这些目录在扫描结果里一个文件都没有，说明目录遍历被缩窄了：${missing.join('、')}（实际：${[...dirs].sort().join('、')}）`,
  )
})

test('阶段B③扫描范围守卫：`shots/**` 里只有审计 §4.3 登记的两个文件被纳入（不冒充覆盖整个 shots）', () => {
  const shotsOnDisk = listSourceFiles(resolve(AISTUDIO_ROOT, 'shots')).filter((file) => !/\.test\.tsx?$/.test(file))
  const shotsScanned = scanFiles()
    .map(relAiStudio)
    .filter((file) => file.startsWith('shots/'))
  assert.deepEqual(
    shotsScanned.map((file) => resolve(AISTUDIO_ROOT, file)).sort(),
    SHOTS_IN_BATCH_FILES.map((relPath) => resolve(AISTUDIO_ROOT, relPath)).sort(),
    '扫描面里的 `shots/**` 文件必须**恰好**是 §4.3 登记的那两个 —— 多扫会让本测试替别人的批次背书，少扫会漏掉 §4.3 的点名条目',
  )
  assert.ok(
    shotsOnDisk.length > SHOTS_IN_BATCH_FILES.length,
    '`shots/**` 应当还有本批范围外的文件（审计 §4.6 / 第 6 批），数量对不上说明目录结构变了',
  )
})

/* ------------------------------------------------------------ ④ 豁免守卫 */

test('阶段B③豁免守卫：技术详情折叠实现仍然只有 `TechnicalDetailCollapse.tsx` 一个文件', () => {
  const waiverPath = resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER)
  const waiver = readFileSync(waiverPath, 'utf8')
  assert.ok(waiver.includes('export function TechnicalDetailSection'), '豁免文件必须导出统一的技术详情折叠壳')
  const offenders: string[] = []
  scanFiles().forEach((file) => {
    const code = stripComments(readFileSync(file, 'utf8'))
    if (code.includes('技术详情（默认收起）')) offenders.push(`${relAiStudio(file)} 复制了统一折叠壳的标题文案`)
    if (/<details[\s\S]{0,400}?技术详情/.test(code)) offenders.push(`${relAiStudio(file)} 自建了 <details> 形态的技术详情`)
  })
  assert.deepEqual(offenders, [], `出现了第二套「技术详情」实现，必须改用 TechnicalDetailSection：\n${offenders.join('\n')}`)
})

test('阶段B③豁免守卫：技术详情层标记区间存在且非空，且只用于 `ChapterStudio.tsx`', () => {
  const source = readScan(TECH_LAYER_WAIVER_FILE)
  const lines = technicalLayerLines(source)
  assert.ok(lines.size >= 50, `技术详情层标记区间只有 ${lines.size} 行，可疑（technical 块 + kf_specs 应当远超这个数）`)
  const startLines = source
    .split('\n')
    .map((line, index) => ({ line, index: index + 1 }))
    .filter((entry) => entry.line.includes(TECH_LAYER_START))
  assert.equal(startLines.length, 2, '`ChapterStudio.tsx` 应当只有两个技术详情层起点标记（technical 块与 kf_specs）')
  // `kf_specs` 整块必须**只**由 technical 渲染；否则「标记区间 = 默认收起」这个前提就不成立
  const kfSpecsUses = source.split('\n').filter((line) => line.includes("part('kf_specs')"))
  assert.equal(kfSpecsUses.length, 1, `\`part('kf_specs')\` 出现了 ${kfSpecsUses.length} 次，必须恰好一次（只在 technical 里）`)
  const kfSpecsLine = source.split('\n').findIndex((line) => line.includes("part('kf_specs')")) + 1
  assert.ok(
    lines.has(kfSpecsLine),
    `\`part('kf_specs')\` 在 :${kfSpecsLine}，不在技术详情层标记区间内 —— 它会被渲染到主区`,
  )
  // `technical` 块自身也必须在标记区间里
  const technicalLine = source.split('\n').findIndex((line) => /^\s*technical: \(/.test(line)) + 1
  assert.ok(lines.has(technicalLine), `\`technical\` 块在 :${technicalLine}，不在技术详情层标记区间内`)
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    if (relPath === TECH_LAYER_WAIVER_FILE) return
    const text = readFileSync(file, 'utf8')
    assert.ok(
      !text.includes(TECH_LAYER_START) && !text.includes(TECH_LAYER_END),
      `${relPath} 出现了技术详情层标记 —— 只有 ChapterStudio.tsx 允许用标记做行级豁免`,
    )
  })
})

test('阶段B③豁免守卫：`technical` 折叠项默认收起（`STEP_OPEN_KEYS` 不含 `technical`）', () => {
  const source = stripComments(readScan('chapter/components/ShotProductionWorkspace.tsx'))
  const block = /const STEP_OPEN_KEYS[\s\S]*?\n}/.exec(source)
  assert.ok(block, '找不到 `STEP_OPEN_KEYS` 定义')
  assert.ok(
    !/technical/.test(block[0]),
    '`STEP_OPEN_KEYS` 里出现了 `technical` —— 技术详情会被默认展开，等于把第三层铺在主区',
  )
  assert.ok(/key: 'technical'/.test(source), '`technical` 折叠项必须存在（技术详情层的唯一落点）')
  // 收起态可见的标签正文必须干净
  const labelBlock = /key: 'technical'[\s\S]{0,400}?children/.exec(source)
  assert.ok(labelBlock, '找不到 `technical` 折叠项的标签')
  const forbidden = ['供应商', 'file_id', 'storage_key', '接口参数', '守卫状态'].filter((term) =>
    labelBlock[0].includes(term),
  )
  assert.deepEqual(forbidden, [], `技术详情折叠项的**标签**（收起态可见）里还有内部术语：${forbidden.join('、')}`)
})

test('阶段B③词表守卫：词源与 `enumLabels` 同源，新增枚举自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('槽位'), '主区禁词表里必须有「槽位」（§4.3 点名）')
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'), '主区禁词表里必须有「供应商」（§4.3 点名）')
  ;(['video', 'text', 'image'] as const).forEach((outlet) => {
    MODEL_RAW_NAMES.forEach((raw) => {
      const label = modelBusinessName(outlet, raw)
      assert.ok(!label.toLowerCase().includes(raw), `模型业务名仍含原始名：${outlet}/${raw} → ${label}`)
    })
  })
})
