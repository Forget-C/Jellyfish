/**
 * 按 `asset_type` 分流的结果类型口径测试（用户点名）。
 *
 * 锁定四件事：
 *   1. **消费后端回包**：`result_kind` / `result_label` 优先，缺字段时按类型兜底；
 *   2. `characterReference`（人物参考图）是**人物专用**，场景/道具/服装拿到它也一律不采用；
 *   3. **场景 / 道具 / 服装的用户可见文案里不出现「参考图」**（按钮、确认框、卡片标签全查）；
 *   4. **人物参考图固定 16:9，不等于项目最终视频画幅**：这句话必须写出来，
 *      并且**同时**给出项目自己的 `default_video_ratio`，两者不同要能看出区别。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BATCH_REFERENCE_ALLOWED_BY_ASSET_TYPE,
  CHARACTER_ONLY_RESULT_KIND,
  CHARACTER_REFERENCE_FIXED_STATEMENT,
  CHARACTER_REFERENCE_RATIO,
  CHARACTER_REFERENCE_RATIO_SOURCE,
  IMAGE_ASSET_TYPE_ORDER,
  IMAGE_ASSET_TYPE_TEXT,
  RESULT_KIND_BY_ASSET_TYPE,
  RESULT_LABEL_BY_ASSET_TYPE,
  RESULT_NOUN_BY_ASSET_TYPE,
  aspectRatioSourceFromStrategy,
  buildAspectRatioNotice,
  buildAspectRatioStatement,
  buildBatchActionLabel,
  buildBatchConfirmTitle,
  buildResultKindTag,
  describeGroupBreakdown,
  groupAssetsByType,
  isCharacterOnlyResultKind,
  resolveResultKind,
  resolveResultLabel,
  resultArtifactCopy,
  supportsBatchReference,
} from './assetResultKind.ts'
import {
  ASSET_TYPE_LABEL,
  buildBatchConfirmation,
  defaultGenerationSettings,
  summarizeSelection,
  type ProductionAsset,
} from './assetProduction.ts'

function asset(type: ProductionAsset['type'], id: string, patch: Partial<ProductionAsset> = {}): ProductionAsset {
  return {
    key: `${type}:${id}`,
    id,
    type,
    name: `${type}-${id}`,
    hasImage: false,
    hasPrimary: false,
    hasImagePrompt: true,
    imageId: null,
    thumbnail: '',
    hasPendingCandidate: false,
    ...patch,
  }
}

const CHARACTER_ONLY = [asset('character', 'c1'), asset('character', 'c2'), asset('character', 'c3')]
const SCENE_ONLY = [asset('scene', 's1'), asset('scene', 's2')]
const PROP_ONLY = [asset('prop', 'p1')]
const MIXED = [...CHARACTER_ONLY, ...SCENE_ONLY, ...PROP_ONLY]

/* ------------------------------------------------- 标签口径与后端一致 */

test('结果类型标签与后端分流表逐条一致（人物参考图 / 场景资产图 / 道具资产图 / 服装设定图）', () => {
  assert.deepEqual(IMAGE_ASSET_TYPE_ORDER, ['character', 'scene', 'prop', 'costume'])
  assert.deepEqual(RESULT_KIND_BY_ASSET_TYPE, {
    character: 'characterReference',
    scene: 'sceneAssetImage',
    prop: 'propAssetImage',
    costume: 'costumeDesignImage',
  })
  assert.deepEqual(RESULT_LABEL_BY_ASSET_TYPE, {
    character: '人物参考图',
    scene: '场景资产图',
    prop: '道具资产图',
    costume: '服装设定图',
  })
  // 类型中文名与生产区的表必须逐字相同（否则两处会各说各话）
  assert.deepEqual(IMAGE_ASSET_TYPE_TEXT, ASSET_TYPE_LABEL)
  // 只有人物允许「按定版图片批量出图」
  assert.deepEqual(BATCH_REFERENCE_ALLOWED_BY_ASSET_TYPE, {
    character: true,
    scene: false,
    prop: false,
    costume: false,
  })
  assert.equal(supportsBatchReference('character'), true)
  assert.equal(supportsBatchReference('scene'), false)
})

test('消费回包：result_label / result_kind 优先，缺字段时按类型兜底', () => {
  // 回包带了就用回包
  assert.equal(resolveResultLabel('scene', '场景资产图', 'sceneAssetImage'), '场景资产图')
  assert.equal(resolveResultKind('prop', 'propAssetImage'), 'propAssetImage')
  // 回包没带就按类型（不猜成「参考图」）
  assert.equal(resolveResultLabel('scene'), '场景资产图')
  assert.equal(resolveResultLabel('prop', '', ''), '道具资产图')
  assert.equal(resolveResultKind('costume'), 'costumeDesignImage')
  assert.equal(resolveResultLabel('character'), '人物参考图')

  const tag = buildResultKindTag('scene', { resultKind: 'sceneAssetImage', resultLabel: '场景资产图' })
  assert.equal(tag.label, '场景资产图')
  assert.equal(tag.kind, 'sceneAssetImage')
  assert.equal(tag.tone, 'blue')
  assert.equal(tag.fromServer, true)
  // 回包没带 → 兜底并标明不是回包给的
  assert.equal(buildResultKindTag('prop', {}).fromServer, false)
  assert.equal(buildResultKindTag('prop', {}).label, '道具资产图')
})

test('characterReference 是人物专用：场景/道具/服装拿到它也一律不采用（不把错标签画到卡片上）', () => {
  assert.equal(isCharacterOnlyResultKind(CHARACTER_ONLY_RESULT_KIND), true)
  assert.equal(isCharacterOnlyResultKind('sceneAssetImage'), false)
  ;(['scene', 'prop', 'costume'] as const).forEach((type) => {
    assert.equal(resolveResultKind(type, CHARACTER_ONLY_RESULT_KIND), RESULT_KIND_BY_ASSET_TYPE[type])
    assert.equal(resolveResultLabel(type, '人物参考图', CHARACTER_ONLY_RESULT_KIND), RESULT_LABEL_BY_ASSET_TYPE[type])
    const tag = buildResultKindTag(type, { resultKind: CHARACTER_ONLY_RESULT_KIND, resultLabel: '人物参考图' })
    assert.equal(tag.label, RESULT_LABEL_BY_ASSET_TYPE[type])
    assert.equal(tag.kind, RESULT_KIND_BY_ASSET_TYPE[type])
    assert.ok(!tag.label.includes('参考图'), tag.label)
  })
})

/* --------------------------------------------------- 按类型取词（不许串词） */

test('只有人物叫「参考图」，其余类型用各自的图名', () => {
  assert.deepEqual(RESULT_NOUN_BY_ASSET_TYPE, {
    character: '参考图',
    scene: '场景资产图',
    prop: '道具资产图',
    costume: '服装设定图',
  })
  assert.equal(resultArtifactCopy('character').label, '人物参考图')
  assert.equal(resultArtifactCopy('character').regenerateAction, '重新生成参考图')
  assert.equal(resultArtifactCopy('scene').regenerateAction, '重新生成场景资产图')
  assert.equal(resultArtifactCopy('prop').generateAction, '生成道具资产图')
  assert.equal(resultArtifactCopy('costume').existingImageAction, '使用已有服装设定图重新生成')
})

test('场景 / 道具 / 服装的**所有**类型文案里都不出现「参考图」', () => {
  ;(['scene', 'prop', 'costume'] as const).forEach((type) => {
    const copy = resultArtifactCopy(type)
    const texts = Object.entries(copy)
      .filter(([, value]) => typeof value === 'string')
      .map(([key, value]) => `${key}: ${value as string}`)
    assert.ok(texts.length >= 10, `${type} 的文案字段太少，测试形同虚设`)
    texts.forEach((text) => {
      assert.ok(!text.includes('参考图'), `${type} 的文案里出现了「参考图」：${text}`)
    })
  })
})

test('只有人物的确认框会说「参考图」；场景 / 道具的整份确认文案里一个字都不许有', () => {
  const characterConfirm = buildBatchConfirmation({
    scope: summarizeSelection(CHARACTER_ONLY, CHARACTER_ONLY.map((item) => item.key)),
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'generate',
  })
  const characterText = [characterConfirm.title, ...characterConfirm.lines].join('\n')
  assert.match(characterText, /人物参考图/)
  assert.equal(characterConfirm.title, '确认生成这 3 项资产的参考图？')

  ;[
    { type: 'scene' as const, items: SCENE_ONLY, noun: '场景资产图' },
    { type: 'prop' as const, items: PROP_ONLY, noun: '道具资产图' },
  ].forEach(({ items, noun }) => {
    const confirmation = buildBatchConfirmation({
      scope: summarizeSelection(items, items.map((item) => item.key)),
      settings: defaultGenerationSettings(),
      mode: 'dry_run',
      operation: 'generate',
    })
    const whole = [confirmation.title, confirmation.blockedReason, ...confirmation.lines].join('\n')
    assert.ok(!whole.includes('参考图'), whole)
    assert.ok(whole.includes(noun), whole)
    // 确认框标题按类型取名
    assert.equal(confirmation.title, `确认生成这 ${items.length} 项资产的${noun}？`)
  })
})

test('服装可以出图（走服装设定图口径），说明里也不出现「参考图」', () => {
  const only = [asset('costume', 'k1', { hasImage: true, hasPrimary: true })]
  const confirmation = buildBatchConfirmation({
    scope: summarizeSelection(only, only.map((item) => item.key)),
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'generate',
  })
  // 服装已补齐生产链路：不再被拦，而是进入正常确认流程，并且口径写的是「服装设定图」
  assert.equal(confirmation.blocked, false)
  const text = [confirmation.title, ...confirmation.lines].join('\n')
  assert.ok(!text.includes('参考图'), text)
  assert.match(text, /服装/)
})

/* ------------------------------------------------------------- 分组与按钮 */

test('混选按 asset_type 分组：顺序固定、计数正确、标题带各自的结果类型', () => {
  const groups = groupAssetsByType(MIXED)
  assert.deepEqual(groups.map((group) => group.assetType), ['character', 'scene', 'prop'])
  assert.deepEqual(groups.map((group) => group.count), [3, 2, 1])
  assert.deepEqual(groups.map((group) => group.title), [
    '人物 3 项（人物参考图）',
    '场景 2 项（场景资产图）',
    '道具 1 项（道具资产图）',
  ])
  assert.equal(describeGroupBreakdown(groups), '人物参考图 3 / 场景资产图 2 / 道具资产图 1')
})

test('批量按钮按类型取名：「批量生成参考图」只对人物出现', () => {
  const characterLabel = buildBatchActionLabel(groupAssetsByType(CHARACTER_ONLY), 'generate')
  assert.equal(characterLabel, '批量生成参考图（3）')
  assert.equal(buildBatchActionLabel(groupAssetsByType(CHARACTER_ONLY), 'regenerate'), '批量重新生成参考图（3）')

  const sceneLabel = buildBatchActionLabel(groupAssetsByType(SCENE_ONLY), 'generate')
  assert.equal(sceneLabel, '批量生成场景资产图（2）')
  assert.ok(!sceneLabel.includes('参考图'), sceneLabel)

  const propLabel = buildBatchActionLabel(groupAssetsByType(PROP_ONLY), 'regenerate')
  assert.equal(propLabel, '批量重新生成道具资产图（1）')
  assert.ok(!propLabel.includes('参考图'), propLabel)

  // 混选：列出每个类型各多少项，不把场景/道具并进「参考图」
  const mixedGroups = groupAssetsByType(MIXED)
  const mixedLabel = buildBatchActionLabel(mixedGroups, 'generate')
  assert.equal(mixedLabel, '批量生成（人物参考图 3 / 场景资产图 2 / 道具资产图 1）')
  assert.equal(buildBatchConfirmTitle(mixedGroups, 'generate'), '确认生成这 6 项资产？（按类型分组：人物参考图 3 / 场景资产图 2 / 道具资产图 1）')

  // 空选择不编数字
  assert.equal(buildBatchActionLabel([], 'generate'), '批量生成（0）')
})

test('混选确认框逐组写清「这一组生成什么图」，不把不同类型的图说成同一种', () => {
  const scope = summarizeSelection(MIXED, MIXED.map((item) => item.key))
  const confirmation = buildBatchConfirmation({
    scope,
    settings: { aspectRatio: '9:16' },
    mode: 'dry_run',
    operation: 'generate',
    projectVideoRatio: '9:16',
  })
  const text = confirmation.lines.join('\n')
  assert.match(text, /按类型分组/)
  assert.match(text, /人物 3 项：生成参考图（结果类型：人物参考图）/)
  assert.match(text, /场景 2 项：生成场景资产图（结果类型：场景资产图）/)
  assert.match(text, /道具 1 项：生成道具资产图（结果类型：道具资产图）/)
  assert.match(text, /按定版图片批量出图只对人物开放/)
  // 出图方式那一行逐组列出，不许只说一种
  assert.match(text, /人物 = 人物参考图，场景 = 场景资产图，道具 = 道具资产图/)
  // 场景 / 道具那两行里不许出现「参考图」
  const sceneLine = confirmation.lines.find((line) => line.startsWith('场景 2 项')) ?? ''
  const propLine = confirmation.lines.find((line) => line.startsWith('道具 1 项')) ?? ''
  assert.ok(!sceneLine.includes('参考图'), sceneLine)
  assert.ok(!propLine.includes('参考图'), propLine)
})

/* --------------------------------------- 人物参考图固定 16:9（用户点名） */

test('人物固定画幅那句话必须写出来，并**同时**给出项目自己的最终视频画幅', () => {
  assert.equal(CHARACTER_REFERENCE_RATIO, '16:9')
  assert.equal(CHARACTER_REFERENCE_RATIO_SOURCE, 'character_reference_fixed')
  assert.match(CHARACTER_REFERENCE_FIXED_STATEMENT, /人物参考图固定 16:9/)
  assert.match(CHARACTER_REFERENCE_FIXED_STATEMENT, /不等于项目最终视频画幅/)

  const notice = buildAspectRatioNotice({
    assetTypes: ['character'],
    projectRatio: '9:16',
    source: CHARACTER_REFERENCE_RATIO_SOURCE,
    ratio: '16:9',
  })
  assert.equal(notice.applies, true)
  assert.equal(notice.referenceRatio, '16:9')
  assert.equal(notice.projectRatio, '9:16')
  assert.equal(notice.differs, true)
  // 两个值都要出现，并且说清"不同"
  assert.ok(notice.statement.includes('人物参考图固定 16:9'), notice.statement)
  assert.ok(notice.statement.includes('不等于项目最终视频画幅'), notice.statement)
  assert.ok(notice.statement.includes('9:16'), notice.statement)
  assert.ok(notice.statement.includes('不一样'), notice.statement)
  assert.equal(notice.line, `本次包含人物：${notice.statement}`)
})

test('项目画幅与 16:9 相同时也要写出来（数值相同、用途不同），读不到画幅时不编一个', () => {
  const same = buildAspectRatioNotice({ assetTypes: ['character'], projectRatio: '16:9' })
  assert.equal(same.differs, false)
  assert.ok(same.statement.includes('16:9'), same.statement)
  assert.match(same.statement, /数值相同，但用途不同/)

  const unknown = buildAspectRatioNotice({ assetTypes: ['character'], projectRatio: '' })
  assert.equal(unknown.projectRatio, '')
  assert.equal(unknown.differs, false)
  assert.match(unknown.statement, /还没有设置最终视频画幅/)
  assert.ok(unknown.statement.includes('人物参考图固定 16:9'))
})

test('不含人物时**不写**人物固定画幅那句话；场景/道具的话里也没有「参考图」', () => {
  ;(['scene', 'prop', 'costume'] as const).forEach((type) => {
    const notice = buildAspectRatioNotice({ assetTypes: [type], projectRatio: '9:16' })
    assert.equal(notice.applies, false)
    assert.equal(notice.statement, '')
    assert.equal(notice.line, '')
  })
  // 人物 + 场景混选：本次含人物 → 要写
  const mixed = buildAspectRatioNotice({ assetTypes: ['character', 'scene'], projectRatio: '4:3' })
  assert.equal(mixed.applies, true)
  assert.ok(mixed.statement.includes('4:3'))
})

test('只读计划的 strategy（没有 aspect_ratio_source 字段）也能判出人物固定口径', () => {
  assert.equal(aspectRatioSourceFromStrategy({ aspect_ratio_fixed: true }), CHARACTER_REFERENCE_RATIO_SOURCE)
  assert.equal(aspectRatioSourceFromStrategy({ aspect_ratio_fixed: false }), '')
  assert.equal(aspectRatioSourceFromStrategy({}), '')
  assert.equal(aspectRatioSourceFromStrategy(null), '')
  // 计划里带 note（后端已有字段）时，那句话仍以页面自己的文案为准
  const notice = buildAspectRatioNotice({
    assetTypes: ['character'],
    projectRatio: '9:16',
    source: aspectRatioSourceFromStrategy({ aspect_ratio_fixed: true, aspect_ratio_note: '后端原文' }),
  })
  assert.equal(notice.applies, true)
  assert.ok(notice.statement.includes('9:16'))
  assert.equal(buildAspectRatioStatement('9:16').includes('人物参考图固定 16:9'), true)
})

test('批次确认框里也带这句（含人物的批次才有）', () => {
  const withCharacter = buildBatchConfirmation({
    scope: summarizeSelection(CHARACTER_ONLY, CHARACTER_ONLY.map((item) => item.key)),
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'generate',
    projectVideoRatio: '9:16',
    aspectRatioSource: CHARACTER_REFERENCE_RATIO_SOURCE,
  })
  const text = withCharacter.lines.join('\n')
  assert.ok(text.includes('人物参考图固定 16:9'), text)
  assert.ok(text.includes('9:16'), text)

  const sceneOnly = buildBatchConfirmation({
    scope: summarizeSelection(SCENE_ONLY, SCENE_ONLY.map((item) => item.key)),
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'generate',
    projectVideoRatio: '9:16',
    aspectRatioSource: '',
  })
  assert.ok(!sceneOnly.lines.join('\n').includes('人物参考图固定 16:9'))
})
