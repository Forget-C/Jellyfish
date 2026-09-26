/**
 * 生成状态口径的回归测试（Node 内置测试运行器，无需额外依赖）。
 *
 * 覆盖两条收口要求：
 *   1. **DRY_RUN 与模型配置分开判断**：DRY_RUN 开着也不能显示「能力已配置」；
 *      默认模型为空 / 配置无法确认时，必须如实说「模型未配置 / 配置状态无法确认」。
 *   2. **不能把所有 409 都当成 DRY_RUN**：只有后端错误码 `paid_outlet_blocked`
 *      或正文明确包含 DRY_RUN 门禁信息才算门禁；其余 409 是业务冲突。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  PAID_OUTLET_BLOCKED_CODE,
  classifyGenerationFailure,
  describeGenerationGate,
  isDryRunGateMessage,
  readErrorCode,
  sanitizeErrorMessage,
  type GenerationGateSnapshot,
  type ModelConfigInfo,
} from './generationStatusCore.ts'

/** 构造一个快照；默认是「DRY_RUN 开 + 三个出口都已配置」。 */
function snapshot(overrides: Partial<GenerationGateSnapshot> = {}): GenerationGateSnapshot {
  const configured = (modelName: string): ModelConfigInfo => ({ state: 'configured', modelName, reason: '' })
  const base: GenerationGateSnapshot = {
    loading: false,
    dryRun: true,
    guardText: 'DRY_RUN=开（JELLYFISH_DRY_RUN，未发起真实调用）',
    guardEnv: 'JELLYFISH_DRY_RUN',
    confirmEnv: 'JELLYFISH_REAL_LLM_CONFIRMED',
    models: {
      llm: configured('deepseek-chat'),
      image: configured('gpt-image-2'),
      video: configured('seedance-2.0-mini'),
    },
    error: '',
    reload: () => {},
  }
  return { ...base, ...overrides }
}

/* ------------------------------------------------- 门禁与模型配置分开判断 */

test('模型已配置 + 演练模式 → 主区只说「已配置，当前是演练模式」，原始模型名只进技术详情', () => {
  const info = describeGenerationGate(snapshot(), 'image')
  assert.equal(info.state, 'dry_run')
  assert.match(info.label, /已配置/)
  // §4.4 模式 3：「门禁」是禁词，改说「演练模式」
  assert.match(info.label, /演练模式/)
  assert.doesNotMatch(info.label, /门禁/)
  // ⚠️ §6.2 反向锁死已改：**原始模型名不许出现在主区**（以前这里断言它必须在）
  assert.doesNotMatch(info.description, /gpt-image-2/)
  assert.doesNotMatch(info.description, /deepseek|seedance/)
  // 原文（模型名 / 演练开关 / 环境变量）改由技术详情层承载
  assert.match(String(info.technicalDetail), /gpt-image-2/)
  // 费用说明仍必须在主区：用户要知道这次会不会花钱
  assert.match(info.description, /不会产生费用|演练/)
})

test('模型未配置时，即使 DRY_RUN 开着也不能说「能力已配置」', () => {
  const info = describeGenerationGate(
    snapshot({
      models: {
        llm: { state: 'configured', modelName: 'deepseek-chat', reason: '' },
        image: { state: 'missing', modelName: '', reason: '没有配置默认图片模型 id。' },
        video: { state: 'configured', modelName: 'seedance-2.0-mini', reason: '' },
      },
    }),
    'image',
  )
  assert.equal(info.state, 'not_configured')
  // 口径微调：主区用「还没配置」（更口语），语义不变
  assert.equal(info.label, '图片模型还没配置')
  assert.doesNotMatch(info.label, /已配置/)
})

test('配置状态无法确认时，写「配置状态无法确认」而不是「已配置」', () => {
  const info = describeGenerationGate(
    snapshot({
      models: {
        llm: { state: 'configured', modelName: 'deepseek-chat', reason: '' },
        image: { state: 'unknown', modelName: '', reason: '默认图片模型 id=model-x 在模型表里查不到。' },
        video: { state: 'configured', modelName: 'seedance-2.0-mini', reason: '' },
      },
    }),
    'image',
  )
  assert.equal(info.state, 'unknown')
  assert.match(info.label, /配置状态无法确认/)
  assert.doesNotMatch(info.label, /已配置/)
})

test('各出口读各自的配置：文本已配置不等于图片/视频已配置', () => {
  const snap = snapshot({
    models: {
      llm: { state: 'configured', modelName: 'deepseek-chat', reason: '' },
      image: { state: 'missing', modelName: '', reason: '没有配置默认图片模型 id。' },
      video: { state: 'missing', modelName: '', reason: '没有配置默认视频模型 id。' },
    },
  })
  assert.equal(describeGenerationGate(snap, 'llm').state, 'dry_run')
  assert.equal(describeGenerationGate(snap, 'image').state, 'not_configured')
  assert.equal(describeGenerationGate(snap, 'video').state, 'not_configured')
})

test('未开演练门禁且模型已配置 → ready；缺一次配置读取 → loading', () => {
  assert.equal(describeGenerationGate(snapshot({ dryRun: false }), 'llm').state, 'ready')
  assert.equal(describeGenerationGate(snapshot({ loading: true }), 'llm').state, 'loading')
})

test('读取状态失败不能伪装成「一切正常」；原始错误只进技术详情', () => {
  const info = describeGenerationGate(snapshot({ error: 'GET /status 失败（HTTP 500）' }), 'llm')
  assert.equal(info.state, 'unknown')
  // §4.4 模式 6：主区只给中文结论，路径 / HTTP 状态码收进技术详情
  assert.doesNotMatch(info.description, /HTTP 500/)
  assert.doesNotMatch(info.description, /GET \/status/)
  assert.match(String(info.technicalDetail), /HTTP 500/)
})

/* ------------------------------------------------- 409 分类 */

test('错误码 paid_outlet_blocked → dry_run', () => {
  const error = { status: 409, errorCode: PAID_OUTLET_BLOCKED_CODE, message: '被拦截' }
  assert.equal(classifyGenerationFailure(error, 'image').state, 'dry_run')
})

test('从生成客户端 body.meta.error.code 里也能读到 paid_outlet_blocked', () => {
  const error = { status: 409, body: { code: 409, meta: { error: { code: PAID_OUTLET_BLOCKED_CODE } } } }
  assert.equal(readErrorCode(error), PAID_OUTLET_BLOCKED_CODE)
  assert.equal(classifyGenerationFailure(error, 'image').state, 'dry_run')
})

test('普通业务 409（没有门禁信息）→ 业务冲突，并保留后端真实原因', () => {
  const error = { status: 409, body: { code: 409, message: '该章节已存在同名镜头，无法重复写入' } }
  const failure = classifyGenerationFailure(error, 'image')
  assert.equal(failure.state, 'conflict')
  assert.match(failure.title, /业务冲突/)
  assert.match(failure.reason, /已存在同名镜头/)
})

test('正文里出现 DRY_RUN 字样但没有拦截语义 → 仍按业务冲突处理', () => {
  // 例如某条业务规则文案顺带提到 DRY_RUN，不应该被当成门禁
  const error = { status: 409, message: 'DRY_RUN 模式下该项目已有待处理任务，无法重复提交' }
  assert.equal(isDryRunGateMessage(error.message), false)
  assert.equal(classifyGenerationFailure(error, 'image').state, 'conflict')
})

test('正文明确包含门禁信息（[DRY_RUN] 已拦截…）→ dry_run', () => {
  const gateMessage =
    '[DRY_RUN] 已拦截「大模型」出口，未发起任何真实请求：POST /api/v1/script-processing/extract 会真实调用大模型（按 token 计费）。要放开请显式设置 JELLYFISH_DRY_RUN=0 且 JELLYFISH_REAL_LLM_CONFIRMED=1。'
  assert.equal(isDryRunGateMessage(gateMessage), true)
  assert.equal(classifyGenerationFailure({ status: 409, message: gateMessage }, 'llm').state, 'dry_run')
})

test('被生成客户端包成 Generic Error 的门禁正文也能识别', () => {
  const message = `Generic Error: status: 409; status text: Conflict; body: {"code":409,"message":"[DRY_RUN] 已拦截「大模型」出口，未发起任何真实请求：POST /api/v1/script-processing/extract 会真实调用大模型（按 token 计费）。要放开请显式设置 JELLYFISH_DRY_RUN=0 且 JELLYFISH_REAL_LLM_CONFIRMED=1。","data":null,"meta":null}`
  assert.equal(isDryRunGateMessage(message), true)
  const failure = classifyGenerationFailure({ status: 409, message }, 'llm')
  assert.equal(failure.state, 'dry_run')
  // 展示的是后端原文，而不是裸 Generic Error
  assert.match(failure.reason, /^\[DRY_RUN\] 已拦截/)
  assert.doesNotMatch(failure.reason, /Generic Error/)
})

test('非 409 的错误按状态码分类', () => {
  assert.equal(classifyGenerationFailure({ status: 422, message: '参数不合法' }, 'image').state, 'missing_params')
  assert.equal(classifyGenerationFailure({ status: 400, message: 'ratio is required' }, 'video').state, 'missing_params')
  assert.equal(classifyGenerationFailure({ status: 404, message: 'Shot not found' }, 'video').state, 'service_error')
  assert.equal(classifyGenerationFailure({ status: 502, message: 'upstream failed' }, 'image').state, 'service_error')
  assert.equal(classifyGenerationFailure(new Error('Failed to fetch'), 'image').state, 'service_error')
})

/* ------------------------------------------------- 文案清洗 */

test('sanitizeErrorMessage 从裸 Generic Error 里取回后端人话', () => {
  const raw = 'Generic Error: status: 409; status text: Conflict; body: {"code":409,"message":"章节已存在","data":null,"meta":null}'
  assert.equal(sanitizeErrorMessage(raw), '章节已存在')
})

test('body 不是完整 JSON 时不二次加工，原样返回', () => {
  const raw = 'Generic Error: status: 500; body: {truncated'
  assert.equal(sanitizeErrorMessage(raw), raw)
})

test('failureText 同时带标题与真实原因', () => {
  const failure = classifyGenerationFailure({ status: 409, message: '章节已存在' }, 'llm')
  assert.match(`${failure.title}：${failure.reason}`, /业务冲突.*章节已存在/)
})
