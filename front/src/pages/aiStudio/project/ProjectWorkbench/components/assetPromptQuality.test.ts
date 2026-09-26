/**
 * 提示词质量拦截的展示规则测试。
 *
 * 硬要求：四种不可用情形各自的文案都要点到，并且**任何一条都不许出现「已就绪」**，
 * 也不能把不可用的提示词放进可出图的那一批。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DUPLICATE_SIMILARITY_THRESHOLD,
  FORBIDDEN_READY_COPY,
  MIN_INFORMATIVE_CORE_LENGTH,
  PROMPT_QUALITY_FIXES,
  buildBatchPromptQualityGate,
  buildPromptQualityGateModal,
  buildQualityNotice,
  canSavePromptToAsset,
  describePromptPanelRowQuality,
  describePromptSaveFailure,
  buildPromptDifferenceLines,
  summarizePromptDifferences,
  extractInformativeCore,
  findDuplicatedPromptIndexes,
  findReadyCopy,
  promptSimilarity,
  readServerPromptQuality,
  readStructuredServerError,
  resolvePromptQuality,
  selectAssetsForSubmit,
} from './assetPromptQuality.ts'
import { groupAssetsByType } from './assetResultKind.ts'

const CHARACTER_PROMPT = '韩虹，35 岁女律师，齐肩黑发，冷冽眼神，深灰西装，正脸半身，纯白背景，photorealistic, cinematic lighting'

test('不可用情形一：空提示词 → 如实说"还没有内容"，并给出怎么补', () => {
  const verdict = resolvePromptQuality({ prompt: '   ', assetName: '韩虹' })
  assert.equal(verdict.status, 'unusable')
  assert.equal(verdict.usable, false)
  assert.equal(verdict.code, 'empty')
  assert.equal(verdict.label, '提示词为空')
  const notice = buildQualityNotice(verdict)
  assert.equal(notice.tone, 'error')
  assert.equal(notice.canGenerate, false)
  assert.match(notice.lines.join('\n'), /原因：/)
  assert.match(notice.lines.join('\n'), /怎么修：/)
  assert.deepEqual(
    notice.lines.filter((line) => line.startsWith('怎么修：')),
    PROMPT_QUALITY_FIXES.empty.map((fix) => `怎么修：${fix}`),
  )
})

test('不可用情形二：外观信息不足 / 需人工补充（后端结构化原因优先）', () => {
  const verdict = resolvePromptQuality({
    prompt: '韩虹，photorealistic, cinematic lighting',
    assetName: '韩虹',
    serverQuality: {
      usable: false,
      code: 'insufficient_appearance',
      blocking_reasons: ['外观信息不足，需人工补充：该资产的描述里没有发型与服装信息'],
      fixes: ['补全该资产的外观描述后重新生成'],
    },
  })
  assert.equal(verdict.status, 'unusable')
  assert.equal(verdict.code, 'insufficient_appearance')
  assert.equal(verdict.source, 'server')
  assert.match(verdict.reason, /外观信息不足/)
  assert.deepEqual(verdict.fixes, ['补全该资产的外观描述后重新生成'])
  assert.equal(buildQualityNotice(verdict).canGenerate, false)

  // 后端只给中文告警（没有结构化判定）时同样能拦住
  const fromWarning = resolvePromptQuality({
    prompt: '韩虹，正面半身',
    assetName: '韩虹',
    serverWarnings: ['该资产外观信息不足，需人工补充'],
  })
  assert.equal(fromWarning.code, 'insufficient_appearance')
  assert.match(fromWarning.reason, /外观信息不足/)

  // 模板占位痕迹（演练/模板拼出来的）也算外观信息不足
  const placeholder = resolvePromptQuality({
    prompt: '[DRY_RUN 占位] 韩虹 主体描述待模型依据镜头文本生成',
    assetName: '韩虹',
  })
  assert.equal(placeholder.code, 'insufficient_appearance')
  assert.equal(placeholder.source, 'local')
})

test('不可用情形三：只有名称 + 通用摄影词 → 明确说"去掉名称与通用词只剩 N 个字"', () => {
  const verdict = resolvePromptQuality({
    prompt: '韩虹，正面半身，纯白背景，photorealistic, cinematic lighting, sharp focus, 8k, high resolution',
    assetName: '韩虹',
  })
  assert.equal(verdict.status, 'unusable')
  assert.equal(verdict.code, 'generic_only')
  assert.match(verdict.reason, /通用摄影词/)
  assert.match(buildQualityNotice(verdict).title, /只有名称与通用摄影词/)
  assert.equal(buildQualityNotice(verdict).canGenerate, false)

  // 有外观描述的提示词不会被误判
  const good = resolvePromptQuality({ prompt: CHARACTER_PROMPT, assetName: '韩虹' })
  assert.equal(good.status, 'usable')
  assert.equal(good.usable, true)
  assert.equal(buildQualityNotice(good).canGenerate, true)
  // 核心正文长度确实够
  assert.ok(extractInformativeCore(CHARACTER_PROMPT, '韩虹').length >= MIN_INFORMATIVE_CORE_LENGTH)
  assert.ok(extractInformativeCore('韩虹，正面半身，纯白背景，8k', '韩虹').length < MIN_INFORMATIVE_CORE_LENGTH)
})

test('不可用情形四：多个资产高度重复（跨资产才判，同一资产不算）', () => {
  const shared = '人物正面半身，纯白背景，photorealistic, cinematic lighting, sharp focus'
  const indexes = findDuplicatedPromptIndexes([shared, shared, CHARACTER_PROMPT], ['甲', '乙', '丙'])
  assert.deepEqual(indexes, [0, 1])
  // 相似度阈值：近乎相同才算重复
  assert.ok(promptSimilarity(shared, shared) >= DUPLICATE_SIMILARITY_THRESHOLD)
  assert.ok(promptSimilarity(CHARACTER_PROMPT, shared) < DUPLICATE_SIMILARITY_THRESHOLD)
  // 同一个资产名（不同"槽位"行）不算"多个资产重复"
  assert.deepEqual(findDuplicatedPromptIndexes([shared, shared], ['甲', '甲']), [])

  // 文本看着完整、但与同批其它资产字字相同 → 按"高度重复"拦住
  const verdict = resolvePromptQuality({ prompt: CHARACTER_PROMPT, assetName: '甲', duplicated: true })
  assert.equal(verdict.status, 'unusable')
  assert.equal(verdict.code, 'duplicated')
  assert.equal(buildQualityNotice(verdict).canGenerate, false)

  // 通用词重复的：两种原因都成立，只要**拦住**就行
  // （阈值与后端对齐到 2 字后，「人物」这种泛称也算 2 个特征字 → 命中"高度重复"）
  const genericDuplicate = resolvePromptQuality({ prompt: shared, assetName: '甲', duplicated: true })
  assert.equal(genericDuplicate.status, 'unusable')
  assert.ok(['generic_only', 'duplicated'].includes(genericDuplicate.code), genericDuplicate.code)
})

test('不确定就不宣称可用：拿不到提示词内容 → 状态是"未知"，且拦不住也不写"已就绪"', () => {
  const verdict = resolvePromptQuality({ prompt: null, assetName: '韩虹' })
  assert.equal(verdict.status, 'unknown')
  assert.equal(verdict.usable, false)
  assert.equal(verdict.label, '质量还没判定')
  const notice = buildQualityNotice(verdict)
  assert.equal(notice.canGenerate, true)
  assert.match(notice.title, /还没判定/)
  assert.equal(findReadyCopy(`${verdict.label}${verdict.reason}${notice.title}${notice.lines.join('')}`).length, 0)
})

test('后端说可用时本地也仍然先过空 / 外观信息不足这两道（更保守的一侧胜出）', () => {
  const empty = resolvePromptQuality({ prompt: '', assetName: '韩虹', serverQuality: { usable: true } })
  assert.equal(empty.status, 'unusable')
  assert.equal(empty.code, 'empty')
  const ok = resolvePromptQuality({
    prompt: CHARACTER_PROMPT,
    assetName: '韩虹',
    serverQuality: { usable: true, label: '后端判定可用' },
  })
  assert.equal(ok.status, 'usable')
  assert.equal(ok.source, 'server')
})

test('四种不可用情形 + 可用/未知：所有文案都不出现「已就绪」这类说法', () => {
  const verdicts = [
    resolvePromptQuality({ prompt: '', assetName: '甲' }),
    resolvePromptQuality({ prompt: '甲，正面半身', assetName: '甲', serverWarnings: ['外观信息不足，需人工补充'] }),
    resolvePromptQuality({ prompt: '甲，正面半身，纯白背景，8k', assetName: '甲' }),
    resolvePromptQuality({ prompt: '甲，正面半身，纯白背景', assetName: '甲', duplicated: true }),
    resolvePromptQuality({ prompt: CHARACTER_PROMPT, assetName: '甲' }),
    resolvePromptQuality({ prompt: null, assetName: '甲' }),
  ]
  verdicts.forEach((verdict) => {
    const notice = buildQualityNotice(verdict)
    const all = [verdict.label, verdict.reason, ...verdict.fixes, notice.title, ...notice.lines].join('\n')
    assert.equal(findReadyCopy(all).length, 0, `出现了"说成就绪"的说法：${all}`)
    FORBIDDEN_READY_COPY.forEach((token) => assert.ok(!all.includes(token), `${all} 命中 ${token}`))
    // 也不许把不可用说成"可用"
    if (verdict.status === 'unusable') {
      assert.ok(!/提示词可用|可以出图|可使用/.test(notice.title), notice.title)
      assert.equal(notice.canGenerate, false)
    }
  })
})

test('批量闸门：不可用的项被拦住、可用的项照常提交（并算出跳过多少）', () => {
  const assets = [
    { key: 'character:c1', id: 'c1', type: 'character', name: '韩虹' },
    { key: 'character:c2', id: 'c2', type: 'character', name: '李娜' },
    { key: 'scene:s1', id: 's1', type: 'scene', name: '法院走廊' },
    { key: 'prop:p1', id: 'p1', type: 'prop', name: '法槌' },
    { key: 'prop:p2', id: 'p2', type: 'prop', name: '惊堂木' },
  ]
  const prompts: Record<string, string> = {
    'character:c1': CHARACTER_PROMPT,
    // 只有名称 + 通用词
    'character:c2': '李娜，正面半身，纯白背景，8k',
    // 空
    'scene:s1': '',
    // 两个道具拿到的是同一条提示词（模板套出来的"高度重复"）
    'prop:p1': '棕色木质道具，铜色包边，木纹清晰，放在深色木桌上',
    'prop:p2': '棕色木质道具，铜色包边，木纹清晰，放在深色木桌上',
  }
  const gate = buildBatchPromptQualityGate({
    assets,
    promptFor: (asset) => prompts[asset.key],
  })
  assert.deepEqual(gate.allowed.map((item) => item.asset.key), ['character:c1'])
  assert.deepEqual(
    gate.blocked.map((item) => item.asset.key).sort(),
    ['character:c2', 'prop:p1', 'prop:p2', 'scene:s1'],
  )
  assert.deepEqual(gate.unknown, [])
  // 高度重复的两个道具都被点名（重复的两侧都要拦，不能只拦一边）
  assert.deepEqual(gate.duplicatedKeys.sort(), ['prop:p1', 'prop:p2'])

  const modal = buildPromptQualityGateModal(gate)
  assert.match(modal.title, /有 4 项资产的提示词不可用/)
  assert.match(modal.okText, /只生成可用的另外 1 项（跳过这 4 项）/)
  assert.equal(modal.cancelText, '先去补提示词')
  assert.equal(modal.blockedAll, false)
  // 提交时**只提交可用 + 判不出来的**，不可用的一个都不提交
  assert.deepEqual(selectAssetsForSubmit(gate).map((asset) => asset.key), ['character:c1'])
  const body = modal.lines.join('\n')
  assert.match(body, /李娜（人物）/)
  assert.match(body, /法槌（道具）/)
  assert.match(body, /法院走廊（场景）/)
  assert.match(body, /怎么修：/)
  assert.equal(findReadyCopy(body).length, 0)

  // 全部不可用：只能先去修，不给"继续生成"
  const allBlocked = buildBatchPromptQualityGate({
    assets: assets.slice(0, 2),
    promptFor: () => '',
  })
  const allModal = buildPromptQualityGateModal(allBlocked)
  assert.equal(allModal.blockedAll, true)
  assert.match(allModal.okText, /知道了/)
  assert.equal(allModal.cancelText, '')
})

test('批量闸门：拿不到提示词内容的项进 unknown（不硬拦、也不冒充可用）', () => {
  const assets = [
    { key: 'character:c1', id: 'c1', type: 'character', name: '韩虹' },
    { key: 'scene:s1', id: 's1', type: 'scene', name: '法院走廊' },
  ]
  const gate = buildBatchPromptQualityGate({
    assets,
    promptFor: (asset) => (asset.key === 'character:c1' ? CHARACTER_PROMPT : null),
  })
  assert.deepEqual(gate.allowed.map((item) => item.asset.key), ['character:c1'])
  assert.deepEqual(gate.unknown.map((item) => item.asset.key), ['scene:s1'])
  assert.deepEqual(gate.blocked, [])
  const modal = buildPromptQualityGateModal(gate)
  assert.match(modal.lines.join('\n'), /没有拿到提示词内容/)
  assert.equal(modal.blockedAll, false)
})

test('批量闸门：后端判定不可用时，即使文本看起来完整也拦住', () => {
  const assets = [{ key: 'character:c1', id: 'c1', type: 'character', name: '韩虹' }]
  const gate = buildBatchPromptQualityGate({
    assets,
    promptFor: () => CHARACTER_PROMPT,
    serverQualityFor: () => ({
      quality: { usable: false, reason: '这条提示词与人物设定冲突，需人工补充' },
    }),
  })
  assert.equal(gate.allowed.length, 0)
  assert.equal(gate.blocked.length, 1)
  assert.match(gate.blocked[0].verdict.reason, /需人工补充/)
})

test('混选批量：质量闸门 + 按类型分组路由（道具/场景不套人物口径）', () => {
  const assets = [
    { key: 'character:c1', id: 'c1', type: 'character', name: '韩虹' },
    { key: 'scene:s1', id: 's1', type: 'scene', name: '法院走廊' },
    { key: 'scene:s2', id: 's2', type: 'scene', name: '法院走廊备用' },
    { key: 'prop:p1', id: 'p1', type: 'prop', name: '法槌' },
  ]
  const prompts: Record<string, string> = {
    'character:c1': CHARACTER_PROMPT,
    'scene:s1': '旧法院走廊，灰色石墙，长条木椅，顶光从高窗斜射',
    // 只有名称 + 通用词 → 拦住
    'scene:s2': '法院走廊备用，广角，8k',
    'prop:p1': '深棕木质法槌，铜色包边，木纹清晰，放在深色木桌上',
  }
  const gate = buildBatchPromptQualityGate({ assets, promptFor: (asset) => prompts[asset.key] })
  const submit = selectAssetsForSubmit(gate)
  assert.deepEqual(submit.map((asset) => asset.key), ['character:c1', 'scene:s1', 'prop:p1'])
  assert.equal(gate.blocked.length, 1)

  // 分组路由：混选时逐组提交，各组带自己的结果类型口径（一次提交只带一个 asset_type）
  const groups = groupAssetsByType(submit)
  assert.deepEqual(groups.map((group) => group.assetType), ['character', 'scene', 'prop'])
  assert.deepEqual(groups.map((group) => group.count), [1, 1, 1])
  assert.deepEqual(groups.map((group) => group.copy.label), ['人物参考图', '场景资产图', '道具资产图'])
  // 场景/道具那两组绝不能带人物专用的结果类型
  groups
    .filter((group) => group.assetType !== 'character')
    .forEach((group) => {
      assert.notEqual(group.copy.kind, 'characterReference')
      assert.ok(!group.copy.label.includes('参考图'), group.copy.label)
      assert.equal(group.batchReferenceAllowed, false)
    })
})

test('大模型提示词面板：行质量按草稿优先，且不可用的提示词不许直接保存进资产', () => {
  const draft = '韩虹，35 岁女律师，齐肩黑发，深灰西装，正脸半身，纯白背景'
  const row = { name: '韩虹', type: 'character', draft, existing: '旧的提示词' }
  const verdict = describePromptPanelRowQuality(row)
  assert.equal(verdict.status, 'usable')
  assert.equal(canSavePromptToAsset(verdict, draft), true)

  const genericRow = { name: '李娜', type: 'character', draft: '李娜，正面半身，纯白背景，8k', existing: '' }
  const genericVerdict = describePromptPanelRowQuality(genericRow)
  assert.equal(genericVerdict.status, 'unusable')
  assert.equal(canSavePromptToAsset(genericVerdict, String(genericRow.draft)), false)
  // 空的草稿同样不能保存
  assert.equal(canSavePromptToAsset(verdict, '   '), false)

  // 没有草稿时看已保存的那条（已保存 = 有内容，按本地自查判）
  const savedOnly = describePromptPanelRowQuality({ name: '韩虹', type: 'character', draft: '', existing: draft })
  assert.equal(savedOnly.status, 'usable')
})

test('后端正式字段：savable=false + quality_issues（code/message/fix）→ 原样展示后端的中文原因与修法', () => {
  // 后端 `ImagePromptSlotRead` 的实际形态（照 asset_prompt_quality.PromptQualityIssue.to_read()）
  const slot = {
    category: 'character_image_front',
    prompt: '韩虹，正面半身，纯白背景',
    savable: false,
    structured_source: 'none',
    quality_issues: [
      {
        code: 'vague_filler',
        message: '「韩虹」的character_image_front含空话「外观信息不足」，没有任何可出图的信息，不能保存为「提示词已就绪」，也不会进入批量出图。',
        fix: '这段空话来自上游资产资料缺失。请先补齐该资产的结构化资料（角色：外貌/发型/服装配饰），再重新生成。',
        status_code: 422,
      },
    ],
  }
  const read = readServerPromptQuality(slot)
  assert.equal(read?.usable, false)
  assert.equal(read?.code, 'insufficient_appearance')
  assert.match(String(read?.reasons[0]), /外观信息不足/)
  assert.match(String(read?.fixes[0]), /补齐该资产的结构化资料/)

  const verdict = resolvePromptQuality({ prompt: slot.prompt, assetName: '韩虹', serverQuality: slot })
  assert.equal(verdict.status, 'unusable')
  assert.equal(verdict.source, 'server')
  assert.match(verdict.reason, /外观信息不足/)
  assert.match(verdict.fixes.join(), /重新生成/)
  assert.equal(buildQualityNotice(verdict).canGenerate, false)

  // 后端说 savable=true → 可用（前提是本地那两道硬检查也过）
  const okSlot = { category: 'x', prompt: CHARACTER_PROMPT, savable: true, quality_issues: [], structured_source: 'candidate_profile' }
  assert.equal(readServerPromptQuality(okSlot)?.usable, true)
  assert.equal(resolvePromptQuality({ prompt: CHARACTER_PROMPT, assetName: '韩虹', serverQuality: okSlot }).status, 'usable')

  // 后端五种错误码都要映射到页面的四种情形之一（不出现"未知码"）
  const codeMap = [
    ['empty_prompt', 'empty'],
    ['vague_filler', 'insufficient_appearance'],
    ['name_only_generic', 'generic_only'],
    ['duplicate_prompt_text', 'duplicated'],
    ['near_duplicate_prompt_text', 'duplicated'],
  ] as const
  codeMap.forEach(([serverCode, pageCode]) => {
    const verdictByCode = resolvePromptQuality({
      prompt: CHARACTER_PROMPT,
      assetName: '韩虹',
      serverQuality: {
        savable: false,
        quality_issues: [{ code: serverCode, message: `后端原因 ${serverCode}`, fix: `后端修法 ${serverCode}` }],
      },
    })
    assert.equal(verdictByCode.code, pageCode, serverCode)
    assert.match(verdictByCode.reason, new RegExp(serverCode))
    assert.match(verdictByCode.fixes[0], new RegExp(serverCode))
    assert.equal(verdictByCode.source, 'server')
  })
})

test('保存失败的结构化错误：从拼接文本里读出 code / message / fix，并把"要显式确认覆盖"说清楚', () => {
  // `callApi` 会把 detail 一起拼进错误文本（对象 detail 走 JSON.stringify）
  const conflict = readStructuredServerError(
    'HTTP 409（{"code":"image_prompt_replace_required","message":"韩虹已有 1 个提示词槽位（character_image_front）保存过内容，本次写入会把它们替换掉；已有提示词默认不动，需要你**显式确认**才会覆盖。","fix":"如果确实要用新内容覆盖，请**显式确认**：在同一请求里带上 \\"confirm_replace_image_prompt\\": true 再提交；","confirm_field":"confirm_replace_image_prompt","status_code":409}）',
  )
  assert.equal(conflict.code, 'image_prompt_replace_required')
  assert.match(conflict.message, /已有 1 个提示词槽位/)
  assert.match(conflict.fix, /显式确认/)
  assert.equal(conflict.confirmField, 'confirm_replace_image_prompt')
  assert.equal(conflict.statusCode, 409)

  // 质量拦截 422（validate_asset_image_prompts 的形状）
  const invalid = readStructuredServerError({
    detail: { code: 'name_only_generic', message: '「韩虹」的提示词只有资产名和通用摄影词。', fix: '请补上能直接落到画面上的特征。' },
  })
  assert.equal(invalid.code, 'name_only_generic')
  assert.match(invalid.message, /通用摄影词/)
  assert.match(invalid.fix, /特征/)

  // 不是结构化错误时：退回原文（并屏蔽内部标识），不编造 code
  const plain = readStructuredServerError('网络错误')
  assert.equal(plain.code, '')
  assert.equal(plain.message, '网络错误')
  assert.equal(readStructuredServerError(null).message, '')

  // 保存失败的统一文案（Error 对象 + 结构化 detail 两种形态都读）
  const failure = describePromptSaveFailure(
    new Error(
      'HTTP 409（{"code":"image_prompt_replace_required","message":"韩虹已有 1 个提示词槽位保存过内容","fix":"带 confirm_replace_image_prompt: true 再提交","status_code":409}）',
    ),
  )
  assert.equal(failure.code, 'image_prompt_replace_required')
  assert.equal(failure.needsConfirm, true)
  assert.match(failure.message, /保存过内容/)
  assert.match(failure.fix, /confirm_replace_image_prompt/)

  const qualityFailure = describePromptSaveFailure({
    detail: { code: 'vague_filler', message: '含空话「外观信息不足」', fix: '先补齐资产资料' },
  })
  assert.equal(qualityFailure.needsConfirm, false)
  assert.match(qualityFailure.message, /外观信息不足/)
  assert.ok(describePromptSaveFailure(new Error('')).message.startsWith('保存提示词失败：'))
})

test('后端结构化判定的读取：字段名容错 + 没给判定时返回 null（不编造判定）', () => {
  assert.equal(readServerPromptQuality({ slots: [] }), null)
  assert.equal(readServerPromptQuality(null), null)
  assert.equal(readServerPromptQuality('x'), null)

  const nested = readServerPromptQuality({
    slot: { quality: { usable: false, code: 'name_and_generic_only', reasons: ['只有名称与通用词'], how_to_fix: ['补外观'] } },
  })
  assert.equal(nested?.usable, false)
  assert.equal(nested?.code, 'generic_only')
  assert.deepEqual(nested?.reasons, ['只有名称与通用词'])
  assert.deepEqual(nested?.fixes, ['补外观'])

  const blockedFlag = readServerPromptQuality({ blocked: true, blocking_reasons: ['空提示词'] })
  assert.equal(blockedFlag?.usable, false)
  assert.equal(blockedFlag?.code, 'server_blocked')
  assert.equal(resolvePromptQuality({ prompt: null, serverQuality: { blocked: true } }).status, 'unusable')
})

test('⑤ 最终四条提示词的差异：逐条算出与同批最像的那条，达到阈值就点名"高度重复"', () => {
  const rows = summarizePromptDifferences([
    { key: 'character:c1', name: '韩虹', type: 'character', prompt: '韩虹，35 岁女律师，齐肩黑发，深灰西装，正脸半身' },
    { key: 'character:c2', name: '陆行舟', type: 'character', prompt: '陆行舟，40 岁检察官，短寸黑发，藏蓝制服，正脸半身' },
    { key: 'scene:s1', name: '法院走廊', type: 'scene', prompt: '旧法院走廊，灰色石墙，长条木椅，顶光斜射' },
    { key: 'prop:p1', name: '法槌', type: 'prop', prompt: '深棕木质法槌，铜色包边，木纹清晰' },
  ])
  assert.equal(rows.length, 4)
  // 四条各不相同 → 都不算高度重复，但都能给出"与谁最像、多少"
  rows.forEach((row) => {
    assert.equal(row.duplicated, false)
    assert.ok(row.maxSimilarity !== null && row.maxSimilarity < DUPLICATE_SIMILARITY_THRESHOLD)
    assert.match(row.diffLine, /相似度 \d+%（差异明显）/)
  })
  assert.equal(rows[2].typeLabel, '场景')
  assert.equal(rows[3].typeLabel, '道具')

  // 模板套用：两条逐字相同 → 两侧都被点名为高度重复
  const shared = '人物正面半身，纯白背景，photorealistic, cinematic lighting, sharp focus, 8k'
  const duplicatedRows = summarizePromptDifferences([
    { key: 'character:c1', name: '韩虹', type: 'character', prompt: shared },
    { key: 'character:c2', name: '陆行舟', type: 'character', prompt: shared },
  ])
  duplicatedRows.forEach((row) => {
    assert.equal(row.duplicated, true)
    assert.match(row.diffLine, /高度重复：模板套用，必须分别改/)
    assert.match(row.diffLine, /相似度 100%/)
  })

  // 喂给「生成依据」的 ⑤ 那一项：每行带上资产名与类型
  const lines = buildPromptDifferenceLines(rows)
  assert.equal(lines.length, 4)
  assert.match(lines[0], /^韩虹（人物）：与「/)
})
