import { parseArgs, isDeepStrictEqual } from 'node:util'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve, isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
import { chromium } from 'playwright'
const hash = data => createHash('sha256').update(data).digest('hex')
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const check = (condition, message) => { if (!condition) throw Error(message) }
const revision = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value)
const nonempty = value => typeof value === 'string' && value.trim().length > 0
const viewports = [[1440, 960], [390, 844], [3830, 1688]]
const kinds = ['text', 'image', 'model-text', 'model-image']
const statesById = ['default', 'expanded', 'empty']
const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1
  return n >>> 0
})
// Browsers tolerate partial PNGs. Check framing and checksums before decoding original pixels.
function checkPng(data) {
  check(data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10])), 'invalid PNG signature')
  let offset = 8, ended = false
  while (offset + 12 <= data.length) {
    const length = data.readUInt32BE(offset), end = offset + 12 + length
    check(end <= data.length, 'truncated PNG chunk')
    let crc = 0xffffffff
    for (const byte of data.subarray(offset + 4, end - 4)) crc = crcTable[(crc ^ byte) & 255] ^ (crc >>> 8)
    check(((crc ^ 0xffffffff) >>> 0) === data.readUInt32BE(end - 4), 'corrupt PNG checksum')
    if (data.toString('ascii', offset + 4, offset + 8) === 'IEND') { ended = true; offset = end; break }
    offset = end
  }
  check(ended && offset === data.length, 'incomplete PNG/IEND')
}
const portable = name => nonempty(name) && !isAbsolute(name) && !name.split(/[\\/]/).includes('..')
const keyOf = g => `${g.id}-${g.kind}-${g.state}-${g.viewport.width}x${g.viewport.height}`

/** Verify mechanical evidence only. A reviewable result deliberately never grants visual approval. */
export async function evaluateEvidence(options) {
  const result = { schemaVersion: 1, behavior: { status: options.behavior || 'unknown' }, evidence: { status: 'not-checked', errors: [] }, visual: { status: 'not-reviewed' }, groups: [] }
  if (!options.manifest && !options.matrix && !options.run) return result
  result.evidence.status = 'failed'
  let browser
  try {
    if (!options.manifest || !options.matrix || !options.run) throw Error('manifest, matrix and run are all required for evidence verification')
    const manifestPath = resolve(options.manifest), matrixPath = resolve(options.matrix), runPath = resolve(options.run)
    const run = json(runPath)
    result.behavior.status = ['passed', 'failed'].includes(run.behavior) ? run.behavior : 'unknown'
    result.run = run
    const manifest = json(manifestPath), matrix = json(matrixPath)
    check(manifest.schemaVersion === 1 && /^c-[a-f0-9]{8}-v[1-9][0-9]*$/.test(manifest.version), 'invalid baseline version/schemaVersion')
    check(revision(manifest.source?.revision) && manifest.version.startsWith(`c-${manifest.source.revision.slice(0, 8)}-`), 'invalid baseline source revision/version')
    check(manifest.source.role === 'design-target-only' && nonempty(manifest.source.confirmation) && nonempty(manifest.changeReason), 'baseline source confirmation/changeReason missing')
    check(run.schemaVersion === 1 && nonempty(run.runId), 'invalid run version/runId')
    for (const field of ['sourceRevision', 'fixtureRevision']) check(revision(run[field]), `invalid run ${field}`)
    check(['passed', 'failed'].includes(run.behavior), 'invalid behavior result')
    check(['node', 'browser', 'platform'].every(field => nonempty(run.environment?.[field])), 'run environment node/browser/platform required')
    function matrixCheck(groups, label) {
      check(Array.isArray(groups) && groups.length === 36, `${label}: expected 36 groups`)
      const seen = new Set()
      for (const g of groups) {
        const index = Number(g.id?.slice(1)) - 1
        check(/^F(0[1-9]|1[0-2])$/.test(g.id) && kinds[Math.floor(index / 3)] === g.kind && statesById[index % 3] === g.state, `${label} ${g.id}: wrong kind/state`)
        check(viewports.some(([w, h]) => g.viewport?.width === w && g.viewport?.height === h), `${label} ${g.id}: wrong viewport`)
        const key = keyOf(g)
        check(!seen.has(key), `${label} ${key}: duplicate combination`)
        seen.add(key)
      }
    }
    matrixCheck(manifest.groups, 'target'); matrixCheck(matrix, 'actual')
    for (const g of manifest.groups) {
      const key = keyOf(g)
      check(g.zoom === 1, `${key}: invalid target zoom`)
      const mobile = g.viewport.width === 390
      check(mobile ? g.cardVisible === false && !g.card && g.cardOmission?.basis === 'contract.md#mobile-prototype-card-absence' && g.cardOmission?.reason === 'Prototype hides card at 390px; formal card remains mandatory.' : g.cardVisible === true && nonempty(g.card) && !g.cardOmission, `${key}: invalid card target/omission`)
      check(nonempty(g.full) && nonempty(g.editor), `${key}: full/editor target required`)
      check(mobile || g.state === 'expanded' || nonempty(g.cardWithTitle), `${key}: cardWithTitle target required`)
      const regions = ['page/context', 'card/title', 'editor/body', 'editor/actions', ...(g.kind.startsWith('model-') ? ['editor/inputs', 'editor/parameters'] : []), ...(g.state === 'empty' ? ['empty-state'] : [])]
      check(JSON.stringify(g.regions) === JSON.stringify(regions), `${key}: missing or invalid review regions`)
    }
    result.baselineVersion = manifest.version
    result.manifest = { path: manifestPath, sha256: hash(readFileSync(manifestPath)) }
    check(nonempty(run.states), 'run capture states path required')
    const states = json(resolve(dirname(runPath), run.states))
    check(portable(manifest.contract?.path), 'contract requires relative path')
    const contractPath = resolve(dirname(manifestPath), manifest.contract.path)
    result.contract = { path: contractPath, sha256: hash(readFileSync(contractPath)) }
    check(result.contract.sha256 === manifest.contract.sha256, 'contract content identity mismatch')
    for (const target of manifest.groups) {
      const key = keyOf(target), state = states[key], model = target.kind.startsWith('model-'), empty = target.state === 'empty'
      check(state?.card && Array.isArray(state.outputs), `${key}: missing capture state/card/outputs`)
      check(state.zoom === target.zoom, `${key}: capture zoom does not match target`)
      check(state.viewport?.width === target.viewport.width && state.viewport?.height === target.viewport.height, `${key}: capture viewport mismatch`)
      const type = { text: 'content.text', image: 'content.image', 'model-text': 'model.text', 'model-image': 'model.image' }[target.kind]
      check(state.card.type === type, `${key}: captured card type mismatch`)
      const hasInput = model ? Array.isArray(state.card.input_bindings) && state.card.input_bindings.length > 0 : target.kind === 'text' ? nonempty(state.card.text) : nonempty(state.card.file_id)
      check(hasInput === !empty, `${key}: captured input is inconsistent with ${target.state}`)
      if (model) {
        check(nonempty(state.card.model_id), `${key}: selected model required`)
        check((state.outputs.length > 0) === !empty, `${key}: captured output is inconsistent with ${target.state}`)
        check(state.card.config && typeof state.card.config === 'object', `${key}: actual model parameters missing`)
      }
      if (target.state === 'expanded') {
        const defaultKey = keyOf({ ...target, id: `F${String(Number(target.id.slice(1)) - 1).padStart(2, '0')}`, state: 'default' })
        check(isDeepStrictEqual({ card: state.card, outputs: state.outputs }, { card: states[defaultKey]?.card, outputs: states[defaultKey]?.outputs }), `${key}: default/expanded content, file, adoption or output changed; must remain the same`)
      }
    }
    browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' })
    const page = await browser.newPage()
    const images = new Map()
    async function image(root, name) {
      const path = resolve(root, name)
      if (images.has(path)) return images.get(path)
      const data = readFileSync(path)
      checkPng(data)
      const dimensions = await page.evaluate(async encoded => {
        const image = new Image()
        image.src = `data:image/png;base64,${encoded}`
        await image.decode()
        return { width: image.naturalWidth, height: image.naturalHeight }
      }, data.toString('base64'))
      const identity = { path, relativePath: relative(dirname(resolve(options.output || matrixPath)), path), sha256: hash(data), ...dimensions }
      images.set(path, identity)
      return identity
    }
    for (const target of manifest.groups) {
      const key = keyOf(target), actual = matrix.find(g => keyOf(g) === key), state = states[key]
      if (!actual || !state) throw Error(`${key}: missing actual group or capture state`)
      const targetImages = {}, actualImages = {}
      for (const role of ['full', 'editor', 'card', 'cardWithTitle']) if (target[role]) {
        try {
          check(portable(target[role]), 'target must use relative path')
          const identity = await image(dirname(manifestPath), target[role]), expected = manifest.files?.[target[role]]
          check(expected && ['sha256', 'width', 'height'].every(field => identity[field] === expected[field]), 'target image content identity mismatch')
          targetImages[role] = identity
        } catch (error) { throw Error(`${key}: target ${role}: ${error.message}`) }
      }
      for (const role of ['page', 'editor', 'card']) {
        try {
          actualImages[role] = await image(dirname(matrixPath), actual.formal[role])
          const captured = state.images?.[role]
          check(captured && captured.file === actual.formal[role] && captured.sha256 === actualImages[role].sha256, 'capture file/content identity mismatch')
        }
        catch (error) { throw Error(`${key}: actual ${role}: ${error.message}`) }
      }
      for (const original of [targetImages.full, actualImages.page]) check(original.width === target.viewport.width && original.height === target.viewport.height, `${key}: full page dimensions do not match viewport`)

      result.groups.push({ key, id: target.id, kind: target.kind, state: target.state, viewport: target.viewport, zoom: state.zoom, regions: target.regions, target: targetImages, actual: actualImages, capture: state, captureSha256: hash(JSON.stringify(state)), differences: target.kind.startsWith('model-') ? [`Actual selected model: ${state.card.model_id}; real parameters: ${JSON.stringify(state.card.config)} (prototype sample parameters are illustrative).`, `Actual structured adopted references: ${JSON.stringify(state.card.input_bindings || [])}; output identities/content: ${JSON.stringify(state.outputs)}; actual media sizes/content: ${JSON.stringify(state.media || [])} (prototype names, generic result and picture are illustrative).`] : target.kind === 'image' ? [`Actual image file: ${state.card.file_id || 'none'}; metadata: ${JSON.stringify(state.media || {})}. Prototype streetscape is illustrative; complete actual file must remain visible in editor.`] : [`Actual text: ${JSON.stringify(state.card.text)}; original target text: ${JSON.stringify(target.content)}.`], cardOmission: target.cardOmission || null })
    }
    result.evidence.status = 'reviewable'
  } catch (error) {
    result.evidence.errors.push(error.message)
  } finally {
    await browser?.close()
  }
  return result
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let result, output
  try {
    const { values } = parseArgs({ options: Object.fromEntries(['behavior','manifest','matrix','run','output'].map(name => [name, { type: 'string' }])) })
    output = values.output
    result = await evaluateEvidence(values)
  } catch (error) {
    result = { schemaVersion: 1, behavior: { status: 'unknown' }, evidence: { status: 'failed', errors: [error.message] }, visual: { status: 'not-reviewed' }, groups: [] }
  }
  const serialized = `${JSON.stringify(result, null, 2)}\n`
  if (output) writeFileSync(output, serialized)
  console.log(serialized.trim())
  process.exitCode = result.behavior.status === 'passed' && result.evidence.status !== 'failed' ? 0 : 1
}
