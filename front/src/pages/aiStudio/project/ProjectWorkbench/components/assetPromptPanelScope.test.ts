/**
 * 「生成图片提示词」面板的**范围与逐项隔离**源码断言（真实事故的回归）。
 *
 * 为什么用源码断言：这一屏的行为（哪一行、发几次请求）由 React 组件把持，
 * 仓库里的前端测试是 `node --test` 纯逻辑（没有 DOM 环境），所以这里钉的是
 * **结构上不许再出现的写法** —— 出事的那两行代码一旦被改回来就会失败：
 *
 *   ① 面板不许自己再去找"资产清单"（按项目/章节拉全部、或在 `assets` 为空时回退到全部）：
 *      行集**只**能来自调用方传进来的 `assets`（用户勾选的那些）；
 *   ② 后端说"这一项没有可用于出图的资料"时，必须标在**那一行**上并**继续**后面的项
 *      （`continue`），不能当成整批失败把剩下的项一起停掉。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

function read(relative: string): string {
  return readFileSync(resolve(HERE, relative), 'utf8')
}

const PANEL = read('./AssetImagePromptLlmPanel.tsx')
const API = read('./assetProductionApi.ts')
const WORKBENCH = read('./workbench/AssetWorkbench.tsx')

/** 取出 `const loadRows = useCallback(` 到它的依赖数组结尾之间的那段（行集就是在这里建的）。 */
function loadRowsBlock(): string {
  const begin = PANEL.indexOf('const loadRows = useCallback(')
  assert.ok(begin > 0, '面板里应该有 loadRows（行集唯一的产地）')
  const end = PANEL.indexOf('草稿恢复（只读）开始', begin)
  assert.ok(end > begin, 'loadRows 里应该有草稿恢复段标记')
  return PANEL.slice(begin, end)
}

test('行集只来自传入的 assets：面板不会自己再拉一份"全部资产"', () => {
  const block = loadRowsBlock()
  // 逐项来自 props.assets
  assert.ok(block.includes('for (const asset of assets)'), '行必须逐项来自传入的 assets')

  // 面板里不许出现任何"再去拿资产清单"的入口（这些都会把没勾选的资产带进来）
  const FORBIDDEN = [
    'listEntities',
    'fetchAssetWorkbench',
    'AssetWorkbenchService',
    'toSignalAssets',
    'StudioProjectsService.getProjectApiV1StudioProjectsProjectIdAssets',
  ]
  FORBIDDEN.forEach((token) => {
    assert.ok(!PANEL.includes(token), `面板里不该出现资产清单入口：${token}`)
  })
})

test('"assets 为空就回退到全部"的写法不许存在', () => {
  // 回退到全部 = 把没勾选的资产也拿去调用模型。事故里"范围被放大"就是这类写法。
  const FORBIDDEN = [
    'assets.length ? assets :',
    'assets.length === 0 ?',
    '|| allAssets',
    '?? allAssets',
  ]
  FORBIDDEN.forEach((token) => {
    assert.ok(!PANEL.includes(token), `面板里不该有"回退到全部"的写法：${token}`)
  })
  // 空清单就是空行集（面板照实显示"已选 0 个"），不需要任何兜底
  assert.ok(!/assets\s*\.\s*length\s*\?\s*assets\s*:/.test(PANEL))
})

test('连请求都发不出去的项（没有资产 id）不进行集，并如实列出来', () => {
  const block = loadRowsBlock()
  assert.ok(block.includes('unrequestable.push'), '空 asset_id 的项必须被挡在行集之外')
  assert.ok(block.includes('setUnrequestableAssets(unrequestable)'), '挡下来的项要如实报给页面')
  assert.ok(PANEL.includes('本次不会生成'), '页面上要说清这些项本次不会生成')
  // 生成入口自己也要兜一层：绝不发一个"不知道是哪个资产"的请求
  const generateBegin = PANEL.indexOf('const generateOne = async (')
  const guardEnd = PANEL.indexOf('StudioEntitiesApi.get(', generateBegin)
  const guard = PANEL.slice(generateBegin, guardEnd)
  assert.ok(guard.includes('无法生成提示词'), 'generateOne 里要有一层空资产 id 的兜底')
})

test('"这一项没有资料"标在那一行，并继续后面的项（不整批停）', () => {
  const begin = PANEL.indexOf('readAssetPromptAvailabilityError(error)')
  assert.ok(begin > 0, '面板要识别后端"这一项没有资料"的结构化拒绝')
  const end = PANEL.indexOf('remaining.push(...targets.slice(index + 1))', begin)
  assert.ok(end > begin, '真正的失败仍然要立即停止后续（这段代码必须还在）')
  const branch = PANEL.slice(begin, end)
  // 缺资料这一条必须 continue（逐项隔离），而不是 break（整批停）
  assert.ok(branch.includes('continue'), '缺资料的那一项要 continue，继续做后面的项')
  assert.ok(!branch.includes('break'), '缺资料那一条里不许出现 break（那会把整批停掉）')
  // 标在那一行：状态 + 原因 + 怎么补
  assert.ok(branch.includes("status: 'unavailable'"), '缺资料要标在那一行的状态上')
  assert.ok(branch.includes('quality_issues'), '原因与"怎么补"要按结构化判定挂到这一行')
  assert.ok(PANEL.includes('缺资料（本次未生成）'), '这一行要有用户看得懂的状态文案')
  // 缺资料不是"失败"：重试按钮只认真正的失败（重试解决不了没资料）
  assert.ok(PANEL.includes("row.status === 'failed').length"), '「重试失败项」只统计真正的失败')
  assert.ok(PANEL.includes('其它项不受影响'), '页面要说清其它项不受影响')
})

test('每次请求都点名"这一项"，不再把整章资产装进这次生成', () => {
  // 面板逐项调用 → 请求体里点名这一项（后端据此把画像卡与可用性判定收窄到它）
  assert.ok(PANEL.includes('previewAssetImagePrompt('), '面板仍然逐项调用生成接口')
  assert.ok(API.includes('buildAssetPromptRequestScope('), '请求范围要用统一个纯函数算出来')
  assert.ok(API.includes('entity_names'), '请求里要点名这一项资产')
  assert.ok(API.includes('chapter_id'), '请求里要带当前集（全局资产的章节资料按集隔离）')
})

test('工作台把"勾选的键"与"传进面板的资产"对齐（不许过滤成空后回退全部）', () => {
  assert.ok(WORKBENCH.includes('selectPromptPanelAssets(items, selectedKeys)'), '行集要由键对齐的纯函数算出来')
  assert.ok(WORKBENCH.includes('assets={promptPanelAssets.assets}'), '面板的 assets 只能是这一份')
  // 事故写法：用出图结果区的转换函数过滤（它丢服装、键口径也不完全一致）
  assert.ok(
    !WORKBENCH.includes('toSignalAssets(data).filter'),
    '面板不许再用 toSignalAssets(data).filter(...) 拼行集',
  )
  // 勾了但这次生成不了的项要如实列出来（否则按钮上的数字与实际调用次数对不上）
  assert.ok(WORKBENCH.includes('describeSkippedPromptPanelAssets'), '跳过的项要说清为什么')
})
