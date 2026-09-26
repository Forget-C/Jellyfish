/**
 * 每镜「下一步做什么」的**唯一文案来源**（第三部分要求）。
 *
 * 为什么要有它：工作室原来只有 `pending / generating / ready` 三个状态，
 * 于是整个列表到处都是含义不清的「待确认」——用户看不出下一件事是什么。
 * 现在每个镜头只给**一个主状态**，文案就是下一步动作：
 *
 *   待确认提取到的资产 → 待保存视频提示词 → 待绑定素材 → 缺少首帧/关键帧/尾帧
 *   → 已具备生成条件 → 已生成
 *
 * 两条硬约束：
 * 1. **不在这里重算就绪判定**：`canGenerate / canExport / hasPrompt / hasBoundFiles`
 *    一律来自 `shotReadiness.ts::evaluateShotReadiness`（生成 / 导出 / 页面各处共用同一份判定）；
 * 2. **「可生成」与「可导出」分开**：`canGenerate` 只看生成前置条件，`canExport`
 *    只看提示词与来源白名单，两者互不影响，页面各显示各的。
 */

import type { ShotReadiness } from './shotReadiness'
import { FRAME_TYPE, labelFor } from '../../components/enumLabels.ts'

export type ShotStatusKey =
  | 'generating'
  | 'pending_candidate'
  | 'prompt_todo'
  | 'binding_todo'
  | 'missing_frame'
  | 'frame_unreachable'
  | 'not_ready'
  | 'ready_to_generate'
  | 'generated'

export type ShotStatusTone = 'default' | 'gold' | 'blue' | 'green' | 'red'

export type ShotStatusText = {
  key: ShotStatusKey
  /** 用户看到的状态文案（就是下一步要做什么） */
  label: string
  /** 下一步动作提示（更具体的指引） */
  nextAction: string
  tone: ShotStatusTone
  /** 与状态**分开**的两条就绪度（口径来自 shotReadiness） */
  canGenerate: boolean
  canExport: boolean
}

/** 帧类型的中文业务名（`first` → 首帧）。口径来自全仓唯一映射表 `components/enumLabels.ts`。 */
export function frameTypeLabel(frameType: string): string {
  // 审计 §4.3 模式 3 / R10：旧兜底 `${key} 帧` 会显示「mid 帧」这类原值；改为中文兜底「参考帧」
  return labelFor(FRAME_TYPE, frameType)
}

/** 缺失帧 → 「缺少首帧」这类可执行文案（按首→关键→尾排序，读起来像一句话）。 */
export function missingFrameLabel(frameTypes: readonly string[]): string {
  const order = ['first', 'key', 'last']
  const unique = Array.from(new Set(frameTypes.map((item) => String(item ?? '').trim().toLowerCase()).filter(Boolean)))
  unique.sort((a, b) => {
    const ai = order.indexOf(a)
    const bi = order.indexOf(b)
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi)
  })
  if (!unique.length) return ''
  return `缺少${unique.map(frameTypeLabel).join('、')}`
}

export type ShotStatusInput = {
  /** 就绪判定（唯一来源：`evaluateShotReadiness`，此处只读不重算） */
  readiness: Pick<ShotReadiness, 'canGenerate' | 'canExport' | 'hasPrompt' | 'hasBoundFiles'>
  /** 当前参考模式要求的帧里**还没上传**的帧类型 */
  missingFrames?: readonly string[]
  /** 有 file_id 但**供应商取不到**的帧类型（本机地址 → data URL，供应商只收公网地址） */
  blockedFrames?: readonly string[]
  /** 提取候选还没确认（`shot.status === 'pending'` 且未标记「无需提取」） */
  extractionPending?: boolean
  /** 本镜有在飞任务 */
  generating?: boolean
  /** 已有生成结果（`shot.generated_video_file_id` 或生成视频列表非空） */
  generated?: boolean
}

/**
 * 解析一条镜头的业务状态。
 *
 * 判定顺序即用户的操作顺序：先解决最靠前的那件事，做完再往下走。
 */
export function resolveShotStatus(input: ShotStatusInput): ShotStatusText {
  const { readiness } = input
  const base = { canGenerate: readiness.canGenerate, canExport: readiness.canExport }

  if (input.generating) {
    return { key: 'generating', label: '生成中', nextAction: '等本次生成结束，或去任务中心查看进度', tone: 'blue', ...base }
  }
  if (input.extractionPending) {
    /* 第 3 批收尾（运行时复核发现的文案回归）：`472a2d3` 把 `去确认提取候选（…）` 机械替换成
       `去确认待提取到的资产（…）` 时多带了一个「待」——读起来像「还没提取」，而且与
       `label: '待确认提取到的资产'`（等待用户确认）语义打架。这里去掉多余的「待」，
       并把来源写清楚（这些资产是从**剧本**里提取出来的）。 */
    return { key: 'pending_candidate', label: '待确认提取到的资产', nextAction: '去确认剧本里提取到的资产（关联已有资产或新建）', tone: 'gold', ...base }
  }
  if (!readiness.hasPrompt) {
    return { key: 'prompt_todo', label: '待保存视频提示词', nextAction: '写/重新生成提示词并保存到本镜', tone: 'gold', ...base }
  }
  if (!readiness.hasBoundFiles) {
    return { key: 'binding_todo', label: '待绑定素材', nextAction: '确认推荐的资产绑定并保存', tone: 'gold', ...base }
  }
  const missingFrames = (input.missingFrames ?? []).filter(Boolean)
  if (missingFrames.length) {
    return {
      key: 'missing_frame',
      label: missingFrameLabel(missingFrames),
      nextAction: '到「资产与参考帧」补齐该帧，或把参考方式换成不需要它的模式',
      tone: 'gold',
      ...base,
    }
  }
  const blockedFrames = (input.blockedFrames ?? []).filter(Boolean)
  if (blockedFrames.length) {
    return {
      key: 'frame_unreachable',
      label: `${blockedFrames.map(frameTypeLabel).join('、')}取不到`,
      nextAction: '把帧图片换成公网地址后重新设为该帧，或改用纯文本模式',
      tone: 'gold',
      ...base,
    }
  }
  if (readiness.canGenerate) {
    return input.generated
      ? { key: 'generated', label: '已生成', nextAction: '可查看成片，或导出绑定提示词', tone: 'green', ...base }
      : { key: 'ready_to_generate', label: '已具备生成条件', nextAction: '确认请求摘要后生成视频', tone: 'green', ...base }
  }
  return {
    key: 'not_ready',
    label: '还有前置条件未满足',
    nextAction: '看「本镜还缺什么」逐项补齐',
    tone: 'red',
    ...base,
  }
}
