/**
 * 巨日禄「脚本组选择」的**纯逻辑**（可 `node --test` 单测）。
 *
 * 为什么单独抽出来（2026-09-20 真实验收踩到）：
 *   一次「获取整集提示词」第一步会拿到**三个 scriptId**，第二步共返回 109 条分镜
 *   （41 / 37 / 31）。用户明确要求：
 *   1) 三个 scriptId 分成三个**可选择的脚本组**；**单选**（UI 上不可能选多个）；
 *   2) **默认不跨 scriptId 合并**、默认一组都不选 / 不匹配 / 不写库；
 *   3) **用户明确选择一组之后**走**整组导入**：该组**全部**记录进统一预览与匹配
 *      （不取前三条、不抽样、不与其他 scriptId 混合）；
 *   4) 版本新旧**只在后端给出基于真实时间戳的依据时**才标（`versionInfo`），
 *      其余情况只陈述客观事实；`likely_newest` 只是提示，绝不构成默认选中；
 *   5) **不要因为接口共返回 109 条，就把 109 条当成同一集的连续镜头。**
 *
 * 这个模块只做判定，不发请求、不碰 React：页面（EpisodeVideoPromptBoard）按它返回的
 * `send / scriptIds / clearBefore / entries / options` 决定发不发第二次 preview、
 * 要不要先清空旧组 rows、镜头不足时渲染哪三个选项。这里每一条判定错了，
 * 用户就会看到**两组分镜混在同一张表里**或**少了几条**，所以全部用测试钉住。
 */

import type { JuriluScriptGroup, JuriluScriptSampleRecord } from '../../../../../services/llmPipelineApi'

/* ---------------------------------------------------------------- 文案常量 */

/** 缺标题时**明确说"未提供"**，绝不留空让人误以为标题是空的。 */
export const MISSING_TITLE_TEXT = '未提供标题'
/** 缺时间时的统一文案（不编造时间）。 */
export const MISSING_TIME_TEXT = '未提供'
/**
 * 「最新版本」标签：**只有拿到基于真实时间戳的依据时才允许出现**。
 *
 * 用户口径（2026-09-20 升级）：没有可靠时间证据时不要标「最新版本」，
 * 页面只陈述客观信息（标题、创建/更新时间「未提供」、记录数、序号范围、
 * 「与 X 标题相同」「分镜正文重合度 82%」这类事实）。所以这个标签的显示
 * 由 `versionInfo().timestampEvidence` 把门，后端只给 `likely_newest` 是不够的。
 */
export const NEWEST_TAG_TEXT = '最新版本（依据时间戳，仍请你确认）'
/** 版本推断**必须**同时显示的限定文案。 */
export const NEWEST_DISCLAIMER = '这是基于时间戳的推断，仍需你确认'
/** 没有时间戳证据时的统一说法（不猜、不标版本新旧）。 */
export const NO_TIMESTAMP_EVIDENCE = '没有可用的时间戳证据：本页不做版本新旧判断，请你自己核对创建/更新时间后再选组。'
/** 默认不合并的抬头说明模板（数字由真实数据算）。 */
export const DEFAULT_MERGE_NOTICE = '默认不合并'

/* ---------------------------------------------------------------- 归一化 */

type AnyRecord = Record<string, unknown>

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as AnyRecord) : null
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return ''
  return String(value).trim()
}

function asTextList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map((item) => asText(item)).filter((item) => item !== '')
}

function asCount(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value))
  const text = asText(value)
  if (text === '') return 0
  const parsed = Number(text)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function normalizeSample(raw: unknown): JuriluScriptSampleRecord {
  const record = asRecord(raw) ?? {}
  return {
    seq: asText(record.seq),
    sbid: asText(record.sbid),
    prompt_head: asText(record.prompt_head),
    prompt_length: asCount(record.prompt_length),
    summary_head: asText(record.summary_head),
  }
}

/**
 * 把后端 `data.script_groups` 防御性归一化。
 *
 * 铁律：**取不到的字段就是空字符串 / 0**，由展示层统一说「未提供」；
 * 这里绝不编造标题、时间或序号范围（用户会拿它去核对解析结果）。
 */
export function normalizeScriptGroups(input: unknown): JuriluScriptGroup[] {
  if (!Array.isArray(input)) return []
  const groups: JuriluScriptGroup[] = []
  for (const raw of input) {
    const record = asRecord(raw)
    if (!record) continue
    const scriptId = asText(record.script_id)
    // 没有 script_id 的组无法被选择，直接丢掉（不然会出现"选中了却发不出请求"的死行）
    if (!scriptId) continue
    groups.push({
      script_id: scriptId,
      title: asText(record.title),
      title_source: asText(record.title_source),
      created_at: asText(record.created_at),
      updated_at: asText(record.updated_at),
      record_count: asCount(record.record_count),
      seq_min: asText(record.seq_min),
      seq_max: asText(record.seq_max),
      seq_field: asText(record.seq_field),
      sample_records: Array.isArray(record.sample_records) ? record.sample_records.map(normalizeSample) : [],
      raw_keys: asTextList(record.raw_keys),
      likely_newest: record.likely_newest === true,
      version_reasons: asTextList(record.version_reasons),
      version_hint: asText(record.version_hint),
    })
  }
  return groups
}

/* ---------------------------------------------------------------- 组信息展示 */

export interface GroupFieldTexts {
  titleText: string
  titleMissing: boolean
  titleSourceText: string
  createdAtText: string
  updatedAtText: string
  recordCountText: string
  seqRangeText: string
  /** 缺标题/缺时间时给一句统一说明（字段名清单见 raw_keys） */
  missingMetaNotice: string
}

/** 单组的字段展示文案（缺什么就说什么，不编造）。 */
export function groupFieldTexts(group: JuriluScriptGroup): GroupFieldTexts {
  const title = asText(group.title)
  const titleMissing = title === ''
  const created = asText(group.created_at)
  const updated = asText(group.updated_at)
  const seqMin = asText(group.seq_min)
  const seqMax = asText(group.seq_max)

  let seqRangeText = '未提供分镜序号范围'
  if (seqMin !== '' || seqMax !== '') {
    const range = `${seqMin === '' ? '（未提供）' : seqMin}–${seqMax === '' ? '（未提供）' : seqMax}`
    seqRangeText = `分镜序号 ${range}`
  }

  const missing: string[] = []
  if (titleMissing) missing.push('标题')
  if (created === '') missing.push('创建时间')
  if (updated === '') missing.push('更新时间')

  return {
    titleText: titleMissing ? MISSING_TITLE_TEXT : title,
    titleMissing,
    titleSourceText: asText(group.title_source) === '' ? '未提供标题来源' : '标题来源已记录',
    createdAtText: created === '' ? `创建时间：${MISSING_TIME_TEXT}` : `创建时间：${created}`,
    updatedAtText: updated === '' ? `更新时间：${MISSING_TIME_TEXT}` : `更新时间：${updated}`,
    recordCountText: `${asCount(group.record_count)} 条分镜`,
    seqRangeText,
    missingMetaNotice: missing.length ? '这一组缺少标题/时间信息，不影响选组' : '',
  }
}

export interface VersionInfo {
  /** 是否允许显示「最新版本」标签：必须**同时**满足 → 后端标了 likely_newest、
   *  该组自身有真实时间戳（created_at / updated_at 至少一个非空）、
   *  且后端给出的依据里确实含时间戳类证据（日期字面量 / 创建时间 / 更新时间 / 时间戳）。 */
  timestampEvidence: boolean
  /** 只有 timestampEvidence 为 true 才有值；否则为空串（页面上不会出现「最新版本」字样） */
  label: string
  /** 后端给出的**客观事实**（原样展示，例如「与 2933351/2933350 标题相同」） */
  factsTitle: string
  facts: string[]
  /** 后端提示语：**只在有时间戳证据时**展示，否则它可能含「最可能是最新版」这类判断 */
  hint: string
  disclaimer: string
  /** 没有时间戳证据时的说明（含"不标最新版本"的承诺） */
  noEvidenceNotice: string
}

/**
 * 依据里出现"日期字面量或时间字段名" → 才算时间戳类证据。
 *
 * 日期必须像年份（19xx / 20xx）才认：否则「与 2933351/2933350 标题相同」这种
 * scriptId 列表里的 `3351/29` 会被误判成日期，那就等于凭空给一个「最新版本」标签。
 */
const TIME_EVIDENCE_PATTERN =
  /(?:^|[^\d])(?:19|20)\d{2}\s*[-/年]\s*\d{1,2}|时间戳|创建时间|更新时间|created_at|updated_at|createTime|updateTime|insertTime|update_time|create_time/i

export function reasonHasTimestampEvidence(reason: unknown): boolean {
  return TIME_EVIDENCE_PATTERN.test(asText(reason))
}

function hasOwnTimestamp(group: JuriluScriptGroup): boolean {
  return asText(group.created_at) !== '' || asText(group.updated_at) !== ''
}

/**
 * 版本信息：**客观事实照实说，「最新版本」标签要凭证**。
 *
 * 用户升级口径：没有可靠时间证据时不要标「最新版本」。所以：
 * - `likely_newest=true` + 该组有真实时间戳 + 依据里含时间戳证据 → 显示标签（仍带「仍请你确认」）；
 * - `likely_newest=true` 但缺时间戳证据 → **不显示任何「最新版本」字样**，只列客观事实，
 *   并明说「没有可用的时间戳证据：本页不判断哪个是最新版本」；
 * - 无论哪种情况，都**不会**因为 `likely_newest` 自动选中这一组（见 `defaultScriptSelection`）。
 */
export function versionInfo(group: JuriluScriptGroup): VersionInfo {
  const facts = asTextList(group.version_reasons)
  const hint = asText(group.version_hint)
  const timestampEvidence =
    group.likely_newest === true &&
    hasOwnTimestamp(group) &&
    (facts.some((reason) => reasonHasTimestampEvidence(reason)) || reasonHasTimestampEvidence(hint))
  return {
    timestampEvidence,
    label: timestampEvidence ? NEWEST_TAG_TEXT : '',
    factsTitle: '判断依据',
    facts,
    hint: timestampEvidence ? hint : '',
    disclaimer: timestampEvidence ? NEWEST_DISCLAIMER : '',
    noEvidenceNotice: group.likely_newest === true && !timestampEvidence ? NO_TIMESTAMP_EVIDENCE : '',
  }
}

/** 兼容旧调用名的别名（旧代码/旧测试用 `newestHint`）。 */
export const newestHint = versionInfo

/** 抓取后抬头的总量说明：数字**全部用真实数据算**，不写死 3 / 109。 */
export function summarizeScriptGroups(groups: JuriluScriptGroup[]): {
  groupCount: number
  recordTotal: number
  notice: string
} {
  const groupCount = groups.length
  const recordTotal = groups.reduce((sum, group) => sum + asCount(group.record_count), 0)
  const notice =
    `本次共 ${groupCount} 个脚本组、合计 ${recordTotal} 条分镜；${DEFAULT_MERGE_NOTICE}，请先选择一组再匹配镜头。` +
    '（一次拿到的总条数不等于同一集的连续镜头。）'
  return { groupCount, recordTotal, notice }
}

/** 解析自检：样例记录（序号 / sbid / 提示词前 60 字 + 字数 / 摘要前 40 字）。 */
export interface SampleRow {
  key: string
  seqText: string
  sbidText: string
  promptHeadText: string
  promptLengthText: string
  summaryHeadText: string
}

function clip(text: unknown, limit: number): string {
  const value = asText(text)
  if (value === '') return '（空）'
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

export function sampleRows(group: JuriluScriptGroup, limit = 5): SampleRow[] {
  const samples = Array.isArray(group.sample_records) ? group.sample_records : []
  return samples.slice(0, Math.max(0, limit)).map((raw, index) => ({
    key: `${group.script_id}-${index}`,
    seqText: asText(raw.seq) === '' ? '未提供序号' : `#${asText(raw.seq)}`,
    sbidText: asText(raw.sbid) === '' ? '未提供 sbid' : asText(raw.sbid),
    promptHeadText: clip(raw.prompt_head, 60),
    promptLengthText: `${asCount(raw.prompt_length)} 字`,
    summaryHeadText: clip(raw.summary_head, 40),
  }))
}

export function sampleSectionTitle(group: JuriluScriptGroup, limit = 5): string {
  const total = Array.isArray(group.sample_records) ? group.sample_records.length : 0
  const shown = Math.min(total, limit)
  return `msgpack 解析自检（正文 / 序号 / 提示词）：下面是该组前 ${shown} 条（共返回 ${total} 条样例）`
}

export function rawKeysText(group: JuriluScriptGroup): string {
  const keys = asTextList(group.raw_keys)
  return keys.length ? keys.join('、') : '这次没有读到可用信息项'
}

/** 「整组导入」的口径说明（用户升级要求：选中一组就把**整组**送进预览与匹配）。 */
export function wholeGroupNotice(group: JuriluScriptGroup | null): string {
  if (!group) return '还没选择脚本组：选一组后，该组全部记录会一起进入统一预览与匹配。'
  return `整组导入：本组 ${asCount(group.record_count)} 条记录会全部进入统一预览与匹配（不截断、不抽样、不与其他剧本组混合）。`
}

/* ------------------------------------------------- 整组分镜 → 统一预览映射 */

/** 后端配对计划里的一行（`JuriluPreviewRow` 的结构子集，便于单测构造）。 */
export interface JuriluPlanRowLike {
  prompt?: string
  shot_id?: string
  reason?: string
  order?: number
  label?: string
  title?: string
  index?: number
}

/** 统一预览表里的一条巨日禄条目（**带上脚本组与巨日禄序号**）。 */
export interface JuriluPreviewEntry {
  prompt: string
  shot_id: string
  matched_by: string
  status: string
  message: string
  /** 该条属于哪个脚本组（表里的「脚本组」列） */
  scriptId: string
  /** 巨日禄那边这一条的序号（表里的「巨日禄序号」列） */
  juriluSeq: string
}

function juriluSeqText(row: JuriluPlanRowLike): string {
  const order = asNumberLoose(row.order)
  if (order !== null && order > 0) return String(Math.trunc(order))
  return '未提供序号'
}

function asNumberLoose(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  const text = asText(value)
  if (text === '') return null
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 把**该组的全部 rows** 映射进统一预览表。
 *
 * 关键（用户升级要求）：**不截断、不抽样** —— 31/37/41 条原样进表，
 * 每一条都带上自己的脚本组，从源头上避免"两组混在一张表里"。
 * 未匹配上的条目也进表（带原因），由用户决定怎么处理。
 */
export function buildJuriluEntries(rows: JuriluPlanRowLike[], scriptId: string): JuriluPreviewEntry[] {
  const group = asText(scriptId)
  const list = Array.isArray(rows) ? rows : []
  return list.map((row) => {
    const shotId = asText(row.shot_id)
    return {
      prompt: asText(row.prompt),
      shot_id: shotId,
      matched_by: shotId ? 'cookie' : 'none',
      status: shotId ? 'ok' : 'unmatched',
      message: asText(row.reason) || (shotId ? '' : '巨日禄这条没有匹配到镜头'),
      scriptId: group,
      juriluSeq: juriluSeqText(row),
    }
  })
}

/** 进表的条目里"匹配正常"的条数（勾选保存的对象）。 */
export function countMatchedEntries(entries: JuriluPreviewEntry[]): number {
  return (entries ?? []).filter((entry) => entry.status === 'ok' && entry.shot_id !== '').length
}

/**
 * 组覆盖率检查：后端返回的条数与该组记录数不一致时**如实说出来**（页面不做截断，
 * 也不偷偷补齐），因为"少了几条"和"多了别的组"都会让用户误判。
 */
export function groupCoverageNotice(expectedRecords: number, actualRows: number): string {
  const expected = Math.max(0, Math.trunc(expectedRecords ?? 0))
  const actual = Math.max(0, Math.trunc(actualRows ?? 0))
  if (expected === 0 || expected === actual) return ''
  if (actual < expected) {
    return `这次只返回了 ${actual} 条分镜，但该组记录数是 ${expected} 条：可能有记录没解析出来或没进匹配结果（本页不做截断，如实显示）。`
  }
  return `这次返回了 ${actual} 条分镜，多于该组记录数 ${expected} 条：请核对是否混入了别的剧本组。`
}

/* ------------------------------------------------ 镜头不足时的三个选项 */

export type ShortageOptionKey = 'create_missing' | 'save_matched_only' | 'back_to_adjust'

export interface ShortageOption {
  key: ShortageOptionKey
  label: string
  hint: string
  disabled: boolean
}

export interface ShotShortageInput {
  /** 目标章节当前镜头数 */
  shotCount: number
  /** 已匹配进预览表的条数（还没匹配时传 0） */
  entryCount: number
  /** 其中匹配正常的条数 */
  matchedCount: number
  /** 选中的脚本组记录数（还没匹配时用它算缺口，例如本集 0 镜 + 该组 31 条） */
  groupRecordCount?: number
}

export interface ShotShortagePlan {
  show: boolean
  /** 这一组一共要落多少条（有 rows 就用 rows，否则用该组记录数） */
  targetCount: number
  missingCount: number
  matchedCount: number
  message: string
  options: ShortageOption[]
}

/**
 * 镜头不足时**明确显示缺少数量**，并给出三个选项（用户升级要求）：
 * ① 创建缺失镜头后完整匹配；② 仅保存已经匹配的条目；③ 返回调整。
 *
 * 这里只产出"要渲染什么"，点击动作仍由页面处理 —— 任何一条路径都不会自动写库。
 */
export function planShotShortage(input: ShotShortageInput): ShotShortagePlan {
  const shotCount = Math.max(0, Math.trunc(input.shotCount ?? 0))
  const entryCount = Math.max(0, Math.trunc(input.entryCount ?? 0))
  const matchedCount = Math.max(0, Math.trunc(input.matchedCount ?? 0))
  const groupRecordCount = Math.max(0, Math.trunc(input.groupRecordCount ?? 0))
  const targetCount = entryCount > 0 ? entryCount : groupRecordCount
  const missingCount = Math.max(0, targetCount - shotCount)

  const options: ShortageOption[] = [
    {
      key: 'create_missing',
      label: `创建缺失镜头（${missingCount} 个）并重新匹配`,
      hint: '按本组提示词的顺序补齐镜头，再用本组重新匹配一次；建完仍需你点「确认保存」才会写库。',
      disabled: missingCount <= 0,
    },
    {
      key: 'save_matched_only',
      label: `仅保存已经匹配的条目（${matchedCount} 条）`,
      hint: '只写匹配上的条目，未匹配的不写（服务端按 allow_partial 校验）；不创建任何镜头。',
      disabled: matchedCount <= 0,
    },
    {
      key: 'back_to_adjust',
      label: '返回调整（先不改动）',
      hint: '回预览表手工改镜头编号 / 删条目，或换一个脚本组；这一步不写库、不建镜头。',
      disabled: false,
    },
  ]

  return {
    show: missingCount > 0,
    targetCount,
    missingCount,
    matchedCount,
    message: `镜头不足：目标章节现有 ${shotCount} 个镜头，本组要导入 ${targetCount} 条分镜，缺少 ${missingCount} 个。请选一种处理方式：`,
    options,
  }
}

/* --------------------------------------- 巨日禄流程状态（唯一真相，防状态矛盾） */

/**
 * 一次**已完成**的巨日禄匹配（后端 preview 已经返回并进表）。
 *
 * 这是「已匹配」的**唯一凭证**：它同时记住**哪一组**与**哪一集**，
 * 所以"换了组/换了章节"时旧结果自动失效 —— 不能用"选过组"冒充"已匹配"。
 */
export interface JuriluMatch {
  /** 这次匹配用的脚本组 */
  scriptId: string
  /** 这次匹配写向的目标章节（换章节后自动失效） */
  chapterId: string
  /** 后端这次返回的该组分镜条数（整组，未截断） */
  entryCount: number
  /** 其中匹配正常的条数 */
  matchedCount: number
  /** 该组记录数（后端脚本组里的 record_count） */
  groupRecordCount: number
  /** **后端**在预览响应里报告的本集镜头数（chapter_shot_count，不是前端推断） */
  chapterShotCount: number
}

export type JuriluStage = 'idle' | 'selected' | 'matching' | 'matched' | 'stale'

export interface JuriluFlowInput {
  scriptGroups: JuriluScriptGroup[]
  /** 用户勾选的脚本组（'' = 没选） */
  selectedScriptId: string
  /** 已完成匹配（后端预览已返回）；null = 还没匹配过 */
  match: JuriluMatch | null
  /** 匹配请求正在飞 */
  matching: boolean
  /** 当前目标章节 */
  chapterId: string | null
  /** 目标章节名称（例如「第100集 · 验收·巨日禄整组导入（临时）」） */
  chapterLabel: string
  /** 表里巨日禄条目数（未匹配时不该有） */
  entryCount: number
  /** 表里匹配正常的巨日禄条数 */
  matchedRowCount: number
}

export interface JuriluFlowState {
  stage: JuriluStage
  /** **缺口面板与一切创建镜头入口**是否允许出现（只有 matched 才 true） */
  canShowShortage: boolean
  /** 预览表里的巨日禄内容属于哪一组（未匹配时恒为 ''） */
  matchedScriptId: string
  /** 给用户看的一句话状态（与缺口面板同源，不可能互相矛盾） */
  statusText: string
  /** 目标章节展示文案：名称 + ID 末段 + 镜头数（匹配前不展示真实镜头数） */
  chapterText: string
  /** 目标章节 ID 末段，例如 `…204035` */
  chapterIdTail: string
  /** 镜头数文案（匹配前是说明，不是数字） */
  shotCountText: string
  /** 缺口计算用的目标条数（只有 matched 才有值，**绝不来自"仅仅选中"的组**） */
  targetCount: number
  /** 缺口计算用的镜头数（后端真实值） */
  shotCount: number
  /** 缺口计划：只有 matched 才产出，其余为 null */
  shortage: ShotShortagePlan | null
  /** 底部通用「创建缺失镜头」按钮是否显示（巨日禄流程进行中一律隐藏，避免两个创建入口） */
  showBottomCreateButton: boolean
}

/** 章节 ID 末段：`acc_jurilu_group_204035` → `…204035`。 */
export function chapterIdTail(chapterId: string, length = 6): string {
  const id = asText(chapterId)
  if (id === '') return '（未选择章节）'
  const tail = length > 0 ? id.slice(-length) : id
  return `…${tail}`
}

/** 目标章节展示：名称 + ID 末段 + 镜头数（`matched=false` 时**不展示真实镜头数**）。 */
export function targetChapterText(input: {
  label: string
  chapterId: string
  shotCount: number
  matched: boolean
}): { text: string; idTail: string; shotCountText: string } {
  const label = asText(input.label) || '（未选择章节）'
  const idTail = chapterIdTail(input.chapterId)
  const shotCount = Math.max(0, Math.trunc(input.shotCount ?? 0))
  const shotCountText = input.matched
    ? `本集镜头 ${shotCount} 个`
    : '镜头数：点「用这一组匹配镜头」后显示'
  return { text: `当前目标章节：${label}｜ID ${idTail}｜${shotCountText}`, idTail, shotCountText }
}

/**
 * 巨日禄流程的**单一来源**状态。
 *
 * 为什么要有它（2026-09-20 页面复测实测到的状态矛盾）：
 *   之前"缺口面板"用的是 `selectedScriptId`（**选过组**）算出来的组条数，
 *   而"表内容归属"用的是 `matchedScriptId`（**已匹配**）。于是出现
 *   「尚未选择脚本组，当前表里不应有巨日禄分镜」+「现有 3 个镜头、缺少 28 个」同时显示，
 *   还提前给出了创建镜头入口 —— 用户看到的就是自相矛盾的两块状态。
 *
 * 现在只认一个对象 `JuriluMatch`（同时带 scriptId 与 chapterId）：
 * - 没选组 / 选了组但没点匹配 / 匹配请求在飞 → `canShowShortage=false`（缺口与创建入口一律隐藏）；
 * - 只有 matched（且组与章节都对得上）→ 才给出后端真实镜头数与缺口；
 * - 换了组或换了章节 → 旧匹配自动变 `stale`，缺口与创建入口同样隐藏。
 */
export function resolveJuriluFlow(input: JuriluFlowInput): JuriluFlowState {
  const selectedId = asText(input.selectedScriptId)
  const match = input.match
  const chapterId = asText(input.chapterId)
  const entryCount = Math.max(0, Math.trunc(input.entryCount ?? 0))
  const matchedRowCount = Math.max(0, Math.trunc(input.matchedRowCount ?? 0))

  const sameChapter = Boolean(match) && chapterId !== '' && match?.chapterId === chapterId
  const sameGroup = Boolean(match) && match?.scriptId === selectedId
  const matchValid = Boolean(match) && sameChapter && sameGroup

  let stage: JuriluStage
  if (input.matching) stage = 'matching'
  else if (matchValid) stage = 'matched'
  else if (match) stage = 'stale'
  else if (selectedId !== '') stage = 'selected'
  else stage = 'idle'

  const canShowShortage = stage === 'matched'
  const shotCount = canShowShortage ? Math.max(0, Math.trunc(match?.chapterShotCount ?? 0)) : 0
  const targetCount = canShowShortage
    ? Math.max(Math.trunc(match?.groupRecordCount ?? 0), Math.trunc(match?.entryCount ?? 0))
    : 0

  const chapterInfo = targetChapterText({
    label: input.chapterLabel,
    chapterId,
    shotCount,
    matched: canShowShortage,
  })

  let statusText: string
  /* 审计 §4.2 模式 1 / §6.1：内部**组编号**（巨日禄的 scriptId）一律不上主区，
     只说「这一组」。这里原本每一条状态文案都把 `${selectedId}` 端给用户。 */
  if (stage === 'matching') {
    statusText = '正在用这一组匹配镜头：拿到结果之前不显示镜头数与缺口，也不会提供任何建镜头入口。'
  } else if (stage === 'matched') {
    const missing = Math.max(0, targetCount - shotCount)
    statusText =
      missing > 0
        ? `已用这一组匹配 ${entryCount} 条：${input.chapterLabel || '目标章节'} 现有 ${shotCount} 个镜头，缺少 ${missing} 个。`
        : `已用这一组匹配 ${entryCount} 条：${input.chapterLabel || '目标章节'} 现有 ${shotCount} 个镜头，数量一致，可以直接确认保存。`
  } else if (stage === 'stale') {
    statusText = '上次匹配结果已经作废（脚本组或目标章节变了）：预览表已清空，请重新点「用这一组匹配镜头」。'
  } else if (stage === 'selected') {
    statusText = '已经选好一组了，但还没点「用这一组匹配镜头」：预览表里不会有巨日禄分镜，也不会显示镜头缺口或建镜头入口。'
  } else {
    statusText = '尚未选择脚本组：默认不跨组合并，预览表里不会有巨日禄分镜。请先选一组，再点「用这一组匹配镜头」。'
  }

  const shortage = canShowShortage
    ? planShotShortage({
        shotCount,
        entryCount,
        matchedCount: matchedRowCount,
        groupRecordCount: targetCount,
      })
    : null

  return {
    stage,
    canShowShortage,
    matchedScriptId: canShowShortage ? asText(match?.scriptId) : '',
    statusText,
    chapterText: chapterInfo.text,
    chapterIdTail: chapterInfo.idTail,
    shotCountText: chapterInfo.shotCountText,
    targetCount,
    shotCount,
    shortage,
    // 巨日禄流程一旦开始（选了组 / 在匹配 / 已匹配 / 作废），底部那条通用按钮就让位给缺口面板里的 primary
    showBottomCreateButton: stage === 'idle',
  }
}

/* ------------------------------------------------ 建镜头（一次点击 = 一轮） */

export interface CreateMissingInput {
  /** 后端**当下**的镜头数（调用前刚 fetch 过，不是页面缓存） */
  latestShotCount: number
  /** 要补齐到的目标条数 */
  targetCount: number
  /** 是否已有一轮创建在飞（同一按钮连点/重复触发） */
  inFlight: boolean
}

export interface CreateMissingPlan {
  allowed: boolean
  count: number
  reason: string
}

/**
 * 建镜头前的闸门：**一次点击只发一轮请求**，且用后端最新镜头数算缺口。
 *
 * 用户口径：不要因为存在 3 个镜头就去补 28 个；只有用户在「已匹配」状态下明确点击才允许创建。
 */
export function planCreateMissingShots(input: CreateMissingInput): CreateMissingPlan {
  const latest = Math.max(0, Math.trunc(input.latestShotCount ?? 0))
  const target = Math.max(0, Math.trunc(input.targetCount ?? 0))
  if (input.inFlight) {
    return { allowed: false, count: 0, reason: '已有一轮创建镜头正在进行：本次点击不会重复创建（等它结束再决定是否补齐）。' }
  }
  const count = Math.max(0, target - latest)
  if (count <= 0) {
    return { allowed: false, count: 0, reason: `当前镜头数（${latest} 个）已经不少于本组条数（${target} 条），无需创建。` }
  }
  return { allowed: true, count, reason: `将按当前最新镜头数补齐 ${count} 个（${latest} → ${target}）。` }
}

/* ---------------------------------------------------------------- 选择状态机 */

export interface ScriptSelectionInput {
  groups: JuriluScriptGroup[]
  /** 用户当前勾选的 scriptId（默认空数组 = 一组都不选） */
  selectedScriptIds: string[]
  /** 后端这次有没有要求先选组（响应字段 requires_script_selection） */
  requiresScriptSelection?: boolean
  /** 后端这次返回的 rows 条数 */
  rowCount?: number
  /** 后端响应里回显的 selected_script_ids */
  responseSelectedIds?: string[]
}

export interface ScriptSelectionState {
  /** 当前选中的脚本组 id（'' = 没选） */
  selectedId: string
  selected: JuriluScriptGroup | null
  /** 下一次 preview 请求要带的 script_ids；空数组 = 不发匹配请求 */
  requestScriptIds: string[]
  /** 是否还处于"必须先选组"的状态 */
  requiresSelection: boolean
  /** 选中了组、可以点「用这一组匹配镜头」 */
  canMatch: boolean
  /** 后端返回的 rows 必须丢弃（否则两组数据会混进同一张表） */
  dropRows: boolean
  notices: string[]
}

/**
 * 选择状态机（页面唯一的真相）。
 *
 * 规则（按用户原话）：
 * - 空选择 → `requestScriptIds` 恒为 `[]`（不发匹配请求）、`canMatch=false`；
 * - 只选一组 → `requestScriptIds` 只含那一个 id；
 * - `likely_newest` 不参与选中判定（绝不会因为"最新"就自动选上）；
 * - 后端说 `requires_script_selection=true` 却还给了 rows → 按「必须重新选组」处理，
 *   这些 rows **一条都不使用**（这正是 109 条被误当成一集连续镜头的那个坑）。
 */
export function resolveScriptSelection(input: ScriptSelectionInput): ScriptSelectionState {
  const groups = Array.isArray(input.groups) ? input.groups : []
  const notices: string[] = []
  const ids = (input.selectedScriptIds ?? []).map((item) => asText(item)).filter((item) => item !== '')
  const rowCount = Math.max(0, Math.trunc(input.rowCount ?? 0))
  const requiresSelection = input.requiresScriptSelection === true

  if (ids.length > 1) {
    // 用户明确要求「默认不跨组」合并，前端也按单选处理；真出现多选就退回"未选择"
    notices.push(`一次只能选一组：收到 ${ids.length} 组，已按「未选择」处理（不跨组合并）。`)
  }

  const single = ids.length === 1 ? ids[0] : ''
  const selected = single === '' ? null : (groups.find((group) => group.script_id === single) ?? null)

  if (single !== '' && !selected) {
    // 内部组编号不上屏（审计 §4.2 模式 1）：说的是"你选的那一组"而不是它的编号
    notices.push('选中的这一组不在本次返回的脚本组里：请重新选择一组。')
  }
  // 空选择 / 多选 / 选了不存在的组：一律不发匹配请求
  const requestScriptIds = selected ? [selected.script_id] : []
  if (!selected) {
    notices.push('默认不跨剧本组合并：请先选择一个脚本组，再点「用这一组匹配镜头」。')
  }

  const responseIds = (input.responseSelectedIds ?? []).map((item) => asText(item)).filter((item) => item !== '')
  if (responseIds.length > 1) {
    notices.push(`这次回显了 ${responseIds.length} 组选择：本页只按一组处理，请谨慎保存。`)
  }

  // 这次要求先选组，却返回了 rows → 一律丢弃（不许渲染成"同一集的连续镜头"）
  const dropRows = requiresSelection && rowCount > 0
  if (dropRows) {
    notices.push(
      `这次要求先选组，却同时给了 ${rowCount} 条分镜：已按「必须重新选组」处理，这 ${rowCount} 条一条都不会进入预览表。`,
    )
  }
  if (requiresSelection) {
    notices.push('这次要求先选脚本组：未选组前不会做镜头匹配。')
  }
  if (selected && !requiresSelection && rowCount === 0) {
    // 内部组编号不上屏（审计 §4.2 模式 1）
    notices.push('已经选好这一组了，但这次没有返回任何分镜（该组可能解析为 0 条，或尚未匹配）。')
  }

  return {
    selectedId: selected ? selected.script_id : '',
    selected,
    requestScriptIds,
    requiresSelection: requiresSelection || !selected,
    canMatch: Boolean(selected),
    dropRows,
    notices,
  }
}

/**
 * **默认不选组**：无论后端把哪一组标成 `likely_newest`，初始选择恒为空数组。
 * 这个函数存在的意义就是被测试钉死（"最新版本"只是提示，不是默认选中）。
 */
export function defaultScriptSelection(groups: JuriluScriptGroup[]): string[] {
  void groups
  return []
}

/** 换组/重匹配前的计划（先清干净，再发请求）。 */
export interface GroupMatchPlan {
  /** 是否允许发第二次 preview 请求 */
  send: boolean
  /** 请求体里的 script_ids（未选组时为空数组） */
  scriptIds: string[]
  /** 发请求前必须先清空旧 rows */
  clearBefore: boolean
  /** 会被清掉的行数 */
  clearCount: number
  notice: string
  /** 不允许发请求时的中文原因（直接给用户看） */
  blockedReason: string
}

export interface GroupSwitchInput {
  /** 上一组（已经匹配过的组；'' = 还没匹配过） */
  previousSelectedId: string
  /** 这次要匹配的组 */
  selectedId: string
  /** 当前表里已有的 rows 条数 */
  currentRowCount: number
}

/**
 * 换组必须先清干净：**旧组 rows 清空之后**才允许发新请求，
 * 否则两组分镜会同时出现在统一预览表里（用户最担心的事）。
 */
export function planGroupMatch(input: GroupSwitchInput): GroupMatchPlan {
  const previous = asText(input.previousSelectedId)
  const selected = asText(input.selectedId)
  const rows = Math.max(0, Math.trunc(input.currentRowCount ?? 0))

  if (selected === '') {
    return {
      send: false,
      scriptIds: [],
      clearBefore: false,
      clearCount: 0,
      notice: '',
      blockedReason: '还没选择脚本组：默认不跨 scriptId 合并，所以不会发匹配请求。请先选一组。',
    }
  }

  const switched = previous !== selected
  const clearBefore = rows > 0
  let notice: string
  if (switched && previous !== '') {
    notice = rows > 0
      ? `已切换到新的一组：上一组的 ${rows} 条匹配结果已清空，正在重新匹配。`
      : '已切换到新的一组：正在重新匹配（上一组没有留下结果）。'
  } else if (switched) {
    notice = '开始匹配这一组。'
  } else {
    notice = rows > 0 ? `重新匹配：先清空上一次的 ${rows} 条结果，不与新结果混在一起。` : '重新匹配。'
  }

  return { send: true, scriptIds: [selected], clearBefore, clearCount: clearBefore ? rows : 0, notice, blockedReason: '' }
}

/** 按计划清空旧组 rows（纯函数，便于测试"清空之后才请求"）。 */
export function clearRowsBeforeMatch<T>(rows: T[], plan: GroupMatchPlan): T[] {
  return plan.clearBefore ? [] : rows
}

/** 用户点选/切换脚本组：立刻清掉上一组的 rows、配对结果与提示（同步动作）。 */
export interface GroupSwitchOutcome<T = unknown> {
  changed: boolean
  selectedId: string
  /** 换组后必须写回表里的 rows（换组恒为空数组） */
  nextRows: T[]
  clearedCount: number
  /** 换了组就要把"已匹配组"标记清掉，避免标签指着上一组 */
  resetMatched: boolean
  notice: string
}

export function applyGroupSwitch<T>(input: GroupSwitchInput): GroupSwitchOutcome<T> {
  const previous = asText(input.previousSelectedId)
  const selected = asText(input.selectedId)
  const rows = Math.max(0, Math.trunc(input.currentRowCount ?? 0))
  const changed = previous !== selected
  if (!changed) {
    return {
      changed: false,
      selectedId: selected,
      nextRows: [],
      clearedCount: 0,
      resetMatched: false,
      notice: '',
    }
  }
  return {
    changed: true,
    selectedId: selected,
    nextRows: [],
    clearedCount: rows,
    resetMatched: true,
    notice: selected === '' ? '已取消选择脚本组：上一组的匹配结果已清空（不会自动合并）。' : '已选择这一组：上一组的匹配结果已清空，点「用这一组匹配镜头」才会请求。',
  }
}

/**
 * 已匹配组的展示文案（用于预览表抬头，避免用户忘记表里是哪一组）。
 *
 * 审计 §4.2 模式 1：原来抬头里写着「当前脚本组：2936083」——**内部组编号**上了主区。
 * 名字与条数足够让用户认出是哪一组，编号只进技术详情。
 */
export function activeGroupLabel(groups: JuriluScriptGroup[], scriptId: string): string {
  const id = asText(scriptId)
  if (id === '') return '尚未选择脚本组：当前表里不应有巨日禄分镜'
  const group = groups.find((item) => item.script_id === id)
  if (!group) return '当前脚本组不在本次返回的清单里'
  const texts = groupFieldTexts(group)
  return `当前脚本组${texts.titleMissing ? '' : `（${texts.titleText}）`} · ${texts.recordCountText}`
}

/**
 * 保存按钮抬头：**显示当前勾选条数**（例如「确认保存（31 条）」）。
 *
 * 2026-09-20 升级：删掉「最多保存 3 条」这条限制与文案 —— 那不是产品限制。
 * 选中一组就是**整组导入**：该组全部记录进预览，用户勾选多少就保存多少。
 */
export function saveButtonText(includedCount: number): string {
  return `确认保存（${includedCount} 条）`
}

/**
 * 整组保存的口径说明（给用户看的一句话）。
 * 保存的对象 = 该组**所有勾选且匹配正常**的条目，只保存本次选中的这一组（不与其他剧本组混合）。
 *
 * ⚠️ 组编号（`scriptId`）是内部标识：这里只用它判断"选没选组"，**不上屏**。
 */
export function wholeGroupSaveNotice(includedCount: number, scriptId: string, groupRecordCount: number): string {
  const id = asText(scriptId)
  if (id === '') return '整组保存：还没有选择脚本组，暂时不能保存巨日禄分镜。'
  return `整组保存：本组共 ${Math.max(0, Math.trunc(groupRecordCount ?? 0))} 条记录，本次将保存勾选且匹配正常的 ${includedCount} 条（本次只保存这一组，不与其他剧本组混合）。`
}
