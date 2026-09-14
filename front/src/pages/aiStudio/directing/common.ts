import type { Note_Input } from '../../../services/generated'

/** 从统一错误响应中提取具体业务缺口，供当前工作面板展示。 */
export function directingError(error: unknown): string {
  const value = error as { body?: { message?: unknown; detail?: unknown }; message?: string }
  const detail = value?.body?.detail
  if (Array.isArray(detail)) return detail.map(row => `${row.loc?.join('.') || '输入'}：${row.msg || '格式不正确'}`).join('；')
  const message = value?.body?.message || detail || value?.message
  return typeof message === 'string' ? message : '操作失败，请核对输入后重试'

}

/** 新增人工创作内容时保留来源，不冒充模型或原文事实。 */
export function humanNote(text: string): Note_Input {
  return text.trim()
    ? { state: 'proposal', text, sources: [{ kind: 'human', reference: 'local-user', version: 'manual-1' }] }
    : { state: 'unknown' }
}

/** 列出所有原文位置，重复段落不得默默选择第一次出现。 */
export function excerptMatches(raw: string, excerpt: string) {
  if (!excerpt.trim()) return []
  const matches: Array<{ start: number; end: number }> = []
  let cursor = raw.indexOf(excerpt)
  while (cursor >= 0) {
    const start = Array.from(raw.slice(0, cursor)).length
    matches.push({ start, end: start + Array.from(excerpt).length })
    cursor = raw.indexOf(excerpt, cursor + 1)
  }
  return matches
}

/** 用 Unicode 字符位置表达摘录，重复文本要求用户指定位置。 */
export function excerptSpan(raw: string, excerpt: string, selectedStart?: number) {
  const matches = excerptMatches(raw, excerpt)
  if (!matches.length) throw new Error('请使用章节中连续、未经改写的一段原文')
  const selected = selectedStart === undefined ? undefined : matches.find(span => span.start === selectedStart)
  if (matches.length > 1 && !selected) throw new Error('这段原文多次出现，请选择对应的位置')
  return selected || matches[0]
}
