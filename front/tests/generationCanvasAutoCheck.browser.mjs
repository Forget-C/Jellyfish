import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-auto-check-')
const api = 'http://127.0.0.1:8324', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8324', CANVAS_BROWSER_AUTO_CHECKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4324, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const headers = { 'Content-Type': 'application/json' }
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
    assert.ok(response.ok, await response.clone().text())
    const payload = await response.json()
    return payload.data ?? payload
  }
  const canvas = await request(base, 'POST', { name: '完整交付后自动检查' })
  const canvasUrl = `${base}/${canvas.id}`
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } },
    { id: 'shot', type: 'direction.shot', visible_result: { state: 'fact', text: '保持红色背景' } },
    { id: 'check', type: 'review.check', check_model_id: 'auto-vision' },
  ], edges: [
    { id: 'adopt', source_card: 'shot', source_port: 'text', target_card: 'm', target_port: 'text' },
    { id: 'observe', source_card: 'm', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { m: { text: ['adopt'] }, check: { check_basis: ['observe'] } } }
  await request(canvasUrl, 'PUT', { request_id: 'seed', expected_revision: 0, document })
  await request(`${api}/test/image-controls`, 'POST', { response_delay: 3 })
  await page.goto(`http://127.0.0.1:4324/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  await openCanvasCard(page, 'check')
  const editor = page.getByRole('region', { name: '生成后检查', exact: true })
  const enabled = editor.getByRole('checkbox', { name: '完整交付后自动检查', exact: true })
  await enabled.waitFor()
  assert.equal(await enabled.isChecked(), false)
  await enabled.check()
  await editor.getByRole('checkbox', { name: '静态摄影与风格落实', exact: true }).uncheck()
  await closeCanvasDetails(page)
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(canvas.id))
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  assert.ok((await saved).ok())
  await openCanvasCard(page, 'm')
  await page.locator('.wb-details:visible').getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.getByRole('region', { name: '本次自动生成后检查', exact: true })
    .getByText(/产物 3 份 · 图片模型检查 · 预计调用 3 次/).waitFor()
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  await openCanvasCard(page, 'check')
  assert.deepEqual(await request(`${canvasUrl}/checks/check/reports`), [])
  const report = page.getByRole('region', { name: '检查报告', exact: true })
  await report.getByText('完整交付后自动检查', { exact: true }).waitFor()
  await report.getByText('仅核对当前固定图片', { exact: true }).waitFor()
  const reports = await request(`${canvasUrl}/checks/check/reports`)
  assert.equal(reports.length, 3)
  assert.deepEqual(reports.map(row => row.product.position).sort(), [0, 1, 2])
  assert.ok(reports.every(row => row.automatic))
  assert.equal((await request(`${api}/test/image-controls`)).check_calls.length, 3)
  console.log('automatic check preview, existing open editor updates, and three fixed products passed')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
