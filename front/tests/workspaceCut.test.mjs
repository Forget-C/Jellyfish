import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource, clip, makeWorkspace } from './directing-fixtures.mjs'
const { sequentialCut, cutDurations, cutDestination, takeAction } = await loadSource('workspaceCut')

test('mixed cuts retain repeated Take ranges and keep estimated duration separate from real media', () => {
  const cut = { items: [clip('a', 't1', 1000, 2000), { kind: 'planned', id: 'p', design_revision_id: 'd1', shot_id: 'shot1', estimated_duration_ms: 3000, timeline_start_ms: 0, dialogue_cues: [] }, clip('b', 't1', 4000, 6000)] }
  const before = structuredClone(cut)
  const next = sequentialCut(cut)
  assert.deepEqual(next.items.map(item => item.timeline_start_ms), [0, 1000, 4000])
  assert.deepEqual(cutDurations(next), { media: 3000, planned: 3000, timeline: 6000 })
  assert.deepEqual(cut, before)
  assert.equal(next.items[0].take_id, next.items[2].take_id)
  assert.deepEqual(next.items[2].media_range, { source_in_ms: 4000, source_out_ms: 6000 })
})

test('timeline endpoint includes existing gaps without counting them as real coverage', () => {
  const cut = { items: [clip('a', 't1', 2000, 4000, 5000)] }
  assert.deepEqual(cutDurations(cut), { media: 2000, planned: 0, timeline: 7000 })
})

test('repair links pin the exact cut and item and retain the feedback return identity', () => {
  const original = new URLSearchParams('view=feedback&feedback=repair-old&prompt=unrelated&unit=other')
  const next = cutDestination(original, { view: 'cut', cut: 'old-cut', take: 't1', item: 'b', returnView: 'feedback' })
  assert.equal(next.get('feedback'), 'repair-old')
  assert.equal(next.get('focus'), 'cut-item:b')
  assert.equal(next.get('cut'), 'old-cut')
  assert.equal(original.get('view'), 'feedback')
  const shoot = cutDestination(next, { view: 'shoot', plan: 'p-old', unit: 'u1' })
  assert.equal(shoot.get('prompt'), '')
  assert.equal(shoot.get('review'), '')
  assert.equal(shoot.get('focus'), 'unit:u1')
  assert.equal(cutDestination(shoot, { view: 'shoot', plan: 'p-old', unit: 'u1', prompt: 'fixed' }).get('prompt'), 'fixed')
})

test('readable action names are derived from the Take’s fixed plan and unit', () => {
  const workspace = makeWorkspace()
  workspace.plans[1].content.units[0].coverage[0].action_scope = '同名单元的新动作'
  assert.equal(takeAction(workspace, 't1'), '递出旧信')
  assert.equal(takeAction(workspace, 'missing'), '动作范围未注明')
})
