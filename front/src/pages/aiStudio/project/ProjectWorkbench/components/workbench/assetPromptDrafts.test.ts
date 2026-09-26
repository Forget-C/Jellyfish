/**
 * 「生成图片提示词的未保存草稿」的回归测试。
 *
 * 这一份钉的是**真实事故**：工作台点一次「生成图片提示词（N）」= N 次真实付费调用，
 * 结果还没点「保存到资产」页面就被关掉 —— 已经付过费的正文必须活过刷新。
 *
 * 覆盖（用户点名）：
 *   写入 / 读回、按项目 + 集隔离、同键覆盖、过期作废、上限淘汰、
 *   序列化容错（脏数据不炸），以及「恢复路径不含任何提交入口」的**结构性**断言。
 *
 * 结构性断言分两层（钱的问题不能只靠肉眼点页面确认）：
 *   1. 运行时：恢复计划恒定 `shouldSave: false` / `shouldGenerate: false`，
 *      且"读回"过程对假存储**零写入、零删除**；
 *   2. 源码：本模块整份 + 面板里被标记圈起来的"草稿恢复（只读）"那一段，
 *      不许出现任何生成 / 保存入口的名字。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  ASSET_PROMPT_DRAFT_MAX_ENTRIES,
  ASSET_PROMPT_DRAFT_TTL_MS,
  ASSET_PROMPT_DRAFT_VERSION,
  assetPromptDraftEntryKey,
  assetPromptDraftStoreKey,
  buildAssetPromptDraftSnapshot,
  buildRestoredDraftLine,
  buildRestoredDraftRowFields,
  clearAssetPromptDraft,
  describeAssetPromptDraftTime,
  loadAssetPromptDraftPlan,
  loadAssetPromptDraftRestorePlan,
  matchAssetPromptDraftEntries,
  parseAssetPromptDraftSnapshot,
  planAssetPromptDraftRestore,
  readAssetPromptDraftEntries,
  removeAssetPromptDraftFromStorage,
  resolveRestoredDraftSaveGuard,
  sanitizeAssetPromptDraftEntry,
  saveAssetPromptDraft,
  saveAssetPromptDraftToStorage,
  serializeAssetPromptDraftSnapshot,
  trimAssetPromptDraftEntries,
  upsertAssetPromptDraftEntry,
  type AssetPromptDraftEntry,
  type StorageLike,
} from './assetPromptDrafts.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

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

const NOW = 1_700_000_000_000

function entry(patch: Partial<AssetPromptDraftEntry> = {}): AssetPromptDraftEntry {
  return {
    assetType: 'character',
    assetId: 'c1',
    assetName: '林知夏',
    slot: 'character_image_front',
    prompt: '二十九岁女性，齐肩黑发，深灰风衣，站姿正面，纯白背景',
    llmCalled: true,
    latencyMs: 1200,
    warnings: [],
    basisSummary: '本次用到：剧本/分镜 2 项 / 规范化资料 4 项 / 项目风格',
    qualityLabel: '提示词包含外观信息',
    qualityReason: '这条提示词里写了主体的外观描述，可以按它出图。',
    savable: true,
    savedAt: NOW,
    ...patch,
  }
}

test('存储键按 project_id + chapter_id 分键（不同项目 / 不同集互不串）', () => {
  const a1 = assetPromptDraftStoreKey('p1', 'ch1')
  const a2 = assetPromptDraftStoreKey('p1', 'ch2')
  const b1 = assetPromptDraftStoreKey('p2', 'ch1')
  assert.notEqual(a1, a2)
  assert.notEqual(a1, b1)
  assert.equal(a1, assetPromptDraftStoreKey('p1', 'ch1'))
  // 空集 → 固定的桶名，不是空字符串拼接
  assert.ok(assetPromptDraftStoreKey('p1', '').endsWith('.all-chapters'))
  assert.equal(assetPromptDraftStoreKey('p1', null), assetPromptDraftStoreKey('p1', ''))
  // 没有项目 id 也不至于写出一个能撞上的键
  assert.ok(assetPromptDraftStoreKey('', '').includes('unknown-project'))
})

test('写入 / 读回：正文与"生成时该带的信息"原样回来（不含回包原始片段）', () => {
  const storage = fakeStorage()
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  const draft = entry({ warnings: ['这次没有拿到该资产的描述'] })
  assert.equal(
    saveAssetPromptDraftToStorage(storage, key, { projectId: 'p1', chapterId: 'ch1', entry: draft }),
    true,
  )
  const back = readAssetPromptDraftEntries(storage, key, { projectId: 'p1', chapterId: 'ch1', now: NOW + 10 })
  assert.equal(back.length, 1)
  assert.equal(back[0].prompt, draft.prompt)
  assert.equal(back[0].assetName, '林知夏')
  assert.equal(back[0].slot, 'character_image_front')
  assert.equal(back[0].llmCalled, true)
  assert.equal(back[0].latencyMs, 1200)
  assert.deepEqual(back[0].warnings, ['这次没有拿到该资产的描述'])
  assert.equal(back[0].qualityLabel, draft.qualityLabel)
  assert.equal(back[0].basisSummary, draft.basisSummary)
  assert.equal(back[0].savedAt, NOW)
  // 落盘的 JSON 里只有这些字段（回包原始片段不进草稿）
  const raw = storage.getItem(key) ?? ''
  assert.ok(raw.includes('character_image_front'))
  assert.ok(!raw.includes('basisPayload'))
  assert.ok(!raw.includes('requestStructure'))
  // 依据只留"人话那一句"，不留内部结构
  assert.ok(!raw.includes('shot_id'))
})

test('同一资产 + 同一槽位是同一个键：最后一版为准；不同槽位互不影响', () => {
  const storage = fakeStorage()
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  /** 测试里的时间戳是固定的假时间，写入时要一起把 `now` 传进去（否则会被当成过期丢掉） */
  const args = { projectId: 'p1', chapterId: 'ch1', now: NOW + 5000 }
  saveAssetPromptDraftToStorage(storage, key, { ...args, entry: entry({ prompt: '第一版' }) })
  saveAssetPromptDraftToStorage(storage, key, {
    ...args,
    entry: entry({ prompt: '第二版（用户改过）', savedAt: NOW + 1000 }),
  })
  // 另一个槽位 / 另一个资产是各自独立的
  saveAssetPromptDraftToStorage(storage, key, {
    ...args,
    entry: entry({ assetId: 'c2', assetName: '陆时衍', slot: 'character_image_front', prompt: '另一个角色', savedAt: NOW + 2000 }),
  })
  saveAssetPromptDraftToStorage(storage, key, {
    ...args,
    entry: entry({ assetType: 'scene', assetId: 's1', slot: 'scene_image_front', prompt: '雨夜咖啡店', savedAt: NOW + 3000 }),
  })

  const back = readAssetPromptDraftEntries(storage, key, { ...args, now: NOW + 4000 })
  assert.equal(back.length, 3)
  const c1 = back.find((item) => item.assetId === 'c1')
  assert.equal(c1?.prompt, '第二版（用户改过）')
  assert.equal(back.filter((item) => item.assetId === 'c1').length, 1)
  assert.equal(back.find((item) => item.assetId === 's1')?.prompt, '雨夜咖啡店')
  // 顺序：旧的在前（便于人看，"最新"在最后）
  assert.deepEqual(back.map((item) => item.savedAt), [NOW + 1000, NOW + 2000, NOW + 3000])
  // 纯函数层面同样是同键覆盖（顺序：旧的在前）
  const merged = upsertAssetPromptDraftEntry(
    [entry({ prompt: '旧版本' })],
    entry({ prompt: '新版本', savedAt: NOW + 1 }),
  )
  assert.equal(merged.length, 1)
  assert.equal(merged[0].prompt, '新版本')
  // 键的身份就是 资产类型 + 资产 + 槽位
  assert.equal(
    assetPromptDraftEntryKey({ assetType: 'character', assetId: 'c1', slot: 'character_image_front' }),
    assetPromptDraftEntryKey({ assetType: 'character', assetId: 'c1', slot: 'character_image_front' }),
  )
  assert.notEqual(
    assetPromptDraftEntryKey({ assetType: 'character', assetId: 'c1', slot: 'character_image_front' }),
    assetPromptDraftEntryKey({ assetType: 'scene', assetId: 'c1', slot: 'character_image_front' }),
  )
})

test('不同项目 / 不同集互不串（读的时候直接判无效，也不会互相覆盖）', () => {
  const storage = fakeStorage()
  const keyA = assetPromptDraftStoreKey('p1', 'ch1')
  saveAssetPromptDraftToStorage(storage, keyA, {
    projectId: 'p1',
    chapterId: 'ch1',
    entry: entry({ prompt: '第一集的内容' }),
  })
  // 同一个键、同一个作用域 → 能读到
  assert.equal(readAssetPromptDraftEntries(storage, keyA, { projectId: 'p1', chapterId: 'ch1', now: NOW + 10 }).length, 1)
  // 换项目 / 换集 → 读不到（作用域对不上）
  assert.equal(readAssetPromptDraftEntries(storage, keyA, { projectId: 'p2', chapterId: 'ch1', now: NOW + 10 }).length, 0)
  assert.equal(readAssetPromptDraftEntries(storage, keyA, { projectId: 'p1', chapterId: 'ch2', now: NOW + 10 }).length, 0)
  assert.equal(
    parseAssetPromptDraftSnapshot(storage.getItem(keyA), { projectId: 'p1', chapterId: 'ch2', now: NOW + 10 }),
    null,
  )
  // 另一集的键里什么都不会出现（也不会被上一集的内容串进去）
  assert.equal(readAssetPromptDraftEntries(storage, assetPromptDraftStoreKey('p1', 'ch2'), {
    projectId: 'p1',
    chapterId: 'ch2',
    now: NOW + 10,
  }).length, 0)
})

test('过期作废：超过 7 天（或时间戳在将来）的草稿不算数', () => {
  const storage = fakeStorage()
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  saveAssetPromptDraftToStorage(storage, key, {
    projectId: 'p1',
    chapterId: 'ch1',
    entry: entry(),
    now: NOW,
  })
  const args = { projectId: 'p1', chapterId: 'ch1' }

  // 差一点点还在 TTL 内
  assert.equal(readAssetPromptDraftEntries(storage, key, { ...args, now: NOW + ASSET_PROMPT_DRAFT_TTL_MS - 1 }).length, 1)
  // 刚好超期 → 作废
  assert.equal(readAssetPromptDraftEntries(storage, key, { ...args, now: NOW + ASSET_PROMPT_DRAFT_TTL_MS + 1 }).length, 0)
  // 时钟漂移（记录的时间比现在还晚很多）→ 不认
  assert.equal(readAssetPromptDraftEntries(storage, key, { ...args, now: NOW - 10 * 60 * 1000 }).length, 0)

  // 过期的行在写入新草稿时就被顺手丢掉（不会一直躺在存储里）
  const staleKey = assetPromptDraftStoreKey('p9', 'ch9')
  storage.setItem(
    staleKey,
    serializeAssetPromptDraftSnapshot(
      buildAssetPromptDraftSnapshot({
        projectId: 'p9',
        chapterId: 'ch9',
        entries: [
          entry({ assetId: 'c-stale', prompt: '七天前的旧草稿', savedAt: NOW - ASSET_PROMPT_DRAFT_TTL_MS - 1 }),
        ],
      }),
    ),
  )
  saveAssetPromptDraftToStorage(storage, staleKey, {
    projectId: 'p9',
    chapterId: 'ch9',
    entry: entry({ assetId: 'c-fresh', prompt: '刚才生成的', savedAt: NOW }),
    now: NOW,
  })
  const merged = readAssetPromptDraftEntries(storage, staleKey, { projectId: 'p9', chapterId: 'ch9', now: NOW + 10 })
  assert.deepEqual(merged.map((item) => item.assetId), ['c-fresh'])
})

test('上限淘汰：一个键最多 60 条，超出丢最旧的', () => {
  const entries = Array.from({ length: ASSET_PROMPT_DRAFT_MAX_ENTRIES + 5 }, (_, index) =>
    entry({ assetId: `c${index}`, prompt: `第 ${index} 条`, savedAt: NOW + index }),
  )
  const trimmed = trimAssetPromptDraftEntries(entries)
  assert.equal(trimmed.length, ASSET_PROMPT_DRAFT_MAX_ENTRIES)
  // 丢掉的是最旧的 5 条，且顺序保持
  assert.equal(trimmed[0].assetId, 'c5')
  assert.equal(trimmed[trimmed.length - 1].assetId, `c${ASSET_PROMPT_DRAFT_MAX_ENTRIES + 4}`)

  // 逐条写入也会被裁（写入 65 条，读回来只有 60 条，且都在最新的那一批里）
  const storage = fakeStorage()
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  for (let index = 0; index < ASSET_PROMPT_DRAFT_MAX_ENTRIES + 5; index += 1) {
    saveAssetPromptDraftToStorage(storage, key, {
      projectId: 'p1',
      chapterId: 'ch1',
      entry: entry({ assetId: `c${index}`, prompt: `第 ${index} 条`, savedAt: NOW + index }),
      now: NOW + index + 1,
    })
  }
  const back = readAssetPromptDraftEntries(storage, key, {
    projectId: 'p1',
    chapterId: 'ch1',
    now: NOW + ASSET_PROMPT_DRAFT_MAX_ENTRIES + 10,
  })
  assert.equal(back.length, ASSET_PROMPT_DRAFT_MAX_ENTRIES)
  assert.ok(!back.some((item) => item.assetId === 'c0' || item.assetId === 'c4'))
  assert.ok(back.some((item) => item.assetId === `c${ASSET_PROMPT_DRAFT_MAX_ENTRIES + 4}`))
  // 上限是"每个键"，不是全局：另一集仍然能存自己的
  assert.equal(trimAssetPromptDraftEntries(entries, 0).length, 0)
})

test('序列化容错：坏 JSON / 版本不符 / 脏行 / 坏存储都不炸', () => {
  const expected = { projectId: 'p1', chapterId: 'ch1', now: NOW + 10 }
  assert.equal(parseAssetPromptDraftSnapshot(null, expected), null)
  assert.equal(parseAssetPromptDraftSnapshot('', expected), null)
  assert.equal(parseAssetPromptDraftSnapshot('{不是 json', expected), null)
  assert.equal(parseAssetPromptDraftSnapshot('[]', expected), null)
  assert.equal(parseAssetPromptDraftSnapshot('{"version":"x"}', expected), null)

  const valid = buildAssetPromptDraftSnapshot({ projectId: 'p1', chapterId: 'ch1', entries: [entry()] })
  assert.equal(
    parseAssetPromptDraftSnapshot(
      serializeAssetPromptDraftSnapshot({ ...valid, version: ASSET_PROMPT_DRAFT_VERSION + 1 }),
      expected,
    ),
    null,
  )
  // 脏行被逐条丢掉；干净的那条仍然可用
  const dirty = serializeAssetPromptDraftSnapshot({
    ...valid,
    entries: [
      entry({ assetId: 'c-ok' }),
      { nope: true },
      entry({ assetId: '', prompt: '没有资产 id' }),
      entry({ assetId: 'c-empty', prompt: '   ' }),
      entry({ assetId: 'c-badtime', savedAt: Number.NaN }),
      null,
    ] as unknown as AssetPromptDraftEntry[],
  })
  const parsed = parseAssetPromptDraftSnapshot(dirty, expected)
  assert.equal(parsed?.entries.length, 1)
  assert.equal(parsed?.entries[0].assetId, 'c-ok')
  // 缺字段（比如告警不是数组）也不该让整条作废
  const loose = sanitizeAssetPromptDraftEntry({
    assetType: 'scene',
    assetId: 's1',
    slot: 'scene_image_front',
    prompt: '木质吧台，暖黄灯，雨夜窗外霓虹',
    savedAt: NOW,
    warnings: '不是数组',
    latencyMs: '很慢',
  })
  assert.ok(loose)
  assert.deepEqual(loose?.warnings, [])
  assert.equal(loose?.latencyMs, null)
  assert.equal(loose?.llmCalled, false)
  // 全脏 → 整份作废（页面当没有草稿，不会冒出一堆空行）
  assert.equal(parseAssetPromptDraftSnapshot(JSON.stringify({ ...valid, entries: [{}, 1, 'x'] }), expected), null)

  // 存储本身坏掉（隐私模式 / 超配额 / 读就抛）
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
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  assert.deepEqual(readAssetPromptDraftEntries(broken, key, expected), [])
  assert.equal(
    saveAssetPromptDraftToStorage(broken, key, { projectId: 'p1', chapterId: 'ch1', entry: entry() }),
    false,
  )
  assert.equal(
    removeAssetPromptDraftFromStorage(broken, key, {
      projectId: 'p1',
      chapterId: 'ch1',
      target: { assetType: 'character', assetId: 'c1', slot: 'character_image_front' },
    }),
    false,
  )
  // 没有存储（SSR / 取不到）时同样静默降级
  assert.deepEqual(readAssetPromptDraftEntries(null, key, expected), [])
  assert.equal(saveAssetPromptDraftToStorage(null, key, { projectId: 'p1', chapterId: 'ch1', entry: entry() }), false)
  assert.equal(loadAssetPromptDraftRestorePlan(null, key, expected).restored, false)
  assert.equal(loadAssetPromptDraftPlan({ projectId: 'p1', chapterId: 'ch1', storage: null }).restored, false)
})

test('保存成功后清掉该行草稿（只删那一行；删空后不留下空壳）', () => {
  const storage = fakeStorage()
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  const args = { projectId: 'p1', chapterId: 'ch1', now: NOW + 10 }
  const c1 = entry({ assetId: 'c1', prompt: '林知夏的提示词' })
  const c2 = entry({ assetId: 'c2', assetName: '陆时衍', prompt: '陆时衍的提示词', savedAt: NOW + 1 })
  const s1 = entry({ assetType: 'scene', assetId: 's1', slot: 'scene_image_front', prompt: '雨夜咖啡店', savedAt: NOW + 2 })
  ;[c1, c2, s1].forEach((draft) => saveAssetPromptDraftToStorage(storage, key, { ...args, entry: draft }))

  assert.equal(
    removeAssetPromptDraftFromStorage(storage, key, {
      ...args,
      target: { assetType: 'character', assetId: 'c1', slot: 'character_image_front' },
    }),
    true,
  )
  const left = readAssetPromptDraftEntries(storage, key, { ...args, now: NOW + 10 })
  assert.deepEqual(left.map((item) => item.assetId), ['c2', 's1'])
  // 同一资产的**另一个槽位**不会被顺手删掉（保存的是哪一个槽位就清哪一个）
  assert.equal(
    removeAssetPromptDraftFromStorage(storage, key, {
      ...args,
      target: { assetType: 'character', assetId: 'c1', slot: 'character_image_back' },
    }),
    false,
  )
  assert.equal(readAssetPromptDraftEntries(storage, key, { ...args, now: NOW + 10 }).length, 2)

  // 删光 → 键一起删掉，不留空壳
  removeAssetPromptDraftFromStorage(storage, key, {
    ...args,
    target: { assetType: 'character', assetId: 'c2', slot: 'character_image_front' },
  })
  removeAssetPromptDraftFromStorage(storage, key, {
    ...args,
    target: { assetType: 'scene', assetId: 's1', slot: 'scene_image_front' },
  })
  assert.equal(storage.getItem(key), null)
  assert.equal(readAssetPromptDraftEntries(storage, key, { ...args, now: NOW + 10 }).length, 0)

  // 一步到位版本（面板用的那两个入口）
  assert.equal(saveAssetPromptDraft({ ...args, entry: c1, storage }), true)
  assert.equal(
    clearAssetPromptDraft({
      ...args,
      target: { assetType: 'character', assetId: 'c1', slot: 'character_image_front' },
      storage,
    }),
    true,
  )
  assert.equal(storage.getItem(key), null)
})

test('草稿对不上资产行时不硬塞：只回填对得上的，条数如实报出来', () => {
  const rows = [
    { type: 'character', id: 'c1', category: 'character_image_front', name: '林知夏' },
    { type: 'scene', id: 's1', category: 'scene_image_front', name: '雨夜咖啡店' },
  ]
  const entries = [
    entry({ assetId: 'c1' }),
    // 槽位对不上
    entry({ assetId: 's1', slot: 'scene_image_back', prompt: '不该被回填' }),
    // 资产不在这次的清单里（被删了 / 这次只列出了选中的那几项）
    entry({ assetType: 'prop', assetId: 'p9', slot: 'prop_image_front', prompt: '道具的提示词' }),
  ]
  const { matched, orphanCount } = matchAssetPromptDraftEntries(rows, entries)
  assert.deepEqual(matched.map((item) => item.row.id), ['c1'])
  assert.equal(matched[0].entry.prompt, entry().prompt)
  assert.equal(orphanCount, 2)

  const plan = planAssetPromptDraftRestore(matched.map((item) => item.entry), { orphanCount, now: NOW + 10 })
  assert.equal(plan.restored, true)
  assert.match(plan.note, /恢复 1 条/)
  assert.match(plan.note, /另有 2 条草稿不属于这次列出的资产/)
})

test('恢复计划是**只读**的：恒定不保存、不生成，读的过程零写入零删除', () => {
  const storage = fakeStorage()
  const key = assetPromptDraftStoreKey('p1', 'ch1')
  saveAssetPromptDraftToStorage(storage, key, { projectId: 'p1', chapterId: 'ch1', entry: entry() })
  const writesBefore = storage.writes.length

  const plan = loadAssetPromptDraftRestorePlan(storage, key, {
    projectId: 'p1',
    chapterId: 'ch1',
    now: NOW + 1000,
    rows: [{ type: 'character', id: 'c1', category: 'character_image_front' }],
  })

  // 1) 确实恢复出了内容，但**明确不保存、不生成**
  assert.equal(plan.restored, true)
  assert.equal(plan.shouldSave, false)
  assert.equal(plan.shouldGenerate, false)
  assert.equal(plan.entries.length, 1)
  assert.equal(plan.savedAt, NOW)
  assert.equal(plan.orphanCount, 0)
  assert.match(plan.note, /只读/)
  assert.match(plan.note, /不会自动保存到资产/)
  assert.match(plan.note, /不会重新生成/)
  assert.match(plan.note, /保存到资产/)
  // 2) 只读：读的过程一个字节都没写、没删
  assert.equal(storage.writes.length, writesBefore)
  assert.deepEqual(storage.removals, [])
  // 3) 回填的字段只带正文与展示信息，status 是"待检查"而不是"已保存"
  const fields = buildRestoredDraftRowFields(plan.entries[0])
  assert.equal(fields.draft, entry().prompt)
  assert.equal(fields.status, 'generated')
  assert.equal(fields.restoredFromDraft, true)
  assert.equal(fields.restoredSavable, true)
  assert.equal(fields.error, '')
  // 4) 空草稿 / 没存储时同样是"什么都没有"，且一样不保存不生成
  const empty = planAssetPromptDraftRestore([])
  assert.equal(empty.restored, false)
  assert.equal(empty.shouldSave, false)
  assert.equal(empty.shouldGenerate, false)
  assert.equal(empty.note, '')
  assert.equal(empty.savedAt, 0)
})

test('恢复路径里**没有任何提交 / 生成入口**（源码结构性断言）', () => {
  /** 生成 / 保存 / 联网入口的名字：恢复路径里出现任何一个都等于刷新可能再花一次钱。 */
  const BANNED = [
    'previewAssetImagePrompt(',
    'saveAssetImagePrompts(',
    'saveAssetImagePromptsBatch(',
    'saveOne(',
    'saveAll(',
    'generateOne(',
    'runBatch(',
    'fetch(',
    'axios',
    'shouldSave: true',
    'shouldGenerate: true',
  ]
  const expectClean = (label: string, source: string) => {
    BANNED.forEach((token) => {
      assert.ok(!source.includes(token), `${label} 里出现了提交/生成入口：${token}`)
    })
  }

  // 1) 草稿模块整份：纯逻辑，不碰网络、不碰保存
  expectClean('assetPromptDrafts.ts', readFileSync(resolve(HERE, 'assetPromptDrafts.ts'), 'utf8'))

  // 2) 面板里被标记圈起来的「草稿恢复（只读）」那一段
  const panel = readFileSync(resolve(HERE, '../AssetImagePromptLlmPanel.tsx'), 'utf8')
  const begin = panel.indexOf('草稿恢复（只读）开始')
  const end = panel.indexOf('草稿恢复（只读）结束')
  assert.ok(begin > 0, '面板里应该有一段用「草稿恢复（只读）开始」标记的恢复代码')
  assert.ok(end > begin, '面板里应该有对应的「草稿恢复（只读）结束」标记')
  const restoreBlock = panel.slice(begin, end)
  expectClean('面板的草稿恢复段', restoreBlock)
  // 这一段必须真的在做恢复（否则上面的断言就是空转）
  assert.ok(restoreBlock.includes('loadAssetPromptDraftPlan'))
  assert.ok(restoreBlock.includes('buildRestoredDraftRowFields'))
  // 面板里必须有「草稿（未保存）」这个标注，且和「已保存」分开
  assert.ok(panel.includes('草稿（未保存）'))
})

test('生成时被判不可用的草稿：没改过仍不许保存，改过之后按现在的正文重新判', () => {
  const blocked = entry({
    savable: false,
    qualityLabel: '外观信息不足，需人工补充',
    qualityReason: '这条提示词里有「外观信息不足」的痕迹：主体的外观信息不够，需要你先补充。',
  })
  const fields = buildRestoredDraftRowFields(blocked)
  // 没改过 → 继续保持不许保存，并把当时的原因说出来
  const untouched = resolveRestoredDraftSaveGuard(fields)
  assert.equal(untouched.blocked, true)
  assert.match(untouched.reason, /外观信息不足/)
  // 用户改过正文 → 当时的判定不再适用，交给现在的正文重新判
  assert.equal(resolveRestoredDraftSaveGuard({ ...fields, draft: '二十九岁女性，齐肩黑发' }).blocked, false)
  // 不是恢复来的行（本次刚生成）→ 不在这里管
  assert.equal(resolveRestoredDraftSaveGuard({ draft: 'x', restoredSavable: false }).blocked, false)
  // 生成时就判可用的草稿 → 不拦
  assert.equal(resolveRestoredDraftSaveGuard(buildRestoredDraftRowFields(entry())).blocked, false)
})

test('行内说明与时间：说清"这是本机草稿"，且用户可见文案里没有内部标识', () => {
  const savedAt = Date.UTC(2026, 8, 19, 6, 5)
  const sameDay = describeAssetPromptDraftTime(savedAt, savedAt + 60_000)
  const otherDay = describeAssetPromptDraftTime(savedAt, savedAt + 3 * 24 * 60 * 60 * 1000)
  assert.match(sameDay, /^今天 \d{2}:\d{2}$/)
  assert.match(otherDay, /^\d{2}-\d{2} \d{2}:\d{2}$/)
  assert.equal(describeAssetPromptDraftTime(0), '时间未知')
  assert.equal(describeAssetPromptDraftTime('abc'), '时间未知')

  const fields = buildRestoredDraftRowFields(entry({ savedAt }))
  const line = buildRestoredDraftLine(fields, savedAt + 60_000)
  assert.match(line, /本机草稿（未保存）/)
  assert.match(line, /生成时的判定「提示词包含外观信息」/)
  assert.match(line, /生成时的依据：本次用到：剧本\/分镜 2 项/)
  assert.equal(buildRestoredDraftLine({ restoredFromDraft: false }), '')
  // 用户改过内容后，当时的质量判定明确写成"不再适用"
  const edited = buildRestoredDraftLine({ ...fields, draft: '改过的正文' }, savedAt + 60_000)
  assert.match(edited, /这条判定不再适用/)

  const note = planAssetPromptDraftRestore([entry({ savedAt })], { now: savedAt + 60_000 }).note
  const copy = [note, line, edited].join('\n')
  // 接口路径 / 模型名 / 任务号 / 文件标识 / 内部字段名 / 状态码一律不许出现在用户语言里
  assert.ok(!/https?:\/\//.test(copy))
  assert.ok(!copy.includes('/studio'))
  assert.ok(!/\b(id|code|status|token|model|prompt_text|file)\b/i.test(copy))
  assert.ok(!/\b[1-5]\d{2}\b/.test(copy))
  assert.ok(!copy.includes('垫图') && !copy.includes('图生图'))
})
