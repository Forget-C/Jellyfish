import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const load = async name => {
  const source = await readFile(new URL('../src/pages/aiStudio/generationCanvas/' + name + '.ts', import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
}
const { isDesignFieldConfigured } = await load('designFieldConfiguration')
const { designMediaSourcePorts } = await load('designSources')
test('schema defaults do not masquerade as authored configuration, including empty retained documents', () => {
  for (const defaults of [{ state: 'empty', purpose: 'background' }, { state: 'empty', purpose: 'constraint' }, { state: 'undecided', purpose: 'design' }]) {
    assert.equal(isDesignFieldConfigured({ ...defaults, text: '' }, defaults), false)
    assert.equal(isDesignFieldConfigured({ ...defaults, document: { segments: [] } }, defaults), false)
    assert.equal(isDesignFieldConfigured({ ...defaults, text: '明确内容' }, defaults), true)
    assert.equal(isDesignFieldConfigured({ ...defaults, source_locator: '原文' }, defaults), true)
  }
})
test('authored purpose, state, reference and framing changes count in every design family', () => {
  const defaults = { state: 'empty', purpose: 'design' }
  for (const field of [{ ...defaults, purpose: 'background' }, { ...defaults, state: 'absent' }, { ...defaults, size: 'wide' }, { ...defaults, document: { segments: [{ kind: 'reference', source: {} }] } }]) assert.equal(isDesignFieldConfigured(field, defaults), true)
})
test('local audio/video ports remain addable without duplicate ordinary media choices', () => {
  assert.deepEqual(designMediaSourcePorts(['speaker', 'video_example', 'audio_example', 'text']), ['video_example', 'audio_example'])
  assert.deepEqual(designMediaSourcePorts(['audio_example', 'image_example', 'image', 'video_example', 'video', 'text']), ['audio_example', 'image', 'video'])
})
