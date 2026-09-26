/**
 * 章节序号的统一算法。
 *
 * 为什么单独抽出来：新建章节的 index 必须取「现有章节里最大的 index + 1」，
 * 而不是「章节数量 + 1」。当章节序号不连续时（例如手工删过章节，剩 1 和 3），
 * 用数量 + 1 会算出 3 —— 直接撞上已存在的第 3 章。
 *
 * 抽成纯函数也便于回归测试（见同目录的 chapterIndexing.test.ts）。
 */

/** 现有章节 index → 下一个可用 index（空项目从 1 开始）。 */
export function nextChapterIndex(existingIndexes: readonly (number | null | undefined)[]): number {
  const valid = (existingIndexes ?? []).filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value),
  )
  const max = valid.length > 0 ? Math.max(...valid) : 0
  return Math.floor(max) + 1
}

/**
 * 一集**显示出来的名字**（需求清单第 1 条：剧集名称可编辑）。
 *
 * 同一个坑的第二次出现：章节目录里显示的名字此前是**由集数推导**出来的
 * （固定渲染「第N集」），完全不读已经存在的名称字段 ——
 * 于是"用户看到的名字"和"库里能改的那个值"是两回事，改名也就无从下手。
 *
 * 统一成一个口径后：**有名字用名字**，没名字才退回「第N集」这个默认名；
 * 默认名只是**缺省显示**，一样可以被改名覆盖（不再是"改不掉"）。
 */
export function chapterDisplayName(
  chapter: { index: number },
  title?: string | null,
): string {
  const named = String(title ?? '').trim()
  if (named) return named
  return `第${chapter.index}集`
}
