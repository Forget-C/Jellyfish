import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-multi-')
const api = 'http://127.0.0.1:8283', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_video_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8283', CANVAS_VIDEO_FIXTURE: join(output, 'unused.mp4') }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4283, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多角度参考' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'front', type: 'reference.character', title: '正面', objects: [
      { object_id: 'alice', name: '小雪', category: 'character' },
      { object_id: 'bob', name: '小李', category: 'character' }] }], edges: [], input_order: {} }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4283/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('save timed out') }
  await page.locator('[data-card-id="front"]').press('Enter')
  await card.getByRole('button', { name: '添加另一角度参考 小李', exact: true }).click()
  const state = await poll(state => state.document.cards.length === 2)
  const side = state.document.cards[1]
  assert.equal(side.objects.length, 0)
  assert.equal(side.image_binding, null)
  assert.deepEqual(side.input_bindings[0].source, { canvas_id: canvas.id, card_id: 'front', port_id: 'object', position: 0, object_id: 'bob' })
  assert.equal(state.document.edges.length, 1)
  await card.getByRole('textbox', { name: '参考角度', exact: true }).fill('侧面')
  await card.getByRole('textbox', { name: '参考标题', exact: true }).fill('小李侧面')
  await poll(state => state.document.cards[1].angle === '侧面' && state.document.cards[1].title === '小李侧面')
  await page.screenshot({ path: join(output, 'multi-view-desktop.png'), fullPage: true })
  await page.reload()
  await page.locator(`[data-card-id="${side.id}"]`).press('Enter')
  await card.getByRole('button', { name: '取消名称 小李', exact: true }).waitFor()
  assert.equal(await card.getByRole('textbox', { name: '参考角度', exact: true }).inputValue(), '侧面')
  const outputs = (await (await fetch(`${base}/${canvas.id}/cards/${side.id}/outputs`)).json()).data.outputs
  assert.deepEqual(outputs.map(item => item.payload.object_id), ['bob'])
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'multi-view-narrow.png'), fullPage: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64')
  await card.getByLabel('上传媒体文件', { exact: true }).setInputFiles({ name: 'side.png', mimeType: 'image/png', buffer: Buffer.concat([png, Buffer.from('side')]) })
  await poll(state => !!state.document.cards[1].image_binding)
  await page.locator('[data-card-id="front"]').press('Enter')
  await card.getByLabel('上传媒体文件', { exact: true }).setInputFiles({ name: 'front.png', mimeType: 'image/png', buffer: png })
  const current = await poll(state => !!state.document.cards[0].image_binding)
  const doc = current.document
  doc.cards.push({ id: 'v', type: 'model.video', model_id: 'video-subjects', config: { ratio: '16:9', seconds: 5 }, prompt: { segments: [{ id: 'text', kind: 'text', text: '保持自由正文' }] } })
  doc.edges.push(...['front', side.id].map((id, index) => ({ id: `media${index}`, source_card: id, source_port: 'image', target_card: 'v', target_port: 'subject_image' })))
  doc.input_order.v = { subject_image: ['media0', 'media1'] }
  assert.ok((await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'video-fixture', expected_revision: current.revision, document: doc }) })).ok)
  await page.reload()
  await page.locator('[data-card-id="v"]').press('Enter')
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  const inputs = card.getByRole('region', { name: '视频实际输入', exact: true })
  await inputs.getByRole('textbox', { name: '主体分组 @图片1', exact: true }).fill('小李组')
  await inputs.getByRole('button', { name: '采用 @图片1 为主体图片', exact: true }).click()
  await inputs.getByRole('textbox', { name: '主体分组 @图片2', exact: true }).fill('小李组')
  await inputs.getByRole('button', { name: '采用 @图片2 为主体图片', exact: true }).click()
  await poll(state => state.document.cards[2].input_bindings?.length === 2)
  await inputs.getByRole('button', { name: '前移主体图片 @图片2', exact: true }).click()
  await poll(state => state.document.cards[2].input_bindings[0].source.card_id === side.id)
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.waitFor()
  const text = await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent()
  assert.equal(text, '保持自由正文\n小雪 = @小李组 图片 2（正面）\n小李 = @小李组 图片 2（正面）\n小李 = @小李组 图片 1（侧面）')
  await page.screenshot({ path: join(output, 'multi-view-video-mapping.png'), fullPage: true })
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  let calls
  for (let i = 0; i < 80; i++) { calls = (await (await fetch(`${api}/test/video-controls`)).json()).calls; if (calls.some(call => call.method === 'POST')) break; await delay(150) }
  const body = calls.find(call => call.method === 'POST').body
  assert.equal(body.prompt, text)
  assert.equal(body.subjects.length, 1)
  assert.equal(body.subjects[0].images.length, 2)
  assert.equal(body.subjects[0].name, '小李组')
  assert.deepEqual(body.subjects[0].images, [Buffer.concat([png, Buffer.from('side')]), png].map(bytes => 'data:image/png;base64,' + bytes.toString('base64')))
  await inputs.getByRole('button', { name: '取消主体图片 @图片2', exact: true }).click()
  await poll(state => state.document.cards[2].input_bindings?.length === 1)
  await page.reload(); await page.locator('[data-card-id="v"]').press('Enter')
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  assert.equal(await card.getByRole('textbox', { name: '已采用主体分组 @图片1', exact: true }).inputValue(), '小李组')
  const categoryState = await read()
  categoryState.document.cards[0].objects.push({ object_id: 'coat', name: '蓝衣', category: 'costume' }, { object_id: 'sword', name: '长剑', category: 'prop' })
  categoryState.document.cards.push({ id: 'place', type: 'reference.place', objects: [{ object_id: 'room', name: '空屋', category: 'place' }] })
  assert.ok((await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'categories-fixture', expected_revision: categoryState.revision, document: categoryState.document }) })).ok)
  await page.reload()
  for (const [source, name, category, objectId] of [['front', '蓝衣', 'costume', 'coat'], ['front', '长剑', 'prop', 'sword'], ['place', '空屋', 'place', 'room']]) {
    const before = await read()
    await page.locator(`[data-card-id="${source}"]`).press('Enter')
    await card.getByRole('button', { name: `添加另一角度参考 ${name}`, exact: true }).click()
    const created = await poll(state => state.document.cards.length === before.document.cards.length + 1)
    const reference = created.document.cards.at(-1)
    assert.equal(reference.type, `reference.${category}`)
    assert.equal(reference.input_bindings[0].source.object_id, objectId)
    assert.equal(reference.image_binding, null)
    assert.deepEqual(reference.objects, [])
    assert.equal(created.document.cards.find(item => item.id === 'v').input_bindings.length, 1)
  }
  writeFileSync(join(output, 'assertions.json'), JSON.stringify({ text, subjects: body.subjects.length, imageCount: body.subjects[0].images.length }, null, 2))
  console.log('Multi-view page: explicit per-object identity, independent image, angle, autosave and reopen passed', output)
} finally { await cleanup() }
