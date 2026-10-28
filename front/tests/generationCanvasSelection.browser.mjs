import { openCanvasCard, closeCanvasDetails, closePrecheck } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-selection-')
const projectId = `canvas-selection-${Date.now()}`, modelId = `${projectId}-text`
const api = 'http://127.0.0.1:8281', base = `${api}/api/v1/studio/generation-canvases/${projectId}`
assert.ok(process.env.JELLYFISH_TEST_MYSQL_URL, 'parallel browser requires explicit isolated MySQL')
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8281', CANVAS_BROWSER_DATABASE_URL: process.env.JELLYFISH_TEST_MYSQL_URL, CANVAS_BROWSER_PROJECT_ID: projectId }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4281, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const control = async body => (await fetch(`${api}/test/runtime-controls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  await control({ release: 2 })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '严格框选与并行' }) })).json()).data
  const url = `${base}/${canvas.id}`
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  const document = { ...canvas.document, cards: ['A', 'B', 'C', 'X', 'Y'].map(id => ({ id, type: 'model.text', model_id: modelId, prompt: { segments: [{ id: 'p' + id, kind: 'text', text: id }] }, config: {} })) }
  await request('', { request_id: 'seed', expected_revision: 0, document }, 'PUT')
  const waitRun = async id => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const controls = await (await fetch(`${api}/test/runtime-controls`)).json()
      assert.ok(!controls.worker_error, controls.worker_error)
      const state = await request('/runtime', undefined, 'GET')
      const run = state.runs.find(run => run.id === id)
      if (run?.lifecycle === 'finished') return run
      await delay(100)
    }
    assert.fail('real Worker finishes run')
  }
  for (const card_id of ['A', 'B', 'C']) {
    const preview = await request('/precheck', { card_id })
    const accepted = await request('/runs', { request_id: card_id, preview_token: preview.preview_token })
    assert.equal((await waitRun(accepted.run_id)).nodes[0].status, 'succeeded')
  }
  document.edges = []
  document.input_order = {}
  for (const [source, target] of [['A', 'B'], ['B', 'C']]) {
    document.edges.push({ id: source + target, source_card: source, source_port: 'text', target_card: target, target_port: 'text' })
    document.input_order[target] = { text: [source + target] }
    document.cards.find(card => card.id === target).prompt.segments = [{ kind: 'reference', id: target + 'ref', source: { canvas_id: canvas.id, card_id: source, port_id: 'text', position: 0 } }]
  }
  document.cards.push({ id: 'note', type: 'content.text', text: 'independent content' })
  await request('', { request_id: 'bind-existing', expected_revision: 1, document }, 'PUT')
  await control({ release: 0 })
  let streamConnections = 0
  page.on('request', request => { if (/\/events(?:\?|$)/.test(request.url())) streamConnections++ })
  await page.goto(`http://127.0.0.1:4281/projects/${projectId}?tab=generation&canvas=${canvas.id}`)
  for (let attempt = 0; attempt < 4; attempt++) await page.getByRole('button', { name: '缩小', exact: true }).click()
  const a = page.locator('[data-card-id="A"]'), b = page.locator('[data-card-id="B"]'), c = page.locator('[data-card-id="C"]')
  await a.waitFor()
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '框选', exact: true }).click()
  const ab = await a.boundingBox(), cb = await c.boundingBox()
  await page.mouse.move(ab.x - 3, ab.y - 3)
  await page.mouse.down()
  await page.mouse.move(cb.x + cb.width + 3, ab.y + 45, { steps: 8 })
  await page.mouse.up()
  assert.ok(await a.getByRole('checkbox').isChecked(), 'box selects A')
  assert.ok(await b.getByRole('checkbox').isChecked(), 'box selects B')
  assert.ok(await c.getByRole('checkbox').isChecked(), 'box selects C')
  await b.getByRole('checkbox').uncheck()
  await page.getByRole('button', { name: '运行所选模型（2）', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检' })
  await preview.waitFor()
  assert.match(await preview.textContent(), /SELECTION_INCOMPLETE/)
  assert.equal(await preview.getByRole('button', { name: '确认执行', exact: true }).isEnabled(), false)
  assert.equal((await request('/runtime', undefined, 'GET')).runs.length, 3, 'omitted B creates no run')
  await page.screenshot({ path: join(output, 'selection-omitted-middle.png'), fullPage: true })
  await closePrecheck(page)
  await b.getByRole('checkbox').check()
  await page.locator('[data-card-id="X"]').getByRole('checkbox').check()
  await page.locator('[data-card-id="note"]').getByRole('checkbox').check()
  await page.getByRole('button', { name: '运行所选模型（4）', exact: true }).click()
  await preview.waitFor()
  assert.match(await preview.textContent(), /执行 A、B、C、X/)
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/runs') && response.request().method() === 'POST'),
    preview.getByRole('button', { name: '确认执行', exact: true }).click()])
  const selectedRun = (await request('/runtime', undefined, 'GET')).runs.find(run => run.nodes.length === 4)
  assert.ok(selectedRun)
  await preview.waitFor({ state: 'hidden' })
  // A disjoint single run is accepted while the selected producer is still streaming.
  const details = await openCanvasCard(page, 'Y')
  await details.getByRole('button', { name: '预检运行', exact: true }).click()
  await preview.waitFor()
  await Promise.all([page.waitForResponse(response => response.url().endsWith('/runs') && response.request().method() === 'POST'),
    preview.getByRole('button', { name: '确认执行', exact: true }).click()])
  await closePrecheck(page)
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const siblingRun = (await request('/runtime', undefined, 'GET')).runs.find(run => run.nodes.some(node => node.card_id === 'Y'))
  await page.locator(`[data-history-run="${siblingRun.id}"] > summary`).click()
  await page.locator(`[data-history-run="${selectedRun.id}"] > summary`).click()
  await control({ release_for: { Y: 2 } })
  assert.equal((await waitRun(siblingRun.id)).nodes[0].status, 'succeeded')
  let state = await request('/runtime', undefined, 'GET')
  assert.equal(state.runs.find(run => run.id === selectedRun.id).lifecycle, 'active')
  await page.locator(`[data-history-run="${siblingRun.id}"] > summary`).filter({ hasText: '已结束' }).waitFor()
  const controlBeforeReconnect = await (await fetch(`${api}/test/runtime-controls`)).json()
  assert.equal(controlBeforeReconnect.calls.length, 6, 'three seed, selected A/X and independent Y calls')
  assert.equal(streamConnections, 1, 'one stream carries both runs and does not close on one finished run')
  await control({ disconnect: true, duplicate_next: true })
  await control({ release: 2 })
  const finished = await waitRun(selectedRun.id)
  assert.equal(finished.nodes.length, 4)
  assert.ok(finished.nodes.every(node => node.status === 'succeeded'))
  for (let attempt = 0; attempt < 100; attempt++) {
    if ((await page.locator(`[data-history-run="${selectedRun.id}"]`).textContent()).includes('已结束')) break
    await delay(100)
  }
  assert.match(await page.locator(`[data-history-run="${selectedRun.id}"]`).textContent(), /已结束/)
  for (const node of finished.nodes) {
    assert.equal(node.text, '第一段第二段第三段')
    assert.equal(await page.locator(`[data-history-node="${node.id}"] [aria-label="历史累计正文"] .canvas-text-preview > p`).textContent(),
      '第一段第二段第三段', 'reconnect and duplicate event do not duplicate visible text')
  }
  const observed = await (await fetch(`${api}/test/runtime-controls`)).json()
  assert.equal(observed.calls.length, 8, 'only A/B/C/X/Y once after three seeds, no content or reconnect tasks')
  assert.ok(observed.stream_connections >= 2, 'real SSE reconnect')
  await page.screenshot({ path: join(output, 'selection-parallel-reconnected.png'), fullPage: true })
  await openCanvasCard(page, 'A')
  await details.getByRole('button', { name: '预检运行', exact: true }).click()
  await preview.waitFor()
  const [publicationResponse] = await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/runs') && response.request().method() === 'POST'),
    preview.getByRole('button', { name: '确认执行', exact: true }).click(),
  ])
  const publication = (await publicationResponse.json()).data
  await waitRun(publication.run_id)
  await preview.waitFor({ state: 'hidden' })
  await openCanvasCard(page, 'B')
  await details.getByText('依据已变，旧正式输出仍保留', { exact: true }).waitFor()
  await openCanvasCard(page, 'C')
  await details.getByText('依据已变，旧正式输出仍保留', { exact: true }).waitFor()
  assert.equal((await (await fetch(`${api}/test/runtime-controls`)).json()).calls.length, 9,
    'out-of-scope downstream cards become stale without executing')
  await page.screenshot({ path: join(output, 'selection-downstream-stale.png'), fullPage: true })
  console.log('PASS strict box selection, omitted B diagnostic, exact selected models, parallel completion, shared SSE duplicate/reconnect')
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await cleanup() }
