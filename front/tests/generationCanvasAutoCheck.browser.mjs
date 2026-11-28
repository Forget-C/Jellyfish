import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
import { openCanvasCard, closeCanvasDetails, prepareCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-auto-check-')
const api = 'http://127.0.0.1:8324', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8324', CANVAS_BROWSER_AUTO_CHECKS: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4324, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const headers = { 'Content-Type': 'application/json' }
  const request = async (url, method = 'GET', body) => {
    const response = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined })
    assert.ok(response.ok, await response.clone().text())
    const payload = await response.json()
    return payload.data ?? payload
  }
  const canvas = await createStoryboardCanvas(base, '完整交付后自动检查')
  const canvasUrl = storyboardCanvasApi(base, canvas.id)
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', config: { count: 3 } },
    { id: 'shot', type: 'direction.shot', visible_result: { state: 'fact', text: '保持红色背景' } },
    { id: 'check', type: 'review.check', check_model_id: 'auto-vision' },
  ], edges: [
    { id: 'adopt', source_card: 'shot', source_port: 'text', target_card: 'm', target_port: 'text' },
    { id: 'observe', source_card: 'm', source_port: 'check_basis', target_card: 'check', target_port: 'check_basis' },
  ], input_order: { m: { text: ['adopt'] }, check: { check_basis: ['observe'] } } }
  await request(canvasUrl, 'PUT', { request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) })
  await request(`${api}/test/image-controls`, 'POST', { response_delay: 3 })
  await page.goto(`http://127.0.0.1:4324${storyboardCanvasPath(canvas)}`)
  await openCanvasCard(page, 'check')
  await page.getByRole('tab', { name: '生成后检查', exact: true }).click()
  const editor = page.getByRole('region', { name: '生成后检查', exact: true })
  const enabled = editor.getByRole('switch', { name: '完整交付后自动检查', exact: true })
  await enabled.waitFor()
  assert.equal(await enabled.isChecked(), false)
  await enabled.check()
  await editor.getByRole('switch', { name: '静态摄影与风格落实', exact: true }).uncheck()
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  for (let attempt = 0; ; attempt++) {
    if ((await request(canvasUrl)).document.cards.find(card => card.id === 'check').auto_post_check) break
    assert.ok(attempt < 60, 'automatic configuration saved')
    await delay(100)
  }
  await openCanvasCard(page, 'm')
  await page.locator('.wb-details:visible').getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.getByRole('region', { name: '本次自动生成后检查', exact: true })
    .getByText(/产物 3 份 · 图片模型检查 · 预计调用 3 次/).waitFor()
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  await openCanvasCard(page, 'check')
  assert.deepEqual(await request(storyboardCanvasApi(base, canvas.id, `/checks/check/reports`)), [])
  await page.getByRole('tab', { name: '检查记录', exact: true }).click()
  const report = page.getByRole('region', { name: '检查报告', exact: true })
  await report.getByText('完整交付后自动检查', { exact: true }).waitFor()
  await report.getByText('仅核对当前固定图片', { exact: true }).waitFor()
  const reports = await request(storyboardCanvasApi(base, canvas.id, `/checks/check/reports`))
  assert.equal(reports.length, 3)
  assert.deepEqual(reports.map(row => row.product.position).sort(), [0, 1, 2])
  assert.ok(reports.every(row => row.automatic))
  assert.equal((await request(`${api}/test/image-controls`)).check_calls.length, 3)
  const selectedReportText = await report.getByRole('combobox', { name: '选择检查报告' }).evaluate(node => node.closest('.ant-select').querySelector('.ant-select-content-value')?.textContent)
  assert.ok(selectedReportText, 'a concrete automatic report is selected')
  await page.getByRole('tab', { name: '生成后检查', exact: true }).click()
  await editor.getByRole('combobox', { name: '历史产物' }).click()
  await page.locator('.ant-select-dropdown:visible').getByText(/位置 1$/).click()
  await page.locator('.generation-card-editor:visible').getByRole('button', { name: '重新检查所选产物', exact: true }).click()
  await page.getByRole('tab', { name: '检查记录', exact: true }).click()
  await report.getByRole('button', { name: '查看最新报告', exact: true }).waitFor()
  assert.equal(await report.getByRole('combobox', { name: '选择检查报告' }).evaluate(node => node.closest('.ant-select').querySelector('.ant-select-content-value')?.textContent), selectedReportText, 'first automatic report stays selected after another report arrives')

  const observedReport = reports.find(row => row.product.position === 1)
  const observeIssues = async route => {
    const response = await route.fetch()
    const payload = await response.json()
    payload.data = payload.data.map(row => row.product?.position === 0 || row.id === observedReport.id
      ? { ...row, results: row.results.map(result => ({ ...result, outcome: 'indeterminate' })) } : row)
    await route.fulfill({ response, json: payload })
  }
  const reportUrl = url => url.pathname.endsWith(`/${canvas.id}/checks/check/reports`)
  const fixedDownload = `**/files/${observedReport.product.file_id}/download`
  const missingFile = route => route.fulfill({ status: 404, body: 'fixture withdrawn' })
  await page.route(reportUrl, observeIssues)
  await page.route(fixedDownload, missingFile)
  await page.reload()
  await prepareCanvasCard(page, 'check')
  const navigationWrites = []
  const recordNavigationWrite = request => {
    if (request.url().includes(`/generation-canvases/${canvas.id}`) && !['GET', 'HEAD'].includes(request.method())) navigationWrites.push(request.url())
  }
  page.on('request', recordNavigationWrite)
  await page.locator('[data-card-id="check"]').getByRole('button', { name: '查看卡片问题' }).click()
  const issues = page.getByRole('region', { name: '卡片问题', exact: true })
  await issues.getByRole('listitem').filter({ hasText: /历史产物 1.*无法判断/ }).waitFor()
  await issues.getByRole('listitem').filter({ hasText: /历史产物 2.*无法判断/ })
    .getByRole('button', { name: '查看检查报告', exact: true }).click()
  await report.getByText('此结论仅适用于固定历史产物', { exact: true }).waitFor()
  const fixedProduct = report.getByText(/^固定图片产物 · 原生成修订/)
  await fixedProduct.click()
  await report.getByText(`固定文件 ${observedReport.product.file_id}`, { exact: true }).waitFor()
  await report.getByText(new RegExp(`运行 ${observedReport.product.run_id}.*位置 2`)).waitFor()
  await report.getByRole('img', { name: '图片预览' }).waitFor()
  await report.getByText('图片暂不可预览，文件仍保留', { exact: true }).waitFor()
  await page.unroute(fixedDownload, missingFile)
  await report.getByRole('button', { name: '查看整份报告', exact: true }).waitFor()
  await closeCanvasDetails(page)
  assert.deepEqual(navigationWrites, [], 'reading a specific product report does not execute or save')
  page.off('request', recordNavigationWrite)
  await page.unroute(reportUrl, observeIssues)

  const skipped = await createStoryboardCanvas(base, '已失效自动检查计划')
  const skippedUrl = storyboardCanvasApi(base, skipped.id)
  const skippedDocument = withFixedSource(skipped, { ...skipped.document, cards: document.cards.map(card => card.id === 'check' ? { ...card, auto_post_check: true } : card), edges: document.edges, input_order: document.input_order })
  await request(skippedUrl, 'PUT', { request_id: 'skip-seed', expected_revision: 0, document: skippedDocument })
  const skippedPreview = await request(storyboardCanvasApi(base, skipped.id, `/precheck`), 'POST', { card_id: 'm' })
  await request(storyboardCanvasApi(base, skipped.id, `/runs`), 'POST', { request_id: 'skip-run', preview_token: skippedPreview.preview_token })
  await request(skippedUrl, 'PUT', { request_id: 'disconnect', expected_revision: 1, document: { ...skippedDocument, edges: skippedDocument.edges.filter(edge => edge.id !== 'observe'), input_order: { ...skippedDocument.input_order, check: { check_basis: [] } } } })
  await request(skippedUrl, 'PUT', { request_id: 'reconnect', expected_revision: 2, document: skippedDocument })
  const reportReads = []
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith(`/${skipped.id}/checks/check/reports`)) reportReads.push(request.url()) })
  await page.goto(`http://127.0.0.1:4324${storyboardCanvasPath(skipped)}`)
  const expired = page.locator('[data-card-id="check"]').getByRole('button', { name: /自动报告待刷新/ })
  await expired.waitFor({ timeout: 45000 })
  assert.deepEqual(await request(storyboardCanvasApi(base, skipped.id, `/checks/check/reports`)), [], 'invalidated original automatic plan produces no report')
  const stoppedAt = reportReads.length
  await delay(1600)
  assert.equal(reportReads.length, stoppedAt, 'missing automatic reports do not poll indefinitely')
  console.log('automatic check preview, existing open editor updates, and three fixed products passed')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
