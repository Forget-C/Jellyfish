import type { ChapterRead } from '../../../services/generated'
import { chapterAction, chapterLocation } from '../directing/chapterNavigation'

export type ProjectStageSummary = {
  key: 'edit_raw' | 'sequences' | 'create_first_chapter'
  chapterLabel?: string
  status: string
  tone?: 'gold' | 'blue' | 'green'
  action: string
  href: string
}
type ChapterPreparation = Pick<ChapterRead, 'id' | 'index' | 'title' | 'raw_text' | 'sequence_count'>

/** 优先继续需要原文的章节。未知原文与场次数量沿用章节列表的查看入口。 */
export function summarizeProjectChapters(projectId: string, chapters: ChapterPreparation[]): ProjectStageSummary {
  const sorted = [...chapters].sort((a, b) => a.index - b.index)
  const chapter = sorted.find(item => item.raw_text !== undefined && !item.raw_text.trim()) ?? sorted[0]
  const base = chapterLocation(projectId)
  if (!chapter) return { key: 'create_first_chapter', status: '待创建章节', tone: 'gold', action: '创建第一章', href: `${base}&create=1` }

  const action = chapterAction({ rawText: chapter.raw_text, sequenceCount: chapter.sequence_count })
  const chapterLabel = `第 ${chapter.index} 章 · ${chapter.title}`
  if (action.target === 'edit') {
    return { key: 'edit_raw', chapterLabel, status: '待补原文', tone: 'gold', action: '编辑原文', href: `${base}&edit=${encodeURIComponent(chapter.id)}` }
  }
  if (action.target === 'source') {
    return {
      key: 'sequences', chapterLabel, status: '待划分场次', tone: 'blue', action: action.label,
      href: `${chapterLocation(projectId, chapter.id)}&panel=source`,
    }
  }
  return {
    key: 'sequences', chapterLabel,
    status: chapter.sequence_count ? '已有场次' : '场次状态未确认',
    tone: chapter.sequence_count ? 'green' : undefined,
    action: action.label === '场次管理' ? '进入场次' : action.label,
    href: chapterLocation(projectId, chapter.id),
  }
}
