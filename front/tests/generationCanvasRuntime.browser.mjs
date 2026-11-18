import { openSummaryMenu } from './generationCanvasWorkbench.browser-helpers.mjs'
import { openCanvasCard, closeCanvasDetails, closePrecheck, assertVisibleInDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const api = 'http://127.0.0.1:8276', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8276' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4276, strictPort: true, open: false, proxy: { '/api': api } } })
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
  await page.goto(`http://127.0.0.1:4276/canvases/${canvas.id}`)
  const sourceSummary = page.locator('[data-card-id="m"]')
  const card = page.locator('.wb-details:visible')
  const runStatus = text => card.getByRole('region', { name: '本次运行', exact: true }).getByRole('status').filter({ hasText: text })
  await openCanvasCard(page, 'consumer')
  assert.equal(await card.getByRole('button', { name: '@文本1', exact: true }).count(), 0, 'future output is not offered')
  await openCanvasCard(page, 'm')
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('region', { name: '运行预检' }).waitFor()
  assert.equal(await page.getByRole('region', { name: '实际提交文本' }).textContent(), '原始提示词')
  const preview = page.getByRole('region', { name: '运行预检' })
  const prompt = card.getByRole('textbox', { name: '模型正文', exact: true })
  const execute = () => preview.getByRole('button', { name: '确认执行', exact: true })
  const precheck = () => card.getByRole('button', { name: '预检运行', exact: true })
  const control = async body => (await fetch(`${api}/test/runtime-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const waitText = async (locator, text) => {
    await locator.filter({ hasText: new RegExp(`^${text}$`) }).waitFor()
    assert.equal(await locator.textContent(), text)
  }
  const showRuntime = async () => assertVisibleInDetails(card.getByRole('region', { name: '运行正文', exact: true }))
  // The operation protects the underlying editor. Camera controls are independent
  // once the preview is closed, and must not save a content revision.
  assert.equal(await card.evaluate(element => element.inert), true)
  assert.equal(await execute().isEnabled(), true)
  await closePrecheck(page)
  const layoutRevision = (await (await fetch(`${base}/${canvas.id}`)).json()).data.revision
  await page.getByRole('button', { name: '放大', exact: true }).click()
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.revision, layoutRevision)
  // After closing the operation, changed content cannot run if its save fails.
  let submitCount = 0, connections = 0
  page.on('request', request => { if (/\/events(?:\?|$)/.test(request.url())) connections++ })
  page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/runs')) submitCount++ })
  await page.route(`**/generation-canvases/${canvas.id}?project_id=`, route => route.request().method() === 'PUT' ? route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 'error', message: 'validation', data: { code: 'CONTROLLED_SAVE_FAILURE', message: '受控保存失败', target: {}, blocks: ['save'] } }) }) : route.continue())
  await prompt.fill('编辑后的提示词')
  assert.equal(await preview.isVisible(), false)
  // A failed save cannot run the previously saved content.
  await precheck().click()
  await page.getByRole('alert').filter({ hasText: 'CONTROLLED_SAVE_FAILURE' }).waitFor()
  assert.equal(await preview.isVisible(), false)
  assert.equal(submitCount, 0)
  await page.unroute(`**/generation-canvases/${canvas.id}?project_id=`)
  // A late response for an older edit never restores execute eligibility.
  let releasePreview, enteredPreview
  const entered = new Promise(resolve => { enteredPreview = resolve })
  await page.route(`**/generation-canvases/${canvas.id}/precheck?project_id=`, async route => {
    const response = await route.fetch()
    enteredPreview()
    await new Promise(resolve => { releasePreview = resolve })
    await route.fulfill({ response })
  })
  await precheck().click(); await entered
  await prompt.fill('固定输入正文')
  releasePreview()
  await precheck().waitFor()
  await page.unroute(`**/generation-canvases/${canvas.id}/precheck?project_id=`)
  assert.equal(await preview.isVisible(), false, 'stale precheck is discarded')
  await precheck().click(); await preview.waitFor()
  assert.equal(await page.getByRole('region', { name: '实际提交文本' }).textContent(), '固定输入正文')
  const savedRevision = (await (await fetch(`${base}/${canvas.id}`)).json()).data.revision
  // Drop a committed submission response; verification replays the exact request.
  const submissions = []
  let drop = true
  await page.route(`**/generation-canvases/${canvas.id}/runs?project_id=`, async route => {
    submissions.push(route.request().postDataJSON())
    const response = await route.fetch()
    if (drop) { drop = false; await route.abort('failed') } else await route.fulfill({ response })
  })
  await execute().click()
  await closePrecheck(page)
  await page.getByRole('button', { name: '核实运行请求', exact: true }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段')
  assert.equal(await card.getByRole('region', { name: '当前正式输出' }).count(), 0)
  await openSummaryMenu(sourceSummary)
  assert.equal(await sourceSummary.getByRole('button', { name: '删除卡片', exact: true }).isDisabled(), true)

  assert.equal(await page.getByRole('button', { name: '删除画布', exact: true }).isDisabled(), true)
  assert.equal((await control()).calls.length, 1)
  assert.equal((await control()).calls[0].text, '固定输入正文')
  await page.reload()
  await openCanvasCard(page, 'm')
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段')
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '核实运行请求', exact: true }).click()
  await page.getByRole('button', { name: '核实运行请求', exact: true }).waitFor({ state: 'detached' })
  await openCanvasCard(page, 'm')
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
  await openCanvasCard(page, 'm')
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  assert.equal((await control()).calls.length, 1)
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.revision, savedRevision, 'runtime increments never save the document')
  await control({ release: 2 })
  await runStatus('已完成').waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段第三段')
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }).locator('.canvas-text-preview > p'), '第一段第二段第三段')
  assert.equal((await control()).calls.length, 1)
  await openCanvasCard(page, 'consumer')
  assert.equal(await card.getByRole('button', { name: '@文本1', exact: true }).isEnabled(), true, 'published model output becomes a real downstream reference candidate')
  await openCanvasCard(page, 'm')
  // A later run shares this canvas connection; failure preserves previous official output.
  const connectionsBeforeSecondRun = connections
  await control({ release: 0, fail_next: true })
  await precheck().click(); await execute().click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor({ state: 'hidden' })
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段')
  // Editing remains available while a fixed execution is in progress.
  await prompt.fill('运行期间的后续编辑')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await control({ release: 2 })
  await runStatus('失败 · 未完成').waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }).locator('.canvas-text-preview > p'), '第一段第二段第三段')
  assert.equal((await control()).calls.length, 2)
  await openSummaryMenu(sourceSummary)
  assert.equal(await sourceSummary.getByRole('button', { name: '删除卡片', exact: true }).isEnabled(), true, 'terminal failure releases card activity guard')

  assert.equal(await page.getByRole('button', { name: '删除画布', exact: true }).isEnabled(), true, 'terminal failure releases canvas activity guard')
  assert.equal(await prompt.textContent(), '运行期间的后续编辑')
  assert.equal((await control()).calls[1].text, '固定输入正文', 'accepted run keeps the frozen input')
  assert.equal(connections, connectionsBeforeSecondRun, 'completed run keeps the shared SSE connection open')
  await showRuntime()
  await page.screenshot({ path: join(output, 'runtime-failure.png'), fullPage: true })
  await page.reload()
  await openCanvasCard(page, 'm')
  await runStatus('失败 · 未完成').waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  assert.equal((await control()).calls.length, 2)
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }).locator('.canvas-text-preview > p'), '第一段第二段第三段')
  await card.getByText('依据已变，旧正式输出仍保留', { exact: true }).waitFor()
  // Structured precheck diagnostics locate the actual offending card.
  await openCanvasCard(page, 'consumer')
  assert.equal(await card.getByRole('button', { name: '预检运行', exact: true }).isDisabled(), true, 'empty input is explained before submission')
  const beforeDiagnostic = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const diagnosticCards = beforeDiagnostic.document.cards.map(item => item.id === 'consumer'
    ? { ...item, model_id: null, prompt: { segments: [{ id: 'diagnostic', kind: 'text', text: '定位诊断用正文' }] } }
    : item)
  const diagnosticSave = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    request_id: 'missing-model-fixture', expected_revision: beforeDiagnostic.revision, document: { ...beforeDiagnostic.document, cards: diagnosticCards },
  }) })
  assert.ok(diagnosticSave.ok, await diagnosticSave.text())
  await page.reload()
  await openCanvasCard(page, 'consumer')
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  const diagnostic = preview.getByRole('alert').filter({ hasText: 'MODEL_REQUIRED' })
  await diagnostic.waitFor()
  assert.equal(await execute().isDisabled(), true)
  await diagnostic.getByRole('button', { name: '定位问题', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  assert.equal(await card.getByRole('textbox', { name: '模型正文', exact: true }).textContent(), '定位诊断用正文', 'diagnostic opens the offending consumer detail')
  assert.equal((await control()).calls.length, 2, 'precheck diagnostics never start generation')
  await page.goto('http://127.0.0.1:4276/projects/canvas-project?tab=dashboard')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  const task = page.locator('.app-task-card').filter({ hasText: '流式文本' }).first()
  await task.getByRole('button', { name: /查看/ }).click()
  await page.waitForURL(url => url.pathname === '/canvases/' + canvas.id && url.searchParams.has('run') && url.searchParams.has('node'))
  await openCanvasCard(page, 'm')
  await runStatus('失败 · 未完成').waitFor()
  console.log(JSON.stringify({ output, success: true, calls: (await control()).calls.length }))
} catch (reason) {
  if (page) { console.log((await page.locator('body').innerText()).slice(-9000)); await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }) }
  throw reason
} finally { await cleanup() }
