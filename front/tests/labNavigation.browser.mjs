import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-navigation-')
const origin = 'http://127.0.0.1:4197'
const timestamp = '2026-09-15T00:00:00Z'
const session = (id, lab_type, title) => ({ id, lab_type, title, updated_at: timestamp, created_at: timestamp })
const sessions = [
  session('text-1', 'text', '文本历史一'),
  ...Array.from({ length: 24 }, (_, index) => session('image-' + (index + 1), 'image', '图片历史 ' + (index + 1))),
  session('video-1', 'video', '视频历史一'),
]
sessions.find(item => item.id === 'image-1').updated_at = '2026-09-17T00:00:00Z'
sessions.find(item => item.id === 'video-1').updated_at = '2026-09-16T00:00:00Z'
let created = 0
let clearAttempts = 0
let deleteAttempts = 0
const modelNames = { text: '验收文本模型', image: '验收图片模型', video: '验收视频模型' }
const mediaRequests = []
const persisted = new Map()
let failHistory = false
let failedType
let hideHistory = false
let lookupImage
let imageLookupPending = false
const prematureImageMessages = []
const message = (id, session_id, role, content, sequence) => ({ id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp })
const frame = (event, sequence, data) =>
  'id: ' + sequence + '\nevent: ' + event + '\ndata: ' + JSON.stringify({ version: 1, event, sequence, created_at: timestamp, data }) + '\n\n'

const server = await createServer({ root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false } })
let browser
const cleanup = browserCleanup(() => ({ browser, server }))
try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (url.pathname.endsWith('/experiment-sessions')) {
      if (request.method() === 'POST') {
        const { title, lab_type } = request.postDataJSON()
        assert.equal(lab_type, 'text')
        const newSession = { ...session('new-text', lab_type, title), updated_at: '2026-09-18T00:00:00Z' }
        sessions.unshift(newSession)
        created += 1
        return respond(newSession)
      }
      const labType = url.searchParams.get('lab_type')
      if (failHistory || failedType === labType) return route.fulfill({ status: 503, json: { detail: '暂时不可用' } })
      if (labType === 'image' && lookupImage) await lookupImage
      return respond(hideHistory ? [] : sessions.filter(item => item.lab_type === labType))
    }
    if (url.pathname.endsWith('/models')) {
      const category = url.searchParams.get('category')
      return respond({ items: [{ id: 'model-1', name: modelNames[category], category }] })
    }
    if (url.pathname.endsWith('/video-generation-options')) return respond({ model_id: url.searchParams.get('model_id'), allowed_ratios: ['16:9'] })
    if (url.pathname.endsWith('/new-text/messages') && request.method() === 'DELETE') {
      clearAttempts += 1
      if (clearAttempts === 1) return route.fulfill({ status: 409, json: { detail: '清空失败' } })
      persisted.delete('new-text')
      return respond(null)
    }
    if (url.pathname.endsWith('/experiment-sessions/new-text') && request.method() === 'DELETE') {
      deleteAttempts += 1
      return respond(null)
    }
    const mediaRun = url.pathname.match(/\/labs\/(image|video)\/sessions\/([^/]+)\/tasks$/)
    if (mediaRun) {
      const [, mode, sessionId] = mediaRun
      const body = request.postDataJSON()
      mediaRequests.push({ mode, sessionId, prompt: body.execution_prompt })
      const messages = [
        message(mode + '-user', sessionId, 'user', body.execution_prompt, 1),
        { ...message(mode + '-result', sessionId, 'assistant', mode + ' 已提交', 2), task_id: mode + '-task', status: 'succeeded' },
      ]
      persisted.set(sessionId, messages)
      return respond({ task_id: mode + '-task', messages })
    }
    if (url.pathname.endsWith('/new-text/stream')) {
      const user = message('user-1', 'new-text', 'user', request.postDataJSON().content, 1)
      const assistant = message('assistant-1', 'new-text', 'assistant', '验收回复', 2)
      persisted.set('new-text', [user, assistant])
      return route.fulfill({
        contentType: 'text/event-stream',
        body: frame('accepted', 1, { task_id: 'lab-run', user_message: user }) +
          frame('completed', 2, {
            task_id: 'lab-run', assistant_message: assistant,
            result: { text: assistant.content, model_id: 'model-1', provider_request_id: null, input_tokens: null, output_tokens: null },
          }),
      })
    }
    if (url.pathname.endsWith('/image-1/messages') && imageLookupPending) prematureImageMessages.push(url.pathname)
    if (url.pathname.endsWith('/messages')) return respond(persisted.get(url.pathname.split('/').at(-2)) ?? [])
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  await page.goto(origin + '/lab?mode=image')
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  await page.setViewportSize({ width: 375, height: 812 })
  const draftHeading = page.getByRole('heading', { name: /Lab.*Image.*New session/ })
  assert.ok(await draftHeading.evaluate(node => node.scrollWidth <= node.clientWidth + 1), 'Full new session title at 375px')
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(origin + '/lab?mode=image&keep=1')
  await page.waitForURL(url => url.pathname === '/lab' && url.searchParams.get('mode') === 'image' && url.searchParams.get('keep') === '1')
  const types = page.locator('.experiment-navigation')
  const startDraft = async label => {
    await page.getByRole('button', { name: '新建会话', exact: true }).click()
    await page.getByRole('menuitem', { name: label + '会话', exact: true }).click()
  }
  const history = page.getByRole('navigation', { name: '最近会话' })
  await history.getByRole('button', { name: '图片历史 1', exact: true }).waitFor()
  assert.deepEqual(await history.locator('.experiment-session-link').evaluateAll(items => items.slice(0, 3).map(item => item.textContent)), ['图片历史 1', '视频历史一', '文本历史一'])
  assert.equal(await page.getByRole('navigation', { name: '实验室类型' }).count(), 0)
  assert.equal(await history.getByRole('button', { name: '文本历史一', exact: true }).count(), 1)
  await page.getByRole('heading', { name: '实验室 · 图片 · 新会话', exact: true }).waitFor()
  const imageInput = page.getByRole('textbox', { name: '图片提示词', exact: true })
  const imageInputBefore = await imageInput.boundingBox()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).scrollIntoViewIfNeeded()
  assert.deepEqual(await imageInput.boundingBox(), imageInputBefore)
  await history.getByRole('button', { name: '图片历史 24', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('session') === 'image-24')
  await history.getByRole('button', { name: '图片历史 24', exact: true }).and(page.locator('[aria-current="page"]')).waitFor()
  assert.equal(await history.getByRole('button', { name: '图片历史 24', exact: true }).getAttribute('aria-current'), 'page')
  await startDraft('视频')
  await page.waitForURL(url => url.searchParams.get('mode') === 'video')
  await history.getByRole('button', { name: '视频历史一', exact: true }).waitFor()
  await page.goBack()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).waitFor()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).and(page.locator('[aria-current="page"]')).waitFor()
  assert.equal(await history.getByRole('button', { name: '图片历史 24', exact: true }).getAttribute('aria-current'), 'page')
  await page.reload()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).waitFor()

  await startDraft('文本')
  await page.waitForURL(url => url.searchParams.get('mode') === 'text')
  await page.getByRole('button', { name: '新建会话', exact: true }).click()
  await page.keyboard.press('Escape')
  assert.equal(created, 0)
  await page.getByRole('button', { name: /选择模型/ }).click()
  await page.getByRole('button', { name: /验收文本模型/ }).waitFor()
  await page.keyboard.press('Escape')
  const textInput = page.getByRole('textbox', { name: '文本提示词', exact: true })
  await textInput.fill('首次提交')
  await textInput.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, isComposing: true })
  assert.equal(await textInput.inputValue(), '首次提交')
  assert.equal(created, 0)
  await textInput.press('Shift+Enter')
  assert.equal(await textInput.inputValue(), '首次提交\n')
  await textInput.press('Enter')
  await page.waitForURL(url => url.searchParams.get('session') === 'new-text')
  await page.getByText('验收回复', { exact: true }).waitFor()
  assert.equal(created, 1)
  await page.getByRole('heading', { name: '实验室 · 文本 · 新文本会话', exact: true }).waitFor()

  const openClear = async () => {
    await page.getByRole('button', { name: '更多会话操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '清空会话内容', exact: true }).click()
    return page.getByRole('dialog', { name: '清空会话内容', exact: true })
  }
  let confirm = await openClear()
  await confirm.getByText(/新文本会话.*历史消息.*保留会话本身/).waitFor()
  await confirm.getByRole('button', { name: /取\s*消/ }).click()
  await confirm.waitFor({ state: 'hidden' })
  assert.equal(clearAttempts, 0)
  confirm = await openClear()
  await confirm.getByRole('button', { name: '清空会话内容', exact: true }).click()
  await confirm.getByRole('alert').getByText(/清空会话失败/).waitFor()
  await page.getByText('验收回复', { exact: true }).waitFor()
  await confirm.getByRole('button', { name: '清空会话内容', exact: true }).click()
  await confirm.waitFor({ state: 'hidden' })
  await page.getByText('验收回复', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(clearAttempts, 2)
  assert.equal(deleteAttempts, 0)

  await history.getByRole('button', { name: '新文本会话', exact: true }).hover()
  await history.getByRole('button', { name: '新文本会话 更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除会话', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: '删除会话', exact: true })
  await deletion.getByText(/新文本会话.*历史消息/).waitFor()
  await deletion.getByRole('button', { name: /取\s*消/ }).click()
  await deletion.waitFor({ state: 'hidden' })
  assert.equal(deleteAttempts, 0)

  for (const [mode, sessionId, label] of [['image', 'image-24', '图片'], ['video', 'video-1', '视频']]) {
    await page.goto(origin + '/lab?session=' + sessionId)
    const input = page.getByRole('textbox', { name: label + '提示词', exact: true })
    await input.waitFor()
    await page.getByRole('button', { name: '选择模型', exact: true }).click()
    await page.getByRole('button', { name: modelNames[mode], exact: true }).waitFor()
    await input.fill(label + '实验输入')
    const sentBefore = mediaRequests.length
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, isComposing: true })
    await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229 })
    assert.equal(await input.inputValue(), label + '实验输入')
    await input.press('Shift+Enter')
    assert.equal(await input.inputValue(), label + '实验输入\n')
    assert.equal(mediaRequests.length, sentBefore, '输入法选词和换行不发送任务')
    await input.press('Enter')
    await page.getByText(mode + ' 已提交', { exact: true }).waitFor()
  }
  assert.deepEqual(mediaRequests, [
    { mode: 'image', sessionId: 'image-24', prompt: '图片实验输入' },
    { mode: 'video', sessionId: 'video-1', prompt: '视频实验输入' },
  ])

  failedType = 'video'
  await page.goto(origin + '/')
  const homeSession = page.getByRole('region', { name: '最近实验室会话' }).getByRole('link', { name: /图片历史 1/ })
  await homeSession.waitFor()
  let releaseImageLookup
  lookupImage = new Promise(resolve => { releaseImageLookup = resolve })
  imageLookupPending = true
  await homeSession.click()
  await page.waitForURL(url => url.searchParams.get('session') === 'image-1')
  await history.getByText('正在读取会话…', { exact: true }).waitFor()
  imageLookupPending = false
  releaseImageLookup()
  lookupImage = undefined
  await history.getByRole('button', { name: '图片历史 1', exact: true }).waitFor()
  await history.getByRole('button', { name: '图片历史 1', exact: true }).and(page.locator('[aria-current="page"]')).waitFor()
  assert.equal(await history.getByRole('button', { name: '图片历史 1', exact: true }).getAttribute('aria-current'), 'page')
  await imageInput.waitFor()
  await page.getByRole('alert').getByText('视频会话读取失败', { exact: true }).waitFor()
  assert.deepEqual(prematureImageMessages, [])
  await imageInput.fill('刷新时保留的图片草稿')
  failedType = 'image'
  const retry = page.getByRole('button', { name: '重试', exact: true })
  await Promise.all([
    page.waitForResponse(response => response.url().includes('lab_type=image') && response.status() === 503),
    retry.click(),
  ])
  await retry.waitFor()
  await page.getByRole('heading', { name: '实验室 · 图片 · 图片历史 1', exact: true }).waitFor()
  assert.equal(await imageInput.inputValue(), '刷新时保留的图片草稿')
  await history.getByRole('button', { name: '图片历史 2', exact: true }).waitFor()
  await imageInput.fill('')
  failedType = undefined
  await page.getByRole('button', { name: '重试' }).click()
  await page.getByText('图片会话读取失败', { exact: true }).waitFor({ state: 'hidden' })
  await history.getByRole('button', { name: '图片历史 1', exact: true }).and(page.locator('[aria-current="page"]')).waitFor()
  assert.equal(await history.getByRole('button', { name: '图片历史 1', exact: true }).getAttribute('aria-current'), 'page')

  hideHistory = true
  await page.goto(origin + '/lab')
  await history.getByText('暂无会话，从右上方新建开始', { exact: true }).waitFor()
  await startDraft('图片')
  await imageInput.waitFor()
  await page.goBack()
  await page.waitForURL(origin + '/lab')
  await textInput.waitFor()
  hideHistory = false

  failHistory = true
  await page.goto(origin + '/lab?mode=text')
  await page.getByRole('alert').getByText('读取会话失败').waitFor()
  failHistory = false
  await page.getByRole('button', { name: '重试' }).click()
  await history.getByRole('button', { name: '文本历史一', exact: true }).waitFor()

  for (const width of [900, 375]) {
    await page.setViewportSize({ width, height: 812 })
    const trigger = page.getByRole('button', { name: '会话导航', exact: true })
    await trigger.focus()
    await trigger.press('Enter')
    const drawer = page.getByRole('dialog').filter({ has: types })
    await drawer.getByRole('button', { name: '新建会话', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden' })
    await trigger.and(page.locator(':focus')).waitFor()
    await trigger.click()
    await startDraft(width === 900 ? '图片' : '视频')
    await drawer.waitFor({ state: 'hidden' })
    await page.waitForURL(url => url.searchParams.get('mode') === (width === 900 ? 'image' : 'video'))
    await trigger.and(page.locator(':focus')).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    await page.screenshot({ path: output + '/' + width + '-lab.png', animations: 'disabled' })
  }
  const sizes = [[1440, 900], [1366, 768], [1024, 440], [375, 812], [1023, 768], [767, 812], [768, 812]]
  for (const [theme, label] of [['mist', '雾蓝微渐变'], ['solid', '雾蓝纯色']]) {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(origin + '/lab?mode=text')
    await page.getByRole('button', { name: '用户与语言设置', exact: true }).click()
    await page.getByRole('menuitemradio', { name: label, exact: true }).click()
    await page.getByRole('menuitemradio', { name: label, exact: true }).waitFor({ state: 'hidden' })
    const heading = page.getByRole('heading', { name: '实验室 · 文本 · 新会话', exact: true })
    const send = page.getByRole('button', { name: '发送', exact: true })
    await heading.waitFor()
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height })
      const layout = await heading.evaluate(element => ({
        fontSize: getComputedStyle(element).fontSize,
        barHeight: element.parentElement.getBoundingClientRect().height,
        hasOverflow: document.documentElement.scrollWidth > innerWidth,
      }))
      assert.equal(layout.fontSize, '16px')
      assert.ok(layout.barHeight >= 52 && layout.barHeight <= 56)
      assert.equal(layout.hasOverflow, false)
      if (width < 1024) await page.getByRole('button', { name: '会话导航', exact: true }).waitFor()
      else assert.equal(Math.round((await types.boundingBox()).width), 216)
      await page.waitForFunction(({ button, controlHeight }) => {
        const bounds = button.getBoundingClientRect()
        return Math.abs(bounds.height - controlHeight) < 0.5 && bounds.bottom <= innerHeight
      }, { button: await send.elementHandle(), controlHeight: width >= 1024 ? 32 : 36 })
      await page.waitForFunction(expectedRows => {
        const editor = document.querySelector('textarea[aria-label="文本提示词"]')
        const rows = editor.clientHeight / parseFloat(getComputedStyle(editor).lineHeight)
        return Math.abs(rows - expectedRows) < 0.2
      }, height <= 540 ? 2 : 3)
      const color = await page.getByRole('banner').evaluate(element => getComputedStyle(element.parentElement).backgroundImage)
      assert.equal(color === 'none', theme === 'solid')
      if (sizes.slice(0, 4).some(([w, h]) => w === width && h === height)) {
        await page.screenshot({ path: output + '/' + theme + '-' + width + 'x' + height + '-lab.png', animations: 'disabled' })
      }
    }
  }
  // 低高度浏览器视口验证路由可达性，实体软键盘需要另行验收。
  await page.setViewportSize({ width: 375, height: 320 })
  const compactInput = page.getByRole('textbox', { name: '文本提示词', exact: true })
  await compactInput.scrollIntoViewIfNeeded()
  await compactInput.focus()
  await page.keyboard.press('Tab')
  const compactModel = page.getByRole('button', { name: '选择模型', exact: true })
  await compactModel.and(page.locator(':focus-visible')).waitFor()
  await compactModel.press('Enter')
  const compactOption = page.getByRole('menuitemradio', { name: '验收文本模型', exact: true })
  await compactOption.waitFor()
  await compactOption.focus()
  await compactOption.press('Escape')
  await compactOption.waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '验收文本模型', exact: true }).and(page.locator(':focus-visible')).waitFor()
  const compactSend = page.getByRole('button', { name: '发送', exact: true })
  await compactSend.scrollIntoViewIfNeeded()
  assert.ok(await compactSend.evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return bounds.top >= 0 && bounds.bottom <= innerHeight && document.documentElement.scrollWidth <= innerWidth
  }))
  await page.screenshot({ path: output + '/solid-375x320-lab.png', animations: 'disabled' })
  assert.deepEqual(pageErrors, [])
  console.log('Lab navigation, existing history, first submission and mobile focus verified.')
} finally {
  await cleanup()
}
