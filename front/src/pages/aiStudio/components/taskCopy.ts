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
    runningDescription: '任务完成后会自动刷新资产与对白候选，无需手动刷新页面。',
    cancellingDescription: '已发送取消请求，系统会在当前步骤结束后停止，并在结束后自动刷新页面。',
    successDescription: '资产提取已完成，候选内容已自动刷新。',
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
  text_chat: '文本生成',
  script_merge: '实体合并',
  script_variant: '变体分析',
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

export function resolveTaskTitle(taskKind?: string | null): string {
  if (!taskKind) return '后台任务'
  return TASK_KIND_TITLE_MAP[taskKind] ?? taskKind.split('_').join(' ')
}

export function resolveTaskSourceLabel(
  relationType?: string | null,
  relationEntityId?: string | null,
): string | null {
  if (!relationType) return null
  const label = RELATION_TYPE_LABEL_MAP[relationType] ?? '关联对象'
  if (!relationEntityId) return label
  return `${label}：${relationEntityId}`
}
