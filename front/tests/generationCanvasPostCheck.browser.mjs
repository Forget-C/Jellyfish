import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
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
const base = `${api}/api/v1/studio/generation-canvases`
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
  const canvas = await createStoryboardCanvas(base, '固定历史文字检查')
  const canvasUrl = storyboardCanvasApi(base, canvas.id)
  const controlUrl = `${api}/test/runtime-controls`
  const document = { ...canvas.document, cards: [
    { id: 'shot', type: 'direction.shot', visible_result: { text: '保留红伞', state: 'fact' } },
    { id: 'target', type: 'model.text', model_id: 'canvas-runtime-text' },
    { id: 'check', type: 'review.check', check_model_id: 'canvas-runtime-text' },
  ], edges: [
    { id: 'adopt', source_card: 'shot', source_port: 'text', target_card: 'target', target_port: 'text' },
    { id: 'observe', source_card: 'target', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { target: { text: ['adopt'] }, check: { check_basis: ['observe'] } } }
  await request(canvasUrl, 'PUT', { request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) })
  await request(controlUrl, 'POST', { release: 2 })
  const run = async (id, partial = false) => {
    if (partial) await request(controlUrl, 'POST', { fail_next: true })
    const preview = await request(storyboardCanvasApi(base, canvas.id, `/precheck`), 'POST', { card_id: 'target' })
    const run = await request(storyboardCanvasApi(base, canvas.id, `/runs`), 'POST', { request_id: id, preview_token: preview.preview_token })
    for (let attempt = 0; attempt < 40; attempt++) {
      const runtime = await request(storyboardCanvasApi(base, canvas.id, `/runtime`))
      const node = runtime.runs.find(row => row.id === run.run_id)?.nodes[0]
      if (node?.status === (partial ? 'failed' : 'succeeded')) return run
      await delay(100)
    }
    throw new Error('generation did not finish')
  }
  const original = await run('first')
  document.cards[0].visible_result.text = '换成蓝伞'
  await request(canvasUrl, 'PUT', { request_id: 'edit', expected_revision: 1, document: withFixedSource(canvas, document) })
  await run('partial', true)
  assert.deepEqual((await request(controlUrl)).check_calls, [])

  await page.goto(`http://127.0.0.1:4317${storyboardCanvasPath(canvas)}`)
  await openCanvasCard(page, 'check')
  const editor = page.locator('.generation-card-editor:visible')
  await editor.getByRole('tab', { name: '生成后检查', exact: true }).click()
  const panel = page.getByRole('region', { name: '生成后检查', exact: true })
  assert.equal(await editor.getByRole('button', { name: '检查所选产物', exact: true }).isDisabled(), true)
  const choose = async label => {
    await panel.locator('.ant-select').click()
    await page.locator('.ant-select-dropdown:visible').getByText(label).click()
  }
  await choose(/修订 1.*完整交付/)
  await panel.getByText('产物 1 份 · 文字模型检查 · 预计调用 1 次', { exact: true }).waitFor()
  await panel.locator('summary').filter({ hasText: '保留红伞' }).waitFor()
  const check = editor.getByRole('button', { name: '检查所选产物', exact: true })
  await check.click()
  await panel.getByRole('button', { name: '查看对应报告', exact: true }).last().click()
  const report = page.getByRole('region', { name: '检查报告', exact: true })
  await report.getByText('此结论仅适用于固定历史产物', { exact: true }).waitFor()
  await report.getByText('第一段第二段第三段', { exact: true }).filter({ visible: true }).waitFor()
  const history = await request(storyboardCanvasApi(base, canvas.id, `/checks/check/reports`))
  assert.equal(history[0].product.run_id, original.run_id)
  await editor.getByRole('tab', { name: '生成后检查', exact: true }).click()
  await choose(/修订 2.*生成失败/)
  await panel.getByText(/固定文字产物.*保留片段/).waitFor()
  assert.equal((await request(controlUrl)).check_calls.length, 1, 'changing selection does not call the model')
  await editor.getByRole('tab', { name: '检查记录', exact: true }).click()
  await report.getByRole('button', { name: '补充说明后重新检查', exact: true }).click()
  const lead = report.getByRole('textbox', { name: '本次复核说明', exact: true })
  await lead.fill('请重新核对原产物第三段')
  await report.getByRole('button', { name: '按原报告复核', exact: true }).click()
  await report.getByRole('button', { name: '查看最新报告', exact: true }).click()
  await report.getByText(/原报告复核 · /).click()
  await report.getByText('本次复核说明 请重新核对原产物第三段', { exact: true }).waitFor()
  await report.getByText('第一段第二段第三段', { exact: true }).filter({ visible: true }).waitFor()
  const afterReview = await request(storyboardCanvasApi(base, canvas.id, `/checks/check/reports`))
  assert.equal(afterReview[0].product.run_id, original.run_id)
  assert.equal(afterReview[0].recheck.report_id, history[0].id)
  assert.deepEqual(afterReview[1], history[0])
  await editor.getByRole('tab', { name: '生成后检查', exact: true }).click()
  await check.click()
  await panel.getByRole('button', { name: '查看对应报告', exact: true }).last().click()
  await report.getByText(/本次仅保留部分产物/).waitFor()
  assert.equal((await request(controlUrl)).check_calls.length, 3)
  console.log('historical text, one-shot pinned recheck, and retained partial text passed')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
