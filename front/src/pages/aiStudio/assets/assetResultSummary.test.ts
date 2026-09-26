/**
 * 出图结果口径的回归测试（Node 内置测试运行器，无需额外依赖）。
 *
 * 对应真实故障：出图服务在上游图片**已生成**、但它自己 **OSS 上传失败**时返回
 * `partial_failed`。页面曾用绿色成功 Alert 渲染它，并丢掉真正的错误消息。
 * 这里锁死四条口径：
 *   1. 部分失败绝不渲染成绿色成功（`alertType` 只能是 warning / error）。
 *   2. 有成功条目时必须同时给出「成功 X / 失败 Y」两个整数，不能只报总数。
 *   3. 真实失败原因可见（`detail.error_message` 优先），取不到时明确说「未提供原因」。
 *   4. 新字段有就用、没有就回退（新计数字段 → by_status → results → total），不白屏。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ASSET_OUTCOME_LABEL,
  ASSET_OUTCOME_TAG_COLOR,
  classifyAssetResultStatus,
  coerceLooseBoolean,
  describeDryRunBadge,
  extractAssetResultErrorMessage,
  normalizeAssetResultRow,
  normalizeStatusToken,
  readLooseBoolean,
  summarizeAssetResults,
  summarizeSingleAssetResult,
} from './assetResultSummary.ts'

/* ------------------------------------------------------------------ ① 全成功 */

test('全成功：绿色成功 + 「全部成功（成功 1/共 1）」（§6.3 新口径）', () => {
  const summary = summarizeAssetResults(
    [{ status: 'succeeded', ok: true, oss_url: 'https://oss.example.com/a.png' }],
    { summary: { total: 1, by_status: { succeeded: 1 }, oss_ready: 1 } },
  )

  assert.equal(summary.alertType, 'success')
  assert.equal(summary.okCount, 1)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.countsText, '全部成功（成功 1/共 1）')
  assert.equal(summary.allSucceeded, true)
  assert.equal(summary.allFailed, false)
  assert.equal(summary.hasFailure, false)
  assert.equal(summary.hasPartialFailure, false)
  assert.equal(summary.ossReadyCount, 1)
})

/* ------------------------------------------------------------------ ② 全失败 */

test('全失败：error 样式 + 「全部失败（成功 0/共 1）」，并保留上游原因', () => {
  const summary = summarizeAssetResults(
    [{ status: 'failed', ok: false, message: '出图服务返回 500' }],
    { summary: { total: 1, by_status: { failed: 1 }, oss_ready: 0 } },
  )

  assert.equal(summary.alertType, 'error')
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')
  assert.equal(summary.allFailed, true)
  assert.equal(summary.errorText, '出图服务返回 500')
  assert.equal(summary.hasUpstreamError, true)
})

/* --------------------------------------------------------------- ③ 部分失败 */

test('partial_failed 单条：绝不是绿色成功，必须说清「图片已生成但 OSS 未完成」', () => {
  const summary = summarizeSingleAssetResult(
    {
      status: 'partial_failed',
      ok: true, // 旧后端对 partial_failed 恒返回 ok=true —— 不得被当成成功
      image_url: 'https://image-service.local/x.png',
      oss_url: '',
      detail: { error_message: 'OSS upload failed: HTTP 403' },
    },
    { summary: { total: 1, by_status: { partial_failed: 1 }, oss_ready: 0 } },
  )

  assert.notEqual(summary.alertType, 'success')
  assert.equal(summary.alertType, 'error')
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')
  assert.equal(summary.hasPartialFailure, true)
  assert.equal(summary.hasOssPartialFailure, true)
  // 真实原因原文可见，且带上了 HTTP 403
  assert.equal(summary.errorText, 'OSS upload failed: HTTP 403')
  assert.equal(summary.httpStatus, 403)
  assert.match(summary.nextStepText, /稍后刷新这一项重试/)
  assert.match(summary.nextStepText, /长期存储配置/)
})

test('成功与失败混合：warning（不是 success），且「部分失败（成功 X/共 Y）」两数齐全', () => {
  const summary = summarizeAssetResults(
    [
      { status: 'succeeded', ok: true, oss_url: 'https://oss.example.com/1.png' },
      { status: 'partial_failed', ok: true, detail: { error_message: 'OSS upload failed: HTTP 403' } },
    ],
    { summary: { total: 2, by_status: { succeeded: 1, partial_failed: 1 }, oss_ready: 1 } },
  )

  assert.equal(summary.alertType, 'warning')
  assert.equal(summary.okCount, 1)
  assert.equal(summary.failedCount, 1)
  // 有成功条目时必须同时报出成功数和失败数，不能只报失败或只报总数
  assert.equal(summary.countsText, '部分失败（成功 1/共 2）')
  assert.match(summary.title, /部分失败（成功 1\/共 2）/)
  assert.equal(summary.allSucceeded, false)
  assert.equal(summary.hasPartialFailure, true)
})

test('ok=true 不能盖过识别出来的 status；但显式 ok=false 视为失败', () => {
  // partial_failed + ok:true → 仍按部分失败处理
  const partial = normalizeAssetResultRow({ status: 'partial_failed', ok: true })
  assert.equal(partial.outcome, 'partial_failed')
  assert.equal(partial.isSuccess, false)
  assert.equal(partial.bucket, 'failed')

  // status 认不出来时才用 ok 兜底
  const byOk = normalizeAssetResultRow({ status: 'weird_unknown_state', ok: true })
  assert.equal(byOk.outcome, 'succeeded')

  // 显式 ok=false 是明确失败证据，不渲染成成功
  const contradicted = normalizeAssetResultRow({ status: 'succeeded', ok: false })
  assert.equal(contradicted.outcome, 'failed')
  assert.equal(contradicted.isSuccess, false)
})

/* ------------------------------------------------- ④ 只有 by_status 的老形状 */

test('只有老形状 by_status（无 results）：按 by_status 计数，且认得 partial_failed', () => {
  const summary = summarizeAssetResults([], {
    summary: { total: 1, by_status: { partial_failed: 1 }, oss_ready: 0 },
  })

  assert.equal(summary.countSource, 'by_status')
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')
  assert.notEqual(summary.alertType, 'success')
  assert.equal(summary.alertType, 'error')
  // 老形状没有 message：必须明确标出这是「部分失败」，并给出 OSS 排查提示
  assert.equal(summary.hasOssPartialFailure, true)
  // 新口径（§6.3）：不再拼枚举原值，改用固定中文句
  assert.match(summary.errorText, /没完成长期存储/)
  assert.match(summary.nextStepText, /长期存储配置/)
})

test('老形状 by_status 混合：成功数与失败数都来自 by_status', () => {
  const summary = summarizeAssetResults([], {
    summary: { total: 4, by_status: { succeeded: 3, failed: 1 }, oss_ready: 3 },
  })

  assert.equal(summary.countSource, 'by_status')
  assert.equal(summary.okCount, 3)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.countsText, '部分失败（成功 3/共 4）')
  assert.equal(summary.alertType, 'warning')
  assert.equal(summary.ossReadyCount, 3) // 老字段 oss_ready 是整数计数
})

/* ------------------------------------------------------------ ⑤ 只有新形状 */

test('只有新形状（整数计数 + 归一化 outcome）：优先使用新字段', () => {
  const summary = summarizeAssetResults([], {
    summary: { total: 3, ok_count: 2, failed_count: 1, oss_ready_count: 2, outcome: 'partial_failed' },
  })

  assert.equal(summary.countSource, 'summary_fields')
  assert.equal(summary.okCount, 2)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.ossReadyCount, 2)
  assert.equal(summary.countsText, '部分失败（成功 2/共 3）')
  assert.equal(summary.alertType, 'warning')
  assert.equal(summary.hasOssPartialFailure, true)
})

test('新字段优先于老 by_status（两者同时存在时）', () => {
  const summary = summarizeAssetResults([], {
    summary: {
      total: 2,
      ok_count: 1,
      failed_count: 1,
      oss_ready_count: 1,
      by_status: { succeeded: 9, failed: 9 }, // 故意写错，应被新字段覆盖
    },
  })

  assert.equal(summary.countSource, 'summary_fields')
  assert.equal(summary.okCount, 1)
  assert.equal(summary.failedCount, 1)
})

test('新字段缺失时逐级回退到 results，再回退到 total，不白屏', () => {
  // 从 results 回退
  const fromRows = summarizeAssetResults([{ status: 'succeeded' }, { status: 'failed' }], { summary: {} })
  assert.equal(fromRows.countSource, 'results')
  assert.equal(fromRows.countsText, '部分失败（成功 1/共 2）')
  assert.equal(fromRows.alertType, 'warning')

  // 只有 total：明确说「没有拿到成功/失败明细」，不编造数字
  const totalOnly = summarizeAssetResults([], { summary: { total: 2 } })
  assert.equal(totalOnly.countSource, 'total_only')
  assert.equal(totalOnly.total, 2)
  assert.equal(totalOnly.countsKnown, false)
  assert.equal(totalOnly.countsText, '')
  assert.equal(totalOnly.alertType, 'info')
  assert.match(totalOnly.title, /共 2 条/)
  assert.match(totalOnly.detailLines.join('\n'), /没有拿到成功 \/ 失败明细/)

  // 什么都没有：也不能崩
  const empty = summarizeAssetResults(undefined)
  assert.equal(empty.total, 0)
  assert.equal(empty.alertType, 'info')
  assert.equal(empty.countSource, 'empty')
  assert.deepEqual(empty.detailLines, [])
})

test('汇总字段与明细对账：汇总说失败 0、明细有失败时，按明细显示（不把失败说成成功）', () => {
  const summary = summarizeAssetResults(
    [{ status: 'partial_failed', ok: true, detail: { error_message: 'OSS upload failed' } }],
    { summary: { total: 1, ok_count: 1, failed_count: 0, oss_ready_count: 0 } },
  )

  assert.equal(summary.countSource, 'evidence_override')
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 1)
  assert.match(summary.mismatchNote, /不一致/)
  assert.equal(summary.alertType, 'error')
})

/* ------------------------------------------------------- ⑥ 错误消息缺失 */

test('错误消息缺失：给出 §6.3 的固定中文口径，不静默成空 Alert', () => {
  const summary = summarizeAssetResults(
    [{ status: 'partial_failed', ok: true }],
    { summary: { total: 1, by_status: { partial_failed: 1 }, oss_ready: 0 } },
  )

  assert.equal(summary.alertType, 'error')
  assert.equal(summary.hasUpstreamError, false)
  assert.match(summary.errorText, /没完成长期存储/)
  // 兜底文案仍要说清「图已生成、只是没保存成功」，不能只剩一句空话
  assert.match(summary.errorText, /图已生成/)
  assert.match(summary.nextStepText, /稍后刷新这一项重试/)
})

test('summary.total 与 results 长度不一致时取较大值，且计数仍自洽', () => {
  const summary = summarizeAssetResults([{ status: 'succeeded' }], { summary: { total: 3, by_status: { succeeded: 3 } } })

  assert.equal(summary.total, 3)
  assert.equal(summary.okCount, 3)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.countsText, '全部成功（成功 3/共 3）')
})

/* ------------------------------------------- ⑦ detail.error_message 优先级 */

test('上游消息在 detail.error_message 里：优先取它，而不是 message', () => {
  const row = {
    status: 'partial_failed',
    message: '（泛泛的一句话）',
    detail: { error_message: '图片已生成，但 OSS 上传返回 HTTP 403' },
  }

  assert.equal(extractAssetResultErrorMessage(row), '图片已生成，但 OSS 上传返回 HTTP 403')

  const summary = summarizeSingleAssetResult(row, {
    summary: { total: 1, by_status: { partial_failed: 1 }, oss_ready: 0 },
  })
  assert.equal(summary.errorText, '图片已生成，但 OSS 上传返回 HTTP 403')
  assert.equal(summary.httpStatus, 403)
  assert.equal(summary.hasUpstreamError, true)
})

test('details 数组 / error_message 变体 / 嵌套 error 也能取到原因', () => {
  assert.equal(
    extractAssetResultErrorMessage({ status: 'failed', details: [{ error_message: '第一项原因' }] }),
    '第一项原因',
  )
  assert.equal(extractAssetResultErrorMessage({ status: 'failed', errorMessage: '驼峰命名的原因' }), '驼峰命名的原因')
  assert.equal(extractAssetResultErrorMessage({ status: 'failed', error: { message: '嵌套原因' } }), '嵌套原因')
  assert.equal(extractAssetResultErrorMessage({ status: 'failed' }), '')
})

test('行内没有原因时，从顶层 details / message 兜底取原因', () => {
  const summary = summarizeAssetResults([{ status: 'failed', ok: false }], {
    summary: { total: 1, by_status: { failed: 1 } },
    payload: { details: [{ error_message: '后端顶层给的原因' }] },
  })

  assert.equal(summary.errorText, '后端顶层给的原因')
  assert.equal(summary.hasUpstreamError, true)
})

/* --------------------------------------------------- 附加：状态分类与硬约束 */

test('状态分类：部分失败集合必须先于通用 failed 命中', () => {
  assert.equal(classifyAssetResultStatus('partial_failed'), 'partial_failed')
  assert.equal(classifyAssetResultStatus('PARTIAL-FAILED'), 'partial_failed')
  assert.equal(classifyAssetResultStatus('oss_failed'), 'partial_failed')
  assert.equal(classifyAssetResultStatus('partial_failed_by_oss'), 'partial_failed')
  assert.equal(classifyAssetResultStatus('failed'), 'failed')
  assert.equal(classifyAssetResultStatus('succeeded'), 'succeeded')
  assert.equal(classifyAssetResultStatus('dry_run'), 'dry_run')
  assert.equal(classifyAssetResultStatus('queued'), 'pending')
  assert.equal(classifyAssetResultStatus('完全看不懂的状态'), null)
  assert.equal(normalizeStatusToken(' Partial Failed '), 'partial_failed')
})

test('硬约束：任何含失败的汇总都不得是 success 样式', () => {
  const cases = [
    [{ status: 'partial_failed' }],
    [{ status: 'failed' }],
    [{ status: 'succeeded' }, { status: 'failed' }],
    [{ status: 'oss_failed' }],
    [{ status: 'succeeded' }, { status: 'partial_failed' }],
  ]
  for (const rows of cases) {
    const summary = summarizeAssetResults(rows, { summary: { total: rows.length } })
    assert.notEqual(summary.alertType, 'success', `含失败却给了成功样式：${JSON.stringify(rows)}`)
    assert.ok(summary.failedCount >= 1, `失败数应 >= 1：${JSON.stringify(rows)}`)
  }
})

test('硬约束：有成功条目时 detailLines 一定同时含成功数与失败数', () => {
  const summary = summarizeAssetResults(
    [{ status: 'succeeded' }, { status: 'failed' }],
    { summary: { total: 2, by_status: { succeeded: 1, failed: 1 } } },
  )
  const lines = summary.detailLines.join('\n')
  // 新口径（§6.3）：成功数与总数必须在同一句里出现，用户才能算出失败了几条
  assert.match(lines, /部分失败（成功 1\/共 2）/)
})

test('成功但长期图片未就绪时给出提醒（临时地址不算长期资产）', () => {
  const summary = summarizeAssetResults([{ status: 'succeeded', image_url: 'http://image-service/x.png' }], {
    summary: { total: 1, by_status: { succeeded: 1 }, oss_ready: 0 },
  })

  assert.equal(summary.alertType, 'success') // 状态本身确实成功
  assert.equal(summary.ossReadyCount, 0)
  assert.match(summary.detailLines.join('\n'), /还没保存为长期图片/)
})

test('演练占位不算成功也不算失败，且给出 warning 而不是绿色成功', () => {
  const summary = summarizeAssetResults([{ status: 'dry_run', dry_run: true }], {
    summary: { total: 1, by_status: { dry_run: 1 }, oss_ready: 0, dry_run: true },
  })

  assert.equal(summary.alertType, 'warning')
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.isDryRun, true)
  assert.match(summary.title, /演练模式/)
  // §4.4/§4.6：主区不再出现 DRY_RUN，改说「演练模式 / 真实模式」
  assert.match(summary.nextStepText, /演练模式/)
})

/* ==================================================================
 * llmPipeline 页（出图 / 出视频计划页）复用同一套口径的回归测试。
 *
 * 那页原来有三处问题，这里逐条锁死：
 *   A. `String(x) === 'true'` 用字符串比较布尔 —— 布尔 true 恰好能过，但后端回整数 1 /
 *      'yes' / 干脆不带这个字段时结论会**反过来**（把演练说成真实）。
 *   B. `<GuardTag />` 有 6 处是无参调用，`dryRun` 恒为 undefined → 一律显示红色的
 *      「真实调用已开启」，等于在演练模式下谎报真实付费调用。
 *   C. 提交结果用纯 Table：状态列不取色、失败原因（detail.error_message）看不见、
 *      也没有「成功 X / 失败 Y」。
 * ================================================================== */

/* ------------------------------------------------ A. 宽松布尔与旧写法的差异 */

test('coerceLooseBoolean：布尔 / 字符串 / 数字都认，读不到才是 null', () => {
  assert.equal(coerceLooseBoolean(true), true)
  assert.equal(coerceLooseBoolean(false), false)
  assert.equal(coerceLooseBoolean('true'), true)
  assert.equal(coerceLooseBoolean('TRUE'), true)
  assert.equal(coerceLooseBoolean('false'), false)
  assert.equal(coerceLooseBoolean(1), true)
  assert.equal(coerceLooseBoolean(0), false)
  assert.equal(coerceLooseBoolean('yes'), true)
  assert.equal(coerceLooseBoolean('no'), false)
  assert.equal(coerceLooseBoolean('on'), true)
  assert.equal(coerceLooseBoolean('off'), false)
  // 读不到必须是 null，不能悄悄变成 false（旧写法 `String(x) === 'true'` 就会）
  assert.equal(coerceLooseBoolean(undefined), null)
  assert.equal(coerceLooseBoolean(null), null)
  assert.equal(coerceLooseBoolean(''), null)
  assert.equal(coerceLooseBoolean('maybe'), null)
})

test('回归锁：旧写法 String(x) === \'true\' 会得出相反结论的输入', () => {
  // 后端把开关回成整数 1：旧写法 false（显示「真实」），新口径必须是 DRY_RUN
  assert.equal(String(1) === 'true', false) // 记录旧写法的错误结论
  assert.equal(coerceLooseBoolean(1), true)
  // 缺字段：旧写法也是 false（把「不知道」当成「真实」）
  assert.equal(String(undefined) === 'true', false)
  assert.equal(coerceLooseBoolean(undefined), null)
})

test('readLooseBoolean：按 key 列表读，缺字段返回 null 而不是 false', () => {
  assert.equal(readLooseBoolean({ dry_run: true }, ['dry_run']), true)
  assert.equal(readLooseBoolean({ dry_run: 1 }, ['dry_run']), true)
  assert.equal(readLooseBoolean({ dry_run: 'yes' }, ['dry_run']), true)
  assert.equal(readLooseBoolean({ dry_run: false }, ['dry_run']), false)
  assert.equal(readLooseBoolean({}, ['dry_run']), null)
  assert.equal(readLooseBoolean(null, ['dry_run']), null)
  // 第一个 key 读不到时继续看后面的 key
  assert.equal(readLooseBoolean({ dryRun: true }, ['dry_run', 'dryRun']), true)
})

/* ------------------------------------------------- B. 演练 / 真实 徽标三态 */

test('describeDryRunBadge：dry_run 为布尔时 Tag 正确（true=演练 / false=真实）', () => {
  const dry = describeDryRunBadge(true)
  assert.equal(dry.state, 'dry_run')
  assert.equal(dry.color, 'orange')
  assert.match(dry.text, /演练/)

  const real = describeDryRunBadge(false)
  assert.equal(real.state, 'real')
  assert.equal(real.color, 'red')
  assert.match(real.text, /真实调用已开启/)
})

test('describeDryRunBadge：整数 / 字符串开关也按真值判断（不能反过来）', () => {
  assert.equal(describeDryRunBadge(1).state, 'dry_run')
  assert.equal(describeDryRunBadge('yes').state, 'dry_run')
  assert.equal(describeDryRunBadge('on').state, 'dry_run')
  assert.equal(describeDryRunBadge(0).state, 'real')
  assert.equal(describeDryRunBadge('false').state, 'real')
})

test('describeDryRunBadge：读不到时是「状态待确认」，绝不谎报「真实调用已开启」（GuardTag 无参调用的回归锁）', () => {
  for (const missing of [undefined, null, '', 'maybe']) {
    const badge = describeDryRunBadge(missing)
    assert.equal(badge.state, 'unknown', `输入 ${JSON.stringify(missing)} 不该判成演练或真实`)
    assert.equal(badge.color, 'default')
    // 口径已去开发术语（§4.6）：不再写 DRY_RUN / 守卫，改「状态待确认」
    assert.match(badge.text, /状态待确认/)
    assert.doesNotMatch(badge.text, /真实调用已开启/)
    assert.doesNotMatch(badge.text, /演练占位/)
  }
})

/* ---------------------------------------------------- C. 状态取色（不绿） */

test('状态取色：只有 succeeded 是绿色，partial_failed / failed / pending 都不是', () => {
  assert.equal(ASSET_OUTCOME_TAG_COLOR.succeeded, 'green')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR.partial_failed, 'green')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR.failed, 'green')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR.pending, 'green')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR.dry_run, 'green')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR.unknown, 'green')
  // 每个口径都要有中文标签，避免页面出现 undefined
  for (const outcome of Object.keys(ASSET_OUTCOME_TAG_COLOR) as (keyof typeof ASSET_OUTCOME_TAG_COLOR)[]) {
    assert.ok(ASSET_OUTCOME_LABEL[outcome], `${outcome} 缺中文标签`)
  }
})

test('partial_failed 行按归一化口径取色：不是绿色，且带「部分失败」标注', () => {
  const normalized = normalizeAssetResultRow({ status: 'partial_failed', ok: true })
  assert.equal(normalized.outcome, 'partial_failed')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR[normalized.outcome], 'green')
  assert.equal(ASSET_OUTCOME_LABEL[normalized.outcome], '部分失败')
  assert.equal(normalized.isFailure, true)
})

/* ------------------------------------- 出图计划页的真实响应形状（端到端口径） */

/** 复刻 `/studio/image-pipeline/submit` 的响应形状（演练 + 一条部分失败）。 */
function imagePipelineSubmitPayload() {
  return {
    guard_status: 'dry_run_allowed',
    warnings: [],
    summary: { total: 1, by_status: { partial_failed: 1 }, oss_ready: 0, dry_run: true },
    results: [
      {
        source_asset_id: 'asset-1',
        service_task_id: 'svc-1',
        status: 'partial_failed',
        ok: true,
        oss_url: '',
        image_url: 'https://image-service.local/x.png',
        detail: { error_message: '图片已生成，但 OSS 上传返回 HTTP 403' },
      },
    ],
  }
}

test('出图提交：状态列不绿 + 计数两个数都在 + 失败原因取自 detail.error_message', () => {
  const payload = imagePipelineSubmitPayload()
  const summary = summarizeAssetResults(payload.results, { summary: payload.summary, payload })

  // 状态列取色：不是绿色成功
  assert.notEqual(summary.alertType, 'success')
  assert.equal(summary.alertType, 'error')

  // 「成功 X / 失败 Y」两个数同时出现
  assert.equal(summary.countsKnown, true)
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')

  // 失败原因取自 detail.error_message（而不是被丢掉的 message）
  assert.equal(summary.errorText, '图片已生成，但 OSS 上传返回 HTTP 403')
  assert.equal(summary.httpStatus, 403)
  assert.equal(normalizeAssetResultRow(payload.results[0]).errorText, '图片已生成，但 OSS 上传返回 HTTP 403')

  // 演练标识：summary.dry_run 是布尔 true → 如实显示演练
  assert.equal(describeDryRunBadge(readLooseBoolean(payload.summary, ['dry_run'])).state, 'dry_run')
  assert.equal(summary.isDryRun, true)
})

test('出图提交：有成功有失败时「部分失败（成功 X/共 Y）」两个数必须同时出现', () => {
  const results = [
    { source_asset_id: 'a1', service_task_id: 't1', status: 'succeeded', oss_url: 'https://oss.example.com/1.png' },
    { source_asset_id: 'a2', service_task_id: 't2', status: 'succeeded', oss_url: 'https://oss.example.com/2.png' },
    {
      source_asset_id: 'a3',
      service_task_id: 't3',
      status: 'partial_failed',
      detail: { error_message: 'OSS upload failed: HTTP 403' },
    },
  ]
  const summary = summarizeAssetResults(results, { summary: { total: 3, by_status: { succeeded: 2, partial_failed: 1 }, oss_ready: 2 } })

  assert.equal(summary.okCount, 2)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.countsText, '部分失败（成功 2/共 3）')
  assert.equal(summary.alertType, 'warning')
  const lines = summary.detailLines.join('\n')
  // 新口径（§6.3）：同上
  assert.match(lines, /部分失败（成功 2\/共 3）/)
  assert.match(lines, /HTTP 403/)
})

test('出视频提交（单条）：partial_failed 不是绿色，且带真实原因与下一步', () => {
  const data = {
    status: 'partial_failed',
    provider_task_id: 'prov-1',
    elapsed_ms: 1200,
    file_persisted: false,
    url: '',
    error: '',
    message: '上游图片已生成',
    detail: { error_message: 'OSS upload failed: HTTP 403' },
    warnings: [],
  }
  const summary = summarizeSingleAssetResult(data, { payload: data })

  assert.notEqual(summary.alertType, 'success')
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')
  assert.equal(summary.errorText, 'OSS upload failed: HTTP 403')
  assert.match(summary.nextStepText, /稍后刷新这一项重试/)
  assert.equal(ASSET_OUTCOME_TAG_COLOR[normalizeAssetResultRow(data).outcome], ASSET_OUTCOME_TAG_COLOR.partial_failed)
})

test('出图提交：results 全成功时才是绿色成功', () => {
  const results = [{ source_asset_id: 'a1', service_task_id: 't1', status: 'succeeded', oss_url: 'https://oss.example.com/1.png' }]
  const summary = summarizeAssetResults(results, { summary: { total: 1, by_status: { succeeded: 1 }, oss_ready: 1, dry_run: false } })

  assert.equal(summary.alertType, 'success')
  assert.equal(summary.countsText, '全部成功（成功 1/共 1）')
  assert.equal(describeDryRunBadge(readLooseBoolean({ dry_run: false }, ['dry_run'])).state, 'real')
})

/* ==================================================================
 * 与真实后端归一化口径对齐（后端已落地 ok_count / failed_count / by_outcome /
 * outcome / error_message / partial_failed_count / unknown_count）。
 * ================================================================== */

test('归一化 outcome=unknown 的行不能当成功（否则等于把「不知道」谎报成成功）', () => {
  // 后端真实词汇：ok / partial_failed / running / failed / dry_run / unknown
  const unknownRow = normalizeAssetResultRow({ status: 'weird_upstream_state', outcome: 'unknown', ok: true })
  assert.equal(unknownRow.outcome, 'unknown')
  assert.equal(unknownRow.isSuccess, false, 'unknown 不能被当成成功')
  assert.equal(unknownRow.bucket, 'unknown')
  assert.notEqual(ASSET_OUTCOME_TAG_COLOR[unknownRow.outcome], 'green')

  const summary = summarizeAssetResults([{ status: 'weird_upstream_state', outcome: 'unknown', ok: true }], {
    summary: { total: 1, ok_count: 0, failed_count: 0, running_count: 0, dry_run_count: 0, unknown_count: 1 },
  })
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.unknownCount, 1)
  assert.notEqual(summary.alertType, 'success')
  assert.match(summary.title, /状态未知/)
})

test('归一化 outcome=ok 认作成功（后端用 ok，不是 succeeded）', () => {
  const row = normalizeAssetResultRow({ status: 'completed', outcome: 'ok', ok: true, oss_url: 'https://o/1.png' })
  assert.equal(row.outcome, 'succeeded')
  assert.equal(row.isSuccess, true)
  assert.equal(ASSET_OUTCOME_TAG_COLOR[row.outcome], 'green')

  // running 归到「处理中」，既不算成功也不算失败
  const running = normalizeAssetResultRow({ status: 'queued', outcome: 'running', ok: true })
  assert.equal(running.outcome, 'pending')
  assert.equal(running.isSuccess, false)
  assert.equal(running.isFailure, false)
})

test('新形状 by_outcome 作为回退（没有整数计数时）', () => {
  const summary = summarizeAssetResults([], {
    summary: { total: 3, by_outcome: { ok: 2, partial_failed: 1 } },
  })
  assert.equal(summary.countSource, 'by_outcome')
  assert.equal(summary.okCount, 2)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.countsText, '部分失败（成功 2/共 3）')
  assert.equal(summary.alertType, 'warning')
  assert.equal(summary.hasOssPartialFailure, true)
})

test('复刻后端真实 summary（partial_failed 场景）：计数、原因、部分失败标记全部对齐', () => {
  // 这是 /studio/image-pipeline/submit 在「图片已生成但 OSS 上传失败」时的真实形状
  const payload = {
    total: 1,
    by_status: { partial_failed: 1 },
    oss_ready: 0,
    dry_run: false,
    outcome: 'failed', // 注意：后端聚合 outcome 给的是 failed，不是 partial_failed
    by_outcome: { partial_failed: 1 },
    ok_count: 0,
    failed_count: 1,
    partial_failed_count: 1,
    running_count: 0,
    dry_run_count: 0,
    unknown_count: 0,
    oss_ready_count: 0,
    ok: false,
    has_failure: true,
    has_partial_failure: true,
    message: '图片已生成，但 OSS 上传返回 HTTP 403',
  }
  const rows = [
    {
      source_task_id: 't',
      source_asset_id: 'a',
      status: 'partial_failed',
      outcome: 'partial_failed',
      ok: false,
      image_url: 'https://img/x.png',
      oss_url: '',
      oss_ready: false,
      message: '图片已生成，但 OSS 上传返回 HTTP 403',
      error_message: '图片已生成，但 OSS 上传返回 HTTP 403',
      http_status: 403,
      detail: { error_message: '图片已生成，但 OSS 上传返回 HTTP 403', http_status: 403 },
    },
  ]
  const summary = summarizeAssetResults(rows, { summary: payload, payload })

  assert.equal(summary.countSource, 'summary_fields')
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.unknownCount, 0)
  assert.equal(summary.ossReadyCount, 0)
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')
  assert.equal(summary.alertType, 'error')
  assert.notEqual(summary.alertType, 'success')
  assert.equal(summary.hasOssPartialFailure, true)
  assert.equal(summary.httpStatus, 403)
  assert.match(summary.errorText, /HTTP 403/)
  assert.match(summary.nextStepText, /稍后刷新这一项重试/)
  assert.match(summary.nextStepText, /长期存储配置/)
})

test('仅靠 by_outcome + partial_failed_count 也能识别部分失败（聚合 outcome 是 failed 时）', () => {
  const summary = summarizeAssetResults([], {
    summary: { total: 1, outcome: 'failed', by_outcome: { partial_failed: 1 }, partial_failed_count: 1 },
  })
  assert.equal(summary.hasOssPartialFailure, true)
  assert.match(summary.nextStepText, /稍后刷新这一项重试/)
  assert.equal(summary.failedCount, 1)
})

/* ==================================================================
 * 任务二：`partial_failed` 汇总不能显示成 `0/0`
 *
 * 真实报障（已复现）：页面显示「成功 0 / 失败 0」，而实际有 1 条结果。
 * 根因是**前端分类器**不认裸 `partial`（返回 null）→ 一条都没被计入成功/失败，
 * 且因为计数被塞进了 pending 桶，连「无法判断」的提示都没有。
 *
 * 这里锁两层：
 *   A. 识别口径补全（含 `partial` / `partial_ok` / `partially_failed` 这类 token）；
 *   B. 「不丢数」硬约束：已识别计数之和必须能解释 total，解释不了的部分必须
 *      落到 unknownCount / unaccountedCount **并在文案里说出来**。
 * ================================================================== */

const PARTIAL_LIKE_TOKENS = [
  'partial',
  'PARTIAL',
  'partial_failed',
  'PARTIAL-FAILED',
  'PartialFailed',
  'partially_failed',
  'partiallyfailed',
  'partial_fail',
  'partial_ok',
  'partial_success',
  'partial_error',
  'partial_failed_by_oss',
  'weird_partial_token',
] as const

/** 已识别状态 token 的样本（覆盖成功 / 部分失败 / 失败 / 演练 / 处理中 / 明确未知 / 真·未识别）。 */
const STATUS_TOKEN_SAMPLES = [
  // 成功
  'succeeded',
  'success',
  'ok',
  'completed',
  'done',
  // 部分失败（含历史与方言写法）
  ...PARTIAL_LIKE_TOKENS,
  'oss_failed',
  'oss_upload_error',
  'oss_upload_error_403',
  'failed_by_oss',
  // 失败（含复合 token：含 fail/error 的绝不允许落到「未识别」）
  'failed',
  'failure',
  'error',
  'weird_failed_state',
  'upstream_error_code_500',
  // 演练 / 处理中
  'dry_run',
  'pending',
  'queued',
  'running',
  // 明确未知
  'unknown',
  // 真·认不出来（不能凭空编造成功或失败，但必须被计入 unknown）
  'mystery_state',
  '完全看不懂的状态',
] as const

/** 汇总文案里是否**显式说明**了「还有一部分既不算成功也不算失败」。 */
function explainsNonOkNonFailed(summary: {
  countsKnown: boolean
  title: string
  countsText: string
  detailLines: string[]
}): boolean {
  if (!summary.countsKnown) return true // 已明确告知「没有拿到成功 / 失败明细」
  const text = `${summary.title}｜${summary.countsText}｜${summary.detailLines.join('｜')}`
  return /未识别|未知|无法判断|处理中|待完成|演练|未提供|没有给出/.test(text)
}

test('裸 `partial` 必须按「部分失败」算：不再显示成成功 0 / 失败 0（报障的原始形状）', () => {
  assert.equal(classifyAssetResultStatus('partial'), 'partial_failed')

  // 报障时用的就是这条形状：by_status: {partial: 1}
  const summary = summarizeAssetResults([], {
    summary: { total: 1, by_status: { partial: 1 }, oss_ready: 0 },
  })

  assert.equal(summary.total, 1)
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 1)
  assert.notEqual(summary.countsText, '成功 0 / 失败 0')
  assert.equal(summary.countsText, '全部失败（成功 0/共 1）')
  assert.equal(summary.hasFailure, true)
  assert.equal(summary.alertType, 'error')
  assert.notEqual(summary.alertType, 'success')
})

test('「部分失败」的方言 token 全部识别成 partial_failed（不允许落到未识别）', () => {
  for (const token of PARTIAL_LIKE_TOKENS) {
    assert.equal(
      classifyAssetResultStatus(token),
      'partial_failed',
      `token「${token}」应识别为部分失败，实际是 ${String(classifyAssetResultStatus(token))}`,
    )
  }
})

test('含 fail / error / denied 的 token 绝不允许落到「未识别」', () => {
  for (const token of ['weird_failed_state', 'upstream_error_code_500', 'denied_by_gateway', 'fail', 'error']) {
    const outcome = classifyAssetResultStatus(token)
    assert.notEqual(outcome, null, `token「${token}」落到了未识别：明确的坏消息不能被当成"看不出来"`)
    assert.ok(
      outcome === 'failed' || outcome === 'partial_failed',
      `token「${token}」应至少算失败，实际是 ${String(outcome)}`,
    )
  }
})

test('后端只给 total 大于已识别计数时，差额不被丢弃：计入 unknown 并写进文案', () => {
  const summary = summarizeAssetResults([], { summary: { total: 5, by_status: { succeeded: 2 } } })

  assert.equal(summary.total, 5)
  assert.equal(summary.okCount, 2)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.unaccountedCount, 3)
  assert.equal(summary.unknownCount, 3)
  assert.equal(summary.okCount + summary.failedCount + summary.unknownCount, summary.total)
  assert.match(summary.countsText, /未识别/)
  assert.match(summary.detailLines.join('\n'), /3 条/)
})

test('后端给 0/0 但 total=1 时，也不允许静默成「成功 0 / 失败 0」', () => {
  const summary = summarizeAssetResults([], { summary: { total: 1, ok_count: 0, failed_count: 0 } })

  assert.equal(summary.total, 1)
  assert.equal(summary.okCount, 0)
  assert.equal(summary.failedCount, 0)
  assert.equal(summary.unknownCount, 1)
  assert.equal(summary.unaccountedCount, 1)
  assert.ok(explainsNonOkNonFailed(summary), `文案必须说明那 1 条去哪了：${summary.countsText}`)
})

test('不丢数硬约束（穷举）：任何状态组合下 ok+failed+dryRun+pending+unknown 都必须等于 total', () => {
  type Case = { label: string; summary: ReturnType<typeof summarizeAssetResults> }

  const cases: Case[] = []
  const pushMap = (label: string, map: Record<string, number>, withTotal: boolean) => {
    const total = Object.values(map).reduce((sum, n) => sum + n, 0)
    cases.push({
      label,
      summary: summarizeAssetResults([], { summary: withTotal ? { total, by_status: map } : { by_status: map } }),
    })
  }

  // ① 单 token × 多种条数
  for (const token of STATUS_TOKEN_SAMPLES) {
    for (const count of [1, 2, 3]) {
      pushMap(`${token}=${count}`, { [token]: count }, true)
      pushMap(`${token}=${count}（无 total）`, { [token]: count }, false)
    }
  }

  // ② 两两组合：把「一个认得、一个认不出来」的交叉情况也覆盖掉
  for (let i = 0; i < STATUS_TOKEN_SAMPLES.length; i += 1) {
    for (let j = i + 1; j < STATUS_TOKEN_SAMPLES.length; j += 1) {
      for (const left of [1, 2]) {
        for (const right of [1, 3]) {
          pushMap(
            `${STATUS_TOKEN_SAMPLES[i]}=${left} + ${STATUS_TOKEN_SAMPLES[j]}=${right}`,
            { [STATUS_TOKEN_SAMPLES[i]]: left, [STATUS_TOKEN_SAMPLES[j]]: right },
            true,
          )
        }
      }
    }
  }

  // ③ by_status 的合计与后端 total 不一致（后端少报 / 多报）
  cases.push({
    label: 'total 比 by_status 大',
    summary: summarizeAssetResults([], { summary: { total: 7, by_status: { partial: 1, succeeded: 2 } } }),
  })
  cases.push({
    label: 'total 比 by_status 小',
    summary: summarizeAssetResults([], { summary: { total: 1, by_status: { succeeded: 3 } } }),
  })

  // ④ 明细行形状
  for (const token of STATUS_TOKEN_SAMPLES) {
    cases.push({
      label: `rows:${token}`,
      summary: summarizeAssetResults([{ status: token }], { summary: { total: 1 } }),
    })
    cases.push({
      label: `rows:${token}×2（后端 total 偏小）`,
      summary: summarizeAssetResults([{ status: token }, { status: token }], { summary: { total: 1 } }),
    })
  }

  // ⑤ 新后端的整数字段形状（含后端只回 0/0、以及只回分布的情况）
  const fieldShapes: Array<{ label: string; summary: Record<string, unknown> }> = [
    { label: 'ok=0/failed=0', summary: { ok_count: 0, failed_count: 0 } },
    { label: 'running=1', summary: { ok_count: 0, failed_count: 0, running_count: 1 } },
    { label: 'dry_run=1', summary: { ok_count: 0, failed_count: 0, dry_run_count: 1 } },
    { label: 'unknown=2', summary: { ok_count: 0, failed_count: 0, unknown_count: 2 } },
    { label: 'ok=1+running=1', summary: { ok_count: 1, failed_count: 0, running_count: 1 } },
    { label: 'failed=1', summary: { ok_count: 0, failed_count: 1 } },
    {
      label: '只有 partial_failed_count',
      summary: { ok_count: 0, failed_count: 0, partial_failed_count: 1 },
    },
    { label: '只有 ok_count', summary: { ok_count: 2 } },
    { label: '只有 failed_count', summary: { failed_count: 1 } },
  ]
  for (const shape of fieldShapes) {
    const total = 1 + Number(shape.summary.ok_count ?? 0) + Number(shape.summary.failed_count ?? 0) + Number(shape.summary.running_count ?? 0)
    cases.push({
      label: `fields:${shape.label}`,
      summary: summarizeAssetResults([], { summary: { total, ...shape.summary } }),
    })
  }

  for (const item of cases) {
    const s = item.summary
    const accounted = s.okCount + s.failedCount + s.dryRunCount + s.pendingCount + s.unknownCount
    assert.equal(accounted, s.total, `[${item.label}] 计数之和不等于 total：${JSON.stringify({
      ok: s.okCount,
      failed: s.failedCount,
      dryRun: s.dryRunCount,
      pending: s.pendingCount,
      unknown: s.unknownCount,
      total: s.total,
    })}`)
    // 「有 N 条结果，却显示成功 0 / 失败 0，且什么都不说」——绝对不允许
    if (s.total > 0 && s.okCount === 0 && s.failedCount === 0) {
      assert.ok(
        explainsNonOkNonFailed(s),
        `[${item.label}] total=${s.total} 但成功/失败都是 0，文案没说清剩下的去哪了：${s.title}｜${s.countsText}｜${s.detailLines.join('｜')}`,
      )
    }
    // 计数自洽时，明细条数也不能超过 total
    assert.ok(s.rows.length <= s.total, `[${item.label}] 明细条数多于 total`)
  }
})

