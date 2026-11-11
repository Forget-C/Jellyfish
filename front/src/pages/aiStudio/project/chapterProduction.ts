import { chapterAction } from '../directing/chapterNavigation'

type ChapterProduction = ReturnType<typeof chapterAction> & {
  state: string
  tone: 'pending' | 'ready' | 'available' | 'neutral'
  primaryAction: string
}

/** 使用已有章节动作表达制作状态，未知字段仍沿用查看场次入口。 */
export function chapterProduction(chapter: { rawText?: string; sequenceCount?: number }): ChapterProduction {
  const { target, label } = chapterAction(chapter)
  if (target === 'edit') return { target, label, state: '待补原文', tone: 'pending', primaryAction: '编辑原文' }
  if (target === 'source') return { target, label, state: '待划分场次', tone: 'ready', primaryAction: label }
  if ((chapter.sequenceCount ?? 0) > 0) {
    return { target, label, state: '已有场次', tone: 'available', primaryAction: label === '场次管理' ? '进入场次' : label }
  }
  return { target, label, state: '场次状态未确认', tone: 'neutral', primaryAction: label }
}
