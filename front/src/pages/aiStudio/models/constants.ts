import type { ModelCategoryKey } from '../../../services/generated/models/ModelCategoryKey'
import type { ProviderStatus } from '../../../services/generated/models/ProviderStatus'

export const MODEL_CATEGORIES: { key: ModelCategoryKey; label: string; color: string }[] = [
  { key: 'text', label: '文本生成', color: 'blue' },
  { key: 'image', label: '图片生成', color: 'orange' },
  { key: 'video', label: '视频生成', color: 'purple' },
]

export const categoryLabelMap = Object.fromEntries(MODEL_CATEGORIES.map((c) => [c.key, c.label]))
export const categoryColorMap = Object.fromEntries(MODEL_CATEGORIES.map((c) => [c.key, c.color]))

export const PROVIDER_STATUS_MAP: Record<ProviderStatus, { text: string; color: string }> = {
  active: { text: '活跃', color: 'green' },
  testing: { text: '测试中', color: 'orange' },
  disabled: { text: '禁用', color: 'default' },
}

export const SORT_OPTIONS = [
  { value: 'updated', label: '最近更新' },
  { value: 'name', label: '名称' },
  { value: 'category', label: '类别' },
]

/* ---------------------------------------------------- 接口地址的显示口径 */

/** 地址格式不合法时的统一文案（审计 §4.7：**不许**把原地址前 20 字符截出来）。 */
export const INVALID_ADDRESS_TEXT = '（地址格式不合法）'

/** 地址只在开发机 / 内网可达时的标注（审计 §4.7 模式 5 第 3 条）。 */
export const LOCAL_ONLY_ADDRESS_NOTE = '（仅本机可达，外部服务取不到）'

/**
 * 这个地址是不是**只在本机 / 内网可达**。
 *
 * 用途：本机地址填进供应商配置后，外部生成服务取不到它 —— 审计 §4.7 要求
 * 「额外标注「仅本机可达（外部服务取不到）」，别让人以为能用于生产」。
 *
 * 判定只看主机名（不看端口 / 路径），覆盖：
 * `localhost` / `127.0.0.1` / `::1` / `*.local` / `192.168.*` / `10.*` / `172.16-31.*`。
 */
export function isLocalOnlyAddress(url: string): boolean {
  const host = hostOf(url)
  if (!host) return false
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.startsWith('192.168.') ||
    host.startsWith('10.') ||
    /^172\.(?:1[6-9]|2\d|3[01])\./.test(host)
  )
}

function hostOf(url: string): string {
  try {
    return new URL(String(url ?? '').trim()).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * 地址的**掩码**形态（可见文本用）。
 *
 * 为什么必须有：本页是供应商配置页，地址属本页核心功能（审计 §4.7 允许保留），
 * 但对用户只给「够辨认」的一段 —— 保留协议 + 末尾 6 个字符 + 路径。
 *
 * ⚠️ 解析失败时**不许**把原文截一段出来（审计 §4.7-555 点名了 `url.slice(0, 20) + '***'`）。
 */
export function maskUrl(url: string): string {
  const raw = String(url ?? '').trim()
  if (!raw) return '—'
  let parsed: URL
  try {
    parsed = new URL(raw)
  } catch {
    return INVALID_ADDRESS_TEXT
  }
  if (!parsed.hostname) return INVALID_ADDRESS_TEXT
  return `${parsed.protocol}//***${parsed.host.slice(-6)}${parsed.pathname}`
}

/**
 * 地址的**主区显示口径**：可见文本与悬停提示**用同一个值**。
 *
 * 审计 §5.5-D 实测的缺陷是「可见文本掩码了、hover 的 `title` 却给全文」——
 * 掩码等于白做。所以 `title` / Tooltip 一律传本函数的返回值，不要再传原始地址。
 * 非公网地址额外标注「仅本机可达，外部服务取不到」。
 */
export function describeAddress(url: string): string {
  const masked = maskUrl(url)
  if (masked === '—' || masked === INVALID_ADDRESS_TEXT) return masked
  return isLocalOnlyAddress(url) ? `${masked}${LOCAL_ONLY_ADDRESS_NOTE}` : masked
}

/* ------------------------------------------------------- 供应商 / 模型描述 */

/** 描述里含实现细节时，列表里统一的替代说法（全文进「技术详情」）。 */
export const CUSTOM_INTEGRATION_TEXT = '自定义接入'

/**
 * 这段描述是不是**实现细节**（审计 §4.7 模式 4：运行时实测供应商描述字段被写进了
 * `image_service_openai_shim.py`、`/images/generations` 这类实现细节）。
 *
 * 判定形态：仓库文件（`.py` / `.sh` / `.js` / `.ts`）、接口路径（`/v1/` / `/images/`）、
 * 任意 URL、环境变量名、请求方法 + 路径（`POST /…`）。
 * 命中的描述在列表只显示「自定义接入」，**原文进默认收起的「技术详情」**，不删数据。
 */
export function isImplementationDetailText(text: string): boolean {
  const value = String(text ?? '')
  if (!value.trim()) return false
  return (
    /[A-Za-z0-9_-]+\.(?:py|sh|js|ts|json|ya?ml)\b/.test(value) ||
    /\/v1\/|\/images\/generations|\/api\/v1/.test(value) ||
    /https?:\/\//.test(value) ||
    /\bJELLYFISH_[A-Z_]+\b/.test(value) ||
    /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\//.test(value)
  )
}

/** 列表里的描述文案（含实现细节 → 「自定义接入」；空白 → `—`）。 */
export function describeForList(text: string | null | undefined): string {
  const value = String(text ?? '').trim()
  if (!value) return '—'
  return isImplementationDetailText(value) ? CUSTOM_INTEGRATION_TEXT : value
}

/** 服务账号 / 系统预置的创建人显示名（审计 §4.7：`integration` 这类服务账号名映射为「系统」）。 */
export const SYSTEM_CREATED_TEXT = '系统预置'

/**
 * 服务账号名（运维信息，一律显示「系统预置」）。
 *
 * `integration` 是审计 §4.7-551 点名的运行时实测值；
 * `setup` 是同一类（运行时实测：模型列表的「创建人」列显示 `由 setup 创建`，
 * 那是**预置脚本**建的，不是人建的 —— 一起归到「系统预置」）。
 */
const SERVICE_ACCOUNT_NAMES: readonly string[] = [
  'integration',
  'setup',
  'system',
  'service',
  'admin',
  'root',
]

/**
 * 创建人的显示口径。
 *
 * `integration` 这类**服务账号**名是运维信息（运行时实测：创建人列显示 `integration`），
 * 映射为「系统预置」；真人用户名保留，但套上「由 … 创建」的业务句式。
 */
export function describeCreatedBy(createdBy: string | null | undefined): string {
  const value = String(createdBy ?? '').trim()
  if (!value) return SYSTEM_CREATED_TEXT
  if (SERVICE_ACCOUNT_NAMES.includes(value.toLowerCase())) return SYSTEM_CREATED_TEXT
  return `由 ${value} 创建`
}

/** 表格操作列图标按钮公共骨架（覆盖 Ant Design 默认尺寸） */
const TABLE_ACTION_BTN_BASE =
  '!inline-flex !h-7 !w-7 !min-w-7 !cursor-pointer !items-center !justify-center !rounded-md !border !border-solid !p-0 shadow-sm transition-colors'

/** 编辑：主色蓝，默认可辨认为可操作 */
export const TABLE_ACTION_BTN_EDIT_CLASS = `${TABLE_ACTION_BTN_BASE} !border-blue-200 !bg-blue-50 !text-blue-600 hover:!border-blue-400 hover:!bg-blue-100 hover:!text-blue-700 active:!bg-blue-200/60`

/** 测试/运行：琥珀色，与编辑区分 */
export const TABLE_ACTION_BTN_TEST_CLASS = `${TABLE_ACTION_BTN_BASE} !border-amber-200 !bg-amber-50 !text-amber-600 hover:!border-amber-400 hover:!bg-amber-100 hover:!text-amber-700 active:!bg-amber-200/60`

/** 更多：中性灰 */
export const TABLE_ACTION_BTN_MORE_CLASS = `${TABLE_ACTION_BTN_BASE} !border-slate-200 !bg-slate-50 !text-slate-600 hover:!border-slate-300 hover:!bg-slate-100 hover:!text-slate-800 active:!bg-slate-200/70`
