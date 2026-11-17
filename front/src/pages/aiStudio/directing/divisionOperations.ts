import type { SourceSpan } from '../../../services/generated'
import type { ChapterDivisionDraft, DraftMember } from './chapterDivision'
import { reviewShootingPreparation } from './shootingPreparation'
import { sameSpan, sourceSlice } from './sourceSelection'

export type DivisionAssignment = {
  mode: 'new' | 'append' | 'range'
  span: SourceSpan
  key: string
  title?: string
  edge?: 'before' | 'after'
  targetKey?: string
  retainAfter?: string[]
}
export type DivisionPlan = {
  draft: ChapterDivisionDraft
  activeKey: string
  affected: DraftMember[]
  fragmented: DraftMember[]
  changed: boolean
}
const overlaps = (a: SourceSpan, b: SourceSpan) => a.start < b.end && b.start < a.end

/** 一次选区转移原子地产生完整草稿；剩余正文不扩给邻场，来源关系不复制身份。 */
export function planDivisionAssignment(draft: ChapterDivisionDraft, raw: string, action: DivisionAssignment): DivisionPlan {
  const { span } = action
  if (!Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > Array.from(raw).length) throw new Error('请选择有效原文范围')
  const target = draft.members.find(row => row.key === action.targetKey)
  if (action.mode !== 'new' && !target) throw new Error('目标场次已变化，请重新选择')
  if (action.mode === 'append' && (!target?.span || span.end < target.span.start || span.start > target.span.end)) throw new Error('选区与目标场次之间仍有未选原文，不能并入')
  const finalSpan = action.mode === 'append' && target?.span
    ? { start: action.edge === 'after' ? span.start : Math.min(span.start, target.span.start), end: action.edge === 'before' ? span.end : Math.max(span.end, target.span.end) } : span
  if (!sourceSlice(raw, finalSpan).trim()) throw new Error('纯空白原文不能创建场次，只能并入相邻有效场次')
  const title = action.title?.trim() || target?.title.trim()
  if (!title) throw new Error('请输入场次名称')
  const destination: DraftMember = { ...target, key: target?.key || action.key, title, span: finalSpan, reconfirm_source: target?.reconfirm_source || (draft.history_reconfirmed ? true : undefined) }
  let fragmentIndex = 0
  const fragmentKey = () => `${action.key}:f${fragmentIndex++}`
  const members: DraftMember[] = []
  const affected: DraftMember[] = []
  const fragmented: DraftMember[] = []
  const replacements = new Map<string, string[]>()
  for (const row of draft.members) {
    if (row.key === target?.key) {
      members.push(destination)
      const residuals = action.mode === 'append' && row.span ? [
        { start: row.span.start, end: finalSpan.start }, { start: finalSpan.end, end: row.span.end },
      ].filter(part => part.end > part.start && !!sourceSlice(raw, part).trim()).map(part => ({ ...row, key: fragmentKey(), sequence_id: undefined, title: `${row.title}（拆分）`, span: part })) : []
      members.push(...residuals)
      replacements.set(row.key, [destination.key, ...residuals.map(piece => piece.key)])
      if (!sameSpan(row.span, finalSpan) || row.title !== title) affected.push(row)
      continue
    }
    if (!row.span || !overlaps(row.span, span)) { members.push(row); replacements.set(row.key, [row.key]); continue }
    affected.push(row)
    const remains = [
      { start: row.span.start, end: Math.min(row.span.end, span.start) },
      { start: Math.max(row.span.start, span.end), end: row.span.end },
    ].filter(part => part.end > part.start && !!sourceSlice(raw, part).trim())
    if (remains.length === 2) fragmented.push(row)
    const keep = action.retainAfter?.includes(row.key) ? remains.length - 1 : 0
    const pieces = remains.map((part, index): DraftMember => index === keep
      ? { ...row, span: part }
      : { ...row, key: fragmentKey(), sequence_id: undefined, title: `${row.title}（拆分）`, span: part })
    members.push(...pieces)
    replacements.set(row.key, [...pieces.map(piece => piece.key), destination.key])
  }
  if (!target) members.push(destination)
  members.sort((a, b) => (a.span?.start ?? Infinity) - (b.span?.start ?? Infinity))
  const located = members.filter(row => row.span)
  for (let index = 1; index < located.length; index++) {
    if (overlaps(located[index - 1].span!, located[index].span!)) throw new Error('操作后范围重叠，请先处理冲突场次')
  }
  if (new Set(members.map(row => row.key)).size !== members.length) throw new Error('候选场次标识重复，请重新操作')
  const identities = members.flatMap(row => row.sequence_id ? [row.sequence_id] : [])
  if (new Set(identities).size !== identities.length) throw new Error('同一场次关联不能重复保留')
  for (const member of members) {
    const original = draft.members.find(row => row.key === member.key)
    if (!original || !sameSpan(original.span, member.span)) {
      const sources = draft.members.filter(row => row.span && member.span && overlaps(row.span, member.span))
      const notes = sources.flatMap(row => (row.shooting_preparation?.notes || []).map(note => ({ ...note, id: note.id, choice: 'review' as const })))
      member.shooting_preparation = reviewShootingPreparation(member.shooting_preparation)
      if (notes.length) {
        const unique = [...new Map(notes.map(note => [`${note.id}:${note.text}`, note])).values()]
        member.shooting_preparation = { ...member.shooting_preparation,
          notes: unique.map((note, index) => unique.findIndex(other => other.id === note.id) === index ? note : { ...note, id: `${note.id.slice(0, 40)}:${index}` }) }
      }
    }
  }
  const value: ChapterDivisionDraft = { ...draft, members,
    exited_sequence_ids: draft.baseline.filter(row => !identities.includes(row.sequence_id)).map(row => row.sequence_id),
    restored_baseline: draft.restored_baseline?.filter(row => identities.includes(row.sequence_id)),
    lineage: draft.lineage.map(origin => ({ ...origin, target_keys: [...new Set(origin.target_keys.flatMap(key => replacements.get(key) || []))].sort((a, b) => members.findIndex(row => row.key === a) - members.findIndex(row => row.key === b)) })),
  }
  return { draft: value, activeKey: destination.key, affected, fragmented, changed: JSON.stringify(members) !== JSON.stringify(draft.members) }
}

/** 候选目标必须直接接触选区；完整覆盖项可明确选择保留其身份。 */
export function divisionAssignmentTargets(draft: ChapterDivisionDraft, span: SourceSpan) {
  const rows = draft.members.filter((row): row is DraftMember & { span: SourceSpan } => !!row.span).sort((a, b) => a.span.start - b.span.start)
  return {
    before: rows.find(row => row.span.start < span.start && row.span.end >= span.start),
    after: rows.find(row => row.span.start <= span.end && row.span.end > span.end),
    covered: rows.filter(row => span.start <= row.span.start && row.span.end <= span.end),
  }
}
