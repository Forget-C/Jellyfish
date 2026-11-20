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
const api = 'http://127.0.0.1:8281', base = `${api}/api/v1/studio/generation-canvases`
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
    const card = document.cards.find(card => card.id === target)
    card.input_bindings = [{ id: target + 'input', input_port: 'text', source: { canvas_id: canvas.id, card_id: source, port_id: 'text', position: 0 } }]
    card.prompt.segments = [{ kind: 'reference', id: target + 'ref', binding_id: target + 'input' }]
  }
  document.cards.push({ id: 'note', type: 'content.text', text: 'independent content' })
  await request('', { request_id: 'bind-existing', expected_revision: 1, document }, 'PUT')
  await control({ release: 0 })
  let streamConnections = 0
  page.on('request', request => { if (/\/events(?:\?|$)/.test(request.url())) streamConnections++ })
  await page.goto(`http://127.0.0.1:4281/canvases/${canvas.id}`)
  for (let attempt = 0; attempt < 4; attempt++) await page.getByRole('button', { name: '缩小', exact: true }).click()
  const a = page.locator('[data-card-id="A"]'), b = page.locator('[data-card-id="B"]')
  await a.waitFor()
  await a.click({ modifiers: ['ControlOrMeta'] })
  await b.click({ modifiers: ['ControlOrMeta'] })
  assert.equal(await a.getAttribute('data-selected'), 'true')
  assert.equal(await b.getAttribute('data-selected'), 'true')
  assert.equal(await page.getByRole('button', { name: /运行所选模型/ }).count(), 0, 'multi-select does not expose batch execution')
  const preview = page.getByRole('region', { name: '运行预检' })
  const cDetails = await openCanvasCard(page, 'C')
  await cDetails.getByRole('button', { name: '预检运行', exact: true }).click()
  await preview.waitFor()
  assert.match(await preview.textContent(), /INPUT_STALE/)
  assert.equal(await preview.getByRole('button', { name: '确认执行', exact: true }).isEnabled(), false)
  assert.equal((await request('/runtime', undefined, 'GET')).runs.length, 3, 'stale predecessor creates no run')
  await page.screenshot({ path: join(output, 'selection-omitted-middle.png'), fullPage: true })
  await closePrecheck(page)
  const submit = async id => {
    const details = await openCanvasCard(page, id)
    await details.getByRole('button', { name: '预检运行', exact: true }).click()
    await preview.waitFor()
    const [response] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/runs') && response.request().method() === 'POST'),
      preview.getByRole('button', { name: '确认执行', exact: true }).click()])
    const accepted = (await response.json()).data
    await closePrecheck(page)
    return accepted.run_id
  }
  const producer = await submit('A'), independent = await submit('X'), sibling = await submit('Y')
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  for (const id of [producer, independent, sibling]) await page.locator(`[data-history-run="${id}"] > summary`).click()
  await control({ release_for: { Y: 2 } })
  assert.equal((await waitRun(sibling)).nodes[0].status, 'succeeded')
  assert.equal((await request('/runtime', undefined, 'GET')).runs.find(run => run.id === producer).lifecycle, 'active')
  assert.equal(streamConnections, 1, 'one stream carries disjoint single runs')
  await control({ disconnect: true, duplicate_next: true })
  await control({ release: 2 })
  for (const id of [producer, independent]) {
    const finished = await waitRun(id)
    assert.equal(finished.nodes.length, 1)
    assert.equal(finished.nodes[0].text, '第一段第二段第三段')
    await page.locator(`[data-history-run="${id}"] > summary`).filter({ hasText: '已结束' }).waitFor()
    assert.equal(await page.locator(`[data-history-node="${finished.nodes[0].id}"] [aria-label="历史累计正文"] .canvas-text-preview > p`).textContent(), '第一段第二段第三段', 'reconnect does not duplicate visible text')
  }
  await page.screenshot({ path: join(output, 'selection-parallel-reconnected.png'), fullPage: true })
  for (const id of ['B', 'C']) assert.equal((await waitRun(await submit(id))).nodes[0].status, 'succeeded')
  const observed = await (await fetch(`${api}/test/runtime-controls`)).json()
  assert.equal(observed.calls.length, 8, 'three seed calls plus five explicitly submitted single stages')
  assert.ok(observed.stream_connections >= 2)
  await waitRun(await submit('A'))
  const details = await openCanvasCard(page, 'B')
  await details.getByText('依据已变，旧正式输出仍保留', { exact: true }).waitFor()
  await openCanvasCard(page, 'C')
  await details.getByText('依据已变，旧正式输出仍保留', { exact: true }).waitFor()
  assert.equal((await (await fetch(`${api}/test/runtime-controls`)).json()).calls.length, 9, 'unsubmitted downstream stages become stale without execution')
  await page.screenshot({ path: join(output, 'selection-downstream-stale.png'), fullPage: true })
  console.log('PASS single-model parallel runs, stale predecessor diagnostic, explicit stages, shared SSE duplicate/reconnect and downstream invalidation')
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await cleanup() }
