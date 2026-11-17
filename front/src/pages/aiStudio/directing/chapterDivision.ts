import type { ChapterSequences, DivisionAnalysisDetail, DivisionDraft, DivisionMember_Input, DivisionVersionDetail, SourceSpan } from '../../../services/generated'
import { reviewShootingPreparation } from './shootingPreparation'
import { excerptMatches } from './common'
import { sameSpan, sourceSlice } from './sourceSelection'

export type DraftMember = Omit<DivisionMember_Input, 'span'> & { span?: SourceSpan; suggested_excerpt?: string }
export type ChapterDivisionDraft = Omit<DivisionDraft, 'members'> & { members: DraftMember[] }

/** 已定位场次按原文起点排列；待定位场次稳定保留在末尾。 */
export function orderedDivisionMembers(members: DraftMember[]) {
  return [...members].sort((a, b) => (a.span?.start ?? Infinity) - (b.span?.start ?? Infinity))
}

/** 本地可保留待定位范围；正式契约仅在整章校验通过后生成。 */
export function initialDivision(chapter: ChapterSequences): ChapterDivisionDraft {
  return { source_version: chapter.source_version,
    baseline: chapter.sequences.map(row => ({ sequence_id: row.id, version: row.version })),
    members: chapter.sequences.map(row => ({ key: row.id, sequence_id: row.id, title: row.title, shooting_preparation: row.shooting_preparation, reconfirm_source: row.source_changed || undefined, span: row.source_changed ? undefined : row.span || undefined })),
    exited_sequence_ids: [], lineage: chapter.sequences.map(row => ({ sequence_id: row.id, target_keys: [row.id] })) }
}

export function divisionBaselineMatches(draft: ChapterDivisionDraft, chapter: ChapterSequences) {
  const versions = new Map(chapter.sequences.map(row => [row.id, row.version]))
  return draft.baseline.length === versions.size && draft.baseline.every(row => versions.get(row.sequence_id) === row.version)
}

/** 仅同步原先与选中场次共边界的邻场；跨越第三场时留下冲突供用户处理。 */
export function changeDivisionSpan(draft: ChapterDivisionDraft, key: string, span: SourceSpan): ChapterDivisionDraft {
  const current = draft.members.find(row => row.key === key)
  if (!current || sameSpan(current.span, span)) return draft
  return { ...draft, members: draft.members.map(row => {
    if (row.key === key) return { ...row, span, shooting_preparation: reviewShootingPreparation(row.shooting_preparation) }
    if (!row.span || !current.span) return row
    if (row.span.end === current.span.start && span.start !== current.span.start) return { ...row, shooting_preparation: reviewShootingPreparation(row.shooting_preparation), span: { ...row.span, end: span.start } }
    if (row.span.start === current.span.end && span.end !== current.span.end) return { ...row, shooting_preparation: reviewShootingPreparation(row.shooting_preparation), span: { ...row.span, start: span.end } }
    return row
  }) }
}

export function removeDivisionMember(draft: ChapterDivisionDraft, key: string): ChapterDivisionDraft {
  const row = draft.members.find(member => member.key === key)
  return { ...draft, members: draft.members.filter(member => member.key !== key),
    exited_sequence_ids: row?.sequence_id && draft.baseline.some(item => item.sequence_id === row.sequence_id) ? [...new Set([...draft.exited_sequence_ids, row.sequence_id])] : draft.exited_sequence_ids,
    restored_baseline: draft.restored_baseline?.filter(item => item.sequence_id !== row?.sequence_id),
    lineage: draft.lineage.map(origin => ({ ...origin, target_keys: origin.target_keys.filter(target => target !== key) })) }
}

/** 提交前统一检查完整方案；未分配正文允许保留。 */
export function divisionRequest(draft: ChapterDivisionDraft, raw: string): DivisionDraft {
  for (const member of draft.members) {
    if (!member.title.trim()) throw new Error('请填写全部场次名称')
    const span = member.span
    if (!span || !Number.isInteger(span.start) || !Number.isInteger(span.end) || span.start < 0 || span.end <= span.start || span.end > Array.from(raw).length || !sourceSlice(raw, span).trim()) {
      throw new Error(`场次「${member.title}」需要有效的连续原文范围`)
    }
  }
  const ordered = orderedDivisionMembers(draft.members)
  for (let index = 1; index < ordered.length; index++) {
    if (ordered[index].span!.start < ordered[index - 1].span!.end) throw new Error(`场次「${ordered[index - 1].title}」与「${ordered[index].title}」范围重叠`)
  }
  return { ...draft, members: ordered.map(({ suggested_excerpt: _excerpt, ...member }) => ({ ...member, title: member.title.trim(), span: member.span! })) }
}

/** AI 始终载入同一编辑器；重复摘录保持待定位，不猜测身份。 */
export function analysisDivision(chapter: ChapterSequences, detail: DivisionAnalysisDetail): ChapterDivisionDraft {
  if (!detail.result || detail.issues.length) throw new Error('历史分析资料不完整，不能载入编辑')
  const draft = initialDivision(chapter)
  return { ...draft, source_task_id: detail.analysis.id, history_reconfirmed: detail.source_changed || detail.baseline_changed,
    members: detail.result.scenes.map((row, index) => {
      const matches = detail.source_changed ? [] : excerptMatches(chapter.raw_text, row.excerpt)
      return { key: `candidate-${detail.analysis.id}-${index}`, title: row.title, suggested_excerpt: row.excerpt,
        span: matches.length === 1 ? matches[0] : undefined, reconfirm_source: detail.source_changed || undefined }
    }), exited_sequence_ids: draft.baseline.map(row => row.sequence_id),
    lineage: draft.lineage.map(row => ({ ...row, target_keys: [] })) }
}

/** 历史内容以最新正式集合提交；旧原文范围必须在当前原文重新定位。 */
export function versionDivision(chapter: ChapterSequences, detail: DivisionVersionDetail): ChapterDivisionDraft {
  const draft = initialDivision(chapter), sourceChanged = chapter.source_version !== detail.chapter.source_version
  const members = detail.chapter.sequences.map(row => ({ key: row.id, sequence_id: row.id, title: row.title,
    span: sourceChanged || row.source_changed ? undefined : row.span || undefined,
    shooting_preparation: row.shooting_preparation, reconfirm_source: sourceChanged || row.source_changed || undefined, suggested_excerpt: row.source_text }))
  const retained = new Set(members.map(row => row.sequence_id))
  return { ...draft, source_revision_id: detail.version.id, history_reconfirmed: sourceChanged,
    restored_baseline: detail.restored_baseline.filter(row => retained.has(row.sequence_id)), members,
    exited_sequence_ids: draft.baseline.filter(row => !retained.has(row.sequence_id)).map(row => row.sequence_id),
    lineage: draft.lineage.map(row => ({ ...row, target_keys: retained.has(row.sequence_id) ? [row.sequence_id] : [] })) }
}
