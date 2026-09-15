export type WorkspaceSelection = 'design' | 'plan' | 'unit' | 'prompt' | 'review' | 'cut' | 'take' | 'view'
type StoredContext = Partial<Record<WorkspaceSelection, string | null>>

const storageKey = (projectId: string, sequenceId: string) => `directing-context:${projectId}:${sequenceId}`

/** 只保存浏览位置，不保存业务数据、未保存正文或执行授权。禁用存储时仍可操作。 */
export function readWorkspaceContext(projectId: string, sequenceId: string): StoredContext {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey(projectId, sequenceId)) || '{}')
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item === null || typeof item === 'string'))
  } catch { return {} }
}

export function saveWorkspaceContext(projectId: string, sequenceId: string, context: StoredContext) {
  try { sessionStorage.setItem(storageKey(projectId, sequenceId), JSON.stringify({ ...readWorkspaceContext(projectId, sequenceId), ...context })) } catch { /* 浏览位置存储不可用不阻止业务操作。 */ }
}

/** 显式回跳优先；已记住的对象不存在时留空，避免改用另一个执行依据。 */
export function restoreSelection<T extends { id: string }>(rows: T[], explicit: string | null, remembered: string | null | undefined): T | undefined {
  const id = explicit ?? remembered
  return id === undefined ? rows.slice(-1)[0] : rows.find(row => row.id === id)
}
