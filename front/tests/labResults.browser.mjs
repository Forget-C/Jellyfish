import { mediaTurnReceipt, mediaAdmissionStream, boundTrialSnapshot, textTrialSnapshot } from './text-trial-events.mjs'
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
const sessions = [session('text-history', 'text', '文本历史'), session('text-long', 'text', '长会话'), session('image-history', 'image', '图片历史'), session('image-failed', 'image', '图片失败历史'), session('image-stale-poll', 'image', '轮询过期会话'), session('video-history', 'video', '视频历史'), session('portrait-history', 'video', '竖视频历史')]
const longReply = '一段需要自然换行的模型回复。'.repeat(12)
const longLink = 'https://example.test/' + 'x'.repeat(140)
const manualBreak = '人工换行前\n人工换行后'
const item = (id, session_id, role, content, sequence, extra = {}) => ({
  id, session_id, role, content, sequence, created_at: timestamp, updated_at: timestamp, ...extra,
})
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
const observedImageCursors = []
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
const observedMedia = new Map(['image', 'video'].map(kind => [kind + '-observe', {
  kind, after: [], open: new Set(), rows: [], replay: [], cursor: 10,
}]))
for (const [id, entry] of observedMedia) sessions.push(session(id, entry.kind, id))
const encodeEvent = event => `id: ${event.cursor}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
function serveMediaObservation(request, response, next) {
  const url = new URL(request.url, origin)
  const match = url.pathname.match(/\/chat\/sessions\/(image|video)\/([^/]+)\/events$/)
  const entry = match && observedMedia.get(match[2])
  if (!entry) return next()
  entry.after.push(Number(url.searchParams.get('after')))
  entry.open.add(response)
  response.on('close', () => entry.open.delete(response))
  response.setHeader('Content-Type', 'text/event-stream')
  response.write(': ready\n\n')
  for (const event of entry.replay) response.write(encodeEvent(event))
}
const server = await createServer({
  root, cacheDir: output + '/vite-cache', server: { host: '127.0.0.1', port: 4805, strictPort: true, open: false },
  plugins: [{ name: 'media-observation-fixture', configureServer(instance) {
    instance.middlewares.use(serveMediaObservation)
  } }],
})
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
    const admission = mediaAdmissionStream(route, url)
    if (admission) return admission
    const respond = data => route.fulfill({ json: { success: true, data } })
    const bound = url.pathname.match(/\/chat\/sessions\/(image|video)\/([^/]+)\/(events|snapshot|turns)$/)
    const observed = bound && observedMedia.get(bound[2])
    if (observed) {
      if (bound[3] === 'events') return route.continue()
      if (bound[3] === 'snapshot') return respond(boundTrialSnapshot(url, observed.rows, observed.cursor))
      const requestId = request.headers()['idempotency-key']
      const taskId = bound[2] + '-task'
      observed.rows = [item(taskId, bound[2], 'task', '观察中的媒体任务', 1, { task_id: taskId, status: 'queued' })]
      const receipt = {session_id: bound[2], turn_id: requestId, cursor: observed.cursor}
      const event = {session_id: bound[2], turn_id: requestId, cursor: ++observed.cursor, category: 'task',
        type: 'task.accepted', payload: {task_id: taskId, status: 'running', progress: 37, messages: observed.rows}}
      observed.replay.push(event)
      if (observed.kind === 'image') {
        for (const stream of observed.open) stream.write(encodeEvent(event))
      }
      return respond(receipt)
    }
    if (request.method() !== 'GET') writes.push(url.pathname)
    if (url.pathname.endsWith('/experiment-sessions')) {
      return respond(sessions.filter(entry => entry.lab_type === url.searchParams.get('lab_type')))
    }
    if (url.pathname.endsWith('/chat/sessions/text/text-history/snapshot')) {
      textHistoryReads++
      if (failTextHistory) return route.fulfill({ status: 503, json: { detail: '历史服务暂不可用' } })
      return textTrialSnapshot(route, [
        item('text-prompt', 'text-history', 'user', '短提示词', 1),
        item('text-answer', 'text-history', 'assistant', '历史回复', 2, {
          payload: {turn_timing: {accepted_at_ms: 1000, finished_at_ms: 13000}},
        }),
        item('text-link', 'text-history', 'user', longLink, 3),
        item('text-long-answer', 'text-history', 'assistant', longReply, 4),
        item('text-break', 'text-history', 'user', manualBreak, 5),
      ])
    }
    if (url.pathname.endsWith('/chat/sessions/text/text-long/snapshot')) {
      const earlier = url.searchParams.get('page') === '2'
      if (earlier && failEarlier) return route.fulfill({ status: 503, json: { detail: '更早消息暂不可用' } })
      return textTrialSnapshot(route, Array.from({ length: 50 }, (_, index) => {
        const sequence = (earlier ? 50 : 100) - index
        return item('long-' + sequence, 'text-long', 'assistant', `第 ${sequence} 条历史`, sequence)
      }))
    }
    if (url.pathname.endsWith('/chat/sessions/image/image-failed/snapshot')) {
      return respond(boundTrialSnapshot(url, [item('failed-image', 'image-failed', 'task', '', 1, {
        task_id: 'failed-run', status: 'failed', payload: { error: '图片任务失败原因' },
      })]))
    }
    if (url.pathname.endsWith('/chat/sessions/image/image-history/snapshot')) {
      if (imageReadsFail) return route.fulfill({ status: 503, json: { detail: '历史服务暂不可用' } })
      if (url.searchParams.get('page') === '2') {
        return respond(boundTrialSnapshot(url, [item('older-image', 'image-history', 'user', '更早的图片提示词', 1)], 99))
      }
      const earlier = Array.from({length: 48}, (_, index) =>
        item('image-history-' + index, 'image-history', 'user', '历史图片提示词 ' + index, index + 2))
      return respond(boundTrialSnapshot(url, [...earlier, {...imagePrompt, sequence: 50}, {...imageTask, sequence: 51}]))

    }
    if (url.pathname.endsWith('/models')) {
      const video = url.searchParams.get('category') === 'video'
      return respond({ items: [{ id: video ? 'video-model' : 'image-model', name: video ? '验收视频模型' : '验收图片模型', category: video ? 'video' : 'image' }] })
    }
    if (url.pathname.endsWith('/video-generation-options')) return respond({model_id: 'video-model', allowed_ratios: ['16:9']})
    if (url.pathname.endsWith('/image/image-stale-poll/turns')) return respond(mediaTurnReceipt(route, { task_id: 'stale-run', messages: [staleTask, stalePrompt] }))
    if (url.pathname.endsWith('/chat/sessions/image/image-stale-poll/snapshot')) {
      if (!staleHistoryAvailable) return route.fulfill({ status: 503 })
      return respond(boundTrialSnapshot(url, [{ ...staleTask, status: 'succeeded', payload: { result: { images: [{ url: imageUrls[0] }] } } }, stalePrompt]))
    }
    if (url.pathname.endsWith('/chat/sessions/video/portrait-history/snapshot')) {
      return respond(boundTrialSnapshot(url, [item('portrait-result', 'portrait-history', 'task', '视频生成任务已提交，正在等待生成结果。', 2, {
        task_id: 'portrait-run', status: 'succeeded', payload: { result: { url: '/lab-test-media/portrait.webm' } },
      })]))
    }
    if (url.pathname.endsWith('/chat/sessions/video/video-history/snapshot')) {
      return respond(boundTrialSnapshot(url, [item('video-result', 'video-history', 'task', '视频生成任务已提交，正在等待生成结果。', 2, {
        task_id: 'video-run', status: videoStatus === 'succeeded' ? 'succeeded' : 'queued', payload: { result: { url: '/canvas-presets/pan.mp4' } },
        media_receipt: videoStatus === 'succeeded' ? {
          task_id: 'video-run', status: 'succeeded', accepted_at_ms: 1000, finished_at_ms: 139000,
          artifacts: [{ file_id: 'video-file', ordinal: 0, media_type: 'video', deleted: false }],
        } : null,
      })]))
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
    if (url.pathname.includes('/chat/sessions/') && url.pathname.endsWith('/events')) {
      const id = url.pathname.split('/').at(-2)
      const stale = id === 'image-stale-poll'
      const image = id === 'image-history'
      if (image) observedImageCursors.push(Number(url.searchParams.get('after')))
      const status = stale ? (staleStatusAvailable ? 'running' : 'unavailable') : image ? imageStatus : videoStatus
      if (status === 'unavailable') return route.fulfill({ status: 503 })
      const type = status === 'succeeded' ? 'task.completed' : 'task.progress'
      const cursor = stale || status === 'succeeded' ? 2 : 1
      const artifacts = status === 'succeeded' ? (image ? ['landscape', 'portrait'] : ['video-file'])
        .map((file_id, ordinal) => ({ file_id, ordinal, media_type: image ? 'image' : 'video', deleted: false })) : []
      const payload = { task_id: stale ? 'stale-run' : image ? 'image-run' : 'video-run',
        model_id: 'trial-model', model_name: 'Trial Provider Model', stage: status, status, artifacts,
        progress: stale ? 29 : image ? 38 : 42, error: '',
        accepted_at_ms: 1000, finished_at_ms: status === 'succeeded' ? 139000 : null,
        execution_prompt: '服务端实际生成提示词' }
      const frame = `id: ${cursor}\nevent: ${type}\ndata: ${JSON.stringify({ session_id: id, turn_id: 'turn', cursor, type, category: 'task', detail: null, payload })}\n\n`
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
  const messageLineCount = content => content.evaluate(element => {
    const range = document.createRange()
    range.selectNodeContents(element)
    return new Set(Array.from(range.getClientRects(), rect => rect.top)).size
  })
  const messageBody = value => history.getByRole('article').filter({ hasText: value }).locator('.experiment-message-body')
  const assertResultSpacing = (region, title) => region.getByRole('article').filter({ has: page.getByText(title, { exact: true }) })
    .evaluate(article => {
      const header = article.querySelector('header').getBoundingClientRect()
      const body = article.querySelector('.experiment-message-body')
      const card = body.getBoundingClientRect()
      if (getComputedStyle(body).backgroundColor !== 'rgba(0, 0, 0, 0)') throw new Error('Result body should be transparent')
      const prompt = article.querySelector('.experiment-media-prompt')
      if (prompt && getComputedStyle(prompt).backgroundColor !== 'rgba(0, 0, 0, 0)') throw new Error('Prompt background should be transparent')
      if (Math.abs(header.left - card.left) >= 1 || Math.abs(card.top - header.bottom - 8) >= 1) {
        throw new Error('Result title must align with the card and sit 8px above it')
      }
    })
  for (const width of [1440, 375]) {
    await page.setViewportSize({ width, height: 900 })
    if (width === 375) await page.getByRole('button', { name: '会话导航', exact: true }).waitFor()
    assert.equal(await messageLineCount(messageBody('短提示词')), 1)
    assert.equal(await messageLineCount(messageBody(manualBreak)), 2)
    assert.ok(await messageLineCount(messageBody(longLink)) > 1)
    const reply = await messageBody(longReply).boundingBox()
    const composer = await page.locator('.experiment-composer').boundingBox()
    assert.ok(Math.abs(reply.x - composer.x) < 1 && Math.abs(reply.width - composer.width) < 1)
    const link = await messageBody(longLink).boundingBox()
    assert.ok(link.width <= composer.width * (width === 375 ? 0.9 : 0.75) + 1)
    assert.ok(Math.abs(link.x + link.width - composer.x - composer.width) < 1)
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  assert.deepEqual(writes, [])

  await history.getByRole('article').filter({hasText:'历史回复'}).locator('header').getByText('用时 12 秒', { exact: true }).waitFor()

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
  await englishHistory.getByText('38%', { exact: true }).waitFor()
  await assertResultSpacing(englishHistory, 'Image generation')
  const placeholder = englishHistory.locator('.experiment-media-placeholder')
  await placeholder.screenshot({path:output+'/image-generating.png',animations:'disabled'})
  assert.equal(await placeholder.evaluate(node => getComputedStyle(node, '::before').animationName), 'experiment-media-breathe')
  await page.emulateMedia({reducedMotion: 'reduce'})
  assert.equal(await placeholder.evaluate(node => getComputedStyle(node, '::before').animationName), 'none')
  await page.emulateMedia({reducedMotion: 'no-preference'})
  await englishHistory.evaluate(region => { region.scrollTop = 0 })
  await englishHistory.getByRole('button', { name: 'Load earlier messages' }).click()
  await englishHistory.getByText('更早的图片提示词', { exact: true }).waitFor()
  imageReadsFail = true
  imageStatus = 'succeeded'
  await englishHistory.getByText('Generated images (2)', { exact: true }).waitFor()
  const imageHeading = englishHistory.getByRole('article').filter({hasText:'Generated images (2)'}).locator('header')
  await imageHeading.getByText('Took 2m 18s', {exact:true}).waitFor()
  await englishHistory.getByText('Generation prompt', {exact:true}).click()
  await englishHistory.getByText('服务端实际生成提示词', {exact:true}).waitFor()
  await placeholder.waitFor({state:'hidden'})
  await englishHistory.getByRole('article').filter({hasText:'Generated images (2)'}).screenshot({path:output+'/image-completed.png',animations:'disabled'})
  assert.ok(observedImageCursors.includes(1), 'subscription continued after the progress event')
  assert.ok(!observedImageCursors.includes(99), 'older history cursor did not change the subscription')

  await englishHistory.getByText('Took 2m 18s', {exact:true}).click()
  await englishHistory.getByText(/Trial Provider Model/).waitFor()
  await imageHeading.getByRole('button',{name:'Took 2m 18s'}).press('Enter')
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
  await assertResultSpacing(history, '图片生成')
  await page.setViewportSize({ width: 375, height: 812 })
  await page.getByRole('button', { name: '会话导航', exact: true }).waitFor()
  await assertResultSpacing(history, '图片生成')
  await page.setViewportSize({ width: 1440, height: 900 })
  assert.ok((await firstPreview.boundingBox()).width <= 480)
  assert.equal(Math.round((await firstPreview.boundingBox()).y), Math.round((await secondPreview.boundingBox()).y))
  await page.screenshot({ path: output + '/mist-image-results.png', animations: 'disabled' })
  await firstPreview.focus()
  await firstPreview.press('Enter')
  const imageDialog = page.getByRole('dialog', { name: '图片预览' })
  await imageDialog.getByRole('img', { name: '图片 1', exact: true }).waitFor()
  await imageDialog.getByRole('button', { name: '下一张' }).click()
  await imageDialog.getByRole('img', { name: '图片 2', exact: true }).waitFor()
  await page.setViewportSize({width:375,height:812})
  const downloadImage = imageDialog.getByRole('link',{name:'下载图片',exact:true})
  const downloadBounds = await downloadImage.boundingBox()
  const closeBounds = await imageDialog.locator('.ant-modal-close').boundingBox()
  assert.ok(downloadBounds.x + downloadBounds.width <= closeBounds.x)
  const imageDownload = page.waitForEvent('download')
  await downloadImage.press('Enter')
  assert.ok(new URL((await imageDownload).url()).pathname.endsWith('/portrait/download'))
  assert.equal(await imageDialog.isVisible(), true)
  await imageDialog.getByRole('button', {name:'下一张'}).focus()
  await page.keyboard.press('Escape')
  await imageDialog.waitFor({ state: 'hidden' })
  await firstPreview.and(page.locator(':focus')).waitFor()
  await page.setViewportSize({width:1440,height:900})

  await page.goto(origin + '/lab?session=image-failed')
  await history.getByText('图片任务失败原因', { exact: true }).waitFor()
  await assertResultSpacing(history, '图片生成')

  await page.goto(origin + '/lab?session=video-history')
  await history.getByText('状态暂不可用', { exact: true }).waitFor()
  videoStatus = 'running'
  await history.getByRole('button', { name: '重试读取状态' }).click()
  await history.getByText('42%', { exact: true }).waitFor()
  videoStatus = 'succeeded'
  await history.getByText('已生成 1 段视频', { exact: false }).waitFor()
  const videoPreview = history.getByRole('button', { name: '播放视频' })
  await videoPreview.waitFor()
  const listVideo = videoPreview.locator('video')
  assert.equal(await listVideo.evaluate(video => video.paused && !video.autoplay), true)
  const videoWidth = (await videoPreview.boundingBox()).width
  assert.ok(videoWidth >= 360 && videoWidth <= 480, `video preview width ${videoWidth}`)
  await videoPreview.click()
  const videoDialog = page.getByRole('dialog', { name: '视频预览' })
  const downloadVideo = videoDialog.getByRole('link',{name:'下载视频',exact:true})
  const videoDownload = page.waitForEvent('download')
  await downloadVideo.click()
  assert.ok(new URL((await videoDownload).url()).pathname.endsWith('/video-file/download'))
  const player = await videoDialog.locator('video[controls]').elementHandle()
  await page.waitForFunction(dialog => dialog.contains(document.activeElement), await videoDialog.elementHandle())
  await player.evaluate(video => { video.focus(); return video.play() })
  await page.mouse.move(0, 0)
  await page.keyboard.press('Escape')
  await videoDialog.waitFor({ state: 'hidden' })
  assert.equal(await player.evaluate(video => video.paused), true)
  await videoPreview.and(page.locator(':focus')).waitFor()
  await history.getByRole('article').filter({hasText:'已生成 1 段视频'}).locator('header').getByText('用时 2 分 18 秒', {exact:true}).waitFor()
  await page.reload()
  await videoPreview.waitFor()
  await history.getByRole('article').filter({hasText:'已生成 1 段视频'}).locator('header').getByText('用时 2 分 18 秒', {exact:true}).waitFor()

  await page.goto(origin + '/lab?session=text-long')
  const firstVisible = history.getByText('第 51 条历史', { exact: true })
  await firstVisible.waitFor()
  await page.waitForFunction(region => region.scrollTop > 0, await history.elementHandle())
  const main = page.getByRole('region', { name: '实验室 · 文本', exact: true })
  const mainBounds = await main.boundingBox()
  const scrollBounds = await history.boundingBox()
  assert.ok(Math.abs(scrollBounds.x + scrollBounds.width - mainBounds.x - mainBounds.width) < 1,
    'Message scrolling reaches the right edge of the conversation area')
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
    await assertResultSpacing(history, '视频生成')
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
  await history.getByText('29%', { exact: true }).waitFor()
  staleStatusAvailable = false
  await history.getByText('状态暂不可用', { exact: true }).waitFor()
  staleHistoryAvailable = true
  await retryHistory.click()
  await history.getByText('已生成 1 张图片', { exact: false }).waitFor()
  await history.getByRole('button', { name: '查看图片 1' }).waitFor()
  assert.equal(await history.getByText('状态暂不可用', { exact: true }).count(), 0)
  assert.equal(await generate.isEnabled(), true)
  assert.deepEqual(writes, ['/api/v1/studio/chat/sessions/image/image-stale-poll/turns'])
  await page.setViewportSize({ width: 1440, height: 900 })
  for (const [id, entry] of observedMedia) {
    const label = entry.kind === 'image' ? '图片' : '视频'
    const first = page.waitForResponse(response => response.url().includes('/' + id + '/events'))
    await page.goto(origin + '/lab?session=' + id)
    await first
    assert.deepEqual(entry.after, [10])
    await page.getByRole('button', { name: '选择模型', exact: true }).click()
    await page.getByRole('button', { name: '验收' + label + '模型' }).click()
    await page.getByRole('textbox', { name: label + '提示词' }).fill('复用当前订阅')
    const observeSubmit = page.getByRole('button', { name: /^发\s*送$/, exact: true })
    await observeSubmit.click()
    if (entry.kind === 'video') {
      await page.getByText('视频生成任务已创建', { exact: true }).waitFor()
      assert.equal(await page.getByRole('textbox', { name: '视频提示词' }).isDisabled(), true,
        '已经受理但尚未出现在历史中的任务仍占用发送')
      for (const stream of entry.open) stream.write(encodeEvent(entry.replay[0]))
    }
    await history.getByText('37%', { exact: true }).waitFor()
    assert.deepEqual(entry.after, [10], label + '发送不应打开新的 SSE')
    assert.equal(entry.open.size, 1)
    const initial = entry.replay[0]
    const reconnected = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname.endsWith('/' + id + '/events') && url.searchParams.get('after') === '11'
    })
    for (const stream of entry.open) stream.end()
    const unavailable = history.getByText('状态暂不可用', {exact: true})
    await unavailable.waitFor()
    await reconnected
    await unavailable.waitFor({state: 'hidden'})
    assert.equal(await history.getByText('37%', {exact: true}).count(), 1)
    const progress = {...initial, cursor: ++entry.cursor, type: 'task.progress',
      payload: {...initial.payload, progress: 71, messages: undefined}}
    entry.replay.push(progress)
    for (const stream of entry.open) stream.write(encodeEvent(progress))
    await history.getByText('71%', { exact: true }).waitFor()
    assert.deepEqual(entry.after, [10, 11], label + '断线后按已处理游标续读')
    assert.equal(await history.getByText('71%', { exact: true }).count(), 1)
    assert.equal(entry.open.size, 1)
  }
  console.log(`Experiment result browser acceptance passed. Evidence: ${output}`)
} finally {
  await cleanup()
}
