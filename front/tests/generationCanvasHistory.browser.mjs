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
const output = await browserOutput('jellyfish-generation-canvas-history-')
const api = 'http://127.0.0.1:8277', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8277' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4277, strictPort: true, open: false, proxy: { '/api': api } } })
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
  await page.goto(`http://127.0.0.1:4277/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = page.locator('[data-card-id="m"]'), consumer = page.locator('[data-card-id="consumer"]')
  const historyToggle = page.getByRole('button', { name: '运行历史', exact: true })
  const history = page.getByRole('region', { name: '画布运行历史', exact: true })
  const control = async body => (await fetch(`${api}/test/runtime-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const runtime = async () => (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  const waitText = async (locator, text) => { await locator.filter({ hasText: new RegExp(`^${text}$`) }).waitFor(); assert.equal(await locator.textContent(), text) }
  const startRun = async () => {
    if (await history.count()) await historyToggle.click()
    await card.getByRole('button', { name: '预检运行', exact: true }).click()
    const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
    await page.getByRole('region', { name: '运行预检' }).getByRole('button', { name: '确认执行', exact: true }).click()
    const receipt = (await (await accepted).json()).data
    await waitText(card.locator(`[data-run-id="${receipt.run_id}"]`).getByRole('region', { name: '运行正文', exact: true }), '第一段')
    return (await runtime()).runs.find(run => run.id === receipt.run_id)
  }
  const showRun = async run => {
    if (!await history.count()) await historyToggle.click()
    const record = history.locator(`[data-history-run="${run.id}"]`)
    if (!await record.evaluate(element => element.open)) await record.locator('summary').first().click()
    return record
  }
  await historyToggle.click(); await history.waitFor()
  await page.getByText('尚无运行记录', { exact: true }).waitFor()
  // Observe duplicate text envelopes, disconnect, expire the replay log and finish
  // while disconnected. Recovery must replace from the real authoritative snapshot.
  let blockedReconnect = true
  const first = await startRun()
  await control({ duplicate_next: true, release: 1 })
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  await page.route(`**/generation-canvases/canvas-project/${canvas.id}/events/connection`, route => blockedReconnect ? route.abort('failed') : route.continue())
  await control({ disconnect: true })
  await page.getByRole('status', { name: '运行连接', exact: true }).filter({ hasText: '运行连接恢复中' }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段')
  await control({ release: 2 })
  let completed
  for (let attempt = 0; attempt < 100; attempt++) {
    completed = await runtime()
    if (completed.runs[0].lifecycle === 'finished') break
    await delay(30)
  }
  assert.equal(completed.runs[0].nodes[0].status, 'succeeded')
  await control({ expire_events: true })
  blockedReconnect = false
  await page.unroute(`**/generation-canvases/canvas-project/${canvas.id}/events/connection`)
  await card.getByRole('status').filter({ hasText: '已完成' }).waitFor()
  await waitText(card.getByRole('region', { name: '运行正文', exact: true }), '第一段第二段第三段')
  assert.equal((await control()).calls.length, 1)
  assert.ok((await control()).stream_connections >= 2)
  let record = await showRun(first)
  await record.getByText('本次实际输入与模型参数', { exact: true }).click()
  assert.equal(await record.getByRole('region', { name: '历史实际输入', exact: true }).textContent(), '原始提示词')
  assert.equal((await record.textContent()).includes('fixture-private'), false)
  // Lost cancellation acknowledgement preserves occupancy and the real pending
  // cancellation state, including across refresh, until the worker reaches terminal.
  await control({ release: 0 })
  const second = await startRun()
  record = await showRun(second)
  await page.route(`**/runs/${second.id}/nodes/${second.nodes[0].id}/cancel`, async route => { await route.fetch(); await route.abort('failed') })
  await record.getByRole('button', { name: '取消此节点', exact: true }).click()
  await record.getByRole('status').filter({ hasText: '取消中，等待任务终态' }).waitFor()
  await page.getByRole('alert').filter({ hasText: '取消请求结果未知' }).waitFor()
  assert.equal((await runtime()).runs.at(-1).lifecycle, 'active')
  assert.equal(await card.getByRole('button', { name: '删除卡片', exact: true }).isDisabled(), true)
  assert.equal(await record.getByText('已取消 · 未完成', { exact: true }).count(), 0)
  await page.reload()
  record = await showRun(second)
  await record.getByRole('status').filter({ hasText: '取消中，等待任务终态' }).waitFor()
  assert.equal((await control()).calls.length, 2)
  await control({ release: 2 })
  await record.getByRole('status').filter({ hasText: '已取消 · 未完成' }).waitFor()
  await waitText(record.getByRole('region', { name: '历史累计正文', exact: true }).locator('p').first(), '第一段')
  // Whole-run cancellation has its own explicit target and still waits for terminal.
  await control({ release: 0 })
  const third = await startRun()
  record = await showRun(third)
  await record.getByRole('button', { name: '取消本轮运行', exact: true }).click()
  await record.getByRole('status').filter({ hasText: '取消中，等待任务终态' }).waitFor()
  assert.equal((await runtime()).runs.at(-1).lifecycle, 'active')
  await control({ release: 2 })
  await record.getByRole('status').filter({ hasText: '已取消 · 未完成' }).waitFor()
  assert.equal((await control()).calls.length, 3)
  await waitText(card.getByRole('region', { name: '当前正式输出', exact: true }), '第一段第二段第三段')
  // Save a validated independent copy while editing continues during DTO loading.
  record = await showRun(second)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await record.getByRole('button', { name: '复制正文', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '第一段')
  let enteredCopy, releaseCopy
  const entered = new Promise(resolve => { enteredCopy = resolve })
  await page.route(`**/runs/${second.id}/nodes/${second.nodes[0].id}/outputs/0/content`, async route => {
    const response = await route.fetch(); enteredCopy()
    await new Promise(resolve => { releaseCopy = resolve }); await route.fulfill({ response })
  })
  await record.getByRole('button', { name: '另存为文本内容卡', exact: true }).click(); await entered
  await card.getByRole('textbox', { name: '模型正文', exact: true }).fill('请求期间的后续编辑')
  releaseCopy()
  await history.getByRole('status').filter({ hasText: '已另存为独立内容卡' }).waitFor()
  const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const copy = saved.document.cards.find(item => item.origin)
  assert.equal(saved.document.cards.find(item => item.id === 'm').prompt.segments[0].text, '请求期间的后续编辑')
  assert.equal(copy.text, '第一段')
  assert.deepEqual(copy.origin, { canvas_id: canvas.id, run_id: second.id, node_id: second.nodes[0].id, position: 0, incomplete: true })
  assert.equal((await runtime()).current_outputs.m[0].text, '第一段第二段第三段')
  await historyToggle.click()
  await consumer.getByRole('combobox', { name: '连接已有卡', exact: true }).locator('..').locator('..').click()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText(`${copy.id.slice(0, 8)} → 文本`, { exact: true }).click()
  await consumer.getByRole('button', { name: '@文本2', exact: true }).click()
  const prompt = consumer.getByRole('textbox', { name: '模型正文', exact: true })
  assert.equal(JSON.parse(await prompt.locator('[data-segment]').getAttribute('data-segment')).source.card_id, copy.id)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  // Removed editable source cards do not remove history or the task's historical target.
  await card.getByRole('button', { name: '删除卡片', exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal(await card.count(), 0)
  await page.goto('http://127.0.0.1:4277/projects/canvas-project?tab=dashboard')
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.locator('.app-task-card').filter({ hasText: '流式文本' }).first().getByRole('button', { name: /查看/ }).click()
  await page.waitForURL(url => url.searchParams.get('canvas') === canvas.id && url.searchParams.get('run') === third.id && url.searchParams.get('node') === third.nodes[0].id)
  const targeted = history.locator(`[data-history-node="${third.nodes[0].id}"]`)
  await targeted.getByRole('status').filter({ hasText: '已取消 · 未完成' }).waitFor()
  assert.equal(await card.count(), 0)
  assert.equal(await page.evaluate(() => document.activeElement.dataset.historyNode), third.nodes[0].id)
  assert.equal((await control()).calls.length, 3)
  await page.getByRole('dialog', { name: '任务中心', exact: true }).waitFor({ state: 'hidden' })
  await targeted.getByText('本次实际输入与模型参数', { exact: true }).click()
  await page.screenshot({ path: join(output, 'removed-source-history.png'), fullPage: true })
  console.log(JSON.stringify({ output, success: true, providerCalls: 3 }))
} catch (reason) {
  if (page) { console.log((await page.locator('body').innerText()).slice(-9000)); await page.screenshot({ path: join(output, 'failure.png'), fullPage: true }) }
  throw reason
} finally { await cleanup() }
