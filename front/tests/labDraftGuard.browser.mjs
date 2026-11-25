import { textTrialFrame } from './text-trial-events.mjs'
import { openLabAddition } from './lab-composer-actions.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-lab-draft-guard-')
const origin = 'http://127.0.0.1:4807'
const timestamp = '2026-11-10T00:00:00Z'
const labels = { text: '文本', image: '图片', video: '视频' }
const sessions = Object.entries(labels).map(([mode, label]) => ({
  id: mode + '-session', lab_type: mode, title: label + '历史', created_at: timestamp, updated_at: timestamp,
}))
sessions.push(
  { id: 'text-other', lab_type: 'text', title: '另一条文本历史', created_at: timestamp, updated_at: timestamp },
  { id: 'image-template', lab_type: 'image', title: '图片模板历史', created_at: timestamp, updated_at: timestamp },
)
const histories = new Map()
const generationRequests = []
const stopRequests = []
const deleteRequests = []
const streams = new Set()
let live
let holdAcceptance = false
let releaseCreation
let creationGate
let stopBehavior = 'reject'
let heldStop
const message = (session_id, id, role, content, sequence, fields = {}) => ({
  id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp, ...fields,
})
const saveMessages = (sessionId, ...items) => histories.set(sessionId, [...(histories.get(sessionId) ?? []), ...items])
const writeFrame = (run, event, data) => {
  const sequence = ++run.sequence
  const kind = { accepted: 'turn.accepted', completed: 'turn.completed', cancelled: 'turn.stopped' }[event]
  run.response.write(textTrialFrame(run.sessionId, run.taskId, sequence, kind, data))
}
const accept = run => {
  const user = message(run.sessionId, run.taskId + '-user', 'user', run.prompt, run.historySequence + 1)
  saveMessages(run.sessionId, user)
  writeFrame(run, 'accepted', { user_message: user })
}
const finish = (run, event) => {
  if (event === 'completed') {
    const assistant = message(run.sessionId, run.taskId + '-assistant', 'assistant', '同时收到的完整结果', run.historySequence + 2)
    saveMessages(run.sessionId, assistant)
    writeFrame(run, event, { assistant_message: assistant, result: { text: assistant.content, model_id: 'text-model', provider_request_id: null, input_tokens: null, output_tokens: null } })
  } else writeFrame(run, event, { reason: 'user_cancelled' })
  run.response.end()
}
async function liveTextFixture(request, response, next) {
  const path = request.url?.split('?')[0] ?? ''
  const send = path.match(/\/chat\/sessions\/text\/([^/]+)\/turns$/)
  const stream = path.match(/\/chat\/sessions\/text\/([^/]+)\/events$/)
  const stop = path.match(/\/chat\/sessions\/text\/([^/]+)\/turns\/([^/]+)\/stop$/)
  if (!send && !stream && !stop) return next()
  let body = ''
  for await (const chunk of request) body += chunk
  if (send) {
    const input = JSON.parse(body)
    generationRequests.push(input)
    live = { sessionId: send[1], taskId: 'run-' + generationRequests.length, sequence: 0,
      prompt: input.content, historySequence: (histories.get(send[1]) ?? []).at(-1)?.sequence ?? 0 }
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ data: { turn_id: live.taskId, cursor: 0 } }))
    return
  }
  if (stream) {
    live.response = response
    response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' })
    response.flushHeaders()
    streams.add(response)
    response.once('close', () => streams.delete(response))
    if (!holdAcceptance) accept(live)
    return
  }
  stopRequests.push({ sessionId: stop[1], taskId: stop[2], connected: streams.has(live.response), body: JSON.parse(body) })
  const acknowledge = (status = 'cancelled') => {
    response.writeHead(200, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ success: true, data: { task_id: stop[2], status } }))
  }
  if (stopBehavior === 'reject') {
    response.writeHead(503, { 'Content-Type': 'application/json' })
    response.end(JSON.stringify({ detail: '停止请求暂不可用' }))
  } else if (stopBehavior === 'hold') heldStop = acknowledge
  else acknowledge()
}
const server = await createServer({
  root,
  cacheDir: join(output, 'vite'),
  server: { host: '127.0.0.1', port: 4807, strictPort: true, open: false },
  plugins: [{ name: 'isolated-live-text-fixture', configureServer: vite => { vite.middlewares.use(liveTextFixture) } }],
})

let browser
let page
const cleanup = browserCleanup(() => {
  for (const response of streams) response.end()
  heldStop?.()
  return { browser, server }
})

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (/\/chat\/sessions\/text\/[^/]+\/(events|turns|turns\/[^/]+\/stop)$/.test(url.pathname)) return route.continue()
    if (url.pathname.includes('/chat/sessions/text/')) return respond(histories.get(url.pathname.split('/').at(-1)) ?? [])
    if (url.pathname.endsWith('/experiment-sessions')) {
      if (request.method() === 'POST') {
        const body = request.postDataJSON()
        await creationGate
        const session = { id: 'first-draft', lab_type: body.lab_type, title: body.title, created_at: timestamp, updated_at: timestamp }
        sessions.push(session)
        return respond(session)
      }
      return respond(sessions.filter(item => item.lab_type === url.searchParams.get('lab_type')))
    }
    if (url.pathname.includes('/experiment-sessions/') && request.method() === 'DELETE') {
      deleteRequests.push(url.pathname)
      return respond(null)
    }
    if (url.pathname.endsWith('/messages')) return respond(histories.get(url.pathname.split('/').at(-2)) ?? [])
    if (url.pathname.endsWith('/models')) {
      const category = url.searchParams.get('category')
      return respond({ items: [{ id: category + '-model', name: labels[category] + '测试模型', category }] })
    }
    if (url.pathname.endsWith('/prompts')) return respond({ items: url.searchParams.get('category') === 'frame_head_image' ? [{
      id: 'guard-template', name: '保护模板', version: 1, content: '绘制 {{地点}}', variables: ['地点'],
      variable_defaults: { 地点: '山谷' }, category: 'frame_head_image', created_at: timestamp, updated_at: timestamp,
    }] : [] })
    if (url.pathname.endsWith('/files')) return respond({ items: [{ id: 'file-a', name: '测试参考图', type: 'image' }] })
    if (url.pathname.endsWith('/video-generation-options')) return respond({ model_id: 'video-model', allowed_ratios: ['16:9'] })
    const media = url.pathname.match(/\/labs\/(image|video)\/sessions\/([^/]+)\/tasks$/)
    if (media && request.method() === 'POST') {
      const input = request.postDataJSON()
      generationRequests.push(input)
      const sessionId = media[2]
      const taskId = media[1] + '-' + generationRequests.length
      const status = sessionId === 'image-template' ? 'succeeded' : 'queued'
      const items = [
        message(sessionId, taskId + '-user', 'user', input.execution_prompt, 1),
        message(sessionId, taskId + '-task', 'task', '请求已接收', 2, { task_id: taskId, status }),
      ]
      saveMessages(sessionId, ...items)
      return respond({ task_id: taskId, messages: items })
    }
    const result = url.pathname.match(/\/film\/tasks\/([^/]+)\/result$/)
    if (result) return respond({ task_id: result[1], status: 'running', progress: 25 })
    if (url.pathname.endsWith('/cancel')) {
      stopRequests.push({ unexpected: url.pathname })
      return respond(null)
    }
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  await page.goto(origin + '/lab?session=text-session')
  await page.getByRole('heading', { name: '实验室 · 文本 · 文本历史' }).waitFor()
  const textInput = page.getByRole('textbox', { name: '文本提示词' })
  await textInput.fill('还在编辑的文本')
  await page.getByRole('button', { name: '另一条文本历史', exact: true }).click()
  const leave = page.getByRole('dialog', { name: '有未发送内容' })
  await leave.waitFor()
  assert.equal(new URL(page.url()).searchParams.get('session'), 'text-session')
  await leave.getByRole('button', { name: '继续编辑' }).click()
  await leave.waitFor({ state: 'hidden' })
  assert.equal(await textInput.inputValue(), '还在编辑的文本')
  await page.getByRole('button', { name: '另一条文本历史', exact: true }).click()
  await leave.getByRole('button', { name: '放弃未发送内容并离开' }).click()
  await page.getByRole('heading', { name: '实验室 · 文本 · 另一条文本历史' }).waitFor()
  assert.equal(await textInput.inputValue(), '')
  assert.equal(new URL(page.url()).searchParams.get('session'), 'text-other')
  const type = label => ({ click: async () => {
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await page.getByRole('menuitem', { name: label + '会话', exact: true }).click()
  } })
  const discard = () => leave.getByRole('button', { name: '放弃未发送内容并离开' }).click()
  const selectModel = async label => {
    await page.locator('.experiment-model-trigger').click()
    await page.getByRole('button', { name: label + '测试模型', exact: true }).waitFor()
    await page.keyboard.press('Escape')
  }

  // Browser history and route links use the same guard as sidebar actions.
  await textInput.fill('前进后退也会保护')
  await page.evaluate(() => history.back())
  await leave.getByRole('button', { name: '继续编辑' }).press('Escape')
  assert.equal(await textInput.inputValue(), '前进后退也会保护')
  assert.equal(new URL(page.url()).searchParams.get('session'), 'text-other')
  await page.evaluate(() => history.back())
  await discard()
  await page.getByRole('heading', { name: '实验室 · 文本 · 文本历史' }).waitFor()
  await page.evaluate(() => history.forward())
  await page.getByRole('heading', { name: '实验室 · 文本 · 另一条文本历史' }).waitFor()
  await textInput.fill('离开实验室的草稿')
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await leave.getByRole('button', { name: '继续编辑' }).click()
  assert.equal(await textInput.inputValue(), '离开实验室的草稿')
  await type('文本').click()
  await discard()
  await page.getByRole('heading', { name: '实验室 · 文本 · 新会话' }).waitFor()
  await textInput.fill('同一个草稿路由也会保护')
  await type('文本').click()
  await discard()
  await textInput.waitFor()
  assert.equal(await textInput.inputValue(), '')
  assert.equal(new URL(page.url()).searchParams.get('mode'), 'text')

  // Keep a real SSE connection open while the stop request is pending or rejected.
  await selectModel('文本')
  await textInput.fill('首次草稿提交保持运行')
  holdAcceptance = true
  creationGate = new Promise(resolve => { releaseCreation = resolve })
  await page.getByRole('button', { name: /^发\s*送$/ }).click()
  await page.getByRole('link', { name: '首页', exact: true }).click()
  const activeLeave = page.getByRole('dialog', { name: '文本正在生成' })
  const stopAndLeave = activeLeave.getByRole('button', { name: '停止生成并离开' })
  await activeLeave.getByText('等待服务端接收后可请求停止。').waitFor()
  assert.equal(await stopAndLeave.isDisabled(), true)
  assert.equal(stopRequests.length, 0)
  const streamStarted = page.waitForResponse(response => response.url().includes('/first-draft/events?'))
  releaseCreation()
  await page.getByRole('heading', { name: '实验室 · 文本 · 新文本会话' }).waitFor()
  assert.equal(await activeLeave.isVisible(), true)
  assert.equal(new URL(page.url()).searchParams.get('mode'), 'text')
  await activeLeave.getByRole('button', { name: '继续等待' }).click()
  await page.waitForURL(url => url.searchParams.get('session') === 'first-draft')
  await streamStarted
  holdAcceptance = false
  accept(live)
  await page.getByRole('button', { name: /^停\s*止$/ }).waitFor()
  const currentActions = page.getByRole('button', { name: '新文本会话 更多操作', exact: true })
  await currentActions.focus()
  await currentActions.press('Enter')
  const removeCurrent = page.getByRole('menuitem', { name: /^删除会话/ })
  await removeCurrent.waitFor()
  assert.equal(await removeCurrent.getAttribute('aria-disabled'), 'true')
  assert.deepEqual(deleteRequests, [])
  assert.equal(streams.has(live.response), true)
  await page.keyboard.press('Escape')
  await page.getByRole('link', { name: '首页', exact: true }).click()
  await activeLeave.getByRole('button', { name: '继续等待' }).click()
  assert.equal(stopRequests.length, 0)
  assert.equal(streams.has(live.response), true)
  await type('图片').click()
  await stopAndLeave.click()
  await activeLeave.getByText('停止生成请求失败，已保留当前会话。请重试或继续等待。').waitFor()
  assert.deepEqual(stopRequests[0], { sessionId: 'first-draft', taskId: live.taskId, connected: true, body: { reason: 'user_cancelled' } })
  assert.equal(streams.has(live.response), true)
  assert.equal(new URL(page.url()).searchParams.get('session'), 'first-draft')
  await page.screenshot({ path: join(output, 'stop-failure.png'), animations: 'disabled' })
  await activeLeave.getByRole('button', { name: '继续等待' }).click()

  // Acknowledgement is distinct from a terminal SSE event.
  stopBehavior = 'acknowledge'
  await page.getByRole('button', { name: /^停\s*止$/ }).click()
  await page.getByText('已请求停止，等待本轮结束。', { exact: true }).waitFor()
  assert.equal(streams.has(live.response), true)
  assert.equal(await page.getByText('已取消', { exact: true }).count(), 0)
  finish(live, 'cancelled')
  await page.getByText('已取消', { exact: true }).waitFor()
  await textInput.fill('终态与停止响应竞态')
  await page.getByRole('button', { name: /^发\s*送$/ }).click()
  await page.getByText('终态与停止响应竞态', { exact: true }).waitFor()
  stopBehavior = 'hold'
  await type('图片').click()
  await stopAndLeave.click()
  // The terminal event may arrive before the stop HTTP request finishes.
  await expectRequestCount(3)
  finish(live, 'completed')
  heldStop('succeeded')
  heldStop = undefined
  await page.getByRole('heading', { name: '实验室 · 图片 · 新会话' }).waitFor()
  assert.equal(stopRequests.every(request => request.connected), true)
  await type('文本').click()
  await page.getByRole('button', { name: '新文本会话', exact: true }).click()
  await page.getByText('同时收到的完整结果', { exact: true }).waitFor()

  async function expectRequestCount(count) {
    const expires = Date.now() + 5000
    while (stopRequests.length < count && Date.now() < expires) await new Promise(resolve => setTimeout(resolve, 20))
    assert.equal(stopRequests.length, count)
  }

  // A confirmed stop also permits leaving a still-live stream after acknowledgement.
  await selectModel('文本')
  await textInput.fill('确认停止后离开')
  await page.getByRole('button', { name: /^发\s*送$/ }).click()
  await page.getByText('确认停止后离开', { exact: true }).waitFor()
  stopBehavior = 'acknowledge'
  await type('图片').click()
  await stopAndLeave.click()
  await page.getByRole('heading', { name: '实验室 · 图片 · 新会话' }).waitFor()
  assert.equal(stopRequests[3].connected, true)

  // Temporary media edits block Back, and cancelling them removes their guard.
  await page.getByRole('button', { name: '图片历史', exact: true }).click()
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片历史' }).waitFor()
  await selectModel('图片')
  const imagePanel = page.getByRole('dialog', { name: '配置参考图', exact: true })
  await openLabAddition(page, '添加参考图')
  await imagePanel.getByRole('tab', { name: '资料库', exact: true }).click()
  await imagePanel.getByRole('checkbox', { name: '测试参考图', exact: true }).check()
  await page.evaluate(() => history.back())
  await leave.getByRole('button', { name: '继续编辑' }).press('Escape')
  assert.equal(await imagePanel.getByRole('checkbox', { name: '测试参考图', exact: true }).isChecked(), true)
  await imagePanel.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await imagePanel.waitFor({ state: 'hidden' })
  await page.evaluate(() => history.back())
  await page.getByRole('heading', { name: '实验室 · 图片 · 新会话' }).waitFor()
  assert.equal(await leave.isVisible(), false, '取消面板及自动选择模型不形成草稿')
  await page.evaluate(() => history.forward())
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片历史' }).waitFor()
  await selectModel('图片')

  // Submitted template configuration stays visible but is clean.
  await openLabAddition(page, '选择提示词模板')
  await page.getByRole('combobox', { name: '提示词模板' }).click()
  await page.getByText('首帧图片 · 保护模板 · v1', { exact: true }).click()
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片历史' }).click()
  await page.getByRole('button', { name: /^发\s*送$/, exact: true }).click()
  await page.getByText('请求已接收', { exact: true }).waitFor()
  await type('视频').click()
  await page.getByRole('heading', { name: '实验室 · 视频 · 新会话' }).waitFor()
  assert.equal(await leave.isVisible(), false)
  await page.getByRole('button', { name: '视频历史', exact: true }).click()
  await selectModel('视频')
  const videoInput = page.getByRole('textbox', { name: '视频提示词' })
  await videoInput.fill('视频草稿')
  await type('图片').click()
  await leave.getByRole('button', { name: '继续编辑' }).click()
  assert.equal(await videoInput.inputValue(), '视频草稿')
  await page.getByRole('button', { name: /^发\s*送$/, exact: true }).click()
  await page.getByText('请求已接收', { exact: true }).waitFor()
  await type('图片').click()
  await page.getByRole('button', { name: '图片历史', exact: true }).click()
  await page.getByText('请求已接收', { exact: true }).waitFor()
  assert.equal(stopRequests.length, 4, '图片和视频离开不请求取消')

  // A clean submitted template gains a guard only while its variables have unapplied changes.
  await page.getByRole('button', { name: '图片模板历史', exact: true }).click()
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片模板历史' }).waitFor()
  await selectModel('图片')
  await openLabAddition(page, '选择提示词模板')
  await page.getByRole('combobox', { name: '提示词模板' }).click()
  await page.getByText('首帧图片 · 保护模板 · v1', { exact: true }).click()
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片模板历史' }).click()
  await page.getByRole('button', { name: /^发\s*送$/, exact: true }).click()
  await page.getByText('已完成', { exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑变量', exact: true }).click()
  const variables = page.getByRole('dialog', { name: '编辑模板变量' })
  const place = variables.getByRole('textbox', { name: '地点', exact: true })
  await place.fill('仅暂存的变量')
  await page.evaluate(() => history.back())
  await leave.getByRole('button', { name: '继续编辑' }).click()
  assert.equal(await place.inputValue(), '仅暂存的变量')
  await variables.getByRole('button', { name: /^取\s*消$/ }).click()
  await variables.waitFor({ state: 'hidden' })
  await page.evaluate(() => history.back())
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片历史' }).waitFor()
  assert.equal(await leave.isVisible(), false)

  // Browser-native beforeunload is best-effort; dismissing it preserves the live page.
  await type('文本').click()
  await textInput.fill('刷新时仍未发送')
  const native = page.waitForEvent('dialog')
  const reload = page.reload().catch(() => {})
  const warning = await native
  assert.equal(warning.type(), 'beforeunload')
  await warning.dismiss()
  await reload
  assert.equal(await textInput.inputValue(), '刷新时仍未发送')

  await page.setViewportSize({ width: 375, height: 812 })
  const navTrigger = page.getByRole('button', { name: '会话导航', exact: true })
  await navTrigger.click()
  const videoType = type('视频')
  await videoType.click()
  await leave.getByRole('button', { name: '继续编辑' }).press('Escape')
  await page.getByRole('button', { name: '新建会话', exact: true }).and(page.locator(':focus')).waitFor()
  await videoType.click()
  await page.screenshot({ path: join(output, 'draft-guard-mobile.png'), animations: 'disabled' })
  await discard()
  await page.getByRole('heading', { name: '实验室 · 视频 · 新会话' }).waitFor()
  await navTrigger.and(page.locator(':focus')).waitFor()
  assert.equal(await videoInput.inputValue(), '')
  console.log('实验室离开保护验收通过', output)
} catch (error) {
  console.error('Browser state:', page?.url(), await page?.locator('body').innerText().catch(() => ''), generationRequests.length, live?.response.destroyed)
  if (page) await page.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' }).catch(() => {})
  throw error
} finally {
  await cleanup()
}
