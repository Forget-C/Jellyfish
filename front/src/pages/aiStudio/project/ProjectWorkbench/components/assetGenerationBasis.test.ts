/**
 * 「生成依据」渲染映射的测试（用户点名要逐项核对五项证据）：
 *   ① 原始剧本与相关分镜 ② 规范化资产资料（含别名合并） ③ 本章资料 vs 全局通用资料
 *   ④ 脱敏请求结构 ⑤ 最终提示词与差异
 * 有/无两种情况都要覆盖：**没有就如实显示「本次未提供」，一个字都不编**。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  BASIS_ABSENT_TEXT,
  BASIS_EMPTY_FROM_SERVER_TEXT,
  BASIS_ITEM_EMPTY_TEXT,
  BASIS_ITEM_LABEL,
  BASIS_ITEM_ORDER,
  GLOBAL_ASSET_SCOPE_NOTE,
  NO_BASIS_TEXT,
  buildBasisItems,
  buildBasisPlaceholderText,
  buildRequestStructureText,
  describeBasisAvailability,
  describeBasisFieldNames,
  describeStructuredSource,
  readGenerationBasis,
  summarizeGenerationBasis,
} from './assetGenerationBasis.ts'

const itemsByKey = (basis: ReturnType<typeof readGenerationBasis>) =>
  new Map(buildBasisItems(basis).map((item) => [item.key, item]))

test('无字段：契约还没上线时如实显示「本次未提供生成依据」，九行全是占位（不编造）', () => {
  const basis = readGenerationBasis({ slots: [{ category: 'character_image_front', prompt: '韩虹，35 岁女律师' }] })
  assert.equal(basis.available, false)
  assert.equal(basis.fromServer, false)
  assert.equal(basis.missingKeys.length, BASIS_ITEM_ORDER.length)

  const items = buildBasisItems(basis)
  assert.deepEqual(
    items.map((item) => item.key),
    BASIS_ITEM_ORDER,
  )
  items.forEach((item) => {
    assert.equal(item.provided, false)
    assert.deepEqual(item.lines, [BASIS_ITEM_EMPTY_TEXT])
    assert.ok(!item.lines.join('').includes('韩虹'))
  })
  assert.equal(summarizeGenerationBasis(basis), NO_BASIS_TEXT)
  assert.equal(buildBasisPlaceholderText(basis), NO_BASIS_TEXT)
  assert.equal(describeBasisAvailability(basis), BASIS_ABSENT_TEXT)
  assert.equal(describeBasisFieldNames(basis), '本次回包里没有资料清单')
  // 五个验收项的标签都在（渲染位置保留，且标签里带 ①~⑤ 便于逐项核对）
  const labels = items.map((item) => item.label)
  ;['①', '②', '③-a', '③-b', '④', '⑤'].forEach((mark) => {
    assert.ok(labels.some((label) => label.includes(mark)), `缺少 ${mark} 那一行`)
  })
  assert.equal(BASIS_ITEM_LABEL.requestStructure, '④ 图片提示词服务的脱敏请求结构')
  assert.ok(GLOBAL_ASSET_SCOPE_NOTE.includes('所有项目共用'))
})

test('无字段：null / 空对象 / 字符串都不编造；④⑤ 只认调用方真的给了的内容', () => {
  ;[null, undefined, {}, 'x', 42].forEach((payload) => {
    const basis = readGenerationBasis(payload)
    assert.equal(basis.available, false)
    assert.equal(basis.fromServer, false)
    assert.equal(summarizeGenerationBasis(basis), NO_BASIS_TEXT)
    buildBasisItems(basis).forEach((item) => assert.deepEqual(item.lines, [BASIS_ITEM_EMPTY_TEXT]))
  })
  // 后端什么都没有，但前端确实发出了请求 / 确实有最终提示词 → 这两行如实显示
  const withExtras = readGenerationBasis(null, {
    requestStructure: '{"project_id":"p1","categories":["character_image_front"]}',
    finalPrompt: '韩虹，35 岁女律师，齐肩黑发',
    promptDifferences: ['与「陆行舟」相似度 12%（差异明显）'],
    globalAsset: false,
  })
  assert.equal(withExtras.available, true)
  const byKey = itemsByKey(withExtras)
  assert.equal(byKey.get('requestStructure')?.provided, true)
  assert.equal(byKey.get('finalPrompts')?.provided, true)
  assert.match(byKey.get('finalPrompts')?.lines.join('\n') ?? '', /与「陆行舟」相似度 12%/)
  // 后端才有的三项仍然如实占位
  assert.equal(byKey.get('scriptAndShots')?.provided, false)
  assert.equal(byKey.get('assetProfile')?.provided, false)
  assert.equal(byKey.get('scopedBasis')?.provided, false)
})

test('有字段但全空：说明是「返回了但为空」，仍然不冒充有依据', () => {
  const basis = readGenerationBasis({
    generation_basis: { project_style: '', asset_profile: [], script_excerpts: [], shot_refs: [] },
  })
  assert.equal(basis.fromServer, true)
  assert.equal(basis.available, false)
  assert.equal(basis.containerKey, 'generation_basis')
  assert.equal(buildBasisPlaceholderText(basis), NO_BASIS_TEXT)
  assert.equal(describeBasisAvailability(basis), BASIS_EMPTY_FROM_SERVER_TEXT)
})

test('① 原始剧本与相关分镜：镜头 id/序号/标题 + 本章原文摘录都如实映射', () => {
  const basis = readGenerationBasis({
    slot: {
      generation_basis: {
        shot_refs: [{ shot_id: 'shot-1', shot_index: 3, title: '法庭对峙' }],
        script_excerpts: [{ shot_index: 3, snippet: '韩虹推门而入，法庭顿时安静。' }],
        evidence: [{ snippet: '「你迟到了。」法官说。', grounded: true, from_name: '韩虹' }],
      },
    },
  })
  assert.equal(basis.available, true)
  assert.deepEqual(basis.shotRefs, [{ shotId: 'shot-1', shotIndex: '3', title: '法庭对峙' }])
  const lines = itemsByKey(basis).get('scriptAndShots')?.lines.join('\n') ?? ''
  assert.match(lines, /相关分镜 1 条/)
  assert.match(lines, /镜头 3（shot-1）：法庭对峙/)
  assert.match(lines, /剧本原文 2 处/)
  assert.match(lines, /韩虹推门而入/)
  assert.match(lines, /「你迟到了。」法官说。/)
  // grounded / from_name 这类内部标记不进正文
  assert.ok(!lines.includes('grounded'))
})

test('② 规范化资产资料：字段翻译成人话 + 别名合并结果单独一行', () => {
  const basis = readGenerationBasis({
    fields: {
      appearance: '齐肩黑发，冷冽眼神',
      related_plot: '本案被告的辩护律师',
      clothing: '深灰西装',
      shot_refs: '1、3',
      file_id: 'f_123',
      linked_entity_id: 'e_9',
    },
    aliases: ['小虹', '韩律师'],
    display_name: '韩虹（小虹、韩律师）',
  })
  const item = itemsByKey(basis).get('assetProfile')
  assert.equal(item?.provided, true)
  const text = item?.lines.join('\n') ?? ''
  assert.match(text, /外观：齐肩黑发，冷冽眼神/)
  assert.match(text, /剧情身份：本案被告的辩护律师/)
  assert.match(text, /服装：深灰西装/)
  assert.match(text, /别名合并结果：小虹、韩律师 → 韩虹/)
  // 内部字段（file_id / linked_entity_id）不进主界面
  assert.ok(!text.includes('f_123'))
  assert.ok(!text.includes('e_9'))
  assert.ok(!text.includes('file_id'))
  assert.match(item?.summary ?? '', /别名合并 2 个/)
})

test('③ 数据隔离：全局通用资料与「本章资料」分成两行，并点明不会写回全局', () => {
  const basis = readGenerationBasis(
    {
      generation_basis: {
        global_profile: '旧录音笔（通用）：银色金属外壳，磨砂质感',
        scoped_basis: ['第 3 集第 2 场：韩虹在法庭上按下录音笔', '出场镜头 #3、#7'],
      },
    },
    { globalAsset: true },
  )
  const byKey = itemsByKey(basis)
  assert.equal(byKey.get('globalProfile')?.provided, true)
  assert.match(byKey.get('globalProfile')?.lines.join('\n') ?? '', /旧录音笔（通用）/)
  assert.match(byKey.get('globalProfile')?.lines.join('\n') ?? '', /不属于本章资料/)
  assert.equal(byKey.get('scopedBasis')?.provided, true)
  assert.match(byKey.get('scopedBasis')?.lines.join('\n') ?? '', /韩虹在法庭上按下录音笔/)
  assert.match(byKey.get('scopedBasis')?.lines.join('\n') ?? '', /项目 \+ 章节 隔离保存/)
  // 角色（项目内资产）不显示这句隔离说明
  const characterBasis = readGenerationBasis(
    { global_profile: '通用描述', scoped_basis: ['本章依据'] },
    { globalAsset: false },
  )
  const characterLines = itemsByKey(characterBasis).get('globalProfile')?.lines.join('\n') ?? ''
  assert.ok(!characterLines.includes('不属于本章资料'))
})

test('④ 脱敏请求结构：原样展示本次发出的结构，内部 ID 被替换', () => {
  const text = buildRequestStructureText({
    project_id: 'b5e04f90-e348-446c-80ff-b4f7826efd1f',
    categories: ['character_image_front'],
    style_hint: '现实主义都市短剧',
    entity_profiles: [{ name: '韩虹', entity_type: 'character', profile_source: 'asset_description' }],
  })
  assert.match(text, /categories/)
  assert.match(text, /character_image_front/)
  assert.match(text, /（内部 ID 已脱敏）/)
  assert.ok(!text.includes('b5e04f90-e348-446c-80ff-b4f7826efd1f'))

  const basis = readGenerationBasis(null, { requestStructure: text })
  const item = itemsByKey(basis).get('requestStructure')
  assert.equal(item?.provided, true)
  assert.equal(item?.summary, '本次实际发出的请求（已脱敏）')
  assert.ok((item?.lines.length ?? 0) > 3)
  assert.equal(buildRequestStructureText(null), '')
})

test('⑤ 最终提示词与差异：本资产的那条 + 与同批其它资产的差异都显示', () => {
  const basis = readGenerationBasis(null, {
    finalPrompt: '韩虹，35 岁女律师，齐肩黑发，深灰西装，正脸半身，纯白背景',
    promptDifferences: ['与「陆行舟」相似度 8%（差异明显）', '与「法院走廊」相似度 11%（差异明显）'],
  })
  const item = itemsByKey(basis).get('finalPrompts')
  assert.equal(item?.provided, true)
  assert.match(item?.lines[0] ?? '', /本次真正会用的提示词：韩虹/)
  assert.match(item?.lines.join('\n') ?? '', /与「陆行舟」相似度 8%/)
  assert.equal(item?.summary, '差异 2 条')
  assert.equal(summarizeGenerationBasis(basis), '本次用到：本次采用的提示词')
})

test('后端这一轮的正式字段：structured_source / profile_source 也要如实显示（含"没有任何资料"）', () => {
  const fromSlot = readGenerationBasis({
    category: 'character_image_front',
    prompt: '韩虹，正面半身',
    savable: false,
    structured_source: 'none',
  })
  assert.equal(fromSlot.available, true)
  assert.equal(fromSlot.structuredSource, 'none')
  assert.equal(fromSlot.lacksStructuredProfile, true)
  assert.match(summarizeGenerationBasis(fromSlot), /没有任何资料（只剩空话兜底）/)
  const profileItem = itemsByKey(fromSlot).get('assetProfile')
  assert.match(profileItem?.lines.join('\n') ?? '', /先把资料补齐/)

  const fromCard = readGenerationBasis({
    slots: [{ category: 'character_image_front', prompt: '韩虹，35 岁女律师，齐肩黑发' }],
    entity_cards: [{ name: '韩虹', profile_source: 'asset_description', has_structured_profile: true }],
  })
  assert.equal(fromCard.containerKey, 'entity_cards[0].profile_source')
  assert.equal(fromCard.lacksStructuredProfile, false)

  // 富化后的组合来源要能说清"全局 + 本章"
  const enriched = readGenerationBasis({ structured_source: 'asset_description+candidate_profile' })
  assert.ok(summarizeGenerationBasis(enriched).includes('资产描述（全局）+ 结构化资料（本章，含剧本片段与出场镜头）'))
})

test('字段名容错：camelCase / 常见容器名 / 候选 payload 的真实键名都能认出', () => {
  const camel = readGenerationBasis({
    data: {
      generationContext: { projectStyle: '赛博朋克', assetProfile: [{ label: '外观', value: '银发机械臂' }] },
    },
  })
  assert.equal(camel.projectStyle, '赛博朋克')
  assert.deepEqual(camel.profileFields, [{ label: '外观', value: '银发机械臂' }])
  assert.equal(camel.containerKey, 'data.generationContext')

  // 后端确认写入候选 payload 的那套键名（chapter_asset_profile_confirm.py）
  const candidatePayload = readGenerationBasis({
    basis: {
      asset_profile: { material: '黄铜', color: '暗金色' },
      aliases: ['小录音笔'],
      shot_refs: [{ shot_index: 7 }],
      evidence: [{ snippet: '她按下录音笔。' }],
    },
  })
  assert.equal(candidatePayload.available, true)
  assert.deepEqual(candidatePayload.shotRefs, [{ shotId: '', shotIndex: '7', title: '' }])
  assert.equal(candidatePayload.aliasMerge.aliases[0], '小录音笔')

  const provenance = readGenerationBasis({ provenance: { script_excerpt: '雨水打在玻璃上。' } })
  assert.equal(provenance.available, true)
  assert.equal(summarizeGenerationBasis(provenance), '本次用到：剧本/分镜 1 项')
  assert.ok(describeBasisFieldNames(provenance).includes('provenance'))
})

test('未提供的项一律显示「本次未提供」（缺一项就只占位那一项，不牵连其它项）', () => {
  const basis = readGenerationBasis(
    { basis: { project_style: '水墨国风', shot_refs: [{ shot_index: 7 }] } },
    { finalPrompt: '甲，白袍，长剑' },
  )
  const byKey = itemsByKey(basis)
  assert.deepEqual(byKey.get('assetProfile')?.lines, [BASIS_ITEM_EMPTY_TEXT])
  assert.deepEqual(byKey.get('scopedBasis')?.lines, [BASIS_ITEM_EMPTY_TEXT])
  assert.deepEqual(byKey.get('globalProfile')?.lines, [BASIS_ITEM_EMPTY_TEXT])
  assert.deepEqual(byKey.get('requestStructure')?.lines, [BASIS_ITEM_EMPTY_TEXT])
  assert.deepEqual(byKey.get('userSupplement')?.lines, [BASIS_ITEM_EMPTY_TEXT])
  assert.equal(byKey.get('scriptAndShots')?.provided, true)
  assert.equal(byKey.get('projectStyle')?.provided, true)
  // 缺项清单如实列出（页面据此写"本次未提供的：…"）
  assert.ok(describeBasisAvailability(basis).includes('本次未提供的：'))
})


test('来源码翻译：后端新增的 chapter_record 系列必须说人话，未登记的码不许摊内部标识', () => {
  // 2026-09 章节资料改存专用表后，后端回的是 chapter_record 这一档
  assert.match(describeStructuredSource('chapter_record'), /本章资产资料/)
  assert.match(describeStructuredSource('chapter_record'), /重启/)
  assert.match(describeStructuredSource('asset_description+chapter_record'), /资产描述/)
  // 旧结构（历史数据）也要能说清楚，而不是把码直接摊给用户
  assert.match(describeStructuredSource('chapter_overlay'), /章节隔离/)
  assert.match(describeStructuredSource('asset_description+chapter_overlay+candidate_profile'), /资产描述/)
  assert.match(describeStructuredSource('candidate_profile'), /结构化资料/)
  assert.match(describeStructuredSource('script_window'), /剧本/)
  // 未登记的**内部标识**：给中文兜底，不能把 `some_new_code` 原样显示
  const unknown = describeStructuredSource('some_new_code')
  assert.doesNotMatch(unknown, /some_new_code/)
  assert.match(unknown, /本章资产资料/)
  // 空码就是空（页面据此显示「本次未提供」）
  assert.equal(describeStructuredSource(''), '')
})
