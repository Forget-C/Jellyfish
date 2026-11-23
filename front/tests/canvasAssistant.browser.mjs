import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
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
const apiPort = Number(process.env.CANVAS_ASSISTANT_TEST_API_PORT || 8462)
const webPort = Number(process.env.CANVAS_ASSISTANT_TEST_WEB_PORT || 4462)
const api = 'http://127.0.0.1:' + apiPort
const canvasApi = api + '/api/v1/studio/generation-canvases'
const journey = '把镜头三的推近放慢，生成一版，再审看'
const clipPath = join(output, 'known-silent-clip.mp4')
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
  '-i', 'color=red:size=64x64:rate=24:duration=2', '-an', '-c:v', 'libx264', '-bf', '0',
  '-pix_fmt', 'yuv420p', clipPath])
const clip = await readFile(clipPath)
const videoRequests = []
const reviewInputs = []
const prompts = []
const observed = []
let acceptSlowReply
let slowReplyArrived
const slowReplyStarted = new Promise(resolve => { slowReplyArrived = resolve })
const slowReplyAllowed = new Promise(resolve => { acceptSlowReply = resolve })
const provider = createHttpServer(async (request, response) => {
  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const pathname = new URL(request.url, 'http://localhost').pathname
  if (/\/videos\/fixture-\d+\/content$/.test(pathname)) {
    response.writeHead(200, { 'Content-Type': 'video/mp4' })
    response.end(clip)
    return
  }
  if (pathname.endsWith('/videos') && request.method === 'POST') {
    videoRequests.push(JSON.parse(Buffer.concat(chunks).toString()))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ id: 'fixture-' + videoRequests.length }))
    return
  }
  if (pathname.includes('/videos/fixture-')) {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ status: 'succeeded' }))
    return
  }
  const { model, messages, tools, stream } = JSON.parse(Buffer.concat(chunks).toString())
  const evidence = messages.flatMap(message => Array.isArray(message.content) ? message.content : [])
    .find(part => part.type === 'video_url' || part.type === 'image_url')
  const isReview = messages.some(message => Array.isArray(message.content)
    && message.content.some(part => part.text?.includes('请用成片审看技能')))
  if (evidence && isReview) {
    reviewInputs.push(evidence)
    const content = evidence.type === 'video_url'
      ? '连续画面 0–2 秒为红色，没有音轨，无法判断声画同步。'
      : '仅收到红色静帧，无法判断动作连续性。'
    const choices = stream ? [{ index: 0, delta: { role: 'assistant', content }, finish_reason: 'stop' }]
      : [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }]
    response.writeHead(200, { 'Content-Type': stream ? 'text/event-stream' : 'application/json' })
    const body = JSON.stringify({ id: 'review', object: 'chat.completion', created: 1, model, choices })
    response.end(stream ? 'data: ' + body + '\n\ndata: [DONE]\n\n' : body)
    return
  }
  const turns = messages.filter(message => message.role === 'user').map(message => message.content)
  const combined = turns.at(-1) === journey
  if (stream && !combined) {
    assert.equal(turns.at(-1), '准备两版短片旁白')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end('data: ' + JSON.stringify({ choices: [{
      index: 0, delta: { role: 'assistant', content: '旁白生成完成' }, finish_reason: null,
    }] }) + '\n\ndata: [DONE]\n\n')
    return
  }
  if (model === 'browser-tool-model' || combined) {
    const names = tools.map(tool => tool.function.name)
    assert.ok(names.includes('read_canvas_context'))
    assert.ok(names.includes('load_canvas_skill'))
    assert.ok(!names.includes('write_file'))
    const result = messages.find(message => message.role === 'tool' && message.tool_call_id === 'context')
    const draft = result && JSON.parse(result.content)
    const draftText = Array.isArray(turns.at(-1)) ? turns.at(-1)[0]?.text : turns.at(-1)
    const requestDraftCard = draftText?.startsWith('新增潮水文本卡')
    const requestEdit = turns.at(-1) === '把这张卡的推近放慢'
    const requestLocalMovement = turns.at(-1) === '只把镜头三的推近放慢'
    const reference = Array.isArray(turns.at(-1)) && turns.at(-1).find(block => block.text?.startsWith('参考素材 1 '))
    const layoutRequest = typeof turns.at(-1) === 'string' && turns.at(-1).startsWith('把布局卡')
    const useSkill = turns.at(-1) === '只从摄影角度看'
    const loaded = messages.some(message => message.role === 'tool' && message.tool_call_id === 'load_canvas_skill')
    const proposed = messages.some(message => message.role === 'tool' && message.tool_call_id === 'proposal')
    const proposedLayout = messages.some(message => message.role === 'tool' && message.tool_call_id === 'layout')
    let answer = { role: 'assistant', content: requestEdit ? '已给出修改建议' : useSkill ? '建议保持景别，再选择机位。' : '找到原先的草稿' }
    if (!result) {
      answer = { role: 'assistant', tool_calls: [{
        id: 'context', type: 'function', function: { name: 'read_canvas_context', arguments: '{}' },
      }] }
    } else if (useSkill && !loaded) {
      answer = { role: 'assistant', tool_calls: [{
        id: 'load_canvas_skill', type: 'function', function: { name: 'load_canvas_skill',
          arguments: JSON.stringify({ skill_id: 'shot-staging' }) },
      }] }
    } else if (layoutRequest && !proposedLayout) {
      assert.ok(names.includes('propose_canvas_layout'))
      const card_ids = ['layout-left', 'layout-right']
      const positions = Object.fromEntries(card_ids.map(id => [id, {
        x: draft.layout_positions[id].x + 70, y: draft.layout_positions[id].y,
      }]))
      answer = { role: 'assistant', tool_calls: [{
        id: 'layout', type: 'function', function: { name: 'propose_canvas_layout',
          arguments: JSON.stringify({ card_ids, group_name: turns.at(-1).includes('分组') ? '片头' : undefined,
            placement: turns.at(-1).includes('整理') ? { kind: 'arrange' } : { kind: 'move', positions } }) },
      }] }
    } else if (combined && !proposed) {
      const card_id = draft.target_card_ids[0]
      const adopted = draft.cards.some(card => card.type === 'direction.movement')
      answer = { role: 'assistant', tool_calls: [{ id: 'proposal', type: 'function', function: adopted ? {
        name: 'propose_canvas_structure', arguments: JSON.stringify({
          change: { kind: 'adjust_shot_movement', card_id, field: 'movement_speed', text: '缓慢推近' },
        }),
      } : {
        name: 'propose_canvas_edit', arguments: JSON.stringify({
          card_id, target: { kind: 'video_prompt_segment', segment_id: 'text' }, text: '缓慢推近',
        }),
      } }] }
    } else if (requestEdit && !proposed) {
      const card = draft.cards.find(item => item.id === draft.target_card_ids[0])
      const target = card.type === 'direction.movement'
        ? { kind: 'movement_field', field: 'movement_speed' }
        : { kind: 'video_prompt_segment', segment_id: 'text' }
      const edit = { card_id: card.id, target, text: '缓慢推近' }
      const operation = card.type === 'direction.movement' ? {
        name: 'propose_canvas_edit_groups', arguments: JSON.stringify({ groups: [
          { title: '推进轨迹', edits: [edit, { card_id: card.id,
            target: { kind: 'movement_field', field: 'movement_path' }, text: '直线' }] },
          { title: '起点', edits: [{ card_id: card.id,
            target: { kind: 'movement_field', field: 'movement_start' }, text: '走廊入口' }] },
        ] }),
      } : { name: 'propose_canvas_edit', arguments: JSON.stringify(edit) }
      answer = { role: 'assistant', tool_calls: [{ id: 'proposal', type: 'function', function: operation }] }
    } else if (requestDraftCard && !proposed) {
      answer = { role: 'assistant', tool_calls: [{ id: 'proposal', type: 'function', function: {
        name: 'propose_canvas_structure', arguments: JSON.stringify({ change: { kind: 'add_text_card', text: '潮水涌入' } }),
      } }] }
    } else if (requestLocalMovement && !proposed) {
      answer = { role: 'assistant', tool_calls: [{ id: 'proposal', type: 'function', function: {
        name: 'propose_canvas_structure', arguments: JSON.stringify({
          change: { kind: 'adjust_shot_movement', card_id: draft.target_card_ids[0], field: 'movement_speed', text: '缓慢推近' },
        }),
      } }] }
    } else if (reference && !proposed) {
      const file = JSON.parse(reference.text.slice('参考素材 1 '.length))
      answer = { role: 'assistant', tool_calls: [{ id: 'proposal', type: 'function', function: {
        name: 'propose_canvas_structure', arguments: JSON.stringify({
          change: { kind: 'adopt_first_frame', card_id: draft.target_card_ids[0], file_id: file.file_id },
        }),
      } }] }
    } else if (!requestEdit && !requestLocalMovement && !reference && !layoutRequest) {
      observed.push(draft)
    }
    if (stream) {
      const delta = { ...answer, ...(answer.tool_calls ? { tool_calls: answer.tool_calls.map((call, index) => ({
        ...call, index,
      })) } : {}) }
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      response.end('data: ' + JSON.stringify({ id: 'edit-reply', model, choices: [{
        index: 0, delta, finish_reason: answer.tool_calls ? 'tool_calls' : 'stop',
      }] }) + '\n\ndata: [DONE]\n\n')
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      id: 'test-reply', object: 'chat.completion', created: 1, model,
      choices: [{ index: 0, finish_reason: answer.tool_calls ? 'tool_calls' : 'stop', message: answer }],
    }))
    return
  }
  assert.equal(model, 'browser-assistant-model')
  assert.equal(tools, undefined)
  const plainContext = typeof turns.at(-1) === 'string' && turns.at(-1).match(/本轮画布参考数据：\n(.+)\n\n用户请求：\n分析原卡片$/)
  if (plainContext) {
    observed.push(JSON.parse(plainContext[1]))
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({
      id: 'plain-context', object: 'chat.completion', created: 1, model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: '文字模型找到了当前草稿' } }],
    }))
    return
  }
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
  env: { ...process.env, CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: String(apiPort),
    CANVAS_BROWSER_ASSISTANT_PROVIDER: 'http://127.0.0.1:' + provider.address().port,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_ASSISTANT_REVIEW: '1' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, worker
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
    root, server: { host: '127.0.0.1', port: webPort, strictPort: true, open: false, proxy: { '/api': api } },
  })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const base = 'http://127.0.0.1:' + webPort
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
  await panel.getByRole('button', { name: '帮我构思一张起始画面' }).click()
  assert.equal(await panel.getByRole('textbox', { name: '给画布助手发消息' }).inputValue(), '帮我构思一张起始画面')
  assert.deepEqual(prompts, [], 'a starter fills the draft without sending')
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
  for (const [theme, expected] of [
    ['经典深色', 'rgb(27, 27, 27)'], ['雾蓝纯色', 'rgb(255, 255, 255)'], ['雾蓝微渐变', 'rgb(255, 255, 255)'],
  ]) {
    await page.getByRole('button', { name: '画布配色', exact: true }).click()
    await page.getByRole('menuitemradio', { name: theme, exact: true }).click()
    assert.equal(await panel.evaluate(element => getComputedStyle(element).backgroundColor), expected)
  }
  await page.mouse.move(120, 240)
  await page.setViewportSize({ width: 375, height: 720 })
  const narrow = await panel.boundingBox()
  assert.ok(narrow && narrow.x >= 0 && narrow.x + narrow.width <= 375, 'assistant fits the narrow viewport')
  await page.screenshot({ path: join(output, 'assistant-narrow.png') })
  await page.evaluate(() => {
    Object.defineProperty(visualViewport, 'height', { configurable: true, value: 380 })
    visualViewport.dispatchEvent(new Event('resize'))
  })
  const sendWithKeyboard = await panel.getByRole('button', { name: '发送消息' }).boundingBox()
  assert.ok(sendWithKeyboard && sendWithKeyboard.y + sendWithKeyboard.height <= 380, 'send remains above the keyboard')
  await page.evaluate(() => {
    Reflect.deleteProperty(visualViewport, 'height')
    visualViewport.dispatchEvent(new Event('resize'))
  })
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
      card('target', '已保存正文', true), card('other', '另一个同名模型卡'),
      ...(canvas.project_id ? [{ id: 'camera-movement', type: 'direction.movement',
        fields: { movement_speed: { text: '快速推近' } } }] : [])] }
    if (canvas.project_id) {
      for (const shot of ['target', 'other']) {
        const edgeId = 'shared-movement-' + shot
        document.edges.push({ id: edgeId, source_card: 'camera-movement', source_port: 'text',
          target_card: shot, target_port: 'text' })
        document.input_order[shot] = { text: [edgeId] }
      }
    }
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
    await panel.getByText('选中 1 张卡', { exact: true }).waitFor()
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('分析原卡片')
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('文字模型找到了当前草稿', { exact: true }).waitFor()
    assert.deepEqual(observed.at(-1).target_card_ids, ['target'])
    assert.equal(observed.at(-1).cards[0].prompt.segments[0].text, '只在本地编辑器看到')
    await page.getByRole('button', { name: '取消编辑', exact: true }).click()
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    await page.locator('[data-card-id="other"]').click()
    await open()
    await panel.getByRole('combobox', { name: '助手模型' }).click()
    await page.locator('.ant-select-item-option').getByText('browser-tool-model · 可读画布与提出修改', { exact: true }).click()
    await panel.getByText('browser-tool-model', { exact: true }).waitFor()
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('分析当前选中的卡片')
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('找到原先的草稿').waitFor()
    assert.deepEqual(observed.at(-1).target_card_ids, ['other'])
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('只从摄影角度看')
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('建议保持景别，再选择机位。', { exact: true }).waitFor()
    await panel.getByText('本轮使用的技能', { exact: true }).last().click()
    await panel.getByText('镜头与场面调度', { exact: true }).waitFor()
    await page.locator('[data-card-id="other"]').click()
    await panel.getByText('选中 1 张卡', { exact: true }).waitFor()
    const assistantDraft = panel.getByRole('textbox', { name: '给画布助手发消息' })
    await assistantDraft.fill('继续检查这张卡')
    const blank = await page.evaluate(() => {
      const surface = document.querySelector('.generation-surface')
      for (let y = 200; y < 800; y += 90) {
        for (let x = 160; x < 900; x += 80) {
          const target = document.elementFromPoint(x, y)
          if (surface.contains(target) && !target.closest('[data-card-id], .generation-group, button, input, select, textarea, .canvas-edge-hit')) {
            return { x, y }
          }
        }
      }
    })
    assert.ok(blank, 'the assistant leaves blank canvas reachable')
    await page.mouse.click(blank.x, blank.y)
    await panel.getByText('请选择卡片', { exact: true }).waitFor()
    assert.ok(await panel.getByRole('button', { name: '发送消息' }).isDisabled())
    assert.equal(await assistantDraft.inputValue(), '继续检查这张卡')
    await assistantDraft.fill('')
    const after = (await (await fetch(url)).json()).data
    assert.equal(after.document.cards.find(item => item.id === 'target').prompt.segments[0].text, '已保存正文')
    assert.equal(after.document.cards.find(item => item.id === 'target').model_id, 'original-video-generator')
    await page.reload()
    await open()
    await panel.getByText('browser-tool-model', { exact: true }).waitFor()
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    const target = canvas.project_id ? 'camera-movement' : 'target'
    await page.locator('[data-card-id="' + target + '"]').click()
    if (canvas.project_id) await page.getByRole('button', { name: '关闭详情', exact: true }).click()
    await open()
    const writer = panel.getByRole('textbox', { name: '给画布助手发消息' })
    await writer.evaluate((input, ref) => {
      const clipboardData = new DataTransfer()
      clipboardData.setData('text/plain', 'jellyfish:cards:1:' + JSON.stringify(ref))
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData }))
    }, { canvasId: canvas.id, cardIds: [target] })
    await panel.getByLabel('引用卡片', { exact: true }).first().getByRole('button').waitFor()
    await writer.fill('把这张卡的推近放慢')
    await panel.getByRole('button', { name: '发送消息' }).click()
    const proposal = panel.getByRole('region', { name: '修改建议' }).last()
    await proposal.getByText('缓慢推近', { exact: true }).waitFor()
    const original = canvas.project_id ? '快速推近' : '已保存正文'
    await proposal.getByText(original, { exact: true }).waitFor()
    const markedCard = page.locator('[data-card-id="' + target + '"]')
    const originalSelection = await markedCard.getAttribute('data-selected')
    await panel.getByRole('button', { name: '查看影响范围', exact: true }).last().click()
    assert.equal(await markedCard.getAttribute('data-assistant-highlight'), 'true')
    assert.equal(await markedCard.getAttribute('data-selected'), originalSelection)
    await panel.getByRole('button', { name: '隐藏影响范围', exact: true }).click()
    assert.notEqual(await markedCard.getAttribute('data-assistant-highlight'), 'true')
    await panel.getByRole('button', { name: '查看影响范围', exact: true }).last().click()
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    assert.equal(await markedCard.getAttribute('data-assistant-highlight'), 'true')
    await open()
    await proposal.getByText(original, { exact: true }).waitFor()
    const storedText = async () => {
      const current = (await (await fetch(url)).json()).data
      const edited = current.document.cards.find(item => item.id === target)
      return canvas.project_id ? edited.fields.movement_speed.text : edited.prompt.segments[0].text
    }
    assert.equal(await storedText(), original)
    const confirmation = panel.getByRole('textbox', { name: '给画布助手发消息' })
    if (canvas.project_id) {
      assert.ok(await proposal.getByRole('button', { name: '写入所选 0 组' }).isDisabled())
      await confirmation.fill('确认')
      await confirmation.press('Enter')
      await panel.getByText('请先勾选要批准的改动组，或回复「全部确认」。', { exact: true }).waitFor()
      assert.equal(await storedText(), original)
      await proposal.getByRole('checkbox', { name: '推进轨迹' }).check()
    }
    const approvalRequests = []
    const trackApproval = request => {
      if (request.method() === 'POST' && new URL(request.url()).pathname.includes('/assistant/proposals/')) {
        approvalRequests.push(request.url())
      }
    }
    page.on('request', trackApproval)
    await confirmation.fill('确认')
    await confirmation.press('End')
    await confirmation.press('Shift+Enter')
    assert.equal(await confirmation.inputValue(), '确认\n')
    await confirmation.fill('确认')
    await confirmation.dispatchEvent('keydown', { key: 'Enter', keyCode: 229, isComposing: true })
    await delay(200)
    assert.equal(approvalRequests.length, 0)
    assert.equal(await storedText(), original)
    await confirmation.press('Enter')
    await proposal.getByText('已写入画布', { exact: true }).waitFor()
    assert.equal(approvalRequests.length, 1)
    page.off('request', trackApproval)
    assert.equal(await storedText(), '缓慢推近')
    const storedMovement = async () => (await (await fetch(url)).json()).data.document.cards
      .find(item => item.id === target).fields
    if (canvas.project_id) {
      await page.setViewportSize({ width: 375, height: 460 })
      const conversationLog = panel.getByRole('log')
      await conversationLog.evaluate(log => { log.scrollTop = log.scrollHeight })
      await conversationLog.hover()
      await page.mouse.wheel(0, -1200)
      await panel.getByRole('button', { name: '返回最新进展', exact: true }).click()
      await page.waitForFunction(() => {
        const log = document.querySelector('.canvas-assistant-history')
        return log.scrollHeight - log.scrollTop - log.clientHeight < 40
      })
      await page.setViewportSize({ width: 1440, height: 960 })
      await confirmation.focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Shift+Tab')
      assert.equal(await confirmation.evaluate(input =>
        getComputedStyle(input.closest('.canvas-assistant-sender')).outlineStyle), 'solid')
      const fields = await storedMovement()
      assert.equal(fields.movement_path.text, '直线')
      assert.notEqual(fields.movement_start.text, '走廊入口')
    }
    await page.screenshot({ path: join(output, canvas.project_id ? 'assistant-scene-edit.png' : 'assistant-free-edit.png') })
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    await page.getByRole('button', { name: '撤销操作', exact: true }).click()
    for (let attempt = 0; attempt < 40 && await storedText() !== original; attempt++) await delay(150)
    assert.equal(await storedText(), original, 'one undo restores the saved field')
    if (canvas.project_id) {
      assert.notEqual((await storedMovement()).movement_path.text, '直线')
      await page.locator('[data-card-id="target"]').click()
      await open()
      await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('只把镜头三的推近放慢')
      await panel.getByRole('button', { name: '发送消息' }).click()
      const isolated = panel.getByRole('region', { name: '修改建议' }).last()
      await isolated.getByText('新建专属运镜', { exact: true }).waitFor()
      await isolated.getByText('保留原运镜的卡片', { exact: true }).waitFor()
      await isolated.getByText('other', { exact: true }).waitFor()
      await isolated.getByRole('checkbox', { name: '只修改所选镜头的运镜' }).check()
      await isolated.getByRole('button', { name: '写入所选 1 组' }).click()
      await isolated.getByText('已写入画布', { exact: true }).waitFor()
      const shotBindings = async () => {
        const current = (await (await fetch(url)).json()).data.document
        return ['target', 'other'].map(id => current.cards.find(card => card.id === id).input_bindings[0].source.card_id)
      }
      const [selectedMovement, otherMovement] = await shotBindings()
      assert.notEqual(selectedMovement, 'camera-movement')
      assert.equal(otherMovement, 'camera-movement')
      await page.screenshot({ path: join(output, 'assistant-shared-movement.png') })
      await panel.getByRole('button', { name: '关闭画布助手' }).click()
      await page.getByRole('button', { name: '撤销操作', exact: true }).click()
      for (let attempt = 0; attempt < 40 && (await shotBindings())[0] !== 'camera-movement'; attempt++) await delay(150)
      assert.deepEqual(await shotBindings(), ['camera-movement', 'camera-movement'])
    } else {
      await open()
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAwAAAAMCAIAAADZF8uwAAAAF0lEQVR4nGP8z0AYMBGhhmFUEQOdgwAAz+ABFyTybdUAAAAASUVORK5CYII=', 'base64')
      await panel.getByLabel('上传对话参考素材').setInputFiles({ name: '首帧红船.png', mimeType: 'image/png', buffer: png })
      await panel.getByRole('button', { name: '移除 首帧红船', exact: true }).waitFor()
      await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('把这张图用作首帧')
      await panel.getByRole('button', { name: '发送消息' }).click()
      const structure = panel.getByRole('region', { name: '修改建议' }).last()
      await structure.getByText('首帧红船', { exact: true }).waitFor()
      await structure.getByText('首帧', { exact: true }).waitFor()
      await structure.getByRole('checkbox', { name: '建卡、连线并采用首帧' }).check()
      await page.screenshot({ path: join(output, 'assistant-first-frame-preview.png') })
      await structure.getByRole('button', { name: '写入所选 1 组' }).click()
      await structure.getByText('已写入画布', { exact: true }).waitFor()
      const inspectGraph = async () => (await (await fetch(url)).json()).data.document
      const adopted = await inspectGraph()
      assert.equal(adopted.cards.filter(card => card.type === 'content.image').length, 1)
      assert.equal(adopted.edges.filter(edge => edge.target_card === target && edge.target_port === 'first_frame').length, 1)
      assert.equal(adopted.cards.find(card => card.id === target).input_bindings.filter(binding => binding.input_port === 'first_frame').length, 1)
      await panel.getByRole('button', { name: '关闭画布助手' }).click()
      await page.getByRole('button', { name: '撤销操作', exact: true }).click()
      for (let attempt = 0; attempt < 40 && (await inspectGraph()).edges.length; attempt++) await delay(150)
      const undone = await inspectGraph()
      assert.equal(undone.cards.filter(card => card.type === 'content.image').length, 0)
      assert.equal(undone.edges.length, 0)
      assert.equal(undone.cards.find(card => card.id === target).input_bindings.length, 0)
    }
    if (!canvas.project_id) {
      await open()
      const setMode = async name => {
        await panel.getByRole('combobox', { name: '审批模式' }).click()
        await page.locator('.ant-select-item-option').getByText(name, { exact: true }).click()
        await panel.locator('.ant-select-content').filter({ hasText: name }).waitFor()
      }
      await setMode('自动审批明确请求')
      await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('把这张卡的推近放慢')
      await panel.getByRole('button', { name: '发送消息' }).click()
      await panel.getByText('自动审批明确请求 · 已写入画布', { exact: true }).waitFor()
      assert.equal(await storedText(), '缓慢推近')
      await panel.getByRole('button', { name: '关闭画布助手' }).click()
      await page.getByRole('button', { name: '撤销操作', exact: true }).click()
      for (let attempt = 0; attempt < 40 && await storedText() !== original; attempt++) await delay(150)
      assert.equal(await storedText(), original)
      await page.reload()
      await open()
      await panel.getByText('自动审批明确请求 · 已写入画布', { exact: true }).waitFor()
      await panel.getByText('自动审批明确请求', { exact: true }).waitFor()
      await setMode('手动审批')
    } else {
      await open()
      await panel.getByText('手动审批', { exact: true }).waitFor()
    }
  }
  assert.equal(observed.length, 6)
  const layoutCanvas = (await (await fetch(canvasApi, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '布局回执' }),
  })).json()).data
  const layoutUrl = canvasApi + '/' + layoutCanvas.id
  const layoutSeed = await fetch(layoutUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'layout-fixture', expected_revision: layoutCanvas.revision,
      document: { ...layoutCanvas.document, cards: [
        { id: 'layout-left', type: 'content.text' }, { id: 'layout-right', type: 'content.text' },
      ] } }),
  })
  assert.ok(layoutSeed.ok, await layoutSeed.clone().text())
  const selectLayoutModel = await fetch(layoutUrl + '/assistant/model', {
    method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model_id: 'browser-tool-model' }),
  })
  assert.ok(selectLayoutModel.ok, await selectLayoutModel.clone().text())
  const layoutPath = base + '/canvases/' + layoutCanvas.id
  await page.goto(layoutPath)
  const leftCard = page.locator('[data-card-id="layout-left"]')
  await leftCard.waitFor()
  const left = async () => Number.parseFloat(await leftCard.evaluate(el => el.style.left))
  const beforeLayout = await left()
  assert.ok(Number.isFinite(beforeLayout))
  await open()
  const requestLayout = async text => {
    if (!await panel.locator('.ant-select-content').filter({ hasText: '审看整张画布' }).count()) {
      await panel.getByRole('combobox', { name: '提问范围' }).click()
      await page.locator('.ant-select-item-option').getByText('审看整张画布', { exact: true }).click()
    }
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill(text)
    await panel.getByRole('button', { name: '发送消息' }).click()
    const proposal = panel.getByRole('region', { name: '布局建议' }).last()
    await proposal.getByRole('button', { name: '确认布局' }).waitFor()
    return proposal
  }
  const groupLayout = await requestLayout('把布局卡分组并向右移')
  const readLayoutGroups = async () => (await (await fetch(layoutUrl)).json()).data.document.groups
  let groupSaveArrived
  let allowGroupSave
  const groupSaveStarted = new Promise(resolve => { groupSaveArrived = resolve })
  const groupSaveAllowed = new Promise(resolve => { allowGroupSave = resolve })
  const groupSaveRoute = async route => {
    if (route.request().method() !== 'PUT' || !route.request().postDataJSON()?.document?.groups?.length) {
      await route.continue()
      return
    }
    groupSaveArrived()
    await groupSaveAllowed
    await route.continue()
  }
  const isLayoutDocument = url => url.pathname.endsWith('/generation-canvases/' + layoutCanvas.id)
  await page.route(isLayoutDocument, groupSaveRoute)
  await groupLayout.getByRole('button', { name: '确认布局' }).click()
  try {
    await Promise.race([groupSaveStarted, delay(8000).then(() => { throw new Error('layout group save not observed') })])
    assert.equal(await left(), beforeLayout)
    assert.deepEqual(await readLayoutGroups(), [])
  } finally {
    allowGroupSave()
  }
  await groupLayout.getByText('布局已执行', { exact: true }).waitFor()
  await page.unroute(isLayoutDocument, groupSaveRoute)
  assert.equal(await left(), beforeLayout + 70)
  assert.deepEqual((await readLayoutGroups())[0].card_ids, ['layout-left', 'layout-right'])
  await panel.getByRole('button', { name: '关闭画布助手' }).click()
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  assert.equal(await left(), beforeLayout)
  for (let attempt = 0; attempt < 40 && (await readLayoutGroups()).length; attempt++) await delay(150)
  assert.equal((await readLayoutGroups()).length, 0)
  await open()
  const delayed = await requestLayout('把布局卡再向右移')
  await page.route('**/assistant/layout/**', async route => {
    const committed = await route.fetch()
    assert.equal((await committed.json()).data.state, 'waiting')
    await route.abort()
  }, { times: 1 })
  await delayed.getByRole('button', { name: '确认布局' }).click()
  await delayed.getByText('布局决定提交失败', { exact: true }).waitFor()
  assert.equal(await left(), beforeLayout)
  await page.reload()
  await open()
  await panel.getByRole('region', { name: '布局建议' }).last().getByText('布局已执行', { exact: true }).waitFor()
  assert.equal(await left(), beforeLayout + 70)
  await page.reload()
  await leftCard.waitFor()
  assert.equal(await left(), beforeLayout + 70)
  await open()
  const stale = await requestLayout('把布局卡最后向右移')
  await panel.getByRole('button', { name: '关闭画布助手' }).click()
  await leftCard.focus()
  await page.keyboard.press('ArrowRight')
  const handMoved = await left()
  assert.notEqual(handMoved, beforeLayout + 70)
  await open()
  await stale.getByRole('button', { name: '确认布局' }).click()
  await stale.getByText('布局未执行，请核对当前卡片和位置', { exact: true }).waitFor()
  assert.equal(await left(), handMoved)
  const arranged = await requestLayout('把布局卡整理整齐')
  let droppedReceipt = false
  await page.route('**/assistant/layout/**', async route => {
    if (!droppedReceipt && route.request().postDataJSON()?.action === 'applied') {
      const committed = await route.fetch()
      assert.equal((await committed.json()).data.state, 'applied')
      droppedReceipt = true
      await route.abort()
    } else await route.continue()
  })
  await arranged.getByRole('button', { name: '确认布局' }).click()
  await arranged.getByText('布局已执行', { exact: true }).waitFor()
  assert.equal(droppedReceipt, true)
  assert.notEqual(await left(), handMoved)
  await page.unroute('**/assistant/layout/**')
  const freeUrl = canvasApi + '/' + free.id
  const current = (await (await fetch(freeUrl)).json()).data
  const withVoiceover = {
    ...current.document,
    cards: [...current.document.cards, {
      id: 'voiceover', type: 'model.text', model_id: 'browser-assistant-model',
      prompt: { segments: [{ id: 'text', kind: 'text', text: '准备两版短片旁白' }] },
    }],
  }
  const voiceoverSave = await fetch(freeUrl, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'add-voiceover', expected_revision: current.revision, document: withVoiceover }),
  })
  assert.ok(voiceoverSave.ok, await voiceoverSave.clone().text())
  await page.goto(base + '/canvases/' + free.id)
  await page.locator('[data-card-id="voiceover"]').click()
  await open()
  await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('生成两版')
  await panel.getByRole('button', { name: '发送消息' }).click()
  await panel.getByText('已授权生成版本数 2 · 已排队，等待提交', { exact: true }).waitFor()
  const workerEntrypoint = 'import asyncio; from tests.generation_canvas_browser_server import configure_media_storage; from app.task_worker import main; configure_media_storage(); asyncio.run(main())'
  worker = spawn(python || 'uv', [...(python ? [] : ['run', '--no-sync', 'python']), '-c', workerEntrypoint], {
    cwd: join(root, '../backend'),
    env: { ...process.env, DATABASE_URL: 'sqlite+aiosqlite:///' + join(output, 'browser.sqlite'),
      CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'),
      S3_PUBLIC_BASE_URL: api },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  captureBackend(worker, output)
  await panel.getByText('已授权生成版本数 2 · 已生成', { exact: true }).waitFor({ timeout: 15_000 })
  assert.equal(await panel.getByRole('button', { name: '查看运行', exact: true }).count(), 2)
  await page.screenshot({ path: join(output, 'assistant-generation.png') })
  await panel.getByRole('button', { name: '查看运行', exact: true }).last().click()
  await page.getByRole('region', { name: '画布运行历史' }).locator('details[data-history-run][open]')
    .getByText('旁白生成完成', { exact: true }).waitFor()
  await page.goto(base + '/canvases/' + free.id)
  await page.locator('[data-card-id="voiceover"]').click()
  await open()
  await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('生成一版，完成后看看动作是否连贯')
  await panel.getByRole('button', { name: '发送消息' }).click()
  await panel.getByText('等待生成结果以审看').waitFor()
  await panel.getByRole('button', { name: '关闭画布助手' }).click()
  await open()
  await panel.getByText('该次运行没有可审看的图片或视频。', { exact: true }).waitFor({ timeout: 15_000 })
  await panel.getByRole('button', { name: '查看审看的运行', exact: true }).click()
  await page.getByRole('region', { name: '画布运行历史' }).locator('details[data-history-run][open]')
    .getByText('旁白生成完成', { exact: true }).waitFor()

  for (const canvas of [free, scene]) {
    const url = canvas.project_id ? storyboardCanvasApi(canvasApi, canvas.id) : canvasApi + '/' + canvas.id
    const extra = canvas.project_id ? '?project_id=' + canvas.project_id : ''
    const read = async (resource = '') => (await (await fetch(url.split('?')[0] + resource + extra)).json()).data
    const before = await read()
    const mirror = before.document.cards.find(card => card.id === 'other')
    const originalMovement = before.document.cards.find(card => card.id === 'camera-movement')
    const target = before.document.cards.find(card => card.id === 'target')
    target.config.seconds = 4
    before.document.groups.push({ id: 'ticket-17-shot-three', name: '镜头三', card_ids: ['target'] },
      { id: 'ticket-17-shot-four', name: '镜头四', card_ids: ['other'] })
    const seeded = await fetch(url, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: 'ticket-17-seed-video', expected_revision: before.revision,
        document: before.document }),
    })
    assert.ok(seeded.ok, await seeded.clone().text())
    const originalRuns = (await read('/runtime')).runs
    const requestCount = videoRequests.length
    await page.goto(base + (canvas.project_id ? storyboardCanvasPath(canvas) : '/canvases/' + canvas.id))
    await page.locator('[data-card-id="target"]').click()
    await open()
    await panel.getByRole('combobox', { name: '助手模型' }).click()
    await page.locator('.ant-select-item-option').getByText('qwen3.8-omni-flash', { exact: false }).click()
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill(journey)
    await panel.getByRole('button', { name: '发送消息' }).click()
    const proposal = panel.getByRole('region', { name: '修改建议' }).last()
    await proposal.getByText('缓慢推近', { exact: true }).waitFor()
    await panel.getByText('已授权生成版本数 1 · 批准修改后生成', { exact: true }).waitFor()
    assert.equal((await read('/runtime')).runs.length, originalRuns.length, 'no admission before approval')
    if (canvas.project_id) {
      await proposal.getByText('other', { exact: true }).waitFor()
      await proposal.getByRole('checkbox', { name: '只修改所选镜头的运镜' }).check()
    } else {
      await proposal.getByText(target.prompt.segments[0].text, { exact: true }).waitFor()
    }
    await proposal.getByRole('button', { name: canvas.project_id ? '写入所选 1 组' : '确认写入', exact: true }).click()
    await proposal.getByText('已写入画布', { exact: true }).waitFor()
    await panel.getByText('连续画面 0–2 秒为红色，没有音轨，无法判断声画同步。', { exact: true })
      .last().waitFor({ timeout: 30_000 })
    const after = (await read()).document
    const afterTarget = after.cards.find(card => card.id === 'target')
    assert.deepEqual(after.cards.find(card => card.id === 'other'), mirror)
    if (canvas.project_id) {
      assert.deepEqual(after.cards.find(card => card.id === 'camera-movement'), originalMovement)
      const movement = afterTarget.input_bindings[0].source.card_id
      assert.notEqual(movement, originalMovement.id)
      assert.equal(after.cards.find(card => card.id === movement).fields.movement_speed.text, '缓慢推近')
    } else {
      assert.equal(afterTarget.prompt.segments[0].text, '缓慢推近')
      assert.ok(after.cards.every(card => !card.type.startsWith('direction.')))
    }
    const [turn] = (await read('/assistant')).turns.filter(turn => turn.text === journey)
    const added = (await read('/runtime')).runs.filter(run => !originalRuns.some(original => original.id === run.id))
    assert.equal(added.length, 1)
    assert.equal(videoRequests.length - requestCount, 1)
    assert.match(videoRequests.at(-1).prompt, /缓慢推近/)
    assert.equal(added[0].nodes[0].card_id, 'target')
    assert.equal(turn.generation.versions[0].run_id, added[0].id)
    assert.equal(turn.generation.review.results[0].run_id, added[0].id)
    const [observation] = turn.generation.review.results[0].evidence
    assert.equal(observation.observation, 'video_sequence')
    assert.equal(observation.start_ms, 0)
    assert.equal(observation.end_ms, 2000)
    assert.equal(observation.audio_start_ms ?? null, null)
    assert.match(reviewInputs.at(-1).video_url.url, /^data:video\/mp4;base64,/)
    await page.screenshot({ path: join(output, canvas.project_id ? 'assistant-journey-scene.png' : 'assistant-journey-free.png') })
  }
  const totalCanvases = async () => (await (await fetch(canvasApi)).json()).data.pagination.total
  const beforeDrafts = await totalCanvases()
  const newDraft = async () => {
    await page.goto(base + '/canvases')
    await page.getByRole('button', { name: /新建画布/ }).click()
    await page.getByText('尚未创建', { exact: true }).waitFor()
    return new URL(page.url()).pathname.split('/').at(-1)
  }
  const conversationDraft = await newDraft()
  await open()
  await ask('草稿里先聊')
  await page.reload()
  await open()
  await panel.getByText('答复 草稿里先聊', { exact: true }).waitFor()
  assert.equal(await totalCanvases(), beforeDrafts)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByText('已保存', { exact: true }).waitFor()
  assert.equal(await totalCanvases(), beforeDrafts + 1)
  assert.equal((await (await fetch(canvasApi + '/' + conversationDraft + '/assistant')).json()).data.turns.length, 1)

  const cardDraft = await newDraft()
  await open()
  assert.equal(await panel.getByText('答复 草稿里先聊', { exact: true }).count(), 0)
  await panel.getByRole('combobox', { name: '助手模型' }).click()
  await page.locator('.ant-select-item-option').getByText('browser-tool-model · 可读画布与提出修改', { exact: true }).click()
  await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('新增潮水文本卡')
  await panel.getByRole('button', { name: '发送消息' }).click()
  const draftProposal = panel.getByRole('region', { name: '修改建议' })
  await draftProposal.getByText('潮水涌入', { exact: true }).last().waitFor()
  assert.equal(await totalCanvases(), beforeDrafts + 1)
  const draftSave = '**/generation-canvases/drafts/' + cardDraft
  let lostSave = false
  await page.route(draftSave, async route => {
    if (route.request().method() !== 'PUT' || lostSave) {
      return route.continue()
    }
    const saved = await route.fetch()
    assert.ok(saved.ok(), await saved.text())
    lostSave = true
    await route.abort()
  })
  await draftProposal.getByRole('checkbox', { name: '新建文本', exact: false }).check()
  await draftProposal.getByRole('button', { name: '写入所选 1 组' }).click()
  await page.getByText('请求结果未知，请重试核实原请求', { exact: true }).waitFor()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByText('已保存', { exact: true }).waitFor()
  await draftProposal.getByText('已写入画布', { exact: true }).waitFor()
  const storedDraft = (await (await fetch(canvasApi + '/' + cardDraft)).json()).data
  assert.equal(storedDraft.document.cards.filter(card => card.text === '潮水涌入').length, 1)
  assert.equal(await totalCanvases(), beforeDrafts + 2)
  console.log('Assistant conversation persisted independently on both real canvas entries.')
} finally {
  acceptSlowReply()
  if (worker?.pid && worker.exitCode === null && worker.signalCode === null) {
    const exited = once(worker, 'close')
    worker.kill()
    await exited
  }
  await cleanup()
  provider.close()
}
