/**
 * 集级视频提示词看板的**服务端草稿纯逻辑**（无 React、无网络，可直接 `node --test`）。
 *
 * 修的是什么（2026-09-19「整集视频提示词草稿丢失」）：
 * 看板按"一次一镜"真实调用大模型（真金白银），草稿此前只活在浏览器内存里，
 * 刷新 / 切走 / 中断就全丢。后端已把草稿落到 `shot_video_prompt_drafts`，
 * 这里负责前端侧的三件事，并且**都做成可测的纯函数**（钱的问题不能靠肉眼点页面确认）：
 *
 * 1. **恢复**：把 `GET /drafts` 的逐镜状态映射成预览表行（`restoredRowsFromDrafts`）；
 * 2. **只重试失败/缺失**：`selectGenerationTargets` 只挑 `failed / interrupted / pending`，
 *    已有草稿（`ok`）与生成中（`running`）**一律不重发**；
 * 3. **防止重复付费**：`formatBusyNotice` 把服务端租约拒抢翻译成中文提示；
 *    `shouldDropClaimPlaceholder` 判断"我们自己新建的空租约行"能不能整行清掉。
 *
 * 一条不要踩的线：`draft_token` 只对**服务端真实生成**的正文签发。
 * 客户端粘贴/改过的文本即使写进草稿表也拿不到令牌，只能按人工内容保存
 * （`resolveSaveOrigin` 就是这条守卫的前端镜像）。
 */

import type {
  AnyRecord,
  PromptBoardDraft,
  PromptBoardDraftStatus,
  PromptBoardMode,
  PromptBoardOrigin,
  PromptBoardShot,
} from '../../../../../services/llmPipelineApi'
import { toUserFacingText } from '../../../components/userFacingMessage.ts'

/* ------------------------------------------------------------------ 逐镜阶段 */

/**
 * 页面看的**逐镜草稿阶段**（"正式列里已经有内容"是独立字段 `saved`，不混进这个联合类型 ——
 * 一镜完全可能"既有已保存的正式提示词、又有一份没保存的新草稿"）。
 *
 * - `draft_ok`   有服务端草稿正文，**还没保存**（钱的产物，只差用户点确认）
 * - `failed`     上次生成失败（有失败原因）
 * - `running`    正在生成（服务端租约未过期）
 * - `interrupted`上次被中断（页面关掉/进程被杀），租约已过期 → 可以重试
 * - `pending`    未开始（服务端没有这一行）
 */
export type DraftPhase = 'draft_ok' | 'failed' | 'running' | 'interrupted' | 'pending'

export interface PhaseMeta {
  label: string
  color: string
  /** 一句话说明"这一镜现在处于什么状况、下一步该做什么" */
  hint: string
}

export const PHASE_META: Record<DraftPhase, PhaseMeta> = {
  draft_ok: {
    label: '已完成（草稿未保存）',
    color: 'blue',
    hint: '服务端草稿有正文，刷新不会丢；点「确认保存」才会写进正式提示词。',
  },
  failed: { label: '失败', color: 'red', hint: '上次生成失败，可只重试这一镜（已完成的不会重发）。' },
  running: { label: '生成中', color: 'processing', hint: '该镜正在生成（服务端租约未过期），不会重发。' },
  interrupted: {
    label: '已中断',
    color: 'orange',
    hint: '上次生成被中断、租约已过期（可能是页面关掉或进程被杀），可以直接重试。',
  },
  pending: { label: '未开始', color: 'default', hint: '还没生成过，属于「缺失」，可以重试。' },
}

/** 正式提示词列（`shot_details.video_prompt`）的状态标签 —— 与"草稿"严格分开显示。 */
export const SAVED_META = { label: '已保存到镜头', color: 'green', emptyLabel: '未保存（只有草稿）' }

export interface ShotDraftStatus {
  shotId: string
  code: string
  index: number
  title: string
  /** 服务端草稿阶段 */
  phase: DraftPhase
  /** 正式提示词列（`shot_details.video_prompt`）是否已有内容 */
  saved: boolean
  /** 正式提示词的来源标记（读不出来时为空串） */
  savedSource: string
  /** 服务端草稿正文（未保存的那一份） */
  draftPrompt: string
  /** 服务端草稿来源标记（恢复状态时原样写回，别把 skill 标成 llm） */
  draftSource: string
  /** 服务端草稿的 meta（latency_ms / warnings 等，恢复状态时原样写回） */
  draftMeta: AnyRecord
  /** 本次生成用的模型名 */
  draftModel: string
  /** 服务端签发的草稿令牌（空串 = 不能按大模型草稿保存） */
  draftToken: string
  /** 能否按 `llm_draft` 保存 */
  saveable: boolean
  hasDraft: boolean
  interrupted: boolean
  error: string
  /** 服务端原始状态（空串 = 服务端没有这一行） */
  storedStatus: string
  updatedAt: string | null
  claimExpiresAt: string | null
}

/**
 * 把「镜头列表 + 服务端草稿列表」拼成逐镜状态（**每一镜都有一行**，包括未开始的）。
 *
 * 为什么以镜头列表为基准：后端 `GET /drafts` 已经保证"没有草稿行的镜头也返回"，
 * 但页面可能在草稿还没读回来时先渲染（加载失败时更不能凭空少镜头），
 * 所以这里用镜头做左表，草稿只作为补充。
 */
export function buildShotDraftStatuses(input: {
  shots: PromptBoardShot[]
  drafts: PromptBoardDraft[]
}): ShotDraftStatus[] {
  const byShot = new Map<string, PromptBoardDraft>()
  for (const draft of input.drafts ?? []) byShot.set(String(draft.shot_id), draft)
  const seen = new Set<string>()
  const rows: ShotDraftStatus[] = []
  for (const shot of input.shots ?? []) {
    const draft = byShot.get(String(shot.shot_id))
    seen.add(String(shot.shot_id))
    rows.push(mergeStatus(shot, draft))
  }
  // 草稿里有、镜头列表里没有的（镜头被删/换集）：也要出现在状态表里，否则"看不见的草稿"最危险
  for (const draft of input.drafts ?? []) {
    if (seen.has(String(draft.shot_id))) continue
    rows.push(
      mergeStatus(
        {
          shot_id: String(draft.shot_id),
          index: Number(draft.index) || 0,
          code: String(draft.code || draft.shot_id),
          title: String(draft.title || '（不在本集镜头列表里）'),
          script_excerpt: '',
          video_prompt: '',
          video_prompt_source: '',
          has_prompt: false,
        },
        draft,
      ),
    )
  }
  return rows
}

function mergeStatus(shot: PromptBoardShot, draft: PromptBoardDraft | undefined): ShotDraftStatus {
  const stored = String(draft?.stored_status ?? '')
  const hasDraft = Boolean(draft?.has_draft)
  const token = String(draft?.draft_token ?? '')
  let phase: DraftPhase = 'pending'
  if (stored === 'ok') phase = 'draft_ok'
  else if (stored === 'failed') phase = 'failed'
  else if (String(draft?.status ?? '') === 'running') phase = 'running'
  else if (draft?.interrupted) phase = 'interrupted'
  return {
    shotId: String(shot.shot_id),
    code: String(shot.code || shot.shot_id),
    index: Number(shot.index) || 0,
    title: String(shot.title || ''),
    phase,
    saved: Boolean(shot.has_prompt),
    savedSource: String((shot as { video_prompt_source?: string }).video_prompt_source ?? ''),
    draftPrompt: String(draft?.prompt ?? ''),
    draftSource: String(draft?.source ?? ''),
    draftMeta: (draft?.meta ?? {}) as AnyRecord,
    draftModel: String(draft?.model ?? ''),
    draftToken: token,
    saveable: Boolean(draft?.saveable) && Boolean(token),
    hasDraft,
    interrupted: Boolean(draft?.interrupted),
    error: String(draft?.error ?? ''),
    storedStatus: stored,
    updatedAt: draft?.updated_at ?? null,
    claimExpiresAt: draft?.claim_expires_at ?? null,
  }
}

/** 服务端这一镜**有没有草稿行**（`stored_status` 为空 = 后端不落"未开始"的行）。 */
export function hadDraftRow(status: ShotDraftStatus | undefined | null): boolean {
  if (!status) return false
  return Boolean(String(status.storedStatus || '').trim()) || Boolean(status.hasDraft)
}

/**
 * 这一镜是否需要（重新）生成：**只有失败 / 已中断 / 未开始**。
 *
 * 已完成（有草稿正文）与生成中的一律返回 false —— 这是"不重复付费"的最后一道前端闸门
 * （服务端还有租约闸门，两道都要有）。
 */
export function needsGeneration(status: ShotDraftStatus): boolean {
  return status.phase === 'failed' || status.phase === 'interrupted' || status.phase === 'pending'
}

export interface GenerationTargetInput {
  statuses: ShotDraftStatus[]
  mode: PromptBoardMode
  /** 用户勾选的范围；空数组 = 本集全部（与既有口径一致） */
  selectedShotIds?: string[]
  /**
   * 是否允许重发"已完成"的镜头。**批量与「重试失败项」永远不开**，
   * 只有用户明确点某一行的「重新生成」时才为 true。
   */
  includeDone?: boolean
}

/**
 * 选出要发起的镜头（顺序与状态表一致）。
 *
 * 三条规则：
 * 1. 生成中（`running`）**永不在内**：服务端租约还活着，重发就是重复付费；
 * 2. `includeDone=false` 时只取 `needsGeneration` 的镜头（失败 / 已中断 / 未开始）；
 * 3. `fill_empty` 模式下跳过正式列已有内容的镜头（后端也会 skip，前端先拦掉少一次往返）。
 */
export function selectGenerationTargets(input: GenerationTargetInput): string[] {
  const scope = new Set((input.selectedShotIds ?? []).filter(Boolean))
  const targets: string[] = []
  for (const status of input.statuses ?? []) {
    if (scope.size && !scope.has(status.shotId)) continue
    if (status.phase === 'running') continue
    if (input.mode === 'fill_empty' && status.saved) continue
    if (!input.includeDone && !needsGeneration(status)) continue
    targets.push(status.shotId)
  }
  return targets
}

/** 「重试失败项」按钮的目标：失败 / 已中断 / 未开始（已完成与生成中的绝不重发）。 */
export function retryTargets(input: Omit<GenerationTargetInput, 'includeDone'>): string[] {
  return selectGenerationTargets({ ...input, includeDone: false })
}

/* ------------------------------------------------------------------ 恢复预览表 */

export interface RestoredDraftRow {
  shotId: string
  prompt: string
  /** 有令牌 = 大模型草稿；没有令牌 = 只能按人工内容保存 */
  origin: PromptBoardOrigin
  status: 'draft' | 'failed' | 'interrupted' | 'skipped'
  message: string
  draftToken: string
  saveable: boolean
  /** 是否默认勾选（只有"已完成且有正文"才勾） */
  include: boolean
  phase: DraftPhase
}

/**
 * 把服务端草稿映射成预览表的行（**刷新/重新进页面时调用**）。
 *
 * 只输出"值得出现在表里"的镜头：
 * - `draft_ok` → 有正文的草稿行（默认勾选，等用户确认保存）；
 * - `failed` → 失败行（正文可能还有上一版，**保留**不删：重试失败不该抹掉已付费的正文）；
 * - `running` → 生成中占位行（不可勾选）；
 * - `interrupted` → 已中断行（提示可重试，正文若有也带出来）。
 *
 * 未开始（`pending` 且服务端没有行）不进行，状态表里看得到就够了。
 */
export function restoredRowsFromDrafts(statuses: ShotDraftStatus[]): RestoredDraftRow[] {
  const rows: RestoredDraftRow[] = []
  for (const status of statuses ?? []) {
    if (status.phase === 'pending') continue
    const code = status.code || status.shotId
    const prompt = status.draftPrompt
    if (status.phase === 'running') {
      rows.push({
        shotId: status.shotId,
        prompt,
        origin: 'llm_draft',
        status: 'skipped',
        message: '服务端显示该镜正在生成中（租约未过期），不会重复发起',
        draftToken: '',
        saveable: false,
        include: false,
        phase: status.phase,
      })
      continue
    }
    // 令牌是"能按大模型草稿保存"的唯一凭据；没有令牌的正文只能按人工内容走
    const saveable = status.saveable && Boolean(prompt.trim())
    if (status.phase === 'failed') {
      rows.push({
        shotId: status.shotId,
        prompt,
        origin: saveable ? 'llm_draft' : 'manual',
        status: 'failed',
        message: status.error || '上次生成失败，可点「重试失败项」只重发这一镜',
        draftToken: status.draftToken,
        saveable,
        include: false,
        phase: status.phase,
      })
      continue
    }
    if (status.phase === 'interrupted') {
      rows.push({
        shotId: status.shotId,
        prompt,
        origin: saveable ? 'llm_draft' : 'manual',
        status: 'interrupted',
        message: '上次生成被中断（租约已过期，草稿已保留），可以重试这一镜',
        draftToken: status.draftToken,
        saveable,
        include: Boolean(prompt.trim()) && saveable,
        phase: status.phase,
      })
      continue
    }
    // draft_ok
    rows.push({
      shotId: status.shotId,
      prompt,
      origin: saveable ? 'llm_draft' : 'manual',
      status: 'draft',
      message: saveable
        ? `服务端草稿（未保存）${code ? ` · ${code}` : ''}`
        : '服务端草稿没有大模型令牌（不是看板生成路径的产出），只能按人工内容保存',
      draftToken: status.draftToken,
      saveable,
      include: Boolean(prompt.trim()),
      phase: status.phase,
    })
  }
  return rows
}

/** 同一镜头被两条记录指向（含恢复来的草稿行）时的冲突镜头集合。 */
export function includedShotConflicts(rows: Array<{ shotId: string; include: boolean }>): Set<string> {
  const seen = new Map<string, number>()
  for (const row of rows) {
    if (!row.include || !row.shotId) continue
    seen.set(row.shotId, (seen.get(row.shotId) ?? 0) + 1)
  }
  const conflicts = new Set<string>()
  for (const [shotId, count] of seen) if (count > 1) conflicts.add(shotId)
  return conflicts
}

/**
 * 保存时这一行算哪个来源。
 *
 * `llm_draft` 必须有**服务端签发的令牌**且用户没改过正文；否则降到 `manual`——
 * 客户端自己粘贴/改写的文本不能冒充大模型产物（后端还会用 HMAC 再验一次）。
 */
export function resolveSaveOrigin(row: {
  origin: PromptBoardOrigin
  edited: boolean
  draftToken?: string
}): PromptBoardOrigin {
  if (row.origin !== 'llm_draft') return row.origin
  if (row.edited) return 'manual'
  return String(row.draftToken ?? '').trim() ? 'llm_draft' : 'manual'
}

/* ------------------------------------------------------------------ 租约与清理 */

export interface DraftRestorePlan {
  action: 'none' | 'failed' | 'ok'
  prompt: string
  error: string
  source: string
  model: string
  meta: AnyRecord
}

/**
 * 非生成结果收尾时，要不要把这一镜的草稿状态**恢复成 claim 之前的样子**。
 *
 * 为什么需要：页面先 `claim` 占位会把草稿行置成 `running`；如果这次生成并没有产出
 * （演练 / 被模式跳过 / 撞上并发），光释放租约会让这一行停在 `running`，
 * 租约一过期就渲染成「已中断」—— 用户看到"刚才那条失败变成了中断"，原来的失败原因没了。
 * 所以按原状态写回：
 *
 * - 原来是 `failed` → 用 `status=failed + 原失败原因` 写回（**不传正文**，保留已存正文）；
 * - 原来是 `draft_ok` → 用 `status=ok + 原正文` 写回（正文与库里一致，服务端沿用
 *   `server_generated`，令牌照发）；
 * - 其余（未开始 / 已中断 / 生成中）→ 不动：释放租约后它们本来就回到原样。
 */
export function restorePlanFor(prev: ShotDraftStatus | undefined | null): DraftRestorePlan {
  const empty: DraftRestorePlan = { action: 'none', prompt: '', error: '', source: '', model: '', meta: {} }
  if (!prev || !hadDraftRow(prev)) return empty
  if (prev.phase === 'failed') {
    return {
      action: 'failed',
      prompt: '',
      error: prev.error || '上次生成失败',
      source: prev.draftSource,
      model: '',
      meta: prev.draftMeta,
    }
  }
  if (prev.phase === 'draft_ok' && prev.draftPrompt.trim()) {
    return {
      action: 'ok',
      prompt: prev.draftPrompt,
      error: '',
      source: prev.draftSource,
      model: prev.draftModel,
      meta: prev.draftMeta,
    }
  }
  return empty
}

/**
 * 服务端拒抢租约时的中文提示（"这一镜正在生成中，已跳过"）。
 *
 * 审计 §4.5 模式 6（`:406`）：改前是 `` `${label} 正在生成中，已跳过｜${detail}` ``，
 * `detail` 直接取后端 `claim.reason` 原文。现在这一段先过统一管道
 * （掩码 → 洗句 → 业务化改写 → 中文兜底），后端原值不会原样上屏。
 */
export function formatBusyNotice(code: string, reason: string): string {
  const label = String(code || '').trim() || '这一镜'
  const detail = String(reason || '').trim()
  if (!detail) return `${label} 正在生成中，已跳过`
  return `${label} 正在生成中，已跳过：${toUserFacingText(detail, '这一镜正在生成，等它跑完再试')}`
}

/**
 * 我们自己先占的租约占位行要不要整行删掉。
 *
 * 场景：页面先 `/drafts/claim` 占位（服务端因此新建了一行 running），
 * 但这次生成并没有产出草稿（演练 / 被模式跳过 / 撞上并发）。如果不清理，
 * 这一镜会一直显示"已中断"，看上去像失败。
 *
 * **只有这行完全是这次 claim 新建的空行时才删**：
 * - `preHadRow=true`（原本就有草稿，哪怕只是一句失败原因）→ 绝不删，那是已经付过费的东西；
 * - `persisted=true` → 保留（服务端确实存下了正文）；
 * - `status="failed"` → 保留：服务端很可能已经把失败原因写进这一行，
 *   留着用户才看得到"上次失败在哪一步"（失败与未开始都是重试候选）。
 *
 * **不要拿响应里的 `prompt` 当"有正文"**：演练模式也会回一段占位草稿正文，
 * 但后端一个字节都没落库（`persisted` 不为真）——把它当成"有草稿"就会
 * 让这一镜一直挂着一行假的"已中断"。
 */
export function shouldDropClaimPlaceholder(input: {
  preHadRow: boolean
  status: string
  persisted: boolean
}): boolean {
  if (input.preHadRow) return false
  if (input.persisted) return false
  return input.status === 'dry_run' || input.status === 'skipped' || input.status === 'busy'
}

/**
 * 批量收尾时的**兜底清扫**：这一轮里"什么都没产出"的镜头，服务端却留着一行空 `running`，
 * 就把它清掉（返回要删的 shot_ids）。
 *
 * 为什么需要兜底：逐镜收尾是异步的（claim → draft → release → 删占位），
 * 一旦某一步被打断（切页、请求失败、用户点停止正好卡在中间），
 * 那一行会以"running 无租约"的形态留下来 —— 页面把它渲染成**「已中断」**，
 * 用户会以为"刚才那次失败变成了中断"。逐镜清理已经是主路径，这里只兜住漏网的那一两个。
 *
 * 三条**不许删**的红线：
 * - 有正文（`has_draft`）：那是已经付过费的东西；
 * - `stored_status` 不是 running：那是失败/已完成的真实状态；
 * - 读层状态还是 running：租约还活着（可能是另一个标签页正在生成）→ 让持有者收尾。
 */
export function orphanPlaceholderShotIds(input: {
  outcomes: Array<{ shotId: string; status: string }>
  drafts: PromptBoardDraft[]
}): string[] {
  const byId = new Map((input.drafts ?? []).map((row) => [String(row.shot_id), row]))
  const ids: string[] = []
  for (const outcome of input.outcomes ?? []) {
    if (outcome.status !== 'dry_run' && outcome.status !== 'skipped') continue
    const row = byId.get(outcome.shotId)
    if (!row) continue
    if (String(row.stored_status) !== 'running') continue
    if (row.has_draft) continue
    if (String(row.status) === 'running') continue
    ids.push(outcome.shotId)
  }
  return ids
}

/* ------------------------------------------------------------------ 文案 */

/** 「上次生成到哪了」的一句话摘要（进页面时显示在顶部）。 */
export function draftRestoreNotice(statuses: ShotDraftStatus[]): string {
  const total = (statuses ?? []).length
  if (!total) return ''
  const count = (phase: DraftPhase) => (statuses ?? []).filter((item) => item.phase === phase).length
  const parts: string[] = []
  const completed = count('draft_ok')
  const saved = (statuses ?? []).filter((item) => item.saved).length
  const failed = count('failed')
  const interrupted = count('interrupted')
  const running = count('running')
  const pending = count('pending')
  if (completed) parts.push(`已完成草稿 ${completed} 镜`)
  if (saved) parts.push(`已保存到镜头 ${saved} 镜`)
  if (failed) parts.push(`失败 ${failed} 镜`)
  if (interrupted) parts.push(`已中断 ${interrupted} 镜`)
  if (running) parts.push(`生成中 ${running} 镜`)
  if (pending) parts.push(`未开始 ${pending} 镜`)
  const missing = failed + interrupted + pending
  const tail = missing ? `；可重试 ${missing} 镜（已完成的不会重发）` : '；没有需要重试的镜头'
  /* 审计 §4.5 模式 6（`:485`）：「服务端草稿」是开发视角的说法，主区改「上次生成到」。 */
  return `上次生成到：共 ${total} 镜 · ${parts.join(' · ')}${tail}`
}

const KNOWN_LABELS: Record<string, string> = {
  llm: '大模型生成',
  jurilu: '巨日禄导入',
  external_import: '外部导入',
  manual: '人工修改',
  skill: '一键技能生成',
}

/**
 * 正式提示词来源的中文标签。
 *
 * 审计 §4.5 模式 3（`:502` 的 `return KNOWN_LABELS[key] ?? key`）：
 * 未登记的来源码会**原样回显**（`weird_source` 这种英文原值直接上卡片）。
 * 现在未知来源统一「来源未标记」，绝不回显原值（§1.2 模式 3 的口径）。
 */
export function sourceLabel(source: string): string {
  const key = String(source || '').trim()
  if (!key) return '来源未标记'
  return KNOWN_LABELS[key] ?? '来源未标记'
}

/** 后端草稿状态 → 中文（含"已中断"细分），页面文案与测试共用一份。 */
export function describeDraftStatus(status: PromptBoardDraftStatus, interrupted = false): string {
  if (status === 'ok') return PHASE_META.draft_ok.label
  if (status === 'failed') return PHASE_META.failed.label
  if (status === 'running') return PHASE_META.running.label
  return interrupted ? PHASE_META.interrupted.label : PHASE_META.pending.label
}
