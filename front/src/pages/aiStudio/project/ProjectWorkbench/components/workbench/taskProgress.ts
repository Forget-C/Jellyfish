/**
 * 工作台顶部进度条读的**同一份**任务进度。
 *
 * 这里的三个函数都是既有能力的**转发**，不是新算法：
 *   - `summarizeTaskProgress` / `describeProgressLines` 来自 `../assetProduction.ts`
 *     （既有生产区用的就是它们，所以顶部条与结果区的数字必然一致）；
 *   - `emptyTaskProgress()` 就是"还没有任何任务"时的汇总，避免在组件里手写一份零值对象。
 */

import {
  describeProgressLines,
  summarizeTaskProgress,
  type TaskProgressSummary,
} from '../assetProduction.ts'

export type { TaskProgressSummary }

export function emptyTaskProgress(): TaskProgressSummary {
  return summarizeTaskProgress([])
}

export type TaskProgressLine = { label: string; value: number }

/**
 * 顶部条上要显示的那几行。
 *
 * 只显示用户真正要看的四项（总数 / 已完成 / 生成中 / 生成失败）：
 * 「待提交 / 已停止 / 演练占位」在结果区里已经逐项看得见，
 * 顶部条再铺一遍会把**唯一主操作区**挤满（参考项目 `.queue-stats` 的行数也刻意很少）。
 */
export function taskProgressLines(summary: TaskProgressSummary): TaskProgressLine[] {
  const all = describeProgressLines(summary)
  return all.filter((line) => ['总数', '已完成', '生成中', '失败'].includes(line.label))
}
