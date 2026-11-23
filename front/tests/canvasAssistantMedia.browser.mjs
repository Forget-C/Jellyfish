import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer as createViteServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-assistant-media-')
const api = 'http://127.0.0.1:8464'
const canvases = api + '/api/v1/studio/generation-canvases'
const browserBase = 'http://127.0.0.1:4464'
const observed = []
const provider = createHttpServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const { model, messages, stream } = JSON.parse(Buffer.concat(chunks))
  const hasSkill = messages.some(message => message.role === 'tool')
  if (!hasSkill) observed.push(messages.filter(message => message.role === 'user').at(-1).content)
  if (stream) {
    const delta = hasSkill
      ? { role: 'assistant', content: '看过连续画面和音轨。建议保留现有节奏。' }
      : { role: 'assistant', tool_calls: [{ index: 0, id: 'review', type: 'function',
        function: { name: 'load_canvas_skill', arguments: '{"skill_id":"footage-review"}' } }] }
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end('data: ' + JSON.stringify({
      id: 'review-reply', object: 'chat.completion.chunk', created: 1, model,
      choices: [{ index: 0, finish_reason: hasSkill ? 'stop' : 'tool_calls', delta }],
    }) + '\n\ndata: [DONE]\n\n')
    return
  }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({
    id: 'media-reply', object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '已比较参考素材 1 和 2' } }],
  }))
})
await new Promise((resolve, reject) => provider.once('error', reject).listen(0, '127.0.0.1', resolve))

const python = process.env.CANVAS_BROWSER_PYTHON
const backend = spawn(python || 'uv', [...(python ? [] : ['run', '--no-sync', 'python']), '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8464',
    CANVAS_BROWSER_ASSISTANT_PROVIDER: 'http://127.0.0.1:' + provider.address().port,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_ASSISTANT_REVIEW: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(canvases)).ok) { ready = true; break } } catch { /* Startup. */ }
    await delay(250)
  }
  assert.ok(ready)
  const response = await fetch(canvases, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '对话参考素材' }),
  })
  assert.ok(response.ok)
  const canvas = (await response.json()).data
  server = await createViteServer({
    root, server: { host: '127.0.0.1', port: 4464, strictPort: true, open: false, proxy: { '/api': api } },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAF0lEQVR4nGP8z0AYMBGhhmFUEQOdgwAAz+ABFyTybdUAAAAASUVORK5CYII=', 'base64')
  const uploadForm = new FormData()
  uploadForm.append('file', new Blob([png], { type: 'image/png' }), '文件库参考.png')
  const file = await fetch(api + '/api/v1/studio/files/upload', { method: 'POST', body: uploadForm })
  assert.ok(file.ok, await file.clone().text())

  await page.goto(browserBase + '/canvases/' + canvas.id)
  const panel = page.getByRole('complementary', { name: '画布助手' })
  const open = () => page.getByRole('button', { name: '打开画布助手', exact: true }).click()
  await open()
  await panel.getByLabel('上传对话参考素材').setInputFiles({ name: '本地参考.png', mimeType: 'image/png', buffer: png })
  await panel.getByRole('button', { name: '移除 本地参考', exact: true }).waitFor()
  await panel.getByRole('button', { name: '选择参考素材' }).click()
  const picker = page.getByRole('dialog', { name: '选择对话参考素材' })
  await picker.getByRole('button', { name: '文件库参考', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await panel.getByRole('button', { name: '移除 文件库参考', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'attached-desktop.png') })
  await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('请比较两张参考图')
  await panel.getByRole('button', { name: '发送消息' }).click()
  await panel.getByText('已比较参考素材 1 和 2', { exact: true }).waitFor()
  assert.equal(observed[0].filter(item => item.type === 'image_url').length, 2)
  const saved = (await (await fetch(canvases + '/' + canvas.id)).json()).data
  assert.deepEqual(saved.document, canvas.document)

  await page.reload()
  await open()
  const history = panel.getByRole('log')
  await history.getByRole('link', { name: '本地参考' }).waitFor()
  await history.getByRole('link', { name: '文件库参考' }).waitFor()
  assert.equal(await history.getByText('已读取图片', { exact: true }).count(), 2)
  await panel.getByTitle('默认模型 · browser-assistant-model · 可读图片与视频静帧', { exact: true }).click()
  await page.getByTitle('qwen3.8-omni-flash · 可读画布 · 可读连续画面及音轨', { exact: true }).click()
  const clip = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=128x128:r=10:d=3',
    '-f', 'lavfi', '-i', 'sine=frequency=600:sample_rate=16000:duration=3',
    '-c:v', 'libx264', '-bf', '0', '-threads', '1', '-c:a', 'aac',
    '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'])
  await panel.getByLabel('上传对话参考素材').setInputFiles({ name: '声画样片.mp4', mimeType: 'video/mp4', buffer: clip })
  await panel.getByRole('button', { name: '移除 声画样片', exact: true }).waitFor()
  await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('请审看声画是否同步')
  await panel.getByRole('button', { name: '发送消息' }).click()
  await history.getByText('看过连续画面和音轨。建议保留现有节奏。', { exact: true }).waitFor()
  await history.getByText(/已读取连续画面和音轨.*声画重合时段/).waitFor()
  await history.getByText(/成片审看/).waitFor()
  assert.ok(observed.at(-1).some(item => item.type === 'video_url'))
  await panel.locator('.canvas-assistant-reference-toolbar button:enabled').first().waitFor()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'reference-history-narrow.png') })
  console.log('Assistant retains image references and displays the observed video and synchronized audio interval.')
} finally {
  await cleanup()
  provider.close()
}
