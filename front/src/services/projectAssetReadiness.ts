/**
 * 项目资产准备清单（`GET /api/v1/studio/projects/{id}/asset-readiness`）。
 *
 * 为什么单独一个前端模块：这是「资产准备」这一步的**唯一数据源**。
 * 此前页面把状态建立在若干接口**偶然**暴露的字段上：
 * 角色走实体列表（读模型里有 `image_prompts`），场景/道具/服装走项目关联行
 * （读模型里没有），于是「在资产准备页保存了场景提示词，返回后仍显示待完善」。
 * 现在四类资产都读这一份清单里的同一组布尔标志：
 * `has_pending_candidate / has_image_prompt / has_image / has_primary`。
 *
 * 后端实现见 `backend/app/services/studio/project_asset_readiness.py`。
 */

import { callApi } from './llmPipelineApi'

export type ProjectAssetReadinessType = 'character' | 'scene' | 'prop' | 'costume'

export type ProjectAssetReadinessItem = {
  asset_type: ProjectAssetReadinessType
  asset_id: string
  name: string
  /** 本项目内还有同类型同名的未确认提取候选 */
  has_pending_candidate: boolean
  /** 已保存图片提示词（`image_prompts` 里有非空槽位） */
  has_image_prompt: boolean
  /** 已有图片（图片表里有 `file_id` 非空的行；自动补出的空槽位不算） */
  has_image: boolean
  /** 已设为定版（上述行里有 `is_primary`） */
  has_primary: boolean
  /** 当前首选图地址（空串 = 还没有图） */
  thumbnail: string
  /** 当前首选图的行 ID —— 「设为定版」的默认目标 */
  image_id: number | null
}

export type ProjectAssetReadinessSummary = {
  total: number
  asset_counts: Record<string, number>
  with_image_prompt: number
  with_image: number
  with_primary: number
  done: number
  all_done: boolean
}

export type ProjectAssetReadiness = {
  project_id: string
  items: ProjectAssetReadinessItem[]
  summary: ProjectAssetReadinessSummary
}

/** 空清单（`data` 缺失时用；调用方据 `items.length` 判断有没有可准备的资产）。 */
export const EMPTY_PROJECT_ASSET_READINESS: ProjectAssetReadiness = {
  project_id: '',
  items: [],
  summary: {
    total: 0,
    asset_counts: {},
    with_image_prompt: 0,
    with_image: 0,
    with_primary: 0,
    done: 0,
    all_done: false,
  },
}

/**
 * 拉取项目资产准备清单。
 *
 * 载荷不合法时**抛出**（而不是回一个空清单）：空清单会被上层当成
 * 「这个项目还没有资产」，把接口故障伪装成业务状态；抛错则由上层记为
 * 「取数失败」，相关数量保持 null（不冒充实数）。
 */
export async function fetchProjectAssetReadiness(projectId: string): Promise<ProjectAssetReadiness> {
  const data = await callApi<ProjectAssetReadiness | null>(
    `/api/v1/studio/projects/${encodeURIComponent(projectId)}/asset-readiness`,
  )
  if (!data || !Array.isArray(data.items)) {
    throw new Error('资产准备接口没有返回资产清单')
  }
  return { ...data, summary: data.summary ?? EMPTY_PROJECT_ASSET_READINESS.summary }
}
