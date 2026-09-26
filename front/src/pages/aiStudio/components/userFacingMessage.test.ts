/**
 * 统一 message 包装层 + 业务化改写层的回归测试（阶段 B ①）。
 *
 * 覆盖面（用户点名）：
 *   - 三级顺序固定：`maskInternalIds` → `sanitizeUserText` → `humanizeBackendMessage` → 中文兜底；
 *   - `humanizeBackendMessage` 至少覆盖审计文档点名的几条（§5.5-G、§4.3 帧 / 音频 / 准备度）；
 *   - **主区只出中文结论**，原文只进 `detail`（供默认收起的「技术详情」用）。
 *
 * 这里用的输入都是**后端源码里的真实字符串**（`video_submit.py` /
 * `shot_video_readiness.py` / `files.py`），不是编出来的样例。
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  USER_FACING_FALLBACK,
  buildUserFacingMessage,
  clearTechnicalDetails,
  humanizeBackendMessage,
  readTechnicalDetails,
  rememberTechnicalDetail,
  setUserMessageNotifier,
  showUserError,
  showUserWarning,
  toUserFacingText,
} from './userFacingMessage.ts'

/** 主区禁词（与 `userFacingStatus.ts` 的 FORBIDDEN_INTERNAL_TERMS 同源口径）。 */
const MAIN_SCREEN_BANNED: readonly string[] = [
  'file_id',
  'storage_key',
  'task_id',
  'service_task_id',
  'source_task_id',
  'asset_id',
  'shot_id',
  'chapter_id',
  'project_id',
  'provider_id',
  'oss_url',
  '供应商',
  '槽位',
  '门禁',
  'DRY_RUN',
  'JELLYFISH_',
  '接口',
  'partial_failed',
  'seedance',
  'apimart',
]

/**
 * ⚠️ 「（内部 ID 见「技术详情」）」**不在**禁词表里。
 *
 * 它是 `maskInternalIds` 设计出来的**指路文案**，审计文档把
 * `ShotAudioBindingSection.tsx:344` 的「已绑定（内部 ID 见工作区「技术详情」）」
 * 明确列为**正向参考 / 目标口径**（§4.6 合规对照）。所以主区出现这一句是对的，
 * 不该被当成泄漏 —— 但必须**逐字**是这个形态，不许是别的说法。
 */

/** 英文枚举原值 / UUID 形态残留扫描。 */
const LEAK_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: 'UUID', pattern: /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i },
  { name: '接口路径', pattern: /\/api\/v1|\/studio\// },
  { name: '本机地址', pattern: /localhost|127\.0\.0\.1|192\.168\./ },
  { name: '环境变量', pattern: /JELLYFISH_[A-Z_]+/ },
  { name: '英文枚举连写', pattern: /(?<![A-Za-z0-9_])[a-z]+(?:_[a-z]+){1,}(?![A-Za-z0-9_])/ },
]

function assertCleanMainText(text: string, context: string): void {
  MAIN_SCREEN_BANNED.forEach((term) => {
    assert.ok(
      !text.toLowerCase().includes(term.toLowerCase()),
      `${context}：主区文案出现了禁词「${term}」→「${text}」`,
    )
  })
  LEAK_PATTERNS.forEach(({ name, pattern }) => {
    assert.ok(!pattern.test(text), `${context}：主区文案出现了「${name}」→「${text}」`)
  })
  // 指路文案只允许逐字是这个形态（不许换别的说法）
  const placeholderCount = text.split('（内部 ID 见「技术详情」）').length - 1
  const internalMentionCount = text.split('内部 ID').length - 1
  assert.equal(
    internalMentionCount,
    placeholderCount,
    `${context}：出现了非标准形态的「内部 ID」说法 →「${text}」`,
  )
}

/* ------------------------------------------- §5.5-G：帧槽位缺文件（核心一条） */

test('§5.5-G：后端「该帧槽位没有 file_id」被整句业务化，不留「槽位」禁词', () => {
  const raw = '该帧槽位没有 file_id：请先上传或生成该帧。'
  // 掩码后的形态也必须能改写（三级顺序里 humanize 拿到的是掩码后的文本）
  const maskedForm = '该帧槽位没有 文件编号：请先上传或生成该帧。'
  assert.equal(humanizeBackendMessage(raw), '这一帧还没有文件：请先上传或生成该帧')
  assert.equal(humanizeBackendMessage(maskedForm), '这一帧还没有文件：请先上传或生成该帧')
  assert.equal(toUserFacingText(raw, '生成失败'), '这一帧还没有文件：请先上传或生成该帧')
  assertCleanMainText(toUserFacingText(raw, '生成失败'), '§5.5-G')
  assert.ok(!humanizeBackendMessage(raw).includes('槽位'), '「槽位」必须被改写掉')
})

test('§5.5-G 变体：files.py 的「槽位存在但没有 file_id」也一并改写', () => {
  const raw = '该帧还没有文件：槽位存在但没有 file_id（请在「关键帧与参考图」生成或上传该帧）。'
  const out = toUserFacingText(raw, '生成失败')
  assertCleanMainText(out, '§5.5-G 变体')
  assert.match(out, /这一帧还没有文件/)
})

/* ------------------------------------------------------- §4.3 帧相关 */

test('§4.3：缺参考帧提示里的帧 code 与参考模式都中文化', () => {
  const raw =
    "当前参考模式「first_last」还缺这些帧：['first']。请到「关键帧与参考图」补齐，或切换到模型支持的其他参考模式（如 key / text_only）。"
  const out = toUserFacingText(raw, '生成失败')
  assertCleanMainText(out, '§4.3 缺帧')
  assert.ok(!out.includes("'first'"), '帧 code 不能留英文')
  assert.ok(!out.includes('first_last'), '参考模式原值不能留英文')
  assert.ok(!out.includes('text_only'), '参考模式原值不能留英文')
  assert.match(out, /参考帧/)
})

test('§4.3：prompt_board 的「缺少参考帧：first（该帧槽位还没有文件）」', () => {
  const out = toUserFacingText('缺少参考帧：first（该帧槽位还没有文件）', '生成失败')
  assertCleanMainText(out, '§4.3 缺帧变体')
  assert.ok(!out.includes('first'), '帧 code 不能留英文')
})

test('§4.3：参考帧「first」不可用 + 后端原因，两个泄漏点一起收', () => {
  const raw = '参考帧「first」不可用：该帧槽位没有 file_id：请先上传或生成该帧。'
  const out = toUserFacingText(raw, '生成失败')
  assertCleanMainText(out, '§4.3 参考帧不可用')
  assert.ok(!out.includes('first'))
})

/* ------------------------------------------------------- §4.3 / §5.5-F 音频 */

test('§5.5-F：音频可用性兜底串里的「供应商」被业务化', () => {
  const raw = '供应商取不到这条声音，本次生成请求不会携带它。'
  assert.equal(humanizeBackendMessage(raw), '这条声音这次送不出去：生成服务取不到它')
  assertCleanMainText(toUserFacingText(raw, '生成失败'), '§5.5-F')
})

test('§5.5-F：后端 excluded_reason 原文（含 file_id / storage_key / asset://）不会上主区', () => {
  const raw =
    'excluded_reason: storage_key=files/audio/1ebace78-b083-49fe-a86b-d17c524e501d.mp3 是本机地址，供应商取不到这条声音。'
  const out = toUserFacingText(raw, '这条声音这次送不出去')
  assertCleanMainText(out, '§5.5-F excluded_reason')
})

test('§4.3：参考帧供应商无法访问长句 → 业务化口径', () => {
  const raw =
    '参考帧供应商无法访问：帧文件是本机/相对地址，只能解析成本机 data URL，而当前供应商只接受公网地址。建议把帧图片换成公网地址后重新设为该帧，或改用纯文本模式。'
  const out = toUserFacingText(raw, '参考图取不到')
  assertCleanMainText(out, '§4.3 参考帧长句')
  assert.match(out, /取不到/)
})

test('§4.3：shotReadiness 的「首帧供应商取不到」也收干净', () => {
  const out = toUserFacingText('首帧供应商取不到', '生成失败')
  assertCleanMainText(out, '§4.3 blockedFrames')
  assert.ok(!out.includes('供应商'))
})

/* ------------------------------------------------- §4.3 视频准备度相关 */

test('§4.3：视频模型 / 生成服务准备度提示全部业务化', () => {
  const cases: Array<[string, RegExp]> = [
    ['未配置默认视频模型', /还没有配置视频模型/],
    ['未配置默认视频模型，无法检查供应商', /还没有配置视频模型/],
    ['默认视频模型不存在：9f3c1a2b-0000-4000-8000-000000000001', /已失效/],
    ['默认模型不是视频类别：9f3c1a2b-0000-4000-8000-000000000001', /不是视频模型/],
    ['视频模型供应商不存在：9f3c1a2b-0000-4000-8000-000000000001', /生成服务已失效/],
    ['视频模型供应商缺少 api_key：9f3c1a2b-0000-4000-8000-000000000001', /访问密钥/],
    ['未知参考模式：whatever', /参考方式无法识别/],
    ['视频提示词为空', /还没有可用的提示词/],
  ]
  cases.forEach(([raw, expected]) => {
    const out = toUserFacingText(raw, '生成失败')
    assertCleanMainText(out, `准备度「${raw}」`)
    assert.match(out, expected, `「${raw}」→「${out}」不符合预期`)
  })
})

test('§4.3：已经是中文人话的准备度提示原样保留（不过度改写）', () => {
  const raw = '参考帧已就绪'
  assert.equal(humanizeBackendMessage(raw), raw)
  assert.equal(toUserFacingText(raw, '生成失败'), raw)
})

/* --------------------------------------------- 模式 5：模型 / 供应商名 */

test('模式 5：模型与供应商名相关的后端警告不会把原名带上主区', () => {
  const raws = [
    '模型表里没有短视频模型「seedance-9.9」，已退回默认视频模型「seedance-2.0-mini」；请确认 JELLYFISH_VIDEO_MODEL 或模型配置。',
    '实际使用的模型「gpt-image-2」与固定策略「seedance-2.0-mini」不一致，请确认。',
    "provider「apimart」不在既有适配器白名单 ['apimart'] 内，真实提交会在任务分发阶段失败。",
  ]
  raws.forEach((raw) => {
    const out = toUserFacingText(raw, '生成失败')
    assertCleanMainText(out, `模式 5「${raw.slice(0, 16)}…」`)
    ;['seedance', 'gpt-image-2', 'apimart', 'JELLYFISH_'].forEach((token) => {
      assert.ok(!out.toLowerCase().includes(token.toLowerCase()), `「${out}」仍含「${token}」`)
    })
  })
})

/* --------------------------------------------------------------- 兜底与边界 */

test('三步都过不干净 → 用中文兜底，绝不把原文漏给用户', () => {
  const nasty = 'JELLYFISH_DRY_RUN=0 且 provider_id=9f3c1a2b-0000-4000-8000-000000000001 未确认'
  const out = toUserFacingText(nasty, '这一步没有成功')
  assert.equal(out, '这一步没有成功')
  assertCleanMainText(out, '兜底')
  // 不传 fallback 时用默认兜底
  assert.equal(toUserFacingText(nasty), USER_FACING_FALLBACK)
})

test('空输入 / null / Error 对象都走兜底，不返回空串', () => {
  assert.equal(toUserFacingText('', '兜底句'), '兜底句')
  assert.equal(toUserFacingText('   ', '兜底句'), '兜底句')
  assert.equal(toUserFacingText(null, '兜底句'), '兜底句')
  assert.equal(toUserFacingText(undefined, '兜底句'), '兜底句')
  assert.equal(toUserFacingText(new Error(''), '兜底句'), '兜底句')
})

test('已经是干净中文的文本原样返回（不过度改写）', () => {
  const raw = '这一镜已经具备生成条件：提示词与参考帧齐全'
  assert.equal(toUserFacingText(raw, '兜底句'), raw)
})

test('humanizeBackendMessage 不误伤正常业务文案', () => {
  const cleanSamples = ['画幅 16:9、时长 5 秒', '本镜已具备生成条件：提示词与参考帧齐全', '已复制提交版本', '待确认候选']
  cleanSamples.forEach((raw) => {
    assert.equal(humanizeBackendMessage(raw), raw, `不该被改写：${raw}`)
  })
})

/* --------------------------------------------------------- 两层输出与日志 */

test('buildUserFacingMessage 主区只给中文结论，原文只进 detail', () => {
  const raw =
    '该帧槽位没有 file_id：请先上传或生成该帧。原始报错 9f3c1a2b-0000-4000-8000-000000000001'
  const { title, detail } = buildUserFacingMessage(raw, '生成失败')
  assertCleanMainText(title, 'buildUserFacingMessage.title')
  // detail 是给技术详情看的：允许保留掩码后的原始措辞，但不得再有 UUID
  assert.ok(!detail.includes('9f3c1a2b-0000-4000-8000-000000000001'), 'detail 也必须先去掉内部 ID')
})

test('技术详情日志：只保留最近 20 条，字段齐全', () => {
  clearTechnicalDetails()
  assert.deepEqual(readTechnicalDetails(), [])
  for (let index = 0; index < 25; index += 1) {
    rememberTechnicalDetail({ title: `第 ${index} 条`, detail: `原文 ${index}`, scope: '测试' })
  }
  const log = readTechnicalDetails()
  assert.equal(log.length, 20, '超过上限要截断，避免内存长期挂着')
  assert.equal(log[0].title, '第 24 条', '最新在前')
  assert.equal(log[0].scope, '测试')
  assert.ok(log.every((entry) => entry.detail && entry.at), '每条都要有 detail 与时间')
  clearTechnicalDetails()
})

/* --------------------------------------------------------------- toast 出口 */

test('showUserError：主区只收到中文结论，原文进技术详情', async () => {
  clearTechnicalDetails()
  const calls: Array<{ kind: string; title: string }> = []
  setUserMessageNotifier((kind, title) => {
    calls.push({ kind, title })
  })
  try {
    const result = await showUserError(
      '该帧槽位没有 file_id：请先上传或生成该帧。storage_key=files/a.png',
      '生成视频失败',
      '生成视频',
    )
    assert.equal(calls.length, 1, '应当只弹一条提示')
    assert.equal(calls[0].kind, 'error')
    assertCleanMainText(calls[0].title, 'showUserError 主区')
    assert.equal(result.title, calls[0].title, '返回值与主区文案一致')
    assert.ok(result.detail.length > 0, '原文要留在 detail 里')
    const log = readTechnicalDetails()
    assert.equal(log.length, 1)
    assert.equal(log[0].scope, '生成视频')
    assert.equal(log[0].detail, result.detail)
  } finally {
    setUserMessageNotifier(null)
    clearTechnicalDetails()
  }
})

test('showUserWarning：同样只出中文结论，且弹的是 warning', async () => {
  clearTechnicalDetails()
  const calls: Array<{ kind: string; title: string }> = []
  setUserMessageNotifier((kind, title) => {
    calls.push({ kind, title })
  })
  try {
    await showUserWarning('供应商取不到这条声音，本次生成请求不会携带它。', '声音这次用不上')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].kind, 'warning')
    assertCleanMainText(calls[0].title, 'showUserWarning 主区')
  } finally {
    setUserMessageNotifier(null)
    clearTechnicalDetails()
  }
})

test('弹提示失败不影响业务逻辑（无 DOM 环境也不抛）', async () => {
  setUserMessageNotifier(() => {
    throw new Error('notifier exploded')
  })
  try {
    const result = await showUserError('JELLYFISH_DRY_RUN=0 未确认', '兜底句')
    assert.equal(result.title, '兜底句')
  } finally {
    setUserMessageNotifier(null)
    clearTechnicalDetails()
  }
})
