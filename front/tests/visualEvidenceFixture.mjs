import { fileURLToPath } from 'node:url'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, cpSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const baseline = fileURLToPath(new URL('./visual-baselines/c-794ee4a0-v1/', import.meta.url))
export function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'visual-evidence-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  cpSync(baseline, join(dir, 'baseline'), { recursive: true })
  mkdirSync(join(dir, 'actual'))
  const manifest = JSON.parse(readFileSync(join(dir, 'baseline/manifest.json')))
  const states = {}
  const matrix = manifest.groups.map(g => {
    const key = `${g.id}-${g.kind}-${g.state}-${g.viewport.width}x${g.viewport.height}`
    const type = { text: 'content.text', image: 'content.image', 'model-text': 'model.text', 'model-image': 'model.image' }[g.kind]
    const card = { type, text: g.state === 'empty' ? '' : 'A literal fixture text', file_id: g.state === 'empty' ? null : 'fixture-file', model_id: 'fixture-model', input_bindings: g.state === 'empty' ? [] : [{ source_card_id: 'fixture-source', source_file_id: 'fixture-file' }], config: { count: 3, target_ratio: '1:1', resolution_profile: 'standard' } }
    states[key] = { viewport: g.viewport, zoom: 1, card, outputs: g.state === 'empty' ? [] : [{ file_id: 'fixture-output', text: 'A literal fixture output' }] }
    const formal = { page: g.full, editor: g.editor, card: g.card || g.editor }
    // These are controlled CLI fixtures, never a formal product run or accepted baseline update.
    for (const path of Object.values(formal)) cpSync(join(dir, 'baseline', path), join(dir, 'actual', path))
    states[key].images = Object.fromEntries(Object.entries(formal).map(([role, file]) => [role, { file, sha256: createHash('sha256').update(readFileSync(join(dir, 'actual', file))).digest('hex') }]))
    return { id: g.id, kind: g.kind, state: g.state, viewport: g.viewport, formal }
  })
  const run = { schemaVersion: 1, runId: 'controlled-cli-fixture', sourceRevision: 'a'.repeat(40), fixtureRevision: 'b'.repeat(40), environment: { node: '24', browser: 'Chrome', platform: 'test fixture' }, behavior: 'passed', states: 'states.json' }
  const paths = { manifest: join(dir, 'baseline/manifest.json'), matrix: join(dir, 'actual/matrix.json'), run: join(dir, 'actual/run.json'), states: join(dir, 'actual/states.json'), output: join(dir, 'actual/result.json') }
  const save = () => { for (const name of ['manifest','matrix','run','states']) writeFileSync(paths[name], JSON.stringify({manifest,matrix,run,states}[name])) }
  save()
  return { dir, paths, manifest, matrix, run, states, save, args: ['--manifest', paths.manifest, '--matrix', paths.matrix, '--run', paths.run, '--output', paths.output] }
}
