/**
 * 「默认勾选 / 确认全部推荐」口径的回归测试（第三部分要求三）。
 *
 * 守两件事：
 * 1. 明确匹配（预选 + 未绑定）默认勾选，并进入「确认全部推荐」；
 * 2. 多候选 / 冲突 / 已绑定**绝不**被自动勾选，必须由人决定。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  autoConfirmableRows,
  describeRecommendationReason,
  isDefaultChecked,
  requiresUserChoice,
} from './bindingRecommendationRules.ts'

const autoUnbound = { tier: 'auto', agreement: 'both', already_bound: false }
const autoBound = { tier: 'auto', agreement: 'both', already_bound: true }
const reviewConflict = { tier: 'review', agreement: 'conflict', already_bound: false }
const reviewOnly = { tier: 'review', agreement: 'heuristic_only', already_bound: false }
const discard = { tier: 'discard', agreement: 'llm_only', already_bound: false }

test('明确匹配且未绑定 → 默认勾选', () => {
  assert.equal(isDefaultChecked(autoUnbound), true)
  assert.equal(requiresUserChoice(autoUnbound), false)
  assert.match(describeRecommendationReason(autoUnbound), /默认勾选/)
})

test('已绑定的预选项不再默认勾选（避免重复写入）', () => {
  assert.equal(isDefaultChecked(autoBound), false)
  assert.equal(requiresUserChoice(autoBound), true)
})

test('冲突 / 需复核 / 已丢弃 → 一律要求用户自己决定', () => {
  for (const row of [reviewConflict, reviewOnly, discard]) {
    assert.equal(isDefaultChecked(row), false, `${row.tier}/${row.agreement} 不该被自动勾选`)
    assert.equal(requiresUserChoice(row), true)
  }
  assert.match(describeRecommendationReason(reviewConflict), /冲突/)
  assert.match(describeRecommendationReason(discard), /丢弃/)
})

test('「确认全部推荐」只取默认勾选的那些（不替用户决定冲突项）', () => {
  const rows = [autoUnbound, reviewConflict, reviewOnly, autoBound, discard]
  const picked = autoConfirmableRows(rows)
  assert.deepEqual(picked, [autoUnbound])
})

test('没有可一键确认的项时返回空数组（页面据此提示而不是乱写库）', () => {
  // DRY_RUN 下不会真实调用大模型：建议全部是「仅规则命中」→ 都是需复核，确认全部推荐为空
  assert.deepEqual(autoConfirmableRows([reviewOnly, reviewConflict]), [])
})
