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

/** 未知字段不能当作空章；数量入口仍允许查看缺少原文的历史场次。 */
export function chapterAction(chapter: { rawText?: string; sequenceCount?: number }, count = false): { label: string; target: 'edit' | 'source' | 'manage' } {
  if (count && chapter.sequenceCount !== undefined && chapter.sequenceCount > 0) return { label: '场次管理', target: 'manage' }
  if (chapter.rawText !== undefined && !chapter.rawText.trim()) return { label: '填写原文', target: 'edit' }
  if (chapter.rawText === undefined || chapter.sequenceCount === undefined) return { label: '查看场次', target: 'manage' }
  return chapter.sequenceCount > 0 ? { label: '场次管理', target: 'manage' } : { label: '划分场次', target: 'source' }
}

/** 继续制作入口与章节列表共享定位，保留编辑器和场次面板地址。 */
export function chapterActionLocation(projectId: string, chapterId: string, target: ReturnType<typeof chapterAction>['target']): string {
  if (target === 'edit') return `${chapterLocation(projectId)}&edit=${encodeURIComponent(chapterId)}`
  return `${chapterLocation(projectId, chapterId)}${target === 'source' ? '&panel=source' : ''}`
}
