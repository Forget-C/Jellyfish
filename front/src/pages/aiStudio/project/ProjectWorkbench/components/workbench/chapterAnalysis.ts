/**
 * 「分析本章资产 / 重新分析本章资产」的动作实现。
 *
 * **走的是本章**整章资产分析**那条链路**：`POST /api/v1/studio/chapters/{id}/asset-profiles`
 * ——它读本章完整剧本 + 分镜，产出**规范化结构化资料**（角色身份/关系/服装/剧情、
 * 场景空间/陈设/氛围、道具材质/用途/所属…），并把结果**按项目 + 章节持久化**
 * （`chapter_asset_profiles`），工作台卡片上的资料与「生成依据」读的就是它。
 *
 * 为什么不是逐镜头提取（`POST /script-processing/extract`）：
 * - 那条路是"按镜头抽候选"，**每个分镜一次模型调用**（本集 6 镜 = 6 次），
 *   而且只产出候选、**不产出结构化资料**，点完之后工作台仍然是「待补资料」——
 *   等于花了钱还看不到资料。这一条曾经真的接错过，所以在这里写清楚。
 * - 也**不自动重试**：一次失败就如实报原因（守卫拦截给中文放开步骤）。
 *
 * 本文件只做**编排**：不判断当前是演练还是真实模式（后端守卫说了算），
 * 也不生成图片、不改提示词。
 */

import { callApi } from '../../../../../../services/llmPipelineApi'
import { classifyGenerationFailure, failureText, type GenerationFailure } from '../../../../components/generationGate'
import { sanitizeUserText } from '../userFacingStatus.ts'

export type ChapterAnalysisResult =
  | { ok: true }
  | { ok: false; reason: string; failure: GenerationFailure | null }

/**
 * 同步跑一次本章分析（把剧本按分镜交给分析流程，写回本章资产资料）。
 *
 * 说明：分镜必须**先在**第 1 步提取出来；没有分镜时如实说明，
 * 不像旧实现那样悄悄发一个空的分镜列表过去。
 */
export async function runChapterAnalysis(args: {
  projectId: string
  chapterId: string
  /** 重新分析（用户点「重新分析本章资产」）——会真正再调用一次模型 */
  refresh?: boolean
}): Promise<ChapterAnalysisResult> {
  const { projectId, chapterId } = args
  if (!projectId || !chapterId) {
    return { ok: false, reason: '还没有选定要分析的集：请先在顶部选择一集。', failure: null }
  }
  try {
    await callApi(`/api/v1/studio/chapters/${encodeURIComponent(chapterId)}/asset-profiles`, {
      extra_instructions: '',
      refresh: args.refresh === true,
    })
  } catch (error) {
    const failure = classifyGenerationFailure(error, 'llm')
    return { ok: false, reason: sanitizeUserText(failureText(failure)), failure }
  }
  return { ok: true }
}
