import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
process.chdir(root)
const output = await browserOutput('jellyfish-lab-results-')
const origin = 'http://127.0.0.1:4805'
const timestamp = '2026-09-15T00:00:00Z'
const session = (id, lab_type, title) => ({ id, lab_type, title, updated_at: timestamp, created_at: timestamp })
const sessions = [session('text-history', 'text', '文本历史'), session('text-long', 'text', '长会话'), session('image-history', 'image', '图片历史'), session('image-stale-poll', 'image', '轮询过期会话'), session('video-history', 'video', '视频历史'), session('portrait-history', 'video', '竖视频历史')]
const item = (id, session_id, role, content, sequence, extra = {}) => ({
  id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp, ...extra,
})
const server = await createServer({ root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4805, strictPort: true, open: false } })
let browser
let failTextHistory = true
let textHistoryReads = 0
let failEarlier = true
let imageReadsFail = false
let failPortrait = true
const imageUrls = ['/lab-test-media/landscape.svg', '/lab-test-media/portrait.svg']
// Local VP9 fixture: four solid blue frames at 96×160, generated once for aspect-ratio checks.
const portraitVideo = Buffer.from([
  'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQJChYECGFOAZwEAAAAAAAJBEU2bdLpNu4tTq4QVSalmU6yBoU',
  '27i1OrhBZUrmtTrIHWTbuMU6uEElTDZ1OsggEjTbuMU6uEHFO7a1OsggIr7AEAAAAAAABZAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
  'AAAAAAAAAVSalmsCrXsYMPQkBNgIxMYXZmNjIuMy4xMDBXQYxMYXZmNjIuMy4xMDBEiYhAn0AAAAAAABZUrmvIrgEA',
  'AAAAAAA/14EBc8WIje0dAVDi8GqcgQAitZyDdW5kiIEAhoVWX1ZQOYOBASPjg4QdzWUA4JCwgWC6gaCagQJVsIRVuY',
  'EBElTDZ0B/c3OfY8CAZ8iZRaOHRU5DT0RFUkSHjExhdmY2Mi4zLjEwMHNz2mPAi2PFiI3tHQFQ4vBqZ8ilRaOHRU5D',
  'T0RFUkSHmExhdmM2Mi4xMS4xMDAgbGlidnB4LXZwOWfIoUWjiERVUkFUSU9ORIeTMDA6MDA6MDIuMDAwMDAwMDAwAB',
  '9DtnX+54EAo7GBAACAgkmDQgAF8An2ADgkHBhKAAAwYAAAZz///v9O/////9R2H////V8dRitA9zwAo5aBAfQAhgBA',
  'kpwAUAAAAyAAAFk5RtAAo5aBA+gAhgBAkpwATuAAAyAAAFk5RtAAo5aBBdwAhgBAkpwAUAAAAyAAAFk5RtAAHFO7a5',
  'G7j7OBALeK94EB8YIBqPCBAw==',
].join(''), 'base64')
const fixtureImage = (width, height, color) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`
let imageStatus = 'unavailable'
let videoStatus = 'unavailable'
const imagePrompt = item('image-prompt', 'image-history', 'user', '图片实验原始提示词', 1)
const imageTask = item('image-task', 'image-history', 'task', '图片生成任务已提交，正在等待生成结果。', 2, {
  task_id: 'image-run', status: 'queued',
})
let staleHistoryAvailable = false
let staleStatusAvailable = true
const stalePrompt = item('stale-prompt', 'image-stale-poll', 'user', '轮询故障后读取历史', 1)
const staleTask = item('stale-task', 'image-stale-poll', 'task', '图片生成任务已提交，正在等待生成结果。', 2, {
  task_id: 'stale-run', status: 'queued',
})
const writes = []
const cleanup = browserCleanup(() => ({ browser, server }))

try {
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } })
  page.setDefaultTimeout(5000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: location.origin } })
  await page.route('**/lab-test-media/portrait.webm', route => route.fulfill({ contentType: 'video/webm', body: portraitVideo }))
  await page.route('**/lab-test-media/*.svg', async route => {
    const portrait = route.request().url().endsWith('/portrait.svg')
    if (portrait && failPortrait) return route.fulfill({ status: 404 })
    return route.fulfill({ contentType: 'image/svg+xml', body: portrait ? fixtureImage(480, 720, '#245fc5') : fixtureImage(720, 480, '#148055') })
  })
  await page.route('**/api/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const respond = data => route.fulfill({ json: { success: true, data } })
    if (request.method() !== 'GET') writes.push(url.pathname)
    if (url.pathname.endsWith('/experiment-sessions')) {
      return respond(sessions.filter(entry => entry.lab_type === url.searchParams.get('lab_type')))
    }
    if (url.pathname.endsWith('/chat/sessions/text/text-history')) {
      textHistoryReads++
      if (failTextHistory) return route.fulfill({ status: 503, json: { detail: '历史服务暂不可用' } })
      return respond([item('text-answer', 'text-history', 'assistant', '历史回复', 2), item('text-prompt', 'text-history', 'user', '短提示词', 1)])
    }
    if (url.pathname.endsWith('/chat/sessions/text/text-long')) {
      const earlier = url.searchParams.get('page') === '2'
      if (earlier && failEarlier) return route.fulfill({ status: 503, json: { detail: '更早消息暂不可用' } })
      return respond(Array.from({ length: 50 }, (_, index) => {
        const sequence = (earlier ? 50 : 100) - index
        return item('long-' + sequence, 'text-long', 'assistant', `第 ${sequence} 条历史`, sequence)
      }))
    }
    if (url.pathname.endsWith('/chat/sessions/media/image-history')) {
      if (imageReadsFail) return route.fulfill({ status: 503, json: { detail: '历史服务暂不可用' } })
      return respond([imageTask, imagePrompt])
    }
    if (url.pathname.endsWith('/models')) return respond({ items: [{ id: 'image-model', name: '验收图片模型', category: 'image' }] })
    if (url.pathname.endsWith('/image-stale-poll/turns')) return respond({ task_id: 'stale-run', messages: [staleTask, stalePrompt] })
    if (url.pathname.endsWith('/chat/sessions/media/image-stale-poll')) {
      if (!staleHistoryAvailable) return route.fulfill({ status: 503 })
      return respond([{ ...staleTask, status: 'succeeded', payload: { result: { images: [{ url: imageUrls[0] }] } } }, stalePrompt])
    }
    if (url.pathname.endsWith('/chat/sessions/media/portrait-history')) {
      return respond([item('portrait-result', 'portrait-history', 'task', '视频生成任务已提交，正在等待生成结果。', 2, {
        task_id: 'portrait-run', status: 'succeeded', payload: { result: { url: '/lab-test-media/portrait.webm' } },
      })])
    }
    if (url.pathname.endsWith('/chat/sessions/media/video-history')) {
      return respond([item('video-result', 'video-history', 'task', '视频生成任务已提交，正在等待生成结果。', 2, {
        task_id: 'video-run', status: videoStatus === 'succeeded' ? 'succeeded' : 'queued', payload: { result: { url: '/canvas-presets/pan.mp4' } },
      })])
    }
    if (url.pathname.includes('/files/') && url.pathname.endsWith('/download')) {
      const file = url.pathname.split('/').at(-2)
      if (file === 'landscape' || file === 'portrait') {
        if (file === 'portrait' && failPortrait) return route.fulfill({ status: 404 })
        return route.fulfill({ contentType: 'image/svg+xml', body: file === 'portrait'
          ? fixtureImage(480, 720, '#245fc5') : fixtureImage(720, 480, '#148055') })
      }
      return route.fulfill({ contentType: 'video/webm', body: portraitVideo })
    }
    if (url.pathname.includes('/chat/sessions/media/') && url.pathname.endsWith('/events')) {
      const id = url.pathname.split('/').at(-2)
      const stale = id === 'image-stale-poll'
      const image = id === 'image-history'
      const status = stale ? (staleStatusAvailable ? 'running' : 'unavailable') : image ? imageStatus : videoStatus
      if (status === 'unavailable') return route.fulfill({ status: 503 })
      const type = status === 'succeeded' ? 'task.completed' : 'task.progress'
      const cursor = status === 'succeeded' ? 2 : 1
      const artifacts = status === 'succeeded' ? (image ? ['landscape', 'portrait'] : ['video-file'])
        .map((file_id, ordinal) => ({ file_id, ordinal, media_type: image ? 'image' : 'video', deleted: false })) : []
      const payload = { task_id: stale ? 'stale-run' : image ? 'image-run' : 'video-run',
        model_id: 'trial-model', model_name: 'Trial Provider Model', stage: status, status, artifacts,
        progress: stale ? 29 : image ? 38 : 42, error: '' }
      const frame = `id: ${cursor}\nevent: ${type}\ndata: ${JSON.stringify({ session_id: id, turn_id: 'turn', cursor, type, payload })}\n\n`
      return route.fulfill({ contentType: 'text/event-stream', body: cursor > Number(url.searchParams.get('after')) ? frame + frame : ': heartbeat\n\n' })
    }
    if (url.pathname.endsWith('/film/tasks')) return respond({ items: [], next_cursor: null })
    return respond([])
  })

  await page.goto(origin + '/lab?session=text-history')
  const history = page.getByRole('region', { name: '会话消息' })
  await history.getByText('会话消息读取失败', { exact: true }).waitFor()
  assert.equal(await history.getByText('选择模型并输入提示词，开始一轮文本实验').count(), 0)
  const input = page.getByRole('textbox', { name: '文本提示词' })
  await input.fill('未发送的提示词')
  const readsBeforeRetry = textHistoryReads
  failTextHistory = false
  await history.getByRole('button', { name: '重试读取消息', exact: true }).click()
  await history.getByText('历史回复', { exact: true }).waitFor()
  assert.equal(await input.inputValue(), '未发送的提示词')
  assert.equal(textHistoryReads, readsBeforeRetry + 1)
  assert.ok((await history.getByRole('article').filter({ hasText: '短提示词' }).boundingBox()).width < 200)
  assert.deepEqual(writes, [])

  await page.goto(origin + '/lab?session=image-history')
  await history.getByText('排队', { exact: true }).waitFor()
  await history.getByText('状态暂不可用', { exact: true }).waitFor()
  assert.equal(await history.getByText('失败', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '用户与语言设置' }).click()
  await page.getByRole('menuitem', { name: 'English', exact: true }).click()
  const englishHistory = page.getByRole('region', { name: 'Session messages' })
  await englishHistory.getByText('Queued', { exact: true }).waitFor()
  imageStatus = 'running'
  await englishHistory.getByRole('button', { name: 'Retry loading status' }).click()
  await englishHistory.getByText('Generating 38%', { exact: true }).waitFor()
  imageReadsFail = true
  imageStatus = 'succeeded'
  await englishHistory.getByText('Completed', { exact: true }).waitFor()
  await englishHistory.getByText(/Trial Provider Model/).waitFor()
  await englishHistory.getByText('Could not refresh session messages', { exact: true }).waitFor()
  await englishHistory.getByText('图片实验原始提示词', { exact: true }).waitFor()
  await englishHistory.getByText('Could not load Image 2', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'User and language settings' }).click()
  await page.getByRole('menuitem', { name: '简体中文', exact: true }).click()
  assert.equal(await history.getByText(/正在等待生成结果/).count(), 0)
  await history.getByText('图片 2 加载失败', { exact: true }).waitFor()
  failPortrait = false
  await history.getByRole('button', { name: '重新加载图片 2' }).click()
  const firstPreview = history.getByRole('button', { name: '查看图片 1' })
  const secondPreview = history.getByRole('button', { name: '查看图片 2' })
  await secondPreview.waitFor()
  assert.ok((await firstPreview.boundingBox()).width <= 480)
  assert.equal(Math.round((await firstPreview.boundingBox()).y), Math.round((await secondPreview.boundingBox()).y))
  await page.screenshot({ path: output + '/mist-image-results.png', animations: 'disabled' })
  await firstPreview.focus()
  await firstPreview.press('Enter')
  const imageDialog = page.getByRole('dialog', { name: '图片预览' })
  await imageDialog.getByRole('img', { name: '图片 1', exact: true }).waitFor()
  await imageDialog.getByRole('button', { name: '下一张' }).click()
  await imageDialog.getByRole('img', { name: '图片 2', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await imageDialog.waitFor({ state: 'hidden' })
  await firstPreview.and(page.locator(':focus')).waitFor()

  await page.goto(origin + '/lab?session=video-history')
  await history.getByText('状态暂不可用', { exact: true }).waitFor()
  videoStatus = 'running'
  await history.getByRole('button', { name: '重试读取状态' }).click()
  await history.getByText('生成中 42%', { exact: true }).waitFor()
  videoStatus = 'succeeded'
  await history.getByText('已完成', { exact: true }).waitFor()
  const videoPreview = history.getByRole('button', { name: '播放视频' })
  await videoPreview.waitFor()
  const listVideo = videoPreview.locator('video')
  assert.equal(await listVideo.evaluate(video => video.paused && !video.autoplay), true)
  const videoWidth = (await videoPreview.boundingBox()).width
  assert.ok(videoWidth >= 360 && videoWidth <= 480, `video preview width ${videoWidth}`)
  await videoPreview.click()
  const videoDialog = page.getByRole('dialog', { name: '视频预览' })
  const player = await videoDialog.locator('video[controls]').elementHandle()
  await page.waitForFunction(dialog => dialog.contains(document.activeElement), await videoDialog.elementHandle())
  await player.evaluate(video => video.play())
  await page.keyboard.press('Escape')
  await videoDialog.waitFor({ state: 'hidden' })
  assert.equal(await player.evaluate(video => video.paused), true)
  await videoPreview.and(page.locator(':focus')).waitFor()

  await page.goto(origin + '/lab?session=text-long')
  const firstVisible = history.getByText('第 51 条历史', { exact: true })
  await firstVisible.waitFor()
  await page.waitForFunction(region => region.scrollTop > 0, await history.elementHandle())
  await history.evaluate(region => { region.scrollTop = 0 })
  const latest = page.getByRole('button', { name: '回到最新', exact: true })
  await latest.waitFor()
  await history.getByRole('button', { name: '加载更早消息' }).click()
  await history.getByText('更早消息读取失败', { exact: true }).waitFor()
  await firstVisible.waitFor()
  failEarlier = false
  const prior = (await firstVisible.boundingBox()).y
  await history.getByRole('button', { name: '重试加载更早消息' }).click()
  await history.getByText('第 1 条历史', { exact: true }).waitFor()
  assert.ok(Math.abs((await firstVisible.boundingBox()).y - prior) < 5, 'prepend preserves the reading position')
  await latest.click()
  assert.ok(await history.evaluate(region => region.scrollHeight - region.clientHeight - region.scrollTop < 3))

  await page.goto(origin + '/lab?session=portrait-history')
  await videoPreview.waitFor()
  await page.getByRole('button', { name: '用户与语言设置', exact: true }).click()
  await page.getByRole('menuitemradio', { name: '雾蓝纯色', exact: true }).click()
  for (const [width, height] of [[1440, 900], [1024, 440], [375, 812]]) {
    await page.setViewportSize({ width, height })
    const preview = await videoPreview.boundingBox()
    assert.ok(preview.width <= Math.min(480, width) && preview.height <= 280)
    assert.deepEqual(await videoPreview.locator('video').evaluate(video => [
      video.videoWidth, video.videoHeight, getComputedStyle(video).objectFit,
    ]), [96, 160, 'scale-down'])
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1))
    await page.screenshot({ path: output + '/solid-video-' + width + 'x' + height + '.png', animations: 'disabled' })
  }
  assert.deepEqual(writes, [])

  await page.goto(origin + '/lab?session=image-stale-poll')
  const retryHistory = history.getByRole('button', { name: '重试读取消息', exact: true })
  await retryHistory.waitFor()
  await page.getByRole('button', { name: '选择模型', exact: true }).click()
  await page.getByRole('button', { name: '验收图片模型', exact: true }).waitFor()
  await page.getByRole('textbox', { name: '图片提示词' }).fill(stalePrompt.content)
  const generate = page.getByRole('button', { name: /^发\s*送$/, exact: true })
  await generate.click()
  await history.getByText('生成中 29%', { exact: true }).waitFor()
  staleStatusAvailable = false
  await history.getByText('状态暂不可用', { exact: true }).waitFor()
  staleHistoryAvailable = true
  await retryHistory.click()
  await history.getByText('已完成', { exact: true }).waitFor()
  await history.getByRole('button', { name: '查看图片 1' }).waitFor()
  assert.equal(await history.getByText('状态暂不可用', { exact: true }).count(), 0)
  assert.equal(await generate.isEnabled(), true)
  assert.deepEqual(writes, ['/api/v1/studio/chat/sessions/media/image-stale-poll/turns'])
  console.log(`Experiment result browser acceptance passed. Evidence: ${output}`)
} finally {
  await cleanup()
}
