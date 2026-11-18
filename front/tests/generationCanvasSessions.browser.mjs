import { openCanvasCard, closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8427', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8427' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4427, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多图与未完成成果' }) })).json()).data
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', join(output, 'voice.wav')])
  const form = new FormData(); form.set('file', new Blob([readFileSync(join(output, 'voice.wav'))], {type:'audio/wav'}), 'voice.wav'); form.set('project_id','canvas-project'); form.set('usage_kind','generation_upload')
  const upload = await fetch(`${api}/api/v1/studio/files/upload`, {method:'POST',body:form}); assert.ok(upload.ok)
  const audioFile = (await upload.json()).data
  const document = { ...canvas.document, cards: [
    {id:'audio',type:'content.audio',file_id:audioFile.id},
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'p', kind: 'text', text: '三张完整图片' }] }, config: { count: 3, target_ratio: '1:1', resolution_profile: 'standard' } },
    { id: 'text', type: 'content.text', text: 'Literal 图片3 [media:1]' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: { count: 3 } }],
    edges: [{ id: 'downstream', source_card: 'm', source_port: 'image', target_card: 'consumer', target_port: 'image' }, { id: 'text-edge', source_card: 'text', source_port: 'text', target_card: 'consumer', target_port: 'text' }], input_order: { consumer: { image: ['downstream'], text: ['text-edge'] } } }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4427/canvases/${canvas.id}`)
  const open = id => openCanvasCard(page,id)
  await open('m')
  const card = page.locator('.wb-details:not([hidden])'), consumer = card
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const control = async body => (await fetch(`${api}/test/image-controls`, body && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json()
  const runtime = async () => (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  const start = async () => {
    await card.getByRole('button', { name: '预检运行', exact: true }).click()
    const received = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/runs'))
    await preview.getByRole('button', { name: '确认执行', exact: true }).click()
    return (await (await received).json()).data
  }
  const first = await start()
  const formal = card.getByRole('region', { name: '当前正式输出', exact: true })
  await formal.getByRole('button', { name: '预览输出 3', exact: true }).waitFor()
  const original = (await runtime()).current_outputs.m
  assert.equal(original.length, 3)
  await formal.getByRole('button', { name: '预览输出 3', exact: true }).click()
  await formal.getByText('输出 3 / 3', { exact: true }).waitFor()
  await closeCanvasDetails(page)
  await open('m')
  await formal.getByText('输出 3 / 3', { exact: true }).waitFor()
  await open('text')
  await open('m')
  await formal.getByText('输出 3 / 3', { exact: true }).waitFor()
  await open('audio')
  const audio = card.locator('audio')
  await audio.evaluate(async element => { if (element.readyState < 1) await new Promise(resolve => element.addEventListener('loadedmetadata',resolve,{once:true})); element.currentTime=3; await element.play() })
  await closeCanvasDetails(page)
  const retainedAudio = page.locator('[data-card-details="audio"] audio')
  assert.equal(await retainedAudio.evaluate(element => element.paused), true, 'hidden media is paused')
  await open('audio')
  assert.ok((await audio.evaluate(element=>element.currentTime))>=3,'closing retains media time')
  await audio.evaluate(element => element.play())
  await open('m')
  assert.equal(await retainedAudio.evaluate(element => element.paused), true, 'switching pauses hidden media')
  await open('audio')
  assert.ok((await audio.evaluate(element=>element.currentTime))>=3,'switching retains media time')
  await open('m')
  const beforeSaveSnapshot = await runtime()
  assert.equal(beforeSaveSnapshot.current_outputs.m[0].basis_current,true)
  let heldStream, acceptStream
  const streamHeld = new Promise(resolve => { acceptStream = resolve })
  await page.route(url => url.pathname.endsWith('/events'), async route => { heldStream = route; acceptStream() })
  await page.reload(); await streamHeld
  await open('m')
  await card.getByRole('textbox',{name:'模型正文',exact:true}).fill('修改生成依据但保留旧成果')
  await page.getByLabel('画布保存状态').getByText('已保存', {exact:true}).waitFor()
  for(let i=0;i<40;i++){if((await runtime()).current_outputs.m[0].basis_current===false)break;await delay(100)}
  assert.equal((await runtime()).current_outputs.m[0].basis_current,false)
  await closeCanvasDetails(page)
  await page.getByRole('switch',{name:'高亮问题卡片',exact:true}).click()
  await page.locator('[data-card-id="m"]').waitFor()
  assert.equal(await page.locator('[data-card-id="text"]').count(),1,'unproblematic content stays visible')
  assert.equal(await page.locator('[data-card-id="text"]').getAttribute('data-filter-match'),'false')
  assert.equal(await page.locator('[data-card-id="m"]').getAttribute('data-filter-match'),'true')
  assert.equal((await runtime()).cursor,beforeSaveSnapshot.cursor,'saving does not advance the task cursor')
  const lateSnapshot = {version:1,cursor:beforeSaveSnapshot.cursor,type:'snapshot',canvas_id:canvas.id,run_id:null,node_id:null,payload:beforeSaveSnapshot}
  await heldStream.fulfill({status:200,contentType:'text/event-stream',body:`data: ${JSON.stringify(lateSnapshot)}\n\n`})
  await page.evaluate(async()=>{await new Promise(requestAnimationFrame);await new Promise(requestAnimationFrame)})
  assert.equal(await page.locator('[data-card-id="m"]').count(),1,'late pre-save SSE snapshot cannot hide the stale model')
  await page.screenshot({path:join(output,'stale-model-session.png'),animations:'disabled'})
  await open('m')
  await card.getByRole('textbox',{name:'模型正文',exact:true}).fill('三张完整图片')
  for(let i=0;i<40;i++){if((await runtime()).current_outputs.m[0].basis_current===true)break;await delay(100)}
  assert.equal((await runtime()).current_outputs.m[0].basis_current,true,'returning to the original basis is a legitimate same-cursor update')
  assert.equal((await runtime()).cursor,beforeSaveSnapshot.cursor)
  await page.locator('[data-card-id="m"][data-filter-match="false"]').waitFor()
  assert.equal(await page.locator('[data-card-id="m"]').count(),1,'basis restored removes problem highlight, not content')
  console.log('PASS preview/media sessions and same-cursor save/SSE reconciliation')
} finally { await cleanup() }
