import { closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-associations-')
const api = 'http://127.0.0.1:8291', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8291' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, debugPage
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4291, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  debugPage = page
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '统一关联区' }) })
  const canvas = (await response.json()).data
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 100; i++) { const state = await read(); if (predicate(state)) return state; await delay(100) } throw Error('association edit did not save') }
  const document = { ...canvas.document, cards: [
    { id: 'empty', type: 'direction.movement' }, { id: 'movement', type: 'direction.movement' },
    ...Array.from({ length: 12 }, (_, index) => ({ id: `text-${index}`, type: 'content.text', text: `参考文本 ${index}` })),
    { id: 'person', type: 'content.character', object_id: 'actor', name: '林夏', text: '街角停步' },
    ...Array.from({ length: 5 }, (_, index) => ({ id: `design-${index}`, type: 'direction.style', fields: { direction: { text: `风格 ${index}`, state: 'proposal' } } })),
    { id: 'criterion', type: 'direction.criterion', criterion_id: 'clear', name: '主体清晰', standard: { text: '人物表情可辨认' } },
    { id: 'missing', type: 'content.image', file_id: null },
    { id: 'broken-style', type: 'direction.style', fields: { direction: { state: 'proposal', document: { segments: [{ id: 'bad-ref', kind: 'reference', source: { canvas_id: canvas.id, card_id: 'missing', port_id: 'image', position: 0 } }] } } } },
  ], edges: [], input_order: {} }
  const link = (source_card, source_port, target_card, target_port) => ({ id: `${source_card}-${target_card}-${source_port}`, source_card, source_port, target_card, target_port })
  document.edges = [
    ...Array.from({ length: 12 }, (_, index) => link(`text-${index}`, 'text', 'movement', 'text')),
    link('person', 'text', 'movement', 'text'), link('person', 'object', 'movement', 'attention_object'),
    link('missing', 'image', 'movement', 'image'),
    link('missing', 'image', 'broken-style', 'image'),
    ...Array.from({ length: 5 }, (_, index) => link(`design-${index}`, 'text', 'movement', 'text')),
    link('criterion', 'criterion', 'movement', 'acceptance_basis'),
    link('broken-style', 'text', 'movement', 'text'),
  ]
  for (const edge of document.edges) {
    const ports = document.input_order[edge.target_card] ||= {}
    ;(ports[edge.target_port] ||= []).push(edge.id)
  }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(`http://127.0.0.1:4291/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail = page.locator('.wb-details:visible')
  const strip = detail.getByRole('region', { name: '关联来源', exact: true })
  await page.locator('[data-card-id="empty"]').press('Enter')
  await strip.waitFor()
  await detail.getByRole('button', { name: '高级设置', exact: true }).click()
  const heading = detail.getByText('设计参数', { exact: true })
  await delay(300)
  const before = await heading.boundingBox()
  assert.equal(await strip.locator('.generation-material-reference').count(), 0)
  const add = strip.getByRole('button', { name: '添加设计来源', exact: true })
  assert.equal(Math.round((await add.boundingBox()).width), 64)
  await add.click()
  await page.getByRole('menuitem', { name: '从当前画布选择', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选择画布来源', exact: true })
  await picker.getByRole('button', { name: /text-0 · 连接提供候选/ }).click()
  await poll(state => state.document.edges.some(edge => edge.source_card === 'text-0' && edge.target_card === 'empty'))
  await strip.locator('.generation-material-reference').waitFor()
  assert.equal((await heading.boundingBox()).y, before.y)
  await add.click()
  await page.getByRole('menuitem', { name: '从当前画布选择', exact: true }).click()
  await picker.getByRole('button', { name: /主体清晰.*连接即关联验收要求/ }).click()
  await poll(state => state.document.cards.find(card => card.id === 'empty').input_bindings.some(binding => binding.input_port === 'acceptance_basis'))
  await strip.getByRole('button', { name: /主体清晰/ }).click()
  await page.getByRole('region', { name: '验收要求详情', exact: true }).getByText('人物表情可辨认').waitFor()
  await page.keyboard.press('Escape')
  await closeCanvasDetails(page)
  await page.locator('[data-card-id="movement"]').press('Enter')
  await strip.waitFor()
  await delay(300)
  const checks = async () => {
    assert.equal(await strip.evaluate(el => el.scrollWidth > el.clientWidth), false)
    for (const box of await strip.locator('.generation-material-reference').evaluateAll(elements => elements.map(el => [el.offsetWidth, el.offsetHeight]))) assert.deepEqual(box, [64, 64])
    for (const button of await strip.locator('[data-summary="false"]').all()) assert.equal(Math.round((await button.boundingBox()).width), 32)
  }
  await checks()
  const designMore = strip.getByRole('button', { name: /^设计更多.*含异常/ })
  await designMore.waitFor()
  const materialMore = strip.getByRole('button', { name: /^素材更多/ })
  await materialMore.click()
  const list = page.locator('.canvas-association-list:visible')
  assert.equal(await list.getByRole('button', { name: /候选 林夏/ }).count(), 1, 'object identity and text share one source entry')
  await list.getByRole('button', { name: /候选 林夏/ }).click()
  await page.getByRole('button', { name: /选择关注对象 林夏/ }).waitFor()
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.activeElement?.getAttribute('data-association-more') === 'material')
  assert.equal(await materialMore.evaluate(el => document.activeElement === el), true)
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(350)
  await checks()
  assert.equal(await strip.locator('.canvas-association-group').count(), 2)
  await page.screenshot({ path: join(output, 'associations-390.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 320, height: 780 })
  await delay(350)
  await checks()
  await page.screenshot({ path: join(output, 'associations-320.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await delay(350)
  await page.screenshot({ path: join(output, 'associations-desktop.png'), animations: 'disabled' })
  assert.deepEqual(errors, [])
} catch (error) { await debugPage?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }); throw error } finally { await cleanup() }
