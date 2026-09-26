/**
 * 「提取候选 → 确认资产」的纯逻辑（不依赖 React，可直接 `node --test`）。
 *
 * 为什么必须抽出来：确认这一步有三条分支，而且现在支持「勾选多条一次确认」，
 * 入参（哪些候选、哪些镜头、关联到谁）和计数都必须可测，不能散在 JSX 里。
 *
 * 用户语言口径（与页面文案一致）：
 *   - 角色：**关联全局演员（人物资产）** / **新建项目角色**
 *   - 场景、道具、服装：**关联资产库已有资产** / **新建资产**
 *
 * 三个动作的落地含义（调用方按 `action` 决定打哪个既有接口）：
 *   - `link_existing`：把候选挂到资产库里那份**已有资产**上（必要时先把它关联到项目/镜头）；
 *   - `link_actor`：把候选挂到一个**绑定了全局演员**的项目角色上（项目内已有同名角色就直接复用）；
 *   - `create_new`：在项目里**新建**一份资产（角色可选带演员绑定），再把候选挂上去。
 */

export type ConfirmAssetKind = 'character' | 'scene' | 'prop' | 'costume'

/** 确认方式：只有「关联已有」和「新建」两条路，角色那条对应「关联全局演员」。 */
export type ConfirmStrategy = 'link_existing' | 'link_actor' | 'create_new'

/** 实际执行动作（与执行分支一一对应）。 */
export type ConfirmAction = ConfirmStrategy

export type ConfirmKindLabel = {
  /** 资产类型（角色 / 场景 / 道具 / 服装） */
  label: string
  /** 关联已有时的来源名称（全局演员库 / 资产库） */
  linkSourceLabel: string
}

export const CONFIRM_KIND_META: Record<ConfirmAssetKind, ConfirmKindLabel> = {
  character: { label: '角色', linkSourceLabel: '全局演员库' },
  scene: { label: '场景', linkSourceLabel: '资产库' },
  prop: { label: '道具', linkSourceLabel: '资产库' },
  costume: { label: '服装', linkSourceLabel: '资产库' },
}

export function confirmKindLabel(kind: ConfirmAssetKind): string {
  return CONFIRM_KIND_META[kind].label
}

export type ConfirmStrategyOption = {
  value: ConfirmStrategy
  /** 用户看到的选项名 */
  label: string
  /** 需要用户再选一个具体目标（一位全局演员 / 一份资产库资产） */
  requiresTarget: boolean
  /** 选择这个方式会发生什么（用户语言） */
  hint: string
}

/**
 * 某一类资产可选的确认方式。
 *
 * 角色的「关联已有」在用户语言里就是「关联全局演员（人物资产）」——
 * 项目角色必须绑定一位演员，否则后续出图拿不到人物形象。
 */
export function strategyOptionsFor(kind: ConfirmAssetKind): ConfirmStrategyOption[] {
  if (kind === 'character') {
    return [
      {
        value: 'link_actor',
        label: '关联全局演员（人物资产）',
        requiresTarget: true,
        hint: '从全局演员库选一位演员，确认后这个角色会绑定该演员的人物形象。',
      },
      {
        value: 'create_new',
        label: '新建项目角色',
        requiresTarget: false,
        hint: '在项目里新建一个角色，之后再挑演员或直接出图。',
      },
    ]
  }
  return [
    {
      value: 'link_existing',
      label: '关联资产库已有资产',
      requiresTarget: false,
      hint: '直接用资产库里那份同名资产（没有同名资产时请改用「新建」）。',
    },
    {
      value: 'create_new',
      label: '新建资产',
      requiresTarget: false,
      hint: '在项目里新建一份资产。',
    },
  ]
}

/** 候选聚合组（表格一行）里参与确认的部分。 */
export type ConfirmGroupInput = {
  key: string
  kind: ConfirmAssetKind
  name: string
  /** 这一组对应的候选行 id（确认时要逐条标记） */
  candidateIds: number[]
  /** 这一组出现在哪些镜头（关联已有资产时要逐镜头关联） */
  shotIds: string[]
}

/** 同名资产存在性（对账结果）入参。 */
export type ConfirmExistenceInput = {
  exists?: boolean
  assetId?: string | null
  /** 已挂在本项目上 */
  linkedToProject?: boolean
}

/** 用户在弹窗里对某一行做过的选择（没选就用默认）。 */
export type ConfirmChoice = {
  strategy?: ConfirmStrategy
  /** 「关联资产库已有资产」选中的资产 id */
  targetAssetId?: string | null
  /** 「关联全局演员」选中的演员 id */
  actorId?: string | null
}

/**
 * 某一行的默认确认方式。
 *
 * 默认值的原则是「不制造重复、不需要额外操作就能确认」：
 *   - 项目/资产库里已有同名资产 → 默认关联它（角色即「关联已有」）；
 *   - 没有同名资产 → 默认新建（角色新建后仍可在弹窗里改成关联全局演员）。
 */
export function defaultStrategyFor(
  kind: ConfirmAssetKind,
  existence: ConfirmExistenceInput | undefined,
): ConfirmStrategy {
  const hasExisting = Boolean(existence?.exists && existence?.assetId)
  if (hasExisting) return kind === 'character' ? 'link_actor' : 'link_existing'
  return 'create_new'
}

export type ConfirmTargetResolution = {
  action: ConfirmAction
  strategy: ConfirmStrategy
  /** 「关联已有」要用的资产 id（角色复用同名角色 / 其他类关联库资产） */
  targetAssetId: string
  /** 「关联全局演员」选中的演员 id */
  actorId: string
  /**
   * 目标资产**已经在项目里**：只需把候选挂上去，不用再逐镜头关联、也不用新建。
   */
  reuseProjectAsset: boolean
  /** 这一行现在能不能确认；false 时看 `blockedReason` */
  ready: boolean
  blockedReason: string
}

/**
 * 解析某一行「要关联到谁 / 要不要新建」。
 *
 * 这是确认动作的唯一判定入口：逐条确认、勾选多条确认、弹窗里的即时预览都走它，
 * 避免三处各写一套分支。
 */
export function resolveConfirmTarget(args: {
  group: ConfirmGroupInput
  existence?: ConfirmExistenceInput
  choice?: ConfirmChoice
}): ConfirmTargetResolution {
  const { group, existence, choice } = args
  const strategy = choice?.strategy ?? defaultStrategyFor(group.kind, existence)
  const existingAssetId = String(existence?.assetId ?? '').trim()
  const reuseProjectAsset = Boolean(existence?.exists && existingAssetId && existence?.linkedToProject)
  const pickedAssetId = String(choice?.targetAssetId ?? '').trim()
  const pickedActorId = String(choice?.actorId ?? '').trim()

  const base = {
    action: strategy,
    strategy,
    actorId: pickedActorId,
  } as const

  if (group.kind === 'character') {
    if (reuseProjectAsset) {
      // 项目里已经有同名角色：直接挂上去，不重复新建，也不改它的演员绑定。
      return {
        ...base,
        targetAssetId: existingAssetId,
        reuseProjectAsset: true,
        ready: true,
        blockedReason: '',
      }
    }
    if (strategy === 'link_actor' && !pickedActorId) {
      return {
        ...base,
        targetAssetId: '',
        reuseProjectAsset: false,
        ready: false,
        blockedReason: '请选择要关联的全局演员（人物资产）',
      }
    }
    return {
      ...base,
      targetAssetId: '',
      reuseProjectAsset: false,
      ready: true,
      blockedReason: '',
    }
  }

  if (strategy === 'link_existing') {
    const targetAssetId = pickedAssetId || existingAssetId
    if (!targetAssetId) {
      return {
        ...base,
        targetAssetId: '',
        reuseProjectAsset: false,
        ready: false,
        blockedReason: '资产库里还没有可关联的同名资产，请改用「新建资产」',
      }
    }
    return {
      ...base,
      targetAssetId,
      // 目标就是库里的那份资产，且它已在本项目 → 只挂候选
      reuseProjectAsset: targetAssetId === existingAssetId && reuseProjectAsset,
      ready: true,
      blockedReason: '',
    }
  }

  return {
    ...base,
    targetAssetId: '',
    reuseProjectAsset: false,
    ready: true,
    blockedReason: '',
  }
}

export type ConfirmPlanItem = {
  key: string
  kind: ConfirmAssetKind
  kindLabel: string
  name: string
  strategy: ConfirmStrategy
  strategyLabel: string
  action: ConfirmAction
  /** 逐条标记候选时要用的 id（确认入参） */
  candidateIds: number[]
  /** 逐镜头关联已有资产时要用的镜头 id（确认入参） */
  shotIds: string[]
  targetAssetId: string
  actorId: string
  reuseProjectAsset: boolean
}

export type ConfirmPlanBlocked = {
  key: string
  name: string
  reason: string
}

export type ConfirmPlan = {
  /** 可以立刻确认的行（按勾选顺序） */
  items: ConfirmPlanItem[]
  /** 还不能确认的行及原因 */
  blocked: ConfirmPlanBlocked[]
  counts: {
    /** 可确认的行数 */
    total: number
    /** 关联资产库已有资产的行数 */
    linkExisting: number
    /** 关联全局演员的行数 */
    linkActor: number
    /** 新建的行数 */
    createNew: number
    /** 还不能确认的行数 */
    blocked: number
    /** 一共会标记多少条候选 */
    candidateCount: number
    /** 覆盖多少个镜头 */
    shotCount: number
  }
}

function strategyLabelOf(kind: ConfirmAssetKind, strategy: ConfirmStrategy): string {
  return strategyOptionsFor(kind).find((option) => option.value === strategy)?.label ?? strategy
}

/** 一组计划项的计数（计划、结果小结、页面按钮文案共用同一套口径）。 */
export function planCounts(items: ConfirmPlanItem[], blockedCount = 0): ConfirmPlan['counts'] {
  return {
    total: items.length,
    linkExisting: items.filter((item) => item.action === 'link_existing').length,
    linkActor: items.filter((item) => item.action === 'link_actor').length,
    createNew: items.filter((item) => item.action === 'create_new').length,
    blocked: blockedCount,
    candidateCount: items.reduce((sum, item) => sum + item.candidateIds.length, 0),
    shotCount: new Set(items.flatMap((item) => item.shotIds)).size,
  }
}

/**
 * 把「勾选的行 + 每行的选择」编译成一份可执行计划。
 *
 * `selectedKeys` 为空时返回空计划（页面据此禁用按钮，而不是猜用户想确认什么）。
 * 没勾选的行**绝不**出现在计划里：批量确认必须只动用户选中的那些。
 */
export function buildConfirmPlan(args: {
  groups: ConfirmGroupInput[]
  selectedKeys: string[]
  existence?: Record<string, ConfirmExistenceInput | undefined>
  choices?: Record<string, ConfirmChoice | undefined>
}): ConfirmPlan {
  const { groups, selectedKeys, existence = {}, choices = {} } = args
  const selected = new Set(selectedKeys)
  const items: ConfirmPlanItem[] = []
  const blocked: ConfirmPlanBlocked[] = []

  groups.forEach((group) => {
    if (!selected.has(group.key)) return
    const resolution = resolveConfirmTarget({
      group,
      existence: existence[group.key],
      choice: choices[group.key],
    })
    if (!resolution.ready) {
      blocked.push({ key: group.key, name: group.name, reason: resolution.blockedReason })
      return
    }
    items.push({
      key: group.key,
      kind: group.kind,
      kindLabel: confirmKindLabel(group.kind),
      name: group.name,
      strategy: resolution.strategy,
      strategyLabel: strategyLabelOf(group.kind, resolution.strategy),
      action: resolution.action,
      candidateIds: [...group.candidateIds],
      shotIds: [...group.shotIds],
      targetAssetId: resolution.targetAssetId,
      actorId: resolution.actorId,
      reuseProjectAsset: resolution.reuseProjectAsset,
    })
  })

  return { items, blocked, counts: planCounts(items, blocked.length) }
}

/**
 * 确认完成后的用户语言小结。
 *
 * 审计 §4.2「基准禁词命中」要求去掉「覆盖 N 条候选」这半句（不许出现「候选」），
 * 但「关联已有 / 绑定共用演员 / 新建」是用户真正要看的确认结果，**必须保留** ——
 * 为了让扫描器干净而把这类信息删掉属于过度整改。
 */
export function summarizeConfirmPlan(plan: ConfirmPlan): string {
  const { counts } = plan
  if (counts.total === 0) return '还没有可确认的资产'
  const parts: string[] = []
  if (counts.linkExisting > 0) parts.push(`关联已有 ${counts.linkExisting}`)
  if (counts.linkActor > 0) parts.push(`绑定共用演员 ${counts.linkActor}`)
  if (counts.createNew > 0) parts.push(`新建 ${counts.createNew}`)
  if (parts.length === 0) return `已确认 ${counts.total} 项资产`
  return `已确认 ${counts.total} 项资产（${parts.join('、')}）`
}

/** 选中行里还有多少行没被处理（用于按钮文案与提示）。 */
export function countPendingSelected(groups: ConfirmGroupInput[], selectedKeys: string[]): number {
  return buildConfirmPlan({ groups, selectedKeys }).counts.total
}
