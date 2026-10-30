import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { evaluateEvidence } from '../scripts/visual-evidence.mjs'
const repository = fileURLToPath(new URL('../..', import.meta.url))
const sha256 = data => createHash('sha256').update(data).digest('hex')
const read = path => JSON.parse(readFileSync(path, 'utf8'))
const write = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
const git = args => execFileSync('git', args, { cwd: repository, encoding: 'utf8' }).trim()

/** Bind the just-captured page/editor originals to the public HTTP card/output state. */
export async function recordVisualState(output, key, state) {
  const path = join(output, 'visual-states.json')
  const states = existsSync(path) ? read(path) : {}
  states[key] = { ...state, images: Object.fromEntries(['page', 'editor'].map(role => {
    const file = `${key}-${role}.png`
    return [role, { file, sha256: sha256(readFileSync(join(output, file))) }]
  })) }
  write(path, states)
}

/** Keep behavior, evidence completeness and human visual review as separate run conclusions. */
export async function writeVisualEvidence(output, { behavior, manifest, browserVersion }) {
  const statesPath = join(output, 'visual-states.json')
  const matrixPath = join(output, 'matrix.json')
  if (existsSync(statesPath) && existsSync(matrixPath)) {
    const states = read(statesPath)
    for (const group of read(matrixPath)) {
      const key = `${group.id}-${group.kind}-${group.state}-${group.viewport.width}x${group.viewport.height}`
      if (states[key] && existsSync(join(output, group.formal.card))) states[key].images.card = { file: group.formal.card, sha256: sha256(readFileSync(join(output, group.formal.card))) }
    }
    write(statesPath, states)
  }
  const fixtureFiles = ['front/tests/generationCanvasFourCardAcceptance.browser.mjs', 'front/tests/visual-evidence-output.mjs', 'backend/tests/generation_canvas_four_card_browser_server.py']
  const run = { schemaVersion: 1, runId: basename(output), capturedAt: new Date().toISOString(), sourceRevision: git(['rev-parse', 'HEAD']), fixtureRevision: git(['log', '-1', '--format=%H', '--', ...fixtureFiles]), fixtureFiles: Object.fromEntries(fixtureFiles.map(path => [path, sha256(readFileSync(join(repository, path)))])), sourceChanges: git(['status', '--short']), environment: { node: process.version, browser: browserVersion || process.env.PLAYWRIGHT_CHANNEL || 'chromium', platform: `${process.platform}/${process.arch}` }, behavior, states: 'visual-states.json' }
  const runPath = join(output, 'visual-run.json'), resultPath = join(output, 'visual-result.json')
  write(runPath, run)
  const result = await evaluateEvidence(manifest ? { manifest, matrix: matrixPath, run: runPath, output: resultPath } : { behavior })
  result.run = run
  write(resultPath, result)
  const link = image => `[original](${relative(output, image.path)}) (${image.width}×${image.height}, sha256:${image.sha256})`
  writeFileSync(join(output, 'visual-index.md'), `# Four-card evidence\n\nBehavior: ${result.behavior.status}; evidence: ${result.evidence.status}; visual: ${result.visual.status}.\n\n${result.contract ? `Contract sha256: ${result.contract.sha256}; baseline: ${result.baselineVersion}.\n\n` : ''}${result.evidence.errors.join('\n')}\n\n| Group | Target editor | Actual page | Actual editor | Actual card |\n| --- | --- | --- | --- | --- |\n${result.groups.map(g => `| ${g.key} | ${link(g.target.editor)} | ${link(g.actual.page)} | ${link(g.actual.editor)} | ${link(g.actual.card)} |`).join('\n')}\n\nImage originals and per-group state, differences and review regions are indexed in visual-result.json. No visual approval is inferred.\n`)
  console.log(`behavior=${result.behavior.status} evidence=${result.evidence.status} visual=${result.visual.status}`, resultPath)
  if (result.evidence.status === 'failed') {
    const error = Error(`visual evidence incomplete: ${result.evidence.errors.join('; ')}`)
    error.evidenceFailure = true
    throw error
  }
  return result
}
