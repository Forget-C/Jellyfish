import type { ChapterRead } from '../../../services/generated'
import { chapterActionLocation, chapterLocation } from '../directing/chapterNavigation'
import { chapterProduction } from './chapterProduction'

export type ProjectStageSummary = {
  key: 'edit_raw' | 'sequences' | 'create_first_chapter'
  chapterLabel?: string
  sequenceCount?: number
  status: string
  tone?: 'gold' | 'blue' | 'green'
  action: string
  href: string
}
type ChapterPreparation = Pick<ChapterRead, 'id' | 'index' | 'title' | 'raw_text' | 'sequence_count'>
const cardTones = { pending: 'gold', ready: 'blue', available: 'green', neutral: undefined } as const

/** 优先继续需要原文的章节。未知原文与场次数量沿用章节列表的查看入口。 */
export function summarizeProjectChapters(projectId: string, chapters: ChapterPreparation[]): ProjectStageSummary {
  const sorted = [...chapters].sort((a, b) => a.index - b.index)
  const chapter = sorted.find(item => item.raw_text !== undefined && !item.raw_text.trim()) ?? sorted[0]
  const base = chapterLocation(projectId)
  if (!chapter) return { key: 'create_first_chapter', status: '待创建章节', tone: 'gold', action: '创建第一章', href: `${base}&create=1` }

  const count = chapter.sequence_count
  const sequenceCount = count !== undefined && Number.isSafeInteger(count) && count >= 0 ? count : undefined
  const production = chapterProduction({ rawText: chapter.raw_text, sequenceCount })
  return {
    key: production.target === 'edit' ? 'edit_raw' : 'sequences',
    chapterLabel: `第 ${chapter.index} 章 · ${chapter.title}`,
    sequenceCount,
    status: production.state,
    tone: cardTones[production.tone],
    action: production.primaryAction,
    href: chapterActionLocation(projectId, chapter.id, production.target),
  }
}
