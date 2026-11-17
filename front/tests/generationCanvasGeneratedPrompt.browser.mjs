import { closeCanvasDetails, openModelInspection } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-video-')
const fixture = join(output, 'audio-video.mp4')
execFileSync('/opt/homebrew/bin/ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', '-y', fixture])
const api = 'http://127.0.0.1:8279', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_video_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8279', CANVAS_VIDEO_FIXTURE: fixture }, stdio: ['ignore', 'pipe', 'pipe'],
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
  const schema = await (await fetch(`${api}/openapi.json`)).json()
  assert.ok(schema.components.schemas.InputBinding.properties.subject_name, 'running backend exposes binding group contract')
  await writeFile(join(output, 'openapi-8279.json'), JSON.stringify(schema))
  const productionSchema = { ...schema, paths: Object.fromEntries(Object.entries(schema.paths).filter(([path]) => !path.startsWith('/test/'))) }
  assert.deepEqual(productionSchema, JSON.parse(await readFile(join(root, 'openapi.json'), 'utf8')), 'independent backend production routes match committed OpenAPI')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4279, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '视频用途' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'm', type: 'model.video', model_id: 'video-frames', generated_prompt: { version: 1, designs: [] }, prompt: { segments: [{ id: 'body', kind: 'text', text: '固定镜头，人物停步。' }] }, config: { ratio: '16:9', seconds: 5 } }] }
  const response = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: canvas.revision, document }) })
  assert.equal(response.status, 200)
  await page.goto(`http://127.0.0.1:4279/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="m"]').click()
  const editor = page.getByRole('textbox', { name: '模型正文', exact: true })
  await editor.waitFor()
  assert.equal(await editor.getAttribute('contenteditable'), 'false')
  await page.getByRole('button', { name: '编辑提示词', exact: true }).click()
  const risk = page.getByRole('dialog', { name: '编辑提示词' })
  await risk.waitFor()
  await risk.getByRole('button', { name: '继续编辑', exact: true }).click()
  await editor.fill('人工修改')
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  assert.match(await editor.textContent(), /固定镜头/)
  await page.getByRole('button', { name: '编辑提示词', exact: true }).click()
  assert.equal(await risk.count(), 0)
  await editor.fill('人工修改后保存')
  await page.getByRole('button', { name: '保存修改', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await page.reload()
  await page.locator('[data-card-id="m"]').click()
  await editor.waitFor()
  assert.match(await editor.textContent(), /人工修改后保存/)
  await page.getByRole('button', { name: '编辑提示词', exact: true }).click()
  assert.equal(await risk.count(), 0)
  await page.screenshot({ path: join(output, 'generated-prompt-editor.png'), fullPage: true })
  await page.getByRole('button', { name: '取消编辑', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'generated-prompt-mobile.png'), fullPage: true })
  console.log(`generated prompt editor passed: ${output}`)
} finally { await cleanup() }
