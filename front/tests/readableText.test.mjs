import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { makeWorkspace } from './directing-fixtures.mjs'

// Transpile the small pure module and its local dictionaries without starting a server.
async function moduleUrl(name) {
  const source = await readFile(new URL(`../src/pages/aiStudio/directing/${name}.ts`, import.meta.url), 'utf8')
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  for (const match of [...outputText.matchAll(/from ['"]\.\/([^'"]+)['"]/g)]) outputText = outputText.replace(match[0], `from '${await moduleUrl(match[1])}'`)
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const { readableContext, readableSegments, readablePath, decisionRanges, contextForPrompt } = await import(await moduleUrl('readableText'))
const workspace = makeWorkspace()
const design = workspace.designs[0].content
const unit = workspace.plans[0].content.units[0]
design.participants[0].name = '林岚'
design.direction.shots.unshift({ ...design.direction.shots[0], id: 'earlier-shot' })
unit.references = [0, 1].map(ordinal => ({ id: `ref${ordinal}`, subject_group_id: 'group-1', participant_ids: ['person1'], purpose: 'identity', input_role: 'subject', ordinal, file_id: `image${ordinal}`, media_kind: 'image', asset_origin: { kind: 'character', id: 'asset1', name: '历史林岚' } }))
const context = readableContext(design, unit)
const segments = (text, extra = {}) => readableSegments(text, context, extra)
const display = (text, extra) => segments(text, extra).map(row => row.label).join('')

test('compiler fields, typed identities, groups and coverage keep exact original ranges', () => {
  const text = '【场次试拍 v4】\n参考 @group-1：用途 identity，主体 林岚，输入位置 subject。\n【participants[1]: id=person1】\nparticipant_id：person1\n镜头 1 [shot1]：停下。\nbeat_ids：[\'beat1\']'
  const parts = segments(text, { compiled: true })
  assert.equal(parts.map(row => text.slice(row.start, row.end)).join(''), text)
  const result = parts.map(row => row.label).join('')
  for (const expected of ['历史林岚', '主体参考', '人物/物件：林岚', '镜头 02 · 本单元第 1 段', '覆盖节拍', '节拍 01']) assert.ok(result.includes(expected), result)
  assert.ok(!result.includes('group-1'))
  assert.equal(parts.find(row => row.entity?.id === 'group-1').entity.references.length, 2)
})

test('free prose preserves words, short substrings, natural pronouns and ambiguous identities', () => {
  const d = structuredClone(design)
  d.events[0].id = 'person1'
  d.participants.push({ id: 'he', name: '不应替换普通词' })
  const c = readableContext(d, unit)
  const text = 'person1 与 person10，他说 he 是 subject；person1_suffix。'
  assert.equal(readableSegments(text, c).map(row => row.label).join(''), text)
  assert.equal(display('person1停下，person10继续。'), '林岚停下，person10继续。')
  assert.equal(readableSegments('participant_id：person1', c, { compiled: true }).map(row => row.label).join(''), '人物/物件：林岚')
})

test('same names are distinguished and snapshots never use current asset data', () => {
  const d = structuredClone(design)
  d.participants.push({ id: 'person2', name: '林岚' })
  const result = readableSegments('person1 与 person2', readableContext(d, unit)).map(row => row.label).join('')
  assert.match(result, /林岚.*01/)
  assert.match(result, /林岚.*02/)
  assert.match(display('@group-1'), /历史林岚/)
  assert.equal(display('person1'), '林岚')
})

test('unknown typed references and absent snapshots remain visible, unsupported format keeps field text', () => {
  const text = '参考 @missing-ref：用途 identity。'
  const parts = readableSegments(text, readableContext(), { compiled: true })
  assert.ok(parts.some(row => row.unresolved && row.label.includes('missing-ref')))
  assert.equal(display('participant_id：person1'), 'participant_id：林岚')
  assert.equal(readableSegments('person1', readableContext()).map(row => row.label).join(''), 'person1')
})

test('paths use actual fixed objects and never invent a match for missing indexes', () => {
  assert.match(readablePath('/cinematography/0/composition', context), /镜头 02.*构图重心/)
  assert.match(readablePath('/participants/0/name', context), /林岚.*名称/)
  assert.match(readablePath('/direction/shots/99/visible_result', context), /未找到.*100/)
  assert.match(readablePath('/unknown_key/0', context), /unknown_key/)
})

test('repeated and overlapping excerpts retain all source decisions in raw coordinates', () => {
  const text = 'person1停下。person1停下。'
  const decisions = [{ section_path: '/a', text_excerpt: 'person1停下。' }, { section_path: '/b', text_excerpt: 'person1' }]
  assert.deepEqual(decisionRanges(text, decisions).map(row => [row.start, row.end, row.index]), [[0, 10, 0], [10, 20, 0], [0, 7, 1], [10, 17, 1]])
  assert.equal(display(text), '林岚停下。林岚停下。')
})


test('actual compiler primitive list labels retain type context when IDs collide', () => {
  const d = structuredClone(design)
  d.events[0].id = 'beat1'
  const text = 'beat_ids[1]：beat1\nevent_ids[1]：beat1'
  const result = readableSegments(text, readableContext(d, unit), { compiled: true }).map(row => row.label).join('')
  assert.equal(result, '覆盖节拍[1]：节拍 01\n关联事件[1]：事件 01')
})

test('review field paths resolve to fixed objects and missing prompt cannot borrow current selection', () => {
  assert.match(display('检查 /cinematography/0/composition 的要求'), /镜头 02.*构图重心/)
  assert.equal(contextForPrompt(workspace, 'missing').design, undefined)
  const copy = structuredClone(workspace)
  copy.prompts = [{ id: 'old-prompt', content: { plan_revision_id: 'p-old', unit_id: 'u1' } }]
  copy.designs[1].content.participants[0].name = '当前姓名'
  assert.equal(contextForPrompt(copy, 'old-prompt').entities.find(row => row.id === 'person1').label, '林岚')
})

test('numeric or ordinary names used as IDs cannot rewrite timings or prose', () => {
  const d = structuredClone(design)
  d.participants.push({ id: '1', name: '数字身份' }, { id: '主角1', name: '中文身份' })
  const c = readableContext(d)
  assert.equal(readableSegments('时长 1 秒，主角1进入。', c).map(row => row.label).join(''), '时长 1 秒，主角1进入。')
  assert.equal(readableSegments('participant_id：1', c, { compiled: true }).map(row => row.label).join(''), '人物/物件：数字身份')
})

test('legal dotted and colon identities are resolved whole, never as shorter prefixes', () => {
  const d = structuredClone(design)
  d.participants.push({ id: 'person1.old', name: '历史角色' }, { id: 'person1:next', name: '后续角色' })
  const u = structuredClone(unit)
  u.references.push({ ...u.references[0], id: 'ref0.old', subject_group_id: null, ordinal: 2, asset_origin: { name: '历史参考' } })
  const c = readableContext(d, u)
  const output = text => readableSegments(text, c, { compiled: true }).map(row => row.label).join('')
  assert.equal(output('participant_ids[1]：person1.old'), '参与对象[1]：历史角色')
  assert.equal(output('participant_id：person1:next'), '人物/物件：后续角色')
  assert.equal(output('person1.old 正在离开'), '历史角色 正在离开')
  assert.equal(output('person1.unavailable 正在离开'), 'person1.unavailable 正在离开')
  assert.match(output('参考 @ref0.old：用途 identity。'), /历史参考/)
  assert.ok(!output('参考 @ref0.old：用途 identity。').includes('.old'))
  assert.equal(output('person1@example.com'), 'person1@example.com')
})

test('all six continuity domains use the actual contract vocabulary', () => {
  for (const [key, label] of Object.entries({ space: '空间', appearance: '外观', hands_props: '手部与道具', environment: '环境', camera: '摄影', dialogue_sound: '对白与声音' })) {
    assert.equal(display(`domain：${key}`, { compiled: true }), `连续性领域：${label}`)
  }
})
