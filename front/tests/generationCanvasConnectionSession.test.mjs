import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/pages/aiStudio/generationCanvas/connectionSession.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
const { createConnectionSession } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function session(count = 1) {
  let state = {}, options = Array.from({ length: count }, (_, id) => ({ id: String(id) }))
  const commits = [], issues = [], ends = []
  const flow = createConnectionSession({ change: next => { state = next }, options: () => options,
    issue: (...args) => issues.push(args), commit: (...args) => commits.push(args), end: () => ends.push(true) })
  return { flow, commits, issues, ends, state: () => state, options: next => { options = next } }
}
const origin = { card: 'source', side: 'right' }, point = { x: 10, y: 20 }
test('incompatible pointer target ends while accessible target preserves source for another choice', () => {
  for (const pointer of [false, true]) {
    const s = session(0)
    s.flow.start(origin, pointer ? point : undefined)
    s.flow.choose('target', 'left', point)
    assert.equal(s.issues.length, 1)
    assert.equal(s.commits.length, 0)
    assert.equal(s.ends.length, pointer ? 1 : 0)
    assert.deepEqual(s.state(), pointer ? {} : { accessibleConnection: origin })
  }
})
test('single use commits once and repeated release cannot create another connection', () => {
  const s = session()
  s.flow.start(origin, point)
  s.flow.choose('target', 'left', point)
  s.flow.choose('target', 'left', point)
  assert.equal(s.commits.length, 1)
  assert.deepEqual(s.commits[0].slice(1), ['left', 'right', 'source'])
  assert.deepEqual(s.state(), {})
})
test('multiple uses connect once with the selected result identity for pointer and keyboard', () => {
  for (const pointer of [false, true]) {
    const s = session(2)
    const option = { id: 'first-use', source_card: 'model' }
    s.options([option, { id: 'second-use', source_card: 'model' }])
    const projected = { card: 'linked-result:model:image:1', side: 'right' }
    s.flow.start(projected, pointer ? point : undefined)
    s.flow.choose('target', 'top', point)
    s.flow.choose('target', 'top', point)
    assert.equal(s.flow.pointerActive, false)
    assert.equal(s.commits.length, 1)
    assert.deepEqual(s.commits[0], [option, 'top', 'right', projected.card])
    assert.deepEqual(s.state(), {})
  }
})
test('target choice reads current options; cancellation never commits', () => {
  const s = session(2)
  s.flow.start(origin)
  s.options([])
  s.flow.choose('target', 'left', point)
  assert.equal(s.issues.length, 1)
  s.flow.cancel()
  s.flow.choose('target', 'left')
  assert.equal(s.commits.length, 0)
  assert.equal(s.flow.pointerActive, false)
})
