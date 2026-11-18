import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const compile = async name => ts.transpileModule(await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`
const source = uri(await compile('sourceSelection'))
const { planDivisionAssignment } = await import(uri((await compile('divisionOperations')).replaceAll("'./sourceSelection'", JSON.stringify(source))))
const raw = '甲乙丙丁'
const draft = { source_version: 'v1', baseline: [{ sequence_id: 'a', version: 1 }, { sequence_id: 'b', version: 1 }], members: [
  { key: 'a', sequence_id: 'a', title: 'A', span: { start: 0, end: 2 } },
  { key: 'b', sequence_id: 'b', title: 'B', span: { start: 2, end: 4 } },
], exited_sequence_ids: [], lineage: [{ sequence_id: 'a', target_keys: ['a'] }, { sequence_id: 'b', target_keys: ['b'] }] }

test('extracting across two scenes preserves residual ranges and maps both sources to the new scene', () => {
  const plan = planDivisionAssignment(draft, raw, { mode: 'new', span: { start: 1, end: 3 }, title: 'C', key: 'c' })
  assert.deepEqual(plan.draft.members.map(row => [row.title, row.span.start, row.span.end, row.sequence_id]), [['A', 0, 1, 'a'], ['C', 1, 3, undefined], ['B', 3, 4, 'b']])
  assert.deepEqual(plan.draft.lineage.map(row => row.target_keys), [['a', 'c'], ['c', 'b']])
  assert.equal(draft.members[0].span.end, 2)
})

test('interior selection appended forward keeps one original identity and creates a residual scene', () => {
  const one = { ...draft, baseline: draft.baseline.slice(0, 1), members: [{ ...draft.members[0], span: { start: 0, end: 4 } }], lineage: draft.lineage.slice(0, 1) }
  const plan = planDivisionAssignment(one, raw, { mode: 'append', edge: 'before', targetKey: 'a', key: 'op', span: { start: 1, end: 3 } })
  assert.deepEqual(plan.draft.members.map(row => [row.span.start, row.span.end, row.sequence_id]), [[0, 3, 'a'], [3, 4, undefined]])
})

test('both append directions and fully covered identities have explicit exits', () => {
  for (const [targetKey, expected] of [['a', [[0, 3, 'a'], [3, 4, 'b']]], ['b', [[0, 1, 'a'], [1, 4, 'b']]]]) {
    const value = planDivisionAssignment(draft, raw, { mode: 'append', targetKey, key: 'op', span: { start: 1, end: 3 } }).draft
    assert.deepEqual(value.members.map(row => [row.span.start, row.span.end, row.sequence_id]), expected)
  }
  const merged = planDivisionAssignment(draft, raw, { mode: 'append', targetKey: 'b', key: 'op', span: { start: 0, end: 4 } }).draft
  assert.deepEqual(merged.members.map(row => row.sequence_id), ['b'])
  assert.deepEqual(merged.exited_sequence_ids, ['a'])
  assert.equal(merged.members[0].title, 'B')
})

test('unselected gaps block append and range shrink releases text without changing the neighbor', () => {
  const separated = { ...draft, members: [{ ...draft.members[0], span: { start: 0, end: 1 } }, draft.members[1]] }
  assert.throws(() => planDivisionAssignment(separated, raw, { mode: 'append', targetKey: 'a', key: 'op', span: { start: 2, end: 4 } }), /未选原文/)
  const result = planDivisionAssignment(draft, raw, { mode: 'range', targetKey: 'a', key: 'op', span: { start: 0, end: 1 } }).draft
  assert.deepEqual(result.members.map(row => row.span), [{ start: 0, end: 1 }, { start: 2, end: 4 }])
})

test('interior extraction may retain the trailing fragment without duplicating identity', () => {
  const one = { ...draft, members: [{ ...draft.members[0], span: { start: 0, end: 4 } }], baseline: draft.baseline.slice(0, 1), lineage: draft.lineage.slice(0, 1) }
  const result = planDivisionAssignment(one, raw, { mode: 'new', key: 'c', title: 'C', span: { start: 1, end: 3 }, retainAfter: ['a'] }).draft
  assert.deepEqual(result.members.map(row => [row.span.start, row.span.end, row.sequence_id]), [[0, 1, undefined], [1, 3, undefined], [3, 4, 'a']])
})

test('whitespace can append, never forms a scene, and whitespace residuals become unassigned', () => {
  const one = { ...draft, members: [{ ...draft.members[0], span: { start: 0, end: 3 } }], baseline: draft.baseline.slice(0, 1), lineage: draft.lineage.slice(0, 1) }
  assert.throws(() => planDivisionAssignment(one, '甲\n\n', { mode: 'new', key: 'c', title: 'C', span: { start: 1, end: 3 } }), /纯空白/)
  const value = planDivisionAssignment(one, '甲\n\n', { mode: 'new', key: 'c', title: 'C', span: { start: 0, end: 1 } }).draft
  assert.equal(value.members.length, 1)
  assert.deepEqual(value.exited_sequence_ids, ['a'])
  const small = { ...one, members: [{ ...one.members[0], span: { start: 0, end: 1 } }] }
  assert.equal(planDivisionAssignment(small, '甲\n\n', { mode: 'append', targetKey: 'a', key: 'op', span: { start: 1, end: 3 } }).draft.members[0].span.end, 3)
})

test('successive extraction keeps every source mapped only to live results', () => {
  const first = planDivisionAssignment(draft, raw, { mode: 'new', key: 'c', title: 'C', span: { start: 1, end: 3 } }).draft
  const second = planDivisionAssignment(first, raw, { mode: 'append', targetKey: 'c', key: 'op', span: { start: 0, end: 4 } }).draft
  assert.deepEqual(second.lineage.map(row => row.target_keys), [['c'], ['c']])
  assert.deepEqual(second.exited_sequence_ids, ['a', 'b'])
  assert.deepEqual(draft.members.map(row => row.span), [{ start: 0, end: 2 }, { start: 2, end: 4 }])
})

test('fragment keys satisfy the existing 64 character identity contract', () => {
  const id = 'a'.repeat(36), operation = 'b'.repeat(36)
  const one = { ...draft, members: [{ ...draft.members[0], key: id, sequence_id: id, span: { start: 0, end: 4 } }], baseline: [{ sequence_id: id, version: 1 }], lineage: [{ sequence_id: id, target_keys: [id] }] }
  assert.ok(planDivisionAssignment(one, raw, { mode: 'new', key: operation, title: 'C', span: { start: 1, end: 3 } }).draft.members.every(row => row.key.length <= 64))
})


test('complete multi-scene coverage may retain the middle scene and releases all other identities', () => {
  const three = { ...draft, baseline: [...draft.baseline, { sequence_id: 'd', version: 1 }], members: [...draft.members, { key: 'd', sequence_id: 'd', title: 'D', span: { start: 4, end: 6 } }], lineage: [...draft.lineage, { sequence_id: 'd', target_keys: ['d'] }] }
  const result = planDivisionAssignment(three, '甲乙丙丁戊己', { mode: 'append', key: 'op', targetKey: 'b', span: { start: 0, end: 6 } }).draft
  assert.deepEqual(result.members.map(row => [row.title, row.sequence_id, row.span]), [['B', 'b', { start: 0, end: 6 }]])
  assert.deepEqual(result.exited_sequence_ids, ['a', 'd'])
  assert.deepEqual(result.lineage.map(row => row.target_keys), [['b'], ['b'], ['b']])
})
