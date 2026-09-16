import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { restoreSelection, readWorkspaceContext, saveWorkspaceContext, readDesignPosition } = await loadSource('workspaceContext')

test('explicit business context wins; stale or deliberately empty selection never becomes latest', () => {
  const rows = [{ id: 'old' }, { id: 'new' }]
  assert.equal(restoreSelection(rows, 'old', 'new')?.id, 'old')
  assert.equal(restoreSelection(rows, null, 'old')?.id, 'old')
  assert.equal(restoreSelection(rows, null, undefined)?.id, 'new')
  assert.equal(restoreSelection(rows, null, null), undefined)
  assert.equal(restoreSelection(rows, 'missing', 'old'), undefined)
})

test('saved browsing position is isolated by project and scene and merges independent panels', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  saveWorkspaceContext('p1', 's1', { plan: 'old', unit: 'u1' })
  saveWorkspaceContext('p1', 's1', { cut: 'c1' })
  assert.deepEqual(readWorkspaceContext('p1', 's1'), { plan: 'old', unit: 'u1', cut: 'c1' })
  assert.deepEqual(readWorkspaceContext('p2', 's1'), {})
  assert.deepEqual(readWorkspaceContext('p1', 's2'), {})
  globalThis.sessionStorage = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('denied') } }
  assert.doesNotThrow(() => saveWorkspaceContext('p1', 's1', { plan: 'p1' }))
  assert.deepEqual(readWorkspaceContext('p1', 's1'), {})
  delete globalThis.sessionStorage
})

test('design scrolling is restored only for matching revision and range', () => {
  assert.deepEqual(readDesignPosition(JSON.stringify({ revisionId: 'd1', scope: 'beat:a', top: 900, density: 180 }), 'd1', 'beat:a'), { top: 900, density: 180 })
  for (const raw of ['bad', 'null', '{"top":-1}', JSON.stringify({ revisionId: 'd2', scope: 'beat:a', top: 900 })]) assert.equal(readDesignPosition(raw, 'd1', 'beat:a').top, 0)
})
