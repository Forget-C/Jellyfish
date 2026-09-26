/**
 * 「其它小页面（模板 / 编排 / 文件 / 编辑器 / Agent）主区禁词扫描 0 命中」区域级验收测试
 * （阶段 B **第 6 批** · 审计 `site/content/docs/plans/frontend-leak-audit-2026-09-26.md` §4.6
 *  「实体管理 + 镜头 / 编辑器 / 文件 / 模板 / 编排 / Agent」一节 + §8.1 区域 6）。
 *
 * ============================ 扫描面（诚实声明，别扩大范围） ============================
 *
 * 这四个目录体量都很小（合计 5 个源码文件），所以按任务书合并成**一个**区域护栏，
 * **逐个列出**被扫描的文件（不声称覆盖这四个目录之外的东西）：
 *
 * | 文件 | 本批处理了什么 |
 * |---|---|
 * | `pages/aiStudio/prompts/PromptTemplateManager.tsx` | §4.6 模式 3：`categoryLabels[c] \|\| c` 与下拉选项的同类兜底 → 「未分类」 |
 * | `pages/aiStudio/agents/AgentManagement.tsx` | §4.6 模式 3：`typeLabelMap[type] ?? type` → 「其他」 |
 * | `pages/aiStudio/agents/AgentEdit.tsx` | §4.6 模式 3：流程节点后的 `({node.type})`（`start` / `llm` / `end`）按审计口径**去掉** |
 * | `pages/aiStudio/files/FileManager.tsx` | 审计判「已确认干净」；本批**未改动**，只纳入扫描（防回退） |
 * | `pages/aiStudio/editor/VideoEditor.tsx` | 审计判「已确认干净」（只有 `加载时间线失败`）；本批**未改动**，只纳入扫描（防回退） |
 *
 * ⚠️ 本区域没有任何行级豁免；第三层内容一律走全仓唯一的 `TechnicalDetailSection`
 * （`project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx`，审计 §8.1.1）。
 * 本区域当前**没有**任何第三层出口（这几页都是只读展示 / 表单），所以下面的专项
 * 断言按「这一批实际能验证的东西」写，不虚构折叠块。
 *
 * ⚠️ 扫描器**结构性扫不到**的三类（本批手工核对过这四个目录）：
 * 1. 非 JSX 属性、且不含中文的字符串字面量；
 * 2. 嵌套模板字符串（本批逐行核对了这 5 个文件的反引号：没有嵌套模板串）；
 * 3. 动态插值 —— 本批手工核对结果写在「手工核对登记」用例里（含不改的理由）。
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

const HERE = dirname(fileURLToPath(import.meta.url))
/** `front/src/pages/aiStudio/agents` → `front/src/pages/aiStudio` */
const AISTUDIO_ROOT = resolve(HERE, '..')

/** 本护栏的扫描面：四个目录（`agents/**` 是测试文件所在目录）。 */
const SCAN_ROOTS: readonly { readonly label: string; readonly relDir: string }[] = [
  { label: 'agents', relDir: 'agents' },
  { label: 'prompts', relDir: 'prompts' },
  { label: 'files', relDir: 'files' },
  { label: 'editor', relDir: 'editor' },
]

/** 逐个登记（防止扫描范围被悄悄缩小；新增文件必须显式登记）。 */
const REGISTERED_FILES: readonly string[] = [
  'agents/AgentEdit.tsx',
  'agents/AgentManagement.tsx',
  'editor/VideoEditor.tsx',
  'files/FileManager.tsx',
  'prompts/PromptTemplateManager.tsx',
]

/** 全仓唯一的「技术详情」实现（审计 §8.1.1：组件级豁免只能给一个文件）。 */
const TECHNICAL_DETAIL_WAIVER = 'project/ProjectWorkbench/components/workbench/TechnicalDetailCollapse.tsx'

/** 区域补充形态（共享基准表覆盖不到、而审计 §4.6 点名的）。 */
const REGION_EXTRA_PATTERNS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: '区域补充: 资产类型枚举原值', pattern: /(?<![A-Za-z0-9_])(?:character|scene|prop|costume|actor)(?![A-Za-z0-9_])/ },
  { name: '区域补充: 任务状态枚举原值', pattern: /(?<![A-Za-z0-9_])(?:pending|running|succeeded|failed)(?![A-Za-z0-9_])/ },
  { name: '区域补充: 完整公网地址', pattern: /https?:\/\/[^\s"'`<>）)，。]+/i },
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
  return SCAN_ROOTS.flatMap((root) => listSourceFiles(resolve(AISTUDIO_ROOT, root.relDir)))
    .filter((file) => !/\.test\.tsx?$/.test(file))
    .sort()
}

function relAiStudio(file: string): string {
  return relative(AISTUDIO_ROOT, file).split('\\').join('/')
}

function readScan(relPath: string): string {
  return readFileSync(resolve(AISTUDIO_ROOT, relPath), 'utf8')
}

/** 逐行去注释（不能跨行吞代码；见区域 6 其它护栏里的同款说明）。 */
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

/* --------------------------------------------------------------- 护栏自检 */

test('区域6 其它页护栏：扫描器本身有效，注入已知禁词必须被抓到（防「扫不到＝干净」的假绿）', () => {
  REGISTERED_FILES.forEach((relPath) => {
    const source = readScan(relPath)
    assert.ok(scannerSelfCheck(source), `${relPath}：注入的探针禁词没被抓到，扫描器或词表失效了`)
  })
})

test('区域6 其它页护栏：§4.6 点名的形态都能被抓到（枚举原值 / 字段名 / 地址 / 供应商）', () => {
  /* ⚠️ 探针形态有讲究（实测踩过两次）：
     ① JSX 文本里含 `=` `;` `[` `{` 会被共享扫描器判成**代码片段**整段跳过；
     ② JSX 文本里的 `http://…` 会被当成行注释起点抹白 —— 所以地址放 `title=` 属性（本身就是扫描面）。 */
  const probe = `
const raw = 'file_id 是内部字段名'
export function Probe() {
  return (
    <div title="供应商 apimart https://bucket.oss-cn-hangzhou.aliyuncs.com/prefix/a.png">
      资产类型：scene；状态：running；file_id；9f3c1a2b-0000-4000-8000-000000000001
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
  assert.ok(terms.has('模式2 内部字段名'), '`file_id` 这类字段名没被抓到')
  assert.ok(extraHits.includes('区域补充: 资产类型枚举原值'), '资产类型枚举原值（scene）没被抓到')
  assert.ok(extraHits.includes('区域补充: 任务状态枚举原值'), '任务状态枚举原值（running）没被抓到')
  assert.ok(extraHits.includes('区域补充: 完整公网地址'), '完整公网地址没被抓到')
})

test('区域6 其它页护栏：正确业务说法不许被判成泄漏（负向自检）', () => {
  assert.ok(scannerNegativeSelfCheck(), '「待确认候选」这类业务说法被判成了泄漏 —— 词表退化会造成过度整改')
  const allowed: readonly string[] = [
    '未分类',
    '其他',
    '剧情提取',
    '角色提取',
    '场景提取',
    '道具提取',
    '其他类型',
    '文件列表',
    '批量导出',
    '加载时间线失败',
    '加载 Agent 列表失败',
    '变量：{name}',
  ]
  const offenders = allowed
    .map((text) => ({ text, hits: findMainScreenLeaks(`const __probe__ = () => <div>${text}</div>`) }))
    .filter((entry) => entry.hits.length > 0)
    .map((entry) => `${entry.text} → ${JSON.stringify(entry.hits)}`)
  assert.deepEqual(offenders, [], `这些业务说法被误判成泄漏了：\n${offenders.join('\n')}`)
})

test('区域6 其它页护栏：扫描面确实提取到用户可见文案，不是空跑', () => {
  const files = scanFiles()
  assert.ok(files.length >= REGISTERED_FILES.length, `本区域只找到 ${files.length} 个源码文件，目录遍历可能失效了`)
  const total = files.reduce((sum, file) => sum + countScanSurfaces(readFileSync(file, 'utf8')), 0)
  assert.ok(total >= 60, `本区域只提取到 ${total} 个用户可见扫描面，明显偏少（遍历或提取器可能坏了）`)
})

/* ------------------------------------------- ① 主区禁词 0 命中（核心） */

/**
 * 共享扫描器的**已知假阳性**（逐条登记，沿用 `userFacingCopy.test.ts` 的登记范式）。
 *
 * 为什么会有：扫描器把 `enumLabels` 的**原值全集**当词表，而 `ok` / `llm` 这类原值
 * 同时是**普通英文词**，于是 `AgentEdit` 的模拟执行日志（`[OK] 提取完成`、`[INFO] 调用 LLM 节点...`，
 * 审计 §9.1-3 把这类占位功能记为「本轮不改」）被误报成「枚举原值直渲」。
 *
 * ⚠️ 这不是放宽：登记项必须**当前仍然存在**（否则用例失败，逼人回来清理），
 * 而且只豁免这几条文本，任何新增命中照旧失败。
 */
const SCANNER_FALSE_POSITIVES: readonly {
  readonly file: string
  readonly text: string
  readonly term: string
  readonly why: string
}[] = [
  {
    file: 'agents/AgentEdit.tsx',
    text: '[INFO] 调用 LLM 节点...',
    term: 'llm',
    why: '`llm` 是模型类别枚举原值，但这里是模拟日志里的通用技术缩写（不是渲染出来的后端值）',
  },
  {
    file: 'agents/AgentEdit.tsx',
    text: '[OK] 提取完成',
    term: 'ok',
    why: '`ok` 是出图结果枚举原值，但这里是模拟日志的状态标记（占位功能，审计 §9.1-3：本轮不改）',
  },
  {
    file: 'agents/AgentEdit.tsx',
    text: 'LLM 提取',
    term: 'llm',
    why: '同上：流程节点的中文标签里含通用缩写 LLM，不是模型名 / 供应商名（模式 5 不管这个）',
  },
]

function isRegisteredFalsePositive(relPath: string, hit: { term: string; text: string }): boolean {
  return SCANNER_FALSE_POSITIVES.some(
    (entry) => entry.file === relPath && entry.term === hit.term && hit.text.trim() === entry.text,
  )
}

test('区域6 其它页：主区禁词扫描 0 命中（基准表 + 枚举原值 + 模型原名 + 区域补充形态）', () => {
  const offenders: string[] = []
  const seenRegistered = new Set<string>()
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
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
  assert.deepEqual(offenders, [], `模板 / 编排 / 文件 / 编辑器 / Agent 页主区出现泄漏：\n${offenders.join('\n')}`)
  const stale = SCANNER_FALSE_POSITIVES.filter(
    (entry) => !seenRegistered.has(`${entry.file}|${entry.term}|${entry.text}`),
  )
  assert.deepEqual(
    stale.map((entry) => `${entry.file} ｜ ${entry.text}`),
    [],
    `这些「假阳性登记」已经不再命中 —— 请核对后删掉登记项（${stale.map((entry) => entry.why).join('；')}）`,
  )
})

test('区域6 其它页词表守卫：词源与 `enumLabels` 同源', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'), '主区禁词表里必须有「供应商」')
  ;(['scene', 'costume', 'running'] as const).forEach((raw) => {
    assert.ok(ENUM_RAW_VALUES.includes(raw), `枚举原值词表里必须有 ${raw}`)
  })
})

/* --------------------------------------- ② 渲染点口径（扫描器看不见的那类） */

test('区域6 渲染点专项：三处枚举/类型兜底都不许回显原值（§4.6 模式 3）', () => {
  const prompts = stripComments(readScan('prompts/PromptTemplateManager.tsx'))
  assert.equal(
    /categoryLabels\[selected\.category\] \|\| selected\.category/.test(prompts),
    false,
    '`categoryLabels[c] || c` 又回来了（未登记类别会显示英文原值）',
  )
  assert.ok(prompts.includes("categoryLabels[selected.category] || '未分类'"), '类别兜底必须是「未分类」')
  assert.equal(
    /fallbackCategoryLabels\[value\] \|\| value/.test(prompts),
    false,
    '下拉选项的类别兜底又回显原值了',
  )

  const agents = stripComments(readScan('agents/AgentManagement.tsx'))
  assert.equal(
    /typeLabelMap\[type\] \?\? type/.test(agents),
    false,
    '`typeLabelMap[type] ?? type` 又回来了（未登记类型码会显示英文原值）',
  )
  assert.ok(agents.includes("typeLabelMap[type] ?? '其他'"), '类型兜底必须是「其他」')

  const edit = stripComments(readScan('agents/AgentEdit.tsx'))
  assert.equal(
    /\{node\.type\}/.test(edit),
    false,
    '流程节点后的 `({node.type})`（`start` / `llm` / `end`）又回到了主区 —— 审计口径是去掉',
  )
  assert.ok(edit.includes('{node.label}'), '节点的中文标签必须保留（去掉的是英文类型码，不是节点名）')
})

test('区域6 渲染点专项：`files/**` 与 `editor/**` 的既有干净面不许回退', () => {
  const files = stripComments(readScan('files/FileManager.tsx'))
  // 审计「已确认干净」的判据：无 `storage_key` / 无 `href` / 无 `window.open`
  assert.equal(/storage_key/.test(files), false, '`files/FileManager.tsx` 出现了 `storage_key`（审计判它干净）')
  assert.equal(/window\.open/.test(files), false, '`files/FileManager.tsx` 出现了 `window.open`')
  assert.equal(/<a\s[^>]*href=/.test(files), false, '`files/FileManager.tsx` 出现了可点的原始地址链接')
  assert.ok(files.includes("message.error('加载文件失败')"), '加载失败必须是静态中文兜底（不许直渲后端原文）')

  const editor = stripComments(readScan('editor/VideoEditor.tsx'))
  assert.equal(
    /message\.error\((?!')/.test(editor),
    false,
    '`editor/VideoEditor.tsx` 的失败提示又直接渲了变量（审计判它干净：只有 `加载时间线失败`）',
  )
  assert.ok(editor.includes("message.error('加载时间线失败')"), '时间线加载失败文案被改了？审计把它记为合规样本')
})

test('区域6 渲染点专项：这几页**没有**第三层内容，因此也不该自建折叠区', () => {
  /* 判定口径（审计 §2.1）：这几页都是只读展示 / 纯表单，没有内部 ID、地址、枚举原值的展示需求，
     所以「没有技术详情折叠块」是**正确状态**；一旦有人往这里塞第三层内容，
     必须改用共享壳 `TechnicalDetailSection`，而不是自建 <details>。 */
  scanFiles().forEach((file) => {
    const relPath = relAiStudio(file)
    const code = stripComments(readFileSync(file, 'utf8'))
    assert.equal(
      /<details/.test(code),
      false,
      `${relPath} 自建了 <details> —— 第三层内容必须走共享壳 TechnicalDetailSection（审计 §8.1.1）`,
    )
    assert.equal(
      code.includes('技术详情（默认收起）'),
      false,
      `${relPath} 复制了统一折叠壳的标题文案`,
    )
  })
})

/* -------------------------------------------------------- ③ 扫描范围守卫 */

test('区域6 其它页扫描范围守卫：登记表里的文件真实存在，且都被目录遍历覆盖到', () => {
  const onDisk = scanFiles().map(relAiStudio)
  const declaredButMissing = REGISTERED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(declaredButMissing, [], `登记表里列了不存在（或已被改名）的文件：${declaredButMissing.join('、')}`)
  assert.ok(onDisk.length >= REGISTERED_FILES.length, '扫描面比登记表还小，说明遍历被缩窄了')
  const undeclared = onDisk.filter((file) => !REGISTERED_FILES.includes(file))
  assert.deepEqual(
    undeclared,
    [],
    `这些文件没被登记（新增文件必须显式登记，否则扫描范围会悄悄变大）：${undeclared.join('、')}`,
  )
})

test('区域6 其它页扫描范围守卫：四个目录都要扫到（缺一个说明遍历被缩窄）', () => {
  const dirs = new Set(scanFiles().map((file) => relAiStudio(dirname(file))))
  const missing = SCAN_ROOTS.map((root) => root.relDir).filter((dir) => !dirs.has(dir))
  assert.deepEqual(
    missing,
    [],
    `这些目录在扫描结果里一个文件都没有，说明目录遍历被缩窄了：${missing.join('、')}（实际：${[...dirs].sort().join('、')}）`,
  )
})

/* ------------------------------------------------------------ ④ 豁免守卫 */

test('区域6 其它页豁免守卫：共享折叠壳只有一个实现', () => {
  const waiver = readFileSync(resolve(AISTUDIO_ROOT, TECHNICAL_DETAIL_WAIVER), 'utf8')
  assert.ok(
    waiver.includes('技术详情（默认收起）'),
    '共享壳的标题文案变了？豁免守卫按它的标题识别「第二套实现」，必须同步',
  )
  assert.ok(waiver.includes('export function TechnicalDetailSection'), '共享壳必须导出 `TechnicalDetailSection`')
})

/* ------------------------------------------- ⑤ 手工核对登记（扫描器看不见的） */

test('区域6 手工核对登记：这四个目录里**已知未处理**的动态插值渲染点（不许悄悄增加 / 减少）', () => {
  /**
   * | 落点 | 现状 | 判定 |
   * |---|---|---|
   * | `AgentManagement.tsx` `title={agent.description}`（审计 §4.6 点名） | **悬停属性**也是扫描面（§5.5-D） | **判定不是泄漏**：可见文本与悬停文本同源（都是这条 Agent 的中文描述），去掉 `title` 只会让被 `line-clamp-2` 截断的描述再也看不到；审计点名这条是为了说明「属性值也要扫」，不是因为它含内部标识 |
   * | `mocks/data.ts:853` 的 `基于GPT-4提取主线剧情`（模型名，模式 5） | mock 数据 | **不属本批可写范围**（`mocks/**`）：它是 Agent 描述**数据**，且 `agents/**` 页面上以同源文本显示；登记为「数据侧需改」 |
   * | `FileManager.tsx` 的 `（Mock）` 后缀 | 占位功能标记 | 审计 §9.1-3：**本轮不改**（单去掉 `（Mock）` 等于谎报操作已完成），已登记为独立小任务 |
   *
   * 这条用例的作用是**上锁**：登记项被改动时断言失败，逼着下一个人回来更新这张表。
   */
  const agents = stripComments(readScan('agents/AgentManagement.tsx'))
  const registered: readonly { readonly marker: string; readonly note: string }[] = [
    { marker: 'title={agent.description}', note: 'Agent 描述的悬停全文（已判定不是泄漏，见注释表格）' },
    { marker: 'title={agent.name}', note: 'Agent 名称的悬停全文（同上）' },
  ]
  const missing = registered.filter((entry) => !agents.includes(entry.marker))
  assert.deepEqual(
    missing.map((entry) => entry.note),
    [],
    `登记在册的悬停属性找不到了 —— 要么被去掉了（请更新登记表），要么被改名了：\n${missing
      .map((entry) => entry.note)
      .join('\n')}`,
  )
  const files = stripComments(readScan('files/FileManager.tsx'))
  assert.ok(
    files.includes('（Mock）'),
    '`（Mock）` 占位标记被改动了？审计 §9.1-3 判定「本轮不改」，要改请先拍板（见登记表）',
  )
})
