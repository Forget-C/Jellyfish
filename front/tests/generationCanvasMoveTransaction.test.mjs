import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/pages/aiStudio/generationCanvas/moveTransaction.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
const { createMoveTransaction } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function session() {
  let view = { transform: { x: 0, y: 0, scale: 2 }, positions: { a: { x: 10, y: 20 }, b: { x: 40, y: 50 } }, sizes: {} }
  const history = []
  const movement = createMoveTransaction({ view: () => view, update: change => { view = change(view) }, record: (undo, redo) => history.push({ undo, redo }) })
  return { movement, history, view: () => view, browse: () => { view = { ...view, transform: { ...view.transform, x: 300 } } } }
}

test('pointer movement locks shortcuts until release; one history entry restores all members but preserves later browsing', () => {
  const s = session(), initial = s.view()
  s.movement.begin(['a', 'b'], true)
  assert.equal(s.movement.pointerActive, true)
  s.movement.move('a', { x: 20, y: 30 })
  s.movement.pan(10, -20)
  const final = s.view()
  assert.deepEqual(final.positions.b, { x: 45, y: 70 })
  s.movement.finish()
  s.movement.finish()
  assert.equal(s.movement.active, false)
  assert.equal(s.movement.pointerActive, false)
  assert.equal(s.history.length, 1)
  s.browse()
  s.history[0].undo()
  assert.deepEqual(s.view().positions, initial.positions)
  assert.equal(s.view().transform.x, 300)
  s.history[0].redo()
  assert.deepEqual(s.view().positions, final.positions)
  assert.deepEqual(s.view().manuallyPlaced, ['a', 'b'])
})

test('Escape restores the entire view including edge pan without recording history', () => {
  const s = session(), initial = s.view()
  s.movement.begin(['a'], true)
  s.movement.move('a', { x: 50, y: 60 })
  s.movement.pan(10, 20)
  s.movement.finish(true)
  assert.deepEqual(s.view(), initial)
  assert.equal(s.history.length, 0)
})

test('repeated keyboard moves retain the original snapshot and finish as one transaction', () => {
  const s = session(), initial = s.view()
  s.movement.begin(['a'])
  s.movement.move('a', { x: 20, y: 20 })
  s.movement.begin(['a'])
  s.movement.move('a', { x: 30, y: 20 })
  assert.equal(s.movement.pointerActive, false)
  s.movement.finish()
  s.history[0].undo()
  assert.deepEqual(s.view().positions, initial.positions)
  assert.equal(s.view().manuallyPlaced, undefined)
})

test('group drag compensates pan and commits current positions on interruption', () => {
  const s = session(), positions = s.view().positions
  s.movement.begin(['a', 'b'], true)
  s.movement.moveGroup(positions, { x: 10, y: 20 })
  s.movement.pan(20, 0)
  s.movement.moveGroup(positions, { x: 15, y: 25 })
  s.movement.finish()
  assert.deepEqual(s.view().positions.b, { x: 55, y: 75 })
  assert.equal(s.history.length, 1)
})

test('group handle adjusts for pan; no-op gestures create no history', () => {
  const s = session()
  s.movement.begin(['a', 'b'], true)
  s.movement.finish()
  assert.equal(s.history.length, 0)
  s.movement.begin(['a', 'b'], true)
  s.movement.pan(20, 0)
  s.movement.moveHandle(['a', 'b'], { x: 30, y: 40 }, { x: 10, y: 20 })
  assert.deepEqual(s.view().positions.a, { x: 10, y: 40 })
  s.movement.finish()
  assert.equal(s.history.length, 1)
})
