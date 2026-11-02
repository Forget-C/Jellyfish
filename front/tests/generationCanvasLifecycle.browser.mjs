import { openCanvasManagement, openCardList, openSummaryMenu } from './generationCanvasWorkbench.browser-helpers.mjs'
import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-lifecycle-')
const api = 'http://127.0.0.1:8282', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8282' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4282, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const json = { 'Content-Type': 'application/json' }
  const canvas = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '删除与历史保留' }) })).json()).data
  const url = `${base}/${canvas.id}`
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'body', kind: 'text', text: '图片生成' }] }, config: { count: 3 } },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: { count: 1 } }],
    edges: [{ id: 'edge', source_card: 'm', source_port: 'image', target_card: 'consumer', target_port: 'image' }], input_order: { consumer: { image: ['edge'] } } }
  assert.ok((await fetch(url, { method: 'PUT', headers: json, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })).ok)
  await page.goto(`http://127.0.0.1:4282/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const source = page.locator('[data-card-id="m"]')
  const card = await openCanvasCard(page, 'm')
  await card.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('region', { name: '运行预检', exact: true }).getByRole('button', { name: '确认执行', exact: true }).click()
  await card.getByRole('region', { name: '当前正式输出', exact: true }).getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  const runtime = (await (await fetch(url + '/runtime')).json()).data
  const fileId = runtime.current_outputs.m[0].file_id
  const other = (await (await fetch(base, { method: 'POST', headers: json, body: JSON.stringify({ name: '独立使用者' }) })).json()).data
  other.document.cards = [{ id: 'independent', type: 'content.image', file_id: fileId }]
  assert.ok((await fetch(`${base}/${other.id}`, { method: 'PUT', headers: json, body: JSON.stringify({ request_id: 'retain', expected_revision: 0, document: other.document }) })).ok)
  await openCanvasCard(page, 'consumer')
  const inputs = card.getByRole('region', { name: '已保存直接输入', exact: true })
  await inputs.getByRole('button', { name: '采用 @图片1', exact: true }).click()
  let response = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/' + canvas.id))
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  assert.equal((await response).status(), 200)
  await openSummaryMenu(source)
  await source.getByRole('button', { name: '删除卡片', exact: true }).press('Enter')
  await page.getByRole('status').filter({ hasText: '先清理' }).waitFor()
  assert.equal(await source.count(), 1)
  await page.screenshot({ path: join(output, 'reference-blocks-deletion.png'), fullPage: true })
  const writes = []
  const onRequest = request => { if (request.method() === 'PUT' && request.url().endsWith('/' + canvas.id)) writes.push(request.postDataJSON()) }
  page.on('request', onRequest)
  await inputs.getByRole('button', { name: '取消采用 @图片1', exact: true }).click()
  await openSummaryMenu(source)
  await source.getByRole('button', { name: '删除卡片', exact: true }).press('Enter')
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await source.waitFor({ state: 'detached' })
  response = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/' + canvas.id))
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  assert.equal((await response).status(), 200)
  page.off('request', onRequest)
  assert.equal(writes.length, 1, 'reference cleanup and source deletion share one final-document save')
  const saved = (await (await fetch(url)).json()).data
  assert.deepEqual(saved.document.cards.map(card => card.id), ['consumer'])
  assert.deepEqual(saved.document.edges, [])
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const history = page.getByRole('region', { name: '画布运行历史', exact: true })
  await history.locator('summary').first().click()
  await history.getByRole('img', { name: '图片预览', exact: true }).first().waitFor()
  assert.equal(await history.getByRole('img', { name: '图片预览', exact: true }).first().evaluate(image => image.complete && image.naturalWidth === 240), true)
  await page.screenshot({ path: join(output, 'deleted-card-history-readable.png'), fullPage: true })
  const deleteCanvas = async () => {
    await closeCanvasDetails(page)
    await openCanvasManagement(page)
    await page.getByRole('button', { name: '删除画布', exact: true }).click()
    await page.getByRole('button', { name: /确\s*定/ }).click()
  }
  // A server failure cannot claim cleanup; verification confirms the canvas still exists.
  await page.route('**/api/v1/studio/generation-canvases/canvas-project/' + canvas.id, async route => {
    if (route.request().method() === 'DELETE') await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
    else await route.continue()
  })
  await deleteCanvas()
  await page.getByRole('button', { name: '核实画布状态', exact: true }).click()
  await page.getByText('画布仍存在；删除尚未完成，可重试', { exact: true }).waitFor()
  await page.unroute('**/api/v1/studio/generation-canvases/canvas-project/' + canvas.id)
  // A lost response after commit is resolved by reading the server, without recreating the canvas.
  await page.route('**/api/v1/studio/generation-canvases/canvas-project/' + canvas.id, async route => {
    if (route.request().method() === 'DELETE') { await route.fetch(); await route.abort('failed') }
    else await route.continue()
  })
  await deleteCanvas()
  await page.getByRole('button', { name: '核实画布状态', exact: true }).click()
  await page.getByText('创建或选择一张画布', { exact: true }).waitFor()
  assert.equal((await fetch(url)).status, 404)
  const details = (await (await fetch(`${api}/api/v1/studio/files/${fileId}`)).json()).data
  assert.deepEqual(details.usages.map(usage => usage.usage_kind), ['canvas_content'])
  assert.equal((await fetch(`${api}/api/v1/studio/files/${fileId}`, { method: 'DELETE' })).status, 409)
  await page.goto(`http://127.0.0.1:4282/projects/canvas-project?tab=generation&canvas=${other.id}`)
  await openCanvasCard(page, 'independent')
  const retained = card.getByRole('img', { name: '图片预览', exact: true })
  await retained.waitFor()
  assert.equal(await retained.evaluate(image => image.complete && image.naturalWidth === 240), true)
  await page.screenshot({ path: join(output, 'other-canvas-file-retained.png'), fullPage: true })
  // Upload retention survives deleting its card; explicit cleanup checks the saved content first.
  await openCardList(page)
  await page.getByRole('button', { name: '图片卡', exact: true }).click()
  const uploadedCardId = await page.locator('[data-card-id]').last().getAttribute('data-card-id')
  const uploadedSummary = page.locator(`[data-card-id="${uploadedCardId}"]`)
  const uploadedCard = card
  const uploadResponse = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/files/upload'))
  await uploadedCard.getByLabel('上传媒体文件').setInputFiles({ name: 'cleanup.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64') })
  const uploadedId = (await (await uploadResponse).json()).data.id
  await uploadedCard.getByRole('img', { name: '图片预览', exact: true }).waitFor()
  const saveOther = async () => {
    const response = page.waitForResponse(response => response.request().method() === 'PUT' && response.url().endsWith('/' + other.id))
    await page.getByRole('button', { name: '保存画布', exact: true }).click()
    assert.equal((await response).status(), 200)
  }
  await saveOther()
  await openCanvasCard(page, 'independent')
  const independent = card
  await independent.getByRole('button', { name: '选择素材', exact: true }).click()
  let modal = page.getByRole('dialog', { name: '项目文件库', exact: true })
  let cleanupRow = modal.getByText('cleanup', { exact: true }).locator('../..')
  await cleanupRow.getByRole('button', { name: '释放上传保留', exact: true }).click()
  await modal.getByRole('alert').filter({ hasText: '素材仍被业务使用' }).waitFor()
  await modal.getByRole('button', { name: 'Close', exact: true }).click()
  await modal.waitFor({ state: 'hidden' })
  await openSummaryMenu(uploadedSummary)
  await uploadedSummary.getByRole('button', { name: '删除卡片', exact: true }).press('Enter')
  await page.getByRole('button', { name: '确认删除', exact: true }).click()
  await uploadedSummary.waitFor({ state: 'detached' })
  await saveOther()
  await openCanvasCard(page, 'independent')
  await independent.getByRole('button', { name: '选择素材', exact: true }).click()
  modal = page.getByRole('dialog', { name: '项目文件库', exact: true })
  cleanupRow = modal.getByText('cleanup', { exact: true }).locator('../..')
  await page.route('**/files/' + uploadedId + '/upload-retention?*', async route => { await route.fetch(); await route.abort('failed') }, { times: 1 })
  await cleanupRow.getByRole('button', { name: '释放上传保留', exact: true }).click()
  await modal.getByRole('alert').filter({ hasText: '清理结果未确认' }).waitFor()
  await modal.getByRole('button', { name: '刷新项目文件', exact: true }).click()
  await modal.getByText('cleanup', { exact: true }).waitFor({ state: 'detached' })
  assert.deepEqual((await (await fetch(`${api}/api/v1/studio/files/${uploadedId}`)).json()).data.usages, [])
  assert.equal((await fetch(`${api}/api/v1/studio/files/${uploadedId}`, { method: 'DELETE' })).status, 200)
  console.log('reference guard → one final save → deleted-card history → failed and lost delete verification → other canvas file retention: verified')
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw error
} finally { await cleanup() }
