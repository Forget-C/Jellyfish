import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource, makeWorkspace, revision } from './directing-fixtures.mjs'
const { buildProductionGraph } = await loadSource('productionGraph')

test('dependencies bind historical plan identities, never adjacent or same-name units', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[1].content)
  plan.units.push({ ...structuredClone(plan.units[0]), id: 'u2', dependencies: [{ plan_revision_id: 'p-old', unit_id: 'u1', frame_id: 'frame1', reference_id: 'ref1' }] })
  const graph = buildProductionGraph(workspace, 'p-new', plan)
  const units = graph.nodes.filter(node => node.kind === 'unit')
  assert.equal(units.length, 2)
  const dependency = graph.nodes.find(node => node.kind === 'dependency')
  assert.equal(dependency.planId, 'p-old')
  assert.equal(dependency.unitId, 'u1')
  assert.ok(graph.edges.some(edge => edge.from === dependency.id && edge.to === units[1].id))
  assert.ok(!graph.edges.some(edge => edge.from === units[0].id && edge.to === units[1].id))
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length)
})

test('multiple prompts and takes preserve exact production source; review attaches only to matching prompt', () => {
  const workspace = makeWorkspace(), plan = workspace.plans[0].content
  workspace.prompts = ['prompt1', 'prompt2'].map(id => revision(id, { plan_revision_id: 'p-old', unit_id: 'u1', text: id, sources: [], decisions: [], format_version: 'v4' }))
  workspace.reviews = [revision('review1', { occurrences: [{ prompt_revision_id: 'prompt1', plan_revision_id: 'p-old', unit_id: 'u1' }], rows: [] })]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  const prompts = graph.nodes.filter(node => node.kind === 'prompt')
  const takes = graph.nodes.filter(node => node.kind === 'take')
  assert.equal(prompts.length, 2); assert.equal(takes.length, 3)
  for (const take of takes) assert.ok(graph.edges.some(edge => edge.from === prompts[0].id && edge.to === take.id))
  assert.ok(!graph.edges.some(edge => edge.from === prompts[1].id && takes.some(take => take.id === edge.to)))
  assert.equal(graph.nodes.filter(node => node.kind === 'review').length, 1)
})

test('same-subject images stay distinct and filtering keeps only current unit with its real external inputs', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].references = ['a', 'b'].map(id => ({ id, file_id: id, media_kind: 'image', purpose: 'identity', participant_ids: ['actor1'], ordinal: 0, source: { kind: 'human', reference: id, version: '1' } }))
  plan.units.push({ ...structuredClone(plan.units[0]), id: 'u2' })
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.equal(graph.nodes.filter(node => node.kind === 'reference').length, 2)
  assert.equal(graph.nodes.filter(node => node.kind === 'unit').length, 1)
  assert.equal(graph.edges.filter(edge => edge.kind === 'dependency').length, 0)
  for (const edge of graph.edges) assert.ok(graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to))
})

test('edited preparation cannot become the stated source of an existing fixed prompt', () => {
  const workspace = makeWorkspace(), draft = structuredClone(workspace.plans[0].content)
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: 'fixed', sources: [], decisions: [], format_version: 'v4' })]
  draft.units[0].duration_ms = 12000
  const graph = buildProductionGraph(workspace, 'p-old', draft, 'u1')
  const draftUnit = graph.nodes.find(node => node.kind === 'unit' && !node.external)
  const prompt = graph.nodes.find(node => node.kind === 'prompt')
  assert.ok(!graph.edges.some(edge => edge.from === draftUnit.id && edge.to === prompt.id))
  assert.ok(graph.edges.some(edge => edge.to === prompt.id && graph.nodes.some(node => node.id === edge.from && node.external)))
})

test('one unit covering several shots keeps each range and the fixed design numbering', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  const design = workspace.designs.find(row => row.id === plan.design_revision_id).content
  const original = design.direction.shots[0]
  design.direction.shots.push({ ...structuredClone(original), id: 'second-shot' })
  const coverage = plan.units[0].coverage[0]
  plan.units[0].coverage = [
    { ...coverage, id: 'first-range', shot_id: original.id },
    { ...coverage, id: 'second-range', shot_id: 'second-shot' },
  ]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  const ranges = graph.nodes.filter(node => node.kind === 'coverage')
  assert.deepEqual(ranges.map(node => node.objectId), ['first-range', 'second-range'])
  assert.deepEqual(ranges.map(node => node.detail), ['镜头 01 · 本单元第 1 段', '镜头 02 · 本单元第 2 段'])
  const unit = graph.nodes.find(node => node.kind === 'unit' && !node.external)
  assert.equal(graph.edges.filter(edge => edge.kind === 'coverage' && edge.to === unit.id).length, 2)
})

test('branching dependencies preserve both sources and expose missing historical units', () => {
  const workspace = makeWorkspace(), plan = workspace.plans[0].content
  const original = structuredClone(plan.units[0])
  plan.units = ['u1', 'u2', 'u3'].map(id => ({ ...structuredClone(original), id, dependencies: [] }))
  plan.units[2].dependencies = ['u1', 'u2'].map(unit_id => ({ plan_revision_id: 'p-old', unit_id, frame_id: `frame-${unit_id}`, reference_id: `ref-${unit_id}` }))
  plan.units[2].dependencies.push({ plan_revision_id: 'missing-plan', unit_id: 'u1', frame_id: 'frame-old', reference_id: 'ref-old' })
  const graph = buildProductionGraph(workspace, 'p-old', plan)
  const target = graph.nodes.find(node => node.kind === 'unit' && node.unitId === 'u3')
  const incoming = graph.edges.filter(edge => edge.kind === 'dependency' && edge.to === target.id)
  assert.equal(incoming.length, 3)
  const missing = graph.nodes.find(node => node.planId === 'missing-plan')
  assert.equal(missing.detail, '固定来源单元不可用')
  for (const edge of incoming) assert.ok(graph.nodes.some(node => node.id === edge.from))
  assert.ok(!graph.edges.some(edge => edge.kind === 'dependency' && edge.to !== target.id))
})
