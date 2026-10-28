import { closeCanvasDetails, closePrecheck, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn, execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
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
  await page.goto(`http://127.0.0.1:4279/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  await page.locator('[data-card-id="m"]').press('Enter')
  const card = page.locator('.wb-details:not([hidden])'), editor = card.getByRole('textbox', { name: '模型正文', exact: true })
  const preview = page.getByRole('region', { name: '运行预检', exact: true })
  const save = async () => { await page.getByRole('button', { name: '保存画布', exact: true }).click(); await page.getByRole('status').filter({ hasText: '已保存' }).waitFor(); return (await (await fetch(`${base}/${canvas.id}`)).json()).data.document.cards[0] }
  const closePreview = () => closePrecheck(page)
  const check = async () => { await card.getByRole('button', { name: '预检运行', exact: true }).click(); await preview.waitFor() }
  await editor.pressSequentially('开头 @图片1 结尾', { delay: 1 })
  writeFileSync(join(output,'reference-caret-dom.txt'),await editor.innerText())
  assert.equal(await editor.innerText(),'开头 @图片1 结尾')
  await editor.fill('')
  // Type real keystrokes: the space after command/name must not finalize an empty instruction.
  await editor.pressSequentially('/首帧参考 @图片1 正文 /尾帧参考 @图片2 /关键帧参考 @图片2 @图片1 /主体参考 "张三" @图片1 同行正文', { delay: 1 })
  await editor.press('Tab')
  writeFileSync(join(output,'directives-dom.txt'),await editor.innerText())
  let persisted = await save()
  writeFileSync(join(output,'directives-saved.json'),JSON.stringify(persisted,null,2))
  const instructions = persisted.prompt.segments.filter(segment => segment.kind === 'instruction')
  assert.deepEqual(instructions.map(item => [item.command, item.references.length]), [['首帧参考', 1], ['尾帧参考', 1], ['关键帧参考', 2], ['主体参考', 1]])
  assert.ok(persisted.prompt.segments.filter(segment => segment.kind === 'text').map(segment => segment.text).join('').includes('同行正文'))
  assert.equal(await card.locator('[data-instruction-id]').count(), 4)
  await check()
  await preview.getByRole('alert').filter({ hasText: 'UNSUPPORTED_REFERENCE_COMBINATION' }).waitFor()
  assert.equal(await preview.getByRole('button', { name: '确认执行', exact: true }).isDisabled(), true)
  await preview.getByRole('alert').filter({ hasText: 'UNSUPPORTED_REFERENCE_COMBINATION' }).getByRole('button', { name: '定位问题' }).click()
  await preview.waitFor({state:'hidden'})
  await card.locator('[data-segment-id]:focus').waitFor()
  assert.ok(await card.locator('[data-segment-id]:focus').count())
  await page.screenshot({ path: join(output, 'four-directives-diagnostic.png'), fullPage: true })
  // Four selected commands share the canonical structure with handwritten commands.
  for (const command of ['首帧参考', '尾帧参考', '关键帧参考', '主体参考']) {
    await card.getByRole('combobox', { name: '系统指令', exact: true }).locator('..').locator('..').click()
    await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText(`/${command}`, { exact: true }).click()
  }
  persisted = await save()
  assert.equal(persisted.prompt.segments.filter(segment => segment.kind === 'instruction').length, 8)
  await check()
  await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_REFERENCE_REQUIRED' }).first().waitFor()
  await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_PARAMETER_REQUIRED' }).first().waitFor()
  assert.deepEqual(persisted.prompt.segments.filter(segment => segment.kind === 'instruction').slice(4).map(item => item.command), instructions.map(item => item.command))
  await closePreview()
  while (await card.getByRole('button', { name: '删除指令', exact: true }).count()) await card.getByRole('button', { name: '删除指令', exact: true }).first().click()
  await editor.fill('/首帧参考 @图片1 /首帧参考 @图片2')
  await editor.press('Tab'); await check()
  await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_COUNT_EXCEEDED' }).waitFor()
  await closePreview()
  while (await card.getByRole('button', { name: '删除指令', exact: true }).count()) await card.getByRole('button', { name: '删除指令', exact: true }).first().click()
  await editor.fill('/首帧参考 @文本1 同行正文'); await editor.press('Tab'); await check()
  await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_REFERENCE_TYPE' }).getByRole('button', { name: '定位问题' }).click()
  await preview.waitFor({state:'hidden'})
  await card.locator('[data-segment-id]:focus').waitFor()
  assert.ok(await card.locator('[data-segment-id]:focus').count())
  // Actual subject modes through the public page; surrounding prose survives all cases.
  while (await card.getByRole('button', { name: '删除指令', exact: true }).count()) await card.getByRole('button', { name: '删除指令', exact: true }).first().click()
  await card.getByRole('combobox', { name: '选择模型', exact: true }).locator('..').locator('..').click()
  await page.locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden)').getByText('viduq2-pro', { exact: true }).click()
  for (const [body, expected] of [
    ['让 @图片1 中的人物转身', '让 @media1 中的人物转身'],
    ['让 @图片1 中的人物转身 /主体参考 "张三" @图片1', '让 @张三 中的人物转身 '],
    ['让 @图片1 中的人物转身 /主体参考 "张三" @图片1 /主体参考 "李四" @图片1', '让 @media1 中的人物转身  '],
  ]) {
    await closePreview()
    while (await card.getByRole('button', { name: '删除指令', exact: true }).count()) await card.getByRole('button', { name: '删除指令', exact: true }).first().click()
    await editor.fill(body); await editor.press('Tab'); await check()
    assert.equal(await preview.getByRole('region', { name: '实际提交文本', exact: true }).textContent(), expected)
    assert.equal(await preview.getByRole('button', { name: '确认执行', exact: true }).isDisabled(), false)
  }
  const accepted = page.waitForResponse(response => response.request().method() === 'POST' && response.url().endsWith('/runs'))
  await preview.getByRole('button', { name: '确认执行', exact: true }).click()
  const run = (await (await accepted).json()).data
  await fetch(`${api}/test/video-controls`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ release: true }) })
  const formal = card.getByRole('region', { name: '当前正式输出', exact: true }), video = formal.locator('video')
  await video.waitFor({ timeout: 20000 })
  await video.evaluate(async element => { element.muted = true; await element.play() })
  assert.equal(await video.evaluate(element => element.captureStream().getAudioTracks().length), 1, 'native video retains original audio')
  const state = (await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data
  assert.equal(state.runs.find(item => item.id === run.run_id).nodes[0].outputs.length, 1)
  const calls = (await (await fetch(`${api}/test/video-controls`)).json()).calls
  assert.equal(calls.filter(call => call.method === 'POST').length, 1)
  await closeCanvasDetails(page)
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  const history = page.getByRole('region', { name: '画布运行历史', exact: true })
  await history.locator('summary').filter({ hasText: '运行 ' }).first().click()
  await history.getByRole('button', { name: '另存为视频内容卡', exact: true }).click()
  let copy
  for(let i=0;i<80;i++){
    const saved=(await(await fetch(`${base}/${canvas.id}`)).json()).data
    copy=saved.document.cards.find(item=>item.type==='content.video'&&item.origin?.run_id===run.run_id)
    if(copy)break
    await delay(100)
  }
  assert.ok(copy)
  assert.equal(copy.origin.incomplete,false)
  await page.getByRole('button',{name:'运行历史',exact:true}).click()
  const copyDetails=await openCanvasCard(page,copy.id)
  await copyDetails.getByText(/完整成果副本/).waitFor()
  await save()
  await page.screenshot({ path: join(output, 'video-audio-history.png'), fullPage: true })
  console.log(`video passed: ${output}`)
} catch(error){writeFileSync(join(output,'failed-body.txt'),await page.locator('body').innerText());await page.screenshot({path:join(output,'failed.png'),fullPage:true});throw error} finally { await cleanup() }
