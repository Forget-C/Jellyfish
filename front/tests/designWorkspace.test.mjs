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
const { directorDesignGraph, shotCanvasGraph, designDomain, designCoreContent, sceneOverview, shotRelationPath, shotGraph, sceneDesignGraph, designObjects, designObjectLayoutId, shotIssues, scopeShots, scopeGraph, reorderScopeShots, relationBinding, relationOwner, changeRelation } = await import(data(compile(source).replaceAll("'./designValue'", JSON.stringify(data(compile(valueSource))))))

test('shot grouping counts a shared anchor reached through blocking and activity in different shots', () => {
  const value = makeWorkspace().designs[0].content
  const second = structuredClone(value.direction.shots[0])
  second.id = 'shot2'; second.beat_ids = []; second.blocking_state_ids = []; second.event_ids = ['event2']; second.participant_ids = []
  value.direction.shots.push(second)
  value.staging.activities.push({ ...structuredClone(value.staging.activities[0]), trigger_event_id: 'event2', anchor_ids: [value.direction.anchors[0].id] })
  const anchor = `anchor:${value.direction.anchors[0].id}`
  const overview = shotCanvasGraph(value)
  assert.deepEqual(overview.memberships.get(anchor), ['shot1', 'shot2'])
  assert.equal(overview.location(anchor), 'shared')
  assert.equal(overview.nodes.filter(node => node.key === anchor).length, 1)
  assert.equal(shotCanvasGraph(value, 'shot2').nodes.find(node => node.key === anchor)?.kind, 'reference')
})

test('shot grouping keeps one editable original and only direct shared references', () => {
  const value = makeWorkspace().designs[0].content
  const second = structuredClone(value.direction.shots[0])
  second.id = 'shot2'; second.participant_ids = []
  value.direction.shots.push(second)
  const overview = shotCanvasGraph(value)
  assert.equal(overview.location('beat:beat1'), 'shared')
  assert.equal(overview.location('shot:shot1'), 'shot1')
  assert.equal(overview.location('space'), 'global')
  assert.equal(overview.nodes.filter(node => node.key === 'beat:beat1').length, 1)
  assert.equal(overview.edges.filter(edge => edge.from === 'shot:shot1' && edge.to === 'beat:beat1').length, 1)
  const detail = shotCanvasGraph(value, 'shot1')
  assert.equal(detail.nodes.find(node => node.key === 'beat:beat1')?.kind, 'reference')
  assert.ok(!detail.edges.some(edge => edge.indirect))
  assert.ok(!detail.nodes.some(node => node.key === 'space'))
  const anchor = overview.edges.find(edge => edge.from === 'shot:shot1' && edge.to === 'anchor:anchor1' && edge.label === '镜头关联')
  assert.ok(anchor?.sources.some(edge => edge.from === 'shot:shot1' && edge.to === 'blocking:state1'))
  assert.ok(anchor?.sources.some(edge => edge.from === 'blocking:state1' && edge.to === 'anchor:anchor1'))
})

test('shot grouping follows zero, one and multiple shot relations without changing object identity', () => {
  const value = makeWorkspace().designs[0].content
  const second = structuredClone(value.direction.shots[0])
  second.id = 'shot2'; second.beat_ids = []; second.event_ids = []; second.blocking_state_ids = []; second.participant_ids = []
  value.direction.shots.push(second)
  const beat = `beat:${value.direction.beats[0].id}`
  assert.equal(shotCanvasGraph(value).location(beat), 'shot1')
  assert.ok(!shotCanvasGraph(value).nodes.some(node => node.key === beat))
  assert.ok(shotCanvasGraph(value, 'shot1').nodes.some(node => node.key === beat))
  second.beat_ids = [value.direction.beats[0].id]
  assert.equal(shotCanvasGraph(value).location(beat), 'shared')
  assert.equal(shotCanvasGraph(value, 'shot1').nodes.find(node => node.key === beat)?.kind, 'reference')
  value.direction.shots[0].beat_ids = []
  assert.equal(shotCanvasGraph(value).location(beat), 'shot2')
  assert.equal(shotCanvasGraph(value, 'shot2').nodes.find(node => node.key === beat)?.kind, 'direction')
  second.beat_ids = []
  assert.equal(shotCanvasGraph(value).location(beat), 'unlinked')
})

test('director graph gives seven design domains and keeps shared objects editable outside', () => {
  const value = makeWorkspace().designs[0].content
  const outside = directorDesignGraph(value, { scope: 'all' })
  assert.deepEqual(outside.groups.map(group => group.domain), ['direction', 'performance', 'staging', 'cinematography', 'continuity', 'sound', 'prompt'])
  assert.equal(outside.nodes.filter(node => node.kind === 'summary').length, 7)
  for (const key of ['participant:person1', 'event:event1', 'criterion:criterion1', 'location']) assert.ok(outside.nodes.some(node => node.key === key && node.kind !== 'reference'))
  assert.equal(designDomain('blocking:state1'), 'direction')
  const direction = directorDesignGraph(value, { scope: 'all', domain: 'direction' })
  assert.ok(direction.nodes.some(node => node.key === 'space' && node.kind === 'direction'))
  assert.ok(direction.nodes.some(node => node.key === 'shot:shot1' && node.kind !== 'reference'))
  assert.ok(direction.nodes.some(node => node.key === 'criterion:criterion1' && node.kind === 'reference'))
  assert.ok(!outside.nodes.some(node => node.key === 'shot:shot1'))
})

test('current-shot domains follow explicit beat and event references without collecting every shared person consumer', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.shots[0].participant_ids = []
  value.staging.activities.push({ ...structuredClone(value.staging.activities[0]), trigger_event_id: null })
  value.continuity.push({ ...structuredClone(value.continuity[0]), id: 'unlinked', event_id: null })
  value.performance.beats.push({ ...structuredClone(value.performance.beats[0]), beat_id: 'another-beat' })
  const staging = directorDesignGraph(value, { scope: 'shot', shotId: 'shot1', domain: 'staging' })
  assert.ok(staging.nodes.some(node => node.key === 'staging'))
  assert.ok(staging.nodes.some(node => node.key === 'activity:0' && node.kind !== 'reference'))
  assert.ok(!staging.nodes.some(node => node.key === 'activity:1'))
  const performance = directorDesignGraph(value, { scope: 'shot', shotId: 'shot1', domain: 'performance' })
  assert.ok(performance.nodes.some(node => node.key === 'situation:0'))
  assert.ok(performance.nodes.some(node => node.key === 'performance:0'))
  assert.ok(!performance.nodes.some(node => node.key === 'performance:1'))
  const continuity = directorDesignGraph(value, { scope: 'shot', shotId: 'shot1', domain: 'continuity' })
  assert.ok(!continuity.nodes.some(node => node.key === 'continuity:unlinked'))
  assert.deepEqual(value.direction.shots[0].participant_ids, [])
  assert.ok(directorDesignGraph(value, { scope: 'all', domain: 'staging' }).nodes.some(node => node.key === 'activity:1'))
})

test('an explicit temporary target is visible in its home without expanding current-shot membership', () => {
  const value = makeWorkspace().designs[0].content
  value.staging.activities.push({ ...structuredClone(value.staging.activities[0]), trigger_event_id: null })
  const view = { scope: 'shot', shotId: 'shot1', domain: 'staging' }
  const temporary = directorDesignGraph(value, { ...view, temporaryKey: 'activity:1' })
  assert.ok(temporary.nodes.some(node => node.key === 'activity:1' && node.kind !== 'reference'))
  assert.equal(temporary.relatedKeys.has('activity:1'), false)
  assert.ok(!directorDesignGraph(value, view).nodes.some(node => node.key === 'activity:1'))
  assert.ok(!directorDesignGraph(value, { ...view, temporaryKey: 'camera:0' }).nodes.some(node => node.key === 'camera:0' && node.kind !== 'reference'))
})

test('domain summaries count explicit core content without treating empty shapes as filled', () => {
  const value = makeWorkspace().designs[0].content
  const node = key => directorDesignGraph(value, { scope: 'all' }).groups.flatMap(group => group.members).find(row => row.key === key)
  assert.equal(designCoreContent(value, node('sound')), '')
  value.sound.sources = { state: 'none' }
  assert.equal(designCoreContent(value, node('sound')), '明确没有')
  value.performance.beats[0].physical_action = { state: 'proposal', text: '展开旧信' }
  assert.equal(designCoreContent(value, node('performance:0')), '展开旧信')
})

test('domain projection keeps direction and original fields of cross-domain relations', () => {
  const value = makeWorkspace().designs[0].content
  const graph = directorDesignGraph(value, { scope: 'all' })
  const edge = graph.edges.find(row => row.from === 'domain:performance' && row.to === 'domain:direction' && row.label === '所属节拍')
  assert.deepEqual(edge.sources.map(row => [row.from, row.to, row.field]), [['performance:0', 'beat:beat1', 'beat_id']])
  assert.ok(!graph.edges.some(row => row.from === row.to))
  const staging = directorDesignGraph(value, { scope: 'all', domain: 'staging' })
  assert.equal(staging.nodes.filter(node => node.key === 'participant:person1').length, 1)
  assert.equal(staging.nodes.find(node => node.key === 'participant:person1').kind, 'reference')
})

test('whole-scene graph retains each step of a derived field path', () => {
  const value = makeWorkspace().designs[0].content
  const graph = sceneDesignGraph(value)
  const derived = graph.edges.find(edge => edge.from === 'shot:shot1' && edge.to === 'participant:person1' && edge.indirect && edge.path?.some(step => step.to === 'blocking:state1'))
  assert.deepEqual(derived?.path.map(edge => [edge.from, edge.to, edge.field]), [
    ['shot:shot1', 'blocking:state1', 'blocking_state_ids'], ['blocking:state1', 'participant:person1', 'participant_id'],
  ])
  const projected = directorDesignGraph(value, { scope: 'all' })
  assert.ok(projected.edges.some(edge => edge.indirect && edge.from === 'domain:direction' && edge.to === 'participant:person1' && edge.sources.length === 2))
  assert.ok(graph.edges.some(edge => edge.indirect && edge.from === 'camera:0' && edge.to === 'participant:person1' && edge.path?.length === 3))
})

test('unidentified work cards retain layout only while their content is unambiguous', () => {
  const value = makeWorkspace().designs[0].content
  value.performance.situations.push({ ...structuredClone(value.performance.situations[0]), situation: { state: 'proposal', text: '独自等待' } })
  const before = designObjects(value).filter(node => node.key.startsWith('situation:')).map(node => designObjectLayoutId(value, node))
  value.performance.situations.reverse()
  const after = designObjects(value).filter(node => node.key.startsWith('situation:')).map(node => designObjectLayoutId(value, node))
  assert.deepEqual(after, before.reverse())
  value.performance.situations.push(structuredClone(value.performance.situations[0]))
  assert.match(designObjectLayoutId(value, designObjects(value).find(node => node.key === 'situation:0')), /:ambiguous:/)
})

test('camera and performance layout follow their unique business keys across reordering', () => {
  const value = makeWorkspace().designs[0].content
  value.cinematography.push({ ...structuredClone(value.cinematography[0]), shot_id: 'shot2' })
  const cameras = () => designObjects(value).filter(node => node.key.startsWith('camera:')).map(node => designObjectLayoutId(value, node))
  assert.deepEqual(cameras(), ['camera:shot1', 'camera:shot2'])
  value.cinematography.reverse()
  assert.deepEqual(cameras(), ['camera:shot2', 'camera:shot1'])
  value.cinematography.push(structuredClone(value.cinematography[0]))
  assert.match(cameras()[0], /:ambiguous:/)
})

test('identified design rows keep canvas identity after text edits and reordering', () => {
  const value = makeWorkspace().designs[0].content
  const original = value.staging.activities[0]
  original.id = 'activity-stable'
  const second = { ...structuredClone(original), id: 'activity-other' }
  value.staging.activities.push(second)
  const before = designObjects(value).find(node => node.key === 'activity:activity-stable')
  assert.equal(designObjectLayoutId(value, before), 'activity:activity-stable')
  original.ongoing_task = { state: 'proposal', text: '重新巡视' }
  value.staging.activities.reverse()
  const after = designObjects(value).find(node => node.key === 'activity:activity-stable')
  assert.deepEqual(after.path, ['staging', 'activities', 1])
  assert.equal(designObjectLayoutId(value, after), 'activity:activity-stable')
  assert.ok(sceneDesignGraph(value).edges.some(edge => edge.from === 'activity:activity-stable' && edge.to === `participant:${original.participant_id}`))
})

test('shot participant relations are explicit, editable and independent of background evidence', () => {
  const value = makeWorkspace().designs[0].content
  value.participants.push({ id: 'van', name: '白色面包车' })
  assert.ok(shotIssues(value, 'shot1').includes('参与对象范围待核对'))
  value.direction.shots[0].participant_ids = ['van']
  assert.ok(!shotIssues(value, 'shot1').includes('参与对象范围待核对'))
  const graph = shotGraph(value, 'shot1')
  const edge = graph.edges.find(row => row.from === 'shot:shot1' && row.to === 'participant:van')
  assert.equal(edge.label, '参与对象')
  assert.equal(shotRelationPath(graph, 'shot1', 'participant:van').length, 1)
  const next = changeRelation(value, relationBinding(value, edge))
  assert.deepEqual(next.direction.shots[0].participant_ids, [])
  assert.ok(!shotIssues(next, 'shot1').includes('参与对象范围待核对'))
  assert.deepEqual(next.direction.blocking_states, value.direction.blocking_states)
  value.direction.shots[0].participant_ids = ['missing']
  assert.ok(shotIssues(value, 'shot1').includes('关联缺失'))
})

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

test('identified work cards edit their original direct references', () => {
  const value = makeWorkspace().designs[0].content
  value.performance.beats[0].id = 'performance-stable'
  value.cinematography[0].id = 'camera-stable'
  value.direction.beats.push({ ...structuredClone(value.direction.beats[0]), id: 'beat2' })
  const edge = sceneDesignGraph(value).edges.find(row => row.from === 'performance:performance-stable' && row.field === 'beat_id')
  const binding = relationBinding(value, edge)
  assert.deepEqual(binding.path, ['performance', 'beats', 0, 'beat_id'])
  assert.equal(changeRelation(value, binding, 'beat2').performance.beats[0].beat_id, 'beat2')
  const camera = shotGraph(value, 'shot1').edges.find(row => row.to === 'camera:camera-stable')
  assert.deepEqual(relationBinding(value, camera).path, ['cinematography', 0, 'shot_id'])
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

const cardSource = await readFile(new URL('../src/pages/aiStudio/directing/designCard.ts', import.meta.url), 'utf8')
const labelSource = await readFile(new URL('../src/pages/aiStudio/directing/designLabels.ts', import.meta.url), 'utf8')
const workspaceModule = data(compile(source).replaceAll("'./designValue'", JSON.stringify(data(compile(valueSource)))))
const { designCard } = await import(data(compile(cardSource)
  .replaceAll("'./designValue'", JSON.stringify(data(compile(valueSource))))
  .replaceAll("'./designWorkspace'", JSON.stringify(workspaceModule))
  .replaceAll("'./designLabels'", JSON.stringify(data(compile(labelSource))))))

test('design cards share one performance across shots and retain the real beat path', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.shots.push({ ...structuredClone(value.direction.shots[0]), id: 'shot2' })
  const object = designObjects(value).find(row => row.key === 'performance:0')
  const card = designCard(value, object, structuredClone(value))
  assert.deepEqual(card.shots.map(shot => shot.id), ['shot1', 'shot2'])
  assert.ok(card.shots.every(shot => shot.via === '覆盖节拍 → 节拍表演'))
  assert.equal(card.dirty, false)
  const next = patchDesign(value, [...object.path, 'physical_action'], { state: 'proposal', text: '缓慢握紧旧信', sources: [] })
  assert.equal(designCard(next, object, value).dirty, true)
  assert.match(designCard(next, object).text, /缓慢握紧旧信/)
  assert.equal(next.performance.beats.length, value.performance.beats.length)
  value.staging.activities[0].trigger_event_id = null
  assert.equal(designCard(value, designObjects(value).find(row => row.key.startsWith('activity:'))).shots.length, 0, 'same participant does not manufacture shot membership')
})

test('card issues distinguish unknown, missing references and intentional absence', () => {
  const value = makeWorkspace().designs[0].content
  value.cinematography[0].composition = { state: 'unknown' }
  value.cinematography[0].depth_layers = { state: 'not_applicable', reason: '纯平面画面' }
  value.cinematography[0].shot_id = 'missing'
  const card = designCard(value, designObjects(value).find(row => row.key === 'camera:0'))
  assert.ok(card.issues.includes('构图重心 · 待确定'))
  assert.ok(card.issues.includes('所属镜头 · 关联缺失'))
  assert.ok(!card.issues.some(issue => issue.startsWith('空间层次')))
  assert.match(card.text, /纯平面画面/)
  const missing = designCard(value, { key: 'participant:missing', kind: 'missing', path: [], label: '缺失' })
  assert.deepEqual(missing.issues, ['关联对象缺失'])
  assert.ok(!missing.text.includes(value.direction.information_change.text))
})

test('shared cards project only their fields and saved comparisons follow object identity', () => {
  const value = makeWorkspace().designs[0].content
  const saved = structuredClone(value)
  value.direction.shots[0].visible_result.text = '仅修改镜头'
  const overview = designCard(value, designObjects(value).find(row => row.key === 'overview'), saved)
  assert.equal(overview.shared, true)
  assert.equal(overview.dirty, false)
  assert.ok(!overview.text.includes('仅修改镜头'))
  value.cinematography.push({ ...structuredClone(value.cinematography[0]), shot_id: 'shot2' })
  const baseline = structuredClone(value)
  value.cinematography.reverse()
  const camera = designObjects(value).find(row => row.key === 'camera:0')
  assert.equal(designCard(value, camera, baseline).dirty, false)
})

test('card association explains activity and continuity selected through a covered beat event', () => {
  const value = makeWorkspace().designs[0].content
  value.direction.shots[0].event_ids = []
  value.direction.beats[0].event_ids = ['event1']
  value.staging.activities[0].trigger_event_id = 'event1'
  value.continuity[0].event_id = 'event1'
  for (const key of ['activity:0', `continuity:${value.continuity[0].id}`]) {
    const card = designCard(value, designObjects(value).find(row => row.key === key))
    assert.equal(card.scope, '关联 1 个镜头')
    assert.match(card.shots[0].via, /事件/)
  }
})
