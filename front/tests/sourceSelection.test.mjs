import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'
const { selectionSpan, sourceSlice, rangeConflicts, sameSpan, textareaSpan } = await loadSource('sourceSelection')

test('native offsets preserve Unicode, repeated text, newlines and reverse selections', () => {
  const raw = '她😀推门。\n她😀推门。'
  assert.deepEqual(selectionSpan(raw, 7, 13), { start: 6, end: 11 })
  assert.deepEqual(selectionSpan(raw, 13, 7), { start: 6, end: 11 })
  assert.equal(sourceSlice(raw, { start: 6, end: 11 }), '她😀推门。')
  assert.deepEqual(selectionSpan(raw, 1, 8), { start: 1, end: 7 })
  assert.equal(selectionSpan(raw, 1, 2), undefined, 'half surrogate is rejected')
  assert.equal(selectionSpan(raw, 6, 7), undefined, 'whitespace only')
  assert.equal(selectionSpan(raw, 2, 2), undefined)
  assert.equal(selectionSpan(raw, -1, 2), undefined)
  assert.equal(selectionSpan(raw, 0, 99), undefined)
})

test('range conflicts ignore self and outdated ranges, allow adjacent ranges', () => {
  const rows = [{ id: 'a', span: { start: 0, end: 5 }, source_changed: false }, { id: 'b', span: { start: 5, end: 10 }, source_changed: true }]
  assert.deepEqual(rangeConflicts(rows, { start: 5, end: 8 }), [])
  assert.deepEqual(rangeConflicts(rows, { start: 4, end: 6 }).map(row => row.id), ['a'])
  assert.deepEqual(rangeConflicts(rows, { start: 1, end: 3 }, 'a'), [])
  assert.ok(sameSpan({ start: 0, end: 5 }, { start: 0, end: 5 }))
})

test('textarea CRLF and CR offsets map back to untouched source characters', () => {
  const raw = '前言\r\n她😀推门。\r末尾'
  assert.deepEqual(textareaSpan(raw, 3, 6), { start: 4, end: 6 })
  assert.equal(sourceSlice(raw, textareaSpan(raw, 3, 6)), '她😀')
  assert.deepEqual(textareaSpan(raw, 6, 3), { start: 4, end: 6 })
  assert.equal(textareaSpan(raw, 4, 5), undefined)
  assert.equal(textareaSpan(raw, 0, 100), undefined)
})
