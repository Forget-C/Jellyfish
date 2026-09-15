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
const { shotGraph, designObjects, shotIssues } = await import(data(compile(source).replaceAll("'./designValue'", JSON.stringify(data(compile(valueSource))))))

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
