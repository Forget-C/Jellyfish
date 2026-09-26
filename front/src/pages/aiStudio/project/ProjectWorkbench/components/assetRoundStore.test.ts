/**
 * 缺陷 D5 的回归测试：刷新后**结果卡片与进度必须回来**，
 * 而且恢复是**只读**的 —— 不得因为恢复而重新提交、重复计费。
 *
 * 覆盖（用户点名）：
 *   序列化 / 反序列化、上限裁剪、不同项目互不串、恢复后不产生提交动作。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  NO_CHAPTER_SCOPE,
  RESTORED_UNFINISHED_NOTE,
  ROUND_STORE_MAX_TASKS,
  ROUND_STORE_TTL_MS,
  ROUND_STORE_VERSION,
  buildRoundSnapshot,
  clearRoundFromStorage,
  loadRoundPlan,
  parseRoundSnapshot,
  planRoundRestore,
  roundStoreKey,
  saveRoundToStorage,
  serializeRoundSnapshot,
  trimRoundTasks,
  type StorageLike,
} from './assetRoundStore.ts'
import { hasUnsettledTasks, makeSampleTask, type ProductionTask } from './assetProduction.ts'

/** 记录所有写操作的假存储：用来证明"只读恢复"确实一个字节都没写。 */
function fakeStorage(): StorageLike & { writes: string[]; removals: string[]; map: Map<string, string> } {
  const map = new Map<string, string>()
  const writes: string[] = []
  const removals: string[] = []
  return {
    map,
    writes,
    removals,
    getItem: (key: string) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key: string, value: string) => {
      writes.push(key)
      map.set(key, value)
    },
    removeItem: (key: string) => {
      removals.push(key)
      map.delete(key)
    },
  }
}

function task(key: string, patch: Partial<ProductionTask> = {}): ProductionTask {
  return makeSampleTask({ key, updatedAt: 1000, createdAt: 1000, ...patch })
}

test('存储键按 project_id + chapter_id 分键（不同项目 / 不同集互不串）', () => {
  const a1 = roundStoreKey('p1', 'ch1')
  const a2 = roundStoreKey('p1', 'ch2')
  const b1 = roundStoreKey('p2', 'ch1')
  assert.notEqual(a1, a2)
  assert.notEqual(a1, b1)
  assert.equal(a1, roundStoreKey('p1', 'ch1'))
  // 空集 → 固定的桶名，不是空字符串拼接
  assert.ok(roundStoreKey('p1', '').endsWith(`.${NO_CHAPTER_SCOPE}`))
  assert.equal(roundStoreKey('p1', null), roundStoreKey('p1', ''))
  // 没有项目 id 也不至于写出一个能撞上的键
  assert.ok(roundStoreKey('', '').includes('unknown-project'))
})

test('序列化 / 反序列化：结果与进度原样回来（含结果类型标签与画幅）', () => {
  const tasks = [
    task('character:c1#1-0', {
      status: 'done',
      resultKind: 'characterReference',
      resultLabel: '人物参考图',
      aspectRatio: '16:9',
      aspectRatioSource: 'character_reference_fixed',
      ossUrl: 'https://cdn.example.com/a.png',
      updatedAt: 2000,
    }),
    task('scene:s1#1-1', {
      status: 'failed',
      assetType: 'scene',
      resultKind: 'sceneAssetImage',
      resultLabel: '场景资产图',
      errorMessage: '上游返回失败',
      updatedAt: 3000,
    }),
  ]
  const snapshot = buildRoundSnapshot({ projectId: 'p1', chapterId: 'ch1', tasks, savedAt: 5000 })
  assert.equal(snapshot.version, ROUND_STORE_VERSION)
  assert.equal(snapshot.savedAt, 5000)
  const raw = serializeRoundSnapshot(snapshot)
  const parsed = parseRoundSnapshot(raw, { projectId: 'p1', chapterId: 'ch1', now: 6000 })
  assert.ok(parsed)
  assert.deepEqual(parsed?.tasks, tasks)
  assert.equal(parsed?.savedAt, 5000)
  // 进度数字也能照常算出来（卡片与进度条靠它）
  assert.equal(parsed?.tasks.filter((item) => item.status === 'done').length, 1)
})

test('上限裁剪：只保留最新的 N 条，且保持原来的先后顺序', () => {
  const tasks = Array.from({ length: 100 }, (_, index) =>
    task(`character:c${index}#1-${index}`, { updatedAt: 1000 + index, createdAt: 1000 + index }),
  )
  const trimmed = trimRoundTasks(tasks, 60)
  assert.equal(trimmed.length, 60)
  // 留下的是最新 40..99 条（顺序仍是旧的在前）
  assert.equal(trimmed[0].key, 'character:c40#1-40')
  assert.equal(trimmed[59].key, 'character:c99#1-99')

  const snapshot = buildRoundSnapshot({ projectId: 'p1', chapterId: 'ch1', tasks, savedAt: 1000 })
  assert.equal(snapshot.tasks.length, 60)
  const parsed = parseRoundSnapshot(serializeRoundSnapshot(snapshot), { projectId: 'p1', chapterId: 'ch1', now: 1000 })
  assert.equal(parsed?.tasks.length, 60)
  // 默认上限也生效
  assert.equal(buildRoundSnapshot({ projectId: 'p1', chapterId: '', tasks, savedAt: 1 }).tasks.length, ROUND_STORE_MAX_TASKS)
  // 条数没超就原样返回
  assert.deepEqual(trimRoundTasks(tasks.slice(0, 3), 60), tasks.slice(0, 3))
  assert.deepEqual(trimRoundTasks(tasks, 0), [])
})

test('不同项目 / 不同集的快照互不串（读的时候直接判无效）', () => {
  const storage = fakeStorage()
  const keyA = roundStoreKey('p1', 'ch1')
  saveRoundToStorage(storage, keyA, { projectId: 'p1', chapterId: 'ch1', tasks: [task('a#1', { updatedAt: 5 })], savedAt: 5 })

  // 同一个键、同一个作用域 → 能读到
  assert.equal(loadRoundPlan(storage, keyA, { projectId: 'p1', chapterId: 'ch1', now: 10 }).restored, true)
  // 换项目读同一个键 → 读不到（快照里的 projectId 不匹配）
  assert.equal(loadRoundPlan(storage, keyA, { projectId: 'p2', chapterId: 'ch1', now: 10 }).restored, false)
  // 换集 → 键不同，读不到
  assert.equal(loadRoundPlan(storage, roundStoreKey('p1', 'ch2'), { projectId: 'p1', chapterId: 'ch2', now: 10 }).restored, false)
  // 键对但作用域不匹配 → 也判无效
  assert.equal(
    parseRoundSnapshot(storage.getItem(keyA), { projectId: 'p1', chapterId: 'ch2', now: 10 }),
    null,
  )
})

test('坏数据 / 版本不符 / 过期快照一律作废，不当成本轮结果', () => {
  const now = 10 * ROUND_STORE_TTL_MS
  assert.equal(parseRoundSnapshot(null, { projectId: 'p1', chapterId: 'ch1', now }), null)
  assert.equal(parseRoundSnapshot('', { projectId: 'p1', chapterId: 'ch1', now }), null)
  assert.equal(parseRoundSnapshot('{不是 json', { projectId: 'p1', chapterId: 'ch1', now }), null)
  assert.equal(parseRoundSnapshot('{}', { projectId: 'p1', chapterId: 'ch1', now }), null)

  const valid = buildRoundSnapshot({ projectId: 'p1', chapterId: 'ch1', tasks: [task('a#1')], savedAt: 1000 })
  const wrongVersion = serializeRoundSnapshot({ ...valid, version: ROUND_STORE_VERSION + 1 })
  assert.equal(parseRoundSnapshot(wrongVersion, { projectId: 'p1', chapterId: 'ch1', now: 2000 }), null)
  // 过期：超过 TTL 直接作废（不拿几天前的进度冒充"本轮"）
  const expired = serializeRoundSnapshot({ ...valid, savedAt: 1000 })
  assert.equal(parseRoundSnapshot(expired, { projectId: 'p1', chapterId: 'ch1', now: 1000 + ROUND_STORE_TTL_MS + 1 }), null)
  assert.ok(parseRoundSnapshot(expired, { projectId: 'p1', chapterId: 'ch1', now: 1000 + ROUND_STORE_TTL_MS - 1 }))
  // 未来时间戳（时钟漂移）也不认
  assert.equal(parseRoundSnapshot(expired, { projectId: 'p1', chapterId: 'ch1', now: 1000 - 120_000 }), null)
  // 结构不对的行被过滤，整份仍可用
  const dirty = serializeRoundSnapshot({
    ...valid,
    tasks: [task('a#1'), { nope: true } as unknown as ProductionTask],
  })
  assert.equal(parseRoundSnapshot(dirty, { projectId: 'p1', chapterId: 'ch1', now: 2000 })?.tasks.length, 1)
})

test('恢复后**不产生提交动作**：只读、在途项标成已停止、没有未决状态', () => {
  const storage = fakeStorage()
  const key = roundStoreKey('p1', 'ch1')
  const tasks = [
    task('character:c1#1-0', { status: 'done', updatedAt: 10 }),
    task('character:c2#1-1', { status: 'queued', updatedAt: 20 }),
    task('character:c3#1-2', { status: 'submitting', updatedAt: 30 }),
    task('scene:s1#1-3', { status: 'generating', assetType: 'scene', updatedAt: 40 }),
    task('prop:p1#1-4', { status: 'failed', errorMessage: '上游失败', updatedAt: 50 }),
    task('prop:p2#1-5', { status: 'dry_run', updatedAt: 60 }),
  ]
  saveRoundToStorage(storage, key, { projectId: 'p1', chapterId: 'ch1', tasks, savedAt: 100 })

  const writesBefore = storage.writes.length
  const plan = loadRoundPlan(storage, key, { projectId: 'p1', chapterId: 'ch1', now: 200 })

  // 1) 恢复出了内容，但**明确不提交**
  assert.equal(plan.restored, true)
  assert.equal(plan.shouldSubmit, false)
  assert.match(plan.note, /只读，不会重新提交/)
  // 2) 只读：读的过程一个字节都没写
  assert.equal(storage.writes.length, writesBefore)
  assert.deepEqual(storage.removals, [])
  // 3) 在途项被标成"已停止"并补上说明，不会让页面以为还在跑
  assert.equal(plan.unfinishedCount, 3)
  const stopped = plan.tasks.filter((item) => item.status === 'stopped')
  assert.equal(stopped.length, 3)
  stopped.forEach((item) => assert.equal(item.note, RESTORED_UNFINISHED_NOTE))
  assert.match(plan.note, /3 项在刷新前没跑完/)
  // 4) 已完成 / 失败 / 演练占位原样保留
  assert.equal(plan.tasks.find((item) => item.key === 'character:c1#1-0')?.status, 'done')
  assert.equal(plan.tasks.find((item) => item.key === 'prop:p1#1-4')?.status, 'failed')
  assert.equal(plan.tasks.find((item) => item.key === 'prop:p2#1-5')?.status, 'dry_run')
  // 5) 恢复后的列表里**没有**未决状态 → 页面不会触发提交/轮询
  assert.equal(hasUnsettledTasks(plan.tasks), false)
  plan.tasks.forEach((item) => {
    assert.ok(!['queued', 'submitting', 'generating'].includes(item.status), item.status)
  })
})

test('空快照 / 没有存储时恢复为空，且同样不提交', () => {
  const empty = planRoundRestore(null)
  assert.equal(empty.restored, false)
  assert.equal(empty.shouldSubmit, false)
  assert.deepEqual(empty.tasks, [])
  assert.equal(empty.note, '')

  const storage = fakeStorage()
  const key = roundStoreKey('p1', 'ch1')
  const plan = loadRoundPlan(storage, key, { projectId: 'p1', chapterId: 'ch1' })
  assert.equal(plan.restored, false)
  assert.equal(plan.shouldSubmit, false)
  assert.equal(loadRoundPlan(null, key, { projectId: 'p1', chapterId: 'ch1' }).restored, false)
})

test('空列表等于清除（不留下空壳），清除后读不到', () => {
  const storage = fakeStorage()
  const key = roundStoreKey('p1', 'ch1')
  assert.equal(saveRoundToStorage(storage, key, { projectId: 'p1', chapterId: 'ch1', tasks: [task('a#1')], savedAt: 5 }), true)
  assert.equal(loadRoundPlan(storage, key, { projectId: 'p1', chapterId: 'ch1', now: 6 }).restored, true)

  // 清空结果卡片：列表为空 → 存储也清掉
  assert.equal(saveRoundToStorage(storage, key, { projectId: 'p1', chapterId: 'ch1', tasks: [], savedAt: 7 }), false)
  assert.equal(storage.getItem(key), null)
  assert.equal(loadRoundPlan(storage, key, { projectId: 'p1', chapterId: 'ch1', now: 8 }).restored, false)

  saveRoundToStorage(storage, key, { projectId: 'p1', chapterId: 'ch1', tasks: [task('a#1')], savedAt: 9 })
  clearRoundFromStorage(storage, key)
  assert.equal(storage.getItem(key), null)
})

test('存储不可用（隐私模式 / 超配额）时静默降级，不抛异常', () => {
  const broken: StorageLike = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('quota')
    },
    removeItem: () => {
      throw new Error('denied')
    },
  }
  const plan = loadRoundPlan(broken, 'k', { projectId: 'p1', chapterId: 'ch1' })
  assert.equal(plan.restored, false)
  assert.equal(plan.shouldSubmit, false)
  assert.equal(saveRoundToStorage(broken, 'k', { projectId: 'p1', chapterId: 'ch1', tasks: [task('a#1')] }), false)
  clearRoundFromStorage(broken, 'k')
  assert.equal(loadRoundPlan(null, 'k', { projectId: 'p1', chapterId: 'ch1' }).restored, false)
})
