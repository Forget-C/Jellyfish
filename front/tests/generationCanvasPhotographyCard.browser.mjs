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
const output = await browserOutput('jellyfish-generation-canvas-photography-card-')
const api = 'http://127.0.0.1:8494', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8494' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4494, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const field = text => ({ text, state: 'proposal', purpose: 'design' })
  const fields = { composition: field('主体居右，留出行进空间'), viewpoint: field('平视中景'), light_sources: field('窗边柔和侧光'), depth_focus: field('浅景深，焦点落在人物眼睛'), movement_path: field('沿街道缓慢平移') }
  const document = { ...canvas.document, cards: [
    { id: 'photo', type: 'direction.photography', fields },
    { id: 'empty', type: 'direction.photography' },
    { id: 'long', type: 'direction.photography', fields: { composition: field('保留人物所在方向与前景之间的空间关系。'.repeat(28)) } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 1 } },
  ], edges: [{ id: 'design', source_card: 'photo', source_port: 'text', target_card: 'consumer', target_port: 'text' }], input_order: { consumer: { text: ['design'] } } }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  await page.goto(`http://127.0.0.1:4494/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const photo = page.locator('[data-card-id="photo"]')
  await photo.waitFor()
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await photo.getByRole('img', { name: '摄影光学示意', exact: true }).waitFor()
  assert.ok((await photo.innerText()).includes('主体居右，留出行进空间'))
  assert.ok((await photo.innerText()).includes('窗边柔和侧光'))
  const empty = page.locator('[data-card-id="empty"]'), long = page.locator('[data-card-id="long"]')
  await empty.getByText('尚未填写摄影设计', { exact: true }).waitFor()
  assert.ok((await long.boundingBox()).height <= (await photo.boundingBox()).height + 2, 'long fields stay within the same finite card size')
  assert.equal(await photo.getByRole('button', { name: '编辑卡片', exact: true }).isVisible(), false)
  await page.screenshot({ path: join(output, 'photography-cards-default.png'), animations: 'disabled' })
  await photo.screenshot({ path: join(output, 'photography-default-region.png'), animations: 'disabled' })
  await empty.screenshot({ path: join(output, 'photography-empty-region.png'), animations: 'disabled' })
  await long.screenshot({ path: join(output, 'photography-long-region.png'), animations: 'disabled' })
  await photo.hover()
  await page.screenshot({ path: join(output, 'photography-hover.png'), animations: 'disabled' })
  await photo.focus()
  await page.waitForFunction(() => document.querySelector('[data-card-id="photo"]')?.matches(':focus-within'))
  await photo.getByRole('button', { name: '编辑卡片', exact: true }).waitFor({ state: 'visible' })
  await photo.screenshot({ path: join(output, 'photography-focus-region.png'), animations: 'disabled' })
  await photo.click()
  assert.equal(await page.locator('.wb-details:visible').count(), 0, 'pointer selection of a complex card does not open its Modal')
  await photo.screenshot({ path: join(output, 'photography-selected-region.png'), animations: 'disabled' })
  await photo.getByRole('button', { name: '编辑卡片', exact: true }).click()
  const detail = page.locator('.wb-details:visible')
  await detail.getByRole('button', { name: '编辑光影与色彩', exact: true }).click()
  await detail.getByRole('textbox', { name: '光源内容', exact: true }).fill('夜间窗边轮廓光')
  assert.ok((await photo.innerText()).includes('夜间窗边轮廓光'), 'card reflects the real field edit immediately')
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  let saved
  for (let attempt = 0; attempt < 80; attempt++) {
    saved = await read()
    if (saved.document.cards.find(item => item.id === 'photo').fields.light_sources.text === '夜间窗边轮廓光') break
    await delay(100)
  }
  assert.equal(saved.document.cards.filter(item => item.type === 'direction.photography').length, 3, 'editing regions keeps the existing photographic identities')
  assert.equal(saved.document.cards.find(item => item.id === 'photo').fields.light_sources.text, '夜间窗边轮廓光')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.reload(); await photo.waitFor()
  assert.ok((await photo.innerText()).includes('夜间窗边轮廓光'), 'saved values survive reopening')
  const published = (await (await fetch(`${base}/${canvas.id}/cards/photo/outputs`)).json()).data.outputs[0]
  assert.match(published.text, /夜间窗边轮廓光/)
  assert.match(published.text, /沿街道缓慢平移/, 'fifth region remains in the full output even when the card has only four visible groups')
  assert.equal(published.modality, 'text')
  assert.equal(published.file_id, null, 'illustration is not a media output')
  const beforeAdoption = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.equal(beforeAdoption.used.length, 0, 'the existing connection only supplies a candidate')
  saved = await read()
  const adoptedDocument = { ...saved.document, cards: saved.document.cards.map(item => item.id === 'consumer' ? { ...item, input_bindings: [{ id: 'lighting-use', source: published.source, input_port: 'text', photography_scope: ['region:lighting'] }] } : item) }
  const adopted = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: saved.revision, document: adoptedDocument }) })
  assert.ok(adopted.ok, await adopted.text())
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.match(compiled.text, /夜间窗边轮廓光/)
  assert.doesNotMatch(compiled.text, /沿街道缓慢平移|主体居右|浅景深/, 'partial adoption still obeys the declared range')
  assert.equal(compiled.used.length, 1)
  await page.reload(); await photo.waitFor()
  for (const viewport of [{ width: 3830, height: 1688 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport)
    await page.getByRole('button', { name: '适应全部', exact: true }).click()
    await page.screenshot({ path: join(output, `photography-cards-${viewport.width}.png`), animations: 'disabled' })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await photo.focus(); await photo.press('Enter')
    await photo.getByRole('button', { name: '编辑卡片', exact: true }).press('Enter')
    await page.locator('.wb-details:visible').waitFor()
    await page.getByRole('button', { name: '关闭详情', exact: true }).click()
    await page.keyboard.press('Escape')
  }
  console.log('Photography diagram, finite real fields, focus/selection, saved edits, complete outputs and explicit partial adoption verified')
} finally { await cleanup() }
