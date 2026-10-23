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
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8278', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8278' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4278, strictPort: true, open: false, proxy: { '/api': api } } })
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
  await page.goto(`http://127.0.0.1:4278/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
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
  const first = await start()
  const formal = card.getByRole('region', { name: '当前正式输出', exact: true })
  await formal.getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  const original = (await runtime()).current_outputs.m
  assert.equal(original.length, 3)
  const revision = (await (await fetch(`${base}/${canvas.id}`)).json()).data.revision
  await formal.getByRole('button', { name: '预览输出 3', exact: true }).click()
  await formal.getByText('输出 3 / 3', { exact: true }).waitFor()
  assert.equal(await formal.getByRole('img', { name: '图片预览', exact: true }).getAttribute('src'), `http://127.0.0.1:4278/api/v1/studio/files/${original[2].file_id}/download`)
  await formal.getByRole('img', { name: '图片预览', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await formal.getByRole('img', { name: '图片预览', exact: true }).evaluate(image => image.complete && image.naturalWidth === 240), true)
  await page.screenshot({ path: join(output, 'formal-third-selected.png'), fullPage: true })
  assert.deepEqual((await runtime()).current_outputs.m, original)
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.revision, revision)
  const prompt = consumer.getByRole('textbox', { name: '模型正文', exact: true })
  await prompt.fill('@图片3'); await prompt.press('Tab')
  assert.equal(JSON.parse(await prompt.locator('[data-segment]').getAttribute('data-segment')).source.position, 2)
  await consumer.getByRole('button', { name: '预检运行', exact: true }).click()
  await preview.waitFor()
  assert.equal(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), 'image 1')
  await control({ fail_next: true })
  const failed = await start()
  await card.getByRole('alert').filter({ hasText: 'submission_failed' }).waitFor()
  const state = await runtime(), failedNode = state.runs.find(run => run.id === failed.run_id).nodes[0]
  assert.equal(failedNode.status, 'failed'); assert.equal(failedNode.outputs.length, 2)
  assert.equal(failedNode.result_set_id, null)
  assert.deepEqual(state.current_outputs.m, original)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const history = page.getByRole('region', { name: '画布运行历史', exact: true })
  const oldRecord = history.locator(`[data-history-run="${first.run_id}"]`)
  await oldRecord.locator('summary').first().click()
  assert.equal(await oldRecord.getByRole('img', { name: '图片预览', exact: true }).count(), 3)
  const record = history.locator(`[data-history-run="${failed.run_id}"]`)
  await record.locator('summary').first().click()
  assert.equal(await record.getByRole('img', { name: '图片预览', exact: true }).count(), 2)
  await record.getByRole('button', { name: '另存为图片内容卡', exact: true }).nth(1).click()
  await history.getByRole('status').filter({ hasText: '已另存为独立内容卡' }).waitFor()
  await page.screenshot({ path: join(output, 'complete-and-unfinished-history.png'), fullPage: true })
  const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  const copy = saved.cards.find(item => item.type === 'content.image')
  assert.equal(copy.file_id, failedNode.outputs[1].file_id)
  assert.equal(copy.origin.incomplete, true)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  await consumer.getByRole('combobox', { name: '连接已有卡', exact: true }).locator('..').locator('..').click()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText(`${copy.id.slice(0, 8)} → 参考图片`, { exact: true }).click()
  await prompt.fill('@图片4'); await prompt.press('Tab')
  assert.equal(JSON.parse(await prompt.locator('[data-segment]').getAttribute('data-segment')).source.card_id, copy.id)
  await consumer.getByRole('button', { name: '预检运行', exact: true }).click()
  await preview.waitFor()
  assert.equal(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), 'image 1')
  assert.equal((await control()).calls.length, 2, 'preview, save and reference never generate')
  assert.equal((await control()).stream_connections, 1, 'all runs share one canvas SSE')
  await page.screenshot({ path: join(output, 'multi-image-history-content.png'), fullPage: true })
  await page.reload()
  await page.locator(`[data-card-id="${copy.id}"]`).getByText('未完成成果副本', { exact: false }).waitFor()
  assert.deepEqual((await runtime()).current_outputs.m, original)
  assert.equal((await control()).calls.length, 2)
  console.log('PASS actual multi-image output selection/history/partial/save/independent reference/one SSE', output)
} finally { await cleanup() }
