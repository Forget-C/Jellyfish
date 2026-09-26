/**
 * 新建项目的「起点」与「整体风格」预设（纯逻辑，可单测）。
 *
 * 产品口径（第二部分）：
 * - 先选生产方式：**从剧本开始**（默认）或**从视频提示词开始**；
 * - 再选**项目整体风格**：真人竖屏 / 真人横屏 / 2D / 3D / 其他自定义。
 *
 * 为什么不做成新字段：数据库里已经有承载这三件事的列 ——
 * `visual_style`（现实/动漫）、`style`（题材风格，可自定义）、`default_video_ratio`（画幅）。
 * 预设只是把「整体风格」这一个用户概念**映射**到既有列上，因此后续提示词与出图
 * 复用它们时无需任何迁移：
 *   - 提示词：`build_base` / `shot_video_prompt_pack` 一直读实体与项目的 style / visual_style；
 *   - 画幅：`frame_submit.resolve_target_ratio` 的优先级是 请求 > 镜头 override > **项目默认** > 16:9。
 */

export type ProjectStartModeChoice = 'script' | 'prompts'

export type OverallStyleKey = 'live_portrait' | 'live_landscape' | 'anime_2d' | 'anime_3d' | 'custom'

export type OverallStylePreset = {
  key: OverallStyleKey
  label: string
  description: string
  /** 后端 `projects.visual_style` 取值（现实 / 动漫） */
  visualStyle: '现实' | '动漫' | null
  /** 后端 `projects.style` 取值（预设值；自定义时为 null，由用户自由填写） */
  style: string | null
  /** 后端 `projects.default_video_ratio` 取值 */
  defaultVideoRatio: string | null
}

export const OVERALL_STYLE_PRESETS: OverallStylePreset[] = [
  {
    key: 'live_portrait',
    label: '真人竖屏',
    description: '真人实拍质感，9:16 竖屏（短剧默认）',
    visualStyle: '现实',
    style: '真人都市',
    defaultVideoRatio: '9:16',
  },
  {
    key: 'live_landscape',
    label: '真人横屏',
    description: '真人实拍质感，16:9 横屏',
    visualStyle: '现实',
    style: '真人都市',
    defaultVideoRatio: '16:9',
  },
  {
    key: 'anime_2d',
    label: '2D',
    description: '2D 动画/国漫质感，16:9 横屏',
    visualStyle: '动漫',
    style: '国漫',
    defaultVideoRatio: '16:9',
  },
  {
    key: 'anime_3d',
    label: '3D',
    description: '3D 动画质感，16:9 横屏',
    visualStyle: '动漫',
    style: '动漫3D',
    defaultVideoRatio: '16:9',
  },
  {
    key: 'custom',
    label: '其他自定义',
    description: '自己选视觉风格、视频风格与画面比例',
    visualStyle: null,
    style: null,
    defaultVideoRatio: null,
  },
]

export const START_MODE_OPTIONS: { key: ProjectStartModeChoice; label: string; description: string }[] = [
  {
    key: 'script',
    label: '从剧本开始',
    description: '导入或填写剧本 → 拆分/手工编辑分镜 → 资产准备 → 整集提示词 → 绑定 → 生成或导出',
  },
  {
    key: 'prompts',
    label: '从视频提示词开始',
    description:
      '创建后自动建默认章节，直接进整集提示词看板：批量导入/生成 → 预览确认 → 创建对应镜头 → 继续资产准备或直接绑定',
  },
]

export function getOverallStylePreset(key: OverallStyleKey): OverallStylePreset {
  return OVERALL_STYLE_PRESETS.find((preset) => preset.key === key) ?? OVERALL_STYLE_PRESETS[0]
}

/**
 * 把「整体风格」预设换算成要写进项目的三个字段。
 *
 * 自定义时返回 `null`，调用方改用用户自己填写的视觉风格/视频风格/比例。
 */
export function resolveOverallStyleFields(
  key: OverallStyleKey,
): { visual_style: '现实' | '动漫'; style: string; default_video_ratio: string } | null {
  const preset = getOverallStylePreset(key)
  if (preset.key === 'custom' || !preset.visualStyle || !preset.style || !preset.defaultVideoRatio) return null
  return {
    visual_style: preset.visualStyle,
    style: preset.style,
    default_video_ratio: preset.defaultVideoRatio,
  }
}

/**
 * 新建项目时**最终写入** `projects.default_video_ratio` 的取值（方案 B，2026-09-23 用户拍板）。
 *
 * 口径：
 * - 选中非「其他自定义」的风格时，选择器会把预设画幅**自动填进输入框**（见 ProjectLobby 的 onChange），
 *   让用户看到「存进去的就是这个」；
 * - **用户手填的值优先**（可以在预设基础上改成别的比例，比如真人竖屏改成 16:9）；
 * - 输入框被清空时回落到该风格的预设默认值，而不是留空；
 * - 「其他自定义」没有预设默认值，完全以用户填写为准（可以留空 = 由模型/供应商决定）。
 */
export function resolveProjectVideoRatio(
  overallStyle: OverallStyleKey | undefined,
  typedRatio: string | null | undefined,
): string | null {
  const typed = String(typedRatio ?? '').trim()
  if (typed) return typed
  const presetRatio = overallStyle ? resolveOverallStyleFields(overallStyle)?.default_video_ratio : undefined
  return presetRatio ?? null
}

/** 新建成功后应该落到哪一步（工作台的 `?step=`）。 */
export function resolveLandingStep(startMode: ProjectStartModeChoice): 'script' | 'video_prompt' {
  return startMode === 'prompts' ? 'video_prompt' : 'script'
}
