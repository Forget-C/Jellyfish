/**
 * 第 2 步「资产准备」工作台的纯逻辑测试。
 *
 * 覆盖用户点名的验收点：
 *   ① 页签过滤（页签决定下方显示哪一类）；
 *   ② 全选 / 清空 / 只选未生成项（按 `status.key` 与 `batch_eligible`）；
 *   ③ 主按钮文案与禁用（参考项目 `renderGenerationCommand()` 的同一条状态机）；
 *   ④ 计数汇总（四类 + 七个业务状态）；
 *   ⑤ 状态文案映射（只用用户语言的那七个词）；
 *   ⑥ 主页面禁词不出现（派生文案 + 主界面组件源码）。
 *   ⑦ 契约未落地时的降级视图**不伪造**数据。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { scannerSelfCheck } from '../../../../components/mainScreenCopyGuard.ts'

import {
  MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS,
  MAIN_SCREEN_FORBIDDEN_TERMS,
  WORKBENCH_STATUS_LABEL,
  WORKBENCH_TAB_LABEL,
  applyWorkbenchSelection,
  countByStatus,
  countByType,
  deriveAnalysisAction,
  deriveWorkbenchCommand,
  describePendingReview,
  describePendingReviewKind,
  findMainScreenForbiddenTerms,
  isBatchEligible,
  isUngeneratedItem,
  itemsForTab,
  needsPromptRegeneration,
  profileFieldLabel,
  workbenchItemKey,
  workbenchStatusKey,
  workbenchStatusLabel,
  type WorkbenchItemLike,
} from './workbenchState.ts'

import { buildDegradedWorkbench } from './assetWorkbenchContract.ts'

/* ------------------------------------------------------------------ 测试夹具 */

function item(overrides: Partial<WorkbenchItemLike> & { asset_type: string; asset_id: string }): WorkbenchItemLike {
  return {
    name: overrides.asset_id,
    batch_eligible: true,
    status: { key: 'ready', label: '可以生成' },
    prompt: { text: '一条可用的提示词', saved: true, quality: { verdict: 'ok', reasons: [], needs_regeneration: false } },
    image: { has_image: false, has_primary: false, image_id: null, thumbnail: '', image_count: 0 },
    ...overrides,
  }
}

/** 一个覆盖全部状态的真实形状夹具。 */
function fixture(): WorkbenchItemLike[] {
  return [
    item({ asset_type: 'character', asset_id: 'char-1', name: '苏晚棠' }),
    item({
      asset_type: 'character',
      asset_id: 'char-2',
      name: '萧景琰',
      status: { key: 'needs_profile', label: '待补资料' },
      batch_eligible: false,
      prompt: { text: '', saved: false, quality: null },
    }),
    item({
      asset_type: 'character',
      asset_id: 'char-3',
      name: '太后',
      status: { key: 'has_image', label: '已有图片待选择' },
      image: { has_image: true, has_primary: false, image_id: 7, thumbnail: 'https://example.test/a.png', image_count: 1 },
    }),
    item({
      asset_type: 'character',
      asset_id: 'char-4',
      name: '丫鬟',
      status: { key: 'needs_prompt', label: '待生成提示词' },
      batch_eligible: false,
      prompt: {
        text: '旧提示词',
        saved: true,
        quality: { verdict: 'needs_regeneration', reasons: ['外观信息不足'], needs_regeneration: true },
      },
    }),
    item({
      asset_type: 'character',
      asset_id: 'char-5',
      name: '将军',
      status: { key: 'primary', label: '已定版' },
      image: { has_image: true, has_primary: true, image_id: 9, thumbnail: 'https://example.test/b.png', image_count: 1 },
    }),
    item({
      asset_type: 'character',
      asset_id: 'char-6',
      name: '刺客',
      status: { key: 'generating', label: '生成中' },
    }),
    item({
      asset_type: 'scene',
      asset_id: 'scene-1',
      name: '侯府正厅',
      status: { key: 'failed', label: '生成失败' },
    }),
    item({ asset_type: 'prop', asset_id: 'prop-1', name: '玉簪' }),
    item({ asset_type: 'prop', asset_id: 'prop-2', name: '棺材巷' }),
    item({ asset_type: 'costume', asset_id: 'costume-1', name: '嫁衣', batch_eligible: false }),
  ]
}

/* ------------------------------------------------------------ ① 页签过滤 */

test('页签只显示本类型资产，且四个页签的并集等于全部资产（同一项只出现一次）', () => {
  const items = fixture()
  const tabs = ['character', 'scene', 'prop', 'costume'] as const
  const seen: string[] = []
  tabs.forEach((tab) => {
    itemsForTab(items, tab).forEach((row) => seen.push(workbenchItemKey(row)))
  })
  assert.deepEqual(seen, items.map(workbenchItemKey))
  assert.equal(new Set(seen).size, items.length, '同一项资产在页签之间只出现一次')
  assert.equal(itemsForTab(items, 'character').length, 6)
  assert.equal(itemsForTab(items, 'scene').length, 1)
  assert.equal(itemsForTab(items, 'prop').length, 2)
  assert.equal(itemsForTab(items, 'costume').length, 1)
})

test('页签标题是四类资产的中文名（人物 / 场景 / 道具 / 服装）', () => {
  assert.deepEqual(Object.values(WORKBENCH_TAB_LABEL), ['人物', '场景', '道具', '服装'])
})

/* ------------------------------------------------------------ ② 勾选动作 */

test('「只选未生成项」按 status / batch_eligible 选：跳过已有图片、资料未补齐与旧提示词的项', () => {
  const items = fixture()
  const picked = applyWorkbenchSelection(items, [], 'ungenerated', 'character')
  // char-1（没有图片、可批量）与 char-6（生成中但无图片、可批量）入选；
  // char-2（不可批量）/ char-3（已有图片）/ char-4（提示词需重新生成）/ char-5（已定版）不入选
  assert.deepEqual(picked.sort(), ['character:char-1', 'character:char-6'])
})

test('提示词需要重新生成的项 batch_eligible 一律为假（需求 8：不进批量选择）', () => {
  const rows = fixture()
  const legacy = rows.find((row) => row.asset_id === 'char-4')
  assert.ok(legacy)
  assert.equal(needsPromptRegeneration(legacy), true)
  assert.equal(isBatchEligible(legacy), false)
  assert.equal(isUngeneratedItem(legacy), false)
  // 即使后端错误地给了 batch_eligible=true，前端也不放它进批量
  assert.equal(isBatchEligible({ ...legacy, batch_eligible: true }), false)
})

test('全选只覆盖可批量项（服装与旧提示词的项不会被全选带进批量）', () => {
  const items = fixture()
  const all = applyWorkbenchSelection(items, [], 'all', 'character')
  assert.deepEqual(all.sort(), ['character:char-1', 'character:char-3', 'character:char-5', 'character:char-6'])
  const allTabs = applyWorkbenchSelection(items, [], 'all')
  assert.ok(!allTabs.includes('costume:costume-1'))
  assert.ok(!allTabs.includes('character:char-4'))
})

test('切页签不清空其它页签的选择（跨页签累加）', () => {
  const items = fixture()
  let selected = applyWorkbenchSelection(items, [], 'ungenerated', 'character')
  selected = applyWorkbenchSelection(items, selected, 'ungenerated', 'prop')
  assert.deepEqual(selected.sort(), ['character:char-1', 'character:char-6', 'prop:prop-1', 'prop:prop-2'])
})

test('清空选择清掉全部；资产从清单里消失后它的选择也自动失效', () => {
  const items = fixture()
  assert.deepEqual(applyWorkbenchSelection(items, ['character:char-1'], 'clear'), [])
  // 不存在的键被丢掉；**其它页签**已有的选择保留（只在本页签上做增量）
  assert.deepEqual(applyWorkbenchSelection(items, ['character:char-1', 'character:no-such'], 'ungenerated', 'prop'), [
    'character:char-1',
    'prop:prop-1',
    'prop:prop-2',
  ])
})

/* ------------------------------------------------ ③ 主按钮文案与禁用推导 */

test('还没分析本章资产：任何生成按钮都不可用，标题只说「请先分析本章资产」（需求 7）', () => {
  const items = fixture()
  const selected = items.map(workbenchItemKey)
  const command = deriveWorkbenchCommand({
    items,
    selectedKeys: selected,
    analysis: { generated: false, hint: '本章还没有资产资料：先点「分析本章资产」。' },
  })
  assert.equal(command.title, '请先分析本章资产')
  assert.equal(command.primaryDisabled, true)
  assert.equal(command.regenerateDisabled, true)
  assert.match(command.primaryDisabledReason, /分析本章资产/)
  // 不出现"可以生成图片"这类误导态
  assert.ok(!command.primaryLabel.includes('（'))
})

test('已选 4 项里有 3 项待生成：主按钮带数量且可用，明细行一行汇总', () => {
  const items = fixture()
  const selected = ['character:char-1', 'character:char-6', 'scene:scene-1', 'prop:prop-1']
  const command = deriveWorkbenchCommand({ items, selectedKeys: selected, analysis: { generated: true } })
  assert.equal(command.counts.selected, 4)
  assert.equal(command.counts.generatable, 3)
  assert.equal(command.counts.generating, 1)
  // 这 3 项已经有可用的图片提示词 → 主按钮就是"批量生成图片"（提示词那一步已经做完）
  assert.equal(command.primaryAction, 'generate_images')
  assert.equal(command.primaryLabel, '批量生成选中项（3）')
  assert.equal(command.primaryDisabled, false)
  assert.equal(command.detail, '已选 4 · 待写提示词 0 · 可生成图片 3 · 提示词需重写 0 · 生成中 1')
  assert.equal(command.title, '本轮将处理 3 项资产')
})

test('只选中已有图片的项：主按钮禁用并说明去用「批量重新生成已选项」', () => {
  const items = fixture()
  const command = deriveWorkbenchCommand({
    items,
    selectedKeys: ['character:char-3', 'character:char-5'],
    analysis: { generated: true },
  })
  assert.equal(command.counts.generatable, 0)
  assert.equal(command.counts.regeneratable, 2)
  assert.equal(command.primaryDisabled, true)
  assert.match(command.primaryDisabledReason, /批量重新生成已选项/)
  assert.equal(command.regenerateLabel, '批量重新生成已选项（2）')
  assert.equal(command.regenerateDisabled, false)
})

test('只选中旧提示词的项：主按钮变成「重写图片提示词（N）」且**可用**（需求 8）', () => {
  const items = fixture()
  const command = deriveWorkbenchCommand({
    items,
    selectedKeys: ['character:char-4'],
    analysis: { generated: true },
  })
  assert.equal(command.counts.needsRegeneration, 1)
  assert.equal(command.counts.generatable, 0)
  // 用户口径：主按钮要给"下一步真正能做的事"，不能只把按钮灰掉让人无路可走
  assert.equal(command.primaryAction, 'rewrite_prompts')
  assert.equal(command.primaryDisabled, false)
  assert.equal(command.primaryLabel, '重写图片提示词（1）')
  // 可用时 primaryDisabledReason 按契约是空串；"会发生什么"由 primaryHint 承担
  assert.equal(command.primaryDisabledReason, '')
  assert.match(command.primaryHint, /重写|旧规则/)
  assert.match(command.detail, /提示词需重写 1/)
})

test('一项都没选：不给假动作，提示先勾选或点「只选未生成项」', () => {
  const command = deriveWorkbenchCommand({ items: fixture(), selectedKeys: [], analysis: { generated: true } })
  assert.equal(command.primaryDisabled, true)
  assert.match(command.primaryDisabledReason, /只选未生成项/)
  assert.equal(command.title, '选择本轮要生产的人物、场景或道具')
  assert.equal(command.detail, '已选 0 · 待写提示词 0 · 可生成图片 0 · 提示词需重写 0 · 生成中 0')
  assert.equal(command.primaryAction, 'none')
})

test('本轮正在提交：主按钮文案变成「正在提交批量任务…」且禁用（防连点）', () => {
  const command = deriveWorkbenchCommand({
    items: fixture(),
    selectedKeys: ['character:char-1'],
    busy: true,
    analysis: { generated: true },
  })
  assert.equal(command.primaryLabel, '正在提交批量任务…')
  assert.equal(command.primaryDisabled, true)
  assert.equal(command.regenerateDisabled, true)
})

test('只选中服装：**不再**说"暂不支持"（服装已走 APIMart 通道，四类平权）', () => {
  const command = deriveWorkbenchCommand({
    items: fixture(),
    selectedKeys: ['costume:costume-1'],
    analysis: { generated: true },
  })
  assert.equal(command.counts.unsupported, 0, '服装已经是受支持类型')
  assert.doesNotMatch(command.primaryDisabledReason, /暂不支持/)
  assert.doesNotMatch(command.title, /暂不支持/)
  assert.doesNotMatch(command.primaryLabel, /暂不支持/)
})

test('选中项还没写提示词：主按钮先做「生成图片提示词（N）」（资料 → 提示词 → 图片）', () => {
  const items = fixture().map((item) =>
    item.asset_type === 'character' && item.name === '苏晚棠'
      ? { ...item, prompt: { ...item.prompt, text: '' } }
      : item,
  )
  const command = deriveWorkbenchCommand({
    items,
    selectedKeys: ['character:char-1'],
    analysis: { generated: true },
  })
  assert.equal(command.counts.needsPrompt, 1)
  assert.equal(command.primaryAction, 'generate_prompts')
  assert.equal(command.primaryLabel, '生成图片提示词（1）')
  assert.equal(command.primaryDisabled, false, '有可做的事就必须可点（这正是之前缺的那个按钮）')
  assert.match(command.primaryHint, /1 次文本模型/)
  assert.match(command.title, /还没有图片提示词/)
  assert.match(command.detail, /待写提示词 1/)
})

test('分析入口：没分析过时是主按钮，分析过后降级为「重新分析本章资产」', () => {
  const before = deriveAnalysisAction({ generated: false, hint: '先分析本章资产。' })
  assert.equal(before.label, '分析本章资产')
  assert.equal(before.primary, true)
  assert.equal(before.hint, '先分析本章资产。')

  const after = deriveAnalysisAction({ generated: true, status: 'generated', hint: '资料已就绪。' })
  assert.equal(after.label, '重新分析本章资产')
  assert.equal(after.primary, false)
  assert.equal(after.staleNotice, '')
})

test('剧本改过（content_changed / stale）时给一句提醒，并说明人工内容不会被覆盖', () => {
  const changed = deriveAnalysisAction({ generated: true, status: 'stale', content_changed: true })
  assert.match(changed.staleNotice, /不会被覆盖/)
  assert.equal(deriveAnalysisAction({ generated: false, status: 'stale', content_changed: true }).staleNotice, '')
})

/* --------------------------------------------------------------- ④ 计数 */

test('四类数量与七个状态计数来自同一份清单', () => {
  const items = fixture()
  assert.deepEqual(countByType(items), { character: 6, scene: 1, prop: 2, costume: 1 })
  const status = countByStatus(items)
  assert.equal(status.ready, 4)
  assert.equal(status.needs_profile, 1)
  assert.equal(status.needs_prompt, 1)
  assert.equal(status.generating, 1)
  assert.equal(status.failed, 1)
  assert.equal(status.has_image, 1)
  assert.equal(status.primary, 1)
  assert.equal(
    Object.values(status).reduce((sum, value) => sum + value, 0),
    items.length,
  )
})

test('后端没给 status.key 时按图片 / 提示词自己推（不落到未知态）', () => {
  assert.equal(workbenchStatusKey(item({ asset_type: 'prop', asset_id: 'p1', status: null })), 'ready')
  assert.equal(
    workbenchStatusKey(item({ asset_type: 'prop', asset_id: 'p2', status: null, prompt: { text: '' } })),
    'needs_profile',
  )
  assert.equal(
    workbenchStatusKey(
      item({
        asset_type: 'prop',
        asset_id: 'p3',
        status: null,
        image: { has_image: true, has_primary: true, image_id: 1, thumbnail: '', image_count: 1 },
      }),
    ),
    'primary',
  )
})

/* --------------------------------------------------------- ⑤ 状态文案映射 */

test('状态文案只用用户点名的那七个词，绝不出现内部枚举值', () => {
  assert.deepEqual(Object.values(WORKBENCH_STATUS_LABEL), [
    '待补资料',
    '待生成提示词',
    '可以生成',
    '生成中',
    '生成失败',
    '已有图片待选择',
    '已定版',
  ])
  Object.values(WORKBENCH_STATUS_LABEL).forEach((label) => {
    assert.deepEqual(findMainScreenForbiddenTerms(label), [])
  })
  // 后端给了 label 就用后端的；没给就退回上面的表
  assert.equal(workbenchStatusLabel({ asset_type: 'prop', asset_id: 'x', status: { key: 'ready', label: '可以生成图片' } }), '可以生成图片')
  assert.equal(workbenchStatusLabel({ asset_type: 'prop', asset_id: 'x', status: { key: 'ready' } }), '可以生成')
})

test('待处理项：数量文案 + 类型中文标签（不显示后端枚举）', () => {
  assert.equal(describePendingReview(12), '待处理 12 项')
  assert.equal(describePendingReview(0), '没有待处理项')
  assert.equal(describePendingReviewKind('alias_conflict'), '名称对不上')
  assert.equal(describePendingReviewKind('same_name_other_type'), '同名不同类型')
  assert.equal(describePendingReviewKind('multiple_candidates'), '同一项有多个来源')
  assert.equal(describePendingReviewKind('costume_without_asset'), '服装还没有对应资产')
  assert.equal(describePendingReviewKind('brand_new_kind'), '需要你确认')
})

test('资料字段有中文标签，未知字段给中文兜底（绝不回显英文键）', () => {
  assert.equal(profileFieldLabel('identity'), '身份')
  assert.equal(profileFieldLabel('lighting'), '光线')
  // 这个标签会直接上资产详情抽屉的**主区**：回显英文键 = 把后端字段名印在主区
  assert.equal(profileFieldLabel('custom_field'), '其他资料项')
})

/* --------------------------------------------------------- ⑥ 禁词不出现 */

test('禁词表覆盖用户点名的每一个词', () => {
  const required = [
    '候选',
    '聚合',
    '检查中',
    '槽位',
    '项目内资产',
    '全局资产',
    '提示词质量未知',
    '最终提示词',
    '生成依据',
    '供应商',
    '任务号',
    'file_id',
  ]
  required.forEach((term) => {
    assert.ok(MAIN_SCREEN_FORBIDDEN_TERMS.includes(term), `禁词表缺少「${term}」`)
  })
})

test('主界面派生出的全部静态文案都不含禁词', () => {
  const items = fixture()
  const scenarios: string[] = []
  const commands = [
    deriveWorkbenchCommand({ items, selectedKeys: [], analysis: { generated: true } }),
    deriveWorkbenchCommand({ items, selectedKeys: ['character:char-1'], analysis: { generated: true } }),
    deriveWorkbenchCommand({ items, selectedKeys: items.map(workbenchItemKey), analysis: { generated: false, hint: '先分析。' } }),
    deriveWorkbenchCommand({ items, selectedKeys: ['character:char-4'], analysis: { generated: true } }),
    deriveWorkbenchCommand({ items, selectedKeys: ['costume:costume-1'], analysis: { generated: true } }),
    deriveWorkbenchCommand({ items, selectedKeys: ['character:char-1'], busy: true, analysis: { generated: true } }),
  ]
  commands.forEach((command) => {
    scenarios.push(command.title, command.detail, command.primaryLabel, command.primaryDisabledReason, command.regenerateLabel)
  })
  scenarios.push(...Object.values(WORKBENCH_STATUS_LABEL), ...Object.values(WORKBENCH_TAB_LABEL))
  scenarios.push(describePendingReview(12), describePendingReview(0))
  scenarios.push(deriveAnalysisAction({ generated: true, status: 'stale', content_changed: true }).staleNotice)
  scenarios.forEach((text) => {
    assert.deepEqual(findMainScreenForbiddenTerms(text), [], `主界面文案出现禁词：${text}`)
  })
})

/**
 * 主界面组件源码扫描：禁词**连注释与代码字符串都不许出现**。
 *
 * 唯一豁免文件是 `TechnicalDetailCollapse.tsx` —— 用户明确要求
 * 模型名 / 供应商 / 任务号 / `file_id` 这些放在默认收起的「技术详情」里，
 * 所以那个文件的职责就是显示它们。
 */
/**
 * 主界面组件源码里的禁词扫描。
 *
 * 阶段 B ① 的升级（审计 §8.1 区域 2「由硬编码 6 个文件扩到全目录遍历」）：
 *   - 扫描对象从**硬编码 6 个文件名**改成 `components/workbench/**` 的**.tsx 目录遍历**；
 *   - 另加 `ProjectDevInfo.tsx` —— 它原本是**第二套技术详情实现**（审计 §9 第 2 项），
 *     本批次已合并到唯一实现，所以必须进入扫描范围，否则等于豁免范围失控；
 *   - **豁免文件只有一个**：`TechnicalDetailCollapse.tsx`（它就是「技术详情」本身）。
 *
 * 为什么按 `.tsx` 过滤：渲染面 = 能产出 JSX 的文件。纯 `.ts`（`technicalView.ts` /
 * `assetWorkbenchContract.ts` / `workbenchState.ts` 等）是**第三层文本的生产者与词表定义处**，
 * 它们读契约字段名属正常（审计 §8.1 明说「这些在契约里就带」），
 * 不构成本文件要扫的「主区文案」。这条过滤是机械判据，不是人工豁免。
 */
const TECHNICAL_DETAIL_WAIVER = 'TechnicalDetailCollapse.tsx'
const TABLES_AND_TYPES_EXTRA_FILES = ['ProjectDevInfo.tsx']

function workbenchDir(): string {
  return dirname(fileURLToPath(import.meta.url))
}

function renderSurfaceFiles(): string[] {
  const dir = workbenchDir()
  const local = readdirSync(dir)
    .filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))
    .filter((name) => statSync(join(dir, name)).isFile())
  const extra = TABLES_AND_TYPES_EXTRA_FILES.map((name) => `../${name}`).filter((name) =>
    statSync(join(dir, name)).isFile(),
  )
  return [...local, ...extra].sort()
}

test('主界面组件源码里不出现禁词（唯一豁免：技术详情组件本身）', () => {
  const files = renderSurfaceFiles()
  assert.ok(files.length >= 6, `扫描范围只有 ${files.length} 个文件，目录遍历可能失效了`)
  const offenders: string[] = []
  files.forEach((file) => {
    let source = ''
    try {
      source = readFileSync(join(workbenchDir(), file), 'utf8')
    } catch {
      // 文件读不到时直接判失败（避免"文件不存在＝干净"这种假绿）
      offenders.push(`${file}：文件不存在`)
      return
    }
    if (file === TECHNICAL_DETAIL_WAIVER || file.endsWith(`/${TECHNICAL_DETAIL_WAIVER}`)) return
    MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS.forEach((term) => {
      if (source.includes(term)) offenders.push(`${file}：命中「${term}」`)
    })
  })
  assert.deepEqual(offenders, [])
})

test('豁免只有一个文件：技术详情折叠壳只在本目录的一个文件里实现', () => {
  const dir = workbenchDir()
  const sources = renderSurfaceFiles().map((file) => ({ file, source: readFileSync(join(dir, file), 'utf8') }))
  const waivers = sources.filter((item) => item.file.includes(TECHNICAL_DETAIL_WAIVER))
  assert.equal(waivers.length, 1, `豁免必须且只能有一个文件，实际：${waivers.map((item) => item.file).join('、')}`)
  // 唯一的那个文件必须真的导出统一折叠壳（否则「合并」只是名义上的）
  const waiver = waivers[0].source
  assert.ok(waiver.includes('export function TechnicalDetailSection'), '技术详情组件必须导出统一折叠壳')
  // 其它文件若渲染技术详情，必须引用统一实现，不许自建折叠标签
  const selfBuilt = sources
    .filter((item) => !item.file.includes(TECHNICAL_DETAIL_WAIVER))
    .filter((item) => item.source.includes('TechnicalDetailSection'))
    .filter((item) => !item.source.includes('TechnicalDetailCollapse'))
  assert.deepEqual(
    selfBuilt.map((item) => item.file),
    [],
    '引用统一折叠壳时必须从 TechnicalDetailCollapse 导入，不能另立一套',
  )
})

test('扫描范围自检：词表与扫描器都真的在跑（防假绿）', () => {
  // ① 词表非空
  assert.ok(MAIN_SCREEN_FORBIDDEN_SOURCE_TERMS.length >= 12, '源码级禁词表不应少于 12 词')
  // ② 扫描器注入探针必须能命中（扫描器自身有效）
  const waiverPath = join(workbenchDir(), TECHNICAL_DETAIL_WAIVER)
  const waiverSource = readFileSync(waiverPath, 'utf8')
  assert.ok(scannerSelfCheck(waiverSource), '扫描器自检失败：注入的禁词没被抓到')
  // ③ 目录遍历真的列到了文件（不是空数组假装干净）
  assert.ok(renderSurfaceFiles().length >= 6, '目录遍历没列到文件')
})

test('工作台组件目录里不放技术详情以外的内部字段（技术详情单独一个文件）', () => {
  const source = readFileSync(new URL('./AssetWorkbench.tsx', import.meta.url), 'utf8')
  assert.ok(source.includes('TechnicalDetailCollapse'), '技术详情应通过独立组件渲染')
})

/* --------------------------------------------------- ⑦ 契约未落地时的降级 */

test('降级视图只用既有接口的真实字段，不假装分析过、不编造缺失字段', () => {
  const result = buildDegradedWorkbench({
    projectId: 'p-1',
    chapterId: 'c-1',
    chapterTitle: '试稿',
    scriptChars: 1942,
    assets: [
      { id: 'char-x', name: '苏晚棠', type: 'character', hasImage: false, hasPrimary: false, hasImagePrompt: true },
      {
        id: 'char-y',
        name: '萧景琰',
        type: 'character',
        hasImage: true,
        hasPrimary: true,
        hasImagePrompt: true,
        imageId: 12,
        thumbnail: 'https://example.test/y.png',
      },
      { id: 'costume-x', name: '嫁衣', type: 'costume', hasImage: false, hasPrimary: false, hasImagePrompt: false },
    ],
  })
  assert.equal(result.source, 'degraded')
  assert.equal(result.data.analysis.generated, false)
  assert.equal(result.data.analysis.status, 'not_generated')
  /* 阶段 B 第 2 批（审计 §4.2 模式 2）：说明文案改成用户语言「资料还在准备中」，
     原期望值 `/还没有就绪/` 是钉住旧开发术语的，同批同步更新（需求文档授权）。 */
  assert.match(result.note, /资料还在准备中/)
  assert.equal(result.data.pending_review.length, 0)
  assert.equal(result.data.technical.candidates_total, 0)
  result.data.items.forEach((row) => {
    assert.equal(row.profile_digest, '', '降级视图不编造资料摘要')
    assert.equal(row.script_relation, null, '降级视图不编造剧本关系')
  })
  // 真实存在的那几个字段必须原样带过来
  const withImage = result.data.items.find((row) => row.image?.has_image)
  assert.ok(withImage)
  assert.equal(withImage.image?.thumbnail, 'https://example.test/y.png')
  assert.equal(withImage.image?.image_id, 12)
  assert.equal(withImage.status?.key, 'primary')
  // 服装不进批量
  const costume = result.data.items.find((row) => row.asset_type === 'costume')
  assert.ok(costume)
  assert.equal(costume.batch_eligible, false)
})

test('降级视图的资产键与契约视图一致（同一项资产只出现一次）', () => {
  const result = buildDegradedWorkbench({
    projectId: 'p-1',
    chapterId: 'c-1',
    chapterTitle: '试稿',
    scriptChars: 0,
    assets: [
      { id: 'a', name: 'A', type: 'character' },
      { id: 'a', name: 'A', type: 'scene' },
    ],
  })
  const keys = result.data.items.map(workbenchItemKey)
  assert.deepEqual(keys, ['character:a', 'scene:a'])
})

/* -------------------------------------- ③b 「批量生成图」常驻按钮（需求清单第 2 条第 2 项） */

test('选中项还没提示词时，主按钮是「生成图片提示词」，但「批量生成图」按钮**仍然在**', () => {
  const items = fixture()
  // char-1 有可用提示词（可生成图），char-4 提示词要重写、char-2 待补资料
  const selected = ['character:char-1', 'character:char-2', 'character:char-4']
  const command = deriveWorkbenchCommand({ items, selectedKeys: selected, analysis: { generated: true } })

  // 这就是用户报的那个状态：主按钮那一刻只提供"生成提示词"，界面上没有批量出图入口
  assert.equal(command.counts.needsPrompt, 1)
  assert.equal(command.primaryAction, 'generate_prompts')
  assert.match(command.primaryLabel, /^生成图片提示词（\d+）$/)

  // 修复后：「批量生成图」常驻且可用，数字就是这次真的会出的张数
  assert.equal(command.generateImagesCount, command.counts.generatable)
  assert.equal(command.generateImagesLabel, `批量生成图（${command.counts.generatable}）`)
  assert.equal(command.generateImagesDisabled, false)
  assert.match(command.generateImagesHint, /按张计费/)
})

test('没有可生成项时「批量生成图」禁用，并说清该先做什么（不撒谎、不给假动作）', () => {
  const items = fixture()
  // 只选资料没补齐的项：没有任何可生成项
  const command = deriveWorkbenchCommand({
    items,
    selectedKeys: ['character:char-2'],
    analysis: { generated: true },
  })
  assert.equal(command.generateImagesCount, 0)
  assert.equal(command.generateImagesDisabled, true)
  assert.equal(command.generateImagesLabel, '批量生成图')
  assert.match(command.generateImagesDisabledReason, /生成图片提示词|勾选/)
  assert.equal(command.generateImagesHint, '')
})

test('没分析过本章资产时「批量生成图」也禁用，原因是先分析（与主按钮同口径）', () => {
  const command = deriveWorkbenchCommand({
    items: fixture(),
    selectedKeys: ['character:char-1'],
    analysis: { generated: false },
  })
  assert.equal(command.generateImagesDisabled, true)
  assert.match(command.generateImagesDisabledReason, /分析本章资产/)
})

test('「全选本页签」选中的项与「批量生成图」口径一致（按钮数字 = 全选后能出的张数）', () => {
  const items = fixture()
  const allKeys = applyWorkbenchSelection(items, [], 'all', 'character')
  const command = deriveWorkbenchCommand({ items, selectedKeys: allKeys, analysis: { generated: true } })
  // 全选只收可批量项；其中"还没有图片"的项数就是批量生成图按钮上的数字
  assert.deepEqual(allKeys.sort(), ['character:char-1', 'character:char-3', 'character:char-5', 'character:char-6'])
  assert.equal(command.generateImagesCount, 1) // 只有 char-1 还没有图片
})
