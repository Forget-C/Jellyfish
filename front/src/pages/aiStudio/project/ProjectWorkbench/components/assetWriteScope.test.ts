/**
 * 「写入范围 / 数据隔离」的测试：
 *   - 角色是项目内资产，场景 / 道具 / 服装是全局资产；
 *   - 全局资产**一律先确认**（不默认写回全局），并且要**列出差异**；
 *   - 三类既有产物（人工提示词 / 已上传图片 / 定版图）的"不许自动覆盖"有可断言的口径。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PRESERVATION_POLICY,
  buildBatchWriteScopeConfirmation,
  buildScopeDiff,
  buildGlobalAssetWriteConfirmation,
  describeAssetScopeCopy,
  describePreservationPolicy,
  isGlobalAssetType,
} from './assetWriteScope.ts'

test('资产范围：角色属项目内资产，场景 / 道具 / 服装是全局资产', () => {
  assert.equal(isGlobalAssetType('character'), false)
  assert.equal(isGlobalAssetType('scene'), true)
  assert.equal(isGlobalAssetType('prop'), true)
  assert.equal(isGlobalAssetType('costume'), true)
  assert.equal(isGlobalAssetType(''), false)
  assert.equal(isGlobalAssetType(null), false)

  const character = describeAssetScopeCopy('character')
  assert.equal(character.globalAsset, false)
  assert.match(character.statement, /只属于当前项目/)
  assert.ok(!character.statement.includes('共用资产库'))

  const prop = describeAssetScopeCopy('prop')
  assert.equal(prop.globalAsset, true)
  assert.match(prop.statement, /所有项目共用/)
  assert.match(prop.statement, /项目 \+ 章节/)
  assert.match(prop.writeStatement, /所有项目共用的资产库/)
  assert.match(prop.writeStatement, /不会被自动覆盖/)
})

test('差异：只列真的会变化的槽位，新增与替换分开', () => {
  const diff = buildScopeDiff(
    { character_image_front: '旧的一条', character_image_other: '侧面的旧内容' },
    { character_image_front: '新的一条', character_image_other: '侧面的旧内容', character_image_back: '背面新建' },
  )
  assert.deepEqual(diff, [
    { slot: 'character_image_front', before: '旧的一条', after: '新的一条', kind: '替换' },
    { slot: 'character_image_back', before: '', after: '背面新建', kind: '新增' },
  ])
  assert.deepEqual(buildScopeDiff(null, { a: ' ' }), [])
  assert.deepEqual(buildScopeDiff(undefined, {}), [])
})

test('全局资产：即使只是新增也要先确认（不能默认写回全局）', () => {
  const onlyAdd = buildGlobalAssetWriteConfirmation({
    assetType: 'prop',
    assetName: '旧录音笔',
    existing: {},
    incoming: { prop_image_front: '银色金属旧录音笔，顶部红色指示灯' },
  })
  assert.equal(onlyAdd.required, true)
  assert.equal(onlyAdd.globalAsset, true)
  assert.match(onlyAdd.title, /写回全局道具「旧录音笔」/)
  assert.equal(onlyAdd.okText, '确认保存（含共用资产）')
  assert.equal(onlyAdd.replacedSlots.length, 0)
  assert.deepEqual(onlyAdd.addedSlots, ['prop_image_front'])
  const text = onlyAdd.lines.join('\n')
  assert.match(text, /所有项目共用的资产库/)
  assert.match(text, /新增提示词/)
  assert.match(text, /不确认就什么都不改/)
  // 不影响图片/定版的说明也在（验收会核对这三项保持不变）
  assert.match(text, /已上传的图片不会被任何保存\/生成动作改动/)
  assert.match(text, /定版图只有在/)
})

test('全局资产：替换已有内容时把新旧差异逐条列出，并给出要替换的槽位', () => {
  const confirmation = buildGlobalAssetWriteConfirmation({
    assetType: 'scene',
    assetName: '雨夜咖啡店',
    existing: { scene_image_front: '旧的场景提示词' },
    incoming: { scene_image_front: '新的场景提示词（更具体的空间结构）' },
  })
  assert.equal(confirmation.required, true)
  assert.deepEqual(confirmation.replacedSlots, ['scene_image_front'])
  const text = confirmation.lines.join('\n')
  assert.match(text, /替换原有提示词：旧的场景提示词 → 新的场景提示词/)
  assert.match(text, /旧的不会留副本/)
  assert.match(text, /本次会替换 1 处已有内容（旧内容不留副本）/)
})

test('角色（项目内资产）：没有覆盖时不必确认；有覆盖时才要确认', () => {
  const addOnly = buildGlobalAssetWriteConfirmation({
    assetType: 'character',
    assetName: '韩虹',
    existing: {},
    incoming: { character_image_front: '韩虹，35 岁女律师' },
  })
  assert.equal(addOnly.globalAsset, false)
  assert.equal(addOnly.required, false)

  const replace = buildGlobalAssetWriteConfirmation({
    assetType: 'character',
    assetName: '韩虹',
    existing: { character_image_front: '旧的一条' },
    incoming: { character_image_front: '新的一条' },
  })
  assert.equal(replace.required, true)
  assert.match(replace.title, /覆盖「韩虹」已有的图片提示词/)
  assert.equal(replace.okText, '确认覆盖')
})

test('没有任何变化：不用确认（不打扰，也不会白写一次）', () => {
  const same = buildGlobalAssetWriteConfirmation({
    assetType: 'prop',
    assetName: '旧录音笔',
    existing: { prop_image_front: '一样的内容' },
    incoming: { prop_image_front: '一样的内容' },
  })
  assert.equal(same.required, false)
  assert.equal(same.title, '')
  assert.deepEqual(same.lines, [])
})

test('批量保存：全局资产与项目内资产分开说清，并把每一处差异列出来', () => {
  const confirmation = buildBatchWriteScopeConfirmation([
    {
      assetType: 'character',
      assetName: '韩虹',
      existing: {},
      incoming: { character_image_front: '韩虹，35 岁女律师，齐肩黑发' },
    },
    {
      assetType: 'prop',
      assetName: '旧录音笔',
      existing: { prop_image_front: '旧的' },
      incoming: { prop_image_front: '银色金属旧录音笔，顶部红色指示灯' },
    },
    {
      assetType: 'scene',
      assetName: '雨夜咖啡店',
      existing: { scene_image_front: '一样的' },
      incoming: { scene_image_front: '一样的' },
    },
  ])
  assert.equal(confirmation.required, true)
  assert.equal(confirmation.globalCount, 1)
  assert.equal(confirmation.projectCount, 1)
  assert.equal(confirmation.replacedSlots, 1)
  assert.match(confirmation.title, /其中 1 项会写进所有项目共用的资产库/)
  assert.match(confirmation.okText, /确认保存（含共用资产）/)
  const text = confirmation.lines
  assert.match(text, /所有项目共用的资产/)
  assert.match(text, /道具「旧录音笔」：替换原有提示词/)
  assert.match(text, /只属于当前项目（角色）/)
  assert.match(text, /已上传的图片不会被任何保存\/生成动作改动/)
  assert.match(text, /定版图只有在/)

  // 全都没有变化 → 不用确认
  assert.equal(buildBatchWriteScopeConfirmation([{ assetType: 'character', assetName: '甲', existing: {}, incoming: {} }]).required, false)
})

test('三类既有产物的保护口径可断言（验收会核对"保持不变"）', () => {
  const lines = describePreservationPolicy()
  assert.equal(lines.length, 3)
  assert.match(PRESERVATION_POLICY.imagePrompt, /默认不被覆盖/)
  assert.match(PRESERVATION_POLICY.uploadedImage, /已上传的图片/)
  assert.match(PRESERVATION_POLICY.primaryImage, /设为定版/)
  lines.forEach((line) => {
    assert.ok(line.length > 0)
    // 主界面文案不许出现内部字段
    assert.ok(!line.includes('file_id'))
    assert.ok(!line.includes('is_primary'))
    assert.ok(!line.includes('status'))
  })
})
