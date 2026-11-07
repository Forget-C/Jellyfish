import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-check-model-')
const api = 'http://127.0.0.1:8311'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const json = { 'Content-Type': 'application/json' }
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8311' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  for (let attempt = 0; ; attempt++) {
    assert.ok(attempt < 80 && backend.exitCode === null, 'isolated backend ready')
    try { if ((await fetch(base)).ok) break } catch {}
    await delay(250)
  }
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'),
    server: { host: '127.0.0.1', port: 4311, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '独立文字检查' }) })).json()).data
  const canvasUrl = `${base}/${canvas.id}`
  const document = { ...canvas.document, cards: [
    { id: 'shot', type: 'direction.shot', estimated_duration: { text: '12 秒', state: 'proposal' },
      visible_result: { text: '保留灯光', state: 'fact' } },
    { id: 'target', type: 'model.video', config: { seconds: 5 } },
    { id: 'check', type: 'review.check' },
  ], edges: [
    { id: 'adopt', source_card: 'shot', source_port: 'text', target_card: 'target', target_port: 'text' },
    { id: 'observe', source_card: 'target', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { target: { text: ['adopt'] }, check: { check_basis: ['observe'] } } }
  const seed = await fetch(canvasUrl, { method: 'PUT', headers: json, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.text())
  await page.goto(`http://127.0.0.1:4311/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  await openCanvasCard(page, 'check')
  const editor = page.getByRole('region', { name: '生成前检查', exact: true })
  await editor.getByText('暂不可执行 · 请选择独立的文字检查模型', { exact: true }).waitFor()
  await editor.getByRole('combobox', { name: '文字检查模型' }).click()
  await page.locator('.ant-select-dropdown:visible').getByText('controlled-text', { exact: true }).click()
  await closeCanvasDetails(page)
  const saved = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith(canvas.id))
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  assert.ok((await saved).ok())
  const state = await (await fetch(canvasUrl)).json()
  assert.equal(state.data.document.cards.find(card => card.id === 'check').check_model_id, 'canvas-runtime-text')
  await page.reload()
  await openCanvasCard(page, 'check')
  await editor.getByText('controlled-text', { exact: true }).waitFor()
  await editor.getByRole('button', { name: '检查', exact: true }).click()
  const report = page.getByRole('region', { name: '检查报告', exact: true })
  const statuses = report.getByRole('list', { name: '模型检查执行状态' })
  await statuses.getByText(/排队中|检查中/).first().waitFor()
  await report.getByText('风险建议', { exact: true }).waitFor()
  const controlUrl = `${api}/test/runtime-controls`
  await fetch(controlUrl, { method: 'POST', headers: json, body: JSON.stringify({ check_release: true }) })
  await statuses.getByText(/执行失败/).waitFor()
  await report.getByText('保留灯光', { exact: true }).waitFor()
  await statuses.getByRole('button', { name: '重新检查此项', exact: true }).click()
  await report.getByText(/单项检查/).waitFor()
  await report.getByText('12 秒', { exact: true }).waitFor()
  const { check_calls: calls } = await (await fetch(controlUrl)).json()
  assert.equal(calls.length, 3)
  assert.equal(calls.filter(field => field === 'visible_result').length, 1)
  assert.equal(calls.filter(field => field === 'estimated_duration').length, 2)
  const history = await (await fetch(`${canvasUrl}/checks/check/reports`)).json()
  assert.equal(history.data.length, 2)
  assert.equal(history.data[1].results.length, 2)
  assert.ok(history.data[1].executions.some(execution => execution.status === 'failed'))
  console.log('check model selection, queued/rule results, partial failure and single-item retry passed')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
