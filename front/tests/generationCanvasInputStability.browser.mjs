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
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8587'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8587' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4587, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'同步时输入区稳定'})})
  const canvas=(await response.json()).data
  const document = { ...canvas.document, cards: [{ id: 'model', type: 'model.text', model_id: 'canvas-runtime-text' }], edges: [], input_order: {} }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.clone().text())
  let hold = false, release, started, finished, initialResolved
  const gate = new Promise(resolve => { release = resolve })
  const pending = new Promise(resolve => { started = resolve })
  const completed = new Promise(resolve => { finished = resolve })
  const initialReady = new Promise(resolve => { initialResolved = resolve })
  await page.route('**/cards/model/outputs', async route => {
    const refreshing = hold
    const response = await route.fetch()
    if (refreshing) { started(); await gate }
    await route.fulfill({ response })
    if (refreshing) finished()
    else initialResolved()
  })
  try {
    const initialCompile = page.waitForResponse(response => response.url().endsWith('/cards/model/compile') && response.ok())
    await page.goto(`http://127.0.0.1:4587/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
    await page.locator('[data-card-id="model"]').press('Enter')
    const editor = page.locator('.generation-card-editor:not([hidden])')
    const input = editor.getByRole('textbox', { name: '模型正文', exact: true })
    await input.waitFor()
    await Promise.all([initialReady, initialCompile])
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const geometry = () => input.evaluate(element => { const b = element.getBoundingClientRect(); return { top: b.top, height: b.height } })
    const before = await geometry()
    hold = true
    await input.fill('连续编辑时保持输入框位置与高度稳定。')
    await pending
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await geometry(), before, 'background candidate refresh must not move or resize the text input')
    assert.equal(await editor.getByText('正在读取直接候选', { exact: true }).count(), 0)
    release()
    await completed
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await geometry(), before, 'finishing candidate refresh preserves input geometry')
    assert.equal(await input.textContent(), '连续编辑时保持输入框位置与高度稳定。')
    await editor.screenshot({ path: join(output, 'stable-input.png'), animations: 'disabled' })
    console.log(`PASS input remains stable during autosave and candidate refresh: ${output}`)
  } finally { release() }
} finally { await cleanup() }
