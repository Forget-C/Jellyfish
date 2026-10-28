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
const output = await browserOutput('jellyfish-generation-canvas-spatial-')
const api = 'http://127.0.0.1:8287', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8287' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4287, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data

  const upload = new FormData()
  upload.append('project_id', 'canvas-project')
  upload.append('usage_kind', 'generation_upload')
  upload.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'anchor.png')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: upload })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const file = (await uploaded.json()).data
  const document = { ...canvas.document, cards: [
    { id: 'image', type: 'content.image', file_id: file.id },
    { id: 'place', type: 'content.place', object_id: 'hall', name: '大厅', text: '秘密场所正文' },
    { id: 'anchor', type: 'direction.anchor', anchor_id: 'door', name: '门边' },
    { id: 'blocking', type: 'direction.blocking', blocking_id: 'cross', name: '穿过大厅' },
    { id: 'activity', type: 'direction.activity' }, { id: 'environment', type: 'direction.environment' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model' }],
    edges: [
      { id: 'image', source_card: 'image', source_port: 'image', target_card: 'anchor', target_port: 'image_example' },
      { id: 'space', source_card: 'place', source_port: 'object', target_card: 'anchor', target_port: 'space' },
      { id: 'position', source_card: 'anchor', source_port: 'anchor', target_card: 'blocking', target_port: 'position_anchor' },
      { id: 'design', source_card: 'blocking', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { anchor: { space: ['space'], image_example: ['image'] }, blocking: { position_anchor: ['position'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4287/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await card.waitFor() }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('anchor')
  await card.getByRole('button', { name: '选择所属空间 大厅', exact: true }).click()
  await card.getByRole('textbox', { name: '位置内容', exact: true }).fill('东墙门口')
  await poll(state => state.document.cards.find(item => item.id === 'anchor').position?.text === '东墙门口')
  await card.getByText('参考素材与图片标记', { exact: true }).click()
  await card.getByRole('button', { name: '关联素材 @图片1', exact: true }).click()
  await card.getByRole('spinbutton', { name: '标记横坐标', exact: true }).fill('0.25')
  await card.getByRole('spinbutton', { name: '标记纵坐标', exact: true }).fill('0.75')
  await poll(state => state.document.cards.find(item => item.id === 'anchor').markers?.[0]?.y === 0.75)
  await card.getByLabel('锚点图片标记 门边', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'anchor-marker.png'), fullPage: true })
  await open('blocking')
  await card.getByRole('button', { name: '选择位置锚点 门边', exact: true }).click()
  await card.getByRole('textbox', { name: '路径内容', exact: true }).fill('从门边走向窗前')
  await poll(state => state.document.cards.find(item => item.id === 'blocking').path?.text === '从门边走向窗前')
  await page.screenshot({ path: join(output, 'spatial-desktop.png'), fullPage: true })
  await open('activity')
  await card.getByRole('textbox', { name: '持续任务内容', exact: true }).fill('整理书架')
  await card.getByText('位置、注意对象与时序', { exact: true }).click()
  await card.getByRole('spinbutton', { name: '反应延迟毫秒', exact: true }).fill('350')
  await poll(state => state.document.cards.find(item => item.id === 'activity').delay_ms === 350)
  await open('environment')
  await card.getByRole('textbox', { name: '环境活动内容', exact: true }).fill('窗帘轻动')
  await card.getByRole('textbox', { name: '刻意留白内容', exact: true }).fill('门口无人')
  await poll(state => state.document.cards.find(item => item.id === 'environment').empty_space?.text === '门口无人')
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.match(compiled.text, /从门边走向窗前/)
  assert.doesNotMatch(compiled.text, /秘密场所正文|东墙门口/)
  await page.reload()
  await open('blocking')
  assert.equal(await card.getByRole('textbox', { name: '路径内容', exact: true }).inputValue(), '从门边走向窗前')
  await card.getByRole('button', { name: '取消位置锚点 门边', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true, 'narrow editor has no horizontal overflow')
  await page.screenshot({ path: join(output, 'spatial-mobile.png'), fullPage: true })
  console.log('Spatial browser passed; evidence:', output)
} finally { await cleanup() }
