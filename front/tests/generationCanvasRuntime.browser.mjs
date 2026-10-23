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
const output = await browserOutput('jellyfish-generation-canvas-runtime-')
const api = 'http://127.0.0.1:8276', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8276' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4276, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '流式文本' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'm', type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: [{ id: 'p', kind: 'text', text: '原始提示词' }] }, config: {} }, { id: 'consumer', type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: [] }, config: {} }], edges: [{ id: 'downstream', source_card: 'm', source_port: 'text', target_card: 'consumer', target_port: 'text' }], input_order: { consumer: { text: ['downstream'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4276/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = page.locator('[data-card-id="m"]'), consumer = page.locator('[data-card-id="consumer"]')
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('region', { name: '运行预检' }).waitFor()
  assert.equal(await page.getByRole('region', { name: '实际提交文本' }).textContent(), '原始提示词')
  assert.equal(await consumer.getByRole('button', { name: '@文本1', exact: true }).count(), 0, 'future output is not offered')
  const preview = page.getByRole('region', { name: '运行预检' })
  const prompt = card.getByRole('textbox', { name: '模型正文', exact: true })
  const execute = () => preview.getByRole('button', { name: '确认执行', exact: true })
  const precheck = () => card.getByRole('button', { name: '预检运行', exact: true })
  const control = async body => (await fetch(`${api}/test/runtime-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const waitText = async (locator, text) => {
    await locator.filter({ hasText: new RegExp(`^${text}$`) }).waitFor()
    assert.equal(await locator.textContent(), text)
  }
  const showRuntime = async () => {
    const runtime = card.getByRole('region', { name: '运行正文', exact: true })
    const bounds = () => runtime.evaluate(element => {
      const text = element.getBoundingClientRect(), surface = element.closest('.generation-surface').getBoundingClientRect(), card = element.closest('[data-card-id]').getBoundingClientRect()
      const visible = { left: Math.max(0, surface.left, card.left), top: Math.max(0, surface.top, card.top), right: Math.min(innerWidth, surface.right, card.right), bottom: Math.min(innerHeight, surface.bottom, card.bottom) }
      return { text: { left: text.left, top: text.top, right: text.right, bottom: text.bottom }, visible,
        cameraContained: text.top >= Math.max(0, surface.top) && text.bottom <= Math.min(innerHeight, surface.bottom),
        contained: text.width > 0 && text.height > 0 && text.left >= visible.left && text.top >= visible.top && text.right <= visible.right && text.bottom <= visible.bottom }
    })
    // Camera controls are independent of document edits; bring the actual running
    // text into view instead of equating Playwright's CSS visibility with exposure.
    for (let attempt = 0; attempt < 3 && !(await bounds()).cameraContained; attempt++) await page.getByRole('button', { name: '缩小', exact: true }).click()
    if (!(await bounds()).contained) {
      const box = await card.boundingBox()
      await page.mouse.move(box.x + box.width / 2, Math.min(page.viewportSize().height - 20, box.y + box.height / 2))
      await page.mouse.wheel(0, 400)
      for (let attempt = 0; attempt < 20 && !(await bounds()).contained; attempt++) await delay(25)
    }
    const measured = await bounds()
    assert.equal(measured.contained, true, `runtime text must be fully exposed in viewport, canvas and card: ${JSON.stringify(measured)}`)
  }
  // Independent layout changes preserve a valid precheck.
  await page.getByRole('button', { name: '放大', exact: true }).click()
  assert.equal(await execute().isEnabled(), true)
  // Content changes invalidate immediately, before the periodic save.
  await prompt.fill('编辑后的提示词')
  assert.equal(await preview.count(), 0)
  // A failed save cannot run the previously saved content.
  let submitCount = 0, connections = 0
  page.on('request', request => { if (/\/events(?:\?|$)/.test(request.url())) connections++ })
  page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/runs')) submitCount++ })
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'error', message: 'validation', data: { code: 'CONTROLLED_SAVE_FAILURE', message: '受控保存失败', target: {}, blocks: ['save'] } }) }) : route.continue())
  await precheck().click()
  await page.getByRole('alert').filter({ hasText: 'CONTROLLED_SAVE_FAILURE' }).waitFor()
  assert.equal(await preview.count(), 0)
  assert.equal(submitCount, 0)
  await page.unroute(`**/generation-canvases/canvas-project/${canvas.id}`)
  // A late response for an older edit never restores execute eligibility.
  let releasePreview, enteredPreview
  const entered = new Promise(resolve => { enteredPreview = resolve })
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}/precheck`, async route => {
    const response = await route.fetch()
    enteredPreview()
    await new Promise(resolve => { releasePreview = resolve })
    await route.fulfill({ response })
  })
  await precheck().click(); await entered
  await prompt.fill('固定输入正文')
  releasePreview()
  await precheck().waitFor()
  await page.unroute(`**/generation-canvases/canvas-project/${canvas.id}/precheck`)
  assert.equal(await preview.count(), 0, 'stale precheck is discarded')
  await precheck().click(); await preview.waitFor()
  assert.equal(await page.getByRole('region', { name: '实际提交文本' }).textContent(), '固定输入正文')
  const savedRevision = (await (await fetch(`${base}/${canvas.id}`)).json()).data.revision
  // Drop a committed submission response; verification replays the exact request.
  const submissions = []
  let drop = true
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}/runs`, async route => {
    submissions.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (drop) { drop = false; await route.abort('failed') } else await route.fulfill({ response })
  })
  await execute().click()
  await page.getByRole('button', { name: '核实运行请求', exact: true }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段')
  assert.equal(await card.getByRole('region', { name: '当前正式输出' }).count(), 0)
  assert.equal(await card.getByRole('button', { name: '删除卡片', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '删除画布', exact: true }).isDisabled(), true)
  assert.equal((await control()).calls.length, 1)
  assert.equal((await control()).calls[0].text, '固定输入正文')
  await page.reload()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段')
  await page.getByRole('button', { name: '核实运行请求', exact: true }).click()
  await page.getByRole('button', { name: '核实运行请求', exact: true }).waitFor({ state: 'detached' })
  assert.deepEqual(submissions[1], submissions[0], 'unknown outcome uses identical identity and token')
  assert.equal((await control()).calls.length, 1)
  await showRuntime()
  assert.equal((await control()).release, 0, 'first increment is exposed while provider is blocked before second chunk')
  await page.screenshot({ path: join(output, 'stream-first-increment.png'), fullPage: true })
  await control({ release: 1 })
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  await showRuntime()
  assert.equal((await control()).release, 1, 'second increment is exposed while provider is blocked before completion')
  await page.screenshot({ path: join(output, 'stream-second-increment.png'), fullPage: true })
  // Refresh restores accumulated text, then continues the existing open run.
  await page.reload()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  assert.equal((await control()).calls.length, 1)
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.revision, savedRevision, 'runtime increments never save the document')
  await control({ release: 2 })
  await card.getByRole('status').filter({ hasText: '已完成' }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段第三段')
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }), '第一段第二段第三段')
  assert.equal((await control()).calls.length, 1)
  assert.equal(await consumer.getByRole('button', { name: '@文本1', exact: true }).isEnabled(), true, 'published model output becomes a real downstream reference candidate')
  // A later run shares this canvas connection; failure preserves previous official output.
  const connectionsBeforeSecondRun = connections
  await control({ release: 0, fail_next: true })
  await precheck().click(); await execute().click()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段')
  // Editing remains available while a fixed execution is in progress.
  await prompt.fill('运行期间的后续编辑')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await control({ release: 2 })
  await card.getByRole('status').filter({ hasText: '失败 · 未完成' }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }), '第一段第二段第三段')
  assert.equal((await control()).calls.length, 2)
  assert.equal(await card.getByRole('button', { name: '删除卡片', exact: true }).isEnabled(), true, 'terminal failure releases card activity guard')
  assert.equal(await page.getByRole('button', { name: '删除画布', exact: true }).isEnabled(), true, 'terminal failure releases canvas activity guard')
  assert.equal(await prompt.textContent(), '运行期间的后续编辑')
  assert.equal((await control()).calls[1].text, '固定输入正文', 'accepted run keeps the frozen input')
  assert.equal(connections, connectionsBeforeSecondRun, 'completed run keeps the shared SSE connection open')
  await showRuntime()
  await page.screenshot({ path: join(output, 'runtime-failure.png'), fullPage: true })
  await page.reload()
  await card.getByRole('status').filter({ hasText: '失败 · 未完成' }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  assert.equal((await control()).calls.length, 2)
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }), '第一段第二段第三段依据已变，旧正式输出仍保留')
  // Structured precheck diagnostics locate the actual offending card.
  await consumer.getByRole('button', { name: '预检运行', exact: true }).click()
  const diagnostic = preview.getByRole('alert').filter({ hasText: 'TEXT_REQUIRED' })
  await diagnostic.waitFor()
  assert.equal(await execute().isDisabled(), true)
  await diagnostic.getByRole('button', { name: '定位问题', exact: true }).click()
  assert.equal(await page.evaluate(() => document.activeElement.dataset.cardId), 'consumer')
  assert.equal((await control()).calls.length, 2, 'precheck diagnostics never start generation')
  await page.goto('http://127.0.0.1:4276/projects/canvas-project?tab=dashboard')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const task = page.locator('.app-task-card').filter({ hasText: '流式文本' }).first()
  await task.getByRole('button', { name: /查看/ }).click()
  await page.waitForURL(`**/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  await card.getByRole('status').filter({ hasText: '失败 · 未完成' }).waitFor()
  console.log(JSON.stringify({ output, success: true, calls: (await control()).calls.length }))
} catch (reason) {
  if (page) { console.log((await page.locator('body').innerText()).slice(-9000)); await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }) }
  throw reason
} finally { await cleanup() }
