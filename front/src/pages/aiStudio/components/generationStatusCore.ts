/**
 * 生成状态口径（纯逻辑，不依赖 React，可直接跑单元测试）。
 *
 * 本文件只回答两个问题：
 *   1. 现在这个出口能不能真实调用？（门禁 + 模型配置，**分开判断**）
 *   2. 一次失败到底属于哪一类？（五态 + 业务冲突）
 *
 * 两条硬约束（来自收口要求）：
 *   A. **不得因为 DRY_RUN 开启就显示「能力已配置」。**
 *      模型配置与门禁是两件独立的事：模型为空一律先说「模型未配置」；
 *      只有「模型确实已配置」且 DRY_RUN 开着，才说「模型已配置，当前被演练门禁阻止」。
 *   B. **不能把所有 HTTP 409 都当成 DRY_RUN。**
 *      只有后端错误码为 `paid_outlet_blocked`，或错误正文明确包含 DRY_RUN 门禁信息时才算门禁；
 *      其余 409 是业务冲突，必须显示后端真实原因。
 */

// 阶段 B ④：主区文案统一过三级管道（去 ID → 去内部术语 → 业务化改写）
import { toUserFacingText } from './userFacingMessage.ts'

export type GenerationOutlet = 'llm' | 'image' | 'video'

export type GenerationGateState =
  /** 已配置且未被门禁阻止：可以真实调用 */
  | 'ready'
  /** 模型已配置，但被 DRY_RUN 演练门禁阻止 */
  | 'dry_run'
  /** 该出口的默认模型没配置 */
  | 'not_configured'
  /** 配置状态无法确认（读不到模型表 / 默认模型 id 查不到 / 类别或供应商对不上） */
  | 'unknown'
  | 'missing_params'
  /** 业务冲突（例如 409 但不是门禁） */
  | 'conflict'
  | 'service_error'
  | 'running'
  | 'loading'

export type GenerationGateTone = 'success' | 'warning' | 'error' | 'info'

/** 单个出口的模型配置判定结果。 */
export type ModelConfigState = 'configured' | 'missing' | 'unknown'

export type ModelConfigInfo = {
  state: ModelConfigState
  /** 已配置时的展示名（model.name），否则为空 */
  modelName: string
  /** 判定依据 / 无法确认的原因，直接面向用户 */
  reason: string
}

export type GenerationGateInfo = {
  state: GenerationGateState
  tone: GenerationGateTone
  /** 一句话状态，显示在按钮上方 */
  label: string
  /** 为什么、怎么放开 */
  description: string
  /**
   * **技术详情层**内容（审计 §2.1 第三层）：模型名 / 守卫原文 / 环境变量名 / HTTP 状态码。
   *
   * 主区只放业务结论；这些原文由 `GenerationGateBanner` 渲染在**默认收起**的
   * 「技术详情」里。这样 §4.4「已就绪：图片模型已配置」与 §6.2「原始模型名进技术详情」
   * 两条口径能同时满足。
   */
  technicalDetail?: string
}

export type GenerationGateSnapshot = {
  loading: boolean
  /** 后台是否处于 DRY_RUN（null = 还没取到） */
  dryRun: boolean | null
  /** 后端给的守卫原文，例如「DRY_RUN=开（JELLYFISH_DRY_RUN，未发起真实调用）」 */
  guardText: string
  guardEnv: string
  confirmEnv: string
  /** 三个出口各自的模型配置判定 */
  models: Record<GenerationOutlet, ModelConfigInfo>
  /** 取状态本身失败时的原文（不得把失败伪装成「一切正常」） */
  error: string
  /** 重新读取门禁与模型配置 */
  reload: () => void
}

export type GenerationFailure = {
  state: Exclude<GenerationGateState, 'running' | 'loading'>
  tone: GenerationGateTone
  title: string
  reason: string
}

export const OUTLET_LABEL: Record<GenerationOutlet, string> = {
  llm: '文本模型',
  image: '图片模型',
  video: '视频模型',
}

export const FALLBACK_GUARD_ENV = 'JELLYFISH_DRY_RUN'
export const FALLBACK_CONFIRM_ENV = 'JELLYFISH_REAL_LLM_CONFIRMED'

/** 后端门禁的机器可读错误码（`_guard_blocked_envelope`）。 */
export const PAID_OUTLET_BLOCKED_CODE = 'paid_outlet_blocked'

/* ------------------------------------------------------------------ 描述 */

export function describeGenerationGate(
  snapshot: Pick<GenerationGateSnapshot, 'loading' | 'dryRun' | 'guardText' | 'guardEnv' | 'confirmEnv' | 'models' | 'error'>,
  outlet: GenerationOutlet,
  options?: { running?: boolean; runningText?: string },
): GenerationGateInfo {
  const openHint = `要真实调用，需显式设置 ${snapshot.guardEnv || FALLBACK_GUARD_ENV}=0 且 ${
    snapshot.confirmEnv || FALLBACK_CONFIRM_ENV
  }=1。`
  const outletLabel = OUTLET_LABEL[outlet]

  if (options?.running) {
    return {
      state: 'running',
      tone: 'info',
      label: options.runningText ?? '正在处理…',
      description: '请求已发出，等待本次生成完成；请勿关闭页面。',
    }
  }

  if (snapshot.loading) {
    return {
      state: 'loading',
      tone: 'info',
      label: '正在读取生成条件…',
      description: '读取完成后会显示「还没配置 / 已配置 / 演练模式已开启 / 状态无法确认」。',
    }
  }

  if (snapshot.error) {
    return {
      state: 'unknown',
      tone: 'error',
      label: '生成条件状态暂时无法确认',
      description: '没能读到当前的生成条件，请稍后重试。',
      technicalDetail: `读取状态失败：${snapshot.error}`,
    }
  }

  const model = snapshot.models[outlet]

  // 顺序很重要：先讲模型配置，再讲门禁。
  // 否则「DRY_RUN 开着」会把「模型其实没配」掩盖成「能力已配置」。
  if (model.state === 'missing') {
    return {
      state: 'not_configured',
      tone: 'error',
      label: `${outletLabel}还没配置`,
      description: `请先到「模型管理」指定默认${outletLabel}。${
        snapshot.dryRun ? '另外，后台当前是演练模式。' : ''
      }`,
      technicalDetail: `${model.reason}${snapshot.dryRun ? `；${openHint}` : ''}`,
    }
  }

  if (model.state === 'unknown') {
    return {
      state: 'unknown',
      tone: 'warning',
      label: `${outletLabel}配置状态无法确认`,
      description: `确认之前不把这个出口当成「已配置」。${
        snapshot.dryRun ? '另外，后台当前是演练模式。' : ''
      }`,
      technicalDetail: `${model.reason}${snapshot.dryRun ? `；${openHint}` : ''}`,
    }
  }

  if (snapshot.dryRun) {
    return {
      state: 'dry_run',
      tone: 'warning',
      label: `${outletLabel}已配置，当前是演练模式`,
      description: '演练模式下不会发起真实请求，也不会产生费用。',
      technicalDetail: `${snapshot.guardText || '演练开关=开'}；已配置${outletLabel}：${model.modelName}。${openHint}`,
    }
  }

  return {
    state: 'ready',
    tone: 'success',
    label: `已就绪：${outletLabel}已经配置好`,
    description: '本操作会发起真实调用，并产生费用。',
    technicalDetail: `已配置${outletLabel}：${model.modelName}`,
  }
}

/* ------------------------------------------------------------------ 错误分类 */

const DRY_RUN_ENV_HINT = 'JELLYFISH_DRY_RUN'

/**
 * 错误正文是否**明确**包含 DRY_RUN 门禁信息。
 *
 * 只看到 "DRY_RUN" 三个字母不算——必须同时出现「拦截」语义或门禁开关变量名，
 * 避免把普通业务文案里的 DRY_RUN 字样误判成门禁。
 */
export function isDryRunGateMessage(text: string): boolean {
  const value = String(text ?? '')
  if (!/DRY_RUN/i.test(value)) return false
  return /拦截/.test(value) || value.includes(DRY_RUN_ENV_HINT)
}

/** 把消息里夹带的「body: {...}」取出来（生成客户端会这么拼 message）。 */
function parseBodyFromMessage(message: string): Record<string, unknown> | null {
  const index = message.indexOf('body:')
  if (index < 0) return null
  try {
    return JSON.parse(message.slice(index + 'body:'.length).trim()) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * 从错误对象里取后端错误码。
 *
 * 依次尝试：结构化异常的字段 → 生成客户端的 `body` → 手写请求的 `payload`
 * → 从 message 里内嵌的 body JSON 兜底。
 */
type ErrorEnvelopeLike = {
  code?: unknown
  meta?: { error?: { code?: unknown } } | null
}

type ErrorWithPayload = {
  errorCode?: unknown
  status?: unknown
  /** 生成客户端（自动产物）把解析后的响应体挂在 `body` */
  body?: ErrorEnvelopeLike | null
  /** 手写请求层（llmPipelineApi）把它挂在 `payload` */
  payload?: ErrorEnvelopeLike | null
}

export function readErrorCode(error: unknown): string {
  const wrapped = (error ?? {}) as ErrorWithPayload
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  const parsed = parseBodyFromMessage(message)
  const candidates: unknown[] = [
    wrapped.errorCode,
    wrapped.body?.meta?.error?.code,
    wrapped.body?.code,
    wrapped.payload?.meta?.error?.code,
    wrapped.payload?.code,
    parsed?.meta && (parsed.meta as { error?: { code?: unknown } }).error?.code,
    parsed?.code,
  ]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return ''
}

function readStatus(error: unknown): number | null {
  const value = (error as { status?: unknown })?.status
  return typeof value === 'number' ? value : null
}

/**
 * 把生成客户端吐出来的「Generic Error: status: 409; … body: {…}」还原成人话。
 *
 * 生成目录是自动产物（不手改），请求层失败时会拼出含原始 JSON body 的 message；
 * 这里尽量取回后端信封的 message（后端一直写人话）。
 */
export function sanitizeErrorMessage(raw: string): string {
  const text = String(raw ?? '').trim()
  if (!text) return ''
  const parsed = parseBodyFromMessage(text)
  if (parsed) {
    const message = parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim()
    const detail = parsed.detail
    if (typeof detail === 'string' && detail.trim()) return detail.trim()
  }
  return text
}

function readMessage(error: unknown): string {
  if (error instanceof Error) return sanitizeErrorMessage(error.message)
  if (typeof error === 'string') return sanitizeErrorMessage(error)
  // 非 Error 对象也常带 message（例如测试替身、被 structuredClone 过的异常），
  // 优先取它，避免把整个对象 JSON 化后当成错误文案展示。
  const plainMessage = (error as { message?: unknown })?.message
  if (typeof plainMessage === 'string' && plainMessage.trim()) return sanitizeErrorMessage(plainMessage)
  try {
    return sanitizeErrorMessage(JSON.stringify(error))
  } catch {
    return String(error)
  }
}

/**
 * 失败 → 统一状态。
 *
 * 关键修复：**不再把所有 409 都当成 DRY_RUN**。
 * 判定顺序：
 *   1. 门禁（错误码 paid_outlet_blocked，或正文明确包含 DRY_RUN 门禁信息）
 *   2. 其余 409 → `conflict`（业务冲突，显示后端真实原因）
 *   3. 400/422 → 参数缺失；404 → 接口未接通/资源不存在；5xx/无状态 → 服务错误
 */
export function classifyGenerationFailure(error: unknown, outlet: GenerationOutlet = 'image'): GenerationFailure {
  const message = readMessage(error) || '未知错误'
  const status = readStatus(error)
  const code = readErrorCode(error)
  const outletLabel = OUTLET_LABEL[outlet]

  if (code === PAID_OUTLET_BLOCKED_CODE || isDryRunGateMessage(message)) {
    return {
      state: 'dry_run',
      tone: 'warning',
      title: '当前是演练模式：没有发起真实请求',
      reason: message,
    }
  }
  if (status === 409) {
    return {
      state: 'conflict',
      tone: 'error',
      title: '业务冲突，请检查是否重复提交（原始状态码见「技术详情」）',
      reason: message,
    }
  }
  if (status === 400 || status === 422) {
    return { state: 'missing_params', tone: 'error', title: '参数缺失或不合法', reason: message }
  }
  if (status === 404) {
    return { state: 'service_error', tone: 'error', title: '接口未接通或目标资源不存在', reason: message }
  }
  if (typeof status === 'number' && status >= 500) {
    return { state: 'service_error', tone: 'error', title: '服务错误', reason: message }
  }
  if (/模型|model|model_id|未配置/i.test(message)) {
    return { state: 'not_configured', tone: 'error', title: `${outletLabel}未配置`, reason: message }
  }
  if (status === null) {
    return { state: 'service_error', tone: 'error', title: '请求未送达服务（网络或接口未接通）', reason: message }
  }
  return { state: 'service_error', tone: 'error', title: '请求失败，请稍后重试（原始状态码见「技术详情」）', reason: message }
}

/**
 * 失败结果的**单行主区文案**：中文标题 + 业务化后的原因。
 *
 * 审计 §7.1-5 把这里列为要「先改管道」的四处之一：`failureText` 的调用点有 6+ 个
 * （`ChapterStudio.tsx:4545`、`AssetEditPageBase.tsx:814`、`ChaptersTab.tsx:209`、
 * `AssetProductionArea.tsx:1569/1633` 等），改这一处全部受益。
 *
 * 注意：`failure.reason` 本身**保持原样**（它是技术详情层的载体）；
 * 只有面向用户的这一行过三级管道，避免把后端原文 + `HTTP xxx` 一起弹给用户。
 */
export function failureText(failure: GenerationFailure): string {
  return `${failure.title}：${toUserFacingText(failure.reason, '请稍后重试，或展开「技术详情」查看原始信息')}`
}
