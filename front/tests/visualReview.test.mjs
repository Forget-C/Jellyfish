import assert from 'node:assert/strict'
import { test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { fixture } from './visualEvidenceFixture.mjs'
const cli = fileURLToPath(new URL('../scripts/visual-review.mjs', import.meta.url))
const invoke = args => {
  const process = spawnSync(globalThis.process.execPath, [cli, ...args], { encoding: 'utf8' })
  return { status: process.status, result: JSON.parse(process.stdout || '{}') }
}
test('review preparation keeps independent evidence and visual status without inventing approval', t => {
  const f = fixture(t)
  const { status, result } = invoke(f.args)
  assert.equal(status, 1)
  assert.equal(result.evidence.status, 'reviewable')
  assert.equal(result.visual.status, 'not-reviewed')
  assert.equal(result.reviewTemplate.groups.length, 36)
  assert.ok(result.reviewTemplate.groups.every(g => g.regions.every(r => r.status === 'unverified')))
})

import { writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
function signedFixture(t) {
  const f = fixture(t)
  const prepared = invoke(f.args).result
  const review = prepared.reviewTemplate
  // Controlled CLI records test validation only; they are never claimed as human image inspection.
  review.reviewer = 'controlled CLI fixture (not a human signoff)'
  review.reviewedAt = '2026-10-30T00:00:00Z'
  for (const g of review.groups) for (const region of g.regions) {
    region.status = 'passed'; region.observation = 'Literal controlled fixture observation'
  }
  const reviewPath = join(f.dir, 'review.json')
  const saveReview = () => writeFileSync(reviewPath, JSON.stringify(review))
  saveReview()
  return { ...f, review, saveReview, args: [...f.args, '--review', reviewPath] }
}
test('complete explicit review can pass while retaining reviewer, time, and evidence binding', t => {
  const f = signedFixture(t)
  const { status, result } = invoke(f.args)
  assert.equal(status, 0, JSON.stringify(result.visual))
  assert.equal(result.visual.status, 'passed')
  assert.equal(result.visual.review.reviewer, f.review.reviewer)
  assert.equal(result.behavior.status, 'passed')
})
test('missing, differing, unverified and mismatched review records never approve visual evidence', async t => {
  for (const [name, change, message] of [
    ['reviewer missing', f => f.review.reviewer = '', /reviewer/],
    ['time missing', f => f.review.reviewedAt = '', /time/],
    ['region missing', f => f.review.groups[0].regions.pop(), /regions/],
    ['group missing', f => f.review.groups.pop(), /group/],
    ['duplicate group', f => f.review.groups[35] = f.review.groups[0], /group/],
    ['difference', f => f.review.groups[0].regions[0].status = 'difference', /difference/],
    ['unverified', f => f.review.groups[0].regions[0].status = 'unverified', /unverified/],
    ['observation absent', f => f.review.groups[0].regions[0].observation = '', /observation/],
    ['allowed difference without basis', f => f.review.groups[0].regions[0].allowedDifferences = [{ difference: 'different label' }], /basis/],
    ['contract identity', f => f.review.contractSha256 = 'f'.repeat(64), /contract/],
    ['original identity', f => f.review.groups[0].images.actual.editor = 'f'.repeat(64), /identity/],
  ]) await t.test(name, st => {
    const f = signedFixture(st); change(f); f.saveReview()
    const { status, result } = invoke(f.args)
    assert.equal(status, 1)
    assert.notEqual(result.visual.status, 'passed')
    assert.match(result.visual.errors.join(' '), message)
    assert.equal(result.behavior.status, 'passed')
  })
})
test('current originals and contract are rechecked even if saved review metadata claims a pass', async t => {
  for (const [name, change, message] of [
    ['actual original replaced', f => copyFileSync(join(f.dir, 'actual', f.matrix[1].formal.editor), join(f.dir, 'actual', f.matrix[0].formal.editor)), /capture|identity/],
    ['target original replaced', f => copyFileSync(join(f.dir, 'baseline', f.manifest.groups[1].editor), join(f.dir, 'baseline', f.manifest.groups[0].editor)), /identity/],
    ['contract replaced', f => writeFileSync(join(f.dir, 'baseline/contract.md'), 'Changed current contract'), /contract/],
  ]) await t.test(name, st => {
    const f = signedFixture(st); change(f)
    const { status, result } = invoke(f.args)
    assert.equal(status, 1)
    assert.notEqual(result.visual.status, 'passed')
    assert.match(result.evidence.errors.join(' '), message)
  })
})
test('SHA-only metadata change needs explicit same-evidence reuse and records its original source', t => {
  const f = signedFixture(t)
  f.run.sourceRevision = 'c'.repeat(40); f.save()
  const refused = invoke(f.args)
  assert.equal(refused.status, 1)
  assert.match(refused.result.visual.errors.join(' '), /reuse-review/)
  const accepted = invoke([...f.args, '--reuse-review'])
  assert.equal(accepted.status, 0)
  assert.equal(accepted.result.visual.reuse.original.sourceRevision, 'a'.repeat(40))
  assert.equal(accepted.result.visual.reuse.current.sourceRevision, 'c'.repeat(40))
})
test('manifest descriptive metadata can explicitly reuse unchanged images, regions and contract', t => {
  const f = signedFixture(t)
  f.manifest.changeReason += ' Documentation clarification only.'; f.save()
  assert.equal(invoke(f.args).status, 1)
  const reused = invoke([...f.args, '--reuse-review'])
  assert.equal(reused.status, 0)
  assert.equal(reused.result.visual.status, 'passed')
  assert.equal(reused.result.visual.reuse.original.manifestSha256, f.review.manifestSha256)
})
