/**
 * 「这条镜头绑定的声音到底会不会进供应商请求」的**页面口径**（纯函数，可单测）。
 *
 * 为什么单独抽出来：
 *
 * - 后端把结论放在了计划/预览响应的 `audio` 审计字段里
 *   （`included` / `file_id` / `url` / `excluded_reason` / `how_to_fix` / `state`）；
 * - 页面必须在**提交之前**就把"已绑定，但供应商无法访问"说清楚（不是等生成失败才说），
 *   而这套文案要能脱离 React 单测 —— 所以判定与文案都放在这里，组件只负责渲染。
 *
 * 术语口径（不许夸大，与后端 `REFERENCE_AUDIO_TERMS_NOTE` 一致）：
 *
 * - **参考音频**：作为**输入**进入供应商请求（`audio_urls`）。本轮只验证到**请求计划层**
 *   —— "会被带进请求"有证据，"供应商据此影响生成结果"**没有证据**，页面不能说成已支持；
 * - **最终成片的音轨**：成片里那条轨，来自供应商侧 `generate_audio`（模型自己生成）；
 *   把已生成的音频混流/回贴成成片音轨是**另一条路径**，当前未实现。
 */

// 阶段 B ③（审计 §4.3 模式 6 / §5.5-F）：`excluded_reason` / `how_to_fix` 是后端原文，
// 原来**完全没走**掩码管道（审计记为「掩码后直渲」，实为未掩码），这里在唯一出口统一接上。
// 第 3 批收尾（审计 §4.3 模式 4 / §7.1-6）：后端原文**只进技术详情层**（做掩码后原样保留）；
// 主区改用产品自己写的中文结论 —— 后端句子里带 `/files/...` 这类存储形态，过一遍管道仍是后端文本。
import { maskInternalIds } from '../../components/maskInternalIds.ts'

/** 后端计划响应里的参考音频审计（字段与 `VideoAudioPlanRead` 对齐，全部可选以兼容旧响应）。 */
export type AudioAudit = {
  included?: boolean
  file_id?: string
  url?: string
  declared_url?: string
  excluded_reason?: string
  reason_code?: string
  how_to_fix?: string
  state?: string
  vendor_supports_reference_audio?: boolean
  note?: string
}

/**
 * 「已绑定，但这次请求用不上它」的**唯一标题口径**。
 *
 * 审计 §4.3 模式 5：旧文案是「已绑定，但供应商无法访问」——「供应商」是主区禁词。
 * 用户需要知道的是「这段声音这次用不上」，不是厂商叫什么，所以改成业务说法。
 */
export const AUDIO_NOT_REACHABLE_TITLE = '已绑定，但当前服务取不到这条声音'

export type AudioAdmissionTone = 'success' | 'warning' | 'info' | 'default'

export type AudioAdmissionView = {
  /** 状态短标签（绑定区/计划面板共用同一份文案） */
  tag: string
  tone: AudioAdmissionTone
  /** 一句话结论（绑定区的 Alert 标题） */
  title: string
  /** 原因 / 说明（可为空）—— 主区，只描述形态与结论，不出现地址 */
  detail: string
  /**
   * **技术详情层**（默认收起）才允许出现的内容：本次请求携带的具体地址 /
   * 协议形态（`asset://`、`data:`、`/files/...`）。
   *
   * 审计 §4.3 模式 4 / §3.4：地址与存储形态属第三层。主区（`tag` / `title` /
   * `detail` / `fix` / `terminology`）一个地址都不许有。
   */
  technicalDetail: string
  /** 补救办法（可为空） */
  fix: string
  /** 是否要在绑定区显示"已绑定但用不上"的警示（= 绑了但本次请求不携带） */
  blocked: boolean
  /** 术语澄清：参考音频（输入）≠ 最终成片音轨（输出） */
  terminology: string
}

/**
 * 已携带时也要说清边界：只有"会进请求"这一件事被验证过。
 *
 * ⚠️ 这两段是**纯文本渲染**（`Typography.Text` / `Alert` description），
 * 所以不许写 `**加粗**` 这类 markdown 记号 —— 它会字面显示成星号
 * （审计 §4.3 渲染缺陷项 R12）。要强调就用中文措辞。
 * 另外「供应商」是主区禁词（审计 §4.3 模式 5 / §7.3）→ 统一说「生成服务」。
 */
export const REFERENCE_AUDIO_SCOPE_NOTE =
  '参考音频会送进生成服务的请求（本轮只在「请求计划层」验证它会被带进请求）；'
  + '生成服务是否据此影响生成结果，尚未有真实证据。'

export const REFERENCE_AUDIO_VS_FINAL_TRACK =
  '「参考音频」是输入；「最终成片的音轨」是输出 —— 由生成服务在出片时自己合成，'
  + '把已生成的音频混流/回贴成成片音轨是另一条路径，当前未实现。'

/** 后端原因码 → 给用户看的短标签（后端没给码时退回状态文案）。 */
const REASON_TAGS: Record<string, string> = {
  not_bound: '声音未绑定',
  opt_out: '本镜明确无需声音',
  file_missing: '已绑定，但素材库里查不到这个音频',
  vendor_unsupported: '已绑定，但当前模型不接受参考音频',
  no_address: '已绑定，但解析不出可公网访问的地址',
  local_path: '已绑定，但地址是本地/相对路径',
  private_address: '已绑定，但地址指向本机/内网',
  data_url_rejected: '已绑定，但生成服务不接受内嵌音频',
}

const INCLUDED_TAGS: Record<string, string> = {
  public_url: '声音已绑定（公网地址，本次请求会携带）',
  // 审计 §4.3 模式 4：旧文案把存储形态 `asset://` 印在主区；改成用户能判断的业务说法
  asset_ref: '声音已绑定（已登记的素材引用，本次请求会携带）',
  data_url_inline: '声音已绑定（内嵌音频，本次请求会携带）',
}

function text(value: unknown): string {
  return String(value ?? '').trim()
}

/* ------------------------------------------------- 地址形态：主区只说形态，地址进技术详情 */

/**
 * 本次请求携带的地址属于哪一类（**形态判定**，不做可用性判定 —— 可用性由后端给）。
 *
 * 审计 §4.3 模式 4 / §3.4 ：「文案里的存储形态 / 完整地址」是模式 4 的出口。
 * 用户需要知道的是「这个地址生成服务取不取得到」，不是地址本身长什么样，
 * 所以主区只出形态，具体地址与协议形态一律进默认收起的「技术详情」。
 */
export type AudioAddressKind = 'public_url' | 'asset_ref' | 'inline' | 'local' | 'unknown'

const PRIVATE_HOST_RE = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\]|192\.168\.|10\.|172\.(?:1[6-9]|2\d|3[01])\.)/i

export function classifyAudioAddress(url: string): AudioAddressKind {
  const value = text(url).toLowerCase()
  if (!value) return 'unknown'
  // 协议形态本身（`asset://`）是第三层内容，所以这里只返回分类，不返回带协议的字符串
  if (value.startsWith('asset://')) return 'asset_ref'
  if (value.startsWith('data:')) return 'inline'
  if (value.startsWith('https://') || value.startsWith('http://')) {
    return PRIVATE_HOST_RE.test(value) ? 'local' : 'public_url'
  }
  return 'local'
}

/**
 * 地址形态 → **主区**能说的话。
 *
 * 判定铁律：不出现完整地址、不出现协议形态（`asset://`）、不出现 `/files/...`。
 */
const ADDRESS_KIND_MAIN_TEXT: Record<AudioAddressKind, string> = {
  public_url: '本次请求携带的是公网可访问的地址。',
  asset_ref: '本次请求携带的是已登记的素材引用（不是公网地址）。',
  inline: '本次请求携带的是内嵌在请求里的音频。',
  local: '本次请求携带的是本机或相对地址，生成服务可能取不到它。',
  unknown: '本次请求携带的地址形态没有识别出来。',
}

/**
 * 「绑了却送不出去」时，**主区**给的中文结论（产品自己写的句子，按后端原因码分类）。
 *
 * 为什么不是把后端 `excluded_reason` 过一遍管道就上屏（审计 §5.5-F / §7.1-6）：
 * 后端那句话里**带地址**（实测 `已绑定声音「验收配音」，但它解析出的是本地/相对地址
 * （/files/files/voice.mp3）：供应商抓不到。`）—— 过管道只掩内部 ID，不会去掉 `/files/...`
 * 这类存储形态（正是审计模式 4 的出口）。所以主区一律用这里的结论，原话只进技术详情层。
 */
const EXCLUDED_MAIN_TEXT: Record<string, string> = {
  file_missing: '这条声音这次送不出去：素材库里已经找不到这个音频，请重新绑定一次。',
  vendor_unsupported: '这条声音这次送不出去：当前视频方案不接受参考音频，请改用不带参考音频的方案。',
  no_address: '这条声音这次送不出去：解析不出生成服务能访问的地址，请换成公网地址后重新绑定。',
  local_path: '这条声音这次送不出去：它的地址在本机或只是相对路径，生成服务取不到它。',
  private_address: '这条声音这次送不出去：它的地址指向本机或内网，生成服务取不到它。',
  data_url_rejected: '这条声音这次送不出去：当前视频方案不接受内嵌音频，请换成公网地址后重新绑定。',
}

const EXCLUDED_MAIN_FALLBACK = '这条声音这次送不出去：生成服务取不到它，请换成公网可访问的地址后重新绑定。'

/** 主区唯一的「怎么修」口径（产品自己写的句子；后端 `how_to_fix` 只进技术详情层）。 */
const EXCLUDED_FIX_TEXT = '把这条声音换成公网可访问的地址后重新绑定'

/** 技术详情层（默认收起）才允许出现的内容：具体地址 / 存储形态 / 后端原始说明。 */
function technicalDetailOf(parts: ReadonlyArray<string>): string {
  return parts.map((part) => text(part)).filter(Boolean).join('\n')
}

/** 后端原文 → 技术详情层形态（只去内部 ID，保留原措辞便于排查）。 */
function rawNote(raw: unknown): string {
  const value = text(raw)
  return value ? `生成服务原始说明：${maskInternalIds(value)}` : ''
}

/** 本次请求携带的具体地址（技术详情层；与主区 `detail` 的「形态」成对）。 */
function addressNote(url: string): string {
  const value = text(url)
  return value ? `本次请求携带的地址：${value}` : ''
}

/**
 * 把后端审计翻译成页面文案。
 *
 * 判定顺序（与后端一致，页面不自己造规则）：
 * 1. 没有审计 / 没有绑定 → 「声音未绑定」；
 * 2. `state === 'opt_out'` → 「本镜明确无需声音」（是表态，不算漏绑）；
 * 3. `included === true` → 会携带，但**只说"会进请求"**，不说"会影响生成"；
 * 4. 绑了但没携带 → **「已绑定，但当前服务取不到这条声音」** + 真实原因 + 修法。
 *
 * ⚠️ 地址口径（审计 §4.3 模式 4 / §3.4）：
 * 主区（`tag` / `title` / `detail` / `fix` / `terminology`）**一个地址都不许有** ——
 * 不出现完整 URL、不出现 `asset://` / `data:` 这类存储形态、不出现 `/files/...`。
 * 具体地址只出现在 `technicalDetail`（技术详情层，默认收起）。
 */
export function describeAudioAdmission(audit: AudioAudit | null | undefined): AudioAdmissionView {
  const terminology = REFERENCE_AUDIO_VS_FINAL_TRACK
  if (!audit) {
    return {
      tag: '声音状态未知（尚未取到生成计划）',
      tone: 'default',
      title: '还没有读到这次的音频结论',
      detail: '页面会在计划加载完成后自动显示"这条声音会不会进本次生成请求"。',
      technicalDetail: '',
      fix: '',
      blocked: false,
      terminology,
    }
  }

  const state = text(audit.state)
  const reasonCode = text(audit.reason_code)
  const fileId = text(audit.file_id)

  if (state === 'opt_out') {
    return {
      tag: REASON_TAGS.opt_out,
      tone: 'default',
      title: '本镜已明确标记：无需声音',
      detail: '本镜已标记为不需要声音，本次生成请求不会携带参考音频。',
      technicalDetail: technicalDetailOf([rawNote(audit.excluded_reason)]),
      fix: '',
      blocked: false,
      terminology,
    }
  }

  if (!fileId && audit.included !== true) {
    return {
      tag: REASON_TAGS.not_bound,
      tone: 'default',
      title: '这条分镜还没有绑定声音',
      detail: '未绑定：本次生成请求不携带参考音频。',
      technicalDetail: technicalDetailOf([rawNote(audit.excluded_reason), rawNote(audit.how_to_fix)]),
      fix: '',
      blocked: false,
      terminology,
    }
  }

  if (audit.included === true) {
    const url = text(audit.url) || text(audit.declared_url)
    const addressKind = classifyAudioAddress(url)
    return {
      tag: INCLUDED_TAGS[state] || '声音已绑定（本次请求会携带）',
      tone: 'success',
      title: '已绑定，且会作为参考音频进入本次请求',
      // 审计 §4.3 模式 4 / §3.4：主区只说"这是什么形态的地址"，不拼出完整地址
      detail: url ? ADDRESS_KIND_MAIN_TEXT[addressKind] : '',
      // 具体地址与协议形态只进技术详情层（与 detail 成对）
      technicalDetail: technicalDetailOf([addressNote(url)]),
      fix: REFERENCE_AUDIO_SCOPE_NOTE,
      blocked: false,
      terminology,
    }
  }

  // 绑了却没携带：这次请求用不上它 —— 必须在**提交之前**说清楚
  return {
    tag: REASON_TAGS[reasonCode] || '已绑定，但本次请求不携带它',
    tone: 'warning',
    title: AUDIO_NOT_REACHABLE_TITLE,
    /* 审计 §4.3 模式 4/6 + §5.5-F 与 §7.1-6 的成对口径：
       主区给产品自己写的中文结论（按原因码分类，不含地址），
       后端 `excluded_reason` / `how_to_fix` 原文（可能带 `/files/...`、`asset://`、本机地址）
       只进技术详情层。 */
    detail: EXCLUDED_MAIN_TEXT[reasonCode] || EXCLUDED_MAIN_FALLBACK,
    technicalDetail: technicalDetailOf([rawNote(audit.excluded_reason), rawNote(audit.how_to_fix)]),
    fix: EXCLUDED_FIX_TEXT,
    blocked: true,
    terminology,
  }
}

/** 计划面板用的短标签（没有审计时退回既有的 `audio_state` 文案）。 */
export function audioStateTag(
  audit: AudioAudit | null | undefined,
  legacyState?: string | null,
): string {
  if (audit) return describeAudioAdmission(audit).tag
  const state = text(legacyState)
  if (state === 'bound') return '声音已绑定（公网可用）'
  if (state === 'bound_not_public') return AUDIO_NOT_REACHABLE_TITLE
  if (state === 'opt_out') return REASON_TAGS.opt_out
  if (state === 'missing') return REASON_TAGS.not_bound
  return '声音状态未知'
}
