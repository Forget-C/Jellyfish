import type { Note_Input } from '../../../services/generated'

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
