import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-post-check-')
const api = 'http://127.0.0.1:8317'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const json = { 'Content-Type': 'application/json' }
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8317' },
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
    server: { host: '127.0.0.1', port: 4317, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, headers: json, body: body ? JSON.stringify(body) : undefined })
    assert.ok(response.ok, await response.clone().text())
    const payload = await response.json()
    return payload.data ?? payload
  }
  const canvas = await request(base, 'POST', { name: '固定历史文字检查' })
  const canvasUrl = `${base}/${canvas.id}`
  const controlUrl = `${api}/test/runtime-controls`
  const document = { ...canvas.document, cards: [
    { id: 'shot', type: 'direction.shot', visible_result: { text: '保留红伞', state: 'fact' } },
    { id: 'target', type: 'model.text', model_id: 'canvas-runtime-text' },
    { id: 'check', type: 'review.check', check_model_id: 'canvas-runtime-text' },
  ], edges: [
    { id: 'adopt', source_card: 'shot', source_port: 'text', target_card: 'target', target_port: 'text' },
    { id: 'observe', source_card: 'target', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { target: { text: ['adopt'] }, check: { check_basis: ['observe'] } } }
  await request(canvasUrl, 'PUT', { request_id: 'seed', expected_revision: 0, document })
  await request(controlUrl, 'POST', { release: 2 })
  const run = async (id, partial = false) => {
    if (partial) await request(controlUrl, 'POST', { fail_next: true })
    const preview = await request(`${canvasUrl}/precheck`, 'POST', { card_id: 'target' })
    const run = await request(`${canvasUrl}/runs`, 'POST', { request_id: id, preview_token: preview.preview_token })
    for (let attempt = 0; attempt < 40; attempt++) {
      const runtime = await request(`${canvasUrl}/runtime`)
      const node = runtime.runs.find(row => row.id === run.run_id)?.nodes[0]
      if (node?.status === (partial ? 'failed' : 'succeeded')) return run
      await delay(100)
    }
    throw new Error('generation did not finish')
  }
  const original = await run('first')
  document.cards[0].visible_result.text = '换成蓝伞'
  await request(canvasUrl, 'PUT', { request_id: 'edit', expected_revision: 1, document })
  await run('partial', true)
  assert.deepEqual((await request(controlUrl)).check_calls, [])

  await page.goto(`http://127.0.0.1:4317/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  await openCanvasCard(page, 'check')
  const panel = page.getByRole('region', { name: '生成后文字检查', exact: true })
  assert.equal(await panel.getByRole('button', { name: '检查所选文字产物', exact: true }).count(), 0)
  const choose = async label => {
    await panel.locator('.ant-select-selector').click()
    await page.locator('.ant-select-dropdown:visible').getByText(label).click()
  }
  await choose(/修订 1.*完整交付/)
  await panel.getByText('产物 1 份 · 文字模型检查 · 预计调用 1 次', { exact: true }).waitFor()
  await panel.getByText(/来源 shot\/visible_result · 保留红伞/).waitFor()
  const check = panel.getByRole('button', { name: '检查所选文字产物', exact: true })
  await check.click()
  const report = page.getByRole('region', { name: '检查报告', exact: true })
  await report.getByText('此结论仅适用于固定历史产物', { exact: true }).waitFor()
  await report.getByText('第一段第二段第三段', { exact: true }).filter({ visible: true }).waitFor()
  const history = await request(`${canvasUrl}/checks/check/reports`)
  assert.equal(history[0].product.run_id, original.run_id)
  await choose(/修订 2.*生成失败/)
  await panel.getByText(/固定文字产物.*保留片段/).waitFor()
  assert.equal((await request(controlUrl)).check_calls.length, 1, 'changing selection does not call the model')
  await check.click()
  await report.getByText(/本次仅保留部分产物/).waitFor()
  assert.equal((await request(controlUrl)).check_calls.length, 2)
  console.log('explicit historical text selection, pinned evidence, and retained partial text passed')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
