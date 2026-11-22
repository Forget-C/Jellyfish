import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer as createHttpServer } from 'node:http'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { createServer as createViteServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'
import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath } from './storyboard-canvas-fixture.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-assistant-')
const api = 'http://127.0.0.1:8462'
const canvasApi = api + '/api/v1/studio/generation-canvases'
const prompts = []
const observed = []
let acceptSlowReply
let slowReplyArrived
const slowReplyStarted = new Promise(resolve => { slowReplyArrived = resolve })
const slowReplyAllowed = new Promise(resolve => { acceptSlowReply = resolve })
const provider = createHttpServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const { model, messages, tools } = JSON.parse(Buffer.concat(chunks).toString())
  const turns = messages.filter(message => message.role === 'user').map(message => message.content)
  if (model === 'browser-tool-model') {
    assert.deepEqual(tools.map(tool => tool.function.name), ['read_canvas_context'])
    const result = messages.find(message => message.role === 'tool')
    const answer = result
      ? { role: 'assistant', content: '找到原先的草稿' }
      : { role: 'assistant', tool_calls: [{ id: 'context', type: 'function', function: { name: 'read_canvas_context', arguments: '{}' } }] }
    if (result) observed.push(JSON.parse(result.content))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      id: 'test-reply', object: 'chat.completion', created: 1, model,
      choices: [{ index: 0, finish_reason: result ? 'stop' : 'tool_calls', message: answer }],
    }))
    return
  }
  assert.equal(model, 'browser-assistant-model')
  assert.equal(tools, undefined)
  prompts.push(turns)
  if (turns.at(-1) === '自由二') {
    slowReplyArrived()
    await slowReplyAllowed
  }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({
    id: 'test-reply', object: 'chat.completion', created: 1, model,
    choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '答复 ' + turns.at(-1) } }],
  }))
})
await new Promise((resolve, reject) => provider.once('error', reject).listen(0, '127.0.0.1', resolve))
const python = process.env.CANVAS_BROWSER_PYTHON
const backend = spawn(python || 'uv', [...(python ? [] : ['run', '--no-sync', 'python']), '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8462',
    CANVAS_BROWSER_ASSISTANT_PROVIDER: 'http://127.0.0.1:' + provider.address().port },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(canvasApi)).ok) { ready = true; break } } catch { /* Startup. */ }
    await delay(250)
  }
  assert.ok(ready)
  const creation = await fetch(canvasApi, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '自由对话' }),
  })
  assert.ok(creation.ok)
  const free = (await creation.json()).data
  const scene = await createStoryboardCanvas(canvasApi, '分镜对话')
  server = await createViteServer({
    root, server: { host: '127.0.0.1', port: 4462, strictPort: true, open: false, proxy: { '/api': api } },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const base = 'http://127.0.0.1:4462'
  const panel = page.getByRole('complementary', { name: '画布助手' })
  const open = async () => {
    await page.getByRole('button', { name: '打开画布助手', exact: true }).click()
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).waitFor()
  }
  const ask = async text => {
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill(text)
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('答复 ' + text, { exact: true }).waitFor()
  }
  await page.goto(base + '/canvases/' + free.id)
  await open()
  assert.deepEqual(prompts, [])
  await ask('自由一')
  await panel.getByRole('button', { name: '关闭画布助手' }).click()
  await panel.waitFor({ state: 'hidden' })
  await page.goto(base + storyboardCanvasPath(scene))
  await open()
  await ask('分镜一')
  assert.equal(await panel.getByText('答复 自由一', { exact: true }).count(), 0)
  await page.goto(base + '/canvases/' + free.id)
  await open()
  await panel.getByText('答复 自由一', { exact: true }).waitFor()
  assert.equal(await panel.getByText('答复 分镜一', { exact: true }).count(), 0)
  const askWhileEditing = ask('自由二')
  await Promise.race([slowReplyStarted, askWhileEditing])
  const rename = await fetch(canvasApi + '/' + free.id + '/name', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: '回复期间仍可保存', expected_revision: free.revision }),
    signal: AbortSignal.timeout(2500),
  })
  assert.ok(rename.ok, await rename.clone().text())
  acceptSlowReply()
  await askWhileEditing
  assert.deepEqual(prompts, [['自由一'], ['分镜一'], ['自由一', '自由二']])
  await page.screenshot({ path: join(output, 'assistant-desktop.png') })
  await page.setViewportSize({ width: 375, height: 720 })
  const narrow = await panel.boundingBox()
  assert.ok(narrow && narrow.x >= 0 && narrow.x + narrow.width <= 375, 'assistant fits the narrow viewport')
  await page.screenshot({ path: join(output, 'assistant-narrow.png') })
  await page.setViewportSize({ width: 1440, height: 960 })

  for (const canvas of [free, scene]) {
    const url = canvas.project_id ? storyboardCanvasApi(canvasApi, canvas.id) : canvasApi + '/' + canvas.id
    const saved = (await (await fetch(url)).json()).data
    const card = (id, text, generated = false) => ({
      id, type: 'model.video', model_id: 'original-video-generator',
      prompt: { segments: [{ id: 'text', kind: 'text', text }] }, config: { ratio: '16:9' },
      ...(generated ? { generated_prompt: { version: 1, designs: [], edit_confirmed: true } } : {}),
    })
    const document = { ...saved.document, cards: [...(saved.document.cards || []),
      card('target', '已保存正文', true), card('other', '另一个同名模型卡')] }
    const seeded = await fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: 'scope-fixture', expected_revision: saved.revision, document }),
    })
    assert.ok(seeded.ok, await seeded.clone().text())
    await page.goto(base + (canvas.project_id ? storyboardCanvasPath(canvas) : '/canvases/' + canvas.id))
    await page.locator('[data-card-id="target"]').click()
    await page.getByRole('button', { name: '编辑提示词', exact: true }).click()
    const draft = page.getByRole('textbox', { name: '模型正文', exact: true })
    await draft.fill('只在本地编辑器看到')
    assert.equal(await draft.textContent(), '只在本地编辑器看到')
    await open()
    assert.equal(await draft.textContent(), '只在本地编辑器看到')
    await panel.getByText('分析所选卡片', { exact: true }).waitFor()
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('分析原卡片')
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText(/当前模型无法调用画布工具/).waitFor()
    await page.getByRole('button', { name: '取消编辑', exact: true }).click()
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    await page.locator('[data-card-id="other"]').click()
    await open()
    await panel.getByText('默认模型 · browser-assistant-model · 仅文字对话', { exact: true }).click()
    await page.locator('.ant-select-item-option').getByText('browser-tool-model · 可读画布', { exact: true }).click()
    await panel.getByText('browser-tool-model · 可读画布', { exact: true }).waitFor()
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('找到原先的草稿').waitFor()
    assert.deepEqual(observed.at(-1).target_card_ids, ['target'])
    assert.equal(observed.at(-1).cards[0].prompt.segments[0].text, '只在本地编辑器看到')
    const after = (await (await fetch(url)).json()).data
    assert.equal(after.document.cards.find(item => item.id === 'target').prompt.segments[0].text, '已保存正文')
    assert.equal(after.document.cards.find(item => item.id === 'target').model_id, 'original-video-generator')
    await page.reload()
    await open()
    await panel.getByText('browser-tool-model · 可读画布', { exact: true }).waitFor()
  }
  assert.equal(observed.length, 2)
  console.log('Assistant conversation persisted independently on both real canvas entries.')
} finally {
  acceptSlowReply()
  await cleanup()
  provider.close()
}
