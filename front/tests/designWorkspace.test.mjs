import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { makeWorkspace, loadSource } from './directing-fixtures.mjs'
const { revisionDifferences } = await loadSource('revisionDiff')
const { patchDesign } = await loadSource('designValue')
const source = await readFile(new URL('../src/pages/aiStudio/directing/designWorkspace.ts', import.meta.url), 'utf8')
const valueSource = await readFile(new URL('../src/pages/aiStudio/directing/designValue.ts', import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
const data = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`
const { sceneOverview, shotRelationPath, shotGraph, designObjects, shotIssues, scopeShots, scopeGraph, reorderScopeShots, relationBinding, relationOwner, changeRelation } = await import(data(compile(source).replaceAll("'./designValue'", JSON.stringify(data(compile(valueSource))))))

test('beat ranges retain shared shot identities and expose unassigned or missing beats', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.beats.push({ ...structuredClone(value.direction.beats[0]), id: 'beat2' })
  const original = structuredClone(value.direction.shots[0])
  value.direction.shots = [{ ...original, id: 'both', beat_ids: ['beat1', 'beat2'] }, { ...original, id: 'unknown', beat_ids: ['deleted'] }, { ...original, id: 'none', beat_ids: [] }]
  assert.equal(scopeShots(value, 'all').length, 3)
  assert.equal(scopeShots(value, 'beat:beat1')[0], scopeShots(value, 'beat:beat2')[0])
  assert.deepEqual(scopeShots(value, 'unassigned').map(s => s.id), ['unknown', 'none'])
  const graph = scopeGraph(value, 'beat:beat2')
  assert.equal(graph.nodes.filter(n => n.key.startsWith('shot:')).length, 1)
  assert.ok(graph.nodes.some(n => n.key === 'beat:beat1'))
})

test('reordering a filtered range preserves hidden slots, references and immutable source data', () => {
  const value = makeWorkspace().designs[0].content
  const original = structuredClone(value.direction.shots[0])
  value.direction.shots = ['a', 'hidden1', 'b', 'hidden2', 'c'].map(id => ({ ...structuredClone(original), id }))
  const before = structuredClone(value)
  const next = reorderScopeShots(value, ['a', 'b', 'c'], 'c', 'a')
  assert.deepEqual(next.direction.shots.map(s => s.id), ['c', 'hidden1', 'a', 'hidden2', 'b'])
  assert.deepEqual(value, before)
  for (const shot of next.direction.shots) assert.equal(shot, value.direction.shots.find(s => s.id === shot.id))
  assert.equal(reorderScopeShots(value, ['a'], 'a', 'hidden1'), value)
})

test('graph branches represent actual direct and indirect references, including missing IDs', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.shots[0].criterion_ids.push('missing')
  const graph = shotGraph(value, 'shot1')
  assert.ok(graph.edges.some(e => e.from === 'shot:shot1' && e.to === 'beat:beat1' && e.label === '覆盖节拍'))
  assert.ok(graph.edges.some(e => e.from === 'shot:shot1' && e.to === 'blocking:state1'))
  assert.ok(graph.edges.some(e => e.from === 'blocking:state1' && e.to === 'participant:person1'))
  assert.ok(graph.edges.some(e => e.from === 'blocking:state1' && e.to === 'anchor:anchor1'))
  assert.ok(graph.edges.some(e => e.from === 'beat:beat1' && e.to === 'performance:0' && e.indirect))
  assert.equal(graph.nodes.find(n => n.key === 'criterion:missing').kind, 'missing')
  assert.ok(!graph.edges.some(e => e.from === 'beat:beat1' && e.to === 'event:event1'))
  assert.ok(shotIssues(value, 'shot1').includes('关联缺失'))
})
test('object editing retains untouched roles, shared identities, sources and Note states', () => {
  const value = makeWorkspace().designs[0].content
  const before = structuredClone(value)
  const next = patchDesign(value, ['performance','beats',0,'hands'], { state: 'unknown' })
  assert.deepEqual(value, before)
  const expected = structuredClone(before); expected.performance.beats[0].hands = { state: 'unknown' }
  assert.deepEqual(next, expected)
  const objects = designObjects(value)
  for (const kind of ['direction','performance','staging','cinematography','continuity','sound','prompt','participants']) assert.ok(objects.some(o => o.kind === kind))
  assert.equal(new Set(objects.map(o => o.key)).size, objects.length)
})
test('revision compare uses stable identities and separately reports reordering and Note/source changes', () => {
  const before = { shots: [{ id: 'a', result: { state: 'proposal', text: '动作', sources: [{ kind: 'human', reference: 'author', version: '1' }] } }, { id: 'b' }] }
  const after = structuredClone(before)
  after.shots.reverse(); after.shots[1].result.state = 'fact'; after.shots[1].result.sources[0].version = '2'
  const diff = revisionDifferences(before, after)
  assert.equal(diff.length, 3)
  assert.ok(diff.some(row => row.path === 'shots[a].result.state' && row.before === 'proposal' && row.after === 'fact'))
  assert.ok(diff.some(row => row.path === 'shots[a].result.sources[human:author].version'))
  assert.ok(diff.some(row => row.path === 'shots.顺序'))
})
test('revision compare distinguishes adding/removing objects and never mutates either snapshot', () => {
  const before = { units: [{ id: 'same', coverage: [] }, { id: 'old' }] }, after = { units: [{ id: 'same', coverage: [] }, { id: 'new' }] }
  const copies = structuredClone([before,after])
  assert.deepEqual(revisionDifferences(before,after).map(d => [d.path,d.kind]), [['units[old]','removed'],['units[new]','added']])
  assert.deepEqual([before,after], copies)
})


test('relation editing changes only legal direct references and distinguishes unlinking from deletion', () => {
  const value = makeWorkspace().designs[0].content
  const before = structuredClone(value)
  const edge = shotGraph(value, 'shot1').edges.find(e => e.label === '调度依据')
  const binding = relationBinding(value, edge)
  const next = changeRelation(value, binding)
  assert.deepEqual(next.direction.shots[0].blocking_state_ids, [])
  assert.deepEqual(next.direction.blocking_states, value.direction.blocking_states)
  assert.deepEqual(value, before)
  assert.equal(changeRelation(value, binding, 'unknown'), value)
  const required = relationBinding(value, shotGraph(value, 'shot1').edges.find(e => e.label === '调度人物'))
  assert.equal(changeRelation(value, required), value)
  assert.equal(relationBinding(value, shotGraph(value, 'shot1').edges.find(e => e.indirect)), undefined)
})


test('relation identities retain colon segments and stale edges cannot add references', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.shots[0].id = 'shot:one'
  value.direction.beats[0].id = 'beat:one'
  value.direction.shots[0].beat_ids = ['beat:one']
  const binding = relationBinding(value, { from: 'shot:shot:one', to: 'beat:beat:one', label: '覆盖节拍' })
  assert.equal(binding.target, 'beat:one')
  const next = changeRelation(value, binding)
  assert.deepEqual(next.direction.shots[0].beat_ids, [])
  assert.equal(changeRelation(next, binding, 'beat:one'), next)
  assert.equal(scopeGraph(value, 'all', []).nodes.length, 0)
})

test('indirect relation navigation targets the object that owns the original reference', () => {
  const value = makeWorkspace().designs[0].content
  const edges = shotGraph(value, 'shot1').edges
  assert.equal(relationOwner(edges.find(edge => edge.label === '节拍表演')), 'performance:0')
  assert.equal(relationOwner(edges.find(edge => edge.label === '表演人物')), 'performance:0')
})


test('scene overview keeps real shared identities, unassigned rows and explanatory paths', () => {
  const value = makeWorkspace().designs[0].content
  const shot = value.direction.shots[0]
  value.direction.beats.push({ ...structuredClone(value.direction.beats[0]), id: 'beat2' })
  value.direction.shots = [
    { ...structuredClone(shot), id: 'one', beat_ids: ['beat1', 'beat2'] },
    { ...structuredClone(shot), id: 'two', beat_ids: ['beat2'] },
    { ...structuredClone(shot), id: 'three', beat_ids: ['beat1'] },
    { ...structuredClone(shot), id: 'missing', beat_ids: ['deleted'] },
  ]
  value.participants.push({ ...structuredClone(value.participants[0]), id: 'same-name' })
  const before = structuredClone(value)
  const data = sceneOverview(value)
  assert.deepEqual(data.rows.map(row => row.shots.map(shot => shot.id)), [['one', 'three'], ['one', 'two'], ['missing']])
  assert.equal(new Set(data.rows.flatMap(row => row.shots.map(shot => shot.id))).size, 4)
  assert.ok(!data.rows.some(row => row.objects.some(node => node.key === 'participant:same-name')))
  assert.equal(data.frequency.get('participant:person1'), 3)
  assert.deepEqual(shotRelationPath(data.graphs.get('one'), 'one', 'participant:person1').map(edge => edge.label), ['调度依据', '调度人物'])
  assert.ok(shotRelationPath(data.graphs.get('one'), 'one', 'performance:0').some(edge => edge.indirect))
  assert.deepEqual(shotRelationPath(data.graphs.get('one'), 'one', 'participant:same-name'), [])
  assert.deepEqual(sceneOverview(value, ['two']).rows.map(row => row.shots.map(shot => shot.id)), [[], ['two'], []])
  assert.deepEqual(value, before)
  value.direction.beats = []
  assert.equal(sceneOverview(value).rows[0].scope, 'unassigned')
  assert.equal(sceneOverview(value).rows[0].shots.length, 4)
})

test('missing indirect participants remain issues with a real path to their owner', () => {
  const value = makeWorkspace().designs[0].content
  value.performance.beats[0].participant_id = 'removed-person'
  assert.ok(shotIssues(value, 'shot1').includes('关联缺失'))
  const path = shotRelationPath(shotGraph(value, 'shot1'), 'shot1', 'participant:removed-person')
  assert.equal(path.at(-1).from, 'performance:0')
  assert.equal(path.at(-1).indirect, true)
})
