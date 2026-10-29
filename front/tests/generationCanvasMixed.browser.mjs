import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-mixed-')
const api = 'http://127.0.0.1:8295', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8295' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4295, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '混合管道' }) })).json()).data
  const url = `${base}/${canvas.id}`
  const request = async (path, body, method = 'POST') => {
    const response = await fetch(url + path, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  const read = () => request('', undefined, 'GET')
  const poll = async predicate => { for (let i = 0; i < 100; i++) { const state = await request('/runtime', undefined, 'GET'); if (predicate(state)) return state; await delay(100) } throw Error('runtime did not settle') }
  const source = (id, port, object_id) => ({ canvas_id: canvas.id, card_id: id, port_id: port, position: 0, ...(object_id ? { object_id } : {}) })
  const document = { ...canvas.document, cards: [{ id: 'producer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 }, prompt: { segments: [{ id: 'p', kind: 'text', text: 'portrait' }] } }] }
  await request('', { request_id: 'seed', expected_revision: 0, document }, 'PUT')
  const first = await request('/precheck', { card_id: 'producer' })
  await request('/runs', { request_id: 'producer', preview_token: first.preview_token })
  const runtime = await poll(state => state.current_outputs.producer?.length === 3)
  const image = runtime.current_outputs.producer[0]
  document.cards.push(
    { id: 'ref', type: 'reference.character', objects: [{ object_id: 'alice', name: '小雪', category: 'character' }], image_binding: { source: image.source, file_id: image.file_id, result_set_id: image.result_set_id } },
    { id: 'act', type: 'direction.performance', physical_action: { state: 'fact', text: '缓慢伸手' }, input_bindings: [{ id: 'person', input_port: 'participant', source: source('ref', 'object', 'alice') }] },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } })
  document.edges = [
    { id: 'fixed', source_card: 'producer', source_port: 'image', target_card: 'ref', target_port: 'image_source' },
    { id: 'actor', source_card: 'ref', source_port: 'object', target_card: 'act', target_port: 'participant' },
    { id: 'design', source_card: 'act', source_port: 'text', target_card: 'consumer', target_port: 'text' },
    { id: 'image', source_card: 'ref', source_port: 'image', target_card: 'consumer', target_port: 'image' }]
  document.input_order = { ref: { image_source: ['fixed'] }, act: { participant: ['actor'] }, consumer: { text: ['design'], image: ['image'] } }
  document.cards[0].prompt.segments[0].text = 'stale portrait'
  await request('', { request_id: 'mixed', expected_revision: (await read()).revision, document }, 'PUT')
  await page.goto(`http://127.0.0.1:4295/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = id => openCanvasCard(page, id)
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await card.getByRole('button', { name: '采用 @图片1', exact: true }).click()
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.waitFor()
  assert.match(await preview.textContent(), /执行 consumer/)
  assert.doesNotMatch(await preview.textContent(), /执行 producer/)
  assert.match(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), /缓慢伸手/)
  assert.match(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), /小雪/)
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  const final = await request('/runtime', undefined, 'GET')
  assert.equal(final.runs.length, 2)
  assert.deepEqual(final.runs.find(run => run.nodes.some(node => node.card_id === 'consumer')).nodes.map(node => node.card_id), ['consumer'])
  assert.equal((await read()).document.cards.find(item => item.id === 'ref').image_binding.file_id, image.file_id)
  await page.screenshot({ path: join(output, 'mixed-desktop.png'), fullPage: true })
  await page.reload()
  await open('consumer')
  await card.getByRole('button', { name: '取消采用 @文本1', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'mixed-mobile.png'), fullPage: true })
  console.log('Mixed pipeline browser passed; evidence:', output)
} finally { await cleanup() }
