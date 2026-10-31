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
  const fileIds = []
  for (let i = 0; i < 2; i++) {
    const form = new FormData()
    form.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), `reference${i}.png`)
    form.append('project_id', 'canvas-project'); form.append('usage_kind', 'generation_upload')
    fileIds.push((await (await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: form })).json()).data.id)
  }
  const document = { ...canvas.document, cards: [{ id: 'm', type: 'model.video', model_id: 'video-frames', prompt: { segments: [] }, config: { ratio: '16:9', seconds: 5, seed: 7 } }, ...fileIds.map((file_id, i) => ({ id: `s${i}`, type: 'content.image', file_id })), { id: 'text-source', type: 'content.text', text: '原文' }],
    edges: fileIds.map((_, i) => ({ id: `e${i}`, source_card: `s${i}`, source_port: 'image', target_card: 'm', target_port: i ? 'key_frame' : 'first_frame' })), input_order: { m: { first_frame: ['e0'], key_frame: ['e1'], text: ['et'] } } }
  document.edges.push({ id: 'et', source_card: 'text-source', source_port: 'text', target_card: 'm', target_port: 'text' })
  assert.ok((await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })).ok)
  await page.addInitScript(id => localStorage.setItem(`jellyfish:generation-layout:canvas-project:${id}:view:canvas`, JSON.stringify({ schema: 1, transform: { x: 40, y: 104, scale: 1 }, positions: { m: { x: 0, y: 0 }, s0: { x: 900, y: 0 }, s1: { x: 1400, y: 0 }, 'text-source': { x: 1900, y: 0 } }, sizes: {} })), canvas.id)
  await page.goto(`http://127.0.0.1:4279/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  await page.locator('[data-card-id="m"]').click()
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  const details = page.getByRole('complementary', { name: '视频模型卡' })
  const uses = details.getByRole('region', { name: '视频实际输入' })
  await uses.waitFor()
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.document.cards[0].input_bindings.length, 0, 'connection remains candidate')
  await uses.getByRole('button', { name: '采用 @图片1 为首帧', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data.document.cards[0]
  assert.equal(saved.input_bindings[0].input_port, 'first_frame')
  const compiled = (await (await fetch(`${base}/${canvas.id}/cards/m/compile`)).json()).data
  assert.equal(compiled.video_media.frames.first.file_id, fileIds[0])
  await uses.getByRole('button', { name: '采用 @图片2 为关键帧', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  await page.reload()
  await page.locator('[data-card-id="m"]').click()
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  await uses.getByText('首帧 · @图片1', { exact: true }).waitFor()
  await uses.getByText('关键帧 · @图片2', { exact: true }).waitFor()
  await uses.getByRole('button', { name: '取消首帧 @图片1', exact: true }).click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${base}/${canvas.id}`)).json()).data.document.cards[0].input_bindings.length, 1)
  await details.getByRole('button', { name: '预检运行', exact: true }).click()
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  await preview.waitFor()
  const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  const run = (await (await accepted).json()).data
  await fetch(`${api}/test/video-controls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: true }) })
  const video = details.getByRole('region', { name: '当前正式输出', exact: true }).locator('video')
  await video.waitFor({ timeout: 20000 })
  await video.evaluate(async element => { element.muted = true; await element.play() })
  assert.equal(await video.evaluate(element => element.captureStream().getAudioTracks().length), 1, 'complete output retains original audio')
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const history = page.getByRole('region', { name: '画布运行历史', exact: true })
  await history.locator('summary').filter({ hasText: `运行 ${run.run_id}` }).click()
  await history.locator('summary').filter({ hasText: '本次实际输入与模型参数' }).click()
  await history.getByRole('region', { name: '历史视频用途' }).waitFor()
  await history.getByRole('button', { name: '另存为视频内容卡', exact: true }).click()
  await history.getByText('已另存为独立内容卡，保留原运行来源', { exact: true }).waitFor()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const result = (await (await fetch(`${base}/${canvas.id}`)).json()).data.document
  assert.equal(result.cards.filter(card => card.type === 'content.video' && card.origin?.run_id === run.run_id).length, 1)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  await page.locator('[data-card-id="m"]').press('Enter')
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  await uses.getByText('关键帧 · @图片2', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'video-inputs-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('dialog', { name: '视频模型卡', exact: true }).waitFor()
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.screenshot({ path: join(output, 'video-inputs-narrow.png'), fullPage: true })
  const fixed = result.cards.find(card => card.type === 'content.video' && card.origin?.run_id === run.run_id)
  const subjectCanvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '主体视频采用' }) })).json()).data
  const subjectDoc = { ...subjectCanvas.document, cards: [
    { id: 'subject-model', type: 'model.video', model_id: 'video-subjects', config: { ratio: '16:9', seconds: 5 }, prompt: { segments: [] } },
    { id: 'saved-video', type: 'content.video', file_id: fixed.file_id }],
    edges: [{ id: 'subject-edge', source_card: 'saved-video', source_port: 'video', target_card: 'subject-model', target_port: 'subject_video' }],
    input_order: { 'subject-model': { subject_video: ['subject-edge'] } } }
  assert.ok((await fetch(`${base}/${subjectCanvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'subject-seed', expected_revision: 0, document: subjectDoc }) })).ok)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(`http://127.0.0.1:4279/projects/canvas-project/generation-canvas?canvas=${subjectCanvas.id}`)
  await page.locator('[data-card-id="subject-model"]').press('Enter')
  await page.locator('.generation-material-composer').waitFor(); await openModelInspection(page)
  const subjectUses = page.getByRole('region', { name: '视频实际输入' })
  const adopt = subjectUses.getByRole('button', { name: '采用 @视频1 为主体视频', exact: true })
  assert.equal(await adopt.isDisabled(), true, 'multi-subject media is not assigned without an explicit group')
  await subjectUses.getByRole('textbox', { name: '主体分组 @视频1', exact: true }).fill('主人公')
  await adopt.click()
  await page.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  const subjectPreview = (await (await fetch(`${base}/${subjectCanvas.id}/cards/subject-model/compile`)).json()).data
  assert.equal(subjectPreview.video_media.subjects[0].name, '主人公')
  assert.equal(subjectPreview.video_media.subjects[0].media[0].media_kind, 'video')
  assert.equal((await (await fetch(`${api}/test/video-controls`)).json()).calls.filter(call => call.method === 'POST').length, 1, 'adoption does not run upstream or downstream')
  await page.screenshot({ path: join(output, 'subject-video-adoption.png'), fullPage: true })
  console.log(`video binding adoption passed: ${output}`)
} finally { await cleanup() }
