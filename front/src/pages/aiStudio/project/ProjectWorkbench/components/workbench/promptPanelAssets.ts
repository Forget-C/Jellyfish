/**
 * 工作台 → 「生成图片提示词」面板的**资产行集**（纯逻辑，可 `node --test` 直接跑）。
 *
 * 为什么单独一个模块（真实事故的根因之一）：
 * 面板拿到的行集必须是**用户在这次操作里勾选的那些资产**，而且键必须与工作台的选择键
 * 完全对得上。此前面板复用了出图结果区的转换函数 `toSignalAssets`，它有两处与"选择键"
 * 不同口径的地方，正好会在这一步悄悄改变范围或数量：
 *
 *   1. 它**丢掉服装**（`asset_type === 'costume'` 直接过滤掉）——那是出图服务的契约限制
 *      （服装不走那条批量出图通道），但"生成图片提示词"对服装是支持的（有正/侧槽位）。
 *      于是：勾了 1 件服装时，顶部按钮说「生成图片提示词（4）」，
 *      弹窗标题说「已选 4 项」，面板里却只有 3 行 —— 用户勾的那一项根本没进来。
 *   2. 它把未知类型**兜底成角色**，而工作台的选择键由 `workbenchItemKey` 生成
 *      （同一套兜底）。这一条两边是一致的，所以本模块**统一用 `workbenchItemKey`**，
 *      不再各写一套映射：键对不上就会"过滤成空"，空行集是最容易被误当成
 *      "那就把全部资产都拿进来"的信号，本模块**永远返回明确的空**，绝不回退到全部。
 *
 * 另外一条：本章只有资料记录、还没有建出真实资产的行（`asset_id` 为空）
 * **不能被送进面板** —— 面板是按 `asset_id` 逐项发请求的，空 id 连实体详情都读不到，
 * 结果是"按钮说 4 项、实际只发出 2 次请求"，而且失败会打断后面的项。
 * 这类行如实列出来、并说清怎么补，不假装它们能生成。
 */

import type { ProjectSignalAsset } from '../../hooks/useProjectStepSignals'
import {
  workbenchItemKey,
  workbenchItemName,
  workbenchItemType,
  type WorkbenchItemLike,
} from './workbenchState.ts'

/** 面板/结果区认识的资产形状（与 `ProjectSignalAsset` 同构；本模块只填真实字段）。 */
export type PromptPanelAssetLike = ProjectSignalAsset

export type SkippedPromptPanelAsset = {
  /** 工作台里的选择键（可用于回到那一项） */
  key: string
  name: string
  /** 用户语言的原因（为什么它这次生成不了） */
  reason: string
}

export type PromptPanelAssetsResult = {
  /** **只**包含勾选且能生成的那些资产；顺序 = 工作台清单顺序 */
  assets: PromptPanelAssetLike[]
  /** 勾了、但这次无法生成的那些项（如实列出，不静默丢弃） */
  skipped: SkippedPromptPanelAsset[]
}

/** `asset_id` 为空的行：本章只有资料记录、还没有对应资产。 */
export const NO_ASSET_ID_REASON = '这一项在本章只有资料记录、还没有建出对应资产：先在资产准备页确认写入这一项，再回来生成提示词。'

/** 选择键在清单里找不到对应项：清单可能刚重算过。 */
export const STALE_SELECTION_REASON = '这一项已不在本章资产清单里：请重新分析本章资产后再勾选。'

/** 选择键与清单键必须完全同口径（面板行的 key 就是它）。 */
export function promptPanelAssetKey(asset: PromptPanelAssetLike): string {
  return `${asset.type}:${String(asset.id ?? '')}`
}

/**
 * 把「工作台清单 + 用户选择键」转成面板的资产行集。
 *
 * 硬约束（有单测钉住）：
 *   - 返回的行**只**来自 `selectedKeys`（没勾的一项都不出现；没勾就是空数组，不回退到全部）；
 *   - 每一行的键 `promptPanelAssetKey(row)` 一定在 `selectedKeys` 里（键对齐）；
 *   - 同一项资产只出现一次（键去重）；
 *   - 服装**不丢**（它与角色/场景/道具一样能生成提示词）；
 *   - `asset_id` 为空的项不进 `assets`，进 `skipped` 并带上原因。
 */
export function selectPromptPanelAssets(
  items: readonly WorkbenchItemLike[],
  selectedKeys: readonly string[],
): PromptPanelAssetsResult {
  const wanted = new Set(selectedKeys.map((key) => String(key)))
  const assets: PromptPanelAssetLike[] = []
  const skipped: SkippedPromptPanelAsset[] = []
  const seen = new Set<string>()

  items.forEach((item) => {
    const key = workbenchItemKey(item)
    if (!wanted.has(key)) return
    if (seen.has(key)) return
    seen.add(key)
    const name = workbenchItemName(item)
    const assetId = String(item.asset_id ?? '').trim()
    if (!assetId) {
      skipped.push({ key, name, reason: NO_ASSET_ID_REASON })
      return
    }
    assets.push({
      id: assetId,
      name,
      type: workbenchItemType(item),
      hasImage: item.image?.has_image === true,
      thumbnail: item.image?.thumbnail ?? '',
      hasPrimary: item.image?.has_primary === true,
      imageId: typeof item.image?.image_id === 'number' ? item.image.image_id : null,
      hasImagePrompt: Boolean(String(item.prompt?.text ?? '').trim()),
      hasPendingCandidate: false,
    })
  })

  // 勾了、但清单里没有对应项（清单刚重算过）：如实说出来，别让它静默消失
  wanted.forEach((key) => {
    if (seen.has(key)) return
    skipped.push({ key, name: key, reason: STALE_SELECTION_REASON })
  })

  return { assets, skipped }
}

/**
 * 把 `skipped` 渲染成一句中文说明（空数组 → 空串，页面不显示空提示）。
 *
 * 为什么要把"为什么"写全：用户点了「生成图片提示词（4）」却只发生 2 次生成，
 * 页面必须当场说清剩下 2 项各自为什么没生成，而不是让数量对不上。
 */
export function describeSkippedPromptPanelAssets(
  skipped: readonly SkippedPromptPanelAsset[],
): string {
  if (skipped.length === 0) return ''
  return skipped.map((row) => `${row.name}：${row.reason}`).join(' ')
}

/**
 * 「有 N 项还没有建出对应资产」的中文说明（用户语言；页面直接展示）。
 *
 * 这是"按钮上的数字与实际调用次数对不上"时唯一的解释，必须能单独跑：空数组 → 空串
 * （页面不显示空提示），有名字时逐项列出来，别让用户猜少了哪几项。
 */
export function describeUnrequestableAssets(names: readonly string[]): string {
  const list = names.map((name) => String(name ?? '').trim()).filter((name) => name.length > 0)
  if (list.length === 0) return ''
  return `有 ${list.length} 项还没有建出对应资产，本次不会生成：${list.join('、')}`
}
