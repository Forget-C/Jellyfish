import test from 'node:test'
import assert from 'node:assert/strict'
import { loadFrontendModule } from './load-frontend-module.mjs'

const { initialDivision, changeDivisionSpan, divisionRequest, removeDivisionMember, divisionBaselineMatches, analysisDivision, versionDivision } = await loadFrontendModule('pages/aiStudio/directing/chapterDivision')
const chapter = { source_version: 'v1', raw_text: '前😀段。后段。尾段。', sequences: [
  { id: 's1', title: '前场', version: 1, source_changed: false, span: { start: 0, end: 4 } },
  { id: 's2', title: '后场', version: 3, source_changed: false, span: { start: 4, end: 7 } },
  { id: 's3', title: '尾场', version: 2, source_changed: false, span: { start: 7, end: 10 } },
] }

test('whole draft keeps every identity and version; stale offsets are not painted', () => {
  const draft = initialDivision(chapter)
  assert.deepEqual(draft.baseline, [{ sequence_id: 's1', version: 1 }, { sequence_id: 's2', version: 3 }, { sequence_id: 's3', version: 2 }])
  const stale = initialDivision({ ...chapter, sequences: [{ ...chapter.sequences[0], source_changed: true }] })
  assert.equal(stale.members[0].span, undefined)
  assert.equal(stale.members[0].reconfirm_source, true)
  assert.throws(() => divisionRequest(stale, chapter.raw_text), /有效/)
})

test('shared boundary updates only two adjacent ranges and can be reverted without reconfirming', () => {
  const draft = initialDivision(chapter)
  const changed = changeDivisionSpan(draft, 's1', { start: 0, end: 5 })
  assert.deepEqual(changed.members.map(row => row.span), [{ start: 0, end: 5 }, { start: 5, end: 7 }, { start: 7, end: 10 }])
  assert.equal(changed.members[2], draft.members[2])
  assert.doesNotThrow(() => divisionRequest(changed, chapter.raw_text))
  assert.deepEqual(changeDivisionSpan(changed, 's1', { start: 0, end: 4 }), draft)
  assert.deepEqual(draft.members[1].span, { start: 4, end: 7 })
})

test('crossing a third member does not swallow it; incomplete/overlapping/out-of-bounds ranges cannot submit', () => {
  const draft = initialDivision(chapter)
  const changed = changeDivisionSpan(draft, 's1', { start: 0, end: 8 })
  assert.equal(changed.members[2], draft.members[2])
  assert.throws(() => divisionRequest(changed, chapter.raw_text), /有效/)
  for (const span of [{ start: 3, end: 7 }, { start: 4, end: 99 }, undefined]) {
    assert.throws(() => divisionRequest({ ...draft, members: draft.members.map(row => row.key === 's2' ? { ...row, span } : row) }, chapter.raw_text))
  }
  assert.doesNotThrow(() => divisionRequest({ ...draft, members: [{ ...draft.members[0], span: { start: 1, end: 3 } }] }, chapter.raw_text))
})

test('exit and split/merge targets remain explicit without deleting the baseline', () => {
  const draft = initialDivision(chapter)
  draft.lineage[0].target_keys.push('s2')
  const next = removeDivisionMember(draft, 's1')
  assert.deepEqual(next.exited_sequence_ids, ['s1'])
  assert.deepEqual(next.lineage[0], { sequence_id: 's1', target_keys: ['s2'] })
  assert.deepEqual(next.baseline, draft.baseline)
})

test('complete baseline catches addition, removal and any member version change', () => {
  const draft = initialDivision(chapter)
  assert.equal(divisionBaselineMatches(draft, chapter), true)
  assert.equal(divisionBaselineMatches(draft, { ...chapter, sequences: chapter.sequences.slice(1) }), false)
  assert.equal(divisionBaselineMatches(draft, { ...chapter, sequences: [...chapter.sequences, { id: 'new', version: 1 }] }), false)
  assert.equal(divisionBaselineMatches(draft, { ...chapter, sequences: chapter.sequences.map(row => ({ ...row, version: row.version + 1 })) }), false)
})

test('AI loading keeps ambiguous ranges unresolved and excludes local excerpts from request', () => {
  const current = { ...chapter, raw_text: '重复。重复。', sequences: [] }
  const detail = { analysis: { id: 'ai1' }, result: { scenes: [{ title: '场', excerpt: '重复。' }] }, issues: [], source_changed: false, baseline_changed: false }
  const draft = analysisDivision(current, detail)
  assert.equal(draft.members[0].span, undefined)
  draft.members[0].span = { start: 3, end: 6 }
  assert.equal('suggested_excerpt' in divisionRequest(draft, current.raw_text).members[0], false)
  assert.equal(draft.source_task_id, 'ai1')
})

test('historical loading preserves identities, uses current baseline and preserves old source offsets', () => {
  const detail = { version: { id: 'old' }, chapter: { ...chapter, source_version: 'old-source', sequences: [{ ...chapter.sequences[0], id: 'retired' }] }, restored_baseline: [{ sequence_id: 'retired', version: 7 }] }
  const draft = versionDivision(chapter, detail)
  assert.equal(draft.source_revision_id, 'old')
  assert.equal(draft.source_basis_id, 'old')
  assert.equal(draft.source_version, 'old-source')
  assert.deepEqual(draft.members[0].span, detail.chapter.sequences[0].span)
  assert.deepEqual(draft.restored_baseline, detail.restored_baseline)
  assert.deepEqual(draft.exited_sequence_ids, ['s1', 's2', 's3'])
  const removed = removeDivisionMember(draft, 'retired')
  assert.deepEqual(removed.restored_baseline, [])
  assert.deepEqual(removed.exited_sequence_ids, ['s1', 's2', 's3'])
})
