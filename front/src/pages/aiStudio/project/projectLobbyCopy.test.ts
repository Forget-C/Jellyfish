/**
 * 项目大厅 / 新建向导的「主区禁词扫描 0 命中」测试（阶段 B ⑤，审计 §8.1 区域 1）。
 *
 * 扫描范围（§8.1 表格第 1 行）：`project/*.tsx` + `projectStartPresets.ts` + `useProjectStyleOptions.ts`。
 * 豁免：**无**。
 *
 * 禁词表三段合一（§8.1）：
 *   1. **模式 1/2/4 正则**：UUID、内部字段名、`/api/v1`、`http(s)://`、`localhost`、内网地址、`JELLYFISH_*`；
 *   2. **模式 3 枚举原值**：**直接 import `enumLabels.ts`** 的 key 全集（映射表与测试同源）；
 *   3. **模式 2/5 逐字禁词**：主区禁词表（`供应商` / `候选` / `任务号` …）+ 模型原名全集。
 *
 * ⚠️ 扫描面**必须含 JSX 属性值**（§8.1 末段的硬要求）：
 * 运行时实测 `/models` 的 `title` 属性里就有完整本机地址，**悬停即见**，
 * 而纯文本扫描抓不到。扫描器 `mainScreenCopyGuard.ts` 因此显式区分
 * 「JSX 文本节点 / 白名单 JSX 属性值 / 含中文的字符串字面量」三类面。
 *
 * ⚠️ 扫描器自带**空转自检**（§8.1 要求）：往真实源码里注入一段已知禁词必须被抓到，
 * 否则会出现「正则写错 / 文件没读到 ＝ 干净」的假绿。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

import {
  ENUM_RAW_VALUES,
  MODEL_RAW_NAMES,
} from '../components/enumLabels.ts'
import {
  MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS,
  countScanSurfaces,
  extractScanSurfaces,
  findMainScreenLeaks,
  formatLeakHits,
  scannerSelfCheck,
} from '../components/mainScreenCopyGuard.ts'

const PROJECT_DIR = dirname(fileURLToPath(import.meta.url))

/**
 * 本区域的扫描范围（§8.1 区域 1）。
 *
 * 用「显式列名单 + 目录遍历断言」双重保险：新增文件时由第二条用例负责发现，
 * 而不是悄悄漏出扫描范围。
 */
const SCANNED_FILES: readonly string[] = [
  'ProjectLobby.tsx',
  'ProjectVisualStyleAndStyleFields.tsx',
  'ProjectWorkbench.tsx',
  'projectStartPresets.ts',
  'useProjectStyleOptions.ts',
]

function readSource(file: string): string {
  return readFileSync(join(PROJECT_DIR, file), 'utf8')
}

function listProjectDirSources(): string[] {
  return readdirSync(PROJECT_DIR)
    .filter((name) => !name.endsWith('.test.ts') && !name.endsWith('.test.tsx'))
    .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
    .filter((name) => statSync(join(PROJECT_DIR, name)).isFile())
    .sort()
}

/* --------------------------------------------------------------- 空转自检 */

test('扫描器本身有效：注入已知禁词必须被抓到（防止「扫不到＝干净」的假绿）', () => {
  SCANNED_FILES.forEach((file) => {
    const source = readSource(file)
    assert.ok(
      scannerSelfCheck(source),
      `${file}：注入的探针禁词没被抓到，说明扫描器或词表失效了（这是假绿）`,
    )
  })
})

test('扫描器确实提取到了用户可见文本面，不是空跑', () => {
  const perFile = SCANNED_FILES.map((file) => ({
    file,
    surfaces: countScanSurfaces(readSource(file)),
  }))
  const total = perFile.reduce((sum, item) => sum + item.surfaces, 0)
  assert.ok(
    total >= 150,
    `本区域只提取到 ${total} 个扫描面，明显偏少（个位数的文件可能没读到）：${JSON.stringify(perFile)}`,
  )
  // 项目大厅是本区域的主文件，扫描面必须占大头
  const lobby = perFile.find((item) => item.file === 'ProjectLobby.tsx')?.surfaces ?? 0
  assert.ok(lobby >= 80, `ProjectLobby.tsx 只提取到 ${lobby} 个扫描面，可疑`)
})

test('JSX 属性值是扫描面的一部分（§8.1 第 2/3 轮硬要求）', () => {
  // 造一段「只在属性值里有禁词」的源码：看得到才算扫描面真的覆盖了属性
  const probe = `
export function Probe() {
  return (
    <div>
      <Input placeholder="随便写点" />
      <div aria-label="供应商">正常文案</div>
      <Form.Item tooltip="留空则由模型/供应商决定" />
    </div>
  )
}
`
  const hits = findMainScreenLeaks(probe)
  const attrHits = hits.filter((hit) => hit.kind === 'jsx-attr')
  assert.ok(attrHits.length >= 2, `属性值里的禁词没被扫到，只拿到：${JSON.stringify(hits)}`)
  assert.ok(
    hits.some((hit) => hit.term === '供应商'),
    '属性值里的「供应商」必须命中',
  )
  const surfaces = extractScanSurfaces(probe)
  assert.ok(
    surfaces.some((surface) => surface.kind === 'jsx-attr' && surface.attr === 'placeholder'),
    `placeholder 没被识别成可见属性，实际扫描面：${JSON.stringify(surfaces)}`,
  )
  assert.ok(
    surfaces.some((surface) => surface.kind === 'jsx-attr' && surface.attr === 'aria-label'),
    'aria-label 没被识别成可见属性',
  )
})

/* --------------------------------------------------- ① 主区禁词 0 命中（核心） */

test('项目大厅 / 新建向导：主区禁词扫描 0 命中', () => {
  const offenders: string[] = []
  SCANNED_FILES.forEach((file) => {
    const source = readSource(file)
    offenders.push(...formatLeakHits(relative(PROJECT_DIR, join(PROJECT_DIR, file)) || file, findMainScreenLeaks(source)))
  })
  assert.deepEqual(
    offenders,
    [],
    `项目大厅主区出现泄漏（模式 1/2/4 或枚举原值或主区禁词）：\n${offenders.join('\n')}`,
  )
})

test('项目大厅：排序下拉不再把 SortKey 枚举原值上屏（§4.1 模式 2 / R1）', () => {
  const source = readSource('ProjectLobby.tsx')
  // 允许作为**内部键**出现（option 的 value），但必须同时存在对应的中文 label
  const rawKeySurfaces = extractScanSurfaces(source).filter((surface) =>
    ['createdAt', 'updatedAt', 'chapters'].some((key) => surface.text.includes(key)),
  )
  const offenders = rawKeySurfaces.filter((surface) => !/[\u4e00-\u9fff]/.test(surface.text))
  assert.deepEqual(
    offenders.map((surface) => `${surface.line} ｜ ${surface.text}`),
    [],
    '排序键不得作为**纯英文**文案上屏（要么是 option 的 value，要么和中文 label 同句）',
  )
  assert.ok(
    source.includes('创建时间'),
    '缺少「创建时间」这个中文排序口径',
  )
})

test('项目大厅：项目名折叠形态判断是纯函数且只吞「孤立项目 <编号>」形态（R2）', () => {
  const source = readSource('ProjectLobby.tsx')
  assert.ok(source.includes('displayProjectName'), '缺少项目名展示层折叠函数')
  /* 防漂移：断言源码里的正则**逐字**等于下面这份判据 —— 否则改了产品代码而测试还绿，
     等于这条口径失守（`ProjectLobby.tsx` 是 `.tsx`，`node --test` 不能直接 import）。 */
  const literal = /const ORPHAN_PROJECT_NAME_PATTERN =\s*\n\s*(\/\^.*\$\/i)/.exec(source)
  assert.ok(literal, '源码里找不到 ORPHAN_PROJECT_NAME_PATTERN 字面量')
  assert.equal(
    literal[1],
    '/^孤立项目[\\s\\u3000]+[\\w-]*[0-9a-f]{8,}[\\w-]*[\\s\\u3000]*(（迁移）|\\(迁移\\))?$/i',
    '源码正则与测试判据不一致（改口径必须同批改这里）',
  )
  const pattern = /^孤立项目[\s\u3000]+[\w-]*[0-9a-f]{8,}[\w-]*[\s\u3000]*(（迁移）|\(迁移\))?$/i
  const fold = (name: string): string => {
    const matched = pattern.exec(name.trim())
    if (!matched) return name
    return matched[1] ? '未命名项目（迁移）' : '未命名项目'
  }
  assert.equal(fold('孤立项目 script_9c3aafd08a（迁移）'), '未命名项目（迁移）')
  assert.equal(fold('孤立项目 script_9c3aafd08a'), '未命名项目')
  ;['现实都市爱情短剧', '都市喜剧', '孤立项目 1', '孤立项目', '孤立项目 我的项目', '我的项目'].forEach((name) => {
    assert.equal(fold(name), name, `正常项目名不该被改写：${name}`)
  })
  // 两个项目名上屏点都必须接上折叠函数（否则「折叠了」只是名义上的）
  const callSites = source.split('displayProjectName(').length - 1
  assert.ok(callSites >= 3, `displayProjectName 的调用点只有 ${callSites - 1} 处，可能漏了某个上屏点`)
})

/* --------------------------------------------------------------- 扫描范围守卫 */

test('本区域没有漏出扫描范围的文件（新增源码必须被登记）', () => {
  const onDisk = listProjectDirSources()
  const missing = onDisk.filter((file) => !SCANNED_FILES.includes(file))
  assert.deepEqual(
    missing,
    [],
    `这些文件在项目大厅区域里但没有被扫描（请加进 SCANNED_FILES）：${missing.join('、')}`,
  )
  const stale = SCANNED_FILES.filter((file) => !onDisk.includes(file))
  assert.deepEqual(stale, [], `SCANNED_FILES 里列了不存在的文件：${stale.join('、')}`)
})

test('词表不是空的（词源与 enumLabels 同源，新增枚举自动纳入）', () => {
  assert.ok(ENUM_RAW_VALUES.length > 50, `枚举原值词表只有 ${ENUM_RAW_VALUES.length} 个，可疑`)
  assert.ok(MODEL_RAW_NAMES.length >= 3, `模型原名词表只有 ${MODEL_RAW_NAMES.length} 个，可疑`)
  assert.ok(
    MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('供应商'),
    '主区禁词表里必须有「供应商」（审计 §4.1 点名）',
  )
  assert.ok(MAIN_SCREEN_FORBIDDEN_UNIQUE_TERMS.includes('任务号'), '主区禁词表里必须有「任务号」')
})
