import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource } from './directing-fixtures.mjs'
const { productionRecords, uniqueNewRecord, designResultRecorded, shotProductionTargets } = await loadSource('workspaceProduction')

test('same unit name in different plans never mixes prompts, reviews or videos', () => {
  const prompt = (id, plan) => ({ id, content: { plan_revision_id: plan, unit_id: 'same' } })
  const review = (id, promptId, plan) => ({ id, content: { occurrences: [{ prompt_revision_id: promptId, plan_revision_id: plan, unit_id: 'same' }] } })
  const workspace = { prompts: [prompt('p1', 'old'), prompt('p2', 'new'), prompt('p3', 'new')], reviews: [review('r1', 'p1', 'old'), review('r2', 'p2', 'new'), review('wrong', 'p2', 'old'), { id: 'empty', content: { occurrences: [] } }], takes: [{ id: 't1', plan_revision_id: 'old', unit_id: 'same' }, { id: 't2', plan_revision_id: 'new', unit_id: 'same' }] }
  const result = productionRecords(workspace, 'new', 'same', 'p1')
  assert.deepEqual(result.prompts.map(row => row.id), ['p2', 'p3'])
  assert.equal(result.prompt, undefined)
  assert.deepEqual(result.reviews, [])
  assert.deepEqual(result.takes.map(row => row.id), ['t2'])
  assert.deepEqual(productionRecords(workspace, 'new', 'same', 'p2').reviews.map(row => row.id), ['r2'])
  assert.equal(productionRecords(workspace, 'new', 'same').prompt, undefined)
})

test('concurrent response never chooses the last new version as this operation result', () => {
  assert.equal(uniqueNewRecord([{ id: 'old' }], [{ id: 'old' }, { id: 'a' }, { id: 'b' }]), undefined)
  assert.equal(uniqueNewRecord([{ id: 'old' }], [{ id: 'old' }]), undefined)
  assert.equal(uniqueNewRecord([{ id: 'old' }], [{ id: 'a' }, { id: 'old' }]).id, 'a')
})


test('editing a recorded suggestion does not make its task pending again when model provenance remains', () => {
  const design = { sources: [], direction: { text: 'model suggestion', sources: [{ kind: 'model', reference: 'task-identity', version: '1' }] } }
  const edited = structuredClone(design)
  edited.direction.text = 'human refinement'
  assert.equal(designResultRecorded(design, [{ content: edited }]), true)
  edited.direction.sources[0].reference = 'other-task'
  assert.equal(designResultRecorded(design, [{ content: edited }]), false)
  assert.equal(designResultRecorded(design, [{ content: { ...design, sources: [{ kind: 'human', reference: 'chapter', version: '2' }] } }]), true)
})

test('shot production destinations preserve design and plan identities and every matching unit', () => {
  const unit = id => ({ id, coverage: [{ shot_id: 'shot', action_scope: '递信' }, { shot_id: 'shot', action_scope: '停手' }] })
  const workspace = { plans: [{ id: 'old', confirmed_at: 'date', content: { design_revision_id: 'old-design', units: [unit('same')] } }, { id: 'a', content: { design_revision_id: 'design', units: [unit('same'), unit('second')] } }, { id: 'b', content: { design_revision_id: 'design', units: [unit('same')] } }] }
  const targets = shotProductionTargets(workspace, 'design', 'shot')
  assert.deepEqual(targets.map(row => [row.planId, row.unitId]), [['a', 'same'], ['a', 'second'], ['b', 'same']])
  assert.equal(targets[0].label, '计划 2 · 单元 1')
  assert.equal(targets[0].coverage, '递信；停手')
  assert.deepEqual(shotProductionTargets(workspace, 'design', 'missing'), [])
})
