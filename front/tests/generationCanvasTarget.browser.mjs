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
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8280' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4280, strictPort: true, open: false, proxy: { '/api': api } } })
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
  await control({ release: 0 })
  let streamConnections = 0
  page.on('request', request => { if (/\/events(?:\?|$)/.test(request.url())) streamConnections++ })
  await page.goto(`http://127.0.0.1:4280/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  for (let attempt = 0; attempt < 4; attempt++) await page.getByRole('button', { name: '缩小', exact: true }).click()
  const card = page.locator('[data-card-id="C"]')
  await card.getByRole('button', { name: '运行到此处', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检' })
  await preview.waitFor()
  assert.match(await preview.textContent(), /执行 B、C/)
  assert.match(await preview.textContent(), /复用已有结果 1 项/)
  await page.screenshot({ path: join(output, 'target-preview.png'), fullPage: true })
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const active = (await request('/runtime', undefined, 'GET')).runs.find(run => run.lifecycle === 'active')
  await page.locator(`[data-history-run="${active.id}"] > summary`).click()
  const history = page.getByRole('region', { name: '画布运行历史' })
  await history.getByText('等待上游', { exact: true }).waitFor()
  await control({ release: 2 })
  for (let attempt = 0; attempt < 100; attempt++) {
    const state = await request('/runtime', undefined, 'GET')
    if (state.runs.length === 4 && state.runs.every(run => run.lifecycle === 'finished')) break
    await delay(100)
  }
  const state = await request('/runtime', undefined, 'GET')
  const target = state.runs.find(run => run.nodes.length === 2)
  assert.ok(target && target.nodes.every(node => node.status === 'succeeded'))
  assert.equal(streamConnections, 1)
  await page.screenshot({ path: join(output, 'target-finished.png'), fullPage: true })
  console.log('PASS actual target preview, reused upstream, waiting successor, real Worker and one persistent SSE')
} catch (error) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally { await cleanup() }
