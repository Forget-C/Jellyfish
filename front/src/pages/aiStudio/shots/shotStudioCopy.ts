/**
 * `shots/**`（分镜列表 / 分镜编辑 / 绑定区）的区域级文案口径。
 *
 * ## 枚举表已收敛到 `components/enumLabels.ts`（不要再在本文件重建）
 *
 * 区域 6b 落地时 `components/enumLabels.ts` 是**只读**的，而镜头生产状态
 * （`ShotStatus` = `pending | generating | ready`）在共享表里没有对应 `EnumSpec`
 * （`TASK_STATUS` 的 `pending` 是「排队中」，语义不同、不能借用），
 * 所以当时在本文件放了一张同型临时表，并登记
 * 「**需追加 —— `components/enumLabels.ts` 应新增 `SHOT_STATUS`（本表届时删除并改为 import）**」。
 *
 * 复核者已按那条登记把 `SHOT_STATUS` 加进 `enumLabels.ts`（§7.1-4「枚举映射一处定义、全仓引用」），
 * 本文件改为 **import + 薄封装**：`shotStatusLabel()` 仍是本区域唯一的调用入口，
 * 未登记状态一律由共享表给中文兜底、**绝不回显原值**（§7.4 兜底口径）。
 *
 * 标签与分镜列表页筛选器上的中文**逐字一致**（「待确认 / 生成中 / 已就绪」）：
 * 同一份数据在全仓只允许一个名字（§9.1-19）。
 */

import { SHOT_STATUS, labelFor } from '../components/enumLabels.ts'

export { SHOT_STATUS }

/** 镜头状态 → 主区中文（**未登记给中文兜底**）。 */
export function shotStatusLabel(raw: string | null | undefined): string {
  return labelFor(SHOT_STATUS, raw)
}
