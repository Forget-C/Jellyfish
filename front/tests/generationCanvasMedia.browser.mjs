import { openCanvasManagement, openCardList, openSummaryMenu } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-media-')
const api = 'http://127.0.0.1:8275'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8275' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4275, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await page.goto('http://127.0.0.1:4275/projects/canvas-project/generation-canvas')
  await openCanvasManagement(page)
  await page.getByRole('button', { name: '新建画布', exact: true }).click()

  await openCardList(page)
  await page.getByRole('button', { name: '添加图片卡', exact: true }).click()
  const card = page.locator('[data-card-id]').first()
  const detail = page.getByRole('complementary', { name: '图片内容卡', exact: true })
  const input = detail.getByLabel('上传媒体文件')
  const png = { name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64') }
  await page.route('**/api/v1/studio/files/upload', route => route.fulfill({ status: 500, body: '{}' }), { times: 1 })
  await input.setInputFiles(png)
  await page.getByText('上传失败，原文件已保留。请选择文件重试。').waitFor()
  assert.equal(await detail.locator('img[alt="图片预览"]').count(), 0)
  await input.setInputFiles(png)
  await detail.locator('img[alt="图片预览"]').waitFor()
  const original = await detail.locator('img[alt="图片预览"]').getAttribute('src')
  await page.route('**/api/v1/studio/files/upload', route => route.fulfill({ status: 500, body: '{}' }), { times: 1 })
  await input.setInputFiles({ ...png, name: 'replacement.png' })
  await page.getByText('上传失败，原文件已保留。请选择文件重试。').waitFor()
  assert.equal(await detail.locator('img[alt="图片预览"]').getAttribute('src'), original)
  await page.route('**/api/v1/studio/generation-canvases/**', async route => {
    if (route.request().method() === 'PUT') await route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ code: 422, message: '保存失败', data: { code: 'TEST_SAVE_FAILURE', severity: 'error', message: '保存失败', target: {}, blocks: ['save'] } }) })
    else await route.continue()
  })
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByText(/TEST_SAVE_FAILURE/).waitFor()
  await detail.getByRole('button', { name: '从项目文件选择', exact: true }).click()
  await page.getByRole('button', { name: '选用 first', exact: true }).click()
  assert.equal(await detail.locator('img[alt="图片预览"]').getAttribute('src'), original)
  await page.unroute('**/api/v1/studio/generation-canvases/**')
  let release
  const held = new Promise(resolve => { release = resolve })
  let uploadReached
  const reached = new Promise(resolve => { uploadReached = resolve })
  await page.route('**/api/v1/studio/files/upload', async route => {
    const response = await route.fetch()
    uploadReached()
    await held
    await route.fulfill({ response })
  }, { times: 1 })
  await input.setInputFiles({ ...png, name: 'late.png' })
  await reached
  await openSummaryMenu(card)
  await card.getByRole('button', { name: '删除卡片', exact: true }).press('Enter')
  release()
  await delay(250)
  assert.equal(await page.locator('[data-card-id]').count(), 0, 'late upload cannot revive removed card')
  const library = (await (await fetch(`${api}/api/v1/studio/files?project_id=canvas-project`)).json()).data.items
  assert.ok(library.some(file => file.name === 'late'), 'successful late upload remains in project library')
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', join(output, 'voice.wav')])
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=64x64:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', join(output, 'clip.mp4')])
  for (const [label, filename, mimeType, preview] of [
    ['添加音频卡', 'voice.wav', 'audio/wav', 'audio'], ['添加视频卡', 'clip.mp4', 'video/mp4', 'video'],
  ]) {
    await openCardList(page)
    await page.getByRole('button', { name: label, exact: true }).click()
    const mediaCard = page.getByRole('complementary', { name: label === '添加音频卡' ? '音频内容卡' : '视频内容卡', exact: true })
    await mediaCard.getByLabel('上传媒体文件').setInputFiles({ name: filename, mimeType, buffer: readFileSync(join(output, filename)) })
    await mediaCard.locator(preview).waitFor()
    assert.equal(await mediaCard.locator(preview).getAttribute('controls'), '')
    const src = await mediaCard.locator(preview).getAttribute('src')
    const bytes = await page.request.get(src)
    assert.equal(bytes.status(), 200)
    assert.equal(bytes.headers()['content-type'], mimeType)
    await mediaCard.locator(preview).evaluate(media => new Promise((resolve, reject) => {
      if (media.readyState >= 1) return resolve()
      media.onloadedmetadata = resolve
      media.onerror = () => reject(new Error('media could not load'))
    }))
    await mediaCard.locator(preview).evaluate(async media => { await media.play(); media.pause() })
    await mediaCard.getByRole('button', { name: '从项目文件选择', exact: true }).click()
    await page.getByRole('button', { name: `选用 ${filename.split('.')[0]}`, exact: true }).click()
    assert.equal(await mediaCard.locator(preview).getAttribute('src'), src)
  }
  await openCardList(page)
  await page.getByRole('button', { name: '添加图片卡', exact: true }).click()
  await detail.getByLabel('上传媒体文件').setInputFiles(png)
  await detail.locator('img[alt="图片预览"]').waitFor()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const canvasId = new URL(page.url()).searchParams.get('canvas')
  const saved = (await (await fetch(`${base}/${canvasId}`)).json()).data
  const savedSources = saved.document.cards.map(card => ({ id: card.id, file_id: card.file_id, type: card.type }))
  await page.reload()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  for (const { id, file_id, type } of savedSources) {
    await page.locator(`[data-card-id="${id}"]`).press('Enter')
    const preview = page.locator('.wb-details:not([hidden])').locator(type === 'content.image' ? 'img' : type.split('.')[1])
    await preview.waitFor()
    assert.ok((await preview.getAttribute('src')).includes(file_id), 'reopened card keeps actual file')
    const outputValue = (await (await fetch(`${base}/${canvasId}/cards/${id}/outputs`)).json()).data.outputs[0]
    assert.equal(outputValue.payload.file_id, file_id)
    assert.equal(outputValue.available, true)
  }
  await page.locator(`[data-card-id="${savedSources.find(item => item.type === 'content.video').id}"]`).press('Enter')
  await page.getByRole('complementary', { name: '视频内容卡', exact: true }).locator('video').waitFor()
  await page.screenshot({ path: join(output, 'media-content.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('dialog', { name: '视频内容卡', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'media-content-narrow.png'), fullPage: true })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  console.log(`evidence: ${output}`)
  console.log('media upload failure, replacement preservation, save failure library reuse, late deleted upload, audio/video native preview: verified')

} finally { await cleanup() }
