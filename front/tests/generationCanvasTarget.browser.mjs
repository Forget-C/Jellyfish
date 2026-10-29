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
const output = await browserOutput('jellyfish-generation-canvas-target-')
const api = 'http://127.0.0.1:8280', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8280' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4280, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const control = async body => (await fetch(`${api}/test/runtime-controls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  await control({ release: 2 })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '运行到目标' }) })).json()).data
  const url = `${base}/${canvas.id}`
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  const document = { ...canvas.document, cards: ['A', 'B', 'C'].map(id => ({ id, type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: [{ id: 'p' + id, kind: 'text', text: id }] }, config: {} })) }
  await request('', { request_id: 'seed', expected_revision: 0, document }, 'PUT')
  const waitRun = async id => {
    for (let attempt = 0; attempt < 100; attempt++) {
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
  await request('', { request_id: 'bind-existing', expected_revision: 1, document }, 'PUT')
  await control({ release: 2 })
  let streamConnections = 0
  page.on('request', request => { if (/\/events(?:\?|$)/.test(request.url())) streamConnections++ })
  await page.goto(`http://127.0.0.1:4280/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = await openCanvasCard(page, 'C')
  assert.equal(await page.getByRole('button', { name: '运行到此处', exact: true }).count(), 0)
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检' })
  await preview.waitFor()
  assert.match(await preview.textContent(), /INPUT_STALE/)
  assert.equal(await preview.getByRole('button', { name: '确认执行', exact: true }).isEnabled(), false)
  assert.equal((await request('/runtime', undefined, 'GET')).runs.length, 3, 'single target does not automatically execute stale upstream')
  await page.screenshot({ path: join(output, 'target-preview.png'), fullPage: true })
  await closePrecheck(page)
  for (const id of ['B', 'C']) {
    const details = await openCanvasCard(page, id)
    await details.getByRole('button', { name: '预检运行', exact: true }).click()
    await preview.waitFor()
    const [response] = await Promise.all([page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs')),
      preview.getByRole('button', { name: '确认执行', exact: true }).click()])
    const accepted = (await response.json()).data
    const run = await waitRun(accepted.run_id)
    assert.deepEqual(run.nodes.map(node => node.card_id), [id], 'each explicit stage runs exactly one model')
    assert.equal(run.nodes[0].status, 'succeeded')
    await closePrecheck(page)
  }
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const state = await request('/runtime', undefined, 'GET')
  assert.equal(state.runs.length, 5)
  assert.ok(state.runs.every(run => run.lifecycle === 'finished' && run.nodes.length === 1))
  assert.equal((await (await fetch(`${api}/test/runtime-controls`)).json()).calls.length, 5, 'reused A is not resubmitted')
  assert.equal(streamConnections, 1)
  await page.screenshot({ path: join(output, 'target-finished.png'), fullPage: true })
  console.log('PASS explicit single stages, stale upstream refusal, reused output, real Worker and persistent SSE')
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await cleanup() }
