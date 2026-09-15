import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'

const { workspaceView, workspaceViews, withWorkspaceView } = await loadSource('workspaceNavigation')

test('all existing business links resolve to their stage without losing their target', () => {
  const expected = { design: 'design', shoot: 'shoot', visual: 'shoot', batch: 'shoot', cut: 'cut', continuity: 'cut', feedback: 'cut', ledger: 'cut' }
  for (const [view, stage] of Object.entries(expected)) {
    assert.equal(workspaceView(view), view)
    assert.equal(workspaceViews[view].stage, stage)
  }
  for (const invalid of [null, '', 'unknown', '__proto__', 'constructor']) assert.equal(workspaceView(invalid), 'design')
})

test('stage changes preserve frozen input and return context and do not mutate the original URL', () => {
  const original = new URLSearchParams('view=design&plan=p-old&unit=u1&returnTo=%2Fprojects%2Fp1')
  const next = withWorkspaceView(original, 'visual')
  assert.equal(next.get('view'), 'visual')
  assert.equal(next.get('plan'), 'p-old')
  assert.equal(next.get('unit'), 'u1')
  assert.equal(next.get('returnTo'), '/projects/p1')
  assert.equal(original.get('view'), 'design')
})
