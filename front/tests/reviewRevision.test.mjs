import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const path = new URL('../src/pages/aiStudio/directing/reviewRevision.ts', import.meta.url)
const source = await readFile(path, 'utf8').catch(() => '')
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const api = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const row = { occurrence_id: 'o1', role: 'prompt', verdict: 'revise', findings: [{ observation: '人物不应出现' }, { observation: '声音待确定' }] }
const packet = { rows: [row, { ...row, role: 'staging', findings: [] }, { ...row, occurrence_id: 'o2', verdict: 'pass' }] }

test('every finding and row without findings has distinct immutable key; passes omitted', () => {
  assert.equal(typeof api.revisionIssues, 'function')
  const issues = api.revisionIssues(packet)
  assert.equal(issues.length, 3)
  assert.equal(new Set(issues.map(item => item.key)).size, 3)
  assert.deepEqual(issues.map(item => item.finding_index), [0, 1, -1])
  assert.equal(api.revisionIssueKey(row, 0), issues[0].key)
})
test('saved original review continues source task draft; manual derivative stays isolated', () => {
  assert.equal(typeof api.reviewDirectionScope, 'function')
  const pending = api.reviewDirectionScope('p', 's', 'prompt', undefined, 'task')
  assert.equal(pending, api.reviewDirectionScope('p', 's', 'prompt', { id: 'r', source_task_id: 'task' }))
  assert.notEqual(pending, api.reviewDirectionScope('p', 's', 'prompt', { id: 'r2', source_task_id: 'task', parent_id: 'r' }))
  for (const args of [['p2', 's', 'prompt'], ['p', 's2', 'prompt'], ['p', 's', 'prompt2']]) assert.notEqual(pending, api.reviewDirectionScope(...args, undefined, 'task'))
  assert.notEqual(pending, api.reviewDirectionScope('p', 's', 'prompt', undefined, 'new-task'))
})
test('all issues submitted even with blank direction; stale keys never cross checks', () => {
  assert.equal(typeof api.revisionDirections, 'function')
  const key = api.revisionIssueKey(row, 0)
  const directions = api.revisionDirections(packet, { [key]: '仅拍空镜', stale: '过期意见' })
  assert.deepEqual(directions.map(item => item.direction), ['仅拍空镜', '', ''])
  assert.equal(directions.length, 3)
})
test('any direction, source or fixed version change invalidates candidate identity including late results', () => {
  assert.equal(typeof api.revisionInputIdentity, 'function')
  const base = { prompt: 'p', sequence: 1, source: 'task:t', design: ['d', 1], plan: ['pl', 1], packet }
  const directions = api.revisionDirections(packet, {})
  const original = api.revisionInputIdentity(base, directions)
  assert.equal(original, api.revisionInputIdentity(structuredClone(base), structuredClone(directions)))
  assert.notEqual(original, api.revisionInputIdentity({ ...base, sequence: 2 }, directions))
  assert.notEqual(original, api.revisionInputIdentity(base, directions.map((row, i) => i ? row : { ...row, direction: '更改想法' })))
  assert.notEqual(original, api.revisionInputIdentity({ ...base, source: 'task:new' }, directions))
})
test('direct edits preserve frozen values, convert seconds, omit unchanged fields and keep explicit sound choice', () => {
  const fields = [{ target: 'unit', path: '/duration_ms', value: 5000 }, { target: 'design', path: '/sound/execution', value: 'unknown' }, { target: 'design', path: '/prompt/binding_requirements', value: { state: 'fact', text: '旧要求', sources: [] } }]
  assert.equal(typeof api.directRevisionEdits, 'function')
  assert.deepEqual(api.directRevisionEdits(fields, { 'unit:/duration_ms': '5' }), [])
  const edits = api.directRevisionEdits(fields, { 'unit:/duration_ms': '6', 'design:/sound/execution': 'postproduction', 'design:/prompt/binding_requirements': '新要求' })
  assert.equal(edits[0].before, 5000)
  assert.equal(edits[0].after, 6000)
  assert.equal(edits[1].after, 'postproduction')
  assert.deepEqual(edits[2].after, { state: 'proposal', text: '新要求', sources: [] })
  assert.equal(fields[2].value.text, '旧要求')
})
test('recovery action is based on persisted products, not only generic blocked stage', () => {
  assert.equal(typeof api.revisionRecoveryLabel, 'function')
  assert.equal(api.revisionRecoveryLabel({ stage: 'blocked', prompt_revision_id: 'p' }), '重试检查')
  assert.equal(api.revisionRecoveryLabel({ stage: 'blocked', plan_revision_id: 'pl' }), '继续生成指令')
  assert.equal(api.revisionRecoveryLabel(undefined), '查询上次结果')
})
test('paragraph editing only offers related allowed fields and never falls back for shared paths', () => {
  const fields = [{ target: 'unit', path: '/duration_ms', value: 5000 }, { target: 'design', path: '/cinematography/0/movement', value: {} }]
  assert.equal(typeof api.matchingRevisionFields, 'function')
  assert.deepEqual(api.matchingRevisionFields(fields, ['/prompt/binding_requirements']), [])
  assert.deepEqual(api.matchingRevisionFields(fields, ['/cinematography/0']), [fields[1]])
  assert.deepEqual(api.matchingRevisionFields(fields, ['/cinematography/0/movement/text']), [fields[1]])
  assert.deepEqual(api.matchingRevisionFields(fields), fields)
})

test('local scope survives storage and corrupt or duplicate scope cannot silently grant whole instruction', () => {
  const scope = [{ target: 'design', path: '/cinematography/0/movement_path' }]
  assert.deepEqual(api.readRevisionScope(JSON.stringify(scope)), { scope, invalid: false })
  assert.deepEqual(api.readRevisionScope(''), { scope: null, invalid: false })
  for (const value of ['bad json', '[]', '[null]', JSON.stringify([...scope, ...scope]), '[{"target":"task","path":"/a"}]']) assert.equal(api.readRevisionScope(value).invalid, true)
})
