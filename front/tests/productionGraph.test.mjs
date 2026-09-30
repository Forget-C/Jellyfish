import test from 'node:test'
import assert from 'node:assert/strict'
import { loadSource, makeWorkspace, revision } from './directing-fixtures.mjs'
const { buildProductionGraph } = await loadSource('productionGraph')
const actual = (graph, kind) => graph.nodes.filter(node => node.kind === kind && !node.action)
const reference = (id, extra = {}) => ({ id, file_id: `file-${id}`, media_kind: 'image', purpose: 'identity', participant_ids: ['person1'], ordinal: 0, source: { kind: 'human', reference: id, version: '1' }, ...extra })

test('current unit graph retains precise historical dependency and never infers adjacency', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[1].content)
  plan.units.push({ ...structuredClone(plan.units[0]), id: 'u2', dependencies: [{ plan_revision_id: 'p-old', unit_id: 'u1', frame_id: 'frame1', reference_id: 'ref1' }] })
  const graph = buildProductionGraph(workspace, 'p-new', plan, 'u2')
  assert.equal(actual(graph, 'unit').length, 1)
  const dependency = actual(graph, 'dependency')[0]
  assert.equal(dependency.planId, 'p-new'); assert.equal(dependency.unitId, 'u2')
  assert.equal(dependency.sourcePlanId, 'p-old'); assert.equal(dependency.sourceUnitId, 'u1')
  assert.ok(graph.edges.some(edge => edge.from === dependency.id && edge.to === actual(graph, 'unit')[0].id))
  assert.equal(new Set(graph.nodes.map(node => node.id)).size, graph.nodes.length)
})

test('preparation never projects edited draft as the source of historical prompts and candidates', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', text: 'fixed', sources: [] })]
  const saved = JSON.stringify(workspace)
  plan.units[0].duration_ms = 12000
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.ok(!graph.nodes.some(node => ['prompt', 'review', 'take'].includes(node.kind)))
  assert.match(actual(graph, 'unit')[0].detail, /12 秒/)
  assert.equal(JSON.stringify(workspace), saved)
})

test('legacy references remain distinct while explicit subject groups preserve every file and ordinal', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].references = [reference('a', { ordinal: 3 }), reference('b', { ordinal: 2 }), reference('c', { subject_group_id: 'same', ordinal: 1 }), reference('d', { subject_group_id: 'same', ordinal: 0 })]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.deepEqual(actual(graph, 'reference').map(node => node.referenceIds), [['d', 'c'], ['b'], ['a']])
  assert.equal(graph.edges.filter(edge => edge.kind === 'reference').length, 3)
  assert.deepEqual(plan.units[0].references.map(row => row.id), ['a', 'b', 'c', 'd'])
})

test('frame references do not collapse into subject groups and all non-person media remain visible', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].references = [reference('a', { input_role: 'first_frame', participant_ids: [], subject_group_id: 'same' }), reference('b', { input_role: 'last_frame', participant_ids: [], subject_group_id: 'same' }), reference('audio', { media_kind: 'audio', purpose: 'sound', participant_ids: [] }), reference('video', { media_kind: 'video', participant_ids: [] })]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.equal(actual(graph, 'reference').length, 4)
  assert.deepEqual(actual(graph, 'reference').flatMap(node => node.referenceIds).sort(), ['a', 'audio', 'b', 'video'])
})

test('one unit covering several shots keeps independent coverage identities and fixed design numbering', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  const design = workspace.designs[0].content
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'second-shot' })
  plan.units[0].coverage.push({ ...structuredClone(plan.units[0].coverage[0]), id: 'second-range', shot_id: 'second-shot', action_scope: '第二段动作' })
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.deepEqual(actual(graph, 'coverage').map(node => node.objectId), ['cover1', 'second-range'])
  assert.deepEqual(actual(graph, 'coverage').map(node => node.label), ['镜头 01', '镜头 02'])
  assert.deepEqual(actual(graph, 'coverage').map(node => node.detail), ['递出旧信', '第二段动作'])
})

test('direct and indirect design participants are distinguished without introducing the whole cast', () => {
  const workspace = makeWorkspace(), plan = workspace.plans[0].content, design = workspace.designs[0].content
  design.participants.push({ id: 'indirect', name: '李四' }, { id: 'elsewhere', name: '全场其他人物' })
  design.performance.beats.push({ ...structuredClone(design.performance.beats[0]), participant_id: 'indirect' })
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.deepEqual(actual(graph, 'participant').map(node => [node.objectId, node.indirect]), [['person1', false], ['indirect', true]])
  assert.ok(graph.edges.some(edge => edge.kind === 'context' && edge.indirect))
})

test('already-selected outside participants survive scope reduction and missing identities remain explicit', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].coverage = []
  plan.units[0].references = [reference('outside', { participant_ids: ['missing'] })]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.equal(actual(graph, 'reference').length, 1)
  assert.equal(actual(graph, 'participant')[0].missing, true)
  assert.equal(actual(graph, 'participant')[0].objectId, 'missing')
})

test('asset availability and fixed selected inputs coexist instead of overwriting each other', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  workspace.designs[0].content.participants[0].character_id = 'actor'
  plan.units[0].references = [reference('saved')]
  const asset = { id: 'actor', kind: 'character', name: '张三', description: '', image_file_ids: [] }
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1', [asset])
  assert.match(actual(graph, 'participant')[0].detail, /资产暂无可选图片 · 本次已选 1 份参考/)
  assert.deepEqual(actual(graph, 'reference')[0].referenceIds, ['saved'])
  assert.match(actual(buildProductionGraph(workspace, 'p-old', plan, 'u1'), 'participant')[0].detail, /资产状态待核实/)
})

test('empty and populated collections retain interface-only append nodes without mutating payload', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].coverage = []
  const before = JSON.stringify(plan)
  const graph = buildProductionGraph(workspace, 'unsaved', plan, 'u1')
  assert.deepEqual(graph.nodes.filter(node => node.action).map(node => node.kind), ['coverage', 'reference', 'dependency'])
  assert.ok(graph.nodes.filter(node => node.action).every(node => node.objectId === ''))
  assert.equal(JSON.stringify(plan), before)
  plan.units[0].references = [reference('a')]
  assert.equal(buildProductionGraph(workspace, 'unsaved', plan, 'u1').nodes.filter(node => node.action).length, 3)
})

test('dependency validity distinguishes unknown, missing binding and stale actual frames', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].dependencies = [{ plan_revision_id: 'p-new', unit_id: 'u1', frame_id: 'frame1', reference_id: 'actual' }]
  plan.units[0].references = [reference('actual', { file_id: 'frame-file' })]
  let node = actual(buildProductionGraph(workspace, 'p-old', plan, 'u1'), 'dependency')[0]
  assert.match(node.detail, /待核实/)
  node = actual(buildProductionGraph(workspace, 'p-old', plan, 'u1', [], { frames: [{ id: 'frame1', current: true, file_id: 'other-file' }] }), 'dependency')[0]
  assert.equal(node.missing, true); assert.match(node.detail, /已变化/)
  plan.units[0].references = []
  node = actual(buildProductionGraph(workspace, 'p-old', plan, 'u1'), 'dependency')[0]
  assert.match(node.detail, /待配置/)
})

test('plan overview shows explicit branching dependencies and boundary identities with no input expansion', () => {
  const workspace = makeWorkspace(), plan = workspace.plans[0].content
  const unit = structuredClone(plan.units[0])
  plan.units = ['u1', 'u2', 'u3'].map(id => ({ ...structuredClone(unit), id, references: [reference(id)], dependencies: [] }))
  plan.units[2].dependencies = ['u1', 'u2'].map(unit_id => ({ plan_revision_id: 'p-old', unit_id }))
  plan.units[2].dependencies.push({ plan_revision_id: 'missing-plan', unit_id: 'u1' })
  const graph = buildProductionGraph(workspace, 'p-old', plan)
  const target = actual(graph, 'unit').find(node => node.unitId === 'u3')
  assert.equal(graph.edges.filter(edge => edge.kind === 'dependency' && edge.to === target.id).length, 3)
  assert.ok(!graph.nodes.some(node => ['reference', 'participant', 'location'].includes(node.kind) || node.action))
  assert.equal(actual(graph, 'dependency')[0].sourcePlanId, 'missing-plan')
  for (const edge of graph.edges) assert.ok(graph.nodes.some(node => node.id === edge.from) && graph.nodes.some(node => node.id === edge.to))
})

test('real reference bindings stay direct even when the design participant is indirect', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  workspace.designs[0].content.direction.shots[0].blocking_state_ids = []
  plan.units[0].references = [reference('selected')]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.equal(actual(graph, 'participant')[0].indirect, true)
  assert.ok(graph.edges.some(edge => edge.kind === 'context' && edge.indirect))
  assert.ok(graph.edges.some(edge => edge.kind === 'binding' && !edge.indirect))
})

test('large explicit groups keep all stable reference identities in one input node', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.units[0].references = Array.from({ length: 30 }, (_, i) => reference('image-' + i, { subject_group_id: 'subject', ordinal: i }))
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.equal(actual(graph, 'reference').length, 1)
  assert.equal(actual(graph, 'reference')[0].referenceIds.length, 30)
  assert.deepEqual(actual(graph, 'reference')[0].referenceIds, plan.units[0].references.map(row => row.id))
})

test('missing fixed design and invalid selected unit do not substitute another version or unit', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  plan.design_revision_id = 'missing-design'
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1')
  assert.equal(actual(graph, 'coverage')[0].missing, true)
  assert.equal(actual(graph, 'participant').length, 0)
  assert.equal(buildProductionGraph(workspace, 'p-old', plan, 'missing-unit').nodes.length, 0)
})

test('unlinked location remains actionable and temporary space input binds without fabricating a design asset', () => {
  const workspace = makeWorkspace(), plan = structuredClone(workspace.plans[0].content)
  const empty = buildProductionGraph(workspace, 'p-old', plan, 'u1', [])
  assert.equal(actual(empty, 'location').length, 1)
  assert.equal(actual(empty, 'location')[0].assetId, undefined)
  assert.match(actual(empty, 'location')[0].detail, /未关联场所资产/)
  plan.units[0].references = [reference('space', { purpose: 'space', participant_ids: [] })]
  const graph = buildProductionGraph(workspace, 'p-old', plan, 'u1', [])
  const location = actual(graph, 'location')[0]
  assert.match(location.detail, /本次已选 1 份空间参考/)
  assert.ok(graph.edges.some(edge => edge.kind === 'binding' && edge.from === location.id && edge.to === actual(graph, 'reference')[0].id))
  assert.equal(workspace.designs[0].content.direction.location_asset_id, null)
  assert.ok(!buildProductionGraph(workspace, 'p-old', plan).nodes.some(node => node.kind === 'location'))
})
