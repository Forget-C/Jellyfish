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
const apiPort = Number(process.env.CANVAS_ASSISTANT_TEST_API_PORT || 8462)
const webPort = Number(process.env.CANVAS_ASSISTANT_TEST_WEB_PORT || 4462)
const api = 'http://127.0.0.1:' + apiPort
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
  const { model, messages, tools, stream } = JSON.parse(Buffer.concat(chunks).toString())
  const turns = messages.filter(message => message.role === 'user').map(message => message.content)
  if (stream) {
    assert.equal(turns.at(-1), '准备两版短片旁白')
    response.writeHead(200, { 'Content-Type': 'text/event-stream' })
    response.end('data: ' + JSON.stringify({ choices: [{
      index: 0, delta: { role: 'assistant', content: '旁白生成完成' }, finish_reason: null,
    }] }) + '\n\ndata: [DONE]\n\n')
    return
  }
  if (model === 'browser-tool-model') {
    const names = tools.map(tool => tool.function.name)
    assert.ok(names.includes('read_canvas_context'))
    assert.ok(names.includes('load_canvas_skill'))
    assert.ok(!names.includes('write_file'))
    const result = messages.find(message => message.role === 'tool' && message.tool_call_id === 'context')
    const draft = result && JSON.parse(result.content)
    const requestEdit = turns.at(-1) === '把这张卡的推近放慢'
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
    } else if (!requestEdit && !layoutRequest) {
      observed.push(draft)
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
    CANVAS_BROWSER_ASSISTANT_PROVIDER: 'http://127.0.0.1:' + provider.address().port },
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
      card('target', '已保存正文', true), card('other', '另一个同名模型卡'),
      ...(canvas.project_id ? [{ id: 'camera-movement', type: 'direction.movement',
        fields: { movement_speed: { text: '快速推近' } } }] : [])] }
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
    await panel.getByTitle('默认模型 · browser-assistant-model · 仅文字对话', { exact: true }).click()
    await page.locator('.ant-select-item-option').getByText('browser-tool-model · 可读画布', { exact: true }).click()
    await panel.getByTitle('browser-tool-model · 可读画布', { exact: true }).waitFor()
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('找到原先的草稿').waitFor()
    assert.deepEqual(observed.at(-1).target_card_ids, ['target'])
    assert.equal(observed.at(-1).cards[0].prompt.segments[0].text, '只在本地编辑器看到')
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('只从摄影角度看')
    await panel.getByRole('button', { name: '发送消息' }).click()
    await panel.getByText('建议保持景别，再选择机位。', { exact: true }).waitFor()
    await panel.getByText('镜头与场面调度', { exact: true }).waitFor()
    const after = (await (await fetch(url)).json()).data
    assert.equal(after.document.cards.find(item => item.id === 'target').prompt.segments[0].text, '已保存正文')
    assert.equal(after.document.cards.find(item => item.id === 'target').model_id, 'original-video-generator')
    await page.reload()
    await open()
    await panel.getByTitle('browser-tool-model · 可读画布', { exact: true }).waitFor()
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    const target = canvas.project_id ? 'camera-movement' : 'target'
    await page.locator('[data-card-id="' + target + '"]').click()
    if (canvas.project_id) await page.getByRole('button', { name: '关闭详情', exact: true }).click()
    await open()
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill('把这张卡的推近放慢')
    await panel.getByRole('button', { name: '发送消息' }).click()
    const proposal = panel.getByRole('region', { name: '修改建议' }).last()
    await proposal.getByText('缓慢推近', { exact: true }).waitFor()
    const original = canvas.project_id ? '快速推近' : '已保存正文'
    await proposal.getByText(original, { exact: true }).waitFor()
    const storedText = async () => {
      const current = (await (await fetch(url)).json()).data
      const edited = current.document.cards.find(item => item.id === target)
      return canvas.project_id ? edited.fields.movement_speed.text : edited.prompt.segments[0].text
    }
    assert.equal(await storedText(), original)
    if (canvas.project_id) await proposal.getByRole('checkbox', { name: '推进轨迹' }).check()
    await proposal.getByRole('button', { name: '确认写入', exact: true }).click()
    await proposal.getByText('已写入画布', { exact: true }).waitFor()
    assert.equal(await storedText(), '缓慢推近')
    const storedMovement = async () => (await (await fetch(url)).json()).data.document.cards
      .find(item => item.id === target).fields
    if (canvas.project_id) {
      const fields = await storedMovement()
      assert.equal(fields.movement_path.text, '直线')
      assert.notEqual(fields.movement_start.text, '走廊入口')
    }
    await page.screenshot({ path: join(output, canvas.project_id ? 'assistant-scene-edit.png' : 'assistant-free-edit.png') })
    await panel.getByRole('button', { name: '关闭画布助手' }).click()
    await page.getByRole('button', { name: '撤销操作', exact: true }).click()
    for (let attempt = 0; attempt < 40 && await storedText() !== original; attempt++) await delay(150)
    assert.equal(await storedText(), original, 'one undo restores the saved field')
    if (canvas.project_id) assert.notEqual((await storedMovement()).movement_path.text, '直线')
    if (!canvas.project_id) {
      await open()
      const automatic = panel.getByRole('checkbox', { name: '自动审批明确请求' })
      await automatic.click()
      await panel.locator('input[type="checkbox"]:checked').and(automatic).waitFor()
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
      assert.ok(await automatic.isChecked())
      await automatic.click()
      await panel.locator('input[type="checkbox"]:not(:checked)').and(automatic).waitFor()
    } else {
      await open()
      assert.equal(await panel.getByRole('checkbox', { name: '自动审批明确请求' }).isChecked(), false)
    }
  }
  assert.equal(observed.length, 4)
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
    if (!await panel.getByTitle('审看整张画布', { exact: true }).count()) {
      await panel.getByTitle('仅对话', { exact: true }).click()
      await page.locator('.ant-select-item-option').getByText('审看整张画布', { exact: true }).click()
    }
    await panel.getByRole('textbox', { name: '给画布助手发消息' }).fill(text)
    await panel.getByRole('button', { name: '发送消息' }).click()
    const proposal = panel.getByRole('region', { name: '布局建议' }).last()
    await proposal.getByRole('button', { name: '确认布局' }).waitFor()
    return proposal
  }
  const groupLayout = await requestLayout('把布局卡分组并向右移')
  await groupLayout.getByRole('button', { name: '确认布局' }).click()
  await groupLayout.getByText('布局已执行', { exact: true }).waitFor()
  assert.equal(await left(), beforeLayout + 70)
  const readLayoutGroups = async () => (await (await fetch(layoutUrl)).json()).data.document.groups
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
  worker = spawn(python || 'uv', [...(python ? [] : ['run', '--no-sync', 'python']), '-m', 'app.task_worker'], {
    cwd: join(root, '../backend'),
    env: { ...process.env, DATABASE_URL: 'sqlite+aiosqlite:///' + join(output, 'browser.sqlite') },
    stdio: 'ignore',
  })
  await panel.getByText('已授权生成版本数 2 · 已生成', { exact: true }).waitFor({ timeout: 15_000 })
  assert.equal(await panel.getByRole('button', { name: '查看运行', exact: true }).count(), 2)
  await page.screenshot({ path: join(output, 'assistant-generation.png') })
  await panel.getByRole('button', { name: '查看运行', exact: true }).last().click()
  await page.getByRole('region', { name: '画布运行历史' }).locator('details[data-history-run][open]')
    .getByText('旁白生成完成', { exact: true }).waitFor()
  console.log('Assistant conversation persisted independently on both real canvas entries.')
} finally {
  acceptSlowReply()
  if (worker && worker.exitCode === null) worker.kill()
  await cleanup()
  provider.close()
}
