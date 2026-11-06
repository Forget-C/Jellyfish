import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
const source = await readFile(new URL('../src/pages/aiStudio/generationCanvas/surfaceGesture.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
const { createSurfaceGesture } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
function session() { let state; const flow = createSurfaceGesture(next => { state = next }); return { flow, state: () => state } }
const zero = { x: 0, y: 0 }, transform = { x: 20, y: 30, scale: 1 }
test('marquee uses intersection in every direction and six-pixel release clears selection', () => {
  const { flow } = session()
  flow.beginSelection({ x: 20, y: 20 }, zero)
  assert.deepEqual(flow.finish(zero, [{ id: 'overlap', left: 10, top: 10, right: 40, bottom: 40 }, { id: 'touch', left: 20, right: 30, top: 0, bottom: 10 }]), { clear: false, ids: ['overlap'] })
  flow.beginSelection(zero, zero)
  assert.deepEqual(flow.finish({ x: 6, y: 0 }, []), { clear: true })
})
test('Escape returns the original pan offset while interruption keeps the current viewport', () => {
  const { flow } = session()
  flow.beginPan(zero, 1, transform)
  assert.deepEqual(flow.move({ x: 50, y: 60 }, zero), { x: 70, y: 90 })
  assert.deepEqual(flow.escape(), { x: 20, y: 30 })
  flow.beginPan(zero, 1, transform)
  flow.interrupt()
  assert.equal(flow.pan, undefined)
  assert.equal(flow.escape(), undefined)
})
test('Space activation needs a matching press and release without pan or blocking', () => {
  const { flow } = session(), a = {}, b = {}
  assert.equal(flow.spaceUp(a, false), false)
  flow.spaceDown(a, false)
  assert.equal(flow.spaceUp(b, false), false)
  flow.spaceDown(a, false)
  assert.equal(flow.spaceUp(a, true), false)
  flow.spaceDown(a, false)
  assert.equal(flow.spaceUp(a, false), true)
  flow.spaceDown(a, false)
  flow.spaceReset()
  assert.equal(flow.spaceUp(a, false), false)
})
test('holding Space supports consecutive pans, repeat does not rearm activation', () => {
  const s = session(), a = {}
  s.flow.spaceDown(a, false)
  for (let i = 0; i < 2; i++) { s.flow.beginPan(zero, 1, transform); s.flow.finish({ x: 10, y: 10 }, []); assert.equal(s.state().spaceHeld, true) }
  s.flow.spaceDown(a, true)
  assert.equal(s.flow.spaceUp(a, false), false)
})
test('focus clears activation but retains physical hold unless entering editable controls', () => {
  const s = session(), a = {}
  s.flow.spaceDown(a, false); s.flow.focus(false)
  assert.equal(s.state().spaceHeld, true)
  assert.equal(s.flow.spaceUp(a, false), false)
  s.flow.spaceDown(a, false); s.flow.focus(true)
  assert.equal(s.state().spaceHeld, false)
})
test('blur ends pan and Space but preserves existing marquee until release', () => {
  const s = session()
  s.flow.beginSelection(zero, zero)
  s.flow.move({ x: 30, y: 40 }, zero)
  s.flow.blur()
  assert.equal(s.flow.selecting, true)
  assert.deepEqual(s.state().selectionBox, { x: 0, y: 0, width: 30, height: 40 })
  s.flow.finish({ x: 30, y: 40 }, [])
  assert.equal(s.flow.selecting, false)
  s.flow.beginPan(zero, 1, transform); s.flow.blur()
  assert.equal(s.flow.pan, undefined)
})
test('unchanged Space resets and focus do not publish during another control Escape handling', () => {
  let notifications = 0
  const flow = createSurfaceGesture(() => { notifications++ })
  flow.spaceReset(); flow.focus(false); flow.spaceUp({}, false); flow.blur()
  assert.equal(notifications, 0)
  flow.spaceDown({}, false)
  flow.spaceReset()
  assert.equal(notifications, 2)
})
