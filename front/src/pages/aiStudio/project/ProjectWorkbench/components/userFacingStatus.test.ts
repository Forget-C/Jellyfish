/**
 * 「用户可见状态文案」的回归测试（Node 内置测试运行器，无额外依赖）。
 *
 * 两条硬口径：
 *   1. 页面主信息只回答「现在能不能做 / 下一步做什么」，用用户语言；
 *   2. `deepseek-chat`、`image2`、`status: ready`、`门禁`、`file_id` 这类后台参数
 *      **一个都不许**出现在用户可见文案里（逐条断言）。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  FORBIDDEN_INTERNAL_TERMS,
  TECHNICAL_DETAIL_HINT,
  USER_STAGE_TEXT,
  USER_TEXT_FALLBACK,
  costNoticeText,
  describeGenerationReadiness,
  describeUserStage,
  findInternalTerms,
  resolveNextStepHint,
  sanitizeUserText,
  type StageInput,
} from './userFacingStatus.ts'

/** 所有用户可见文案的集合（新增文案忘了加进来时，下面的断言会提醒）。 */
function collectUserTexts(): string[] {
  const texts: string[] = []
  Object.values(USER_STAGE_TEXT).forEach((item) => texts.push(item.label, item.detail))
  texts.push(TECHNICAL_DETAIL_HINT, USER_TEXT_FALLBACK)
  texts.push(costNoticeText(true), costNoticeText(false), costNoticeText(null))
  return texts
}

test('用户状态文案：状态词典里包含用户要的六种说法', () => {
  const labels = Object.values(USER_STAGE_TEXT).map((item) => item.label)
  assert.ok(labels.includes('可以开始提取'))
  assert.ok(labels.includes('可以生成图片'))
  assert.ok(labels.includes('正在生成…'))
  assert.ok(labels.includes('生成失败'))
  assert.ok(labels.includes('已有图片，待设为定版'))
  assert.ok(labels.includes('已定版'))
})

test('用户状态文案：任何一条都不含模型名 / 原始状态值 / 内部标识 / 开发术语', () => {
  collectUserTexts().forEach((text) => {
    assert.deepEqual(findInternalTerms(text), [], `不该出现内部术语：${text}`)
  })
  // 反向确认断言本身有效
  assert.ok(findInternalTerms('状态：status: ready（模型 deepseek-chat）').length >= 2)
})

test('阶段映射：没有分镜 → 还不能开始提取；有分镜没提取 → 可以开始提取', () => {
  const noShot = describeUserStage({ shotCount: 0, hasExtracted: false, pendingCandidateCount: 0 })
  assert.equal(noShot.key, 'cannot_extract')
  assert.equal(noShot.label, '还不能开始提取')
  assert.equal(noShot.tone, 'warning')

  const ready = describeUserStage({ shotCount: 12, hasExtracted: false, pendingCandidateCount: 0 })
  assert.equal(ready.key, 'ready_to_extract')
  assert.equal(ready.label, '可以开始提取')
})

test('阶段映射：正在生成 → 「正在生成…」，失败 → 说清失败原因', () => {
  const running = describeUserStage({
    shotCount: 12,
    hasExtracted: true,
    running: true,
    runningKind: 'generation',
    pendingCandidateCount: 0,
  })
  assert.equal(running.key, 'generating')
  assert.equal(running.label, '正在生成…')

  const failed = describeUserStage({
    shotCount: 12,
    hasExtracted: true,
    failureKind: 'generation',
    failureReason: '出图服务返回 503，请稍后重试。',
    pendingCandidateCount: 0,
  })
  assert.equal(failed.key, 'generation_failed')
  assert.equal(failed.label, '生成失败')
  assert.match(failed.detail, /原因：出图服务返回 503/)
})

test('阶段映射：失败原因里的后台参数会被洗掉，不会漏给用户', () => {
  const failed = describeUserStage({
    shotCount: 12,
    hasExtracted: true,
    failureKind: 'generation',
    failureReason: '调用失败：DRY_RUN=开（file_id=abc123，status: ready，门禁未放行）',
    pendingCandidateCount: 0,
  })
  assert.deepEqual(findInternalTerms(`${failed.label}${failed.detail}`), [])
  assert.match(failed.detail, /^原因：/)
})

test('阶段映射：待确认内容 → 提示勾选后可一次确认', () => {
  const pending = describeUserStage({ shotCount: 12, hasExtracted: true, pendingCandidateCount: 3 })
  assert.equal(pending.key, 'pending_confirm')
  assert.equal(pending.label, '有 3 项待你确认')
  assert.match(pending.detail, /确认选中项/)
})

test('阶段映射：图片流水线 → 可以生成图片 / 已有图片待定版 / 已定版', () => {
  const base: StageInput = { shotCount: 12, hasExtracted: true, pendingCandidateCount: 0 }
  assert.equal(describeUserStage({ ...base, imagePrep: { promptReady: false, hasImage: false, hasPrimary: false } }).label, '可以生成提示词')
  assert.equal(
    describeUserStage({ ...base, imagePrep: { promptReady: true, hasImage: false, hasPrimary: false } }).label,
    '可以生成图片',
  )
  assert.equal(
    describeUserStage({ ...base, imagePrep: { promptReady: true, hasImage: true, hasPrimary: false } }).label,
    '已有图片，待设为定版',
  )
  assert.equal(
    describeUserStage({ ...base, imagePrep: { promptReady: true, hasImage: true, hasPrimary: true } }).label,
    '已定版',
  )
})

test('下一步提示：没有提示词先说「生成提示词」，有提示词才说「生成图片」', () => {
  assert.equal(resolveNextStepHint({ hasImagePrompt: false }).title, '下一步：生成提示词')
  assert.equal(resolveNextStepHint({ hasImagePrompt: null }).title, '下一步：生成提示词')
  assert.equal(resolveNextStepHint({ hasImagePrompt: true, hasImage: false }).title, '下一步：生成图片')
  assert.equal(resolveNextStepHint({ hasImagePrompt: true, hasImage: true, hasPrimary: false }).title, '下一步：设为定版')
  assert.equal(resolveNextStepHint({ hasImagePrompt: true, hasImage: true, hasPrimary: true }).key, 'done')

  const hints = [
    resolveNextStepHint({ hasImagePrompt: false }),
    resolveNextStepHint({ hasImagePrompt: null }),
    resolveNextStepHint({ hasImagePrompt: true, hasImage: false }),
    resolveNextStepHint({ hasImagePrompt: true, hasImage: true, hasPrimary: false }),
    resolveNextStepHint({ hasImagePrompt: true, hasImage: true, hasPrimary: true }),
  ]
  hints.forEach((hint) => {
    assert.deepEqual(findInternalTerms(`${hint.title}${hint.detail}`), [])
    assert.match(hint.title, /^(下一步：|这些资产已经完成)/)
  })
})

test('费用提示：真实模式必须说清会产生费用，演练模式说清不花钱，且不出现「门禁」', () => {
  const real = costNoticeText(false)
  assert.match(real, /真实调用/)
  assert.match(real, /产生费用/)
  const dry = costNoticeText(true)
  assert.match(dry, /不产生任何费用/)
  const unknown = costNoticeText(null)
  assert.match(unknown, /可能产生费用/)
  ;[real, dry, unknown].forEach((text) => assert.deepEqual(findInternalTerms(text), []))
})

test('能不能生成：模型没配好要说清去哪里配，不暴露内部服务名', () => {
  const missing = describeGenerationReadiness({ outletLabel: '图片', modelReady: false, dryRun: false })
  assert.equal(missing.tone, 'error')
  assert.equal(missing.title, '还不能生成图片')
  assert.match(missing.detail, /模型管理/)
  assert.deepEqual(findInternalTerms(`${missing.title}${missing.detail}`), [])

  const ready = describeGenerationReadiness({ outletLabel: '图片', modelReady: true, dryRun: false })
  assert.equal(ready.tone, 'success')
  assert.match(ready.detail, /产生费用/)

  const unknown = describeGenerationReadiness({ outletLabel: '图片', modelReady: null, dryRun: null })
  assert.equal(unknown.title, '正在确认生成条件…')

  const errored = describeGenerationReadiness({
    outletLabel: '提示词',
    error: 'GET /api/v1/llm/model-settings 失败（HTTP 500）：deepseek-chat 未配置',
  })
  assert.deepEqual(findInternalTerms(`${errored.title}${errored.detail}`), [])
})

test('sanitizeUserText：内部术语整句丢掉，正常中文原样保留', () => {
  assert.equal(sanitizeUserText('额度不足，请充值后重试。'), '额度不足，请充值后重试。')
  assert.equal(sanitizeUserText('已就绪：文本模型 deepseek-chat，未开启演练门禁'), USER_TEXT_FALLBACK)
  assert.equal(sanitizeUserText('任务已排队（status: ready，file_id=abc123）'), USER_TEXT_FALLBACK)
  assert.equal(sanitizeUserText(''), '')

  const mixed = sanitizeUserText('出图服务返回 503。模型 deepseek-chat 未就绪。')
  assert.equal(mixed, '出图服务返回 503。')
  assert.deepEqual(findInternalTerms(mixed), [])

  // 自定义兜底文案也必须干净
  assert.deepEqual(findInternalTerms(sanitizeUserText('DRY_RUN=开', '稍后重试')), [])
})

test('内部术语清单本身就是禁止给用户看的那些', () => {
  ;['deepseek-chat', 'image2', 'status: ready', '门禁', 'file_id'].forEach((term) => {
    assert.ok(FORBIDDEN_INTERNAL_TERMS.includes(term), `清单里应有 ${term}`)
  })
})
