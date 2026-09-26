/**
 * 「技术详情」的数据装配（纯函数，可与组件分开测试）。
 *
 * 为什么单独一个文件：`TechnicalDetailCollapse.tsx` 是工作台里**唯一**允许出现
 * 内部字段名 / 模型名 / 供应商 / 任务号的组件，装配逻辑再单独放一层，
 * 既方便单测，也让"内部信息只在技术详情"这条边界一眼可见。
 *
 * ## 本文件的职责边界：**只取数、只给结构，不拼任何中文显示标签**
 *
 * 口径（用户拍板）：内部字段名 / 接口路径 / 供应商 / 任务号只允许出现在
 * `components/workbench/TechnicalDetailCollapse.tsx` **一个文件**里，其它文件只传数据。
 * 所以这里的字段一律是「英文路径 + 布尔 + 裸值」：
 *   - `endpointPath` 只放英文路径（例如 `/…/{chapter_id}/asset-workbench`），不带中文；
 *   - `fromContract` 只表达"数据是不是正式契约给的"，中文来源说法由折叠组件决定；
 *   - `slotValues` 只放裸槽位码，列名前缀（「槽位」等）由折叠组件渲染。
 * 中文显示标签（接口名 / 数据来源 / 槽位列名）统一由 `TechnicalDetailCollapse.tsx` 渲染，
 * 避免「技术详情」的实现散落成多处、豁免范围失控（审计 §9 第 2 项）。
 */

import { ASSET_WORKBENCH_PATH_PREFIX } from './assetWorkbenchContract.ts'
import type {
  AssetWorkbenchItem,
  AssetWorkbenchResponse,
  AssetWorkbenchTechnical,
  WorkbenchLoadSource,
} from './assetWorkbenchContract.ts'

export type TechnicalViewInput = {
  data: AssetWorkbenchResponse | null
  source: WorkbenchLoadSource
  chapterId: string | null
  /** 读取失败时的原始说明（空串 = 没失败） */
  loadError?: string
}

export type TechnicalAssetLine = {
  key: string
  name: string
  assetType: string
  slot: string
  qualityVerdict: string
  profileSource: string
  fieldNames: string[]
}

export type TechnicalView = {
  /**
   * 工作台资产资料的英文接口路径（**不含中文**）。
   *
   * 「本章：<集 id>」这类中文说明与「接口名」列名由 `TechnicalDetailCollapse.tsx` 渲染；
   * 集 id 本身单独用 `chapterId` 传出去。
   */
  endpointPath: string
  /** 本次读取针对的集（null = 没指定集；原样透传，不在本文件拼中文） */
  chapterId: string | null
  /**
   * 数据是不是**正式契约**给的（true = 正式数据；false = 先用已有数据展示）。
   *
   * 刻意用布尔而不是中文来源标签：来源说法属于显示层，中文只允许出现在
   * `TechnicalDetailCollapse.tsx`。
   */
  fromContract: boolean
  loadError: string
  candidatesTotal: number
  candidateGroups: number
  candidateStatusLines: string[]
  matchDiagnostics: string[]
  notes: string[]
  modelLines: string[]
  /** 本次用到的裸槽位码（不带「槽位」等中文前缀，列名由折叠组件渲染） */
  slotValues: readonly string[]
  assetLines: TechnicalAssetLine[]
}

function technicalOf(data: AssetWorkbenchResponse | null): AssetWorkbenchTechnical {
  return (
    data?.technical ?? {
      candidates_total: 0,
      candidates_by_type_status: {},
      candidate_groups: 0,
      match_diagnostics: [],
      notes: [],
    }
  )
}

/** 装配技术详情要显示的每一行（全部来自后端，缺字段就如实说没有）。 */
export function assembleTechnicalView(input: TechnicalViewInput): TechnicalView {
  const data = input.data
  const technical = technicalOf(data)
  const candidateStatusLines: string[] = []
  Object.keys(technical.candidates_by_type_status ?? {}).forEach((type) => {
    const statuses = technical.candidates_by_type_status[type] ?? {}
    const parts = Object.keys(statuses).map((status) => `${status}=${statuses[status]}`)
    candidateStatusLines.push(`${type}: ${parts.join(' ')}`)
  })
  const assetLines: TechnicalAssetLine[] = (data?.items ?? []).map((item: AssetWorkbenchItem) => ({
    key: `${item.asset_type}:${item.asset_id}`,
    name: item.name || item.asset_id,
    assetType: item.asset_type,
    slot: String(item.prompt?.slot ?? ''),
    qualityVerdict: String(item.prompt?.quality?.verdict ?? ''),
    profileSource: String(item.profile_source ?? ''),
    fieldNames: Object.keys(item.profile_fields ?? {}),
  }))
  /** 每个槽位只放**裸码**（英文键本身），中文列名/前缀由 `TechnicalDetailCollapse.tsx` 负责 */
  const slotValues = Array.from(
    new Set((data?.items ?? []).map((item) => String(item.prompt?.slot ?? '')).filter(Boolean)),
  )
  return {
    /* 只给英文路径：中文说明（「本章：<id>」）与列名一律由折叠组件拼 */
    endpointPath: `${ASSET_WORKBENCH_PATH_PREFIX}/{chapter_id}/asset-workbench`,
    chapterId: input.chapterId,
    /* 只给布尔：中文来源说法（例如"正式数据 / 先用已有数据展示"）由折叠组件决定 */
    fromContract: input.source === 'contract',
    loadError: String(input.loadError ?? ''),
    candidatesTotal: technical.candidates_total,
    candidateGroups: technical.candidate_groups,
    candidateStatusLines,
    matchDiagnostics: (technical.match_diagnostics ?? []).map((row) => `${row.name}：${row.reason}`),
    notes: technical.notes ?? [],
    modelLines: [],
    slotValues,
    assetLines,
  }
}
