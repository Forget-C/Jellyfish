import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-video-frame-')
const api = 'http://127.0.0.1:8679', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
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
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '视频选帧' }) })).json()).data
  const form = new FormData()
  form.set('project_id', 'canvas-project')
  form.set('usage_kind', 'generation_upload')
  form.set('file', new Blob([await readFile(video)], { type: 'video/mp4' }), 'clip.mp4')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const fileId = (await uploaded.json()).data.id
  const url = `${base}/${canvas.id}`
  const document = { ...canvas.document, cards: [{ id: 'clip', type: 'content.video', file_id: fileId }] }
  const saved = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(saved.ok, await saved.text())
  const read = async () => (await (await fetch(url)).json()).data
  await page.goto(`http://127.0.0.1:4679/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const source = page.locator('[data-card-id="clip"]')
  await source.getByRole('button', { name: '卡片操作' }).click()
  await source.getByRole('button', { name: '选帧为图片' }).click()
  const picker = page.getByRole('dialog', { name: '选帧为图片' })
  const slider = picker.getByRole('slider', { name: '视频时间位置' })
  await slider.waitFor()
  await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
  await slider.fill('1300')
  assert.equal((await read()).document.cards.length, 1, 'preview does not create a card')
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
  const image = page.locator(`[data-card-id="${frame.id}"]`)
  await image.getByRole('button', { name: '引用', exact: true }).click()
  await page.getByRole('dialog', { name: '卡片引用' }).getByRole('button', { name: /来源视频.*1.300/ }).click()
  await page.waitForFunction(() => window.document.activeElement?.closest('[data-card-id]')?.dataset.cardId === 'clip')
  console.log('Video frame picker, actual pixels, persisted card and source navigation verified')
} finally {
  await cleanup()
}
