// 任务类型的中文口径统一由 components/enumLabels.ts 提供（禁止各页各写一份）
import { TASK_KIND, labelFor } from './enumLabels.ts'
// 时间口径统一由 components/userFacingTime.ts 提供（只读基建，不许各页各写一份）
import { formatUserFacingTime } from './userFacingTime.ts'

export type TaskCopyPreset = {
  title: string
  runningDescription: string
  cancellingDescription: string
  successDescription: string
  cancelledDescription: string
  failedDescription: string
  startedMessage: string
  reusedMessage: string
  cancelledImmediatelyMessage: string
  cancelRequestedMessage: string
  runningMessage: string
  cancellingMessage: string
}

export const TASK_COPY = {
  chapterDivision: {
    title: '分镜提取',
    runningDescription: '系统正在后台提取分镜，完成后会自动刷新当前内容。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '分镜提取已完成，页面内容已自动刷新。',
    cancelledDescription: '分镜提取已取消。',
    failedDescription: '分镜提取失败，请稍后重试。',
    startedMessage: '已开始分镜提取',
    reusedMessage: '已恢复当前章节的分镜提取任务',
    cancelledImmediatelyMessage: '分镜提取已取消',
    cancelRequestedMessage: '已请求取消分镜提取',
    runningMessage: '当前已有分镜提取任务在运行',
    cancellingMessage: '当前分镜提取任务正在取消，请稍候',
  },
  scriptExtract: {
    title: '资产提取',
    runningDescription: '任务完成后会自动刷新资产与待确认对白，无需手动刷新页面。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止，并在结束后自动刷新页面。',
    successDescription: '资产提取已完成，待确认内容已自动刷新。',
    cancelledDescription: '资产提取已取消。',
    failedDescription: '资产提取失败，请稍后重试。',
    startedMessage: '已开始资产提取',
    reusedMessage: '已恢复当前章节的资产提取任务',
    cancelledImmediatelyMessage: '资产提取已取消',
    cancelRequestedMessage: '已请求取消资产提取',
    runningMessage: '当前已有资产提取任务在运行',
    cancellingMessage: '当前资产提取任务正在取消，请稍候',
  },
  consistencyCheck: {
    title: '一致性检查',
    runningDescription: '检查完成后会自动展示最新的一致性检查结果。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止，并在结束后同步最新结果。',
    successDescription: '一致性检查已完成，结果已自动更新。',
    cancelledDescription: '一致性检查已取消。',
    failedDescription: '一致性检查失败，请稍后重试。',
    startedMessage: '已开始一致性检查',
    reusedMessage: '已恢复当前章节的一致性检查任务',
    cancelledImmediatelyMessage: '一致性检查已取消',
    cancelRequestedMessage: '已请求取消一致性检查',
    runningMessage: '当前已有一致性检查任务在运行',
    cancellingMessage: '当前一致性检查任务正在取消，请稍候',
  },
  scriptSimplify: {
    title: '智能精简',
    runningDescription: '精简完成后会自动回填最新文本。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '智能精简已完成，最新文本已自动回填。',
    cancelledDescription: '智能精简已取消。',
    failedDescription: '智能精简失败，请稍后重试。',
    startedMessage: '已开始智能精简',
    reusedMessage: '已恢复当前章节的智能精简任务',
    cancelledImmediatelyMessage: '智能精简已取消',
    cancelRequestedMessage: '已请求取消智能精简',
    runningMessage: '当前已有智能精简任务在运行',
    cancellingMessage: '当前智能精简任务正在取消，请稍候',
  },
  scriptOptimize: {
    title: '一键优化',
    runningDescription: '优化完成后会自动回填原文内容。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '一键优化已完成，原文内容已自动回填。',
    cancelledDescription: '一键优化已取消。',
    failedDescription: '一键优化失败，请稍后重试。',
    startedMessage: '已开始一键优化',
    reusedMessage: '已恢复当前章节的一键优化任务',
    cancelledImmediatelyMessage: '一键优化已取消',
    cancelRequestedMessage: '已请求取消一键优化',
    runningMessage: '当前已有一键优化任务在运行',
    cancellingMessage: '当前一键优化任务正在取消，请稍候',
  },
  smartDetect: {
    title: '智能检测',
    runningDescription: '检测完成后会自动展示缺失项与优化描述。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '智能检测已完成，结果已自动更新。',
    cancelledDescription: '智能检测已取消。',
    failedDescription: '智能检测失败，请稍后重试。',
    startedMessage: '已开始智能检测',
    reusedMessage: '已恢复当前资产的智能检测任务',
    cancelledImmediatelyMessage: '智能检测已取消',
    cancelRequestedMessage: '已请求取消智能检测',
    runningMessage: '当前已有智能检测任务在运行',
    cancellingMessage: '当前智能检测任务正在取消，请稍候',
  },
  imageGeneration: {
    title: '图片生成',
    runningDescription: '系统正在后台生成图片，完成后会自动同步最新结果。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '图片生成已完成。',
    cancelledDescription: '图片生成已取消。',
    failedDescription: '图片生成失败，请稍后重试。',
    startedMessage: '已开始图片生成',
    reusedMessage: '已恢复当前图片生成任务',
    cancelledImmediatelyMessage: '图片生成已取消',
    cancelRequestedMessage: '已请求取消图片生成',
    runningMessage: '当前已有图片生成任务在运行',
    cancellingMessage: '当前图片生成任务正在取消，请稍候',
  },
  videoGeneration: {
    title: '视频生成',
    runningDescription: '系统正在后台生成视频，完成后可直接回到当前镜头查看。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '视频生成已完成。',
    cancelledDescription: '视频生成已取消。',
    failedDescription: '视频生成失败，请稍后重试。',
    startedMessage: '已开始视频生成',
    reusedMessage: '已恢复当前视频生成任务',
    cancelledImmediatelyMessage: '视频生成已取消',
    cancelRequestedMessage: '已请求取消视频生成',
    runningMessage: '当前已有视频生成任务在运行',
    cancellingMessage: '当前视频生成任务正在取消，请稍候',
  },
  shotFramePrompt: {
    title: '分镜提示词生成',
    runningDescription: '系统正在后台生成分镜提示词，完成后会自动回填当前内容。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '分镜提示词已生成。',
    cancelledDescription: '分镜提示词生成已取消。',
    failedDescription: '分镜提示词生成失败，请稍后重试。',
    startedMessage: '已开始分镜提示词生成',
    reusedMessage: '已恢复当前分镜提示词生成任务',
    cancelledImmediatelyMessage: '分镜提示词生成已取消',
    cancelRequestedMessage: '已请求取消分镜提示词生成',
    runningMessage: '当前已有分镜提示词生成任务在运行',
    cancellingMessage: '当前分镜提示词生成任务正在取消，请稍候',
  },
  shotFrameImage: {
    title: '关键帧图片生成',
    runningDescription: '系统正在后台生成关键帧图片，完成后会自动刷新当前缩略图。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止。',
    successDescription: '关键帧图片已生成。',
    cancelledDescription: '关键帧图片生成已取消。',
    failedDescription: '关键帧图片生成失败，请稍后重试。',
    startedMessage: '已开始关键帧图片生成',
    reusedMessage: '已恢复当前关键帧图片生成任务',
    cancelledImmediatelyMessage: '关键帧图片生成已取消',
    cancelRequestedMessage: '已请求取消关键帧图片生成',
    runningMessage: '当前已有关键帧图片生成任务在运行',
    cancellingMessage: '当前关键帧图片生成任务正在取消，请稍候',
  },
} satisfies Record<string, TaskCopyPreset>

export const TASK_KIND_TITLE_MAP: Record<string, string> = {
  script_divide: TASK_COPY.chapterDivision.title,
  script_extract: TASK_COPY.scriptExtract.title,
  script_consistency: TASK_COPY.consistencyCheck.title,
  script_simplify: TASK_COPY.scriptSimplify.title,
  script_optimize: TASK_COPY.scriptOptimize.title,
  script_character_portrait: '角色画像分析',
  script_prop_info: '道具信息分析',
  script_scene_info: '场景信息分析',
  script_costume_info: '服装信息分析',
  image_generation: '图片生成',
  video_generation: '视频生成',
  shot_frame_prompt: '分镜提示词生成',
}

export const RELATION_TYPE_LABEL_MAP: Record<string, string> = {
  chapter_division: '章节',
  script_extraction: '章节',
  consistency_check: '章节',
  script_optimization: '章节',
  script_simplification: '章节',
  character_portrait_analysis: '资产',
  prop_info_analysis: '资产',
  scene_info_analysis: '资产',
  costume_info_analysis: '资产',
  video: '镜头视频',
  shot_first_frame_prompt: '首帧提示词',
  shot_last_frame_prompt: '尾帧提示词',
  shot_key_frame_prompt: '关键帧提示词',
  actor_image: '演员图片',
  scene_image: '场景图片',
  prop_image: '道具图片',
  costume_image: '服装图片',
  character_image: '角色图片',
  shot_frame_image: '分镜图片',
}

/**
 * 任务类型 → 中文标题。
 *
 * 审计 §4.4 模式 3：旧兜底 `taskKind.split('_').join(' ')` 会把**未登记的 kind 拼成英文**
 * 上屏（运行时实测 `video` → 「video」）。现在改走全仓唯一的 `TASK_KIND` 映射表，
 * 未登记一律给中文兜底「后台任务」，绝不回显原值。
 */
export function resolveTaskTitle(taskKind?: string | null): string {
  return labelFor(TASK_KIND, taskKind)
}

/**
 * 任务来源标签（业务名）。
 *
 * 审计 §6.1「任务号一律进技术详情，主区不得出现」：这里原来在拿不到业务名时
 * **回落渲染 `relationEntityId`**（内部 ID），等于把 UUID 当名称端给用户。
 * 现在取不到业务名时只说「名称读取中」，任何情况下不落实体 ID。
 */
export function resolveTaskSourceLabel(
  relationType?: string | null,
  relationEntityId?: string | null,
): string | null {
  if (!relationType) return null
  const label = RELATION_TYPE_LABEL_MAP[relationType] ?? '关联对象'
  if (!relationEntityId) return label
  return `${label}：名称读取中`
}

/**
 * 关联类型 → 中文业务名；**未登记一律给「关联对象」**，绝不回显 `actor_image` 这类原值。
 *
 * 为什么单独抽出来：`taskCenterMeta.ts` 的异常分支（取实体详情失败）会把 `relation_type`
 * 原样拼进主区文案 `「${relationType}：名称读取中」`——那是审计 §2.3 模式 3
 * （英文枚举原值直渲），与 §4.4 模式 1 条目的建议口径（「演员：名称读取中」）冲突。
 * 两个文件必须用同一份兜底，所以定义在这里。
 */
export function resolveRelationTypeLabel(relationType?: string | null): string {
  const key = String(relationType ?? '').trim()
  if (!key) return '关联对象'
  return RELATION_TYPE_LABEL_MAP[key] ?? '关联对象'
}

/* ------------------------------------------------------------ 时间的统一口径 */

/**
 * 后台时间戳（秒）→ 主区中文时间。
 *
 * 审计 §8.1 要求「任务时间列 / 通知时间」这类高发点必须过 `userFacingTime` 的唯一实现
 * （`formatUserFacingTime`），不允许在渲染点各写一份 `Intl.DateTimeFormat`：
 * 那样既有口径分叉，又可能在某个分支漏掉机器时间串（ISO / `T` / `Z`）直渲。
 *
 * 空值 / 非法值返回 `null`，由调用方决定是整行隐藏还是给「—」。
 */
export function taskTimeLabel(tsSeconds?: number | null): string | null {
  if (typeof tsSeconds !== 'number' || !Number.isFinite(tsSeconds) || tsSeconds <= 0) return null
  return formatUserFacingTime(new Date(tsSeconds * 1000).toISOString())
}

/**
 * 任务耗时 → 中文（秒 / 分 / 小时）。
 *
 * 原来 `TaskCenter.tsx` 与 `taskNotificationHelpers.tsx` 各有一份**逐字相同**的私有实现
 * （审计 §3.5「同一出口两套口径」的同类问题），这里收敛成一处。
 */
export function formatTaskElapsedMs(elapsedMs?: number | null): string | null {
  if (elapsedMs === null || elapsedMs === undefined || elapsedMs < 0) return null
  const totalSeconds = Math.floor(elapsedMs / 1000)
  if (totalSeconds < 60) return `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
  const hours = Math.floor(minutes / 60)
  const remainMinutes = minutes % 60
  return remainMinutes > 0 ? `${hours} 小时 ${remainMinutes} 分` : `${hours} 小时`
}

/* -------------------------------------------------------- 陈旧任务的口径（R16） */

/**
 * 任务多久没有任何更新就算「状态未知」（小时）。
 *
 * 依据：真实出图 / 出视频 / 文本生成最多几分钟；后端任务表 `updated_at` 在每次
 * 进度或状态变更时刷新（`core/task_manager/stores.py`），所以「6 小时没更新」
 * 已经远超任何正常情况。
 */
export const TASK_STALE_AFTER_HOURS = 6

/** 后端任务状态里「还在跑」的那几个（机器值，只用于判定，不上屏）。 */
const ACTIVE_TASK_STATUS = new Set(['pending', 'running', 'streaming'])

/** 陈旧任务的**主区状态文案**（审计 §4.4 R16 的固定模板）。 */
export const TASK_STALE_STATUS_LABEL = `状态未知（超过 ${TASK_STALE_AFTER_HOURS} 小时未更新）`

/**
 * 陈旧任务的**建议动作**。
 *
 * ⚠️ 这里**刻意不提供「标记为已失效」按钮**：已核对后端
 * `api/v1/routes/film/task_status.py`，任务相关写接口只有
 * `POST /tasks/{task_id}/cancel`（取消）与 `PATCH /task-links/adopt`（采用状态），
 * **没有**「把陈旧任务标记为失效」的接口。审计 R16 要求「给动作」，
 * 但凭空造一个前端按钮会点出 404 —— 所以按用户口径改成如实的中文说明，
 * 并把缺的接口登记为「待后端支持」（见本批报告）。
 */
export const TASK_STALE_ADVICE =
  '这条任务看起来已经中断：可以点「取消」把它结束。当前版本还不支持手动标记为「已失效」。'

export type TaskFreshnessInput = {
  status?: string | null
  cancelRequested?: boolean | null
  /** 后端 `updated_at_ts`（最后一次状态 / 进度变更） */
  updatedAtTs?: number | null
  startedAtTs?: number | null
  finishedAtTs?: number | null
}

export type TaskFreshness = {
  /** 是否已判断为「状态未知」 */
  stale: boolean
  /** 最后更新（秒）；`null` = 后端没给时间，此时不下「状态未知」的结论 */
  lastUpdateTs: number | null
}

/**
 * 判定一条「还在跑」的任务是不是**其实早就断了**（审计 §4.4 R16）。
 *
 * 运行时实测：任务中心里有 4 条 `running` 任务分别显示
 * 「耗时 2492 小时 30 分」「耗时 800 小时 30 分」「耗时 209 小时 42 分」却仍标「运行中」——
 * 这不是 6 类泄漏模式，而是**误导**：用户会以为后台真的还在跑。
 *
 * 判定只依赖后端给的时间戳；没有时间戳时**不猜**（返回 `stale: false`）。
 */
export function assessTaskFreshness(task: TaskFreshnessInput, nowMs: number = Date.now()): TaskFreshness {
  const lastUpdateTs = task.updatedAtTs ?? task.startedAtTs ?? null
  const stillActive =
    !task.cancelRequested &&
    !task.finishedAtTs &&
    ACTIVE_TASK_STATUS.has(String(task.status ?? '').trim())
  if (!stillActive || typeof lastUpdateTs !== 'number' || !Number.isFinite(lastUpdateTs)) {
    return { stale: false, lastUpdateTs }
  }
  const ageHours = (nowMs / 1000 - lastUpdateTs) / 3600
  return { stale: ageHours > TASK_STALE_AFTER_HOURS, lastUpdateTs }
}
