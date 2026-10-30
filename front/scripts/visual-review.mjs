import { parseArgs, isDeepStrictEqual } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { evaluateEvidence } from './visual-evidence.mjs'
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const check = (condition, message) => { if (!condition) throw Error(message) }
// Compare content identities; paths are relocatable and source commits alone do not approve pixels.
const images = group => Object.fromEntries(['target', 'actual'].map(side => [side, Object.fromEntries(Object.entries(group[side]).map(([role, image]) => [role, image.sha256]))]))
let result = { schemaVersion: 1, behavior: { status: 'unknown' }, evidence: { status: 'failed', errors: [] }, visual: { status: 'not-reviewed', errors: [] } }, output
try {
  const { values } = parseArgs({ options: { ...Object.fromEntries(['manifest', 'matrix', 'run', 'output', 'review'].map(name => [name, { type: 'string' }])), 'reuse-review': { type: 'boolean', default: false } } })
  output = values.output
  check(values.manifest && values.matrix && values.run, 'manifest, matrix and run are required; saved result metadata is not authoritative')
  result = await evaluateEvidence(values)
  result.visual.errors = []
  check(result.evidence.status === 'reviewable', 'current evidence is not reviewable')
  const binding = { baselineVersion: result.baselineVersion, manifestSha256: result.manifest.sha256, contractSha256: result.contract.sha256 }
  result.reviewTemplate = {
    schemaVersion: 1, reviewer: '', reviewedAt: '', source: { runId: result.run.runId, sourceRevision: result.run.sourceRevision, result: output ? resolve(output) : '' }, ...binding,
    groups: result.groups.map(g => ({ key: g.key, images: images(g), captureSha256: g.captureSha256, regions: g.regions.map(region => ({ region, status: 'unverified', observation: '', allowedDifferences: [] })) })),
  }
  if (values.review) {
    const review = JSON.parse(readFileSync(values.review, 'utf8'))
    result.visual.status = 'invalid'
    check(review.schemaVersion === 1, 'invalid review schemaVersion')
    check(nonempty(review.reviewer), 'reviewer identity required')
    check(nonempty(review.reviewedAt) && Number.isFinite(Date.parse(review.reviewedAt)), 'review time required')
    for (const name of ['baselineVersion', 'contractSha256']) check(review[name] === binding[name], `${name}: review identity mismatch`)
    check(/^[a-f0-9]{64}$/.test(review.manifestSha256), 'manifest identity required')
    check(nonempty(review.source?.result) && nonempty(review.source?.runId) && /^[a-f0-9]{40}$/.test(review.source?.sourceRevision), 'review source result/run/revision required')
    const reused = review.manifestSha256 !== binding.manifestSha256 || review.source.runId !== result.run.runId || review.source.sourceRevision !== result.run.sourceRevision
    check(!reused || values['reuse-review'], 'source metadata changed; explicit --reuse-review required for identical evidence')
    check(Array.isArray(review.groups) && review.groups.length === result.groups.length && new Set(review.groups.map(g => g.key)).size === result.groups.length, 'review group coverage/duplicates invalid')
    const issues = []
    for (const group of result.groups) {
      const entry = review.groups.find(g => g.key === group.key)
      check(entry && isDeepStrictEqual(entry.images, images(group)) && entry.captureSha256 === group.captureSha256, `${group.key}: image/capture identity mismatch`)
      check(Array.isArray(entry.regions) && entry.regions.length === group.regions.length && new Set(entry.regions.map(r => r.region)).size === group.regions.length, `${group.key}: review regions missing/duplicated`)
      for (const name of group.regions) {
        const region = entry.regions.find(r => r.region === name)
        check(region && ['passed', 'difference', 'unverified'].includes(region.status), `${group.key}/${name}: invalid region status`)
        check(nonempty(region.observation), `${group.key}/${name}: observation required`)
        check(Array.isArray(region.allowedDifferences) && region.allowedDifferences.every(d => nonempty(d.difference) && nonempty(d.basis)), `${group.key}/${name}: allowed difference and basis required`)
        if (region.status !== 'passed') issues.push(`${group.key}/${name}: ${region.status}: ${region.observation}`)
      }
    }
    result.visual = { status: issues.length ? 'incomplete' : 'passed', errors: issues, reviewPath: resolve(values.review), review }
    if (reused) result.visual.reuse = { reviewPath: resolve(values.review), original: { ...review.source, manifestSha256: review.manifestSha256 }, current: { manifestSha256: binding.manifestSha256, runId: result.run.runId, sourceRevision: result.run.sourceRevision }, reason: 'Explicit reuse of identical current contract, originals and capture state; no new image review claimed.' }
  }
} catch (error) {
  result.visual.errors ||= []
  result.visual.errors.push(error.message)
}
const serialized = `${JSON.stringify(result, null, 2)}\n`
if (output) writeFileSync(output, serialized)
console.log(serialized.trim())
process.exitCode = result.behavior.status === 'passed' && result.evidence.status === 'reviewable' && result.visual.status === 'passed' ? 0 : 1
