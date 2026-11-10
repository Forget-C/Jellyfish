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
let created = 0
let failHistory = false
let failedType
let hideHistory = false
let lookupImage
let imageLookupPending = false
const prematureImageMessages = []
const message = (id, session_id, role, content, sequence) => ({ id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp })
const frame = (event, sequence, data) =>
  'id: ' + sequence + '\nevent: ' + event + '\ndata: ' + JSON.stringify({ version: 1, event, sequence, created_at: timestamp, data }) + '\n\n'

const server = await createServer({ root, server: { host: '127.0.0.1', port: 4197, strictPort: true, open: false } })
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
        const newSession = session('new-text', lab_type, title)
        sessions.unshift(newSession)
        created += 1
        return respond(newSession)
      }
      const labType = url.searchParams.get('lab_type')
      if (failHistory || failedType === labType) return route.fulfill({ status: 503, json: { detail: '暂时不可用' } })
      if (labType === 'image' && lookupImage) await lookupImage
      return respond(hideHistory ? [] : sessions.filter(item => item.lab_type === labType))
    }
    if (url.pathname.endsWith('/models')) return respond({ items: [{ id: 'model-1', name: '验收文本模型', category: 'text' }] })
    if (url.pathname.endsWith('/new-text/stream')) {
      const user = message('user-1', 'new-text', 'user', request.postDataJSON().content, 1)
      const assistant = message('assistant-1', 'new-text', 'assistant', '验收回复', 2)
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
    if (url.pathname.endsWith('/messages')) return respond([])
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  await page.goto(origin + '/image-lab?keep=1')
  await page.waitForURL(url => url.pathname === '/lab' && url.searchParams.get('mode') === 'image' && url.searchParams.get('keep') === '1')
  const types = page.getByRole('navigation', { name: '实验室类型' })
  const history = page.getByRole('navigation', { name: '当前类型会话' })
  await history.getByRole('button', { name: '图片历史 1', exact: true }).waitFor()
  assert.equal(await types.getByRole('button', { name: '图片', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await history.getByRole('button', { name: '文本历史一', exact: true }).count(), 0)
  const imageInput = page.getByPlaceholder('描述你想生成的图片…')
  const imageInputBefore = await imageInput.boundingBox()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).scrollIntoViewIfNeeded()
  assert.deepEqual(await imageInput.boundingBox(), imageInputBefore)
  await history.getByRole('button', { name: '图片历史 24', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('session') === 'image-24')
  assert.equal(await history.getByRole('button', { name: '图片历史 24', exact: true }).getAttribute('aria-current'), 'page')
  await types.getByRole('button', { name: '视频', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('mode') === 'video')
  await history.getByRole('button', { name: '视频历史一', exact: true }).waitFor()
  await page.goBack()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).waitFor()
  assert.equal(await history.getByRole('button', { name: '图片历史 24', exact: true }).getAttribute('aria-current'), 'page')
  await page.reload()
  await history.getByRole('button', { name: '图片历史 24', exact: true }).waitFor()

  await types.getByRole('button', { name: '文本', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('mode') === 'text')
  await page.getByRole('button', { name: /新建对话/ }).click()
  assert.equal(created, 0)
  await page.getByRole('button', { name: /选择模型/ }).click()
  await page.getByRole('button', { name: /验收文本模型/ }).waitFor()
  await page.keyboard.press('Escape')
  const textInput = page.getByPlaceholder('输入提示词；Shift + Enter 换行')
  await textInput.fill('首次提交')
  await textInput.press('Enter')
  await page.waitForURL(url => url.searchParams.get('session') === 'new-text')
  await page.getByText('验收回复', { exact: true }).waitFor()
  assert.equal(created, 1)

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
  assert.equal(await history.getByRole('button', { name: '图片历史 1', exact: true }).getAttribute('aria-current'), 'page')
  await imageInput.waitFor()
  await page.getByRole('alert').getByText('部分会话读取失败', { exact: true }).waitFor()
  assert.deepEqual(prematureImageMessages, [])
  failedType = undefined
  await page.getByRole('button', { name: '重试' }).click()
  await page.getByText('部分会话读取失败', { exact: true }).waitFor({ state: 'hidden' })
  assert.equal(await history.getByRole('button', { name: '图片历史 1', exact: true }).getAttribute('aria-current'), 'page')

  hideHistory = true
  await page.goto(origin + '/lab')
  await history.getByText('暂无会话', { exact: true }).waitFor()
  await types.getByRole('button', { name: '图片', exact: true }).click()
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
    await drawer.getByRole('button', { name: width === 900 ? '文本' : '图片', exact: true }).waitFor()
    await page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden' })
    await trigger.and(page.locator(':focus')).waitFor()
    await trigger.click()
    await drawer.getByRole('button', { name: width === 900 ? '图片' : '视频', exact: true }).click()
    await drawer.waitFor({ state: 'hidden' })
    await page.waitForURL(url => url.searchParams.get('mode') === (width === 900 ? 'image' : 'video'))
    await trigger.and(page.locator(':focus')).waitFor()
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 2))
    await page.screenshot({ path: output + '/' + width + '-lab.png', animations: 'disabled' })
  }
  assert.deepEqual(pageErrors, [])
  console.log('Lab navigation, existing history, first submission and mobile focus verified.')
} finally {
  await cleanup()
}
