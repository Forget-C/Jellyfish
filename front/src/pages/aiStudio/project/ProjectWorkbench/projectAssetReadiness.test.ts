/**
 * 「资产准备」统一数据源（`asset-readiness`）的契约与状态推进测试。
 *
 * 两个真实载荷都是从**运行中的验收后端**直接抓下来的
 * （`GET /api/v1/studio/projects/{id}/asset-readiness`，2026-09-20）：
 *
 * 1. `DEMO_PAYLOAD`：八镜验收项目，**页面连续操作完成后**（保存提示词 → 上传 PNG → 设为定版）；
 * 2. `PENDING_PAYLOAD`：小样本验收项目，四类资产都还挂着未确认的提取候选。
 *
 * 守的口径：
 * - 角色 / 场景 / 道具 / 服装走**同一组**标志（不再有「角色能判定、场景无法判定」）；
 * - 前端算出的业务状态与顶部统计必须与后端 `summary` 同源同值；
 * - 页面连续操作的四档状态能逐级推进，且「已定版」数量随之 +1。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  assetPrepInputFromReadiness,
  describeAssetPrepSummary,
  resolveAssetPrepStatus,
  summarizeAssetPrep,
} from './assetPrepStatus.ts'

type ReadinessItem = {
  asset_type: 'character' | 'scene' | 'prop' | 'costume'
  asset_id: string
  name: string
  has_pending_candidate: boolean
  has_image_prompt: boolean
  has_image: boolean
  has_primary: boolean
}

type ReadinessSummary = {
  total: number
  asset_counts: Record<string, number>
  with_image_prompt: number
  with_image: number
  with_primary: number
  done: number
  all_done: boolean
}

type ReadinessPayload = { items: ReadinessItem[]; summary: ReadinessSummary }

/** 真实载荷：八镜验收项目（页面连续操作完成之后抓的）。 */
const DEMO_PAYLOAD: ReadinessPayload = {
  items: [
    { asset_type: 'character', asset_id: '5ffc6a12', name: '林小满', has_pending_candidate: false, has_image_prompt: true, has_image: true, has_primary: true },
    { asset_type: 'character', asset_id: '863a0fa5', name: '周迟', has_pending_candidate: false, has_image_prompt: true, has_image: true, has_primary: true },
    { asset_type: 'scene', asset_id: 'asset_1789804923480', name: '场景·雨夜咖啡店（内景）', has_pending_candidate: false, has_image_prompt: true, has_image: true, has_primary: true },
    { asset_type: 'scene', asset_id: 'asset_1789883457342', name: '验收·资产准备闭环场景（内景）', has_pending_candidate: false, has_image_prompt: true, has_image: true, has_primary: true },
    { asset_type: 'prop', asset_id: 'asset_1789804934011', name: '道具·旧录音笔', has_pending_candidate: false, has_image_prompt: false, has_image: true, has_primary: true },
    { asset_type: 'costume', asset_id: 'asset_1789804944576', name: '服装·林小满米色风衣', has_pending_candidate: false, has_image_prompt: true, has_image: true, has_primary: true },
  ],
  summary: {
    total: 6,
    asset_counts: { character: 2, scene: 2, prop: 1, costume: 1 },
    with_image_prompt: 5,
    with_image: 6,
    with_primary: 6,
    done: 5,
    all_done: false,
  },
}

/** 真实载荷：小样本验收项目（四类资产都还有未确认候选）。 */
const PENDING_PAYLOAD: ReadinessPayload = {
  items: [
    { asset_type: 'character', asset_id: 'asset_1789788021358', name: '林小满', has_pending_candidate: false, has_image_prompt: false, has_image: false, has_primary: false },
    { asset_type: 'scene', asset_id: 'asset_1789788015756', name: '咖啡店', has_pending_candidate: true, has_image_prompt: false, has_image: false, has_primary: false },
    { asset_type: 'scene', asset_id: 'asset_1789788077101', name: '咖啡店 角落座位', has_pending_candidate: true, has_image_prompt: false, has_image: false, has_primary: false },
    { asset_type: 'prop', asset_id: 'asset_1789788061435', name: '旧录音笔', has_pending_candidate: true, has_image_prompt: false, has_image: false, has_primary: false },
    { asset_type: 'prop', asset_id: 'asset_1789788149569', name: '雨伞', has_pending_candidate: true, has_image_prompt: false, has_image: false, has_primary: false },
    { asset_type: 'costume', asset_id: 'asset_1789788154666', name: '林小满日常装', has_pending_candidate: true, has_image_prompt: false, has_image: false, has_primary: false },
  ],
  summary: {
    total: 6,
    asset_counts: { character: 1, scene: 2, prop: 2, costume: 1 },
    with_image_prompt: 0,
    with_image: 0,
    with_primary: 0,
    done: 0,
    all_done: false,
  },
}

function prepInputs(payload: ReadinessPayload) {
  // 显式传参：第二个参数是"提示词质量"，直接 `map(fn)` 会把下标当成它传进去
  return payload.items.map((item) => assetPrepInputFromReadiness(item))
}

function itemByName(payload: ReadinessPayload, name: string): ReadinessItem {
  const found = payload.items.find((item) => item.name === name)
  assert.ok(found, `载荷里没有 ${name}`)
  return found
}

test('真实清单：四类资产走同一组标志，逐行状态与下一步唯一', () => {
  const inputs = prepInputs(DEMO_PAYLOAD)
  const byIndex = DEMO_PAYLOAD.items.map((item, index) => ({
    item,
    status: resolveAssetPrepStatus(inputs[index]),
  }))

  // 场景（本项目里刚刚走完连续操作的这一项）应当是「已定版」
  const scene = byIndex.find((entry) => entry.item.asset_id === 'asset_1789883457342')
  assert.equal(scene?.status.key, 'done')
  assert.equal(scene?.status.label, '已定版')

  // 道具缺提示词 → 停在第一档业务动作「填提示词」（四类资产同口径：不再出现「无法判定」）
  const prop = byIndex.find((entry) => entry.item.asset_type === 'prop')
  assert.equal(prop?.status.key, 'linked_prompt_todo')
  assert.equal(prop?.status.nextActionLabel, '填提示词')

  // 角色 / 服装与场景同样由这份清单判定
  for (const entry of byIndex.filter((e) => e.item.asset_type === 'character' || e.item.asset_type === 'costume')) {
    assert.equal(entry.status.key, 'done')
  }
})

test('顶部统计（前端）与后端 summary 同源同值', () => {
  for (const payload of [DEMO_PAYLOAD, PENDING_PAYLOAD]) {
    const summary = summarizeAssetPrep(prepInputs(payload))
    assert.equal(summary.total, payload.summary.total)
    assert.equal(summary.done, payload.summary.done)
    assert.equal(summary.allDone, payload.summary.all_done)

    // 类型数量与「已有参考图」都是对同一份 items 计数（页面顶部的标签即由此而来）
    const byType: Record<string, number> = {}
    for (const item of payload.items) byType[item.asset_type] = (byType[item.asset_type] ?? 0) + 1
    assert.deepEqual(byType, payload.summary.asset_counts)
    assert.equal(payload.items.filter((item) => item.has_image).length, payload.summary.with_image)
    assert.equal(payload.items.filter((item) => item.has_image_prompt).length, payload.summary.with_image_prompt)
    assert.equal(payload.items.filter((item) => item.has_primary).length, payload.summary.with_primary)
  }
})

test('带未确认候选的项目：同类型同名的资产停在「待确认」（不跳到提示词那一步）', () => {
  const payload: ReadinessPayload = { items: [itemByName(PENDING_PAYLOAD, '咖啡店')], summary: PENDING_PAYLOAD.summary }
  const status = resolveAssetPrepStatus(prepInputs(payload)[0])
  assert.equal(status.key, 'pending_candidate')
  assert.equal(status.nextActionLabel, '确认写入')

  // 角色那一项没有同名候选 → 正常进入「待完善提示词」
  const character = resolveAssetPrepStatus(assetPrepInputFromReadiness(itemByName(PENDING_PAYLOAD, '林小满')))
  assert.equal(character.key, 'linked_prompt_todo')
})

test('页面连续操作：保存提示词 → 上传图片 → 设为定版，状态逐级推进且已定版数 +1', () => {
  // 起点：刚在页面新建并关联的场景（无提示词、无图片）
  const start: ReadinessItem = {
    asset_type: 'scene',
    asset_id: 'asset_new_scene',
    name: '验收·资产准备闭环场景（内景）',
    has_pending_candidate: false,
    has_image_prompt: false,
    has_image: false,
    has_primary: false,
  }
  const baseline: ReadinessPayload = {
    items: [...DEMO_PAYLOAD.items.slice(0, 3), start],
    summary: DEMO_PAYLOAD.summary,
  }

  const statuses = (payload: ReadinessPayload) => summarizeAssetPrep(prepInputs(payload))

  // ① 已进项目但没提示词
  assert.equal(resolveAssetPrepStatus(assetPrepInputFromReadiness(start)).label, '已关联，待完善图片提示词')
  const s0 = statuses(baseline)
  assert.equal(s0.counts.linked_prompt_todo, 1)
  assert.equal(s0.done, 3)

  // ② 页面保存图片提示词（PATCH 实体 image_prompts）→ 待出图或上传
  const afterPrompt: ReadinessItem = { ...start, has_image_prompt: true }
  const p1 = { ...baseline, items: [...baseline.items.slice(0, 3), afterPrompt] }
  assert.equal(resolveAssetPrepStatus(assetPrepInputFromReadiness(afterPrompt)).label, '提示词已就绪，待出图或上传')
  assert.equal(statuses(p1).done, 3, '只保存提示词不该让「已定版」数量变化')

  // ③ 页面同源上传本地 PNG（写进槽位 file_id）→ 已有图片，待设为定版
  const afterUpload: ReadinessItem = { ...afterPrompt, has_image: true }
  const p2 = { ...baseline, items: [...baseline.items.slice(0, 3), afterUpload] }
  assert.equal(resolveAssetPrepStatus(assetPrepInputFromReadiness(afterUpload)).label, '已有图片，待设为定版')
  assert.equal(statuses(p2).done, 3, '有图但没定版仍然不算完成')

  // ④ 页面「设为定版」（PATCH is_primary=true）→ 已定版，顶部数量 +1
  const afterPrimary: ReadinessItem = { ...afterUpload, has_primary: true }
  const p3 = { ...baseline, items: [...baseline.items.slice(0, 3), afterPrimary] }
  assert.equal(resolveAssetPrepStatus(assetPrepInputFromReadiness(afterPrimary)).label, '已定版')
  assert.equal(statuses(p3).done, 4)
  assert.equal(statuses(p3).done - statuses(p2).done, 1)
  assert.match(describeAssetPrepSummary(statuses(p3)), /4\/4 已定版/)
})
