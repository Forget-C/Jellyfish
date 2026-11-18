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
const api = 'http://127.0.0.1:8586'
const base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8586' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4586, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'编辑框固定高度'})})
  const canvas=(await response.json()).data
  const document = { ...canvas.document, cards: [{ id: 'model', type: 'model.image' }], edges: [], input_order: {} }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.clone().text())
  await page.goto(`http://127.0.0.1:4586/canvases/${canvas.id}`)
  await page.locator('[data-card-id="model"]').press('Enter')
  const editor = page.locator('.generation-card-editor:not([hidden])')
  await editor.waitFor()
  const surface = page.getByLabel('生成画布视口', { exact: true })
  const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await settle()
  const initialHeight = (await editor.boundingBox()).height
  assert.equal(initialHeight, 320, 'anchored model editor keeps the current 320px height')
  await surface.focus()
  for (let i = 0; i < 32; i++) await surface.press('ArrowUp')
  assert.equal(await editor.isVisible(),true,'manual browsing does not hide the retained editor')
  const heights = []
  for (let i = 0; i < 32; i++) {
    await surface.press('ArrowDown')
    await settle()
    if (await editor.isVisible()) heights.push((await editor.boundingBox()).height)
  }
  assert.ok(heights.length > 5)
  assert.ok(heights.every(height => Math.abs(height - initialHeight) < 1), `editor height must stay fixed while panning: initial=${initialHeight}, observed=${[...new Set(heights)]}`)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await settle()
  for (const delta of [-120, 120]) {
    await page.mouse.move(1380, 650)
    await surface.focus()
    await page.keyboard.down('Space')
    await page.locator('.generation-surface-pan-ready').waitFor()
    await page.mouse.down()
    await page.mouse.move(1380, 650 + delta, { steps: 6 })
    await page.mouse.up()
    await page.keyboard.up('Space')
    await settle()
    assert.equal((await editor.boundingBox()).height, initialHeight, 'mouse pan preserves editor height')
  }
  await page.screenshot({ path: join(output, 'fixed-height-desktop.png'), animations: 'disabled' })
  console.log(`PASS fixed editor height during pan and offscreen return: ${output}`)
} finally { await cleanup() }
