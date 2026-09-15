import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { readPreparation, writePreparation } = await loadSource('workspacePreparation')
test('local preparations retain recognized fields, isolate scope, and never mutate defaults', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  const defaults = { prompt: '', duration: 3, references: [] }
  assert.equal(writePreparation('p1:s1:visual', { prompt: '站位', duration: 5, references: ['f1'], ignored: 'extra' }), true)
  assert.deepEqual(readPreparation('p1:s1:visual', defaults), { prompt: '站位', duration: 5, references: ['f1'] })
  assert.deepEqual(readPreparation('p1:s2:visual', defaults), defaults)
  assert.deepEqual(defaults, { prompt: '', duration: 3, references: [] })
  writePreparation('invalid', { prompt: 8, duration: 'bad', references: [false] })
  assert.deepEqual(readPreparation('invalid', defaults), defaults)
  globalThis.sessionStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.equal(writePreparation('p1:s1:visual', defaults), false)
  assert.deepEqual(readPreparation('p1:s1:visual', defaults), defaults)
  delete globalThis.sessionStorage
})
