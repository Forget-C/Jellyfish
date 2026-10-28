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
const output = await browserOutput('jellyfish-generation-canvas-narrative-')
const api = 'http://127.0.0.1:8293', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8293' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4293, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '命名图片参考' }) })).json()).data

  const document = { ...canvas.document, cards: [
    { id: 'event', type: 'direction.event', event_id: 'bell', name: '钟响', action_change: { state: 'fact', text: '秘密事件正文' } },
    { id: 'beat', type: 'direction.beat', beat_id: 'decision', name: '决定' },
    { id: 'overview', type: 'direction.narrative', name: '概览' },
    { id: 'shot', type: 'direction.shot', shot_id: 'reaction', name: '反应镜头' },
    { id: 'performance', type: 'direction.performance' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model' }],
    edges: [
      { id: 'event', source_card: 'event', source_port: 'event', target_card: 'shot', target_port: 'related_event' },
      { id: 'beat', source_card: 'beat', source_port: 'beat', target_card: 'shot', target_port: 'covered_beat' },
      { id: 'received', source_card: 'event', source_port: 'event', target_card: 'performance', target_port: 'received_event' },
      { id: 'design', source_card: 'shot', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { shot: { related_event: ['event'], covered_beat: ['beat'] }, performance: { received_event: ['received'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4293/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await card.waitFor() }
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('overview')
  await card.getByRole('textbox', { name: '观察视点内容', exact: true }).fill('小雪观察')
  await card.getByRole('textbox', { name: '待确定问题内容', exact: true }).fill('是否离开')
  await poll(state => state.document.cards.find(item => item.id === 'overview').open_questions?.text === '是否离开')
  await open('beat')
  await card.getByRole('textbox', { name: '行动目标内容', exact: true }).fill('拿到钥匙')
  await card.getByRole('textbox', { name: '预期变化内容', exact: true }).fill('获得主动')
  await poll(state => state.document.cards.find(item => item.id === 'beat').expected_change?.text === '获得主动')
  await open('shot')
  await card.getByRole('button', { name: '选择覆盖节拍 决定', exact: true }).click()
  await card.getByRole('button', { name: '选择关联事件 钟响', exact: true }).click()
  await card.getByRole('textbox', { name: '可见结果内容', exact: true }).fill('看向门口')
  await card.getByRole('textbox', { name: '预计时长内容', exact: true }).fill('约五秒，尚未拍摄')
  await poll(state => state.document.cards.find(item => item.id === 'shot').estimated_duration?.text === '约五秒，尚未拍摄')
  await page.screenshot({ path: join(output, 'narrative-desktop.png'), fullPage: true })
  await open('performance')
  await card.getByRole('button', { name: '选择接收事件 钟响', exact: true }).click()
  await card.getByRole('textbox', { name: '身体动作内容', exact: true }).fill('抬头')
  await poll(state => state.document.cards.find(item => item.id === 'performance').input_bindings?.length === 1)
  await open('consumer')
  await card.getByRole('button', { name: '采用 @文本1', exact: true }).click()
  await poll(state => state.document.cards.find(item => item.id === 'consumer').input_bindings?.length === 1)
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/consumer/compile`)).json()).data
  assert.match(compiled.text, /看向门口/)
  assert.match(compiled.text, /约五秒，尚未拍摄/)
  assert.doesNotMatch(compiled.text, /秘密事件正文|拿到钥匙|获得主动/)
  await page.reload()
  await open('shot')
  assert.equal(await card.getByRole('textbox', { name: '可见结果内容', exact: true }).inputValue(), '看向门口')
  await card.getByRole('button', { name: '取消覆盖节拍 决定', exact: true }).waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(await card.evaluate(element => element.scrollWidth <= element.clientWidth), true)
  await page.screenshot({ path: join(output, 'narrative-mobile.png'), fullPage: true })
  console.log('Narrative browser passed; evidence:', output)
} finally { await cleanup() }
