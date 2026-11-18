import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { readRecentWork } = await loadSource('workspaceContext')

test('recent work is project scoped and rejects broken identities or stages', () => {
  const data = new Map()
  data.set('directing-recent:p1', JSON.stringify({ chapterId: 'ch1', sequenceId: 's1', view: 'shoot' }))
  globalThis.sessionStorage = { getItem: key => data.get(key) }
  assert.deepEqual(readRecentWork('p1'), { chapterId: 'ch1', sequenceId: 's1', view: 'shoot' })
  assert.equal(readRecentWork('p2'), undefined)
  for (const value of ['null', 'bad', '{"chapterId":"ch1","sequenceId":"","view":"shoot"}', '{"chapterId":"ch1","sequenceId":"s1","view":"unknown"}']) {
    globalThis.sessionStorage = { getItem: () => value }
    assert.equal(readRecentWork('p1'), undefined)
  }
  delete globalThis.sessionStorage
})
