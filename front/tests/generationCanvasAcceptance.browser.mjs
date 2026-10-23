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
const output = await browserOutput('jellyfish-generation-canvas-acceptance-')
const api = 'http://127.0.0.1:8283', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8283' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4283, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多图与未完成成果' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'p', kind: 'text', text: '三张完整图片' }] }, config: { count: 3, target_ratio: '1:1', resolution_profile: 'standard' } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: { count: 3 } }],
    edges: [{ id: 'downstream', source_card: 'm', source_port: 'image', target_card: 'consumer', target_port: 'image' }], input_order: { consumer: { image: ['downstream'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4283/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = page.locator('[data-card-id="m"]'), consumer = page.locator('[data-card-id="consumer"]')
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const control = async body => (await fetch(`${api}/test/image-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const runtime = async () => (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  const start = async () => {
    await card.getByRole('button', { name: '预检运行', exact: true }).click()
    const received = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
    await preview.getByRole('button', { name: '确认执行', exact: true }).click()
    return (await (await received).json()).data
  }
  await start()
  const formal = card.getByRole('region', { name: '当前正式输出', exact: true })
  await formal.getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '创建第一章', exact: true }).count(), 0)
  const layoutKey = `jellyfish:generation-layout:canvas-project:${canvas.id}:view:canvas`
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 1000 })
    await page.addInitScript(({ key, width }) => localStorage.setItem(key, JSON.stringify({ schema: 1, positions: { m: { x: 0, y: 0 }, consumer: { x: 650, y: 0 } }, sizes: { m: { width: 420, height: 820 } }, transform: { x: 8, y: 8, scale: width === 375 ? .68 : .78 } })), { key: layoutKey, width })
    await page.reload()
    const take = page.getByRole('button', { name: '取得编辑权', exact: true })
    await formal.waitFor()
    if (await take.isVisible()) await take.click()
    await formal.getByRole('button', { name: '预览输出 3', exact: true }).click()
    const image = formal.getByRole('img', { name: '图片预览', exact: true })
    await image.scrollIntoViewIfNeeded()
    assert.equal(await image.evaluate(el => el.complete && el.naturalWidth === 240), true)
    const surface = page.getByLabel('生成画布视口', { exact: true })
    await surface.scrollIntoViewIfNeeded()
    await surface.evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0 })
    const imageBox = await image.boundingBox(), surfaceBox = await surface.boundingBox()
    assert.ok(imageBox.x >= surfaceBox.x && imageBox.x + imageBox.width <= surfaceBox.x + surfaceBox.width, 'media fits actual surface')
    assert.ok(imageBox.y >= surfaceBox.y && imageBox.y + imageBox.height <= surfaceBox.y + surfaceBox.height, 'media visible vertically')
    await page.screenshot({ path: join(output, `media-${width}.png`) })
    await card.evaluate(el => { el.scrollTop = 0 })
    await page.screenshot({ path: join(output, `parameters-${width}.png`) })
    const parameters = card.getByRole('combobox', { name: '图片画幅', exact: true })
    await parameters.focus()
    assert.equal(await parameters.evaluate(el => el.contains(document.activeElement) || el === document.activeElement), true)
    const prompt = card.getByRole('textbox', { name: '模型正文', exact: true })
    await prompt.fill('长正文'.repeat(180))
    await prompt.press('End')
    await prompt.press('Tab')
    assert.equal(await prompt.evaluate(el => el.textContent), '长正文'.repeat(180))
    await page.screenshot({ path: join(output, `long-text-${width}.png`) })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no page overflow')
    await page.getByRole('button', { name: '保存画布', exact: true }).click()
    await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  }
  console.log('PASS desktop/narrow visible native media and long editor, no chapter CTA', output)
} finally { await cleanup() }
