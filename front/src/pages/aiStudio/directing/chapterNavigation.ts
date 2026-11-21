import { uiText } from '../../../uiText'
export type WorkbenchManagementStep = 'division' | 'objects' | 'storyboard'
export const chapterCompositionRetired = { chapterCompositionRetired: true }

export function managementStep(value?: string | null): WorkbenchManagementStep | undefined {
  return value === 'division' || value === 'objects' || value === 'storyboard' ? value : undefined
}

type ChapterBrowse = { chapter?: string; sequence?: string; query?: string; top?: number; sourceTop?: number; page?: number
  managementSequence?: string; managementStep?: WorkbenchManagementStep; managementCanvas?: string }
/** 浏览记忆按项目和章节隔离；不保存原文或未保存修改。 */
export function readChapterBrowse(projectId: string, chapterId = ''): ChapterBrowse {
  try {
    const value = JSON.parse(sessionStorage.getItem(`chapter-browse:${JSON.stringify([projectId, chapterId])}`) || '{}')
    return { chapter: typeof value?.chapter === 'string' ? value.chapter : undefined, sequence: typeof value?.sequence === 'string' ? value.sequence : undefined,
      page: Number.isInteger(value?.page) && value.page > 0 ? value.page : undefined, query: typeof value?.query === 'string' ? value.query : undefined,
      sourceTop: Number.isFinite(value?.sourceTop) && value.sourceTop >= 0 ? value.sourceTop : undefined,
      top: Number.isFinite(value?.top) && value.top >= 0 ? value.top : undefined,
      managementSequence: typeof value?.managementSequence === 'string' ? value.managementSequence : undefined,
      managementStep: managementStep(value?.managementStep),
      managementCanvas: typeof value?.managementCanvas === 'string' ? value.managementCanvas : undefined }
  } catch { return {} }
}

export function saveChapterBrowse(projectId: string, chapterId: string, value: ChapterBrowse) {
  try { sessionStorage.setItem(`chapter-browse:${JSON.stringify([projectId, chapterId])}`, JSON.stringify({ ...readChapterBrowse(projectId, chapterId), ...value })) } catch { /* 存储受限时仍可浏览。 */ }
}

export function chapterLocation(projectId: string, chapterId?: string, sequenceId?: string): string {
  const query = new URLSearchParams({ tab: 'chapters' })
  if (chapterId) query.set('chapter', chapterId)
  if (sequenceId) query.set('sequence', sequenceId)
  return `/projects/${encodeURIComponent(projectId)}?${query}`
}

/** 工作台管理深链接使用显式场次和步骤，浏览记忆只作为缺省值。 */
export function workbenchManagementLocation(projectId: string, chapterId: string, sequenceId?: string, step?: WorkbenchManagementStep,
  target?: { canvas?: string | null; storyboardTask?: string | null; objectTask?: string | null; divisionTask?: string | null }): string {
  const params = new URLSearchParams()
  if (sequenceId) params.set('sequence', sequenceId)
  if (step) params.set('step', step)
  if (target?.canvas) params.set('canvas', target.canvas)
  if (target?.storyboardTask) params.set('storyboardTask', target.storyboardTask)
  if (target?.objectTask) params.set('objectTask', target.objectTask)
  if (target?.divisionTask) params.set('divisionTask', target.divisionTask)
  const path = `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/workbench-management`
  return params.size ? `${path}?${params}` : path
}

/** 旧章节抽屉链接合流到管理页，并保留明确定位的场次和任务。 */
export function legacyChapterManagementLocation(projectId: string, chapterId: string, query: URLSearchParams): string {
  const canvas = query.get('canvas') ?? query.get('selected')
  const storyboardTask = query.get('storyboardTask'), objectTask = query.get('objectTask')
  const step = query.get('panel') === 'source' ? 'division' : objectTask ? 'objects' : canvas || storyboardTask ? 'storyboard' : undefined
  return workbenchManagementLocation(projectId, chapterId, query.get('sequence') || undefined, step, { canvas, storyboardTask, objectTask })
}

function sequencePath(projectId: string, chapterId: string, sequenceId: string) {
  return `/projects/${encodeURIComponent(projectId)}/chapters/${encodeURIComponent(chapterId)}/sequences/${encodeURIComponent(sequenceId)}`
}

export function sceneCanvasLocation(projectId: string, chapterId: string, sequenceId: string, canvasId: string, taskId?: string): string {
  const query = new URLSearchParams({ canvas: canvasId })
  if (taskId) query.set('storyboardTask', taskId)
  return `${sequencePath(projectId, chapterId, sequenceId)}/canvas-workbench?${query}`
}

/** 未知字段不能当作空章；数量入口仍允许查看缺少原文的历史场次。 */
export function chapterAction(chapter: { rawText?: string; sequenceCount?: number }, count = false): { label: string; target: 'edit' | 'source' | 'manage' } {
  if (count && chapter.sequenceCount !== undefined && chapter.sequenceCount > 0) return { label: uiText("场次管理"), target: 'manage' }
  if (chapter.rawText !== undefined && !chapter.rawText.trim()) return { label: uiText("填写原文"), target: 'edit' }
  if (chapter.rawText === undefined || chapter.sequenceCount === undefined) return { label: uiText("查看场次"), target: 'manage' }
  return chapter.sequenceCount > 0 ? { label: uiText("场次管理"), target: 'manage' } : { label: uiText("划分场次"), target: 'source' }
}

/** 继续制作入口与章节列表共享定位，编辑原文留在项目中，场次操作进入工作台管理。 */
export function chapterActionLocation(projectId: string, chapterId: string, target: ReturnType<typeof chapterAction>['target']): string {
  if (target === 'edit') return `${chapterLocation(projectId)}&edit=${encodeURIComponent(chapterId)}`
  return workbenchManagementLocation(projectId, chapterId, undefined, target === 'source' ? 'division' : undefined)
}
