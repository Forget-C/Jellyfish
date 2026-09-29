import type { SequenceOverview } from '../../../services/generated'

type Stage = 'design' | 'shoot' | 'cut'
type Action = { label: string; view: Stage | null }

type ChapterBrowse = { chapter?: string; sequence?: string; query?: string; top?: number; sourceTop?: number; page?: number }
/** 浏览记忆按项目和章节隔离；不保存原文或未保存修改。 */
export function readChapterBrowse(projectId: string, chapterId = ''): ChapterBrowse {
  try {
    const value = JSON.parse(sessionStorage.getItem(`chapter-browse:${JSON.stringify([projectId, chapterId])}`) || '{}')
    return { chapter: typeof value?.chapter === 'string' ? value.chapter : undefined, sequence: typeof value?.sequence === 'string' ? value.sequence : undefined,
      page: Number.isInteger(value?.page) && value.page > 0 ? value.page : undefined, query: typeof value?.query === 'string' ? value.query : undefined,
      sourceTop: Number.isFinite(value?.sourceTop) && value.sourceTop >= 0 ? value.sourceTop : undefined,
      top: Number.isFinite(value?.top) && value.top >= 0 ? value.top : undefined }
  } catch { return {} }
}

export function saveChapterBrowse(projectId: string, chapterId: string, value: ChapterBrowse) {
  try { sessionStorage.setItem(`chapter-browse:${JSON.stringify([projectId, chapterId])}`, JSON.stringify({ ...readChapterBrowse(projectId, chapterId), ...value })) } catch { /* 存储受限时仍可浏览。 */ }
}

/** 整场汇总仅用于建议入口，不作为执行准备度或采用状态的替代判断。 */
export function sequenceAction(sequence: SequenceOverview, remembered?: string | null): Action {
  if (sequence.source_changed) return { label: '核对原文', view: null }
  if (remembered === 'design' || remembered === 'shoot' || remembered === 'cut') {
    return { label: { design: '继续设计', shoot: '继续试拍', cut: '继续剪辑' }[remembered], view: remembered }
  }
  if (sequence.unreviewed_take_count) return { label: '审片', view: 'cut' }
  if (sequence.active_cut_revision_id) return { label: '查看剪辑', view: 'cut' }
  if (!sequence.confirmed_design_count) return { label: '继续设计', view: 'design' }
  if (!sequence.plan_count) return { label: '准备试拍', view: 'shoot' }
  if (sequence.take_count) return { label: '审片与剪辑', view: 'cut' }
  return { label: '继续试拍', view: 'shoot' }
}

export function chapterLocation(projectId: string, chapterId?: string, sequenceId?: string): string {
  const query = new URLSearchParams({ tab: 'chapters' })
  if (chapterId) query.set('chapter', chapterId)
  if (sequenceId) query.set('sequence', sequenceId)
  return `/projects/${encodeURIComponent(projectId)}?${query}`
}

export function sequenceLocation(projectId: string, chapterId: string, sequenceId: string, view: Stage): string {
  return `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/sequences/${encodeURIComponent(sequenceId)}?view=${view}`
}
