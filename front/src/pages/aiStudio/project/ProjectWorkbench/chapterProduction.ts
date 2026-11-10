import { chapterAction } from '../../directing/chapterNavigation'

/** 使用已有章节动作表达制作状态，未知字段仍沿用查看场次入口。 */
export function chapterProduction(chapter: { rawText?: string; sequenceCount?: number }) {
  const { target, label } = chapterAction(chapter)
  if (target === 'edit') return { target, label, state: '待补原文', tone: 'pending', overviewAction: '编辑原文' }
  if (target === 'source') return { target, label, state: '待划分场次', tone: 'ready', overviewAction: label }
  if ((chapter.sequenceCount ?? 0) > 0) return { target, label, state: '已有场次', tone: 'available', overviewAction: '进入场次' }
  return { target, label, state: '场次待核对', tone: 'neutral', overviewAction: label }
}
