import test from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite'))('esbuild')
const compiled = await build({ entryPoints: [new URL('../src/pages/aiStudio/generationCanvas/designRelationRules.ts', import.meta.url).pathname], bundle: true, write: false, platform: 'node', format: 'esm' })
const { candidateRelationPorts, withDesignRelation } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const source = id => ({ canvas_id: 'canvas', card_id: id, port_id: 'object', object_id: id })
const item = id => ({ source: source(id), modality: 'text', available: true, payload: { kind: 'object_reference', category: 'character', name: id } })
test('first adoption and atomic single-role replacement retain unrelated usages and fields', () => {
  const initial = { id: 'act', type: 'direction.performance', physical_action: { text: '动作' } }
  const first = withDesignRelation(initial, item('a'), 'participant')
  assert.equal(first.input_bindings.length, 1)
  const before = { ...first, input_bindings: [...first.input_bindings, { id: 'attention', input_port: 'attention_object', source: source('a') }] }
  const replaced = withDesignRelation(before, item('b'), 'participant')
  assert.equal(replaced.input_bindings.length, 2)
  assert.equal(replaced.input_bindings.find(value => value.input_port === 'participant').source.card_id, 'b')
  assert.deepEqual(replaced.physical_action, initial.physical_action)
  const removed = withDesignRelation(replaced, item('b'), 'participant')
  assert.deepEqual(removed.input_bindings, [before.input_bindings[1]])
  assert.equal(before.input_bindings[0].source.card_id, 'a')
})
test('multi-role adoption appends; candidate eligibility rejects wrong category but retains removable invalid usage', () => {
  const card = { id: 'shot', type: 'direction.shot' }
  const two = withDesignRelation(withDesignRelation(card, item('a'), 'covered_beat'), item('b'), 'covered_beat')
  assert.equal(two.input_bindings.length, 2)
  const doc = { edges: [{ target_card: 'act', source_card: 'a', source_port: 'object', target_port: 'participant' }] }
  const place = { ...item('a'), payload: { kind: 'object_reference', category: 'place' } }
  assert.deepEqual(candidateRelationPorts({ id: 'act', type: 'direction.performance' }, doc, place), [])
  assert.deepEqual(candidateRelationPorts({ id: 'act', type: 'direction.performance', input_bindings: [{ id: 'old', input_port: 'participant', source: source('a') }] }, doc, place), ['participant'])
})
