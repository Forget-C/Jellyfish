import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../src/pages/aiStudio/generationCanvas/inputBindings.ts', import.meta.url), 'utf8')
const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
const { editorPrompt, withEditorPrompt, withoutInputBinding } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const image = { canvas_id: 'canvas', card_id: 'picture', port_id: 'image', position: 0 }
const reference = id => ({ id, kind: 'reference', source: image })
const card = () => ({ id: 'model', type: 'model.image', config: { count: 1 }, prompt: { segments: [] }, input_bindings: [] })
const reopen = value => JSON.parse(JSON.stringify(value))

test('independent adoption survives mention, save/reopen and removal of the last mention', () => {
  const original = { ...card(), input_bindings: [{ id: 'independent', source: image, input_port: 'image' }] }
  const mentioned = withEditorPrompt(original, { segments: [reference('first'), reference('second')] })
  assert.equal(mentioned.input_bindings.length, 1)
  assert.equal(mentioned.prompt.segments[0].binding_id, 'independent')
  const cleared = withEditorPrompt(reopen(mentioned), { segments: [{ id: 'text', kind: 'text', text: '继续保留独立图片' }] })
  assert.equal(cleared.input_bindings[0].id, 'independent')
  assert.deepEqual(cleared.input_bindings[0].source, image)
  assert.deepEqual(original.input_bindings, [{ id: 'independent', source: image, input_port: 'image' }])
})

test('repeated mentions share a stable binding until the last mention is removed', () => {
  const selected = withEditorPrompt(card(), { segments: [reference('first'), reference('second')] })
  assert.equal(selected.input_bindings.length, 1)
  const id = selected.input_bindings[0].id
  assert.equal(selected.prompt.segments[1].binding_id, id)
  const once = withEditorPrompt(reopen(selected), { segments: [editorPrompt(selected).segments[1]] })
  assert.equal(once.input_bindings[0].id, id)
  assert.deepEqual(withEditorPrompt(reopen(once), { segments: [] }).input_bindings, [])
})

test('explicit cancellation protects every mention and unrelated adoption', () => {
  const selected = withEditorPrompt({ ...card(), input_bindings: [{ id: 'other', source: { ...image, card_id: 'other' }, input_port: 'image' }] }, { segments: [reference('first'), reference('second')] })
  const id = selected.input_bindings.find(binding => binding.source.card_id === 'picture').id
  const canceled = withoutInputBinding(reopen(selected), id)
  assert.deepEqual(canceled, reopen(selected))
  assert.deepEqual(canceled.config, { count: 1 })
})


test('unreferenced cancellation removes owned frame configuration only', () => {
  const original = { ...card(), type: 'model.video', input_bindings: [{ id: 'one', source: image, input_port: 'key_frame' }, { id: 'two', source: image, input_port: 'first_frame' }], frame_targets: [{ binding_id: 'one' }, { binding_id: 'two' }] }
  const canceled = withoutInputBinding(original, 'one')
  assert.deepEqual(canceled.frame_targets, [{ binding_id: 'two' }])
  assert.equal(canceled.input_bindings[0].id, 'two')
  const referenced = { ...original, prompt: { segments: [{ kind: 'instruction', id: 'instruction', command: '关键帧参考', references: [{ kind: 'reference', id: 'ref', binding_id: 'one' }] }] } }
  assert.equal(withoutInputBinding(referenced, 'one'), referenced)
})


test('independent video and text selections survive their last prompt mention', () => {
  for (const type of ['model.video', 'model.text']) {
    const source = { ...image, port_id: 'text' }
    const original = { ...card(), type, input_bindings: [{ id: 'independent', input_port: 'text', source, prompt_owned: false }] }
    const mentioned = withEditorPrompt(original, { segments: [{ id: 'ref', kind: 'reference', source }] })
    const cleared = withEditorPrompt(mentioned, { segments: [] })
    assert.equal(cleared.input_bindings[0].id, 'independent')
    assert.deepEqual(withoutInputBinding(cleared, 'independent').input_bindings, [])
  }
})
