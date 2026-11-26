import { textTrialFrame, turnReceipt, mediaTurnReceipt, mediaAdmissionStream } from './text-trial-events.mjs'
import { openLabAddition } from './lab-composer-actions.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-submission-recovery-')
const origin = 'http://127.0.0.1:4806'
const timestamp = '2026-11-10T00:00:00Z'
const labels = { text: '文本', image: '图片', video: '视频' }
const sessions = Object.entries(labels).map(([mode, label]) => ({
  id: mode + '-session', lab_type: mode, title: label + '恢复会话', created_at: timestamp, updated_at: timestamp,
}))
const writes = []
const requestHeaders = []
let submission
const histories = new Map()
let historyReads = 0
let failHistory = false
let modelsState = 'ready'
sessions.push({ id: 'image-other', lab_type: 'image', title: '另一张图片会话', created_at: timestamp, updated_at: timestamp })
const historyMessage = (session_id, id, role, content, sequence, more = {}) => ({
  id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp, ...more,
})
const server = await createServer({ root, cacheDir: join(output, 'vite'), server: { host: '127.0.0.1', port: 4806, strictPort: true, open: false } })
let browser
let page
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const admission = mediaAdmissionStream(route, url)
    if (admission) return admission
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (url.pathname.endsWith('/experiment-sessions')) return respond(sessions.filter(item => item.lab_type === url.searchParams.get('lab_type')))
    if (url.pathname.endsWith('/models')) {
      const category = url.searchParams.get('category')
      if (modelsState === 'failed') return route.fulfill({ status: 503, json: { detail: '模型暂不可用' } })
      if (modelsState === 'empty') return respond({ items: [] })
      return respond({ items: [{ id: category + '-model', name: labels[category] + '恢复模型', category }] })
    }
    if (url.pathname.endsWith('/video-generation-options')) return respond({ model_id: 'video-model', allowed_ratios: ['16:9'] })
    if (url.pathname.endsWith('/files')) return respond({ items: [
      { id: 'reference-a', name: '恢复参考图 A', type: 'image' },
      { id: 'reference-b', name: '恢复参考图 B', type: 'image' },
    ] })
    if (url.pathname.endsWith('/prompts')) return respond({ items: url.searchParams.get('category') === 'video_prompt' ? [{
      id: 'recovery-template', name: '恢复模板', version: 2, content: '保留 {{主体}}',
      variables: ['主体'], variable_defaults: { 主体: '雪松' }, category: 'video_prompt',
      created_at: timestamp, updated_at: timestamp,
    }] : [] })
    if (url.pathname.endsWith('/chat/sessions/text-session/turns')) {
      writes.push(request.postDataJSON())
      requestHeaders.push(request.headers())
      return respond(turnReceipt(route, writes.at(-1).content.includes('断开') ? 'disconnect-run' : 'text-run'))
    }
    if (url.pathname.endsWith('/text-session/events')) return submission(route)
    if (url.pathname.endsWith('/chat/sessions/text/text-session')) {
      historyReads += 1
      return respond(histories.get('text-session') ?? [])
    }
    if (/\/chat\/sessions\/[^/]+\/turns$/.test(url.pathname)) {
      writes.push(request.postDataJSON())
      requestHeaders.push(request.headers())
      return submission(route)
    }
    if (/\/chat\/sessions\/media\/[^/]+$/.test(url.pathname) || url.pathname.endsWith('/messages')) {
      historyReads += 1
      if (failHistory) return route.fulfill({ status: 503, json: { detail: '历史暂不可用' } })
      return respond(histories.get(url.pathname.split('/').at(url.pathname.endsWith('/messages') ? -2 : -1)) ?? [])
    }
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  async function openLab(mode) {
    await page.goto(origin + '/lab?session=' + mode + '-session')
    await page.getByRole('heading', { name: '实验室 · ' + labels[mode] + ' · ' + labels[mode] + '恢复会话' }).waitFor()
    await page.locator('.experiment-model-trigger').click()
    await page.getByRole('button', { name: labels[mode] + '恢复模型' }).waitFor()
    await page.keyboard.press('Escape')
  }

  await openLab('image')
  const imageInput = page.getByRole('textbox', { name: '图片提示词' })
  const imageSubmit = page.getByRole('button', { name: /^发\s*送$/ })
  const prompt = '请求未接收前保留完整输入'
  await imageInput.fill(prompt)
  let entered
  const enteredRequest = new Promise(resolve => { entered = resolve })
  let release
  const responseGate = new Promise(resolve => { release = resolve })
  submission = async route => {
    entered()
    await responseGate
    return route.fulfill({ status: 422, json: { detail: '模型参数不可用' } })
  }
  await imageSubmit.click()
  await enteredRequest
  const pendingValue = await imageInput.inputValue()
  release()
  assert.equal(pendingValue, prompt, '请求挂起时图片提示词仍可见')
  await page.getByText('模型参数不可用', { exact: false }).waitFor()
  assert.equal(await imageInput.inputValue(), prompt)
  assert.equal(writes.length, 1)
  const imageSession = 'image-session'
  const older = [
    historyMessage(imageSession, 'old-user', 'user', prompt, 1),
    historyMessage(imageSession, 'old-task', 'task', '之前的图片结果', 2, { task_id: 'old-image-task', status: 'succeeded' }),
  ]
  histories.set(imageSession, older)
  const readsBeforeUnknown = historyReads
  failHistory = true
  submission = route => route.abort('failed')
  await imageSubmit.click()
  await page.getByText('提交结果未知', { exact: true }).waitFor()
  await page.getByText('会话历史暂不可用，可重试读取。').waitFor()
  assert.ok(historyReads > readsBeforeUnknown)
  assert.equal(await imageInput.inputValue(), prompt)
  assert.equal(await imageSubmit.isDisabled(), true)
  failHistory = false
  await page.getByRole('button', { name: '重试核对' }).click()
  await page.getByText('历史中无法确认本轮请求，请核对会话记录后再决定是否提交。').waitFor()
  await page.getByText('之前的图片结果', { exact: true }).waitFor()
  assert.equal(writes.length, 2, '核对历史不重复提交')
  assert.equal(await imageInput.inputValue(), prompt, '相同历史提示词不能确认本次提交')
  await page.getByRole('button', { name: '我已核对' }).click()

  // 有已知任务身份的残缺回执由历史确认，不凭提示词推断任务。
  submission = route => {
    histories.set(imageSession, [...older,
      historyMessage(imageSession, 'new-user', 'user', prompt, 3),
      historyMessage(imageSession, 'new-task', 'task', '本轮图片结果', 4, { task_id: 'known-image-task', status: 'succeeded' }),
    ])
    return route.fulfill({ json: { success: true, data: mediaTurnReceipt(route, { task_id: 'known-image-task' }) } })
  }
  await imageSubmit.click()
  await page.getByText('本轮图片结果', { exact: true }).waitFor()
  assert.equal(await imageInput.inputValue(), '')
  assert.equal(writes.length, 3)

  await openLab('video')
  const videoInput = page.getByRole('textbox', { name: '视频提示词' })
  const videoSubmit = page.getByRole('button', { name: /^发\s*送$/ })
  await videoInput.fill('视频创建失败后可以继续编辑')
  submission = route => route.fulfill({ status: 422, json: { detail: '视频素材被拒绝' } })
  await videoSubmit.click()
  await page.getByText('视频素材被拒绝', { exact: true }).waitFor()
  assert.equal(await videoInput.inputValue(), '视频创建失败后可以继续编辑')
  assert.equal(writes.length, 4)

  await openLab('text')
  const textInput = page.getByRole('textbox', { name: '文本提示词' })
  const textSubmit = page.getByRole('button', { name: /^发\s*送$/ })
  const textPrompt = '\n原样保留这轮文本\n'
  const frame = (event, cursor, data) => textTrialFrame('text-session', data.task_id, cursor,
    { accepted: 'turn.accepted', delta: 'message.updated', error: 'turn.failed' }[event], data)
  let textEntered
  const textRequest = new Promise(resolve => { textEntered = resolve })
  let releaseText
  const textGate = new Promise(resolve => { releaseText = resolve })
  submission = async route => {
    textEntered()
    await textGate
    const user = historyMessage('text-session', 'text-user', 'user', textPrompt.trim(), 1)
    histories.set('text-session', [user])
    return route.fulfill({ contentType: 'text/event-stream', body:
      frame('accepted', 1, { task_id: 'text-run', user_message: user }) +
      frame('error', 2, { task_id: 'text-run', error: { code: 'provider_failure', message: '生成过程失败', retryable: true } }),
    })
  }
  await textInput.fill(textPrompt)
  await textInput.press('Enter')
  await textRequest
  const preAccepted = await textInput.inputValue()
  await page.keyboard.press('Enter')
  assert.equal(writes.length, 5, '重复快捷键不重新发送')
  releaseText()
  assert.equal(preAccepted, textPrompt, '收到 accepted 前保持原文')
  await page.getByText('生成过程失败', { exact: true }).waitFor()
  assert.equal(await textInput.inputValue(), textPrompt, '流式失败后恢复未经裁剪的原文')
  assert.equal(await textSubmit.isEnabled(), true)

  await page.goto(origin + '/lab?session=image-session')
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片恢复会话' }).waitFor()
  modelsState = 'failed'
  await page.locator('.experiment-model-trigger').click()
  await page.getByText('加载模型失败', { exact: true }).waitFor()
  assert.equal(await page.getByText('暂无可选模型', { exact: true }).count(), 0)
  modelsState = 'empty'
  await page.getByRole('button', { name: '重试读取模型' }).click()
  await page.getByText('暂无可选模型', { exact: true }).waitFor()
  modelsState = 'ready'
  await page.getByRole('button', { name: '刷新模型' }).click()
  const selectedModel = page.getByRole('button', { name: '图片恢复模型' })
  await selectedModel.waitFor()
  await imageInput.click()
  await page.getByRole('button', { name: '刷新模型' }).waitFor({ state: 'hidden' })
  await imageInput.fill('模型刷新失败也保留输入')
  await selectedModel.click()
  modelsState = 'failed'
  await page.getByRole('button', { name: '刷新模型' }).click()
  await page.getByText('加载模型失败', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await imageInput.inputValue(), '模型刷新失败也保留输入')
  assert.ok(await selectedModel.isVisible())
  assert.equal(writes.length, 5)

  await imageInput.click()
  modelsState = 'ready'

  // 创建失败及重试仍携带已应用的图片，先前取消的参考图不会回到请求。
    const references = page.getByRole('dialog', { name: '配置参考图', exact: true })
  await openLabAddition(page, '添加参考图')
  await references.getByRole('tab', { name: '资料库', exact: true }).click()
  await references.getByRole('checkbox', { name: '恢复参考图 A', exact: true }).check()
  await references.getByRole('button', { name: '应用参考图', exact: true }).click()
  await references.waitFor({ state: 'hidden' })
  await openLabAddition(page, '添加参考图')
  await references.getByRole('tab', { name: '资料库', exact: true }).click()
  await references.getByRole('checkbox', { name: '恢复参考图 B', exact: true }).check()
  await references.getByRole('button', { name: '取消参考配置', exact: true }).click()
  await references.waitFor({ state: 'hidden' })
  submission = route => route.fulfill({ status: 422, json: { detail: '图片配置暂未通过' } })
  await imageSubmit.click()
  await page.getByText('图片配置暂未通过', { exact: true }).waitFor()
  assert.equal(await imageInput.inputValue(), '模型刷新失败也保留输入')
  await page.getByRole('button', { name: '预览参考图：恢复参考图 A', exact: true }).waitFor()
  assert.deepEqual(writes.at(-1).media.references.map(item => item.file_id), ['reference-a'])

  // 在同一模态切换会话，迟到的旧回执不能替换新输入。
  let lateEntered
  const lateRequest = new Promise(resolve => { lateEntered = resolve })
  let releaseLate
  const lateGate = new Promise(resolve => { releaseLate = resolve })
  submission = async route => {
    lateEntered()
    await lateGate
    return route.fulfill({ json: { success: true, data: mediaTurnReceipt(route, { task_id: 'late-task', messages: [
      historyMessage(imageSession, 'late-msg', 'task', '迟到的旧会话结果', 5, { task_id: 'late-task', status: 'succeeded' }),
    ] }) } })
  }
  await imageSubmit.dblclick()
  await lateRequest
  assert.equal(writes.length, 7, '双击只提交一次')
  assert.deepEqual(writes.at(-1).media.references.map(item => item.file_id), ['reference-a'])
  await page.getByRole('button', { name: '另一张图片会话', exact: true }).click()
  await page.getByRole('button', { name: '放弃未发送内容并离开', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('session') === 'image-other')
  await imageInput.fill('新会话继续写作')
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith('/image-session/turns')),
    releaseLate(),
  ])
  assert.equal(await imageInput.inputValue(), '新会话继续写作')
  assert.equal(await page.getByText('迟到的旧会话结果', { exact: true }).count(), 0)

  // 视频的模板变量和帧配置在创建失败后仍能原样再次提交。
  await openLab('video')
  await openLabAddition(page, '选择提示词模板')
  await page.getByRole('combobox', { name: '提示词模板' }).press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('视频提示词 · 恢复模板 · v2', { exact: true }).click()
  const template = page.getByRole('dialog', { name: '编辑模板变量' })
  await page.getByRole('button', { name: '编辑变量', exact: true }).click()
  await template.getByRole('textbox', { name: '主体', exact: true }).fill('海鸥')
  await template.getByRole('button', { name: /^应\s*用$/ }).click()
  await template.waitFor({ state: 'hidden' })

  await openLabAddition(page, '配置参考素材')
  const videoReferences = page.getByRole('dialog', { name: '配置视频参考素材' })
  await videoReferences.getByRole('button', { name: '选择首帧', exact: true }).click()
  await videoReferences.getByRole('button', { name: '恢复参考图 A', exact: true }).click()
  await videoReferences.getByRole('button', { name: '返回已选素材', exact: true }).click()
  await videoReferences.getByRole('button', { name: '应用参考素材', exact: true }).click()
  await videoReferences.waitFor({ state: 'hidden' })
  submission = route => route.fulfill({ status: 422, json: { detail: '视频配置暂未通过' } })
  await videoSubmit.click()
  await page.getByText('视频配置暂未通过', { exact: true }).waitFor()
  await page.getByRole('list', { name: '本轮参考素材', exact: true }).getByRole('button', { name: '预览首帧：恢复参考图 A', exact: true }).waitFor()
  await page.getByRole('button', { name: '编辑变量', exact: true }).click()
  assert.equal(await template.getByRole('textbox', { name: '主体', exact: true }).inputValue(), '海鸥')
  await page.keyboard.press('Escape')
  await template.waitFor({ state: 'hidden' })
  submission = route => route.fulfill({ json: { success: true, data: mediaTurnReceipt(route, { task_id: 'video-ok', messages: [
    historyMessage('video-session', 'video-ok', 'task', '视频任务已接收', 1, { task_id: 'video-ok', status: 'succeeded' }),
  ] }) } })
  await videoSubmit.click()
  await page.getByText('视频任务已接收', { exact: true }).waitFor()
  assert.equal(writes.at(-1).execution_prompt, '保留 海鸥')
  assert.equal(writes.at(-1).media.frames.first.file_id, 'reference-a')
  assert.deepEqual(writes.at(-1), writes.at(-2))
  await page.screenshot({ path: join(output, 'configured-retry.png'), animations: 'disabled' })

  await openLab('text')
  await textInput.fill('已接收但流意外断开')
  const disconnectUser = historyMessage('text-session', 'disconnect-user', 'user', '已接收但流意外断开', 3)
  const writesBeforeDisconnect = writes.length
  const readsBeforeDisconnect = historyReads
  submission = route => {
    if (new URL(route.request().url()).searchParams.get('after') === '2') {
      return route.fulfill({ contentType: 'text/event-stream', body: '' })
    }
    histories.set('text-session', [...(histories.get('text-session') ?? []), disconnectUser])
    return route.fulfill({ contentType: 'text/event-stream', body:
      frame('accepted', 1, { task_id: 'disconnect-run', user_message: disconnectUser }) +
      frame('delta', 2, { task_id: 'disconnect-run', text_delta: '断流前收到的部分回复' }),
    })
  }
  await textSubmit.click()
  await page.getByText('状态暂不可用', { exact: true }).waitFor()
  await page.getByText('断流前收到的部分回复', { exact: true }).waitFor()
  await page.getByText('已接收但流意外断开', { exact: true }).waitFor()
  assert.equal(await page.getByText('提交结果未知', { exact: true }).count(), 0)
  assert.equal(await textSubmit.isDisabled(), true)
  await page.getByRole('button', { name: '重试读取历史', exact: true }).click()
  await page.getByText('状态暂不可用', { exact: true }).waitFor()
  assert.ok(historyReads >= readsBeforeDisconnect + 2)
  assert.equal(writes.length, writesBeforeDisconnect + 1)
  assert.ok(requestHeaders.at(-1)['idempotency-key'])

  console.log('Lab submission recovery browser checks passed', output)
} catch (error) {
  await page?.screenshot({ path: join(output, 'failure.png'), animations: 'disabled' })
  throw error
} finally {
  await cleanup()
}
