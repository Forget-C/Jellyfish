import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-design-name-fields-')
const api = 'http://127.0.0.1:8692', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8692' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4692, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const labels = { creative_control: '创作控制名称', guidance: '生成指导名称', criterion: '验收要求名称', narrative: '叙事名称', beat: '节拍名称', event: '事件名称', shot: '镜头名称', anchor: '锚点名称', blocking: '调度名称' }
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '设计名称字段审计' }) })).json()).data
  const document = { ...canvas.document, cards: Object.keys(labels).map(id => ({ id, type: 'direction.' + id, name: '' })) }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(100) } throw Error('name save timeout') }
  await page.goto(`http://127.0.0.1:4692/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  for (const [id, label] of Object.entries(labels)) {
    const detail = await openCanvasCard(page, id)
    const input = detail.getByRole('textbox', { name: label, exact: true })
    await input.waitFor()
    assert.equal(await detail.locator('label').filter({ hasText: label }).count(), 1, 'visible name label')
    assert.equal(await input.evaluate(element => !!element.closest('details')), false, 'name is outside relation folds')
    const placeholder = await input.getAttribute('placeholder')
    assert.ok(placeholder?.startsWith('例如：'))
    assert.equal(await detail.getByText(placeholder, { exact: true }).count(), 0)
    await input.fill('已命名-' + id)
    await poll(state => state.document.cards.find(card => card.id === id).name === '已命名-' + id)
    const advanced = detail.getByRole('button', { name: '高级设置', exact: true })
    if (await advanced.count()) await advanced.click()
    assert.equal(await input.isVisible(), true)
    await page.setViewportSize({ width: 390, height: 844 })
    const box = await input.boundingBox(), panel = await detail.boundingBox()
    assert.ok(box.width > panel.width - 64, 'name fills the narrow editor')
    await detail.screenshot({ path: join(output, id + '-name-mobile.png') })
    await page.setViewportSize({ width: 1440, height: 1000 })
    await closeCanvasDetails(page)
  }
  await page.reload()
  const observer = await context.newPage()
  await observer.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await observer.goto(page.url())
  await observer.getByText('此画布当前只读', { exact: true }).waitFor()
  for (const [id, label] of Object.entries(labels)) {
    const detail = await openCanvasCard(observer, id)
    const input = detail.getByRole('textbox', { name: label, exact: true })
    assert.equal(await input.inputValue(), '已命名-' + id)
    assert.equal(await input.isDisabled(), true)
    await closeCanvasDetails(observer)
  }
  await observer.close()
  console.log('PASS all nine named design types: visible label, persistent name, placeholder only, full width and readonly')
} finally { await cleanup() }
