import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-video-frame-')
const api = 'http://127.0.0.1:8679', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8679' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated video frame backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4679, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const video = join(output, 'clip.mp4')
  const encoded = spawnSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=red:s=32x24:r=10:d=1',
    '-f', 'lavfi', '-i', 'color=blue:s=32x24:r=10:d=1', '-filter_complex', 'concat=n=2:v=1:a=0',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', video])
  assert.equal(encoded.status, 0, String(encoded.stderr))
  const canvas = await createStoryboardCanvas(base, '视频选帧')
  const form = new FormData()
  form.set('project_id', 'canvas-project')
  form.set('usage_kind', 'generation_upload')
  form.set('file', new Blob([await readFile(video)], { type: 'video/mp4' }), 'clip.mp4')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const fileId = (await uploaded.json()).data.id
  const url = storyboardCanvasApi(base, canvas.id)
  const document = { ...canvas.document, cards: [{ id: 'clip', type: 'content.video', file_id: fileId }] }
  const saved = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) }) })
  assert.ok(saved.ok, await saved.text())
  const read = async () => (await (await fetch(url)).json()).data
  await page.goto(`http://127.0.0.1:4679${storyboardCanvasPath(canvas)}`)
  const source = page.locator('[data-card-id="clip"]')
  await source.getByRole('button', { name: '卡片操作' }).click()
  await source.getByRole('button', { name: '选帧为图片' }).click()
  const picker = page.getByRole('dialog', { name: '选帧为图片' })
  const slider = picker.getByRole('slider', { name: '视频时间位置' })
  await slider.waitFor()
  await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
  await slider.fill('1300')
  assert.deepEqual((await read()).document.cards.map(card => card.id).sort(),
    ['clip', canvas.document.fixed_source.card_id].sort(), 'preview does not create a card')
  await picker.getByRole('button', { name: '保存为图片' }).click()
  await picker.waitFor({ state: 'hidden' })
  const state = await read()
  const frame = state.document.cards.find(card => card.type === 'content.image')
  assert.equal(frame.frame_origin.at_ms, 1300)
  assert.equal(frame.frame_origin.source_file_id, fileId)
  const response = await fetch(`${api}/api/v1/studio/files/${frame.file_id}/download`)
  const decoded = spawnSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'],
    { input: Buffer.from(await response.arrayBuffer()) })
  assert.equal(decoded.status, 0, String(decoded.stderr))
  assert.ok(decoded.stdout[2] > 240 && decoded.stdout[0] < 10, 'the selected frame is blue')
  await page.reload()
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const image = page.locator(`[data-card-id="${frame.id}"]`)
  await image.getByRole('button', { name: '引用', exact: true }).press('Enter')
  await page.getByRole('dialog', { name: '卡片引用' }).getByRole('button', { name: /来源视频.*1.300/ }).click()
  await page.waitForFunction(() => window.document.activeElement?.closest('[data-card-id]')?.dataset.cardId === 'clip')
  const files = `${api}/api/v1/studio/files`
  const deleteFile = id => fetch(`${files}/${id}`, { method: 'DELETE' })
  const release = id => fetch(`${files}/${id}/upload-retention?project_id=canvas-project`, { method: 'DELETE' })
  const save = (revision, document) => fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: randomUUID(), expected_revision: revision, document }) })
  const prepare = await fetch(storyboardCanvasApi(base, canvas.id, '/video-frames'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source_card_id: 'clip', source_file_id: fileId, request_id: randomUUID(), at_ms: 100 }) })
  assert.ok(prepare.ok, await prepare.clone().text())
  const unused = (await prepare.json()).data
  assert.equal((await deleteFile(frame.file_id)).status, 409, 'the saved still remains protected')
  assert.equal((await deleteFile(fileId)).status, 409, 'the source remains protected while a source card uses it')
  assert.ok((await release(unused.file_id)).ok, 'an unused prepared frame can be released')
  assert.ok((await deleteFile(unused.file_id)).ok, 'an unused prepared frame can be deleted')
  const missing = await save(state.revision, { ...state.document, cards: [...state.document.cards, unused] })
  assert.equal(missing.status, 422)
  assert.match(await missing.text(), /INVALID_MEDIA_FILE/)
  assert.deepEqual(await read(), state, 'saving a missing still must not change the canvas')
  const removedSource = await save(state.revision, { ...state.document, cards: [frame, ...canvas.document.cards] })
  assert.ok(removedSource.ok, await removedSource.clone().text())
  assert.ok((await release(fileId)).ok, 'the removed source can be explicitly released')
  assert.ok((await deleteFile(fileId)).ok, 'the original video has no remaining consumers')
  await page.reload()
  await image.getByRole('button', { name: '引用', exact: true }).press('Enter')
  const provenance = page.getByRole('dialog', { name: '卡片引用' })
  await provenance.getByText('来源卡片已删除或不可用', { exact: true }).waitFor()
  await provenance.getByText('1.300 秒', { exact: true }).waitFor()
  assert.equal(await provenance.getByRole('button', { name: /来源视频/ }).count(), 0)
  const kept = await fetch(`${files}/${frame.file_id}/download`)
  assert.ok(kept.ok)
  assert.ok((await kept.arrayBuffer()).byteLength > 0)
  assert.equal((await deleteFile(frame.file_id)).status, 409, 'deleting the original video never releases the still')
  console.log('Frame pixels, persisted provenance, missing-input validation and independent file protection verified')
} finally {
  await cleanup()
}
