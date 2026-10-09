import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { makeWorkspace, revision } from './directing-fixtures.mjs'

const modules = new Map()
async function moduleUrl(name) {
  if (modules.has(name)) return modules.get(name)
  const source = await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8')
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  for (const match of [...outputText.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]) outputText = outputText.replace(match[0], `from '${await moduleUrl(match[1])}'`)
  const url = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
  modules.set(name, url)
  return url
}
const { generationInstructionGraph, requirementOccurrences } = await import(await moduleUrl('generationInstructionGraph'))
const { fixedValue } = await import(await moduleUrl('readableText'))
const { instructionOptimization } = await import(await moduleUrl('instructionOptimization'))
const note = text => ({ state: 'fact', text, sources: [] })
const fixture = () => {
  const workspace = makeWorkspace()
  workspace.prompts = [revision('prompt1', { plan_revision_id: 'p-old', unit_id: 'u1', format_version: 'jellyfish-scene-v4', text: '【场次背景】\n保持原位，不得穿墙；除非门已打开。\n【本次执行动作】\n保持原位，不得穿墙；除非门已打开。\n停步后等待 0.25 秒 😀\n', sources: [], decisions: [
    { section_path: '/cinematography/0/movement_path', disposition: 'text', text_excerpt: '保持原位，不得穿墙；除非门已打开。', explanation: '摄影要求' },
    { section_path: '/direction/shots/0/visible_result', disposition: 'text', text_excerpt: '停步后等待 0.25 秒 😀', explanation: '动作结果' },
  ] })]
  workspace.designs[0].content.cinematography[0].movement_path = note('保持原位，不得穿墙；除非门已打开。')
  return workspace
}

test('fixed context is read-only and never borrows a newer design, plan or same-name unit', () => {
  const workspace = fixture(), before = structuredClone(workspace)
  workspace.designs[1].content.cinematography[0].movement_path = note('最新设计不得借用')
  const graph = generationInstructionGraph(workspace, 'prompt1')
  assert.equal(graph.designId, 'd1'); assert.equal(graph.planId, 'p-old'); assert.equal(graph.unitId, 'u1')
  assert.equal(graph.requirements.find(row => row.path === '/cinematography/0/movement_path').value.text, before.designs[0].content.cinematography[0].movement_path.text)
  const frozen = structuredClone(workspace)
  generationInstructionGraph(workspace, 'prompt1')
  assert.deepEqual(workspace, frozen)
  workspace.plans[0].content.units = []
  const missing = generationInstructionGraph(workspace, 'prompt1')
  assert.equal(missing.unit, undefined); assert.equal(missing.coverage.length, 0)
  assert.ok(missing.gaps.some(gap => gap.text.includes('单元缺失')))
  assert.equal(generationInstructionGraph(workspace, 'not-present').prompt, undefined)
})

test('all prose reconstructs exactly and repeated occurrences keep coordinates and expression boundaries', () => {
  const workspace = fixture(), prompt = workspace.prompts[0].content
  prompt.text += '\r\n未知原文：禁止省略 -3.5 cm，例外条件与重复标题。\n'
  const graph = generationInstructionGraph(workspace, 'prompt1')
  assert.equal(graph.blocks.map(block => block.text).join(''), prompt.text)
  for (const block of graph.blocks) assert.equal(prompt.text.slice(block.start, block.end), block.text)
  const requirement = graph.requirements.find(row => row.path === '/cinematography/0/movement_path')
  assert.deepEqual(new Set(requirement.expressions), new Set(['background', 'execution']))
  const occurrences = requirementOccurrences(graph, requirement.id)
  assert.equal(occurrences.length, 2)
  assert.notEqual(occurrences[0].id, occurrences[1].id)
  for (const occurrence of occurrences) assert.equal(prompt.text.slice(occurrence.start, occurrence.end), prompt.decisions[0].text_excerpt)
  assert.ok(graph.gaps.some(gap => gap.kind === 'unmapped-text'))
})

test('multi-coverage and shared objects preserve identity while unrelated cast do not become execution', () => {
  const workspace = fixture(), unit = workspace.plans[0].content.units[0], design = workspace.designs[0].content
  unit.coverage.push({ ...unit.coverage[0], id: 'cover2' })
  design.participants.push({ id: 'elsewhere', name: '其他场次人物' })
  design.staging.activities.push({ ...structuredClone(design.staging.activities[0]), participant_id: 'elsewhere', trigger_event_id: null })
  const graph = generationInstructionGraph(workspace, 'prompt1'), shot = graph.groups.find(row => row.objectKey === 'shot:shot1')
  assert.deepEqual(shot.coverageIds, ['cover1', 'cover2'])
  assert.equal(graph.groups.filter(row => row.objectKey === 'shot:shot1').length, 1)
  assert.notEqual(graph.coverage[0].occurrenceId, graph.coverage[1].occurrenceId)
  assert.equal(graph.groups.find(row => row.objectKey === 'participant:elsewhere').related, false)
  assert.equal(graph.groups.find(row => row.objectKey === `activity:${design.staging.activities.length - 1}`).related, false)
  assert.ok(graph.requirements.filter(row => row.shared).length)
})

test('split coverage keeps only declared events and beats in each occurrence while cross-range context remains traceable', () => {
  const workspace = fixture(), design = workspace.designs[0].content, unit = workspace.plans[0].content.units[0]
  design.events.push({ ...structuredClone(design.events[0]), id: 'event2' })
  design.direction.beats.push({ ...structuredClone(design.direction.beats[0]), id: 'beat2', event_ids: ['event2'] })
  design.direction.shots[0].event_ids.push('event2'); design.direction.shots[0].beat_ids.push('beat2')
  design.performance.beats.push({ ...structuredClone(design.performance.beats[0]), beat_id: 'beat2' })
  unit.coverage.push({ ...unit.coverage[0], id: 'cover2', event_ids: ['event2'], beat_ids: ['beat2'] })
  const graph = generationInstructionGraph(workspace, 'prompt1')
  assert.deepEqual(graph.groups.find(group => group.objectKey === 'event:event1').coverageIds, ['cover1'])
  assert.deepEqual(graph.groups.find(group => group.objectKey === 'event:event2').coverageIds, ['cover2'])
  assert.deepEqual(graph.groups.find(group => group.objectKey === 'performance:0').coverageIds, ['cover1'])
  assert.deepEqual(graph.groups.find(group => group.objectKey === 'performance:1').coverageIds, ['cover2'])
  const shot = graph.groups.find(group => group.objectKey === 'shot:shot1')
  assert.deepEqual(shot.coverageIds, ['cover1', 'cover2'])
  assert.ok(graph.relations.some(edge => edge.from === shot.id && edge.to === graph.groups.find(group => group.objectKey === 'event:event2').id))
})

test('one unit spanning shots and one shot shared by units keep object identity apart from appearances and missing references', () => {
  const workspace = fixture(), design = workspace.designs[0].content, plan = workspace.plans[0].content, unit = plan.units[0]
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2' })
  unit.coverage.push({ ...unit.coverage[0], id: 'other-shot', shot_id: 'shot2' })
  unit.coverage.forEach(row => row.event_ids.push('missing-event'))
  plan.units.push({ ...structuredClone(unit), id: 'u2', coverage: [{ ...unit.coverage[0], id: 'other-unit' }] })
  workspace.prompts.push(revision('prompt2', { ...structuredClone(workspace.prompts[0].content), unit_id: 'u2' }))
  const a = generationInstructionGraph(workspace, 'prompt1'), b = generationInstructionGraph(workspace, 'prompt2')
  assert.equal(a.coverage.length, 2); assert.equal(b.coverage.length, 1)
  assert.notEqual(a.contextKey, b.contextKey)
  assert.equal(a.groups.find(group => group.objectKey === 'shot:shot1').id, b.groups.find(group => group.objectKey === 'shot:shot1').id)
  assert.notEqual(a.coverage[0].occurrenceId, b.coverage[0].occurrenceId)
  assert.equal(a.groups.filter(group => group.objectKey === 'event:missing-event').length, 1)
  const missing = a.groups.find(group => group.objectKey === 'event:missing-event')
  assert.equal(missing.missing, true)
  assert.deepEqual(missing.coverageIds, ['cover1', 'other-shot'])
  assert.ok(a.gaps.some(gap => gap.groupId === missing.id && gap.kind === 'missing-source'))
})

test('semantic edges use typed references and retain textual order as a gap rather than invented chronology', () => {
  const workspace = fixture(), design = workspace.designs[0].content
  design.staging.activities[0].trigger_event_id = 'event1'
  design.cinematography[0].movement_trigger = note('收到信后移动，期间保持目光')
  const graph = generationInstructionGraph(workspace, 'prompt1')
  assert.ok(graph.relations.some(row => row.kind === 'trigger' && row.sourcePath === '/staging/activities/0/trigger_event_id'))
  assert.ok(graph.relations.some(row => row.kind === 'acceptance' && row.sourcePath === '/direction/shots/0/criterion_ids'))
  assert.ok(graph.relations.some(row => row.label === '摄影归属'))
  assert.ok(graph.gaps.some(row => row.path === '/cinematography/0/movement_trigger' && row.kind === 'text-only'))
  assert.equal(graph.relations.some(row => ['order', 'synchronous', 'representation'].includes(row.kind)), false)
  const globals = new Set(graph.groups.filter(group => group.shared).map(group => group.id))
  assert.equal(graph.relations.some(row => globals.has(row.from) && row.label === '约束全部'), false)
})

test('fixed inputs retain every parameter, media role, ordinal, group, source and dependency identity', () => {
  const workspace = fixture(), unit = workspace.plans[0].content.units[0]
  unit.parameters = { seed: 0, enabled: false, empty: null, guidance: 1.25, format: 'mp4' }
  unit.references = ['image', 'video', 'audio'].map((media_kind, ordinal) => ({ id: `ref-${ordinal}`, file_id: `file-${ordinal}`, media_kind, purpose: media_kind === 'audio' ? 'sound' : 'identity', participant_ids: ['person1'], ordinal, input_role: 'subject', subject_group_id: ordinal === 0 ? 'person-group' : null, asset_origin: { kind: 'character', id: 'actor', name: '历史名字' }, source: { kind: 'human', reference: 'fixed', version: '3' } }))
  unit.dependencies = [{ plan_revision_id: 'historical', unit_id: 'u1', frame_id: 'frame', reference_id: 'ref-0' }]
  const graph = generationInstructionGraph(workspace, 'prompt1')
  assert.deepEqual(graph.unit, unit)
  assert.deepEqual(graph.unit.references.map(row => row.media_kind), ['image', 'video', 'audio'])
  assert.deepEqual(graph.unit.parameters, unit.parameters)
})

test('declared reference, omitted source and malformed mappings stay distinct; missing data never gains precise coordinates', () => {
  const workspace = fixture(), prompt = workspace.prompts[0].content
  prompt.decisions.push({ section_path: '/direction/immutable_facts/0', disposition: 'unexpressed', explanation: '未表达' }, { section_path: '/participants/0', disposition: 'reference', reference_id: 'missing', explanation: '参考声明' }, { section_path: '/cinematography/0/prohibitions', disposition: 'text', text_excerpt: '不存在的摘录', explanation: '历史映射损坏' }, { section_path: '/__proto__/fake', disposition: 'unexpressed', explanation: '无效路径' })
  const graph = generationInstructionGraph(workspace, 'prompt1')
  assert.ok(graph.requirements.some(row => row.expressions.includes('unexpressed')))
  assert.ok(graph.requirements.filter(row => row.path.startsWith('/participants/0')).every(row => !row.expressions.includes('reference')))
  const broken = graph.requirements.find(row => row.path === '/cinematography/0/prohibitions')
  assert.deepEqual(broken.expressions, ['unmapped']); assert.deepEqual(broken.occurrenceIds, [])
  assert.equal(fixedValue(workspace.designs[0].content, '/constructor'), undefined)
  assert.equal(fixedValue(workspace.designs[0].content, '/__proto__/fake'), undefined)
  assert.equal(new Set(graph.gaps.map(gap => gap.id)).size, graph.gaps.length)
  prompt.format_version = 'old-format'
  const legacy = generationInstructionGraph(workspace, 'prompt1')
  assert.equal(legacy.blocks.length, 1); assert.equal(legacy.blocks[0].text, prompt.text)
  assert.ok(legacy.gaps.some(row => row.kind === 'legacy'))
})

test('optimization separates explicit scope, real indirect background and all actual field changes without mutating snapshots', () => {
  const workspace = fixture(), path = '/cinematography/0/movement_path', before = workspace.designs[0].content.cinematography[0].movement_path
  const fields = [{ target: 'design', path, value: before }], scope = [{ target: 'design', path }]
  const candidate = { source_prompt_revision_id: 'prompt1', input_identity: 'input', candidate_identity: 'candidate', changes: [{ target: 'design', path, before, after: note('停步后保持固定'), reason: '用户指定' }], preview_text: workspace.prompts[0].content.text.replaceAll(before.text, '停步后保持固定'), preview_decisions: [{ section_path: path, disposition: 'text', text_excerpt: '停步后保持固定', explanation: '摄影修改' }] }
  const original = structuredClone(workspace), impact = instructionOptimization(workspace, 'prompt1', fields, scope, candidate)
  assert.deepEqual(impact.issues, [])
  assert.ok(impact.background.some(row => row.via.length === 1))
  assert.ok(impact.background.some(row => row.via.length > 1))
  for (const row of impact.background) for (const id of row.via) assert.ok(impact.graph.relations.some(edge => edge.id === id))
  assert.equal(impact.changes.length, 1); assert.equal(impact.changes[0].inScope, true)
  assert.ok(impact.preview)
  assert.equal(impact.added.length, 0); assert.equal(impact.removed.length, 0)
  assert.ok(impact.unchanged.some(edge => edge.label === '摄影归属'), 'wording change must not pretend the reference changed')
  const requirement = impact.preview.requirements.find(row => row.path === path)
  assert.equal(requirement.value.text, '停步后保持固定')
  assert.equal(requirementOccurrences(impact.preview, requirement.id).length, 2)
  assert.deepEqual(workspace, original)
  assert.deepEqual(scope, [{ target: 'design', path }])
})

test('candidate reference differences require actual changed snapshots, never positions or coincidental shared entities', () => {
  const workspace = fixture(), design = workspace.designs[0].content, path = '/cinematography/0/shot_id'
  design.direction.shots.push({ ...structuredClone(design.direction.shots[0]), id: 'shot2' })
  const candidate = { source_prompt_revision_id: 'prompt1', input_identity: 'input', preview_text: workspace.prompts[0].content.text, preview_decisions: workspace.prompts[0].content.decisions, changes: [{ target: 'design', path, before: 'shot1', after: 'shot2', reason: '更换归属' }] }
  const impact = instructionOptimization(workspace, 'prompt1', [{ target: 'design', path, value: 'shot1' }], [{ target: 'design', path }], candidate)
  assert.equal(impact.added.length, 1); assert.equal(impact.removed.length, 1)
  assert.equal(impact.added[0].sourcePath, path); assert.equal(impact.removed[0].sourcePath, path)
  assert.notEqual(impact.added[0].to, impact.removed[0].to)
})

test('out-of-scope, forbidden, stale, foreign and mismatched-before changes all remain visible and cannot project relations', () => {
  const workspace = fixture(), unit = workspace.plans[0].content.units[0], path = '/duration_ms'
  const fields = [{ target: 'unit', path, value: unit.duration_ms }, { target: 'unit', path: '/ratio', value: unit.ratio }]
  const base = { source_prompt_revision_id: 'prompt1', input_identity: 'input', preview_text: '新全文', preview_decisions: [], changes: [{ target: 'unit', path, before: unit.duration_ms, after: 8000, reason: '延长' }] }
  const cases = [
    [base, [{ target: 'unit', path: '/ratio' }], false, /超出/],
    [{ ...base, changes: [{ ...base.changes[0], path: '/model_id', before: unit.model_id, after: 'another' }] }, null, false, /允许修改范围/],
    [base, null, true, /已变化/],
    [{ ...base, source_prompt_revision_id: 'another' }, null, false, /另一份/],
    [{ ...base, changes: [{ ...base.changes[0], before: 1 }] }, null, false, /修改前/],
    [{ ...base, changes: [...base.changes, base.changes[0]] }, null, false, /重复/],
    [{ ...base, changes: [{ ...base.changes[0], after: unit.duration_ms }] }, null, false, /没有实际/],
  ]
  for (const [candidate, scope, stale, message] of cases) {
    const impact = instructionOptimization(workspace, 'prompt1', fields, scope, candidate, stale)
    assert.equal(impact.changes.length, candidate.changes.length)
    assert.ok(impact.issues.some(issue => message.test(issue.message)), String(message))
    assert.equal(impact.preview, undefined)
    assert.deepEqual(impact.added, []); assert.deepEqual(impact.removed, [])
  }
})

test('legacy candidate without mappings preserves full changes but makes no relation repair claim; field equality ignores object key ordering', () => {
  const workspace = fixture(), path = '/cinematography/0/movement_path', before = workspace.designs[0].content.cinematography[0].movement_path
  const fields = [{ target: 'design', path, value: { sources: before.sources, text: before.text, state: before.state } }]
  const candidate = { input_identity: 'old', changes: [{ target: 'design', path, before: { text: before.text, sources: before.sources, state: before.state }, after: note('新要求'), reason: '历史修改' }], preview_text: '历史完整预览' }
  const impact = instructionOptimization(workspace, 'prompt1', fields, null, candidate)
  assert.deepEqual(impact.issues, [])
  assert.equal(impact.preview, undefined)
  assert.equal(impact.changes[0].after.text, '新要求')
})
