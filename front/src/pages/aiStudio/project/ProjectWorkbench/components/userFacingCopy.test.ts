/**
 * 「文案黑名单」源码扫描测试（缺陷 D7）。
 *
 * 用户口径：**用户可见文案里不许再出现上一版的错误说法**（把已有图片当输入的那套词），
 * 也不许出现「图生图」。资产准备与资产编辑页是主要入口，所以这里做的是**源码级**扫描，
 * 而不是只检查几个常量 —— 免得以后有人再往 JSX 里写一句。
 *
 * 范围说明（诚实记录）：
 *   本任务允许改动的目录只有 `pages/aiStudio/project/ProjectWorkbench/**` 与
 *   `pages/aiStudio/assets/**`，所以：
 *     1. 这两个目录里**任何**非测试源码都不许出现黑名单词（含注释）；
 *     2. 其它目录（本次范围外）如果还有，必须逐文件登记在 `OUT_OF_SCOPE_OFFENDERS` 里 ——
 *        新冒出来的会直接让测试失败，不会悄悄溜过去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ENUM_RAW_VALUES, MODEL_RAW_NAMES } from '../../../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerNegativeSelfCheck,
  scannerSelfCheck,
} from '../../../components/mainScreenCopyGuard.ts'
import { formatUserFacingTime } from '../../../components/userFacingTime.ts'
/* 阶段 B 第 5 批（区域 5）新增：本区域被改渲染点的**纯函数**入口。
   与下面「区域 2」那段扫源码的口径互补 —— 这里直接调用被测函数，
   断言「未登记的键/码不会原样回显」与「主区那句是本仓自己写的」。 */
import { ASSET_PROFILE_FIELD_SPECS } from './assetProfileFields.ts'
import {
  ASSET_PROMPT_CATEGORY_LABEL,
  ASSET_PROMPT_SLOT_FALLBACK_TEXT,
  ASSET_PROMPT_TYPE_FALLBACK_TEXT,
  builtinPromptSlotLabel,
  describePromptRowAsset,
  describePromptRowSlot,
} from './assetPromptSlots.ts'
import { describeRowAvailability } from './assetPromptRequestScope.ts'
import { isRenderableResultLabel, resolveResultLabel } from './assetResultKind.ts'
import { formatBusyNotice, sourceLabel } from './promptBoardDrafts.ts'
import {
  PENDING_REVIEW_REASON_MAIN_TEXT,
  PROFILE_FIELD_LABEL,
  WORKBENCH_ANALYSIS_STATUS_FALLBACK,
  WORKBENCH_PROMPT_REGENERATION_MAIN_TEXT,
  WORKBENCH_STATUS_LABEL,
  WORKBENCH_STATUS_NOTICE,
  deriveWorkbenchCommand,
  pendingReviewReasonMainText,
  profileFieldKeysMissingLabel,
  profileFieldLabel,
  workbenchAnalysisHintMainText,
  workbenchAnalysisStatusLabel,
  workbenchStatusLabel,
} from './workbench/workbenchState.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/project/ProjectWorkbench/components` → `front/src` */
const SRC_ROOT = resolve(HERE, '../../../../..')
const AISTUDIO_ROOT = resolve(SRC_ROOT, 'pages/aiStudio')

/** 本任务允许改动的两个目录。 */
const IN_SCOPE_DIRS = [
  resolve(AISTUDIO_ROOT, 'project/ProjectWorkbench'),
  resolve(AISTUDIO_ROOT, 'assets'),
]

/** 用户点名的两个黑名单词。 */
const BANNED_WORDS = ['垫图', '图生图']

/**
 * 本次**改动范围外**、但源码里仍有黑名单词的文件（逐个人工核对过）。
 *
 * 这些文件不在本任务允许编辑的目录里（用户明确限定只能改
 * `ProjectWorkbench/**` 与 `assets/**`），所以只能登记在这里交给后续任务清理：
 *   - `llmPipeline/LlmPipelinePage.tsx`：页面上有「垫图批量（用定版主图）」等真实文案；
 *   - `services/generated/**`：由后端 docstring 自动生成的注释（不是手写文案）。
 */
const OUT_OF_SCOPE_OFFENDERS = [
  'pages/aiStudio/llmPipeline/LlmPipelinePage.tsx',
  'services/generated/models/AdoptImageRead.ts',
  'services/generated/models/ImagePlanPreviewRequest.ts',
  'services/generated/models/ImageSubmitRequest.ts',
  'services/generated/models/ReferenceImageRead.ts',
  'services/generated/models/SubmissionTargetRead.ts',
  'services/generated/services/StudioImagePipelineService.ts',
]

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

/** 找出文件里命中黑名单词的行（可排除若干行号）。 */
function findBannedLines(file: string, skipLineNumbers: readonly number[] = []): string[] {
  const skip = new Set(skipLineNumbers)
  const hits: string[] = []
  readFileSync(file, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      if (skip.has(index + 1)) return
      if (BANNED_WORDS.some((word) => line.includes(word))) {
        hits.push(`${relative(SRC_ROOT, file)}:${index + 1}: ${line.trim()}`)
      }
    })
  return hits
}

/**
 * `assetProduction.ts` 里黑名单正则的定义行必须写出被禁的词（否则无从检查），
 * 这几行按行号显式排除；其它任何一行都不许出现。
 */
function blacklistDefinitionLines(file: string): number[] {
  const lines = readFileSync(file, 'utf8').split('\n')
  const start = lines.findIndex((line) => line.includes('export const MISLEADING_COPY_PATTERNS'))
  assert.ok(start >= 0, 'assetProduction.ts 里应该有 MISLEADING_COPY_PATTERNS 定义')
  const out: number[] = []
  for (let index = start; index < lines.length; index += 1) {
    const trimmed = lines[index].trim()
    if (trimmed.startsWith(']')) break
    if (/^\/.*\/,$/.test(trimmed)) out.push(index + 1)
  }
  assert.ok(out.length >= 2, '应该排除掉「垫图」「图生图」两条正则')
  return out
}

test('扫描器本身有效：黑名单词确实能在测试文件里被找出来（不是空转）', () => {
  const hits = findBannedLines(fileURLToPath(import.meta.url))
  assert.ok(hits.length >= BANNED_WORDS.length, `扫描器没找到任何命中，说明它坏了：${hits.length}`)
  // 找的是"含黑名单词的行"，不是"含黑名单词的文件"——用来证明扫描逻辑真的在跑
  const found = BANNED_WORDS.filter((word) => hits.some((hit) => hit.includes(word)))
  assert.deepEqual(found.sort(), [...BANNED_WORDS].sort())
})

test('D7：资产准备（ProjectWorkbench）与资产编辑（assets）里任何源码都不出现黑名单词', () => {
  const offenders: string[] = []
  IN_SCOPE_DIRS.forEach((dir) => {
    listSourceFiles(dir).forEach((file) => {
      // 测试文件本身需要写出被禁的词才能断言（不是用户可见文案），跳过
      if (/\.test\.tsx?$/.test(file)) return
      const skip = file.endsWith('assetProduction.ts') ? blacklistDefinitionLines(file) : []
      offenders.push(...findBannedLines(file, skip))
    })
  })
  assert.deepEqual(offenders, [])
})

test('D7：范围外仍有黑名单词的文件必须逐条登记，新冒出来的直接失败', () => {
  const inScopePrefixes = IN_SCOPE_DIRS.map((dir) => `${relative(SRC_ROOT, dir)}/`)
  const offenders = listSourceFiles(AISTUDIO_ROOT)
    .concat(listSourceFiles(resolve(SRC_ROOT, 'services')))
    .filter((file) => !inScopePrefixes.some((prefix) => relative(SRC_ROOT, file).startsWith(prefix)))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .filter((file) => findBannedLines(file).length > 0)
    .map((file) => relative(SRC_ROOT, file))
    .sort()

  const undocumented = offenders.filter((file) => !OUT_OF_SCOPE_OFFENDERS.includes(file))
  assert.deepEqual(undocumented, [], `这些文件出现了黑名单词，但没有登记在 OUT_OF_SCOPE_OFFENDERS 里：${undocumented.join(', ')}`)
  // 登记表里的文件如果已经清干净了（好事），不报错；但范围里必须一个都没有
  assert.ok(!offenders.some((file) => inScopePrefixes.some((prefix) => file.startsWith(prefix))))
})

/* ==================================================================================
 * 阶段 B 第 2 批 · 工作台五步「主区禁词扫描 0 命中」
 * 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md` §4.2（53 条）+ §8.1 区域 2
 * ==================================================================================
 *
 * 结构照先例 `project/projectLobbyCopy.test.ts`（§8.1 明说「把先例从硬编码文件升级为
 * 目录遍历 + 显式豁免」），覆盖面比先例多一层：
 *
 * | 扫描面 | 覆盖内容 |
 * |---|---|
 * | JSX 文本节点 | `>…<` 之间的字面量 |
 * | **JSX 属性值** | `title` / `tooltip` / `placeholder` / `description` / `message` / `okText` / `aria-label` … |
 * | 字符串 / 模板字面量 | 模块级常量、`message.*` 实参 |
 *
 * 三件必须有的护栏（§8.1 硬要求）：
 *   1. **空转自检**：往真实源码里注入已知禁词必须被抓到，否则「扫不到＝干净」是假绿；
 *   2. **负向自检**：用户拍板放行的业务说法（「待确认候选」）必须**不**被判成泄漏，
 *      否则细分口径退化成「整词禁候选」，会出现过度整改；
 *   3. **扫描范围守卫**：目录遍历 + 显式登记表，新增文件自动纳入、列表漂移立刻报错。
 *
 * 唯一豁免文件：`components/workbench/TechnicalDetailCollapse.tsx`
 * （用户口径：**内部字段名只允许出现在那个文件里**）。
 * 另有一类**结构性**豁免：禁词表常量本身必须把被禁的词写出来，否则无从检查
 * （沿用本文件 `blacklistDefinitionLines` 的既有先例，按行号区间豁免）。
 */

const WORKBENCH_ROOT = resolve(AISTUDIO_ROOT, 'project/ProjectWorkbench')

/** 全目录唯一的「技术详情」实现（内部字段名 / 接口路径 / 模型名只允许在这里）。 */
const TECHNICAL_DETAIL_WAIVER = 'components/workbench/TechnicalDetailCollapse.tsx'

/** 本批（阶段 B 第 2 批）明确纳入扫描面的文件——登记表，防止扫描范围悄悄缩小。 */
const REGISTERED_FILES: readonly string[] = [
  'components/AssetImagePromptLlmPanel.tsx',
  'components/AssetProductionArea.tsx',
  'components/AssetProfileEditEntry.tsx',
  'components/EpisodeVideoPromptBoard.tsx',
  'components/JuriluScriptGroupPicker.tsx',
  'components/ProjectDevInfo.tsx',
  'components/ProjectExtractCandidatesPanel.tsx',
  'components/ProjectStudioStepPanel.tsx',
  'components/assetGenerationBasis.ts',
  'components/assetProduction.ts',
  'components/assetProductionApi.ts',
  'components/assetPromptQuality.ts',
  'components/assetPromptSlots.ts',
  'components/assetWriteScope.ts',
  'components/extractConfirmPlan.ts',
  'components/juriluScriptGroups.ts',
  'components/userFacingStatus.ts',
  'components/workbench/AssetWorkbench.tsx',
  'components/workbench/assetWorkbenchContract.ts',
  'components/workbench/technicalView.ts',
  'components/workbench/workbenchState.ts',
  'hooks/useProjectStepSignals.ts',
  'projectSteps.ts',
  'tabs/ActorsTab.tsx',
  'tabs/ChaptersTab.tsx',
]

/** 本区域的目录结构——遍历结果里每个目录都必须有文件，否则说明遍历被人为缩窄了。 */
const EXPECTED_DIRS: readonly string[] = ['', 'components', 'components/workbench', 'hooks', 'tabs', 'utils']

/** 禁词表常量名：这些数组**必须**把被禁的词写出来，所以按行豁免（结构性豁免）。 */
const TERM_TABLE_CONSTANTS: readonly string[] = [
  'MAIN_SCREEN_FORBIDDEN_TERMS',
  'MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS',
  'FORBIDDEN_INTERNAL_TERMS',
  'INTERNAL_TOKEN_BLACKLIST',
  'FORBIDDEN_READY_COPY',
  'MISLEADING_COPY_PATTERNS',
]

/**
 * 工作台五步区域的**开发术语**（比共享词表更严的一层）。
 *
 * 它们不是「内部 ID / 字段名」，而是**开发过程词汇**：用户看不懂，
 * 且审计 §4.2 明确点名要换掉（步骤 2 的三处警告条是主区最大面积的一处）。
 */
const WORKBENCH_DEV_TERMS: readonly string[] = [
  '等待后端契约',
  '降级视图',
  '后端正在按契约实现',
  '接口还没有就绪',
  '配对计划',
  '后端槽位表',
]

/** 区域补充的字段名（共享正则里没有、但审计 §4.2 点名的）。 */
const WORKBENCH_EXTRA_FIELD_PATTERNS: readonly RegExp[] = [
  /(?<![A-Za-z0-9_])(?:sample_records|script_id|candidate_status|image_prompts|recommended_duration|imported_resolution|imported_size)(?![A-Za-z0-9_])/i,
]

function workbenchSources(): string[] {
  return listSourceFiles(WORKBENCH_ROOT)
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .sort()
}

function relWorkbench(file: string): string {
  return relative(WORKBENCH_ROOT, file)
}

function readWorkbench(relPath: string): string {
  return readFileSync(resolve(WORKBENCH_ROOT, relPath), 'utf8')
}

/** 只保留代码（去注释），用于「渲染点有没有接上管道」这类源码级断言。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

/**
 * 禁词表常量占用的行号区间。
 *
 * 做法：找到 `const <NAME> … = [`，然后按中括号配平扫到收尾的 `]`。
 * 这些行里出现的禁词是**词表本身**，不是用户可见文案，属于结构性豁免。
 */
function termTableLines(source: string): Set<number> {
  const out = new Set<number>()
  TERM_TABLE_CONSTANTS.forEach((name) => {
    const matched = new RegExp(`(?:export\\s+)?const\\s+${name}\\b[^=]*=\\s*\\[`).exec(source)
    if (!matched) return
    const startLine = source.slice(0, matched.index).split('\n').length
    let depth = 0
    let line = startLine
    for (let i = matched.index + matched[0].length - 1; i < source.length; i += 1) {
      const ch = source[i]
      if (ch === '\n') line += 1
      if (ch === '[') depth += 1
      else if (ch === ']') {
        depth -= 1
        if (depth === 0) break
      }
    }
    for (let l = startLine; l <= line; l += 1) out.add(l)
  })
  return out
}

/* --------------------------------------------------------------- 护栏自检 */

test('阶段B②护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGISTERED_FILES.forEach((relPath) => {
    const source = readWorkbench(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('阶段B②护栏：用户拍板放行的业务说法（「待确认候选」）不许被判成泄漏', () => {
  assert.ok(
    scannerNegativeSelfCheck(),
    '「待确认候选」这类业务说法被判成了泄漏 —— 说明「候选」的细分口径退化成整词禁，会造成过度整改',
  )
  assert.ok(
    !MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('候选'),
    '「候选」不应作为整词进禁词表（细分口径：只禁「候选条数 / 聚合 N 组 / 候选状态」这类后端概念）',
  )
})

test('阶段B②护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const files = workbenchSources()
  assert.ok(files.length >= 60, `本区域只找到 ${files.length} 个源码文件，目录遍历可能失效了`)
  const total = files.reduce((sum, file) => sum + countScanSurfaces(readFileSync(file, 'utf8')), 0)
  assert.ok(total >= 800, `本区域只提取到 ${total} 个用户可见扫描面，明显偏少（遍历或提取器可能坏了）`)
})

test('阶段B②护栏：JSX 属性值是扫描面的一部分（标题 / 悬停提示收起态也看得见）', () => {
  const probe = `
export function Probe() {
  return (
    <div>
      <Input placeholder="随便写点" />
      <div aria-label="供应商">正常文案</div>
      <Alert title="模型方案：gpt-image-2" message="候选 12 条" />
    </div>
  )
}
`
  const hits = findMainScreenLeaks(probe)
  assert.ok(
    hits.some((hit) => hit.kind === 'jsx-attr' && hit.term === '供应商'),
    `属性值里的禁词没被扫到：${JSON.stringify(hits)}`,
  )
  const surfaces = extractScanSurfaces(probe)
  assert.ok(
    surfaces.some((surface) => surface.kind === 'jsx-attr' && surface.attr === 'placeholder'),
    'placeholder 没被识别成可见属性',
  )
})

/* --------------------------------------------------- ① 主区禁词 0 命中（核心） */

test('工作台五步：主区禁词扫描 0 命中（唯一豁免：技术详情实现本身 + 禁词表定义行）', () => {
  const offenders: string[] = []
  workbenchSources().forEach((file) => {
    const relPath = relWorkbench(file)
    if (relPath === TECHNICAL_DETAIL_WAIVER) return
    const source = readFileSync(file, 'utf8')
    const exemptLines = termTableLines(source)
    const hits = findMainScreenLeaks(source).filter((hit) => !exemptLines.has(hit.line))
    offenders.push(...formatLeakHits(relPath, hits))
  })
  assert.deepEqual(
    offenders,
    [],
    `工作台五步主区出现泄漏（模式 1/2/3/4/5/6 或主区禁词）：\n${offenders.join('\n')}`,
  )
})

test('工作台五步：审计 §4.2 点名的开发术语不再出现在任何用户可见文案里', () => {
  const offenders: string[] = []
  workbenchSources().forEach((file) => {
    const relPath = relWorkbench(file)
    if (relPath === TECHNICAL_DETAIL_WAIVER) return
    const source = readFileSync(file, 'utf8')
    const exemptLines = termTableLines(source)
    extractScanSurfaces(source).forEach((surface) => {
      if (exemptLines.has(surface.line)) return
      WORKBENCH_DEV_TERMS.forEach((term) => {
        if (surface.text.includes(term)) offenders.push(`${relPath}:${surface.line} ｜ 命中「${term}」｜ ${surface.text.trim()}`)
      })
    })
  })
  assert.deepEqual(offenders, [], `这些是开发术语，主区不许出现（§4.2 步骤 2 点名）：\n${offenders.join('\n')}`)
})

test('工作台五步：审计 §4.2 点名的后端字段名不再出现在任何用户可见文案里', () => {
  const offenders: string[] = []
  workbenchSources().forEach((file) => {
    const relPath = relWorkbench(file)
    if (relPath === TECHNICAL_DETAIL_WAIVER) return
    const source = readFileSync(file, 'utf8')
    const exemptLines = termTableLines(source)
    extractScanSurfaces(source).forEach((surface) => {
      if (exemptLines.has(surface.line)) return
      WORKBENCH_EXTRA_FIELD_PATTERNS.forEach((pattern) => {
        if (pattern.test(surface.text)) {
          offenders.push(`${relPath}:${surface.line} ｜ 命中「${pattern.source}」｜ ${surface.text.trim()}`)
        }
      })
    })
  })
  assert.deepEqual(offenders, [], `这些字段名只允许出现在技术详情层：\n${offenders.join('\n')}`)
})

/* --------------------------------------------- ② 渲染点口径（扫描器看不见的那类） */

test('步骤 1：更新时间列不再直渲 ISO 串（§4.2 模式 3）', () => {
  const source = readWorkbench('tabs/ChaptersTab.tsx')
  const column = /title: '更新时间'[\s\S]{0,400}?\n\s*\},/.exec(source)
  assert.ok(column, 'ChaptersTab.tsx 里找不到「更新时间」列定义')
  assert.ok(/render:/.test(column[0]), '列必须有 render —— 没有 render 就是把后端值直接渲出来')
  assert.ok(
    column[0].includes('formatUserFacingTime'),
    '时间口径必须走全仓唯一的 formatUserFacingTime（审计指定「复用既有实现」）',
  )
  // 纯函数级：机器时间串必须被格式化成可读中文时间
  const formatted = formatUserFacingTime('2026-09-26T04:02:58.135Z')
  assert.match(formatted, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, `格式化结果不像本地时间：${formatted}`)
  assert.ok(!formatted.includes('T') && !formatted.includes('Z'), `仍然带着 ISO 标记：${formatted}`)
  assert.equal(formatUserFacingTime(''), '—')
})

test('步骤 2：资料未就绪的三处提示条只说用户语言（§4.2 模式 2，主区最大面积）', () => {
  const stepTwoFiles = ['components/workbench/assetWorkbenchContract.ts', 'components/workbench/AssetWorkbench.tsx']
  const offenders: string[] = []
  stepTwoFiles.forEach((relPath) => {
    const source = readWorkbench(relPath)
    extractScanSurfaces(source).forEach((surface) => {
      WORKBENCH_DEV_TERMS.forEach((term) => {
        if (surface.text.includes(term)) offenders.push(`${relPath}:${surface.line} ｜ ${term}`)
      })
    })
  })
  assert.deepEqual(offenders, [], `步骤 2 的提示条又出现开发术语了：\n${offenders.join('\n')}`)
  const contract = readWorkbench('components/workbench/assetWorkbenchContract.ts')
  assert.ok(contract.includes('WORKBENCH_CONTRACT_PENDING_TITLE'), '缺少用户语言的状态标题常量')
  assert.ok(contract.includes('WORKBENCH_CONTRACT_PENDING_RETRY'), '缺少重试入口文案常量')
  const workbench = readWorkbench('components/workbench/AssetWorkbench.tsx')
  assert.ok(/WORKBENCH_CONTRACT_PENDING_RETRY/.test(workbench), '重试入口必须在提示条上真的有按钮，不能只是常量')
  assert.ok(/onClick=\{\(\) => void loadWorkbench\(\)\}/.test(workbench), '重试入口必须真的重新取数')
})

test('步骤 3：脚本组不再把内部组编号端上主区（§4.2 模式 1）', () => {
  const source = stripComments(readWorkbench('components/JuriluScriptGroupPicker.tsx'))
  /* 只判「**含中文**的模板字面量里插值内部组编号」这一种形态（即用户看得见的那种）；
     `htmlFor={`jurilu-script-radio-${group.script_id}`}` 这类表单 id **不上屏**，不是泄漏。 */
  const interpolated = (source.match(/`(?:\\.|[^`\\])*`/g) ?? [])
    .filter((text) => /[\u4e00-\u9fff]/.test(text))
    .filter((text) => /\$\{[^}]*\bscript_id\b[^}]*\}/.test(text))
  assert.deepEqual(
    interpolated,
    [],
    `主区文案里不许插值 script_id（内部组编号只允许进技术详情）：${interpolated.join(' / ')}`,
  )
  assert.ok(source.includes('用这一组匹配镜头'), '缺少「用这一组匹配镜头」这个用户口径')
  // 批量导入的表头不许再写字段名
  const headers = extractScanSurfaces(source).map((surface) => surface.text)
  assert.ok(
    !headers.some((text) => text.includes('script_id')),
    `表头/文案里还有 script_id：${headers.filter((text) => text.includes('script_id')).join(' / ')}`,
  )
})

test('步骤 5：可交付来源未登记时不许回显后端原值（§4.2 模式 3）', () => {
  const code = stripComments(readWorkbench('components/ProjectStudioStepPanel.tsx'))
  assert.ok(
    !/SOURCE_LABELS\[key\]\s*\?\?\s*\(/.test(code),
    'sourceLabel 的兜底又回落到 `key` 了 —— 未登记来源码会被原样端上屏（运行时实测过 external_import）',
  )
  assert.match(code, /SOURCE_LABELS\[key\] \?\? '[^']+'/, '未登记来源码必须给中文兜底')
  assert.ok(
    code.includes('TechnicalDetailSection'),
    '交付预览的后端原始说明必须收进默认收起的「技术详情」，不许直渲在主区',
  )
})

test('步骤 5：交付预览的主区文案必须是产品自己写的句子，不许把后端长原文「改写」后当主区（运行时复核）', () => {
  /**
   * 为什么会有这条（2026-09-26 运行时复核发现的真缺陷）：
   *
   * 上一版把 `buildUserFacingMessage(note).title` 放在主区，靠管道把后端原文改成中文结论。
   * 上面那条用例只断言了「代码里有 `TechnicalDetailSection`」，于是**看着是过的**；
   * 但运行时实测主区上屏的是整段后端原文（`本端点只做「仅提示词」出口：导出**来源在白名单内
   * 且有正文**的提示词（…）`）—— 因为管道只改写了已知的那一句，其余原样留下。
   * 教训：**「原文进了折叠区」不等于「主区干净了」**，两者各自要有断言。
   */
  const code = stripComments(readWorkbench('components/ProjectStudioStepPanel.tsx'))
  assert.ok(
    !/\{message\.title\}/.test(code),
    '主区又去渲 `buildUserFacingMessage(后端原文).title` 了 —— 后端长文本改一遍仍然是后端文本，'
      + '主区文案必须是产品自己写死的句子（见 DELIVERY_NOTE_MAIN 的注释）',
  )
  const constant = code.match(/const DELIVERY_NOTE_MAIN = '([^']+)'/)
  assert.ok(constant, '交付说明的主区文案必须是一个写死的中文常量，不许从后端值派生')
  const mainCopy = constant[1]
  assert.ok(/[\u4e00-\u9fff]/.test(mainCopy), `主区文案必须是中文：${mainCopy}`)
  const devTerms = ['端点', '白名单', '字段名', '元信息', '等价列', '接口', '后端', 'file_id', 'storage_key']
  const leaked = devTerms.filter((term) => mainCopy.includes(term))
  assert.deepEqual(leaked, [], `交付说明的主区文案里还有开发术语：${leaked.join(' / ')}`)
})

test('§6.1 任务号 / UUID 口径：含中文的主区文案里不许插值任务号或内部编号（工作台五步）', () => {
  const offenders: string[] = []
  workbenchSources().forEach((file) => {
    const relPath = relWorkbench(file)
    if (relPath === TECHNICAL_DETAIL_WAIVER) return
    const code = stripComments(readFileSync(file, 'utf8'))
    /**
     * 只判「**含中文**的模板字面量里插值内部编号」这一种形态。
     *
     * 为什么这样收口：`key={`${item.asset_type}:${item.asset_id}`}` 这类把内部编号
     * 当 React key 的写法**不上屏**，不是泄漏；真正的模式 1 是
     * `` `幂等键 ${target.source_task_id}｜提示词来源 …` `` 这种**中文句子 + 内部编号**。
     */
    const templateLiterals = code.match(/`(?:\\.|[^`\\])*`/g) ?? []
    templateLiterals
      .filter((text) => /[\u4e00-\u9fff]/.test(text))
      .filter((text) => /\$\{[^}]*\b(?:task_id|service_task_id|source_task_id|provider_task_id|file_id|asset_id)\b[^}]*\}/.test(text))
      .forEach((text) => offenders.push(`${relPath} ｜ ${text.trim().slice(0, 140)}`))
  })
  assert.deepEqual(offenders, [], `这些用户可见文案把内部编号插了进来（§6.1：一律进技术详情）：\n${offenders.join('\n')}`)
})

/* -------------------------------------------------------- ③ 扫描范围守卫 */

test('阶段B②扫描范围守卫：登记表里的文件真实存在，且都被目录遍历覆盖到', () => {
  const onDisk = workbenchSources()
  const relativeOnDisk = onDisk.map(relWorkbench)
  const declaredButMissing = REGISTERED_FILES.filter((file) => !relativeOnDisk.includes(file))
  assert.deepEqual(declaredButMissing, [], `登记表里列了不存在（或已被改名）的文件：${declaredButMissing.join('、')}`)
  // 登记表是为了「防止扫描范围缩小」，所以必须断言它真的被遍历到了
  const unscanned = REGISTERED_FILES.filter(
    (file) => !onDisk.some((full) => relWorkbench(full) === file),
  )
  assert.deepEqual(unscanned, [], `登记在册但没被扫描到的文件：${unscanned.join('、')}`)
})

test('阶段B②扫描范围守卫：每个目录都有文件（遍历被人为缩窄会立刻失败）', () => {
  const dirs = new Set(workbenchSources().map((file) => relative(WORKBENCH_ROOT, dirname(file))))
  const missing = EXPECTED_DIRS.filter((dir) => !dirs.has(dir))
  assert.deepEqual(
    missing,
    [],
    `这些目录在扫描结果里一个文件都没有，说明目录遍历被缩窄了：${missing.join('、')}（实际：${[...dirs].sort().join('、')}）`,
  )
})

test('阶段B②豁免范围守卫：技术详情豁免仍然只有一个文件，且它真的导出统一折叠壳', () => {
  const waiverPath = resolve(WORKBENCH_ROOT, TECHNICAL_DETAIL_WAIVER)
  const waiver = readFileSync(waiverPath, 'utf8')
  assert.ok(waiver.includes('export function TechnicalDetailSection'), '豁免文件必须导出统一的技术详情折叠壳')
  /* 除豁免文件外，不许有第二个文件自建「技术详情」折叠块 —— 多一套实现就等于
     豁免范围失控（审计 §9 第 2 项：测试只能给一个文件开口子）。 */
  const secondImplementations = workbenchSources()
    .filter((file) => relWorkbench(file) !== TECHNICAL_DETAIL_WAIVER)
    .filter((file) => stripComments(readFileSync(file, 'utf8')).includes('技术详情（默认收起）'))
  assert.deepEqual(
    secondImplementations.map(relWorkbench),
    [],
    '出现了第二套「技术详情」折叠壳，必须改用 TechnicalDetailSection',
  )
  // 其它文件要用折叠壳时，必须从统一实现导入（不许自己再写一个）
  const selfBuilt = workbenchSources()
    .filter((file) => relWorkbench(file) !== TECHNICAL_DETAIL_WAIVER)
    .filter((file) => /<details[\s\S]{0,400}?技术详情/.test(stripComments(readFileSync(file, 'utf8'))))
  assert.deepEqual(selfBuilt.map(relWorkbench), [], '不许自建 <details> 形态的技术详情')
})

test('阶段B②词表守卫：词源与 enumLabels 同源，新增枚举自动纳入', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('槽位'), '主区禁词表里必须有「槽位」（§4.2 点名）')
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'), '主区禁词表里必须有「供应商」（§4.2 点名）')
})


/* ==================================================================================
 * 阶段 B 第 5 批 · 区域 5「提示词看板 / 资产抽屉 / 待处理抽屉」+
 * `project/ProjectWorkbench/**` 的 §4.5 残留渲染点（审计 §4.5，25 条）
 * ==================================================================================
 *
 * 与上面「区域 2」那一段的分工：区域 2 盯的是**开发术语与后端字段名**（扫描器看得见的那类）；
 * 这一段盯的是**渲染点**（扫描器结构上看不见的那类，§5.6「泄漏是渲后端值，不是写死后端值」）：
 *   - 映射兜底是不是会「未登记就回显原值」（模式 3）；
 *   - 主区那句是不是**产品自己写的句子**（§7.1-8）；
 *   - 「后端原文进了折叠区」与「主区干净」**各自**有没有断言（§7.1-8 配套要求）；
 *   - 统一 message 管道有没有真的接在失败出口上（模式 6）。
 */

const aiStudioRoot = resolve(SRC_ROOT, 'pages/aiStudio')

function readScoped(relPath: string): string {
  return readFileSync(resolve(aiStudioRoot, relPath), 'utf8')
}

/* --------------------------------------------- ① 映射兜底：未登记不许回显原值 */

test('区域5：资产资料字段标签与后端唯一事实来源同源，未登记不给英文键（§4.5 模式 2）', () => {
  /* 审计 §4.5 第一条：`workbenchState.PROFILE_FIELD_LABEL` 手抄的表与
     `assetProfileFields.ASSET_PROFILE_FIELD_SPECS`（后端字段表的唯一事实来源）对不上，
     14 个真实后端键会整键回显英文。新口径是**消费**它，并让这条对齐机械可验证。 */
  assert.deepEqual(
    profileFieldKeysMissingLabel(),
    [],
    '后端 spec 里有键在本区域拿不到中文标签（会出现「其他资料项」丢信息或回显英文键）',
  )
  // 审计点名的 14 个键逐一点名（回归护栏：谁把它们删了就直接红）
  const audited = [
    'relations',
    'costume_accessories',
    'related_plot',
    'shot_refs',
    'era_location',
    'indoor_outdoor',
    'spatial_structure',
    'furnishings',
    'light_tone',
    'atmosphere',
    'related_events',
    'usage',
    'identity_era',
    'accessories',
  ]
  audited.forEach((key) => {
    const label = profileFieldLabel(key)
    assert.notEqual(label, key, `「${key}」被原样回显成英文键了（模式 2）`)
    assert.ok(/[\u4e00-\u9fff]/.test(label), `「${key}」的中文标签不是中文：${label}`)
  })
  // 未登记键给中文兜底（旧期望 `custom_field` 原样返回已由第 2 批同步改掉）
  assert.equal(profileFieldLabel('custom_field'), '其他资料项')
  // 标签表里的每一个值都必须是中文（防止有人再手抄一份英文进去）
  Object.entries(PROFILE_FIELD_LABEL).forEach(([key, label]) => {
    assert.ok(/[\u4e00-\u9fff]/.test(label), `标签表里「${key}」的值不是中文：${label}`)
  })
  // 断言用的是**真的后端 spec**（不是本测试自己抄一份）：四类资产的键都在标签表里
  const specKeys = ['character', 'scene', 'prop', 'costume'].flatMap((type) =>
    ASSET_PROFILE_FIELD_SPECS[type as 'character' | 'scene' | 'prop' | 'costume'].map((spec) => spec.key),
  )
  assert.ok(specKeys.length >= 30, `后端 spec 只有 ${specKeys.length} 个键，读取可能失效了`)
  specKeys.forEach((key) => {
    assert.ok(PROFILE_FIELD_LABEL[key], `后端 spec 的键「${key}」在本区域没有中文标签`)
  })
})

test('区域5：状态 / 分析状态的映射兜底都不回显后端原值（§4.5 模式 3）', () => {
  // workbenchStatusLabel：后端回英文枚举时退回本文件的中文状态词表
  assert.equal(
    workbenchStatusLabel({ asset_type: 'prop', asset_id: 'x', status: { key: 'ready', label: 'ready' } }),
    '可以生成',
  )
  assert.equal(
    workbenchStatusLabel({ asset_type: 'prop', asset_id: 'x', status: { key: 'needs_profile', label: 'partial_failed' } }),
    '待补资料',
  )
  // 后端回中文说法（不是机器码）时照旧优先用它，别把合法文案也拦掉
  assert.equal(
    workbenchStatusLabel({ asset_type: 'prop', asset_id: 'x', status: { key: 'ready', label: '可以生成图片' } }),
    '可以生成图片',
  )
  // 顶部「分析状态」：按 status 键映射，未登记给中文兜底
  assert.equal(workbenchAnalysisStatusLabel({ status: 'not_generated' }), '还没分析')
  assert.equal(workbenchAnalysisStatusLabel({ status: 'generated' }), '资料已就绪')
  assert.equal(workbenchAnalysisStatusLabel({ status: 'brand_new_code' }), WORKBENCH_ANALYSIS_STATUS_FALLBACK)
  assert.equal(
    workbenchAnalysisStatusLabel({ status: 'brand_new_code', status_label: 'generated' }),
    WORKBENCH_ANALYSIS_STATUS_FALLBACK,
    '后端回英文枚举时不许直渲 `status_label`',
  )
  assert.equal(workbenchAnalysisStatusLabel(null), '')
  // 全部返回值都必须是中文，且不含任何泄漏词
  ;[
    ...Object.values(WORKBENCH_STATUS_LABEL),
    ...Object.values(WORKBENCH_STATUS_NOTICE),
    ...Object.values(PENDING_REVIEW_REASON_MAIN_TEXT),
    WORKBENCH_ANALYSIS_STATUS_FALLBACK,
    workbenchAnalysisHintMainText({ generated: true }),
    workbenchAnalysisHintMainText({ generated: false }),
    WORKBENCH_PROMPT_REGENERATION_MAIN_TEXT,
  ].forEach((text) => {
    assert.ok(/[\u4e00-\u9fff]/.test(text), `派生文案不是中文：${text}`)
    assert.deepEqual(findMainScreenLeaks(`const __p__ = () => <div>${text}</div>`), [], `派生文案命中泄漏词：${text}`)
  })
})

test('区域5：结果类型 / 提示词来源 / 槽位码的映射兜底都不回显后端原值（§4.5 模式 3）', () => {
  /* 审计 §4.5 点名的三处：`assetResultKind.ts:146 return server`、
     `promptBoardDrafts.ts:502 ?? key`、`assetPromptSlots.ts:236 ?? category`。 */
  assert.equal(resolveResultLabel('character', 'characterReference', 'characterReference'), '人物参考图')
  assert.equal(resolveResultLabel('scene', 'scene_asset_image', 'scene_asset_image'), '场景资产图')
  assert.ok(!isRenderableResultLabel('partial_failed'))
  // 合法的中文后端标签仍然优先
  assert.equal(resolveResultLabel('scene', '场景资产图', 'sceneAssetImage'), '场景资产图')

  assert.equal(sourceLabel('weird_source'), '来源未标记')
  assert.equal(sourceLabel('external_import'), '外部导入')

  assert.equal(builtinPromptSlotLabel('brand_new_slot'), ASSET_PROMPT_SLOT_FALLBACK_TEXT)
  assert.equal(describePromptRowSlot({ supported: true, category: 'brand_new_slot', label: '' }), ASSET_PROMPT_SLOT_FALLBACK_TEXT)
  assert.equal(describePromptRowAsset({ name: 'A', type: 'actor' }), `A（${ASSET_PROMPT_TYPE_FALLBACK_TEXT}）`)
  // 登记过的槽位码照旧给中文槽位名（别把正常路径也兜掉）
  assert.equal(builtinPromptSlotLabel('character_image_front'), ASSET_PROMPT_CATEGORY_LABEL.character_image_front)
})

test('区域5：主按钮禁用原因不用后端 hint；后端 hint 只出现在折叠层（§4.5 模式 6 / §7.1-8）', () => {
  const backendHint = '本章还没有资产资料：先点「分析本章资产」。（后端给的原始说明）'
  const command = deriveWorkbenchCommand({
    items: [],
    selectedKeys: [],
    analysis: { generated: false, hint: backendHint },
  })
  // 主区那一句：写死的中文常量，不是后端句子的改写结果
  assert.ok(
    !command.primaryDisabledReason.includes('后端给的原始说明'),
    `主区又去渲后端 hint 了：${command.primaryDisabledReason}`,
  )
  assert.match(command.primaryDisabledReason, /分析本章资产/)
  // 后端原文另有出口（非主区），由折叠壳渲染
  assert.equal(command.primaryDisabledDetail, backendHint)
  const code = stripComments(readScoped('project/ProjectWorkbench/components/workbench/WorkbenchCommandBar.tsx'))
  assert.ok(!/\{analysis\.hint\}/.test(code), '主区又直接渲 `{analysis.hint}` 了')
  assert.ok(/analysisHintDetail/.test(code), '后端 hint 必须有一个非主区的出口（折叠层）')
  assert.ok(code.includes('TechnicalDetailSection'), '后端原文必须收进统一的「技术详情」折叠壳')
})

/* --------------------------------------------- ② 渲染点：主区干净 + 折叠层有原文 */

/**
 * 该文件里有没有把某个后端值**插进 JSX**（`{表达式}`，即用户不点任何东西就看得见）。
 *
 * `expr` 传**括号里面的表达式**（例如 `reason` / `item.status.reason`），不要带 `{}`。
 */
function hasJsxInterpolationOf(source: string, expr: string): boolean {
  return new RegExp(`\\{\\s*${expr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}`).test(source)
}

test('区域5：卡片正面 / 抽屉主区不再直渲 status.reason 与 quality.reasons（§4.5 模式 6）', () => {
  const card = stripComments(readScoped('project/ProjectWorkbench/components/workbench/AssetCardGrid.tsx'))
  const drawer = stripComments(readScoped('project/ProjectWorkbench/components/workbench/AssetDetailDrawer.tsx'))

  // 主区：不许把后端原文插进 JSX
  assert.ok(!hasJsxInterpolationOf(card, 'reason'), '卡片正面又把后端 reason 插进去了')
  assert.ok(
    !/item\.status\??\.reason[\s\S]{0,40}<\/?div/.test(card),
    '卡片正面仍在渲 `item.status.reason`',
  )
  assert.ok(!/\(item\.prompt\??\.quality\??\.reasons \?\? \[\]\)[\s\S]{0,80}join/.test(card), '卡片正面仍在拼 quality.reasons 数组')
  assert.ok(!hasJsxInterpolationOf(drawer, 'item.status.reason'), '资产详情抽屉主区又把后端 reason 插进去了')
  /* 只判**主区**（技术详情折叠壳的 JSX 之前的部分）：后端 reasons 数组的拼接只允许出现在折叠层里。
     用 `<TechnicalDetailSection`（带尖括号）定位 —— 导入语句里只有裸标识符，
     用 `lastIndexOf` 会切到闭合标签、用 `split` 又会退化成"只扫导入行之前"，两者都是空跑。 */
  const detailJsxAt = drawer.indexOf('<TechnicalDetailSection')
  assert.ok(detailJsxAt > 200, '找不到技术详情折叠壳的 JSX，这条断言会变成空跑')
  const drawerMainRegion = drawer.slice(0, detailJsxAt)
  assert.ok(!/\.join\('；'\)/.test(drawerMainRegion), '抽屉主区仍在拼后端 reasons 数组（只允许出现在折叠层里）')
  /* 旧形态的精确指纹：`(…reasons ?? []).filter(Boolean).join('；') || '兜底句'` —— 数组拼进主区、
     空数组时接一句兜底。新实现改成「主区写死常量 + 折叠层放原文」，这个指纹必须彻底消失。 */
  assert.ok(
    !/\.filter\(Boolean\)\.join\('；'\)\s*\|\|/.test(drawer),
    '抽屉又回到「后端 reasons 数组拼进主区、空则接兜底句」的旧形态了',
  )
  // 主区那句必须是本文件写的 / 枚举映射产出的
  assert.ok(/workbenchStatusNotice/.test(card), '卡片正面必须用「按业务状态映射」的中文结论')
  assert.ok(/workbenchStatusNotice/.test(drawer), '抽屉主区必须用「按业务状态映射」的中文结论')
  assert.ok(
    card.includes('WORKBENCH_PROMPT_REGENERATION_MAIN_TEXT'),
    '卡片正面「提示词需要重新生成」那句必须是写死的常量',
  )
  // 折叠层：后端原文必须真的出现在默认收起的统一折叠壳里（"进折叠区"与"主区干净"各自有断言）
  assert.ok(drawer.includes('TechnicalDetailSection'), '抽屉里必须有统一的「技术详情」折叠壳作为原文落点')
  assert.ok(/statusReasonDetail/.test(drawer), '后端 status.reason 必须有一个折叠层出口（不是被删掉）')
  assert.ok(/qualityReasonDetails/.test(drawer), '后端 quality.reasons 必须有一个折叠层出口（不是被删掉）')
  assert.ok(/buildUserFacingMessage/.test(drawer), '折叠层里的原文必须先过统一管道（掩码 + 洗句）')
  // 折叠壳的默认收起由唯一实现决定（不在本文件里另写 <details>）
  assert.ok(!/<details/.test(card + drawer), '不许在卡片 / 抽屉里自建折叠实现，必须复用 TechnicalDetailSection')
})

test('区域5：待处理抽屉主区只出结论，后端 reason 收进折叠层（§4.5 模式 6 / §7.1-8）', () => {
  const source = stripComments(readScoped('project/ProjectWorkbench/components/workbench/PendingReviewDrawer.tsx'))
  /* 旧形态是 `{row.reason || '需要你确认这一项该怎么处理。'}` —— 所以要判 `{row.reason`
     这个**前缀**（只判 `{row.reason}` 精确形态会漏掉带兜底的旧写法，等于空跑）。 */
  assert.ok(!/\{row\.reason\b/.test(source), '待处理抽屉又把后端 reason 直接渲在主区了')
  assert.ok(/pendingReviewReasonMainText/.test(source), '主区那句必须由类型映射产出（本仓自己写的句子）')
  assert.ok(source.includes('TechnicalDetailSection'), '后端 reason 必须收进统一的「技术详情」折叠壳')
  assert.ok(/buildUserFacingMessage/.test(source), '折叠层里的原文必须先过统一管道')
  assert.ok(!/<details/.test(source), '不许自建第二套折叠实现')
  // 纯函数层：两种 kind 都给中文结论，未登记给中文兜底
  assert.match(pendingReviewReasonMainText('alias_conflict'), /[\u4e00-\u9fff]/)
  assert.match(pendingReviewReasonMainText('costume_without_asset'), /[\u4e00-\u9fff]/)
  assert.match(pendingReviewReasonMainText('brand_new_kind'), /[\u4e00-\u9fff]/)
})

test('区域5：失败出口接上统一管道，后端原文不再进 toast（§4.5 模式 6）', () => {
  const board = stripComments(readScoped('project/ProjectWorkbench/components/EpisodeVideoPromptBoard.tsx'))
  // 管道出口真的被用上了
  assert.ok(/showUserError/.test(board), '失败出口必须走 showUserError（主区中文结论 + 原文进技术详情）')
  assert.ok(/showUserWarning/.test(board), '警告出口必须走 showUserWarning')
  // 审计 §4.5 点名的同型写法：不许再把 `error.message` 拼进 message.*
  const rawInToast = [
    /message\.\w+\(\s*`[^`]*\$\{\s*error instanceof Error \? error\.message/,
    /message\.\w+\(\s*error instanceof Error \? error\.message/,
    /message\.\w+\(\s*`镜头 \$\{code\} 申请生成租约失败/,
  ]
  rawInToast.forEach((pattern) => {
    assert.ok(!pattern.test(board), `失败出口仍在拼后端原文：${pattern.source}`)
  })
  // 「生成租约」这个开发术语不许再出现在用户可见文案里
  assert.ok(!/申请生成租约失败/.test(board), '「生成租约」是开发术语，主区文案必须换掉')
  // 巨日禄失败诊断（脱敏诊断串）必须收进折叠层，而不是扔进页面的问题清单
  assert.ok(/juriluFailureDetail/.test(board), '巨日禄失败诊断必须有折叠层出口')
  assert.ok(board.includes('TechnicalDetailSection'), '失败诊断必须收进统一的「技术详情」折叠壳')
  assert.ok(!/setIssues\(\[diag\]\)/.test(board), '诊断串又直接进了主区的问题清单')
  // 纯函数层：租约提示里的内部标识会被掩码
  const masked = formatBusyNotice('S006', '生成中（shot_id=9f3c1a2b-0000-4000-8000-000000000001）。')
  assert.ok(!masked.includes('9f3c1a2b-0000-4000-8000-000000000001'), `内部编号漏上屏：${masked}`)
})

test('区域5：逐项不可用的说明在渲染前统一过掩码（§4.5 模式 6 / §7.3 未掩码路径）', () => {
  const scoped = readScoped('project/ProjectWorkbench/components/assetPromptRequestScope.ts')
  assert.ok(/maskInternalIds/.test(scoped), 'assetPromptRequestScope 必须在渲染前过 maskInternalIds')
  assert.ok(!/label: known \?\? label/.test(readScoped('project/ProjectWorkbench/components/assetGenerationBasis.ts')))
  // 纯函数层：后端原文里的内部标识必须被掩掉
  const text = describeRowAvailability('苏晚棠', '没有可用于出图的资料（shot_id=9f3c1a2b-0000-4000-8000-000000000001）', 'file_id=abc 里补一张')
  assert.ok(!text.includes('9f3c1a2b-0000-4000-8000-000000000001'), `内部编号漏上屏：${text}`)
  assert.ok(!text.includes('file_id='), `内部编号键值漏上屏：${text}`)
  // 正常的纯中文说明原样保留（反向断言：不许过度屏蔽）
  assert.equal(
    describeRowAvailability('苏晚棠', '这一章还没有它的资料', '到「补充资产资料」里填外观'),
    '苏晚棠：这一章还没有它的资料 怎么补：到「补充资产资料」里填外观',
  )
})

/* --------------------------------------------- ③ /prompt-flow 高级选项区块 */

test('区域5：/prompt-flow 高级选项区块的收起态标题不含原始请求头名（§4.5 模式 4 / R18）', () => {
  const source = stripComments(readScoped('promptFlow/PromptFlowPage.tsx'))
  const label = /label: '高级选项（([^']*)）'/.exec(source)
  assert.ok(label, '找不到「高级选项」折叠块的标题')
  const title = label[1]
  assert.match(title, /登录凭证/, `标题必须用用户语言：${title}`)
  assert.match(title, /来源页/, `标题必须用用户语言：${title}`)
  ;['Authorization', 'Referer', 'API'].forEach((term) => {
    assert.ok(!title.includes(term), `收起态可见的标题里还有原始请求头名「${term}」：${title}`)
  })
  // 相关联的 placeholder / 错误文案也一并对齐（审计 §4.5 明确点名 :591 / :402）
  assert.ok(
    !/message\.error\('Authorization 框收到的是整串 Cookie/.test(source),
    '凭证护栏的错误文案还在用原始请求头名',
  )
  assert.ok(
    !/placeholder="[^"]*Authorization= 项"/.test(source),
    'Cookie 输入框的 placeholder 还在写原始请求头名',
  )
  /* 同型残留（§9.1-1）：枚举原名 `jurilu` / `skill` 不许出现在主区文案里，
     统一用显示名「巨日禄导入」/「一键技能生成」。判定只看**含中文的可见串**，
     代码里的枚举取值（`type TabKey = 'import' | 'export' | 'skill'`）不算。 */
  const visibleStrings = extractScanSurfaces(source).map((surface) => surface.text)
  const enumOriginalsInCopy = visibleStrings.filter(
    (text) => /来源标记\s*(?:jurilu|skill)|来源为\s*jurilu/.test(text),
  )
  assert.deepEqual(enumOriginalsInCopy, [], `主区文案里还有枚举原名：${enumOriginalsInCopy.join(' / ')}`)
})
