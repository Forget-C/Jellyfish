import { closeCanvasDetails, openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-result-cards-')
const api = 'http://127.0.0.1:8302', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8302' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4302, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '显示正式结果卡' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'p', kind: 'text', text: '三张完整图片' }] }, config: { count: 3, target_ratio: '1:1', resolution_profile: 'standard' } },
    { id: 'text', type: 'content.text', text: 'Literal 图片3 [media:1]' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: { count: 3 } }],
    edges: [{ id: 'downstream', source_card: 'm', source_port: 'image', target_card: 'consumer', target_port: 'image' }, { id: 'text-edge', source_card: 'text', source_port: 'text', target_card: 'consumer', target_port: 'text' }], input_order: { consumer: { image: ['downstream'], text: ['text-edge'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4302/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await page.locator('.wb-details:not([hidden])').waitFor(); await openModelInspection(page) }
  await open('m')
  const card = page.locator('.wb-details:not([hidden])')
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const control = async body => (await fetch(`${api}/test/image-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const runtime = async () => (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  const start = async () => {
    await card.getByRole('button', { name: '预检运行', exact: true }).click()
    const received = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
    await preview.getByRole('button', { name: '确认执行', exact: true }).click()
    return (await (await received).json()).data
  }

  const model = page.locator('[data-card-id="m"]')
  const box = element => element.evaluate(node => ({ left: node.style.left, top: node.style.top, width: node.offsetWidth, height: node.offsetHeight }))
  const originalModelBox = await box(model)
  const showResults = card.getByRole('switch', { name: '显示结果卡', exact: true })
  const resultCards = page.getByRole('article', { name: /生成结果/ })
  assert.equal(await showResults.getAttribute('aria-checked'), 'false')
  await showResults.press('Space')
  assert.equal(await showResults.getAttribute('aria-checked'), 'true')
  assert.equal(await resultCards.count(), 0, 'no cards for unpublished results')
  assert.equal((await control()).calls.length, 0)

  await start()
  await resultCards.nth(2).waitFor()
  assert.equal(await resultCards.count(), 3)
  assert.equal(await page.getByRole('img', { name: '随生成更新', exact: true }).count(), 3)
  assert.equal(await page.getByRole('img', { name: '结果候选连接', exact: true }).count(), 3)
  assert.equal(await page.locator('[data-generation-edge-id="downstream"]').count(), 0)
  assert.deepEqual(await box(model), originalModelBox)

  const result = page.getByRole('article', { name: '图片生成结果 1', exact: true })
  const resultImage = result.getByRole('img', { name: '图片预览', exact: true })
  const previousFile = await resultImage.getAttribute('src')
  const originalResultBox = await box(result)
  await closeCanvasDetails(page)
  await result.getByRole('button', { name: '移动布局：图片生成结果 1' }).press('ArrowDown')
  const moved = await box(result)
  assert.equal(parseFloat(moved.top), parseFloat(originalResultBox.top) + 10)

  await open('consumer')
  assert.equal(await showResults.getAttribute('aria-checked'), 'false', 'visibility preference is per model')
  const inputs = page.getByRole('region', { name: '已保存直接输入' })
  await inputs.getByRole('button', { name: '采用 @图片1', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const readInputs = async () => {
    const { data: outputs } = await (await fetch(`${base}/${canvas.id}/cards/consumer/outputs`)).json()
    const { data: compiled } = await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()
    return { candidates: outputs.candidates, used: compiled.used, media: compiled.media, text: compiled.text }
  }
  const visibleInputs = await readInputs()
  assert.equal(visibleInputs.used.length, 1)
  await open('m')
  await showResults.click()
  await result.waitFor({ state: 'detached' })
  await page.locator('[data-generation-edge-id="downstream"]').waitFor()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual(await readInputs(), visibleInputs, 'display does not affect candidates or compiled inputs')
  await showResults.click()
  await result.waitFor()
  assert.deepEqual(await box(result), moved)
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.equal((await runtime()).current_outputs.m[0].basis_current, true)
  assert.equal((await control()).calls.length, 1)

  await control({ fail_next: true })
  await start()
  await card.getByRole('alert').filter({ hasText: 'submission_failed' }).waitFor()
  assert.equal(await resultImage.getAttribute('src'), previousFile, 'a failed generation keeps the last formal result')
  assert.deepEqual(await box(result), moved)
  await start()
  await page.waitForFunction(previous => {
    const node = document.querySelector('[aria-label="图片生成结果 1"] img')
    return node?.getAttribute('src') !== previous
  }, previousFile)
  assert.equal(await resultCards.count(), 3)
  assert.deepEqual(await box(result), moved)

  await page.reload()
  await result.waitFor()
  await open('m')
  assert.equal(await showResults.getAttribute('aria-checked'), 'true')
  assert.deepEqual(await box(result), moved)
  const observer = await context.newPage()
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  await observer.locator('[data-card-id="m"]').press('Enter')
  assert.equal(await observer.getByRole('switch', { name: '显示结果卡', exact: true }).isDisabled(), true)
  await observer.close()

  await closeCanvasDetails(page)
  await page.setViewportSize({ width: 390, height: 844 })
  await open('m')
  await showResults.scrollIntoViewIfNeeded()
  const toggleBox = await showResults.boundingBox()
  const runBox = await card.getByRole('button', { name: '预检运行', exact: true }).boundingBox()
  assert.ok(toggleBox.x >= 0 && toggleBox.x + toggleBox.width <= 391)
  assert.ok(runBox.x >= 0 && runBox.x + runBox.width <= 391)
  assert.equal((await control()).calls.length, 3)
  await page.screenshot({ path: join(output, 'result-display-mobile.png'), fullPage: true })
  console.log('PASS formal result display, layout, candidate parity, regeneration and readonly', output)
} finally { await cleanup() }
