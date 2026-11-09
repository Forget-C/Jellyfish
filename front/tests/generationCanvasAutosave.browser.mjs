import { openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
import { openCanvasManagement, openCardList } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8271'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8271' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4271, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(10000)
  const create = async name => (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) })).json()).data
  const read = async id => (await (await fetch(`${base}/${id}`)).json()).data
  const canvas = await create('持续编辑')
  await page.goto(`http://127.0.0.1:4271/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await openCardList(page)
  await page.getByRole('button', { name: '文本卡' }).click()
  const text = page.getByRole('textbox', { name: '文本内容', exact: true })
  // Input never pauses for a second: a saved intermediate value proves periodic coalescing.
  for (let index = 0; index < 7; index++) {
    await text.fill(`持续输入 ${index}`)
    await delay(250)
  }
  const during = await read(canvas.id)
  assert.ok(during.revision > 0, 'continuous input saves within about one second')
  assert.match(during.document.cards[0].text, /持续输入/)
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const settled = await read(canvas.id)
  await delay(1500)
  assert.equal((await read(canvas.id)).revision, settled.revision, 'idle canvas sends no redundant saves')
  // Invalid input stays visible, and an unchanged rejected document is not retried each tick.
  let rejected = 0
  page.on('response', response => { if (response.request().method() === 'PUT' && response.status() === 422) rejected++ })
  const invalid = page.waitForResponse(response => response.request().method() === 'PUT' && response.status() === 422)
  await openCanvasManagement(page)
  await page.getByRole('textbox', { name: '画布名称' }).fill('')
  await invalid
  await delay(2300)
  assert.equal(rejected, 1, 'same invalid document is attempted only once automatically')
  assert.equal(await text.inputValue(), '持续输入 6')
  await openCanvasManagement(page)
  await page.getByRole('textbox', { name: '画布名称' }).fill('已纠正')
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  // A delayed save keeps one network request active and coalesces B/C into latest C.
  const commands = []
  let release, arrived
  const gate = new Promise(resolve => { release = resolve })
  const firstArrived = new Promise(resolve => { arrived = resolve })
  let active = 0, maximum = 0
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    active++; maximum = Math.max(maximum, active)
    commands.push(route.request().postDataJSON())
    if (commands.length === 1) { arrived(); await gate }
    const response = await route.fetch()
    await route.fulfill({ response }); active--
  })
  await text.fill('在途快照 A')
  await page.getByRole('button', { name: '保存画布' }).click()
  await firstArrived
  await text.fill('中间编辑 B')
  await text.fill('最新编辑 C')
  await delay(1300)
  assert.equal(commands.length, 1)
  release()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.equal(maximum, 1, 'canvas saves are serialized')
  assert.deepEqual(commands.map(command => command.document.cards[0].text), ['在途快照 A', '最新编辑 C'])
  assert.equal(await text.inputValue(), '最新编辑 C', 'old receipt cannot replace local edits')
  await page.unroute(`**/generation-canvases/canvas-project/${canvas.id}`)
  // A lost reply is retried with exactly the original identity before newer edits are saved.
  let unknown
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    unknown = route.request().postDataJSON(); await route.fetch(); await route.abort('failed')
  })
  await text.fill('丢失回执的保存')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('alert').getByText('请求结果未知，请重试核实原请求', { exact: true }).waitFor()
  const verified = []
  await page.unroute(`**/generation-canvases/canvas-project/${canvas.id}`)
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}`, async route => {
    if (route.request().method() === 'PUT') verified.push(route.request().postDataJSON())
    await route.continue()
  })
  await text.fill('未知回执之后的新编辑')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.deepEqual(verified[0], unknown, 'retry verifies original command before new save intent')
  assert.equal((await read(canvas.id)).document.cards[0].text, '未知回执之后的新编辑')
  await page.unroute(`**/generation-canvases/canvas-project/${canvas.id}`)
  const downstream = await create('保存后下游刷新')
  const document = { ...downstream.document, cards: [
    { id: 'source', type: 'content.text', text: '原已保存来源' },
    { id: 'm', type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: [{ id: 'ref', kind: 'reference', binding_id: 'adopted' }] }, input_bindings: [{ id: 'adopted', input_port: 'text', source: { canvas_id: downstream.id, card_id: 'source', port_id: 'text', position: 0 } }], config: {} },
  ], edges: [{ id: 'edge', source_card: 'source', source_port: 'text', target_card: 'm', target_port: 'text' }], input_order: { m: { text: ['edge'] } } }
  const seed = await fetch(`${base}/${downstream.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  await page.goto(`http://127.0.0.1:4271/projects/canvas-project/generation-canvas?canvas=${downstream.id}`)
  const open = async id => { await page.locator(`[data-card-id="${id}"]`).press('Enter'); await page.locator('.wb-details:not([hidden])').waitFor(); await openModelInspection(page) }
  await open('m')
  const adopted = page.getByRole('region', { name: '已保存直接输入' })
  await adopted.getByText('原已保存来源', { exact: true }).waitFor()
  assert.match(await adopted.textContent(), /已采用/)
  await open('source')
  await text.fill('编辑后的直接来源')
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await open('m')
  await adopted.getByText('编辑后的直接来源', { exact: true }).waitFor()
  await open('source'); await text.fill('')
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await open('m')
  await adopted.getByText(/OUTPUT_MISSING/).waitFor()
  assert.equal((await read(downstream.id)).document.cards[1].input_bindings.length, 1, 'empty output retains the actual binding and a saved diagnostic')
  // An older output response arrives after a later revision has refreshed this same model.
  let releaseOutput, outputArrived
  const outputGate = new Promise(resolve => { releaseOutput = resolve })
  const outputStarted = new Promise(resolve => { outputArrived = resolve })
  let held = false
  await page.route(`**/generation-canvases/canvas-project/${downstream.id}/cards/m/outputs`, async route => {
    if (held) return route.continue()
    held = true
    const response = await route.fetch()
    outputArrived(); await outputGate; await route.fulfill({ response })
  })
  await open('source'); await text.fill('旧响应中的正文')
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await open('m'); await outputStarted
  await openCanvasManagement(page)
  await page.getByRole('textbox', { name: '画布名称' }).fill('触发较新修订')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await adopted.getByText('旧响应中的正文', { exact: true }).waitFor()
  const newest = await read(downstream.id)
  releaseOutput(); await delay(250)
  assert.match(await adopted.textContent(), new RegExp(`已保存 revision ${newest.revision}`), 'late response never replaces newer revision')
  await page.unroute(`**/generation-canvases/canvas-project/${downstream.id}/cards/m/outputs`)
  const preserved = await read(downstream.id)
  assert.equal(preserved.document.cards[1].input_bindings.length, 1, 'refresh preserves actual adoption')
  // Real runtime publication stays independent from document saves and output refresh.
  await fetch(`${api}/test/runtime-controls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: 2 }) })
  const preview = (await (await fetch(`${base}/${downstream.id}/precheck`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ card_id: 'm' }) })).json()).data
  assert.equal(preview.can_run, true)
  const submitted = await fetch(`${base}/${downstream.id}/runs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'explicit-run', preview_token: preview.preview_token }) })
  assert.ok(submitted.ok, await submitted.text())
  const formal = page.getByLabel('当前正式输出', { exact: true })
  await formal.getByText('第一段第二段第三段', { exact: true }).waitFor()
  await open('source'); await text.fill('运行完成后的后续编辑')
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await open('m')
  await formal.getByText('依据已变，旧正式输出仍保留', { exact: true }).waitFor()
  assert.equal((await (await fetch(`${base}/${downstream.id}/runtime`)).json()).data.runs.length, 1, 'editing does not generate or replace history')
  // Precheck flushes local changes immediately, without waiting for a periodic tick.
  const changed = page.getByRole('textbox', { name: '模型正文', exact: true })
  await changed.fill('立即预检的最新输入')
  const precheckReply = page.waitForResponse(response => response.url().endsWith('/precheck'))
  await page.getByRole('button', { name: '预检运行', exact: true }).click()
  await precheckReply
  assert.match(JSON.stringify((await read(downstream.id)).document.cards[1].prompt), /立即预检的最新输入/)
  const after = await read(downstream.id)
  assert.equal(after.document.cards[1].input_bindings.length, 0, 'explicitly replacing prompt removes its adopted reference')
  assert.equal((await (await fetch(`${base}/${downstream.id}/runtime`)).json()).data.runs.length, 1, 'saving never triggers another generation')
  await page.getByRole('dialog').getByLabel('Close', { exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.screenshot({ path: join(output, 'autosave-1440.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await delay(250)
  await page.screenshot({ path: join(output, 'autosave-390.png'), fullPage: true })
  console.log('PASS periodic save, rejection pause, serial coalescing, unknown receipt, saved input refresh, stale response and precheck flush')
} finally { await cleanup() }
