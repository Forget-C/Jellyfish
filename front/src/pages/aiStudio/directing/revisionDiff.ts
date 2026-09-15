export type RevisionDifference = { path: string; kind: 'added' | 'removed' | 'changed'; before?: unknown; after?: unknown }
/** 用业务身份匹配集合；不以数组位置把重排误报成字段改写。无身份值按原子数组比较。 */
export function revisionDifferences(before: unknown, after: unknown, path = ''): RevisionDifference[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return []
  if (before === undefined) return [{ path, kind: 'added', after }]
  if (after === undefined) return [{ path, kind: 'removed', before }]
  const identity = (item: unknown): string | undefined => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return undefined
    const row = item as Record<string, unknown>
    if (typeof row.id === 'string') return row.id
    if (typeof row.shot_id === 'string') return `shot:${row.shot_id}`
    if (typeof row.beat_id === 'string' && typeof row.participant_id === 'string') return `beat:${row.beat_id}/participant:${row.participant_id}`
    if (typeof row.participant_id === 'string') return `participant:${row.participant_id}${typeof row.anchor_id === 'string' ? `/anchor:${row.anchor_id}` : ''}`
    if (typeof row.kind === 'string' && typeof row.reference === 'string') return `${row.kind}:${row.reference}`
    return undefined
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    const keysA = before.map(identity), keysB = after.map(identity)
    if ([...keysA,...keysB].every(key => key !== undefined) && new Set(keysA).size === keysA.length && new Set(keysB).size === keysB.length) {
      const a = new Map(keysA.map((key,i) => [key!,before[i]])), b = new Map(keysB.map((key,i) => [key!,after[i]]))
      const changes = [...new Set([...a.keys(),...b.keys()])].flatMap(key => revisionDifferences(a.get(key), b.get(key), `${path}[${key}]`))
      if (keysA.length === keysB.length && keysA.every(key => b.has(key!)) && JSON.stringify(keysA) !== JSON.stringify(keysB)) changes.push({ path: `${path}.顺序`, kind: 'changed', before: keysA, after: keysB })
      return changes
    }
    return [{ path, kind: 'changed', before, after }]
  }
  if (before !== null && after !== null && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>
    return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(key => revisionDifferences(a[key], b[key], path ? `${path}.${key}` : key))
  }
  return [{ path, kind: 'changed', before, after }]
}
