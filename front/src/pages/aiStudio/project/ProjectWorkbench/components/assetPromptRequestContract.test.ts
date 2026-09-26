/**
 * 「请求字段能力探测」的测试：**只送后端声明过的字段**，读不到清单就一个都不送
 * （绝不能因为多送字段把生成打坏），并且页面如实说明哪些信息这次送不进去。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PROMPT_REQUEST_SUPPORT_NONE,
  buildAssetPromptBatchSaveBody,
  buildEntityProfileEntry,
  collectReplacedSlots,
  matchesRequestedAsset,
  normalizeAssetName,
  readAssetPromptBatchSaveSupport,
  buildPromptRequestExtras,
  describePromptRequestDelivery,
  describePromptRequestFields,
  readPromptRequestFieldSupport,
} from './assetPromptRequestContract.ts'

/** 今天的后端（有 style_hint / extra_instructions / negative_prompt，没有 user_supplement / asset_id）。 */
function specWithTodayFields() {
  return {
    paths: {
      '/api/v1/studio/llm/image-prompt/preview': {
        post: {
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ImagePromptPreviewRequest' } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ImagePromptPreviewRequest: {
          properties: {
            shot_id: { type: 'string' },
            project_id: { type: 'string' },
            entity_profiles: { type: 'array' },
            categories: { type: 'array' },
            style_hint: { type: 'string' },
            negative_prompt: { type: 'string' },
            extra_instructions: { type: 'string' },
          },
        },
      },
    },
  }
}

/** 后端补上新字段之后的样子。 */
function specWithNewFields() {
  const spec = specWithTodayFields()
  const props = spec.components.schemas.ImagePromptPreviewRequest.properties as Record<string, unknown>
  props.user_supplement = { type: 'string' }
  props.asset_id = { type: 'string' }
  props.asset_type = { type: 'string' }
  return spec
}

test('今天的后端：项目风格走 style_hint、用户补充走 extra_instructions', () => {
  const support = readPromptRequestFieldSupport(specWithTodayFields())
  assert.equal(support.specRead, true)
  assert.equal(support.keys.styleHint, 'style_hint')
  assert.equal(support.keys.userSupplement, 'extra_instructions')
  assert.equal(support.keys.assetId, '')

  const extras = buildPromptRequestExtras({
    support,
    styleHint: '现实主义都市短剧，冷色调',
    userSupplement: '正面半身，纯白背景',
    assetId: 'c1',
  })
  assert.deepEqual(extras, {
    style_hint: '现实主义都市短剧，冷色调',
    extra_instructions: '正面半身，纯白背景',
  })
  // 资产身份后端还没声明 → 不送（不会把请求打坏）
  assert.ok(!('asset_id' in extras))

  const text = describePromptRequestDelivery(support, true)
  assert.match(text, /项目整体风格/)
  assert.match(text, /你的补充/)
  assert.match(text, /后端还没有接收：该资产的身份/)
  // 主界面那句话里不出现字段名/内部标识
  assert.ok(!text.includes('extra_instructions'))
  assert.match(describePromptRequestFields(support), /项目整体风格 → style_hint/)
  assert.match(describePromptRequestFields(support), /你的补充\/修改 → extra_instructions/)
})

test('后端补上新字段后：专用字段优先（自动开始使用，前端不用改）', () => {
  const support = readPromptRequestFieldSupport(specWithNewFields())
  assert.equal(support.keys.userSupplement, 'user_supplement')
  assert.equal(support.keys.assetId, 'asset_id')
  assert.equal(support.keys.assetType, 'asset_type')
  const extras = buildPromptRequestExtras({
    support,
    styleHint: '水墨国风',
    userSupplement: '侧脸 3/4',
    assetId: 's1',
    assetType: 'scene',
  })
  assert.deepEqual(extras, {
    style_hint: '水墨国风',
    user_supplement: '侧脸 3/4',
    asset_id: 's1',
    asset_type: 'scene',
  })
  assert.match(describePromptRequestDelivery(support, true), /该资产的身份/)
  assert.ok(!describePromptRequestDelivery(support, true).includes('后端还没有接收'))
})

test('读不到接口清单：一个字段都不送，且如实说明', () => {
  ;[null, undefined, {}, 'x', { paths: {} }].forEach((spec) => {
    const support = readPromptRequestFieldSupport(spec)
    assert.equal(support.specRead, false)
    assert.deepEqual(support.keys, PROMPT_REQUEST_SUPPORT_NONE.keys)
    assert.deepEqual(buildPromptRequestExtras({ support, styleHint: '风格', userSupplement: '补充', assetId: 'c1' }), {})
    assert.match(describePromptRequestDelivery(support, true), /没能读到后端接口清单/)
    assert.match(describePromptRequestFields(support), /未读到后端接口清单/)
  })
})

test('空值不送：没有项目风格 / 没有补充时，请求里不出现空字符串字段', () => {
  const support = readPromptRequestFieldSupport(specWithTodayFields())
  assert.deepEqual(buildPromptRequestExtras({ support }), {})
  assert.deepEqual(buildPromptRequestExtras({ support, styleHint: '   ', userSupplement: '' }), {})
  assert.deepEqual(buildPromptRequestExtras({ support, userSupplement: '  ' }), {})
  // 只有补充时也只送那一个键
  assert.deepEqual(buildPromptRequestExtras({ support, userSupplement: '补一句' }), {
    extra_instructions: '补一句',
  })
})

test('请求模型直接内联给出 properties 时也能读到', () => {
  const support = readPromptRequestFieldSupport({
    paths: {
      '/api/v1/studio/llm/image-prompt/preview': {
        post: {
          requestBody: {
            content: { 'application/json': { schema: { properties: { style_hint: { type: 'string' } } } } },
          },
        },
      },
    },
  })
  assert.equal(support.specRead, true)
  assert.equal(support.keys.styleHint, 'style_hint')
  assert.equal(support.keys.userSupplement, '')
})

test('批量保存入口的探测与请求体：读得到就用它，读不到就退回逐资产保存', () => {
  const withEndpoint = {
    paths: {
      '/api/v1/studio/projects/{project_id}/asset-image-prompts': { post: { summary: '批量保存资产图片提示词' } },
    },
  }
  const support = readAssetPromptBatchSaveSupport(withEndpoint)
  assert.equal(support.available, true)
  assert.equal(support.path, '/api/v1/studio/projects/{project_id}/asset-image-prompts')
  assert.equal(support.confirmField, 'confirm_replace_image_prompt')

  ;[null, {}, { paths: {} }, 'x'].forEach((spec) => {
    const none = readAssetPromptBatchSaveSupport(spec)
    assert.equal(none.available, false)
    assert.equal(none.path, '')
  })

  // 请求体：只放真的会写进去的项；覆盖开关默认 false（不替用户决定覆盖）
  const body = buildAssetPromptBatchSaveBody({
    items: [
      { assetType: 'character', assetId: 'c1', imagePrompts: { character_image_front: '韩虹，35 岁女律师，齐肩黑发' } },
      { assetType: 'prop', assetId: 'p1', imagePrompts: { prop_image_front: '   ' } },
      { assetType: '', assetId: 'x', imagePrompts: { a: 'b' } },
    ],
    confirmedReplace: false,
  })
  assert.deepEqual(body, {
    items: [
      {
        asset_type: 'character',
        asset_id: 'c1',
        image_prompts: { character_image_front: '韩虹，35 岁女律师，齐肩黑发' },
      },
    ],
    confirm_replace_image_prompt: false,
  })
  assert.equal(
    buildAssetPromptBatchSaveBody({
      items: [{ assetType: 'scene', assetId: 's1', imagePrompts: { scene_image_front: '旧法院走廊' } }],
      confirmedReplace: true,
    }).confirm_replace_image_prompt,
    true,
  )

  // 哪些槽位会被覆盖（决定要不要先跟用户确认）
  assert.deepEqual(
    collectReplacedSlots(
      { character_image_front: '旧的一条', character_image_other: '侧面的旧内容' },
      { character_image_front: '新的一条', character_image_other: '侧面的旧内容' },
    ),
    ['character_image_front'],
  )
  assert.deepEqual(collectReplacedSlots(undefined, { character_image_front: '第一条' }), [])
})

test('画像条目：来源如实标注（有描述=资产描述，没有=none），并且只发后端声明过的字段', () => {
  const withSource = readPromptRequestFieldSupport({
    paths: {
      '/api/v1/studio/llm/image-prompt/preview': {
        post: {
          requestBody: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/ImagePromptPreviewRequest' } },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ImagePromptPreviewRequest: { properties: { project_id: { type: 'string' }, categories: { type: 'array' } } },
        EntityProfileInput: {
          properties: { name: { type: 'string' }, entity_type: { type: 'string' }, profile_source: { type: 'string' } },
        },
      },
    },
  })
  assert.equal(withSource.keys.entityProfileSource, 'profile_source')
  assert.deepEqual(buildEntityProfileEntry({ name: '韩虹', entityType: 'character', profile: '35 岁女律师，齐肩黑发', support: withSource }), {
    name: '韩虹',
    entity_type: 'character',
    profile: '35 岁女律师，齐肩黑发',
    profile_source: 'asset_description',
  })
  assert.equal(
    buildEntityProfileEntry({ name: '韩虹', entityType: 'character', profile: '   ', support: withSource }).profile_source,
    'none',
  )

  // 后端没声明 profile_source（今天的样子）→ 一个额外字段都不发
  const withoutSource = readPromptRequestFieldSupport({
    paths: {
      '/api/v1/studio/llm/image-prompt/preview': {
        post: { requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/ImagePromptPreviewRequest' } } } } },
      },
    },
    components: {
      schemas: {
        ImagePromptPreviewRequest: { properties: { project_id: { type: 'string' } } },
        EntityProfileInput: { properties: { name: { type: 'string' } } },
      },
    },
  })
  assert.equal(withoutSource.keys.entityProfileSource, '')
  assert.deepEqual(buildEntityProfileEntry({ name: '韩虹', entityType: 'character', profile: '有内容', support: withoutSource }), {
    name: '韩虹',
    entity_type: 'character',
    profile: '有内容',
  })
})

test('目标资产核对：后端给回来的画像/槽位必须是**这个**资产，否则不许用（避免张冠李戴）', () => {
  assert.equal(normalizeAssetName('道具·旧录音笔'), '旧录音笔')
  assert.equal(normalizeAssetName(' 沈 青 禾 '), '沈青禾')
  assert.equal(normalizeAssetName('人物-韩虹'), '韩虹')

  assert.equal(matchesRequestedAsset({ slot: { entity_name: '韩虹' } }, '韩虹'), true)
  // 前端展示名带类型前缀时也要认
  assert.equal(matchesRequestedAsset({ slot: { entity_name: '旧录音笔' } }, '道具·旧录音笔'), true)
  // 拿回来的是别的资产 → 不许用（调用方会退回"调用方传入画像"那条路）
  assert.equal(matchesRequestedAsset({ slot: { entity_name: '陆行舟' } }, '韩虹'), false)
  assert.equal(matchesRequestedAsset({ slots: [{ entity_name: '陆行舟' }] }, '韩虹'), false)
  assert.equal(matchesRequestedAsset({ entity_cards: [{ name: '韩虹' }] }, '韩虹'), true)
  assert.equal(matchesRequestedAsset({ slot: { entity_name: '' } }, '韩虹'), false)
  assert.equal(matchesRequestedAsset(null, '韩虹'), false)
  assert.equal(matchesRequestedAsset({ slot: { entity_name: '韩虹' } }, ''), false)
})
