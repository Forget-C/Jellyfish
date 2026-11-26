import { successfulTextTrial, turnReceipt, mediaTurnReceipt, mediaAdmissionStream, textTrialSnapshot } from './text-trial-events.mjs'
import { openLabAddition } from './lab-composer-actions.mjs'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-templates-')
const origin = 'http://127.0.0.1:4802'
const timestamp = '2026-11-10T00:00:00Z'
const categories = { text: 'frame_head_prompt', image: 'frame_head_image', video: 'video_prompt' }
const longName = '多变量模板' + '超长名称'.repeat(30)
const labNames = { text: '文本', image: '图片', video: '视频' }
const fixture = (category) => ({
  id: category + '-draft', category, name: '角色与地点', version: 2,
  preview: '描述角色所在地点', content: '角色 {{角色}}，地点 {{地点}}。',
  variables: ['角色', '地点'], variable_defaults: { 角色: '旅人' },
  created_at: timestamp, updated_at: timestamp,
})
const session = (mode) => ({ id: mode + '-session', lab_type: mode, title: labNames[mode] + '测试会话', created_at: timestamp, updated_at: timestamp })
const message = (id, session_id, role, content, sequence, input) => ({
  id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp,
  ...(input ? { payload: { input_snapshot: { version: 1, prompt: content, ...input } } } : {}),
})
const submitted = []
const writes = []
let failTemplates = false
let emptyTemplates = false
let currentMode = 'text'
const persisted = new Map(Object.keys(labNames).map((mode) => [mode + '-session', [message(mode + '-history', mode + '-session', 'user', '先前的提示词', 1, { model_id: mode + '-model' })]]))
const server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4802, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const admission = mediaAdmissionStream(route, url)
    if (admission) return admission
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (request.method() !== 'GET') writes.push(url.pathname)
    if (url.pathname.endsWith('/experiment-sessions')) return respond([session(url.searchParams.get('lab_type') ?? 'text')])
    if (url.pathname.endsWith('/models')) {
      const category = url.searchParams.get('category')
      return respond({ items: [{ id: category + '-model', name: labNames[category] + '测试模型', category }] })
    }
    if (url.pathname.endsWith('/video-generation-options')) return respond({ model_id: url.searchParams.get('model_id'), allowed_ratios: ['16:9'], supports_subject_image_reference: true })
    if (url.pathname.endsWith('/prompts')) {
      if (failTemplates) return route.fulfill({ status: 503, json: { detail: '模板暂时不可用' } })
      const category = url.searchParams.get('category')
      if (emptyTemplates || category !== categories[currentMode]) return respond({ items: [] })
      const template = fixture(category)
      const manyVariables = Array.from({ length: 20 }, (_, index) => `变量 ${index + 1}`)
      return respond({ items: [
        template,
        { ...template, id: category + '-static', name: '固定模板', variables: [], variable_defaults: {}, content: '固定提示词' },
        { ...template, id: category + '-long', name: longName, variables: manyVariables, variable_defaults: {} },
      ] })
    }
    const turn = url.pathname.match(/\/chat\/sessions\/(?:text\/)?([^/]+)\/turns$/)
    if (url.pathname.endsWith('/text-session/events')) {
      const sessionId = url.pathname.split('/').at(-2)
      const [user, assistant] = persisted.get(sessionId)
      return route.fulfill({ contentType: 'text/event-stream', body: successfulTextTrial(sessionId, 'text-run', user, assistant) })
    }
    if (turn) {
      const sessionId = turn[1]
      const mode = sessionId === 'text-session' ? 'text' : request.postDataJSON().operation_input.kind.split('_')[0]
      const requestBody = request.postDataJSON()
      const content = requestBody.content ?? requestBody.execution_prompt
      submitted.push({ mode, content })
      const user = message(mode + '-user', sessionId, 'user', content, 2, {
        model_id: requestBody.model_id, media: requestBody.media, operation_input: requestBody.operation_input,
      })
      const result = message(mode + '-result', sessionId, 'assistant', '测试结果', 3)
      const runId = mode + '-run'
      if (mode === 'text') {
        persisted.set(sessionId, [user, result])
        return respond(turnReceipt(route, runId))
      }
      const messages = [user, { ...result, task_id: runId, status: 'succeeded' }]
      persisted.set(sessionId, messages)
      return respond(mediaTurnReceipt(route, { task_id: runId, messages }))
    }
    if (/\/chat\/sessions\/text\/[^/]+\/snapshot$/.test(url.pathname)) return textTrialSnapshot(route, persisted.get(url.pathname.split('/').at(-2)) ?? [])
    if (/\/chat\/sessions\/media\/[^/]+$/.test(url.pathname)) return respond(persisted.get(url.pathname.split('/').at(-1)) ?? [])
    if (url.pathname.endsWith('/messages')) return respond(persisted.get(url.pathname.split('/').at(-2)) ?? [])
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  const goToLab = async (mode) => {
    currentMode = mode
    await page.goto(origin + '/lab?session=' + mode + '-session')
    await page.getByRole('heading', { name: `实验室 · ${labNames[mode]} · ${labNames[mode]}测试会话` }).waitFor()
  }
  const editor = page.getByRole('dialog', { name: '编辑模板变量' })
  const edit = page.getByRole('button', { name: '编辑变量', exact: true })
  const place = editor.getByRole('textbox', { name: '地点', exact: true })
  const role = editor.getByRole('textbox', { name: '角色', exact: true })
  const apply = editor.getByRole('button', { name: /^应\s*用$/ })
  const cancel = editor.getByRole('button', { name: /^取\s*消$/ })
  const select = page.getByRole('combobox', { name: '提示词模板' })
  const replacement = page.getByRole('dialog', { name: '替换当前输入？' })
  const choose = async (label) => {
    await select.press('ArrowDown')
    await page.locator('.ant-select-dropdown:visible').getByText(label, { exact: true }).click()
  }
  const assertField = async (locator, value) => assert.equal(await locator.inputValue(), value)

  // Failed and empty reads never replace the current prompt.
  failTemplates = true
  await goToLab('text')
  await openLabAddition(page, '选择提示词模板')
  const error = page.getByRole('alert').filter({ hasText: '加载提示词模板失败' })
  await error.waitFor()
  failTemplates = false
  emptyTemplates = true
  await error.getByRole('button', { name: /^重\s*试$/ }).click()
  await page.getByRole('status').filter({ hasText: '暂无提示词模板' }).waitFor()
  emptyTemplates = false
  await page.getByRole('button', { name: '刷新模板', exact: true }).click()
  await choose('首帧图片提示词 · 角色与地点 · v2')
  await page.getByText('已填 1／共 2 个变量', { exact: true }).waitFor()
  await edit.click()
  await assertField(role, '旅人')
  await place.fill('山谷')
  await editor.getByText('查看最终提示词', { exact: true }).click()
  await editor.getByText('角色 旅人，地点 山谷。', { exact: true }).waitFor()
  await apply.click()
  await editor.waitFor({ state: 'hidden' })
  await page.getByText('已填 2／共 2 个变量', { exact: true }).waitFor()

  // Each close route discards temporary edits and returns focus to the trigger.
  for (const dismiss of [
    () => cancel.click(),
    () => editor.getByRole('button', { name: /^(Close|关闭)$/ }).click(),
    () => page.keyboard.press('Escape'),
    () => page.mouse.click(20, 400),
  ]) {
    await edit.click()
    await assertField(place, '山谷')
    await place.fill('临时地点')
    await dismiss()
    await editor.waitFor({ state: 'hidden' })
    await edit.and(page.locator(':focus')).waitFor()
  }
  await openLabAddition(page, '选择提示词模板')
  failTemplates = true
  await page.getByRole('button', { name: '刷新模板', exact: true }).click()
  await error.waitFor()
  await page.getByText('已填 2／共 2 个变量', { exact: true }).waitFor()
  failTemplates = false
  await error.getByRole('button', { name: /^重\s*试$/ }).click()
  await error.waitFor({ state: 'hidden' })
  await choose('首帧图片提示词 · 固定模板 · v2')
  await replacement.waitFor()
  await replacement.getByRole('button', { name: /^取\s*消$/ }).click()
  await replacement.waitFor({ state: 'hidden' })
  await page.getByText('已填 2／共 2 个变量', { exact: true }).waitFor()

  const restore = page.getByRole('button', { name: '回填到输入框', exact: true })
  await restore.click()
  await replacement.waitFor()
  await replacement.getByRole('button', { name: /^取\s*消$/ }).press('Escape')
  await replacement.waitFor({ state: 'hidden' })
  await page.getByText('已填 2／共 2 个变量', { exact: true }).waitFor()
  assert.deepEqual(writes, [])

  const selectModel = async (mode) => {
    await page.locator('.experiment-model-trigger').click()
    await page.getByRole('button', { name: labNames[mode] + '测试模型', exact: true }).click()
  }
  const send = async (mode) => {
    await selectModel(mode)
    const run = page.waitForResponse(response => response.url().includes('/chat/sessions/') && response.request().method() === 'POST')
    await page.getByRole('button', { name: /^发\s*送$/ }).click()
    assert.ok((await run).ok())
    await page.getByText('测试结果', { exact: true }).waitFor()
  }
  await send('text')

  // Nested conversion confirmation closes before the editor and uses panel edits.
  await edit.click()
  await place.fill('海岸')
  await editor.getByRole('button', { name: '转为自由输入', exact: true }).click()
  const convert = page.getByRole('dialog', { name: '转为自由输入？' })
  await convert.waitFor()
  await convert.getByRole('button', { name: /^取\s*消$/ }).press('Escape')
  await convert.waitFor({ state: 'hidden' })
  await assertField(place, '海岸')
  await editor.getByRole('button', { name: '转为自由输入', exact: true }).click()
  await convert.getByRole('button', { name: /^转\s*换$/ }).click()
  const textInput = page.getByRole('textbox', { name: '文本提示词', exact: true })
  await assertField(textInput, '角色 旅人，地点 海岸。')
  await openLabAddition(page, '选择提示词模板')
  await choose('首帧图片提示词 · 固定模板 · v2')
  await replacement.getByRole('button', { name: /^替\s*换$/ }).click()
  await page.getByText('无需填写变量', { exact: true }).waitFor()
  await openLabAddition(page, '选择提示词模板')
  await choose('首帧图片提示词 · ' + longName + ' · v2')
  await replacement.getByRole('button', { name: /^替\s*换$/ }).click()
  await page.getByText('已填 0／共 20 个变量', { exact: true }).waitFor()
  await page.setViewportSize({ width: 375, height: 440 })
  await edit.click()
  await editor.getByRole('textbox', { name: '变量 20', exact: true }).fill('长表单可编辑')
  const panel = await editor.boundingBox()
  assert.ok(Math.abs(panel.width - 375) < 1)
  const applyBox = await apply.boundingBox()
  assert.ok(applyBox.y >= 0 && applyBox.y + applyBox.height <= 441)
  await page.screenshot({ path: join(output, 'template-panel-narrow.png'), animations: 'disabled' })
  await cancel.click()
  await editor.waitFor({ state: 'hidden' })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.getByRole('article').filter({ hasText: '角色 旅人，地点 山谷。' }).getByRole('button', { name: '回填到输入框', exact: true }).click()
  await replacement.getByRole('button', { name: /^替\s*换$/ }).click()
  await assertField(textInput, '角色 旅人，地点 山谷。')
  assert.equal(writes.length, 1)

  for (const mode of ['image', 'video']) {
    await goToLab(mode)
    await openLabAddition(page, '选择提示词模板')
    await choose((mode === 'image' ? '首帧图片' : '视频提示词') + ' · 角色与地点 · v2')
    await edit.click()
    await place.fill(mode === 'image' ? '森林' : '雪原')
    await apply.click()
    await editor.waitFor({ state: 'hidden' })
    await send(mode)
    const priorInput = mode === 'image' ? '角色 旅人，地点 森林。' : '角色 旅人，地点 雪原。'
    await page.getByRole('article').filter({ hasText: priorInput }).getByRole('button', { name: '回填到输入框', exact: true }).click()
    await replacement.getByRole('button', { name: /^替\s*换$/ }).click()
    await assertField(page.getByRole('textbox', { name: labNames[mode] + '提示词', exact: true }), priorInput)
    await page.getByRole('button', { name: labNames[mode] + '测试模型', exact: true }).waitFor()
  }
  assert.deepEqual(submitted, [
    { mode: 'text', content: '角色 旅人，地点 山谷。' },
    { mode: 'image', content: '角色 旅人，地点 森林。' },
    { mode: 'video', content: '角色 旅人，地点 雪原。' },
  ])
  assert.equal(writes.length, 3)
  assert.deepEqual(pageErrors, [])
  console.log('实验室模板配置验收通过', output)
} finally {
  await cleanup()
}
