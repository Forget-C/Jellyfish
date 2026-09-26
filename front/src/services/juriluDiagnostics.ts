/**
 * 巨日禄抓取失败的**脱敏诊断**文案（纯函数，可单测）。
 *
 * 为什么单独抽出来（2026-09-20 真实验收踩到）：
 *   第二步 `getStoryboardPage` 三个 scriptId 全部 **HTTP 200**，只是响应里的 records
 *   被 msgpack 编码了、旧解析器没识别 —— 但页面提示写的是
 *   「接口阶段 **getScriptPage**｜HTTP 200」，把失败阶段报错了，看起来像第一步被拒。
 *   这里按诊断里的**真实证据**判断阶段：第一步非 2xx / 没取到 scriptId → getScriptPage；
 *   第一步成功但第二步某条解析 0 条或报错 → getStoryboardPage（并带上第二步自己的状态码）。
 *
 * 铁律：只输出状态码、布尔值、环节名、计数与「是否带凭证」，**绝不回显任何凭证或正文**。
 *
 * 阶段 B 追加口径（审计 §4.7 服务层 537-539）：本诊断最终落在默认收起的「技术详情」里，
 * 但**话术必须换成用户语言** —— 内部函数名（`getScriptPage`）→「脚本接口」、
 * `scriptId` →「脚本编号」、`Cookie` →「登录凭证」、`Authorization` →「授权头」、
 * `编码 / 载荷 / 解析器 / 2xx` → 用户能懂的说法。原始环节名仍由
 * `resolveJuriluFailureStage` 返回（**技术字段**，供分支判断与单测）。
 */

type AnyRecord = Record<string, unknown>

/** 诊断里单条第二步尝试的形状（后端 `storyboard_attempts[i]`）。 */
export interface StoryboardAttemptShape {
  script_id?: unknown
  status?: unknown
  error?: unknown
  parsed_count?: unknown
  payload_shape?: AnyRecord
}

const STAGE_SCRIPT = 'getScriptPage'
const STAGE_STORYBOARD = 'getStoryboardPage'

/**
 * 环节名 → 用户语言（审计 §4.7-537：`接口阶段 getScriptPage` 里的环节名是内部函数名，模式 2）。
 *
 * **只映射已登记的环节；未登记一律给中文兜底「抓取接口」，绝不回显原值**
 * （与 `enumLabels.labelFor` 同一条铁律）。
 */
const STAGE_LABELS: Record<string, string> = {
  [STAGE_SCRIPT]: '脚本接口',
  [STAGE_STORYBOARD]: '分镜接口',
}

/** 未登记环节的中文兜底。 */
const UNKNOWN_STAGE_LABEL = '抓取接口'

/** 把内部环节名换成用户语言；`getScriptPage（未取到脚本编号）` 这类后缀原样保留（它已是中文）。 */
function stageLabel(stage: string): string {
  const raw = String(stage ?? '').trim()
  if (!raw) return UNKNOWN_STAGE_LABEL
  const parenIndex = raw.indexOf('（')
  const base = (parenIndex >= 0 ? raw.slice(0, parenIndex) : raw).trim()
  const suffix = parenIndex >= 0 ? raw.slice(parenIndex) : ''
  return `${STAGE_LABELS[base] ?? UNKNOWN_STAGE_LABEL}${suffix}`
}

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item)).filter((item) => item.trim() !== '')
}

/** 第二步有没有失败（解析 0 条，或接口直接报错）。 */
export function findFailedStoryboardAttempt(diag: AnyRecord): StoryboardAttemptShape | null {
  const attempts = Array.isArray(diag.storyboard_attempts) ? diag.storyboard_attempts : []
  for (const raw of attempts) {
    const attempt = asRecord(raw)
    if (!attempt) continue
    const parsed = asNumber(attempt.parsed_count)
    const hasError = String(attempt.error ?? '').trim() !== ''
    if (hasError || parsed === 0) return attempt as StoryboardAttemptShape
  }
  return null
}

/** 判定失败真正发生在哪一步（拿不到证据时不硬编成第一步）。 */
export function resolveJuriluFailureStage(diag: AnyRecord): { stage: string; status: unknown } {
  const scriptStatus = asNumber(diag.script_status)
  if (scriptStatus !== null && scriptStatus >= 400) {
    return { stage: STAGE_SCRIPT, status: diag.script_status }
  }
  const scriptCount = asNumber(diag.script_records_count)
  if (scriptStatus === null && scriptCount === null) {
    // 第一步根本没跑起来（例如没带凭证就在本地被拦下）
    const stage = String(diag.stage ?? '').trim()
    return { stage: stage || STAGE_SCRIPT, status: scriptStatus }
  }
  if (scriptCount === 0) {
    /* 审计 §4.7-537：`scriptId` 是内部字段名（模式 2）→ 用户语言「脚本编号」。 */
    return { stage: `${STAGE_SCRIPT}（未取到脚本编号）`, status: diag.script_status }
  }
  const failed = findFailedStoryboardAttempt(diag)
  if (failed) return { stage: STAGE_STORYBOARD, status: failed.status }
  return { stage: String(diag.stage ?? '').trim() || STAGE_SCRIPT, status: diag.script_status ?? diag.http_status }
}

/** 第二步「0 条」时说清楚：是接口没给数据，还是给了但我们没解析出来。 */
export function describeStoryboardZeroRecords(attempt: StoryboardAttemptShape | null): string {
  if (!attempt) return ''
  const shape = asRecord(attempt.payload_shape) ?? {}
  const decodeErrors = asStringList(shape.decode_errors)
  const unsupported = asStringList(shape.unsupported_encodings)
  const counts = asRecord(shape.record_counts) ?? {}
  const parsedTotal = Object.values(counts).reduce<number>((sum, value) => sum + (asNumber(value) ?? 0), 0)
  const status = asNumber(attempt.status)

  /* 口径来源：审计 §4.7-538 —— 四条都换成用户能懂的话：
     「编码 / 载荷 / 解析器 / 2xx」是开发术语，用户只需要知道「是不是我账号的问题」。 */
  if (decodeErrors.length) {
    return `接口返回的内容格式我方没能解析（不是你账号的问题）`
  }
  if (unsupported.length) {
    return `接口用了本版本还不支持的内容格式，需要升级后再试`
  }
  if (parsedTotal > 0) {
    return `接口其实返回了 ${parsedTotal} 条记录，但没能整理成分镜（我方处理问题）`
  }
  if (status !== null && status < 300) {
    return '接口调用成功，但这一集确实没有分镜记录（不是账号问题）'
  }
  return ''
}

/** 兼容旧调用名的别名。 */
export const extractJuriluDiagnosticsFromError = (error: unknown): string =>
  extractJuriluDiagnostics(error)

/**
 * 从巨日禄抓取失败里提取**脱敏诊断**。
 * 后端把诊断放在统一信封的 `meta.diagnostics`（不含任何凭证）。
 */
export function extractJuriluDiagnostics(error: unknown): string {
  const diag = asRecord((error as { diagnostics?: unknown } | undefined)?.diagnostics)
  if (!diag) return ''
  const { stage, status } = resolveJuriluFailureStage(diag)
  const parts: string[] = []
  /* 审计 §4.7-537：`接口阶段` 是开发术语（`阶段` ＋ 接口），改「脚本接口 / 分镜接口」。 */
  if (stage) parts.push(`所在环节 ${stageLabel(stage)}`)
  if (status !== undefined && status !== null && `${status}`.trim() !== '') parts.push(`HTTP ${status}`)
  /* 审计 §4.7-539：`Cookie` / `Authorization` 是请求头名（模式 4），改「登录凭证 / 授权头」。 */
  parts.push(`已带登录凭证：${diag.has_cookie ? '是' : '否'}`)
  parts.push(`已附授权头：${diag.has_auth ? '是' : '否'}`)
  const mode = String(diag.auth_header_mode ?? '').trim()
  if (mode) parts.push(`凭证携带方式 ${mode}`)
  if (stage.startsWith(STAGE_STORYBOARD)) {
    const detail = describeStoryboardZeroRecords(findFailedStoryboardAttempt(diag))
    if (detail) parts.push(detail)
  }
  return parts.join('｜')
}
