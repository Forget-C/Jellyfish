type RecentWork = { chapterId: string; sequenceId: string; view: 'design' | 'shoot' | 'cut' }

/** 最近工作只提供导航建议；恢复前仍须核对项目内章节与场次是否存在。 */
export function readRecentWork(projectId: string): RecentWork | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(`directing-recent:${projectId}`) || 'null')
    if (value && typeof value.chapterId === 'string' && value.chapterId && typeof value.sequenceId === 'string' && value.sequenceId
      && ['design', 'shoot', 'cut'].includes(value.view)) return { chapterId: value.chapterId, sequenceId: value.sequenceId, view: value.view }
  } catch { /* 禁用或损坏的存储不影响普通导航。 */ }
}
