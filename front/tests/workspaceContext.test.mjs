import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { restoreSelection, readWorkspaceContext, saveWorkspaceContext, readDesignPosition, readUnitSelection, saveUnitSelection } = await loadSource('workspaceContext')

test('each unit remembers explicit versions independently across plans and handles broken storage', () => {
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  saveUnitSelection('p1', 's1', 'plan1', 'u1', { prompt: 'prompt1', review: 'review1' })
  saveUnitSelection('p1', 's1', 'plan1', 'u2', { prompt: 'prompt2' })
  assert.deepEqual(readUnitSelection('p1', 's1', 'plan1', 'u1'), { prompt: 'prompt1', review: 'review1' })
  assert.deepEqual(readUnitSelection('p1', 's1', 'plan1', 'u2'), { prompt: 'prompt2' })
  assert.deepEqual(readUnitSelection('p1', 's1', 'plan2', 'u1'), {})
  assert.deepEqual(readUnitSelection('p2', 's1', 'plan1', 'u1'), {})
  assert.deepEqual(readUnitSelection('p1', 's2', 'plan1', 'u1'), {})
  for (const value of ['null', '["x"]', 'invalid', '{"prompt":12}']) {
    globalThis.sessionStorage = { getItem: () => value }
    assert.deepEqual(readUnitSelection('p1', 's1', 'plan1', 'u1'), {})
  }
  delete globalThis.sessionStorage
})

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

test('compact density is default and explicit standard density restores even at the top', () => {
  assert.equal(readDesignPosition(undefined, 'd1', 'all').density, 180)
  assert.deepEqual(readDesignPosition(JSON.stringify({ revisionId: 'd1', scope: 'all', top: 0, density: 220 }), 'd1', 'all'), { top: 0, density: 220 })
})

test('recent work is project scoped and rejects broken identities or stages', async () => {
  const { readRecentWork, saveRecentWork } = await loadSource('workspaceContext')
  const data = new Map()
  globalThis.sessionStorage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) }
  saveRecentWork('p1', { chapterId: 'ch1', sequenceId: 's1', view: 'shoot' })
  assert.deepEqual(readRecentWork('p1'), { chapterId: 'ch1', sequenceId: 's1', view: 'shoot' })
  assert.equal(readRecentWork('p2'), undefined)
  for (const value of ['null', 'bad', '{"chapterId":"ch1","sequenceId":"","view":"shoot"}', '{"chapterId":"ch1","sequenceId":"s1","view":"unknown"}']) {
    globalThis.sessionStorage = { getItem: () => value }
    assert.equal(readRecentWork('p1'), undefined)
  }
  delete globalThis.sessionStorage
})
