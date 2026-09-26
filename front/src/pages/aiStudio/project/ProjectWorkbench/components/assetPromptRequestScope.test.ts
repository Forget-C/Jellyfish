/**
 * 图片提示词生成的**请求范围**与"这一项为什么拿不到提示词"的判定测试（真实事故的回归）。
 *
 * 现场：用户勾了 4 项，面板也只对这 4 项发请求；但每次请求如果不说清"我要的是哪一项"，
 * 后端就会把整个项目/本章的资产都装进这次生成 —— 于是一个**没被勾选**的空壳服装
 * 出现在这次生成的画像与原因里，用户勾的那几项跟着变成"不能保存"。
 *
 * 两件事在这里钉住：
 *   ① 一次请求**只点名这一项**（永远是 0 或 1 个名字，绝不是一个"全部资产"的清单）；
 *   ② 后端说"这一项没有资料"时，页面能识别出来并**只标在那一行**（继续后面的项），
 *      而真正的失败（网络/模型报错）仍然立即停止、不自动重试。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSET_PROFILE_MISSING_CODE,
  buildAssetPromptRequestScope,
  countScopedRequests,
  describeRowAvailability,
  readAssetPromptAvailabilityError,
} from './assetPromptRequestScope.ts'

test('一次请求只点名这一项资产（不会有第二个名字混进来）', () => {
  const scope = buildAssetPromptRequestScope({
    assetName: '苏晚棠',
    assetId: 'char-su',
    assetType: 'character',
  })
  assert.deepEqual(scope.entityNames, ['苏晚棠'])
  assert.equal(scope.assetId, 'char-su')
  assert.equal(scope.assetType, 'character')
  // 每次请求最多一项：4 项勾选 = 4 次请求，一次一个名字
  assert.equal(countScopedRequests(scope), 1)
})

test('名字为空时不下发点名（宁可让后端按项目装配，也不乱点名别的资产）', () => {
  const scope = buildAssetPromptRequestScope({ assetName: '   ' })
  assert.deepEqual(scope.entityNames, [])
  assert.equal(countScopedRequests(scope), 0)
  assert.equal('assetId' in scope, false)
  assert.equal('assetType' in scope, false)
})

test('点名会裁掉首尾空格（后端按归一化名称匹配）', () => {
  const scope = buildAssetPromptRequestScope({ assetName: ' 南安侯府大堂 ' })
  assert.deepEqual(scope.entityNames, ['南安侯府大堂'])
})

test('识别后端"这一项没有资料"的结构化拒绝：原因 + 怎么补一起带回来', () => {
  const error = Object.assign(new Error('生成失败'), {
    code: ASSET_PROFILE_MISSING_CODE,
    message: '你选的这几项（苏晚棠素服）在库里没有可用于出图的资料：…',
    fix: '到这一项的编辑页补全外观资料…',
    assets: ['苏晚棠素服'],
  })
  const availability = readAssetPromptAvailabilityError(error)
  assert.equal(availability.missingProfile, true)
  assert.match(availability.reason, /没有可用于出图的资料/)
  assert.match(availability.fix, /补全外观资料/)
  assert.deepEqual(availability.assets, ['苏晚棠素服'])
})

test('识别"结构化明细被拼进错误消息"的形态（统一信封的常见写法）', () => {
  const message =
    '生成失败（{"code":"asset_profile_missing","message":"你选的这几项（苏晚棠素服）在库里没有可用于出图的资料：…",' +
    '"fix":"到这一项的编辑页补全外观资料…","assets":["苏晚棠素服"]}）'
  const availability = readAssetPromptAvailabilityError(new Error(message))
  assert.equal(availability.missingProfile, true)
  assert.match(availability.reason, /没有可用于出图的资料/)
  assert.deepEqual(availability.assets, ['苏晚棠素服'])
})

test('识别嵌套在 detail 里的结构化明细', () => {
  const availability = readAssetPromptAvailabilityError({
    detail: { code: 'asset_profile_missing', message: '这一项在库里没有可用于出图的资料', fix: '先补资料' },
  })
  assert.equal(availability.missingProfile, true)
  assert.equal(availability.fix, '先补资料')
})

test('真正的失败（网络/模型报错）**不**被当成"逐项可跳过"', () => {
  const cases: unknown[] = [
    new Error('Failed to fetch'),
    new Error('模型返回的 JSON 里找不到 slots 数组。'),
    { code: 'llm_request_failed', message: '文本模型调用失败：连接超时', fix: '稍后重试' },
    null,
    undefined,
    '',
  ]
  cases.forEach((error) => {
    const availability = readAssetPromptAvailabilityError(error)
    assert.equal(availability.missingProfile, false, `不该把 ${String(error)} 当成缺资料`)
  })
})

test('读不准时也不猜：拿不到结构化结论就不声明"缺资料"', () => {
  // 只说"失败"，没有一个字提到资料 → 不能当成"这一项没资料可以跳过"
  assert.equal(readAssetPromptAvailabilityError(new Error('生成失败')).missingProfile, false)
  // 提到资料但没说"没有可用于出图的资料"（例如"资料不足"这种别的意思）→ 同样不猜
  assert.equal(readAssetPromptAvailabilityError(new Error('资产资料不足')).missingProfile, false)
})

test('缺资料那一行的话：为什么 + 怎么补都在，缺"怎么补"时不硬凑', () => {
  const full = describeRowAvailability('苏晚棠素服', '在库里没有可用于出图的资料', '先补全外观资料')
  assert.match(full, /^苏晚棠素服：/)
  assert.match(full, /没有可用于出图的资料/)
  assert.match(full, /怎么补：先补全外观资料/)

  const withoutFix = describeRowAvailability('苏晚棠素服', '在库里没有可用于出图的资料')
  assert.match(withoutFix, /没有可用于出图的资料/)
  assert.ok(!withoutFix.includes('怎么补'), '后端没给修法时不许编一句没法照做的')
})
