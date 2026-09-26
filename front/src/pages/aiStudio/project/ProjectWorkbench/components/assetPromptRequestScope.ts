/**
 * 「生成图片提示词」**每一次请求的范围**与"这一项为什么拿不到提示词"的判定（纯逻辑，可 `node --test`）。
 *
 * 为什么单独一个模块（真实事故的根因之一）：
 * 面板是**逐项**生成提示词的（一行 = 一次请求 = 一次计费调用），但请求体里如果只说
 * "这是哪个项目"，后端就会把**整个项目/本章**的资产都装成画像卡当上下文；于是一个
 * **没被勾选**的空壳资产（例如本章只有资料记录的服装）会出现在这次生成的画像集合里，
 * 甚至变成"这次不能保存"的原因。范围必须由调用方**点名**：一次请求只点名这一项。
 *
 * 另有"整体不可用"这一条：后端判定"这一次要的每一项都没有可用于出图的资料"时会拒绝
 * （结构化原因 + 怎么补）。页面必须把这种拒绝**标在那一行上并继续后面的项**，
 * 而不是当成"付费调用失败"把整批停下来 —— 但真正的失败（网络、模型报错）仍然要
 * 立刻停止、不自动重试（真实调用是按次数授权的）。两者在这里用结构化错误码分开。
 */

import { maskInternalIds } from '../../../components/maskInternalIds.ts'

/** 后端"本次要的资产都没有资料"的结构化错误码（见图片提示词生成服务）。 */
export const ASSET_PROFILE_MISSING_CODE = 'asset_profile_missing'

/** 后端"这一项没有资料"的中文标记（后端两种写法都覆盖：有/没有前缀）。 */
const MISSING_PROFILE_MARKERS = ['可用于出图的资料']

export type AssetPromptRequestScope = {
  /** 本次请求**点名**要的那一项（一次请求只允许一项） */
  entityNames: string[]
  /** 资产身份（后端声明了对应字段时才会真的发出去，见 `buildPromptRequestExtras`） */
  assetId?: string
  assetType?: string
}

/**
 * 一次请求只点名**这一行**的资产。
 *
 * 传进来的名字为空（理论上不会发生）时返回空数组：宁可让后端退回"按项目装配"，
 * 也不能凭空塞一个别的名字上去（那会把隔壁资产的资料画到它身上）。
 */
export function buildAssetPromptRequestScope(args: {
  assetName: string
  assetId?: string
  assetType?: string
}): AssetPromptRequestScope {
  const name = String(args.assetName ?? '').trim()
  const assetId = String(args.assetId ?? '').trim()
  return {
    entityNames: name ? [name] : [],
    ...(assetId ? { assetId } : {}),
    ...(String(args.assetType ?? '').trim() ? { assetType: String(args.assetType).trim() } : {}),
  }
}

/**
 * 这一次请求**能生成几项**（= 点名了几项）。
 *
 * 页面用它核对"按钮上的数字"与"实际会发生的调用次数"：`buildAssetPromptRequestScope`
 * 一次只点名一项，所以这个数字永远是 0 或 1，用来做断言与文案。
 */
export function countScopedRequests(scope: AssetPromptRequestScope): number {
  return scope.entityNames.length
}

export type AssetPromptAvailability = {
  /** 这一项是不是"库里没有可用于出图的资料"（是 → 标在那一行、继续后面的项） */
  missingProfile: boolean
  /** 为什么不可用（后端中文原文；读不到就空串，页面不编造） */
  reason: string
  /** 怎么补（后端中文原文；读不到就空串） */
  fix: string
  /** 后端点名的资产（用于核对"标的是不是这一行"） */
  assets: string[]
}

const NO_AVAILABILITY: AssetPromptAvailability = {
  missingProfile: false,
  reason: '',
  fix: '',
  assets: [],
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

function fromRecord(record: Record<string, unknown> | null): AssetPromptAvailability | null {
  if (!record) return null
  const code = String(record.code ?? '').trim()
  /* 审计 §4.5 模式 6（`:86`）：后端 `message` / `detail` / `fix` 是**动态原文**，
     改前原样带出去、由 `describeRowAvailability`（`:158`）直接插进那一行。
     这里先过 `maskInternalIds`（去 UUID / `file_id=` / `*_task_id=` / 内部词汇）。 */
  const message = maskInternalIds(String(record.message ?? record.detail ?? '').trim())
  const fix = maskInternalIds(String(record.fix ?? '').trim())
  const names = Array.isArray(record.assets)
    ? record.assets.map((item) => String(item ?? '').trim())
    : []
  const looksMissing =
    code === ASSET_PROFILE_MISSING_CODE ||
    MISSING_PROFILE_MARKERS.some((marker) => message.includes(marker))
  if (!looksMissing) return null
  return {
    missingProfile: true,
    reason: message,
    fix,
    assets: names.filter((name) => name.length > 0),
  }
}

function onlyMention(text: string): AssetPromptAvailability {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return NO_AVAILABILITY
  if (!MISSING_PROFILE_MARKERS.some((marker) => trimmed.includes(marker))) return NO_AVAILABILITY
  return { missingProfile: true, reason: maskInternalIds(trimmed), fix: '', assets: [] }
}

/** 从一段文字里抠出被拼进去的结构化明细（统一信封会把 `detail` 拼进消息）。 */
function fromText(text: string): AssetPromptAvailability | null {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const start = trimmed.indexOf('{')
  const end = trimmed.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    return fromRecord(parsed) ?? fromRecord(readRecord(parsed.detail))
  } catch {
    // 不是 JSON：交给上层按纯文本判断
    return null
  }
}

/**
 * 从一次失败的请求里读出"这一项没有资料"。
 *
 * 认三种形态（与其它模块读后端结构化中文的口径一致）：
 *   1. 错误对象上直接带结构化明细（`code` / `message` / `fix`）；
 *   2. 结构化明细被拼进了错误消息（统一信封的常见写法）；
 *   3. 嵌套在 `detail` 里的结构化明细。
 * 读不出"没有资料"这个结论时**一律返回 `missingProfile: false`** ——
 * 拿不准就不把它当成"逐项可跳过"，真正的失败照旧立刻停止整批。
 */
export function readAssetPromptAvailabilityError(error: unknown): AssetPromptAvailability {
  if (!error) return NO_AVAILABILITY
  const direct = readRecord(error)
  if (!direct) return fromText(String(error)) ?? onlyMention(String(error))
  // ① 错误对象自己带结构化明细（只有真的带 code / detail 才算"结构化"，
  //    否则任何一个 Error 都会被误当成后端给的结论）
  if (String(direct.code ?? '').trim() || readRecord(direct.detail)) {
    const structured = fromRecord(direct) ?? fromRecord(readRecord(direct.detail))
    if (structured) return structured
  }
  // ② 明细被拼进消息里 → 先抠 JSON，读不出再按纯文本判断
  const text = String(direct.message ?? direct.text ?? '').trim()
  return fromText(text) ?? onlyMention(text)
}

/**
 * 缺资料那一行要说的话（为什么不可用 + 怎么补）。
 *
 * 单独抽出来是为了可单测：这句话必须在**那一行**上说清两件事，
 * 后端没给"怎么补"时就不硬凑（宁可少说，也不编一句没法照做的修法）。
 */
export function describeRowAvailability(name: string, reason: string, fix?: string): string {
  /* 审计 §4.5 模式 6（`:158`）：渲染前统一过 `maskInternalIds` —— 无论调用方
     （出图面板 / 提示词面板）把什么形态的后端原文传进来，都不许把内部标识带上屏。 */
  const head = `${String(name ?? '').trim()}：${maskInternalIds(String(reason ?? '').trim())}`
  const tail = maskInternalIds(String(fix ?? '').trim())
  return tail ? `${head} 怎么补：${tail}` : head
}
