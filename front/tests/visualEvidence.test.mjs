import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cli = fileURLToPath(new URL('../scripts/visual-evidence.mjs', import.meta.url))
const invoke = args => {
  const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { ...result, result: JSON.parse(result.stdout || '{}') }
}
test('ordinary behavior success explicitly leaves evidence unchecked and visual unreviewed', () => {
  const { status, result } = invoke(['--behavior', 'passed'])
  assert.equal(status, 0)
  assert.deepEqual(result.behavior, { status: 'passed' })
  assert.equal(result.evidence.status, 'not-checked')
  assert.equal(result.visual.status, 'not-reviewed')
})

import { readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fixture } from './visualEvidenceFixture.mjs'
test('complete 36-group evidence is reviewable, with original file identities and independent visual status', t => {
  const f = fixture(t)
  f.manifest.groups.reverse(); f.matrix.reverse(); f.save()
  const { status, result } = invoke(f.args)
  assert.equal(status, 0, JSON.stringify(result))
  assert.equal(result.evidence.status, 'reviewable')
  assert.equal(result.visual.status, 'not-reviewed')
  assert.equal(result.groups.length, 36)
  assert.deepEqual(JSON.parse(readFileSync(f.paths.output)), result)
  assert.match(result.contract.sha256, /^[a-f0-9]{64}$/)
  assert.match(result.groups[0].actual.editor.sha256, /^[a-f0-9]{64}$/)
  assert.ok(result.groups[0].regions.includes('card/title'))
  assert.match(result.groups.find(g => g.id === 'F10').differences.join(' '), /fixture-file|fixture-output/)
})

test('evidence mode refuses incomplete or mismatched matrix and version metadata', async t => {
  for (const [name, change, message] of [
    ['missing target argument', f => f.args.splice(0, 2), /manifest/],
    ['missing group', f => f.matrix.pop(), /F12.*3830x1688|36/],
    ['duplicate group', f => f.matrix[35] = structuredClone(f.matrix[0]), /duplicate|36/],
    ['wrong viewport', f => f.matrix[0].viewport.height = 961, /F01|viewport/],
    ['wrong state', f => f.matrix[0].state = 'expanded', /F01|state/],
    ['wrong kind', f => f.matrix[0].kind = 'image', /F01|kind/],
    ['invalid baseline version', f => f.manifest.version = '', /version/],
    ['invalid source revision', f => f.manifest.source.revision = 'unknown', /revision/],
    ['missing environment', f => delete f.run.environment.browser, /environment/],
    ['invalid fixture revision', f => f.run.fixtureRevision = 'unknown', /fixtureRevision/],
    ['target cannot invent card omission', f => { delete f.manifest.groups[0].card; f.manifest.groups[0].cardVisible = false }, /F01.*card/],
  ]) await t.test(name, st => {
    const f = fixture(st)
    change(f); f.save()
    const { status, result } = invoke(f.args)
    assert.equal(status, 1)
    assert.equal(result.evidence.status, 'failed')
    assert.match(result.evidence.errors.join(' '), message)
    assert.equal(result.visual.status, 'not-reviewed')
  })
})

test('original images must decode, match viewport and retained target identities, and retain portable target paths', async t => {
  for (const [name, change, message] of [
    ['missing actual image', f => rmSync(join(f.dir, 'actual', f.matrix[0].formal.card)), /F01.*card/],
    ['unreadable image', f => writeFileSync(join(f.dir, 'actual', f.matrix[0].formal.editor), 'not a picture'), /F01.*editor/],
    ['truncated actual PNG', f => { const p = join(f.dir, 'actual', f.matrix[0].formal.editor); writeFileSync(p, readFileSync(p).subarray(0, 50)) }, /F01.*editor/],
    ['target content changed', f => writeFileSync(join(f.dir, 'baseline', f.manifest.groups[0].editor), readFileSync(join(f.dir, 'baseline', f.manifest.groups[1].editor))), /F01.*identity/],
    ['wrong page dimensions', f => { f.matrix[0].formal.page = f.matrix[0].formal.editor; f.states[Object.keys(f.states)[0]].images.page = f.states[Object.keys(f.states)[0]].images.editor }, /F01.*viewport/],
    ['absolute target file', f => f.manifest.groups[0].editor = join(f.dir, 'baseline', f.manifest.groups[0].editor), /F01.*relative/],
    ['contract changed', f => writeFileSync(join(f.dir, 'baseline/contract.md'), 'changed contract'), /contract.*identity/],
    ['missing target identity', f => delete f.manifest.files[f.manifest.groups[0].editor], /F01.*identity/],
  ]) await t.test(name, st => {
    const f = fixture(st); change(f); f.save()
    const { status, result } = invoke(f.args)
    assert.equal(status, 1)
    assert.match(result.evidence.errors.join(' '), message)
  })
})

test('capture states prove ready/empty/selected semantics and unchanged default/expanded content', async t => {
  for (const [name, change, message] of [
    ['missing capture state', f => delete f.states[Object.keys(f.states)[0]], /F01.*state/],
    ['wrong zoom', f => f.states[Object.keys(f.states)[0]].zoom = 0.5, /F01.*zoom/],
    ['wrong capture viewport', f => f.states[Object.keys(f.states)[0]].viewport = { width: 390, height: 844 }, /F01.*viewport/],
    ['different expanded text', f => f.states[Object.keys(f.states)[1]].card.text = 'Changed during expansion', /F02.*same|F02.*changed/],
    ['ready image missing file', f => f.states[Object.keys(f.states)[3]].card.file_id = null, /F04.*input/],
    ['empty is not no-output-with-basis', f => f.states[Object.keys(f.states)[8]].card.input_bindings = [{ source_card_id: 'basis' }], /F09.*input/],
    ['ready requires output', f => f.states[Object.keys(f.states)[6]].outputs = [], /F07.*output/],
    ['empty model is selected', f => f.states[Object.keys(f.states)[8]].card.model_id = null, /F09.*model/],
    ['wrong card type', f => f.states[Object.keys(f.states)[0]].card.type = 'content.image', /F01.*type/],
    ['relabelled capture image', f => f.matrix[0].formal.editor = f.matrix[1].formal.editor, /F01.*editor.*capture/],
    ['behavior failure stays failure', f => f.run.behavior = 'failed', /./],
  ]) await t.test(name, st => {
    const f = fixture(st); change(f); f.save()
    const { status, result } = invoke(f.args)
    assert.equal(status, 1)
    if (name === 'behavior failure stays failure') assert.equal(result.behavior.status, 'failed')
    else assert.match(result.evidence.errors.join(' '), message)
    assert.equal(result.visual.status, 'not-reviewed')
  })
})
