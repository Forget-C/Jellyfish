/**
 * 「普通生产页面只显示用户需要理解的状态」——用户语言文案的纯逻辑（可直接 `node --test`）。
 *
 * 背景（用户点名）：普通生产页面此前直接把后台参数摊在界面上——
 * 模型内部名、原始状态值、任务 ID、`file_id`、「演练门禁」这类开发术语，
 * 用户看不懂也不知道要做什么。收敛口径：
 *
 *   1. 页面主信息只回答两个问题：**现在能不能做**、**下一步做什么**；
 *   2. 模型 / 供应商 / 原始状态 / 任务 ID / `file_id` 一律收进默认收起的「技术详情」；
 *   3. 真实调用必须说清楚**会产生费用**，不许出现「门禁」等开发术语；
 *   4. `sanitizeUserText` 是最后一道闸：任何来自后端的原始文本在给用户看之前都过一遍。
 */

/** 用户可见文案里**不允许**出现的内部术语（回归测试逐条断言）。 */
export const FORBIDDEN_INTERNAL_TERMS: readonly string[] = [
  'deepseek-chat',
  'gpt-image-2',
  'image2',
  'status: ready',
  'status=ready',
  '门禁',
  'file_id',
  'task_id',
  'DRY_RUN',
  'JELLYFISH_',
  'provider_id',
]

/** 返回 `text` 里命中的内部术语（空数组 = 干净）。 */
export function findInternalTerms(text: string): string[] {
  const haystack = String(text ?? '').toLowerCase()
  return FORBIDDEN_INTERNAL_TERMS.filter((term) => haystack.includes(term.toLowerCase()))
}

export const USER_TEXT_FALLBACK = '这一步没有成功，请稍后重试或展开「技术详情」查看原始信息。'

/**
 * 把后端/内部文本洗成用户可读文本。
 *
 * 三步，顺序不能换：
 *   1. 按句拆开，**丢掉**含内部术语的整句（宁可少说一句，也不把 `DRY_RUN=…` 摆给用户看）；
 *   2. 剩下的句子里把 `shot_id = 值` 这类内部标识替换成中文说明；
 *   3. 一句都没剩下、或洗完仍不干净 → 给一句通用说明（绝不把内部术语漏出去）。
 */
export function sanitizeUserText(text: string, fallback: string = USER_TEXT_FALLBACK): string {
  const raw = String(text ?? '').trim()
  if (!raw) return ''
  const sentences = raw
    .split(/(?<=[。；;！!？?\n])/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
  const kept = sentences.filter((sentence) => findInternalTerms(sentence).length === 0)
  if (kept.length === 0) return fallback
  const result = kept
    .join('')
    .replace(
      /\b(video_task_id|provider_id|shot_id|chapter_id|project_id)\s*[=:：]\s*[A-Za-z0-9_\-:.]+/gi,
      '内部标识已省略',
    )
    .trim()
  if (!result || findInternalTerms(result).length > 0) return fallback
  return result
}

/* ------------------------------------------------------------- 用户可见状态 */

export type UserStageKey =
  | 'cannot_extract'
  | 'ready_to_extract'
  | 'extracting'
  | 'extract_failed'
  | 'pending_confirm'
  | 'prompt_todo'
  | 'can_generate_image'
  | 'generating'
  | 'generation_failed'
  | 'has_image_pending_primary'
  | 'done'

export type UserStageTone = 'info' | 'success' | 'warning' | 'error'

export type UserStageText = {
  label: string
  detail: string
  tone: UserStageTone
}

export const USER_STAGE_TEXT: Record<UserStageKey, UserStageText> = {
  cannot_extract: {
    label: '还不能开始提取',
    detail: '本集还没有分镜，请先在第 1 步提取分镜。',
    tone: 'warning',
  },
  ready_to_extract: {
    label: '可以开始提取',
    detail: '点右上角「开始提取」，按剧本提取角色、场景、道具与服装。',
    tone: 'info',
  },
  extracting: {
    label: '正在提取…',
    detail: '正在按剧本读取角色、场景、道具与服装，请稍等。',
    tone: 'info',
  },
  extract_failed: {
    label: '提取失败',
    detail: '这次没有提取成功，可按下面的原因处理后重试。',
    tone: 'error',
  },
  pending_confirm: {
    label: '有待确认的内容',
    detail: '勾选后点「确认选中项」一次确认多条，也可以逐条确认。',
    tone: 'warning',
  },
  prompt_todo: {
    label: '可以生成提示词',
    detail: '资产已确认：先为它们生成图片提示词，提示词就绪后就能生成图片。',
    tone: 'info',
  },
  can_generate_image: {
    label: '可以生成图片',
    detail: '提示词已就绪，去下面的「资产生产区」生成图片。',
    tone: 'success',
  },
  generating: {
    label: '正在生成…',
    detail: '正在生成图片，请勿关闭页面。',
    tone: 'info',
  },
  generation_failed: {
    label: '生成失败',
    detail: '这次没有生成成功，可按下面的原因处理后重试。',
    tone: 'error',
  },
  has_image_pending_primary: {
    label: '已有图片，待设为定版',
    detail: '挑一张满意的图设为定版，这个资产的图片部分就算完成。',
    tone: 'info',
  },
  done: {
    label: '已定版',
    detail: '这个资产已经完成，可以继续下一个资产。',
    tone: 'success',
  },
}

export type StageInput = {
  /** 本集分镜数（0 = 还不能提取） */
  shotCount: number
  /** 是否已经跑过提取（有候选即视为跑过） */
  hasExtracted: boolean
  loading?: boolean
  running?: boolean
  /** running = true 时说明正在做哪件事 */
  runningKind?: 'extract' | 'generation'
  /** 已经洗过的失败原因（空串 = 没有失败） */
  failureReason?: string
  failureKind?: 'extract' | 'generation'
  /** 还有多少组候选没确认 */
  pendingCandidateCount: number
  /**
   * 已确认资产的图片进度；null/undefined = 当前页面拿不到（不猜，换一句通用提示）。
   */
  imagePrep?: { promptReady: boolean; hasImage: boolean; hasPrimary: boolean } | null
}

export type UserStageView = UserStageText & {
  key: UserStageKey | 'assets_confirmed'
}

/**
 * 当前阶段 → 用户语言。
 *
 * 顺序有讲究：失败与进行中优先，然后是「能不能开始」，最后才是图片阶段。
 * 任何分支都只说用户能理解的状态，不出现模型名、原始状态值或内部标识。
 */
export function describeUserStage(input: StageInput): UserStageView {
  if (input.failureReason) {
    const key: UserStageKey = input.failureKind === 'generation' ? 'generation_failed' : 'extract_failed'
    const base = USER_STAGE_TEXT[key]
    return { key, ...base, detail: `原因：${sanitizeUserText(input.failureReason, base.detail)}` }
  }
  if (input.running) {
    const key: UserStageKey = input.runningKind === 'generation' ? 'generating' : 'extracting'
    return { key, ...USER_STAGE_TEXT[key] }
  }
  if (input.loading) {
    return { key: 'extracting', ...USER_STAGE_TEXT.extracting, label: '正在读取…', detail: '正在读取本集的待确认内容与资产状态。' }
  }
  if (input.shotCount === 0) {
    return { key: 'cannot_extract', ...USER_STAGE_TEXT.cannot_extract }
  }
  if (!input.hasExtracted) {
    return { key: 'ready_to_extract', ...USER_STAGE_TEXT.ready_to_extract }
  }
  if (input.pendingCandidateCount > 0) {
    const base = USER_STAGE_TEXT.pending_confirm
    return {
      key: 'pending_confirm',
      ...base,
      label: `有 ${input.pendingCandidateCount} 项待你确认`,
    }
  }
  const imagePrep = input.imagePrep
  if (!imagePrep) {
    return {
      key: 'assets_confirmed',
      label: '资产已确认',
      detail: '继续在下面的「资产生产区」生成图片提示词与图片。',
      tone: 'info',
    }
  }
  if (!imagePrep.promptReady) return { key: 'prompt_todo', ...USER_STAGE_TEXT.prompt_todo }
  if (!imagePrep.hasImage) return { key: 'can_generate_image', ...USER_STAGE_TEXT.can_generate_image }
  if (!imagePrep.hasPrimary) return { key: 'has_image_pending_primary', ...USER_STAGE_TEXT.has_image_pending_primary }
  return { key: 'done', ...USER_STAGE_TEXT.done }
}

/* --------------------------------------------------------------- 下一步提示 */

export type NextStepKey = 'prompt' | 'image' | 'primary' | 'done'

export type NextStepHint = {
  key: NextStepKey
  /** 一句话讲清「下一步做什么」（用户语言） */
  title: string
  detail: string
}

export type NextStepInput = {
  /** 是否已保存图片提示词；null/undefined = 无法判定，按「还没有」处理并说明 */
  hasImagePrompt?: boolean | null
  hasImage?: boolean
  hasPrimary?: boolean | null
}

/**
 * 确认资产之后**必须**告诉用户下一步是「生成提示词」还是「生成图片」。
 *
 * 判定就是资产的图片流水线顺序：提示词 → 图片 → 定版。
 */
export function resolveNextStepHint(input: NextStepInput): NextStepHint {
  if (input.hasImagePrompt !== true) {
    return {
      key: 'prompt',
      title: '下一步：生成提示词',
      detail: '刚确认的资产还没有图片提示词：在下面的「资产生产区」为它们生成提示词。',
    }
  }
  if (!input.hasImage) {
    return {
      key: 'image',
      title: '下一步：生成图片',
      detail: '提示词已就绪：在下面的「资产生产区」生成图片。',
    }
  }
  if (input.hasPrimary !== true) {
    return {
      key: 'primary',
      title: '下一步：设为定版',
      detail: '已有图片：挑一张满意的图设为定版。',
    }
  }
  return {
    key: 'done',
    title: '这些资产已经完成',
    detail: '可以继续处理下一个资产，或进入下一步。',
  }
}

/* ------------------------------------------------------- 能不能做 + 费用提示 */

/**
 * 是否允许真实调用 → 用户语言 + **费用提示**。
 *
 * 「门禁 / DRY_RUN / 原始状态」这类说法一律不出现；用户只需要知道
 * 「这次会不会花钱、为什么现在做不了」。
 */
export function costNoticeText(dryRun: boolean | null | undefined): string {
  if (dryRun === true) return '当前是演练模式：不会真实调用，也不产生任何费用。'
  if (dryRun === false) return '真实模式已开：每次生成都会真实调用并产生费用，费用按实际用量结算。'
  return '暂时无法确认是否会产生费用，确认之前请按「可能产生费用」对待。'
}

export type GenerationReadinessInput = {
  /** 出口名（用户语言，例如「图片」「提示词」） */
  outletLabel: string
  /** 读取生成状态时的错误（内部原文，会被洗过） */
  error?: string
  /** 是否演练：true 不会真实调用；false 会真实付费；null = 无法确认 */
  dryRun?: boolean | null
  /** 出口模型是否可用：false = 还没配置好；null = 无法确认 */
  modelReady?: boolean | null
}

export type GenerationReadinessView = {
  tone: UserStageTone
  title: string
  detail: string
}

export function describeGenerationReadiness(input: GenerationReadinessInput): GenerationReadinessView {
  const cost = costNoticeText(input.dryRun)
  if (input.error) {
    return {
      tone: 'warning',
      title: '暂时无法确认现在能不能生成',
      detail: `没有读到生成状态：${sanitizeUserText(input.error, '请稍后重试。')}`,
    }
  }
  if (input.modelReady === false) {
    return {
      tone: 'error',
      title: `还不能生成${input.outletLabel}`,
      detail: `后台还没有可用的${input.outletLabel}模型，请先到「模型管理」选择一个可用模型。`,
    }
  }
  if (input.modelReady === null || input.modelReady === undefined || input.dryRun === null || input.dryRun === undefined) {
    return {
      tone: 'info',
      title: '正在确认生成条件…',
      detail: '确认完成前先不要把这次操作当成一定会真实调用。',
    }
  }
  return {
    tone: 'success',
    title: `可以生成${input.outletLabel}`,
    detail: cost,
  }
}

/** 面板上「技术详情」入口的说明（用户不需要看，但需要知道去哪看）。 */
export const TECHNICAL_DETAIL_HINT = '模型、生成服务、内部编号等排查用的信息统一放在页面顶部默认收起的「技术详情」里。'
