import type { Note_Input } from '../../../services/generated'

/** 从统一错误响应中提取具体业务缺口，供当前工作面板展示。 */
export function directingError(error: unknown): string {
  const value = error as { body?: { message?: string; detail?: string }; message?: string }
  return value?.body?.message || value?.body?.detail || value?.message || '操作失败，请稍后重试'
}

/** 新增人工创作内容时保留来源，不冒充模型或原文事实。 */
export function humanNote(text: string): Note_Input {
  return text.trim()
    ? { state: 'proposal', text, sources: [{ kind: 'human', reference: 'local-user', version: 'manual-1' }] }
    : { state: 'unknown' }
}

/** 用 Unicode 字符位置表达摘录，避免中文扩展字符导致浏览器偏移不一致。 */
export function excerptSpan(raw: string, excerpt: string) {
  const start = raw.indexOf(excerpt)
  if (start < 0 || !excerpt.trim()) throw new Error('请使用章节中连续、未经改写的一段原文')
  const offset = Array.from(raw.slice(0, start)).length
  return { start: offset, end: offset + Array.from(excerpt).length }
}
