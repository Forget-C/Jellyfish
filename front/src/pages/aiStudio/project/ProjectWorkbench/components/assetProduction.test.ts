/**
 * 「资产生产区」纯逻辑的回归测试。
 *
 * 锁定的两条硬边界（用户点名）：
 *   A. 批量生成默认只处理「未生成项」，不覆盖已有图片/已有定版图；
 *   B. 对已有图片的资产「重新生成」、或把结果「设为定版」而该资产已有定版时，必须二次确认。
 *
 * 其余覆盖：全选 / 清空 / 只选未生成、批量范围与预计张数、在途防重复（含后端幂等键复用）、
 * 进度数字聚合、停止后已完成结果保留、卡片状态文案不含内部字段。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  ASPECT_RATIO_OPTIONS,
  COST_WARNING_DRY_RUN,
  COST_WARNING_REAL,
  DEFAULT_ASPECT_RATIO,
  IMAGES_PER_ASSET,
  INTERNAL_TOKEN_BLACKLIST,
  applySelectionAction,
  applyStopToQueue,
  assetKeyOf,
  buildBatchConfirmation,
  buildPrimaryReplaceConfirmation,
  FLOW_LABEL,
  assetTypeProductionSpec,
  assetTypeProductionSpecs,
  collectTypeNamingProblems,
  DEFAULT_FLOW,
  REFERENCE_REWORK_UNAVAILABLE_HINT,
  buildAttemptPlan,
  buildRegenerateWithReferenceConfirmation,
  canRegenerateWithExistingReference,
  collectMisleadingCopy,
  collectUserFacingTexts,
  createAssetSubmitGate,
  defaultGenerationSettings,
  dedupeResults,
  describeFailureReason,
  describeProgressLines,
  describeSettings,
  describeStopEffect,
  findMisleadingCopy,
  describeTaskStatus,
  findIdempotentReuse,
  hasUnsettledTasks,
  isPlaceholderUrl,
  isPubliclyReachableUrl,
  isSubmittableAssetType,
  makeSampleTask,
  attemptForNextTry,
  orderCardsForDisplay,
  pickResultForAsset,
  planAdoption,
  requiresPrimaryReplaceConfirmation,
  requiresRegenerateConfirmation,
  resolveProductionHeadline,
  resolveResultStatus,
  resolveTaskQueryPatch,
  selectUngenerated,
  OUTPUT_MODE_STATEMENT,
  SUBMIT_STAGE,
  summarizeSelection,
  summarizeTaskProgress,
  toProductionAssets,
  type ProductionAsset,
  type ProductionTask,
  type ProductionTaskStatus,
} from './assetProduction.ts'
import {
  CHARACTER_REFERENCE_FIXED_STATEMENT,
  IMAGE_ASSET_TYPE_TEXT,
  buildAspectRatioStatement,
  describeGroupBreakdown,
  groupAssetsByType,
} from './assetResultKind.ts'

/* ------------------------------------------------------------------ 测试夹具 */

function asset(
  type: ProductionAsset['type'],
  id: string,
  patch: Partial<ProductionAsset> = {},
): ProductionAsset {
  return {
    key: assetKeyOf(type, id),
    id,
    type,
    name: `${type}-${id}`,
    hasImage: false,
    hasPrimary: false,
    hasImagePrompt: false,
    imageId: null,
    thumbnail: '',
    hasPendingCandidate: false,
    ...patch,
  }
}

/** 混合样本：人物(未生成) / 场景(已有图片未定版) / 道具(未生成) / 服装(已有定版)。 */
const MIXED: ProductionAsset[] = [
  asset('character', 'c1'),
  asset('character', 'c2', { hasImage: true, hasPrimary: false, hasImagePrompt: true, imageId: 11 }),
  asset('scene', 's1'),
  asset('scene', 's2', { hasImage: true, hasPrimary: true, hasImagePrompt: true, imageId: 12 }),
  asset('prop', 'p1'),
  asset('costume', 'k1', { hasImage: true, hasPrimary: true, hasImagePrompt: true, imageId: 13 }),
]

const ALL_KEYS = MIXED.map((item) => item.key)

/* ------------------------------------------------- 硬边界 A：默认只选未生成 */

test('默认勾选范围只包含没有图片的资产（硬边界 A）', () => {
  const selected = selectUngenerated(MIXED)
  assert.deepEqual(selected, [assetKeyOf('character', 'c1'), assetKeyOf('scene', 's1'), assetKeyOf('prop', 'p1')])
  // 已有图片的资产（含已有定版图）一个都不能被默认选中
  assert.ok(!selected.includes(assetKeyOf('character', 'c2')))
  assert.ok(!selected.includes(assetKeyOf('scene', 's2')))
  assert.ok(!selected.includes(assetKeyOf('costume', 'k1')))
})

test('默认提交范围同样只含未生成项：预计张数 = 未生成且可出图的项数', () => {
  const scope = summarizeSelection(MIXED, selectUngenerated(MIXED))
  assert.equal(scope.total, 3)
  assert.equal(scope.ungenerated, 3)
  assert.equal(scope.withExistingImage, 0)
  assert.equal(scope.withExistingPrimary, 0)
  assert.equal(scope.estimatedImages, 3 * IMAGES_PER_ASSET)
})

test('默认范围不会覆盖已有定版图：定版图所在的资产不在预计生成范围内', () => {
  const scope = summarizeSelection(MIXED, selectUngenerated(MIXED))
  assert.ok(!scope.assets.some((item) => item.hasPrimary))
})

/* --------------------------------------------------------- 全选 / 清空 / 只选未生成 */

test('全选只作用在当前分页签，其它分页签的已选项保留', () => {
  const current = [assetKeyOf('prop', 'p1')]
  const next = applySelectionAction(MIXED, current, 'all', 'character')
  assert.ok(next.includes(assetKeyOf('character', 'c1')))
  assert.ok(next.includes(assetKeyOf('character', 'c2')))
  assert.ok(next.includes(assetKeyOf('prop', 'p1')))
  assert.ok(!next.includes(assetKeyOf('scene', 's1')))
})

test('清空选择清掉全部（含其它分页签）', () => {
  assert.deepEqual(applySelectionAction(MIXED, ALL_KEYS, 'clear', 'character'), [])
})

test('只选未生成项：当前分页签内只选中没有图片的资产', () => {
  const next = applySelectionAction(MIXED, [], 'ungenerated', 'scene')
  assert.deepEqual(next, [assetKeyOf('scene', 's1')])
  // 人物页签已有全选，再点"只选未生成"不会把已选中的已有图片项清掉（跨页签累加）
  const again = applySelectionAction(MIXED, [assetKeyOf('character', 'c1'), assetKeyOf('character', 'c2')], 'ungenerated', 'prop')
  assert.ok(again.includes(assetKeyOf('character', 'c2')))
  assert.ok(again.includes(assetKeyOf('prop', 'p1')))
})

/* -------------------------------------------------------- 批量范围与预计张数 */

test('批量范围：按类型分别计数 + 预计张数包含服装（四类平权）', () => {
  const scope = summarizeSelection(MIXED, ALL_KEYS)
  assert.equal(scope.total, 6)
  assert.deepEqual(scope.byType, { character: 2, scene: 2, prop: 1, costume: 1 })
  // 服装已补齐（APIMart 通道）→ 计入可提交数量与预计张数
  assert.equal(scope.submittableCount, 6)
  assert.equal(scope.unsupportedCount, 0)
  assert.equal(scope.estimatedImages, 6 * IMAGES_PER_ASSET)
  // 四类平权后：有图的是 人物 c2 / 场景 s2 / 服装 k1（服装那张图同样算"已有图"）
  assert.equal(scope.withExistingImage, 3)
  // 四类平权后：有定版的是 人物 c2 / 服装 k1 两张
  assert.equal(scope.withExistingPrimary, 2)
  assert.equal(scope.ungenerated, 3)
})

test('出图服务支持的类型与服装的拦截口径', () => {
  assert.equal(isSubmittableAssetType('character'), true)
  assert.equal(isSubmittableAssetType('scene'), true)
  assert.equal(isSubmittableAssetType('prop'), true)
  // 服装已补齐（走 Jellyfish 自己的 APIMart 通道）→ 四类平权
  assert.equal(isSubmittableAssetType('costume'), true)
})

test('选择里只有服装时在提交前被拦住并说明原因（不进任何队列）', () => {
  const scope = summarizeSelection(MIXED, [assetKeyOf('costume', 'k1')])
  const confirmation = buildBatchConfirmation({
    scope,
    settings: defaultGenerationSettings(),
    mode: 'real',
    operation: 'generate',
  })
  // 服装现在可以出图：不再"提交前被拦住"，而是正常进入确认流程（走服装设定图口径）
  assert.equal(confirmation.blocked, false)
  assert.equal(confirmation.required, true)
  assert.match(confirmation.lines.join('\n'), /服装/)
})

/* --------------------------------------------- 硬边界 B：二次确认触发条件 */

test('已有图片的资产做重新生成 → 必须二次确认，且写清不会自动替换现有图片/定版', () => {
  const regenerateTargets = MIXED.filter((item) => item.hasImage)
  assert.equal(requiresRegenerateConfirmation(regenerateTargets), true)
  const scope = summarizeSelection(MIXED, [assetKeyOf('character', 'c2'), assetKeyOf('scene', 's2')])
  const confirmation = buildBatchConfirmation({
    scope,
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'regenerate',
  })
  assert.equal(confirmation.required, true)
  assert.equal(confirmation.blocked, false)
  assert.match(confirmation.lines.join('\n'), /不会自动替换现有图片，也不会动现有定版图/)
  assert.match(confirmation.lines.join('\n'), /已有定版图的资产 1 项/)
})

test('演练模式下单个未生成项的「生成」不弹二次确认（不花钱、不覆盖任何东西）', () => {
  const scope = summarizeSelection(MIXED, [assetKeyOf('character', 'c1')])
  const confirmation = buildBatchConfirmation({
    scope,
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'generate',
  })
  assert.equal(confirmation.required, false)
  assert.equal(confirmation.blocked, false)
})

test('真实模式一律二次确认，并出现"会产生真实费用"的明确提示', () => {
  const scope = summarizeSelection(MIXED, [assetKeyOf('character', 'c1')])
  const dryConfirmation = buildBatchConfirmation({
    scope,
    settings: defaultGenerationSettings(),
    mode: 'dry_run',
    operation: 'generate',
  })
  const realConfirmation = buildBatchConfirmation({
    scope,
    settings: defaultGenerationSettings(),
    mode: 'real',
    operation: 'generate',
  })
  assert.equal(dryConfirmation.required, false)
  assert.equal(realConfirmation.required, true)
  assert.equal(realConfirmation.costWarning, COST_WARNING_REAL)
  assert.equal(dryConfirmation.costWarning, COST_WARNING_DRY_RUN)
  assert.match(realConfirmation.costWarning, /会产生真实费用/)
  assert.match(realConfirmation.costWarning, /按张计费/)
})

test('批量确认框按类型分组写清"这一组生成什么图"，且不含误导说法', () => {
  const scope = summarizeSelection(MIXED, selectUngenerated(MIXED))
  const confirmation = buildBatchConfirmation({
    scope,
    settings: { aspectRatio: '9:16' },
    mode: 'dry_run',
    operation: 'generate',
    projectVideoRatio: '16:9',
  })
  assert.equal(confirmation.required, true)
  const text = confirmation.lines.join('\n')
  assert.match(text, /本次选择资产 3 项：人物 1、场景 1、道具 1、服装 0/)
  assert.match(text, /预计生成图片 3 张/)
  assert.match(text, /画面比例 9:16/)
  // 混选时必须逐组写清结果类型，不能把三种图说成同一种
  assert.match(text, /按类型分组/)
  assert.match(text, /人物 1 项：生成参考图（结果类型：人物参考图）/)
  assert.match(text, /场景 1 项：生成场景资产图（结果类型：场景资产图）/)
  assert.match(text, /道具 1 项：生成道具资产图（结果类型：道具资产图）/)
  assert.deepEqual(collectMisleadingCopy([confirmation.title, ...confirmation.lines, confirmation.costWarning]), [])

  // 只有人物时仍然是整句「出图方式：按提示词直接生成参考图（默认）」
  const onlyCharacter = buildBatchConfirmation({
    scope: summarizeSelection(MIXED, [assetKeyOf('character', 'c1')]),
    settings: defaultGenerationSettings(),
    mode: 'real',
    operation: 'generate',
  })
  assert.ok(onlyCharacter.lines.join('\n').includes(OUTPUT_MODE_STATEMENT), onlyCharacter.lines.join('\n'))
})

test('结果卡片消费回包的 result_kind / result_label / aspect_ratio_source（场景/道具不被说成参考图）', () => {
  const scene = resolveResultStatus(
    {
      source_task_id: 'k1',
      source_asset_id: 's1',
      asset_type: 'scene',
      outcome: 'ok',
      oss_url: 'https://cdn.example.com/s.png',
      result_kind: 'sceneAssetImage',
      result_label: '场景资产图',
      aspect_ratio: '16:9',
      aspect_ratio_source: 'default',
    },
    'scene',
  )
  assert.equal(scene.status, 'done')
  assert.equal(scene.resultKind, 'sceneAssetImage')
  assert.equal(scene.resultLabel, '场景资产图')
  assert.equal(scene.aspectRatio, '16:9')
  assert.equal(scene.aspectRatioSource, 'default')
  assert.ok(!scene.resultLabel.includes('参考图'), scene.resultLabel)

  // 人物：固定口径要能透传到卡片上
  const character = resolveResultStatus(
    {
      outcome: 'ok',
      oss_url: 'https://cdn.example.com/c.png',
      result_kind: 'characterReference',
      result_label: '人物参考图',
      aspect_ratio: '16:9',
      aspect_ratio_source: 'character_reference_fixed',
    },
    'character',
  )
  assert.equal(character.resultLabel, '人物参考图')
  assert.equal(character.aspectRatioSource, 'character_reference_fixed')

  // 回包没带结果类型字段 → 按资产类型兜底（绝不猜成「参考图」）
  assert.equal(resolveResultStatus({ outcome: 'ok', oss_url: 'x' }, 'prop').resultLabel, '道具资产图')
  assert.equal(resolveResultStatus({ outcome: 'ok', oss_url: 'x' }, 'costume').resultKind, 'costumeDesignImage')

  // 回包把人物专用标签错给到场景 → 一律不采用
  const wrong = resolveResultStatus(
    {
      outcome: 'ok',
      oss_url: 'x',
      asset_type: 'scene',
      result_kind: 'characterReference',
      result_label: '人物参考图',
    },
    'scene',
  )
  assert.equal(wrong.resultKind, 'sceneAssetImage')
  assert.equal(wrong.resultLabel, '场景资产图')
})

test('卡片与生产区的按钮文案都按类型取（源码里不再硬编码「重新生成参考图」这类写死的按钮字）', () => {
  const files = ['AssetResultCard.tsx', 'AssetProductionArea.tsx']
  const offenders: string[] = []
  files.forEach((file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    source.split('\n').forEach((line, index) => {
      const trimmed = line.trim()
      const isComment =
        trimmed.startsWith('*') || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('{/*')
      if (isComment) return
      // 写死的整句按钮/标题文案不许再出现（要按类型取词）
      if (/'生成参考图'|'重新生成参考图'|"生成参考图"|"重新生成参考图"/.test(line)) {
        offenders.push(`${file}:${index + 1}: ${trimmed}`)
      }
    })
  })
  assert.deepEqual(offenders, [])
})

test('类型 → 提示词槽位 / 结果类型 / 标签 / 尺寸：四类各一套，映射可测', () => {
  const specs = assetTypeProductionSpecs()
  assert.deepEqual(specs.map((spec) => spec.assetType), ['character', 'scene', 'prop', 'costume'])

  const character = assetTypeProductionSpec('character')
  assert.equal(character.promptSlot, 'character_image_front')
  assert.equal(character.resultKind, 'characterReference')
  assert.equal(character.resultLabel, '人物参考图')
  assert.equal(character.noun, '参考图')
  assert.equal(character.aspectRatio, '16:9')
  assert.equal(character.aspectRatioFixed, true)
  assert.equal(character.batchReferenceAllowed, true)

  const scene = assetTypeProductionSpec('scene')
  assert.equal(scene.promptSlot, 'scene_image_front')
  assert.equal(scene.resultLabel, '场景资产图')
  assert.equal(scene.aspectRatioFixed, false)
  assert.equal(scene.batchReferenceAllowed, false)

  const prop = assetTypeProductionSpec('prop')
  assert.equal(prop.promptSlot, 'prop_image_front')
  assert.equal(prop.resultLabel, '道具资产图')
  assert.equal(prop.aspectRatioFixed, false)

  const costume = assetTypeProductionSpec('costume')
  assert.equal(costume.promptSlot, 'costume_image_front')
  assert.equal(costume.resultLabel, '服装设定图')
  assert.equal(costume.aspectRatioFixed, false)

  // 四类各读各的提示词槽位（不许共用一条）
  assert.equal(new Set(specs.map((spec) => spec.promptSlot)).size, 4)
})

test('场景 / 道具 / 服装绝不被标成人物参考图（标签里不出现「参考图」或 characterReference）', () => {
  const specs = assetTypeProductionSpecs()
  specs
    .filter((spec) => spec.assetType !== 'character')
    .forEach((spec) => {
      const haystack = `${spec.resultKind} ${spec.resultLabel} ${spec.noun}`
      assert.ok(!haystack.includes('参考图'), `${spec.assetType} 不该出现「参考图」：${haystack}`)
      assert.ok(!haystack.includes('characterReference'), `${spec.assetType} 不该被标成 characterReference`)
    })
  // 自检函数在正确映射上必须为空
  assert.deepEqual(collectTypeNamingProblems(specs), [])
  // 人为错标时能被抓出来（这就是"演练验收会额外确认 1 场景 + 1 道具"的护栏）
  const broken = specs.map((spec) =>
    spec.assetType === 'scene' ? { ...spec, resultKind: 'characterReference', resultLabel: '人物参考图' } : spec,
  )
  const problems = collectTypeNamingProblems(broken)
  assert.equal(problems.length, 2)
  assert.match(problems.join('\n'), /scene/)
})

test('人物参考图固定 16:9 要写清「不等于项目最终视频画幅」', () => {
  const spec = assetTypeProductionSpec('character')
  assert.equal(spec.aspectRatio, '16:9')
  assert.equal(spec.aspectRatioFixed, true)
  assert.match(CHARACTER_REFERENCE_FIXED_STATEMENT, /人物参考图固定 16:9/)
  assert.match(CHARACTER_REFERENCE_FIXED_STATEMENT, /不等于项目最终视频画幅/)
  // 项目画幅不同 / 相同 / 未知三种情况都要能一眼看出区别
  const differ = buildAspectRatioStatement('9:16')
  const same = buildAspectRatioStatement('16:9')
  const unknown = buildAspectRatioStatement('')
  assert.match(differ, /最终视频画幅是 9:16/)
  assert.match(same, /数值相同，但用途不同/)
  assert.match(unknown, /还没有设置最终视频画幅/)
  ;[differ, same, unknown].forEach((text) => assert.match(text, /不等于项目最终视频画幅/))
})

test('混选按类型分组：不把混选当成同一批同类型（人物参考图 / 场景资产图 / 道具资产图）', () => {
  const groups = groupAssetsByType(MIXED.filter((asset) => isSubmittableAssetType(asset.type)))
  const labels = groups.map((group) => `${group.assetType}:${group.count}`)
  // 四类各自成组（服装走服装设定图口径，也不会被写成「参考图」）
  assert.deepEqual(labels, ['character:2', 'scene:2', 'prop:1', 'costume:1'])
  // 每个分组带各自的类型名与结果标签（场景/道具不会被写成「参考图」）
  groups.forEach((group) => {
    assert.ok(group.title.includes(IMAGE_ASSET_TYPE_TEXT[group.assetType]))
    if (group.assetType !== 'character') {
      assert.ok(!group.title.includes('参考图'), group.title)
    }
  })
  const breakdown = describeGroupBreakdown(groups)
  assert.match(breakdown, /人物参考图 2/)
  assert.match(breakdown, /场景资产图 2/)
  assert.match(breakdown, /道具资产图 1/)
  assert.match(breakdown, /服装设定图 1/)
})

test('把结果设为定版而该资产已有定版图 → 必须二次确认并写清替换的是什么', () => {
  assert.equal(requiresPrimaryReplaceConfirmation(MIXED[3]), true)
  assert.equal(requiresPrimaryReplaceConfirmation(MIXED[0]), false)
  assert.equal(requiresPrimaryReplaceConfirmation(undefined), false)
  const plan = buildPrimaryReplaceConfirmation({ assetName: '场景 s2', isFromGeneratedResult: true })
  assert.equal(plan.required, true)
  const text = plan.lines.join('\n')
  assert.match(text, /替换掉它作为"定版"的身份/)
  assert.match(text, /原图片不会被删除/)
  assert.match(plan.costWarning, /不产生出图费用/)
})

/* ------------------------------------------------------------ 在途防重复 */

test('在途闸门：同一资产同一轮重复点击被拒绝，不会重复提交', () => {
  const gate = createAssetSubmitGate()
  const key = assetKeyOf('character', 'c1')
  const first = gate.begin(key)
  assert.equal(first.allowed, true)
  const second = gate.begin(key)
  assert.equal(second.allowed, false)
  if (!second.allowed) {
    assert.equal(second.reason, 'in_flight')
    assert.match(second.message, /不会重复生成/)
  }
  assert.equal(gate.isInFlight(key), true)
  gate.finish(key, 'jellyfish:p:character:c1:abcd1234')
  assert.equal(gate.isInFlight(key), false)
  assert.equal(gate.begin(key).allowed, true)
})

test('在途闸门：异常后释放，否则该资产永远点不动', () => {
  const gate = createAssetSubmitGate()
  const key = assetKeyOf('scene', 's1')
  assert.equal(gate.begin(key).allowed, true)
  gate.release(key)
  assert.equal(gate.begin(key).allowed, true)
})

test('复用后端幂等键：同一资产同一提示词再次提交会被识别为已有结果', () => {
  const gate = createAssetSubmitGate()
  const key = assetKeyOf('scene', 's1')
  const sourceTaskId = 'jellyfish:proj:scene:s1:e5be3933'
  assert.equal(gate.begin(key).allowed, true)
  gate.finish(key, sourceTaskId)
  assert.deepEqual(gate.submittedKeys(), [sourceTaskId])
  assert.equal(findIdempotentReuse(gate.submittedKeys(), sourceTaskId), true)
  assert.equal(findIdempotentReuse(gate.submittedKeys(), 'jellyfish:proj:scene:s1:other'), false)
  // 没有幂等键（后端没返回）时不误报重复
  assert.equal(findIdempotentReuse(gate.submittedKeys(), ''), false)
})

/* ------------------------------------------------------------ 进度数字聚合 */

test('进度数字：总数/已完成/失败/生成中/排队中/已停止/演练占位都是真实计数', () => {
  const tasks: ProductionTask[] = [
    makeSampleTask({ key: 'k1', status: 'done' }),
    makeSampleTask({ key: 'k2', status: 'done' }),
    makeSampleTask({ key: 'k3', status: 'failed', errorMessage: '上游返回失败' }),
    makeSampleTask({ key: 'k4', status: 'generating' }),
    makeSampleTask({ key: 'k5', status: 'submitting' }),
    makeSampleTask({ key: 'k6', status: 'queued' }),
    makeSampleTask({ key: 'k7', status: 'stopped' }),
    makeSampleTask({ key: 'k8', status: 'dry_run' }),
  ]
  const summary = summarizeTaskProgress(tasks)
  assert.equal(summary.total, 8)
  assert.equal(summary.done, 2)
  assert.equal(summary.failed, 1)
  assert.equal(summary.generating, 2)
  assert.equal(summary.queued, 1)
  assert.equal(summary.stopped, 1)
  assert.equal(summary.dryRun, 1)
  assert.equal(summary.finished, 5)
  assert.equal(summary.percent, 63)
  assert.equal(summary.hasFailure, true)
  assert.deepEqual(summary.failureReasons, ['上游返回失败'])
})

test('进度文案包含用户点名的五个数字，且不含内部口径', () => {
  const summary = summarizeTaskProgress([
    makeSampleTask({ key: 'k1', status: 'done' }),
    makeSampleTask({ key: 'k2', status: 'queued' }),
  ])
  const labels = describeProgressLines(summary).map((line) => line.label)
  ;['总数', '已完成', '失败', '生成中', '待提交'].forEach((label) => assert.ok(labels.includes(label), label))
  // 内联执行没有队列：不许写"排队中"
  assert.ok(!labels.includes('排队中'))
  // 1 项已完成 + 1 项排队中 → 进度是 50%，不是"成功"也不是"100%"
  assert.equal(summary.percent, 50)
})

test('空一轮的进度不会显示成 100%', () => {
  assert.equal(summarizeTaskProgress([]).percent, 0)
  assert.equal(summarizeTaskProgress([]).total, 0)
})

/* --------------------------------------------- 停止后已完成结果必须保留 */

test('停止只标记"还没开始"的项，已完成的卡片与定版状态一个都不丢', () => {
  const tasks: ProductionTask[] = [
    makeSampleTask({ key: 'k1', status: 'done', ossUrl: 'https://oss/a.png', adoptedImageId: 7, adoptedUrl: '/a.png' }),
    makeSampleTask({ key: 'k2', status: 'done', isPrimary: true, adoptedImageId: 8 }),
    makeSampleTask({ key: 'k3', status: 'failed', errorMessage: 'x' }),
    makeSampleTask({ key: 'k4', status: 'generating', serviceTaskId: 'svc-1' }),
    makeSampleTask({ key: 'k5', status: 'queued' }),
    makeSampleTask({ key: 'k6', status: 'queued' }),
  ]
  const stopped = applyStopToQueue(tasks)
  assert.equal(stopped[0].status, 'done')
  assert.equal(stopped[0].ossUrl, 'https://oss/a.png')
  assert.equal(stopped[1].status, 'done')
  assert.equal(stopped[1].isPrimary, true)
  assert.equal(stopped[2].status, 'failed')
  // 正在跑的那一项保持不动：出图服务没有取消接口
  assert.equal(stopped[3].status, 'generating')
  assert.equal(stopped[4].status, 'stopped')
  assert.equal(stopped[5].status, 'stopped')
  const summary = summarizeTaskProgress(stopped)
  assert.equal(summary.done, 2)
  assert.equal(summary.stopped, 2)
  assert.equal(summary.queued, 0)
  assert.match(describeStopEffect(summary), /已完成的 2 项结果会保留/)
})

test('结果卡片顺序：已停止的排到最后，已完成结果不会被挤出可视区', () => {
  const tasks: ProductionTask[] = [
    makeSampleTask({ key: 'k1', status: 'done', ossUrl: 'https://oss/1.png' }),
    makeSampleTask({ key: 'k2', status: 'stopped' }),
    makeSampleTask({ key: 'k3', status: 'done', ossUrl: 'https://oss/3.png' }),
    makeSampleTask({ key: 'k4', status: 'stopped' }),
  ]
  const shown = orderCardsForDisplay(tasks, { showAll: false, maxVisible: 2 })
  assert.deepEqual(shown.map((task) => task.key), ['k1', 'k3'])
  const all = orderCardsForDisplay(tasks, { showAll: true, maxVisible: 2 })
  assert.deepEqual(all.map((task) => task.key), ['k1', 'k3', 'k2', 'k4'])
  // 全是停止项时也要看得见（不能白屏）
  const onlyStopped = orderCardsForDisplay([makeSampleTask({ key: 's1', status: 'stopped' })], {
    showAll: false,
    maxVisible: 2,
  })
  assert.equal(onlyStopped.length, 1)
})

test('还有未结算任务时才算"在跑"（用于按钮态与轮询开关）', () => {
  assert.equal(hasUnsettledTasks([makeSampleTask({ status: 'done' })]), false)
  assert.equal(hasUnsettledTasks([makeSampleTask({ status: 'queued' })]), true)
  assert.equal(hasUnsettledTasks([makeSampleTask({ status: 'generating' })]), true)
})

/* ------------------------------------------------------ 结果 → 状态与原因 */

test('提交结果 → 任务状态：演练占位不算完成，也不冒充成功', () => {
  const dry = resolveResultStatus({ dry_run: true, outcome: 'dry_run', image_url: 'https://dry-run.invalid/a.png' })
  assert.equal(dry.status, 'dry_run')
  assert.match(dry.reason, /占位结果/)
  assert.equal(isPlaceholderUrl('https://dry-run.invalid/a.png'), true)
})

test('提交结果 → 任务状态：拿到长期地址才算完成', () => {
  const done = resolveResultStatus({ outcome: 'ok', oss_url: 'https://oss/a.png', service_task_id: 'svc-1' })
  assert.equal(done.status, 'done')
  assert.equal(done.hasLongTermAddress, true)
  const local = resolveResultStatus({ outcome: 'ok', image_url: 'http://localhost:4173/images/a.png', service_task_id: 'svc-2' })
  assert.equal(local.status, 'done')
  assert.equal(local.hasLongTermAddress, false)
  assert.match(local.reason, /采纳后才会落到资产图片里/)
})

test('提交结果 → 任务状态：还在生成 / 失败 / 没有任务号', () => {
  assert.equal(resolveResultStatus({ outcome: 'running', service_task_id: 'svc-3' }).status, 'generating')
  const failed = resolveResultStatus({ outcome: 'failed', error_message: '上游返回 HTTP 500' })
  assert.equal(failed.status, 'failed')
  assert.match(failed.reason, /HTTP 500/)
  const noTask = resolveResultStatus({ outcome: 'unknown', ok: true })
  assert.equal(noTask.status, 'failed')
  assert.match(noTask.reason, /查看详情/)
})

test('失败原因优先上游原文，并屏蔽内部标识；没有原文时给可执行说明', () => {
  const masked = describeFailureReason({ error_message: 'HTTP 500 file_id=abc123', outcome: 'failed' })
  assert.ok(!masked.includes('file_id=abc123'))
  assert.match(masked, /HTTP 500/)
  assert.match(describeFailureReason({ outcome: 'partial_failed' }), /长期存储/)
  assert.match(describeFailureReason({ outcome: 'failed' }), /没有拿到具体原因/)
})

test('回读任务：完成/失败/演练/进行中四种口径', () => {
  const done = resolveTaskQueryPatch({ status: 'completed', oss_url: 'https://oss/b.png', local_path: '/tmp/b.png' })
  assert.equal(done?.status, 'done')
  assert.equal(done?.ossUrl, 'https://oss/b.png')
  const failed = resolveTaskQueryPatch({ status: 'failed', error_message: '上游超时' })
  assert.equal(failed?.status, 'failed')
  assert.match(failed?.errorMessage ?? '', /上游超时/)
  assert.equal(resolveTaskQueryPatch({ dry_run: true, status: 'dry_run' })?.status, 'dry_run')
  assert.equal(resolveTaskQueryPatch({ status: 'queued' })?.status, 'generating')
})

/* ------------------------------------------- 提交结果去重（幂等键合并） */

test('同一次提交里的重复条目按幂等键合并（进度数字不被放大）', () => {
  const results = [
    { source_task_id: 'k1', source_asset_id: 's1', service_task_id: 'svc-1', status: 'queued' },
    { source_task_id: 'k1', source_asset_id: 's1', service_task_id: 'svc-1', status: 'queued' },
    { source_task_id: 'k1', source_asset_id: 's1', service_task_id: 'svc-1', status: 'queued' },
    { source_task_id: 'k1', source_asset_id: 's1', service_task_id: 'svc-1', status: 'completed', oss_url: 'https://oss/a.png' },
  ]
  const deduped = dedupeResults(results)
  assert.equal(deduped.length, 1)
  assert.equal(deduped[0].oss_url, 'https://oss/a.png')
})

test('多资产结果各自保留，并按资产挑出代表结果', () => {
  const results = [
    { source_task_id: 'k1', source_asset_id: 's1', service_task_id: 'svc-1', image_url: 'http://localhost:4173/a.png' },
    { source_task_id: 'k1', source_asset_id: 's1', service_task_id: 'svc-1', oss_url: 'https://oss/a.png' },
    { source_task_id: 'k2', source_asset_id: 's2', service_task_id: 'svc-2', error_message: '上游失败', outcome: 'failed' },
  ]
  assert.equal(dedupeResults(results).length, 2)
  const first = pickResultForAsset(results, 's1')
  assert.equal(first?.oss_url, 'https://oss/a.png')
  const second = pickResultForAsset(results, 's2')
  assert.equal(second?.error_message, '上游失败')
  assert.equal(pickResultForAsset([], 's1'), null)
  // 结果里没有该资产时退化为整批的代表结果（不返回 null 让卡片空白）
  assert.ok(pickResultForAsset(results, 's3'))
})

/* ------------------------------------------------------------ 采纳落点决策 */

test('采纳：资产还没有图片 → 直接存入（不动任何现有内容）', () => {
  const plan = planAdoption({ asset: asset('character', 'c1'), url: 'https://oss/a.png', emptySlotId: null })
  assert.equal(plan.mode, 'adopt')
  if (plan.mode === 'adopt') {
    assert.equal(plan.imageId, null)
    assert.match(plan.reason, /第一张参考图/)
  }
})

test('采纳：资产已有图片但有空槽位 → 存入空槽位，不覆盖现有图片', () => {
  const plan = planAdoption({
    asset: asset('scene', 's2', { hasImage: true, hasPrimary: true, imageId: 12 }),
    url: 'https://oss/a.png',
    emptySlotId: 21,
  })
  assert.equal(plan.mode, 'adopt')
  if (plan.mode === 'adopt') assert.equal(plan.imageId, 21)
})

test('采纳：资产已有图片且没有空槽位 → 新增一张图片，绝不覆盖现有定版图', () => {
  const plan = planAdoption({
    asset: asset('scene', 's2', { hasImage: true, hasPrimary: true, imageId: 12 }),
    url: 'https://oss/a.png',
    emptySlotId: null,
  })
  assert.equal(plan.mode, 'new_slot')
  if (plan.mode === 'new_slot') assert.match(plan.reason, /现有图片与定版图都保持不变/)
})

test('采纳：只有出图服务本机地址时不自动采纳（避免覆盖），并说明去哪处理', () => {
  const plan = planAdoption({
    asset: asset('scene', 's2', { hasImage: true, hasPrimary: true, imageId: 12 }),
    url: 'http://localhost:4173/images/a.png',
    emptySlotId: null,
  })
  assert.equal(plan.mode, 'blocked')
  if (plan.mode === 'blocked') assert.match(plan.reason, /资产编辑页/)
})

test('采纳：演练占位地址与空地址一律拒绝', () => {
  const placeholder = planAdoption({ asset: asset('character', 'c1'), url: 'https://dry-run.invalid/a.png', emptySlotId: null })
  assert.equal(placeholder.mode, 'blocked')
  const empty = planAdoption({ asset: asset('character', 'c1'), url: '', emptySlotId: null })
  assert.equal(empty.mode, 'blocked')
})

/* ---------------------------------------------------------- 重新生成提示词 */

test('重新生成：用「尝试序号」换新键，**提示词一个字都不改**', () => {
  const base = '甲：正面全身参考图'
  // 已经尝试过 1 次（首轮走过）→ 本次是第 2 次尝试，序号 1（新幂等键）
  const second = buildAttemptPlan(base, { hasEditedPrompt: false, previousAttempt: 1 })
  assert.equal(second.attempt, 1)
  assert.equal(second.prompt, base)
  assert.equal(second.isRetry, true)
  assert.match(second.note, /第 2 次尝试/)
  // 已尝试 3 次后的下一次是序号 3（第 4 次尝试）
  assert.equal(buildAttemptPlan(base, { hasEditedPrompt: false, previousAttempt: 3 }).attempt, 3)
  // 首轮（序号 0）的说明口径不同：如实说"同一提示词会复用已有结果"
  const zero = buildAttemptPlan(base, { hasEditedPrompt: false, previousAttempt: 0 })
  assert.equal(zero.attempt, 0)
  assert.equal(zero.isRetry, false)
  assert.match(zero.note, /复用已有结果/)
})

test('尝试序号不会越界（与后端 0..99 对齐）', () => {
  assert.equal(attemptForNextTry(0), 0)
  assert.equal(attemptForNextTry(1), 1)
  assert.equal(attemptForNextTry(99), 99)
  assert.equal(attemptForNextTry(500), 99)
  assert.equal(attemptForNextTry(-5), 0)
  assert.equal(attemptForNextTry(Number.NaN), 0)
})

test('重新生成：用户改过提示词时用改后的提示词，并且仍然换新键', () => {
  const plan = buildAttemptPlan('甲：正面全身参考图，穿黑风衣', { hasEditedPrompt: true, previousAttempt: 1 })
  assert.equal(plan.prompt, '甲：正面全身参考图，穿黑风衣')
  assert.equal(plan.attempt, 1)
  assert.match(plan.note, /改过的提示词/)
})

test('本机/内网地址不算长期可访问地址（采纳时会拦住）', () => {
  assert.equal(isPubliclyReachableUrl('https://oss.example.com/a.png'), true)
  assert.equal(isPubliclyReachableUrl('http://localhost:4173/images/a.png'), false)
  assert.equal(isPubliclyReachableUrl('http://127.0.0.1:8000/a.png'), false)
  assert.equal(isPubliclyReachableUrl('http://192.168.1.20/a.png'), false)
  assert.equal(isPubliclyReachableUrl('/images/a.png'), false)
})

test('重新生成：还没有提示词时如实说明会先拼装提示词', () => {
  const plan = buildAttemptPlan('', { hasEditedPrompt: false, previousAttempt: 0 })
  assert.equal(plan.prompt, '')
  assert.match(plan.note, /拼装提示词/)
})

/* -------------------------------------------------------------- 生成设置 */

test('生成设置：只提供比例，默认值稳定（不再有参考图开关）', () => {
  assert.deepEqual(defaultGenerationSettings(), { aspectRatio: DEFAULT_ASPECT_RATIO })
  const text = describeSettings({ aspectRatio: '16:9' })
  assert.match(text, /每个资产 1 张/)
  assert.ok(ASPECT_RATIO_OPTIONS.some((item) => item.value === '9:16'))
})

test('提交阶段固定：默认主流程不把已有图片当输入传出去', () => {
  // character_sheet = 不带垫图（后端只在这个阶段之外才解析定版垫图）
  assert.equal(SUBMIT_STAGE, 'character_sheet')
})

test('出图方式就是默认主流程：按提示词直接生成参考图', () => {
  assert.equal(OUTPUT_MODE_STATEMENT, '出图方式：按提示词直接生成参考图（默认）')
  assert.deepEqual(findMisleadingCopy(OUTPUT_MODE_STATEMENT), [])
  assert.match(OUTPUT_MODE_STATEMENT, /直接生成参考图/)
})

test('两条流程的代码名分开，且都有用户可读的名字（没有含糊的 use_reference 开关）', () => {
  assert.equal(DEFAULT_FLOW, 'generate_reference_image')
  assert.deepEqual(Object.keys(FLOW_LABEL).sort(), [
    'generate_reference_image',
    'regenerate_with_existing_reference',
  ])
  assert.equal(FLOW_LABEL.generate_reference_image, '生成参考图')
  assert.equal(FLOW_LABEL.regenerate_with_existing_reference, '使用已有参考图重新生成')
})

test('「使用已有参考图重新生成」只在资产已有参考图时可用', () => {
  assert.equal(canRegenerateWithExistingReference({ hasImage: true }), true)
  assert.equal(canRegenerateWithExistingReference({ hasImage: false }), false)
  assert.equal(canRegenerateWithExistingReference(undefined), false)
})

test('返工流程的二次确认写清：用哪张图、会替换/新增什么、会不会产生费用', () => {
  const real = buildRegenerateWithReferenceConfirmation({
    assetName: '林小满',
    referenceLabel: '该资产当前的定版图',
    mode: 'real',
  })
  assert.equal(real.required, true)
  assert.match(real.title, /使用「林小满」已有的参考图重新生成一张/)
  const text = real.lines.join('\n')
  assert.match(text, /作为输入传给图片模型/)
  assert.match(text, /不会替换现有参考图，也不会动现有定版图/)
  assert.match(text, /公网可访问/)
  assert.match(real.costWarning, /会产生真实费用/)
  assert.match(real.okText, /确认真实生成/)
  // 演练模式下不谎报费用
  const dry = buildRegenerateWithReferenceConfirmation({
    assetName: '林小满',
    referenceLabel: '该资产当前的定版图',
    mode: 'dry_run',
  })
  assert.match(dry.costWarning, /不产生费用/)
  // 两条流程的文案都不许出现误导说法
  assert.deepEqual(collectMisleadingCopy([...real.lines, real.title, real.costWarning, ...dry.lines]), [])
})

test('返工端点没上线时的降级说明是「还在接入中」，不假装可用', () => {
  assert.match(REFERENCE_REWORK_UNAVAILABLE_HINT, /还在接入中/)
  assert.match(REFERENCE_REWORK_UNAVAILABLE_HINT, /重新生成参考图/)
})

test('文案黑名单：主界面不许再出现「垫图」这类误导说法', () => {
  const misleading = [
    '使用定版图当垫图',
    '本次会带定版垫图',
    '带垫图 3 项',
    '参考图不参与（上游按提示词生成）',
    '不使用参考图',
    '走图生图通道',
  ]
  misleading.forEach((text) => {
    assert.ok(findMisleadingCopy(text).length > 0, text)
  })
  // 正确口径不算误导
  assert.deepEqual(collectMisleadingCopy([OUTPUT_MODE_STATEMENT, FLOW_LABEL.generate_reference_image]), [])
})

test('生产区/卡片源码里不再出现「垫图」，也不把默认流程说成"参考图不参与"', () => {
  const files = ['AssetProductionArea.tsx', 'AssetResultCard.tsx', 'assetProduction.ts', 'assetProductionApi.ts']
  const offenders: string[] = []
  files.forEach((file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8')
    source.split('\n').forEach((line, index) => {
      const trimmed = line.trim()
      const isComment =
        trimmed.startsWith('*') ||
        trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('{/*')
      if (isComment) return
      if (/^\/.*\/,?$/.test(trimmed)) return // 黑名单正则字面量本身
      if (/MISLEADING_COPY_PATTERNS|findMisleadingCopy|collectMisleadingCopy/.test(trimmed)) return
      if (/垫图|参考图不参与|不使用参考图/.test(line)) offenders.push(`${file}:${index + 1}: ${trimmed}`)
    })
  })
  assert.deepEqual(offenders, [])
})

test('顶部状态：六种用户语言取值各自可达', () => {
  const empty = resolveProductionHeadline({ assets: [], progress: summarizeTaskProgress([]), readyCount: 0 })
  assert.equal(empty.label, '可以开始提取')

  const canGenerate = resolveProductionHeadline({
    assets: selectUngeneratedAssets(),
    progress: summarizeTaskProgress([]),
    readyCount: 0,
  })
  assert.equal(canGenerate.label, '可以生成图片')

  const running = resolveProductionHeadline({
    assets: MIXED,
    progress: summarizeTaskProgress([makeSampleTask({ status: 'generating' }), makeSampleTask({ status: 'queued' })]),
    readyCount: 0,
  })
  assert.equal(running.label, '正在生成')
  assert.match(running.detail, /正在生成 1 项，待提交 1 项/)

  const failed = resolveProductionHeadline({
    assets: MIXED,
    progress: summarizeTaskProgress([makeSampleTask({ status: 'failed', errorMessage: '上游返回失败' })]),
    readyCount: 0,
  })
  assert.equal(failed.label, '生成失败')
  assert.match(failed.detail, /上游返回失败/)

  const waitingPrimary = resolveProductionHeadline({ assets: MIXED, progress: summarizeTaskProgress([]), readyCount: 1 })
  assert.equal(waitingPrimary.label, '已有图片，待设为定版')

  const allPrimary = resolveProductionHeadline({ assets: MIXED, progress: summarizeTaskProgress([]), readyCount: MIXED.length })
  assert.equal(allPrimary.label, '已定版')
  assert.match(allPrimary.detail, /进入下一步/)
})

function selectUngeneratedAssets(): ProductionAsset[] {
  return MIXED.filter((item) => !item.hasImage)
}

/* -------------------------------------------------- 文案不含内部标识的黑名单 */

test('顶部状态：图片都在且已定版、只缺提示词时，说清"缺的是提示词"而不是缺图片', () => {
  const withImagesNoPrompt = MIXED.filter((asset) => asset.hasImage && asset.hasPrimary).map((asset) => ({
    ...asset,
    hasImagePrompt: false,
  }))
  const headline = resolveProductionHeadline({
    assets: withImagesNoPrompt,
    progress: summarizeTaskProgress([]),
    readyCount: 0,
  })
  assert.equal(headline.label, '可以生成图片')
  assert.match(headline.detail, /没有保存图片提示词/)
  assert.ok(!headline.detail.includes('没有图片：'))
})

test('顶部状态：就绪数按"提示词+图片+定版"口径（与外层步骤摘要一致）', () => {
  // 4 项就绪、1 项缺提示词 → 不能宣称"已定版"
  const headline = resolveProductionHeadline({
    assets: MIXED,
    progress: summarizeTaskProgress([]),
    readyCount: MIXED.length - 1,
  })
  assert.notEqual(headline.label, '已定版')
})

test('内部字段黑名单必须包含用户点名的这些（deepseek-chat / image2 / status: ready / 门禁 / file_id）', () => {
  // 这份清单是"主界面不许出现"的底线，删任何一条都应该让测试红
  const required = ['file_id', 'image2', 'deepseek', 'status', 'ready', '门禁', 'gpt-image']
  required.forEach((token) => {
    assert.ok(
      INTERNAL_TOKEN_BLACKLIST.some((item) => item === token || item.startsWith(token)),
      `黑名单缺少 ${token}`,
    )
  })
})

test('一轮全是演练占位时，顶部明细里说明白（不能采纳、不能设版）', () => {
  const headline = resolveProductionHeadline({
    assets: selectUngeneratedAssets(),
    progress: summarizeTaskProgress([makeSampleTask({ status: 'dry_run' }), makeSampleTask({ status: 'dry_run' })]),
    readyCount: 0,
  })
  assert.equal(headline.label, '可以生成图片')
  assert.match(headline.detail, /演练占位结果（没有真实出图）/)
  assert.match(headline.detail, /不能采纳、也不能设为定版/)
  // 有真实完成项时就不加这句（避免误伤）
  const mixed = resolveProductionHeadline({
    assets: selectUngeneratedAssets(),
    progress: summarizeTaskProgress([
      makeSampleTask({ status: 'dry_run' }),
      makeSampleTask({ status: 'done', ossUrl: 'https://oss/a.png' }),
    ]),
    readyCount: 0,
  })
  assert.ok(!mixed.detail.includes('演练占位结果（没有真实出图）'))
})

test('进度里用「待提交」而不是「排队中」（内联执行没有队列）', () => {
  const labels = describeProgressLines(summarizeTaskProgress([])).map((line) => line.label)
  assert.ok(labels.includes('待提交'))
  assert.ok(!labels.includes('排队中'))
  assert.equal(describeTaskStatus('queued').label, '待提交')
  const headline = resolveProductionHeadline({
    assets: MIXED,
    progress: summarizeTaskProgress([makeSampleTask({ status: 'queued' })]),
    readyCount: 0,
  })
  assert.match(headline.detail, /待提交/)
  assert.ok(!headline.detail.includes('排队中'))
})

test('卡片/状态/确认文案不出现内部字段（status / file_id / 任务号 / 模型名 / 门禁）', () => {
  const texts = collectUserFacingTexts()
  assert.ok(texts.length > 20)
  texts.forEach((text) => {
    const lowered = text.toLowerCase()
    INTERNAL_TOKEN_BLACKLIST.forEach((token) => {
      assert.ok(!lowered.includes(token.toLowerCase()), `文案不该出现「${token}」：${text}`)
    })
  })
})

test('任务状态文案只有用户语言（无原始状态值）', () => {
  const statuses: ProductionTaskStatus[] = ['queued', 'submitting', 'generating', 'done', 'failed', 'dry_run', 'stopped']
  const labels = statuses.map((status) => describeTaskStatus(status).label)
  assert.deepEqual(labels, ['待提交', '正在提交', '正在生成', '已完成', '生成失败', '演练占位', '已停止'])
  labels.forEach((label) => {
    INTERNAL_TOKEN_BLACKLIST.forEach((token) => {
      assert.ok(!label.toLowerCase().includes(token.toLowerCase()), label)
    })
  })
})

test('任务 → 资产、资产 → 任务：键稳定（结果卡片按资产归组）', () => {
  const converted = toProductionAssets([
    {
      id: 'x1',
      name: '甲',
      type: 'character',
      hasImage: false,
      hasPrimary: false,
      hasImagePrompt: false,
      imageId: null,
      thumbnail: '',
      hasPendingCandidate: false,
    },
  ])
  assert.equal(converted[0].key, 'character:x1')
  assert.equal(converted[0].name, '甲')
  // 后端字段缺失/类型不对时不冒充实数
  const fallback = toProductionAssets([
    {
      id: 'x2',
      name: '',
      type: 'prop',
      hasImage: undefined as unknown as boolean,
      hasPrimary: undefined as unknown as boolean,
      hasImagePrompt: undefined as unknown as boolean,
      imageId: undefined as unknown as number | null,
      thumbnail: undefined as unknown as string,
      hasPendingCandidate: undefined as unknown as boolean,
    },
  ])
  assert.equal(fallback[0].name, 'x2')
  assert.equal(fallback[0].hasImage, false)
  assert.equal(fallback[0].imageId, null)
  assert.equal(fallback[0].thumbnail, '')
})
