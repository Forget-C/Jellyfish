/**
 * 工作台取数的**唯一**一层：`GET /api/v1/studio/chapters/{chapter_id}/asset-workbench`。
 *
 * 为什么单独一个文件：`assetWorkbenchContract.ts` 要保持零运行时依赖
 * （类型 + 纯函数，能在 `node --test` 里直接跑），
 * 发请求这一层就放在这里 —— 仍然复用 `services/llmPipelineApi` 的同一个 `callApi`
 * （同一套统一信封解析、同样的错误类型），不另写一套 fetch、也不新增后端端点。
 */

import { callApi } from '../../../../../../services/llmPipelineApi'
import {
  assetWorkbenchPath,
  normalizeAssetWorkbench,
  type AssetWorkbenchResponse,
} from './assetWorkbenchContract.ts'

/** 读一次本章资产工作台（只读：不调模型、不出图、不写库）。 */
export async function fetchAssetWorkbench(chapterId: string): Promise<AssetWorkbenchResponse> {
  const payload = await callApi<unknown>(assetWorkbenchPath(chapterId))
  return normalizeAssetWorkbench(payload)
}
