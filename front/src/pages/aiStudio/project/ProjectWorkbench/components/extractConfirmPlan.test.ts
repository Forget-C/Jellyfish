/**
 * 「提取候选 → 确认资产」纯逻辑的回归测试（Node 内置测试运行器，无额外依赖）。
 *
 * 覆盖三件必须说清楚的事：
 *   1. 勾选多条时，确认的**入参**（哪些候选、哪些镜头、关联到谁）与**计数**是什么；
 *   2. 逐条确认与批量确认走的是同一套判定；
 *   3. 角色「关联已有 vs 新建」和场景/道具/服装「关联已有 vs 新建」的分支都不串味。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildConfirmPlan,
  confirmKindLabel,
  countPendingSelected,
  defaultStrategyFor,
  planCounts,
  resolveConfirmTarget,
  strategyOptionsFor,
  summarizeConfirmPlan,
  type ConfirmExistenceInput,
  type ConfirmGroupInput,
} from './extractConfirmPlan.ts'
import { findInternalTerms } from './userFacingStatus.ts'

const characterGroup: ConfirmGroupInput = {
  key: 'character:林晚',
  kind: 'character',
  name: '林晚',
  candidateIds: [11, 12],
  shotIds: ['shot-1', 'shot-2'],
}

const sceneGroup: ConfirmGroupInput = {
  key: 'scene:出租屋',
  kind: 'scene',
  name: '出租屋',
  candidateIds: [21],
  shotIds: ['shot-1'],
}

const propGroup: ConfirmGroupInput = {
  key: 'prop:旧手机',
  kind: 'prop',
  name: '旧手机',
  candidateIds: [31],
  shotIds: ['shot-3'],
}

test('勾选多条 → 计划只包含勾选的行，并把候选/镜头入参原样带出', () => {
  const plan = buildConfirmPlan({
    groups: [characterGroup, sceneGroup, propGroup],
    selectedKeys: [characterGroup.key, sceneGroup.key],
    existence: {},
  })

  assert.equal(plan.items.length, 2)
  assert.deepEqual(
    plan.items.map((item) => item.key),
    [characterGroup.key, sceneGroup.key],
  )
  // 未勾选的道具**绝不能**被顺手确认
  assert.equal(
    plan.items.some((item) => item.key === propGroup.key),
    false,
  )
  assert.deepEqual(plan.items[0].candidateIds, [11, 12])
  assert.deepEqual(plan.items[0].shotIds, ['shot-1', 'shot-2'])
  assert.deepEqual(plan.items[1].candidateIds, [21])
})

test('勾选多条的计数：新建 / 关联已有 / 覆盖候选数与镜头数', () => {
  const plan = buildConfirmPlan({
    groups: [characterGroup, sceneGroup, propGroup],
    selectedKeys: [characterGroup.key, sceneGroup.key, propGroup.key],
    existence: { [sceneGroup.key]: { exists: true, assetId: 'scene-9', linkedToProject: false } },
  })

  assert.deepEqual(plan.counts, {
    total: 3,
    linkExisting: 1, // 场景命中同名资产 → 关联已有
    linkActor: 0,
    createNew: 2, // 角色与道具都没有同名资产 → 新建
    blocked: 0,
    candidateCount: 4, // 2 + 1 + 1
    shotCount: 3, // shot-1 / shot-2 / shot-3
  })
  /* 阶段 B 第 2 批（审计 §4.2「基准禁词命中」）：去掉「覆盖 N 条候选」，
     但「关联已有 / 新建」这类用户要看的确认结果**保留**（不做过度的信息削减）。 */
  assert.equal(summarizeConfirmPlan(plan), '已确认 3 项资产（关联已有 1、新建 2）')
  assert.equal(planCounts(plan.items).total, 3)
})

test('逐条确认：只带这一行，计数为 1', () => {
  const plan = buildConfirmPlan({ groups: [sceneGroup], selectedKeys: [sceneGroup.key] })
  assert.equal(plan.counts.total, 1)
  assert.equal(plan.items[0].key, sceneGroup.key)
  assert.deepEqual(plan.items[0].candidateIds, [21])
})

test('没有勾选就没有计划（页面据此禁用按钮，而不是乱猜）', () => {
  const plan = buildConfirmPlan({ groups: [characterGroup, sceneGroup], selectedKeys: [] })
  assert.equal(plan.counts.total, 0)
  assert.equal(plan.items.length, 0)
  assert.equal(summarizeConfirmPlan(plan), '还没有可确认的资产')
  assert.equal(countPendingSelected([characterGroup, sceneGroup], []), 0)
})

test('角色：默认「新建项目角色」，也可以改成「关联全局演员」', () => {
  // 默认：没有同名角色 → 新建
  assert.equal(defaultStrategyFor('character', undefined), 'create_new')
  const defaultPlan = buildConfirmPlan({ groups: [characterGroup], selectedKeys: [characterGroup.key] })
  assert.equal(defaultPlan.items[0].action, 'create_new')
  assert.equal(defaultPlan.items[0].actorId, '')
  assert.equal(defaultPlan.items[0].strategyLabel, '新建项目角色')

  // 选「关联全局演员」但没有选演员 → 不能确认，并给出原因
  const blocked = buildConfirmPlan({
    groups: [characterGroup],
    selectedKeys: [characterGroup.key],
    choices: { [characterGroup.key]: { strategy: 'link_actor', actorId: null } },
  })
  assert.equal(blocked.counts.total, 0)
  assert.equal(blocked.counts.blocked, 1)
  assert.match(blocked.blocked[0].reason, /请选择要关联的全局演员/)

  // 选了演员 → 可确认，动作是关联（新建角色时带演员绑定）
  const ready = buildConfirmPlan({
    groups: [characterGroup],
    selectedKeys: [characterGroup.key],
    choices: { [characterGroup.key]: { strategy: 'link_actor', actorId: 'actor-7' } },
  })
  assert.equal(ready.items[0].action, 'link_actor')
  assert.equal(ready.items[0].actorId, 'actor-7')
  assert.equal(ready.items[0].reuseProjectAsset, false)
  assert.equal(ready.items[0].strategyLabel, '关联全局演员（人物资产）')
})

test('角色：项目里已有同名角色 → 默认直接关联它，不重复新建', () => {
  const existence: Record<string, ConfirmExistenceInput> = {
    [characterGroup.key]: { exists: true, assetId: 'char-1', linkedToProject: true },
  }
  assert.equal(defaultStrategyFor('character', existence[characterGroup.key]), 'link_actor')

  const plan = buildConfirmPlan({
    groups: [characterGroup],
    selectedKeys: [characterGroup.key],
    existence,
  })
  assert.equal(plan.items[0].action, 'link_actor')
  assert.equal(plan.items[0].reuseProjectAsset, true)
  assert.equal(plan.items[0].targetAssetId, 'char-1')
  assert.equal(plan.counts.linkActor, 1)
  assert.equal(plan.counts.createNew, 0)
})

test('场景/道具/服装：命中同名资产 → 关联已有；没命中 → 新建', () => {
  assert.equal(defaultStrategyFor('scene', { exists: true, assetId: 'scene-1' }), 'link_existing')
  assert.equal(defaultStrategyFor('prop', { exists: false }), 'create_new')
  assert.equal(defaultStrategyFor('costume', { exists: true, assetId: null }), 'create_new')

  const linked = buildConfirmPlan({
    groups: [sceneGroup, propGroup],
    selectedKeys: [sceneGroup.key, propGroup.key],
    existence: { [sceneGroup.key]: { exists: true, assetId: 'scene-1', linkedToProject: false } },
  })
  const sceneItem = linked.items.find((item) => item.key === sceneGroup.key)
  const propItem = linked.items.find((item) => item.key === propGroup.key)
  assert.equal(sceneItem?.action, 'link_existing')
  assert.equal(sceneItem?.targetAssetId, 'scene-1')
  assert.equal(sceneItem?.reuseProjectAsset, false) // 还没进项目 → 执行时要逐镜头关联
  assert.equal(propItem?.action, 'create_new')
  assert.equal(linked.counts.linkExisting, 1)
  assert.equal(linked.counts.createNew, 1)
})

test('场景/道具/服装：选了「关联已有」却挑不到资产 → 明确拦住并说原因', () => {
  const plan = buildConfirmPlan({
    groups: [sceneGroup],
    selectedKeys: [sceneGroup.key],
    existence: { [sceneGroup.key]: { exists: false } },
    choices: { [sceneGroup.key]: { strategy: 'link_existing' } },
  })
  assert.equal(plan.counts.total, 0)
  assert.match(plan.blocked[0].reason, /没有可关联的同名资产/)

  // 用户从资产库里另挑一份 → 立即可确认，且以挑中的那份为准
  const picked = buildConfirmPlan({
    groups: [sceneGroup],
    selectedKeys: [sceneGroup.key],
    existence: { [sceneGroup.key]: { exists: false } },
    choices: { [sceneGroup.key]: { strategy: 'link_existing', targetAssetId: 'scene-42' } },
  })
  assert.equal(picked.items[0].targetAssetId, 'scene-42')
  assert.equal(picked.counts.linkExisting, 1)
})

test('已在本项目且已关联的资产：只需挂候选，不再逐镜头关联', () => {
  const resolution = resolveConfirmTarget({
    group: sceneGroup,
    existence: { exists: true, assetId: 'scene-1', linkedToProject: true },
    choice: { strategy: 'link_existing' },
  })
  assert.equal(resolution.ready, true)
  assert.equal(resolution.reuseProjectAsset, true)
  assert.equal(resolution.targetAssetId, 'scene-1')
  assert.deepEqual(resolution.blockedReason, '')
})

test('选项文案是用户语言，且不含任何内部术语', () => {
  const characterOptions = strategyOptionsFor('character').map((option) => option.label)
  assert.deepEqual(characterOptions, ['关联全局演员（人物资产）', '新建项目角色'])
  const sceneOptions = strategyOptionsFor('scene').map((option) => option.label)
  assert.deepEqual(sceneOptions, ['关联资产库已有资产', '新建资产'])
  assert.deepEqual(strategyOptionsFor('prop').map((option) => option.label), sceneOptions)
  assert.deepEqual(strategyOptionsFor('costume').map((option) => option.label), sceneOptions)

  const texts = [
    ...strategyOptionsFor('character'),
    ...strategyOptionsFor('scene'),
  ].flatMap((option) => [option.label, option.hint])
  texts.push(confirmKindLabel('character'), confirmKindLabel('scene'))
  texts.forEach((text) => assert.deepEqual(findInternalTerms(text), [], `文案不该出现内部术语：${text}`))
})
