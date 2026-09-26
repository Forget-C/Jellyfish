/**
 * 「资产准备」业务状态的回归测试。
 *
 * 关键口径：
 * 1. 五个状态按顺序推进，每一步都有唯一的下一步动作；
 * 2. 「一项定版 ≠ 整步就绪」——只有**全部**资产都到达「已定版」才 `allDone`；
 * 3. 定版状态无法判定时不宣称「已定版」（停在「待设为定版」）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSET_PREP_STATUSES,
  collectPrimaryLookupTargets,
  describeAssetPrepSummary,
  resolveAssetPrepStatus,
  summarizeAssetPrep,
} from './assetPrepStatus.ts'

test('有待确认候选 → 待确认，下一步是确认写入', () => {
  const status = resolveAssetPrepStatus({ hasPendingCandidate: true, linked: true, hasImagePrompt: true, hasImage: true })
  assert.equal(status.key, 'pending_candidate')
  assert.equal(status.nextActionLabel, '确认写入')
})

test('已进项目但没有图片提示词 → 已关联，待完善图片提示词', () => {
  const status = resolveAssetPrepStatus({ linked: true, hasImagePrompt: false })
  assert.equal(status.key, 'linked_prompt_todo')
  assert.equal(status.nextActionLabel, '填提示词')
})

test('提示词无法判定时也按「待完善提示词」处理，不跳步', () => {
  const status = resolveAssetPrepStatus({ linked: true, hasImagePrompt: null })
  assert.equal(status.key, 'linked_prompt_todo')
})

test('提示词已保存但还没有图片 → 待出图或上传', () => {
  const status = resolveAssetPrepStatus({ linked: true, hasImagePrompt: true, hasImage: false })
  assert.equal(status.key, 'prompt_ready_image_todo')
  assert.equal(status.nextActionLabel, '生成图片')
})

test('已有图片但未定版 → 待设为定版', () => {
  const status = resolveAssetPrepStatus({ linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: false })
  assert.equal(status.key, 'image_ready_primary_todo')
  assert.equal(status.nextActionLabel, '去设为定版')
})

test('定版状态无法判定时不宣称已定版', () => {
  const status = resolveAssetPrepStatus({ linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: null })
  assert.equal(status.key, 'image_ready_primary_todo')
  assert.notEqual(status.key, 'done')
})

test('全条件具备才是已定版', () => {
  const status = resolveAssetPrepStatus({ linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: true })
  assert.equal(status.key, 'done')
  assert.equal(status.nextActionLabel, '查看定版图')
})

test('一项定版不等于整步就绪（allDone 要求全部完成）', () => {
  const summary = summarizeAssetPrep([
    { linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: true },
    { linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: false },
    { linked: true, hasImagePrompt: false },
  ])
  assert.equal(summary.total, 3)
  assert.equal(summary.done, 1)
  assert.equal(summary.allDone, false, '只有一项定版不能算整步就绪')
  assert.equal(summary.counts.image_ready_primary_todo, 1)
  assert.equal(summary.counts.linked_prompt_todo, 1)
})

test('全部定版才算就绪', () => {
  const summary = summarizeAssetPrep([
    { linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: true },
    { linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: true },
  ])
  assert.equal(summary.allDone, true)
})

test('空集合不算就绪（没有资产时不应显示完成）', () => {
  assert.equal(summarizeAssetPrep([]).allDone, false)
})

test('概览文案包含各状态数量', () => {
  const summary = summarizeAssetPrep([
    { linked: true, hasImagePrompt: true, hasImage: true, hasPrimary: true },
    { linked: true, hasImagePrompt: false },
  ])
  const text = describeAssetPrepSummary(summary)
  assert.match(text, /1\/2 已定版/)
  assert.match(text, /待完善图片提示词 1/)
  assert.equal(describeAssetPrepSummary(summarizeAssetPrep([])), '还没有需要准备的资产')
})

test('提示词已保存但**判定不可用** → 不说"已就绪"，改说"需要补充"并指向补提示词', () => {
  // 存了提示词，但质量判定明确不可用（外观信息不足 / 只有名称+通用词 …）
  const status = resolveAssetPrepStatus({
    linked: true,
    hasImagePrompt: true,
    promptQuality: 'unusable',
    hasImage: false,
  })
  assert.equal(status.key, 'prompt_needs_supplement')
  assert.equal(status.nextActionLabel, '补提示词')
  assert.ok(!status.label.includes('已就绪'), status.label)
  assert.match(status.label, /需要补充/)

  // 判不出来时**不改口径**（既不宣称可用、也不宣称不可用）
  assert.equal(
    resolveAssetPrepStatus({ linked: true, hasImagePrompt: true, promptQuality: 'unknown', hasImage: false }).key,
    'prompt_ready_image_todo',
  )
  assert.equal(
    resolveAssetPrepStatus({ linked: true, hasImagePrompt: true, promptQuality: 'usable', hasImage: false }).key,
    'prompt_ready_image_todo',
  )
  // 还没存提示词时仍然是"待完善提示词"（不能因为质量未知就跳步）
  assert.equal(
    resolveAssetPrepStatus({ linked: true, hasImagePrompt: false, promptQuality: 'unusable' }).key,
    'linked_prompt_todo',
  )
  // 已有图片甚至有定版的资产，质量不可用时同样不会说"已定版"
  assert.equal(
    resolveAssetPrepStatus({
      linked: true,
      hasImagePrompt: true,
      promptQuality: 'unusable',
      hasImage: true,
      hasPrimary: true,
    }).key,
    'prompt_needs_supplement',
  )
})

test('六个状态的标签与动作齐全（页面直接用它们渲染）', () => {
  assert.deepEqual(
    Object.values(ASSET_PREP_STATUSES).map((item) => item.key),
    [
      'pending_candidate',
      'linked_prompt_todo',
      'prompt_needs_supplement',
      'prompt_ready_image_todo',
      'image_ready_primary_todo',
      'done',
    ],
  )
  for (const item of Object.values(ASSET_PREP_STATUSES)) {
    assert.ok(item.label.length > 0)
    assert.ok(item.nextActionLabel.length > 0)
    // 主界面文案里不出现"说成就绪"的错标（只有真就绪的那个状态可以用这个词）
    if (item.key !== 'prompt_ready_image_todo') {
      assert.ok(!item.label.includes('已就绪'), `${item.key} 不该说"已就绪"：${item.label}`)
    }
  }
})

/* ---------------------------------------- 第 25 个及以后必须参与就绪判定 */

function makeAssets(count: number) {
  return Array.from({ length: count }, (_, index) => ({ id: `asset-${index + 1}` }))
}

test('collectPrimaryLookupTargets 不截断：30 个资产全部参与定版检查', () => {
  const assets = makeAssets(30)
  const targets = collectPrimaryLookupTargets(assets)
  assert.equal(targets.length, 30, '不能只取前 24 个')
  assert.equal(targets[29].id, 'asset-30', '第 30 个必须在内')
})

test('第 25 个及以后没定版时，整步不能判为就绪', () => {
  const inputs = Array.from({ length: 30 }, (_, index) => ({
    linked: true,
    hasImagePrompt: true,
    hasImage: true,
    hasPrimary: index < 29, // 前 29 个已定版，第 30 个没有
  }))
  const summary = summarizeAssetPrep(inputs)
  assert.equal(summary.total, 30)
  assert.equal(summary.done, 29)
  assert.equal(summary.allDone, false, '第 30 个没定版就不能算就绪（不能被前 24 个掩盖）')
})

test('只有第 25 个没定版时同样不能就绪', () => {
  const inputs = Array.from({ length: 30 }, (_, index) => ({
    linked: true,
    hasImagePrompt: true,
    hasImage: true,
    hasPrimary: index !== 24,
  }))
  assert.equal(summarizeAssetPrep(inputs).allDone, false)
})

test('全部 30 个都定版才算就绪', () => {
  const inputs = Array.from({ length: 30 }, () => ({
    linked: true,
    hasImagePrompt: true,
    hasImage: true,
    hasPrimary: true,
  }))
  const summary = summarizeAssetPrep(inputs)
  assert.equal(summary.allDone, true)
  assert.equal(summary.done, 30)
})
