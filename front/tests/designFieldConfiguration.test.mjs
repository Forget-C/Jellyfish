import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const load = async name => {
  const source = await readFile(new URL('../src/pages/aiStudio/generationCanvas/' + name + '.ts', import.meta.url), 'utf8')
  let { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } })
  if (outputText.includes("'./designFieldMetadata'")) {
    const dependency = await readFile(new URL('../src/pages/aiStudio/generationCanvas/designFieldMetadata.ts', import.meta.url), 'utf8')
    const compiled = ts.transpileModule(dependency, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.ES2020 } }).outputText
    outputText = outputText.replaceAll("'./designFieldMetadata'", JSON.stringify(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`))
  }
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

const { soundConstraintPresets } = await load('soundConstraintPresets')
test('continuity categories offer distinct instructions while leaving factual states to the user', () => {
  const cases = [['space', '空间位置'], ['appearance', '服装'], ['hands_props', '持握'], ['environment', '环境变化'], ['photography', '光线'], ['dialogue_sound', '对白与声音']]
  const ids = new Set(), instructions = new Set()
  for (const [category, expected] of cases) {
    const card = { type: 'direction.continuity', category, before: { state: 'fact', text: '已确认前态' } }
    const original = structuredClone(card)
    const presets = soundConstraintPresets(card)
    assert.equal(presets.length, 6)
    assert.deepEqual(presets, soundConstraintPresets({ type: 'direction.continuity', category: 'space' }))
    const preset = presets.find(value => value.category === category)
    assert.ok(preset)
    assert.deepEqual(Object.keys(preset.fields), ['following_constraints'])
    assert.ok(preset.fields.following_constraints.text.includes(expected))
    assert.deepEqual(card, original)
    ids.add(preset.id); instructions.add(preset.fields.following_constraints.text)
  }
  assert.equal(ids.size, 6)
  assert.equal(instructions.size, 6)
})
