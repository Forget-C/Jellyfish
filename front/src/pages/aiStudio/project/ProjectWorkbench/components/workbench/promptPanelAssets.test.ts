/**
 * 工作台选择键 → 面板资产行集 的对齐测试（真实事故的回归）。
 *
 * 现场：用户在四个页签里只勾了 4 项，顶部按钮显示「生成图片提示词（4）」，
 * 弹窗标题也说「已选 4 项」，但**面板里的行/实际发出的请求**与这个数字对不上。
 * 两个口子都要钉住：
 *   ① 行集必须**只**来自调用方传入的那些资产（没勾的一项都不许出现；没勾就是空，不回退到全部）；
 *   ② 键必须与工作台选择键**同口径**（服装不能被丢掉、未知类型不能两边各兜一套），
 *      而且本章只有资料记录、还没建出资产的项（`asset_id` 为空）不能混进来假装能生成。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  NO_ASSET_ID_REASON,
  STALE_SELECTION_REASON,
  describeSkippedPromptPanelAssets,
  describeUnrequestableAssets,
  promptPanelAssetKey,
  selectPromptPanelAssets,
} from './promptPanelAssets.ts'
import { workbenchItemKey } from './workbenchState.ts'

type Item = {
  asset_type: string
  asset_id: string
  name: string
  prompt?: { text?: string } | null
  image?: {
    has_image?: boolean
    has_primary?: boolean
    image_id?: number | null
    thumbnail?: string
  } | null
}

function item(asset_type: string, asset_id: string, name: string, extra: Partial<Item> = {}): Item {
  return { asset_type, asset_id, name, prompt: { text: '' }, image: null, ...extra }
}

const ITEMS: Item[] = [
  item('character', 'char-su', '苏晚棠'),
  item('character', 'char-wu', '乌鸦'),
  item('scene', 'scene-hall', '南安侯府大堂'),
  item('prop', 'prop-coffin', '棺材'),
  item('costume', 'costume-su', '苏晚棠素服'),
  // 本章只有资料记录、还没建出真实资产：勾了也不能生成
  item('costume', '', '叶老夫人常服'),
]

const SELECTED = [
  'character:char-su',
  'character:char-wu',
  'scene:scene-hall',
  'prop:prop-coffin',
]

test('只勾 4 项：行集就是这 4 项，未勾选的一项都不出现', () => {
  const { assets, skipped } = selectPromptPanelAssets(ITEMS, SELECTED)

  assert.deepEqual(
    assets.map((asset) => asset.name),
    ['苏晚棠', '乌鸦', '南安侯府大堂', '棺材'],
  )
  assert.deepEqual(
    assets.map((asset) => promptPanelAssetKey(asset)),
    SELECTED,
  )
  // 「苏晚棠素服」「叶老夫人常服」一个都没被带进来
  assert.ok(!assets.some((asset) => asset.name.includes('素服') || asset.name.includes('常服')))
  assert.equal(skipped.length, 0)
})

test('每一行的键都在选择键里（键对齐：面板按这个键逐项发请求）', () => {
  const { assets } = selectPromptPanelAssets(ITEMS, SELECTED)
  assets.forEach((asset) => {
    assert.ok(SELECTED.includes(promptPanelAssetKey(asset)))
    // 与工作台的选择键必须是同一个口径（同一条函数算出来的）
    assert.equal(promptPanelAssetKey(asset), `${asset.type}:${asset.id}`)
  })
})

test('一件服装被勾选时**不丢**（服装也有提示词槽位，能生成）', () => {
  const { assets } = selectPromptPanelAssets(ITEMS, ['costume:costume-su'])
  assert.deepEqual(
    assets.map((asset) => asset.name),
    ['苏晚棠素服'],
  )
  assert.equal(assets[0].type, 'costume')
})

test('一项都没勾 → 空行集（绝不回退成"全部资产"）', () => {
  const { assets, skipped } = selectPromptPanelAssets(ITEMS, [])
  assert.deepEqual(assets, [])
  assert.deepEqual(skipped, [])
})

test('勾了"只有资料记录、还没建出资产"的项：不进行集，如实说明为什么', () => {
  const { assets, skipped } = selectPromptPanelAssets(ITEMS, ['costume:'])
  assert.deepEqual(assets, [])
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].name, '叶老夫人常服')
  assert.equal(skipped[0].reason, NO_ASSET_ID_REASON)
  // 原因是用户语言：说清"为什么生成不了 + 先做什么"
  assert.match(skipped[0].reason, /还没有建出对应资产/)
  assert.match(skipped[0].reason, /资产准备页/)
})

test('勾了但清单里已经没有这一项：如实说出来，不静默消失', () => {
  const { assets, skipped } = selectPromptPanelAssets(ITEMS, ['scene:scene-gone'])
  assert.deepEqual(assets, [])
  assert.equal(skipped.length, 1)
  assert.equal(skipped[0].key, 'scene:scene-gone')
  assert.equal(skipped[0].reason, STALE_SELECTION_REASON)
})

test('同一项资产不会出现两次（键去重）', () => {
  const duplicated = [...ITEMS, item('character', 'char-su', '苏晚棠')]
  const { assets } = selectPromptPanelAssets(duplicated, ['character:char-su'])
  assert.equal(assets.length, 1)
})

test('未知资产类型：键与工作台完全一致（两边不许各兜一套）', () => {
  const weird = [item('faction', 'faction-1', '侯府阵营')]
  // 工作台的选择键把未知类型兜底成角色；面板必须用同一个键，否则会"过滤成空"
  const key = workbenchItemKey(weird[0])
  assert.equal(key, 'character:faction-1')
  const { assets } = selectPromptPanelAssets(weird, [key])
  assert.equal(assets.length, 1)
  assert.equal(promptPanelAssetKey(assets[0]), key)
})

test('跳过的项拼成一句中文说明（空 → 空串，页面不显示空提示）', () => {
  assert.equal(describeSkippedPromptPanelAssets([]), '')
  const line = describeSkippedPromptPanelAssets([
    { key: 'costume:', name: '叶老夫人常服', reason: NO_ASSET_ID_REASON },
  ])
  assert.match(line, /叶老夫人常服/)
  assert.match(line, /还没有建出对应资产/)
})

test('已保存提示词的状态如实带过来（面板据此判"只补缺失项"）', () => {
  const rows = [item('character', 'char-su', '苏晚棠', { prompt: { text: '素白襦裙' } })]
  const { assets } = selectPromptPanelAssets(rows, ['character:char-su'])
  assert.equal(assets[0].hasImagePrompt, true)
})

test('"有 N 项还没有建出对应资产"的中文说明：空 → 空串，有项就逐项列出来', () => {
  assert.equal(describeUnrequestableAssets([]), '')
  assert.equal(describeUnrequestableAssets(['  ', '']), '')
  const line = describeUnrequestableAssets(['叶老夫人常服', '昭昭丧服'])
  assert.match(line, /有 2 项还没有建出对应资产/)
  assert.match(line, /叶老夫人常服、昭昭丧服/)
  // 用户语言：不出现内部字段名
  assert.ok(!line.includes('asset_id'))
})
