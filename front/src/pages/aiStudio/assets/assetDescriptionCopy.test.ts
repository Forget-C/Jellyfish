/**
 * `assetDescriptionCopy.ts` 的回归测试。
 *
 * 存在的理由（阶段 B 收尾**运行时实测**发现的漏网）：这个模块原先只认两种字段名形态
 * ——「反引号包起来」和「`snake_case` 连写」，于是后端同一份自动描述里的
 * **裸词写法** `上下文判断来自segments和shots中…` 原样留在了场景列表页主区。
 * 所以这里把**真实运行时原文**逐条钉住，而不是只测自己构造的样例。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSET_AUTO_DESCRIPTION_TEXT,
  describeAssetDescription,
  hasInternalFieldToken,
  stripAssetNamePrefix,
} from './assetDescriptionCopy.ts'

/** 阶段 B 收尾运行时在 `/assets?tab=scene` 抓到的**逐字原文**（首尾省略处用 … 标注）。 */
const RUNTIME_SCENE_DESCRIPTION = [
  '场景：001号特护病房内。这是一个被改造为防爆笼的病房，用于关押危险S级人物战凛。',
  '空间结构：封闭房间，有防爆门、窥视窗、红色按钮、金属地面。光线：黑暗为主，有窥视窗微光。',
  '色调：冷暗，金属质感。氛围：压抑、危险、紧张，兼具科幻感。',
  '剧情功能：冲突爆发地（战凛攻击林希）、力量觉醒地（林希镇压战凛）、身份展示（林希SS级精神力觉醒）。',
  '上下文判断来自segments和shots中林希进入、系统激活、战凛攻击、林希觉醒、镇压、安抚等关键情节。',
  ' 基础提示词： cinematic live-action environment, wide establishing shot, 16:9, empty space',
].join('')

const CJK = /[\u4e00-\u9fff]/

test('运行时原文：裸词字段名（segments / shots）必须被转述掉，且其余中文内容一字不动', () => {
  assert.ok(
    hasInternalFieldToken(RUNTIME_SCENE_DESCRIPTION),
    '这段描述含 `segments` / `shots`，必须被判定为「需要转述」——否则主区就会漏出去',
  )
  const result = describeAssetDescription(RUNTIME_SCENE_DESCRIPTION)
  assert.doesNotMatch(result, /\bsegments\b/, `` + '裸词 segments 原样留在了主区')
  assert.doesNotMatch(result, /\bshots\b/, '裸词 shots 原样留在了主区')
  assert.match(result, /上下文判断来自出场片段和镜头中/, '必须换成读得通的中文说法')
  /* 只换字段名：用户自己写的剧情描述一个字都不许动 */
  for (const keep of ['001号特护病房内', '防爆门、窥视窗、红色按钮、金属地面', '林希SS级精神力觉醒']) {
    assert.ok(result.includes(keep), `转述把不该改的内容改掉了（丢了「${keep}」）`)
  }
})

test('审计给定口径的整句仍然照旧改写（防回退）', () => {
  const raw = '已根据该资产出现的 `segments`、`shots`、台词、`visual_focus`、`continuity_note` 和 `story_function` 生成'
  const result = describeAssetDescription(raw)
  /* 原文以「生成」结尾、没有句号，所以改写结果也不该凭空多一个句号 */
  assert.equal(result, ASSET_AUTO_DESCRIPTION_TEXT)
  assert.match(result, CJK)
})

test('反向断言：正常中文描述与正常英文词都不许被改写（防过度整改）', () => {
  const plain = '星耀疗养院S级特护病房门外：走廊尽头的双开门，门外有一条长椅。'
  assert.equal(describeAssetDescription(plain), plain, '没有字段名的描述必须原样返回')
  assert.equal(hasInternalFieldToken(plain), false)

  /* 不是「登记的字段名」的英文词不动（本模块只认登记表里的名字） */
  const withEnglish = '风格：cinematic 电影感，灯光 warm，镜头 wide shot。'
  assert.equal(describeAssetDescription(withEnglish), withEnglish)

  /* 半个词不算（下划线属词字符 → `shotsx` 里的 `shots` / `shot` 都不该命中） */
  assert.equal(hasInternalFieldToken('这里只有 shotsx 半个词'), false)
  /* snake_case 本来就该认（`_` 后至少 2 个字符才算 snake_case） */
  assert.equal(hasInternalFieldToken('字段 shots_meta 是 snake_case'), true)
  /* 英文提示词里的裸词 `shot` **不许**被换（否则 `wide shot` 会变成 `wide 镜头`，那是改坏内容） */
  const englishPrompt = '基础提示词： cinematic wide shot, 16:9, empty space, no text'
  assert.equal(hasInternalFieldToken(englishPrompt), false, '纯英文串里的 shot 不该触发转述')
  assert.equal(describeAssetDescription(englishPrompt), englishPrompt)
})

test('幂等：转述两次结果一致（字段会被反复渲染/回填）', () => {
  const once = describeAssetDescription(RUNTIME_SCENE_DESCRIPTION)
  assert.equal(describeAssetDescription(once), once)
})

test('资产名前缀剥离：展示层剥离，空结果回落原名（§4.6 模式 1）', () => {
  assert.equal(stripAssetNamePrefix('SCENE_星耀疗养院S级特护病房门外'), '星耀疗养院S级特护病房门外')
  assert.equal(stripAssetNamePrefix('CHAR_战凛'), '战凛')
  assert.equal(stripAssetNamePrefix('SCENE_'), 'SCENE_', '剥完是空的必须回落原名，不能给空白')
  assert.equal(stripAssetNamePrefix('普通名字'), '普通名字')
})
