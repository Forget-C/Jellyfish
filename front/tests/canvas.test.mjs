import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/components/canvas/geometry.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
const { canvasConnection, fitCanvas, validCanvasTransform, validCanvasOffsets } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)

test('hidden and corrupt viewports never save unusable transforms; dense content retains supported zoom', () => {
  for (const viewport of [{ x: 0, y: 600 }, { x: NaN, y: 600 }, { x: 600, y: Infinity }]) assert.equal(fitCanvas(viewport, { x: 1160, y: 600 }), undefined)
  const dense = fitCanvas({ x: 375, y: 400 }, { x: 1160, y: 30000 })
  assert.equal(dense.scale, .15)
  assert.ok(validCanvasTransform(dense))
  assert.deepEqual(fitCanvas({ x: 1440, y: 900 }, { x: 1000, y: 600 }), { x: 120, y: 90, scale: 1.2 })
  for (const scale of [0, -.1, .14, 2.1, Infinity, NaN]) assert.equal(validCanvasTransform({ x: 0, y: 0, scale }), false)
  assert.equal(validCanvasTransform(undefined), false)
  for (const offsets of [null, [], 'saved', { node: { x: Infinity, y: 0 } }, { node: { x: 0 } }]) assert.equal(validCanvasOffsets(offsets), false)
  assert.ok(validCanvasOffsets({ node: { x: -20, y: 40 } }))
})

test('forward, reverse and same-column relations terminate at real node boundaries', () => {
  const left = { left: 20, top: 30, width: 200, height: 108 }, right = { left: 300, top: 200, width: 170, height: 180 }
  assert.match(canvasConnection(left, right).d, /^M220,84 .* 300,290$/)
  assert.match(canvasConnection(right, left).d, /^M300,290 .* 220,84$/)
  assert.match(canvasConnection(left, { ...left, top: 200 }).d, /^M20,84 C6,84 6,254 20,254$/)
})
