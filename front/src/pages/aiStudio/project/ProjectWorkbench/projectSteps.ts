/**
 * 项目工作台「生产步骤」模型。
 *
 * 用户可见的是**五步**（第二部分统一口径，见 `DISPLAY_STEPS`）：
 *   1. 剧本与分镜 → 2. 资产准备 → 3. 整集视频提示词 → 4. 资产与声音绑定 → 5. 生成与交付
 * 内部的 key 仍是下面这 6 个（旧深链、旧字段一律保留可用）：
 *   script → extract_assets → image_prep → video_prompt → binding → generate_deliver
 * 其中 `extract_assets` 与 `image_prep` **共同**构成用户看到的第 2 步「资产准备」，
 * 页面把两块内容渲染在同一步里，形成连续流程。
 *
 * 「从视频提示词开始」的项目：第一步显示为「已跳过：提示词起步」，判定直接落在
 * 整集提示词看板，不再要求先有剧本/分镜。
 */

export type ProjectStepKey =
  | 'script'
  | 'extract_assets'
  | 'image_prep'
  | 'video_prompt'
  | 'binding'
  | 'generate_deliver'

/** prep = 工作台内就地渲染；studio = 跳转章节工作室。 */
export type ProjectStepGroup = 'prep' | 'studio'

export type ProjectStepMeta = {
  key: ProjectStepKey
  label: string
  description: string
  group: ProjectStepGroup
}

/** 六步定义，顺序即流程顺序（第 1-3 步 prep，第 4-6 步 studio）。 */
export const PROJECT_STEPS: ProjectStepMeta[] = [
  {
    key: 'script',
    label: '剧本',
    description: '录入或导入本集剧本原文，作为后续分镜提取的唯一输入',
    group: 'prep',
  },
  {
    key: 'extract_assets',
    label: '资产准备',
    description: '确认人物/场景/道具/服装 → 审核 → 关联或新建 → 图片提示词 → 图片 → 定版',
    group: 'prep',
  },
  {
    key: 'image_prep',
    label: '图片准备',
    description: '为角色、场景、道具准备参考图片与图片提示词，锁定全片视觉一致性',
    group: 'prep',
  },
  {
    key: 'video_prompt',
    label: '视频提示词',
    description: '为每个镜头编写或导入视频提示词',
    group: 'studio',
  },
  {
    key: 'binding',
    label: '关联绑定',
    description: '把角色、场景、道具绑定到对应镜头，确保生成时选用正确参考图',
    group: 'studio',
  },
  {
    key: 'generate_deliver',
    label: '生成与交付',
    description: '生成镜头视频、检查成片并导出交付',
    group: 'studio',
  },
]

/**
 * 用户可见的**五步**。
 *
 * `stepKeys` 是该展示步骤覆盖的内部 key（第 2 步覆盖 `extract_assets` 与 `image_prep`），
 * 这样内部路由/深链不用改，步骤条也能按五步展示。
 */
export type DisplayStep = {
  key: string
  label: string
  description: string
  stepKeys: ProjectStepKey[]
}

export const DISPLAY_STEPS: DisplayStep[] = [
  {
    key: 'script_shots',
    label: '剧本与分镜',
    description: '录入或导入剧本（TXT / MD / DOCX），拆分或手工编辑分镜',
    stepKeys: ['script'],
  },
  {
    key: 'asset_prep',
    label: '资产准备',
    description:
      '按本章剧本整理人物、场景、道具、服装 → 补齐资产资料 → 生成图片提示词 → 生成或上传图片 → 设为定版',
    stepKeys: ['extract_assets', 'image_prep'],
  },
  {
    key: 'episode_prompt',
    label: '整集视频提示词',
    description: '整集批量生成或批量导入提示词，统一预览确认后再进工作室逐镜检查',
    stepKeys: ['video_prompt'],
  },
  {
    key: 'asset_binding',
    label: '资产与声音绑定',
    description: '把角色、场景、道具与声音绑定到对应镜头',
    stepKeys: ['binding'],
  },
  {
    key: 'generate_deliver',
    label: '生成与交付',
    description: '生成镜头视频、检查成片并导出交付',
    stepKeys: ['generate_deliver'],
  },
]

/** 内部 step key → 用户可见的五步序号（0 起）与展示信息。 */
export function getDisplayStepIndex(key: ProjectStepKey): number {
  const index = DISPLAY_STEPS.findIndex((step) => step.stepKeys.includes(key))
  return index >= 0 ? index : 0
}

export function getDisplayStep(key: ProjectStepKey): DisplayStep {
  return DISPLAY_STEPS[getDisplayStepIndex(key)] ?? DISPLAY_STEPS[0]
}

/** 展示步骤对应的「主」内部 key（点击步骤条时用，第 2 步落在 `extract_assets`）。 */
export function getDisplayStepEntryKey(step: DisplayStep): ProjectStepKey {
  return step.stepKeys[0]
}

/** 默认落地步骤：全新项目没有章节时落在「剧本」。 */
export const DEFAULT_PROJECT_STEP: ProjectStepKey = 'script'

const PROJECT_STEP_KEYS: ProjectStepKey[] = PROJECT_STEPS.map((step) => step.key)

/** 纯类型守卫：URL 里的任意字符串 → 六步 key。 */
export function isProjectStepKey(value: string): value is ProjectStepKey {
  return PROJECT_STEP_KEYS.includes(value as ProjectStepKey)
}

export function getProjectStepMeta(key: ProjectStepKey): ProjectStepMeta {
  return PROJECT_STEPS.find((step) => step.key === key) ?? PROJECT_STEPS[0]
}

export function getProjectStepIndex(key: ProjectStepKey): number {
  const index = PROJECT_STEP_KEYS.indexOf(key)
  return index >= 0 ? index : 0
}

export function isStudioProjectStep(key: ProjectStepKey): boolean {
  return getProjectStepMeta(key).group === 'studio'
}

/** 下一步（第 6 步没有下一步，返回 null）。 */
export function getNextProjectStepKey(key: ProjectStepKey): ProjectStepKey | null {
  const index = getProjectStepIndex(key)
  return index < 0 || index >= PROJECT_STEPS.length - 1 ? null : PROJECT_STEPS[index + 1].key
}

/** 上一步（第 1 步没有上一步，返回 null）。 */
export function getPrevProjectStepKey(key: ProjectStepKey): ProjectStepKey | null {
  const index = getProjectStepIndex(key)
  return index <= 0 ? null : PROJECT_STEPS[index - 1].key
}

/**
 * resolveProjectStep 的输入：一份「轻量、可缺失」的项目状态快照。
 *
 * 口径说明（重要）：
 * - `chapterCount` / `chaptersWithTextCount` / 资产类字段是**项目级**口径；
 * - `shotCount` / `shotsWithVideoPromptCount` / `shotsWithAssetLinkCount` 调用方可以传
 *   **当前集口径**（工作台就是这么做：第 1-2 步与当前集相关，4-6 步本身也是章节级的）。
 *   未指定当前集时按整个项目口径传入同样成立。
 * - 所有字段都允许缺失/为 null/为脏值：缺失一律按 0 处理，函数永不抛错。
 *   未知（拿不到数据）时只会**停在前面的步骤**，不会跳步。
 * - 唯一例外是 `assetsWithImagePromptCount`：本环境的实体列表接口
 *   （scene/prop/costume 的 `_asset_read_payload`）**根本不返回** `image_prompts` 字段，
 *   抓不到时传 null 表示「无法判定」，此时不阻塞「图片准备」的完成判定，
 *   否则项目会被永久钉在第 3 步。
 */
export type ProjectStepInput = {
  /**
   * 项目起点（`projects.start_mode`）。
   * - `script`（默认）：剧本 → 分镜 → 资产 → …
   * - `prompts`：创建即自动建默认章节，直接进整集提示词看板；不要求先有剧本/分镜。
   */
  startMode?: 'script' | 'prompts' | null
  /** 项目章节总数 */
  chapterCount?: number | null
  /** 已录入原文（rawText 非空）的章节数 */
  chaptersWithTextCount?: number | null
  /** 镜头总数（默认按当前集口径传入） */
  shotCount?: number | null
  /** 项目资产数量：角色 / 场景 / 道具（+ 服装，可选） */
  assetCounts?: {
    characters?: number | null
    scenes?: number | null
    props?: number | null
    costumes?: number | null
  } | null
  /** 已有参考图片的资产数量（后端 thumbnail 非空即视为已有图） */
  assetImageCount?: number | null
  /** 已保存图片提示词的资产数量；null/undefined = 无法判定 */
  assetsWithImagePromptCount?: number | null
  /**
   * 已设为定版（`is_primary`）的资产数量；null/undefined = 无法判定。
   *
   * 判定口径（收口要求）：资产准备要**全部资产都到达已定版**才算就绪，
   * 不能因为存在一项定版图就把整步判为完成。无法判定时不阻塞（沿用 image_prompts 的宽容策略）。
   */
  assetsWithPrimaryCount?: number | null
  /** 已填写 video_prompt 的镜头数（分镜可能比镜头多，这里按分镜行统计） */
  shotsWithVideoPromptCount?: number | null
  /** 已关联资产（角色/场景/道具/服装）的镜头数 */
  shotsWithAssetLinkCount?: number | null
}

export type ProjectStepResolution = {
  /** 当前所处的（第一个未完成的）步骤 */
  step: ProjectStepKey
  /** 步骤中文名 */
  label: string
  /** 为什么判定在这一步（中文，可直接展示） */
  reason: string
  /** 主按钮文案，例如「录入剧本」 */
  nextActionLabel: string
  /** 该步骤还缺什么（中文短语，可直接展示；可能为空数组） */
  missing: string[]
}

const NEXT_ACTION_LABEL: Record<ProjectStepKey, string> = {
  script: '剧本与分镜',
  extract_assets: '开始资产准备',
  image_prep: '继续资产准备',
  video_prompt: '编写视频提示词',
  binding: '关联绑定资产',
  generate_deliver: '进入生成与交付',
}

function toCount(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/** null / undefined / NaN → null（表示“无法判定”），其余按非负整数返回。 */
function toOptionalCount(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : null
}

function buildResolution(step: ProjectStepKey, reason: string, missing: string[]): ProjectStepResolution {
  return {
    step,
    label: getProjectStepMeta(step).label,
    reason,
    nextActionLabel: NEXT_ACTION_LABEL[step],
    missing,
  }
}

/**
 * 判定「当前未完成步骤」。
 *
 * 优先级（从上到下命中即返回）：
 *   1. 没有章节，或没有任何章节原文                    → script
 *   2. 有章节原文，但（当前集）分镜数为 0               → script
 *   3. 已有分镜，但项目资产（角色/场景/道具）全为空      → extract_assets
 *   4. 已有资产，但资产没有参考图片（或已知没保存图片提示词）→ image_prep
 *   5. 已有图片，但（当前集）镜头都没有 video_prompt     → video_prompt
 *   6. 已有提示词，但（当前集）镜头都没有关联资产        → binding
 *   7. 以上都满足                                      → generate_deliver
 *
 * 防御性：任何字段缺失/为脏值都按 0（或“无法判定”）处理，函数不抛异常。
 */
export function resolveProjectStep(input?: ProjectStepInput | null): ProjectStepResolution {
  const source = input ?? {}

  const chapterCount = toCount(source.chapterCount)
  const chaptersWithTextCount = toCount(source.chaptersWithTextCount)
  const shotCount = toCount(source.shotCount)
  const characters = toCount(source.assetCounts?.characters)
  const scenes = toCount(source.assetCounts?.scenes)
  const props = toCount(source.assetCounts?.props)
  // 第 3 步的完成判定只看角色/场景/道具三类（服装是可选补充，不阻塞流程）。
  const totalAssets = characters + scenes + props
  const assetImageCount = toCount(source.assetImageCount)
  const assetsWithImagePromptCount = toOptionalCount(source.assetsWithImagePromptCount)
  const assetsWithPrimaryCount = toOptionalCount(source.assetsWithPrimaryCount)
  const shotsWithVideoPromptCount = toCount(source.shotsWithVideoPromptCount)
  const shotsWithAssetLinkCount = toCount(source.shotsWithAssetLinkCount)

  // 「从视频提示词开始」的项目：第一步（剧本与分镜）显示为「已跳过：提示词起步」，
  // 判定不再要求先有剧本/分镜原文，直接落在整集提示词看板；资产/绑定/交付仍按下面的规则推进。
  if (source.startMode === 'prompts') {
    if (chapterCount <= 0) {
      return buildResolution('script', '提示词起步的项目需要至少一个章节来承载镜头', ['还没有创建任何章节'])
    }
    if (shotsWithVideoPromptCount <= 0) {
      return buildResolution('video_prompt', '提示词起步：先在整集提示词看板导入或批量生成提示词', [
        '还没有任何视频提示词',
      ])
    }
    if (totalAssets <= 0) {
      return buildResolution('extract_assets', '已有视频提示词，但项目还没有角色/场景/道具资产', [
        '还没有项目资产（角色 / 场景 / 道具）',
      ])
    }
    const hasAssetImagesPrompts = assetsWithImagePromptCount === null ? assetImageCount > 0 : assetsWithImagePromptCount > 0
    if (!hasAssetImagesPrompts) {
      return buildResolution('image_prep', '资产已建立，但参考图片/图片提示词还没准备好', [
        '资产还没有参考图片或图片提示词',
      ])
    }
    if (shotsWithAssetLinkCount <= 0) {
      return buildResolution('binding', '已有提示词与资产，接下来把资产与声音绑定到镜头', ['镜头还没有关联任何资产'])
    }
    return buildResolution('generate_deliver', '主流程前置条件已就绪，可以进入视频生成与交付', [])
  }

  // 1. 没有章节，或没有任何章节原文 → 剧本
  if (chapterCount <= 0) {
    return buildResolution('script', '项目还没有章节，流程从录入剧本开始', ['还没有创建任何章节'])
  }
  if (chaptersWithTextCount <= 0) {
    const missing = [
      chapterCount > 1
        ? `${chapterCount} 个章节都还没有原文`
        : '第 1 集还没有剧本原文',
    ]
    return buildResolution('script', '还没有任何章节原文，先补剧本再提取分镜', missing)
  }

  // 2. 有原文但没有分镜 → 剧本（在剧本步完成「一键提取分镜」）
  if (shotCount <= 0) {
    return buildResolution('script', '已有章节原文，但还没有分镜，先在剧本步提取分镜', [
      '当前集还没有分镜',
    ])
  }

  // 3. 有分镜但没有项目资产 → 提取资产
  if (totalAssets <= 0) {
    return buildResolution('extract_assets', '已有分镜，但项目还没有角色/场景/道具资产', [
      '还没有项目资产（角色 / 场景 / 道具）',
    ])
  }

  // 4. 资产准备：提示词 → 图片 → 定版，三步都齐（且**全部资产**齐）才算过
  const hasAssetImages = assetImageCount > 0
  const hasAssetImagePrompts =
    assetsWithImagePromptCount === null ? hasAssetImages : assetsWithImagePromptCount > 0
  // 定版口径：可判定时必须「全部资产已定版」；无法判定时退回「至少有一张图」
  const allAssetsHavePrimary =
    assetsWithPrimaryCount === null ? hasAssetImages : assetsWithPrimaryCount >= totalAssets
  if (!hasAssetImages || !hasAssetImagePrompts || !allAssetsHavePrimary) {
    const missing: string[] = []
    if (!hasAssetImages) {
      missing.push(`${totalAssets} 个资产还没有参考图片`)
    }
    if (!hasAssetImagePrompts) {
      missing.push('资产还没有保存图片提示词')
    }
    if (!allAssetsHavePrimary && assetsWithPrimaryCount !== null) {
      missing.push(`还有 ${Math.max(0, totalAssets - assetsWithPrimaryCount)} 个资产没有设定版图`)
    }
    return buildResolution('image_prep', '资产准备未完成：提示词 / 图片 / 定版还有缺口', missing)
  }

  // 5. 有图片但镜头没有视频提示词 → 视频提示词
  if (shotsWithVideoPromptCount <= 0) {
    return buildResolution('video_prompt', '资产图片已就绪，接下来为镜头编写视频提示词', [
      `${shotCount} 个镜头都还没有视频提示词`,
    ])
  }

  // 6. 有提示词但镜头没有关联资产 → 关联绑定
  if (shotsWithAssetLinkCount <= 0) {
    return buildResolution('binding', '已有视频提示词，但镜头还没有绑定角色/场景/道具', [
      '镜头还没有关联任何资产',
    ])
  }

  // 7. 都满足 → 生成与交付
  const missing: string[] = []
  if (shotsWithVideoPromptCount < shotCount) {
    missing.push(`还有 ${shotCount - shotsWithVideoPromptCount} 个镜头没有视频提示词`)
  }
  if (shotsWithAssetLinkCount < shotCount) {
    missing.push(`还有 ${shotCount - shotsWithAssetLinkCount} 个镜头没有关联资产`)
  }
  // 第 3 步的通过阈值是「至少有一个资产保存了图片提示词」（不能要求全都保存，
  // 否则永远过不去）。但剩余量必须显式说出来，否则用户会以为图片准备已经做完了。
  if (assetsWithImagePromptCount !== null && assetsWithImagePromptCount < totalAssets) {
    missing.push(`还有 ${totalAssets - assetsWithImagePromptCount} 个资产没有保存图片提示词`)
  }
  if (assetImageCount < totalAssets) {
    missing.push(`还有 ${totalAssets - assetImageCount} 个资产没有参考图片`)
  }
  return buildResolution('generate_deliver', '主流程前置条件已就绪，可以进入视频生成与交付', missing)
}
