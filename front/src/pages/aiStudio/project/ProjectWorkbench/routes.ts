/** 章节列表挂在项目工作台 Tab，无独立 /projects/:id/chapters 页面路由 */
export function getProjectChaptersPath(projectId: string) {
  return `/projects/${projectId}?tab=chapters`
}

export function getChapterStudioPath(projectId: string, chapterId: string) {
  return `/projects/${projectId}/chapters/${chapterId}/studio`
}

export function getChapterShotsPath(projectId: string, chapterId: string) {
  return `/projects/${projectId}/chapters/${chapterId}/shots`
}

export function getChapterShotEditPath(projectId: string, chapterId: string, shotId: string) {
  return `/projects/${projectId}/chapters/${chapterId}/shots/${shotId}/edit`
}

/**
 * 旧入口 `/projects/:id/editor`（无 chapterId 时组件会重定向）。
 * 新流程请使用「剪辑」Tab 或 `getChapterTimelinePath(projectId, chapterId)`。
 */
export function getProjectEditorPath(projectId: string) {
  return `/projects/${projectId}/editor`
}

/** 章节视频剪辑（时间线编排与导出入口） */
export function getChapterTimelinePath(projectId: string, chapterId: string) {
  return `/projects/${projectId}/chapters/${chapterId}/timeline`
}

