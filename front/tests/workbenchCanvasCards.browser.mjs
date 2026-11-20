import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-workbench-canvas-cards-')
const api = 'http://127.0.0.1:8385', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'workbench-cards'
const modelId = process.env.CANVAS_BROWSER_DATABASE_URL ? project + '-text' : 'canvas-runtime-text'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8385' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return await response.json()
}
const data = async (...args) => (await request(...args)).data

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(api + '/health')).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await data(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '画布方案', raw_text: raw })
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const source = await data(chapterApi)
  const sequence = await data(chapterApi + '/sequences', 'POST', {
    title: '候车', position: 0, source_version: source.source_version, span: { start: 0, end: raw.length },
  })
  const sceneApi = chapterApi + '/sequences/' + sequence.id
  const control = body => request(api + '/test/runtime-controls', 'POST', body)
  await data(sceneApi + '/objects/extractions', 'POST', { request_id: 'prepare-cards' })
  let prepared
  for (let attempt = 0; attempt < 80; attempt++) {
    prepared = await data(sceneApi + '/objects')
    if (prepared.task?.status === 'succeeded') break
    await delay(100)
  }
  assert.equal(prepared.task?.status, 'succeeded')
  const older = await data(sceneApi + '/canvases', 'POST', { name: '旧空白方案' })
  const task = await data(sceneApi + '/storyboards', 'POST', {
    request_id: 'cards-start', name: '新分镜方案', mode: 'faithful', text_model_id: modelId,
  })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4385, strictPort: true, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
    localStorage.setItem('jellyfish_language', 'zh-CN')
  })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const location = 'http://127.0.0.1:4385/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + sequence.id + '&step=storyboard'
  const list = page.getByRole('list', { name: '本场画布' })
  const card = name => list.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })
  const ordering = () => list.getByRole('heading').allTextContents()
  await page.goto(location)
  await page.getByRole("img", { name: "画布默认封面" }).first().waitFor({ timeout: 5000 })
  await card('新分镜方案').getByText(/正在提取分镜|分镜排队中/).waitFor()
  assert.deepEqual(await ordering(), ['新分镜方案', '旧空白方案'])
  const search = page.getByRole('textbox', { name: '搜索画布' })
  await search.fill('旧空白')
  assert.deepEqual(await ordering(), ['旧空白方案'])
  await search.fill('')
  await search.focus()
  await control({ storyboard_release: 1 })
  await card('新分镜方案').getByText('分镜已就绪', { exact: true }).waitFor()
  assert.equal(page.url(), location)
  assert.equal(await search.evaluate(element => element === document.activeElement), true)
  assert.deepEqual(await ordering(), ['新分镜方案', '旧空白方案'])
  assert.equal(await card('新分镜方案').getByText('当前已采用', { exact: true }).count(), 0)
  await search.fill('旧空白')
  await card('旧空白方案').getByRole('button', { name: '旧空白方案', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('canvas') === older.id)
  await page.locator('[data-card-type="content.basis"]').waitFor()
  await page.goBack()
  await card('旧空白方案').getByText('最近打开', { exact: true }).waitFor()
  assert.equal(await search.inputValue(), '旧空白')
  await card('旧空白方案').getByRole('button', { name: '旧空白方案', exact: true }).and(page.locator(':focus')).waitFor()
  await search.fill('')
  assert.deepEqual(await ordering(), ['新分镜方案', '旧空白方案'])
  await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
  await page.getByRole('textbox', { name: '画布名称' }).fill('还未提交的方案')
  const creation = page.getByRole('dialog', { name: '生成新分镜画布', exact: true })
  await creation.getByRole('button', { name: '取消', exact: true }).click()
  const discard = page.getByRole('dialog', { name: '有未提交的配置' })
  await discard.getByRole('button', { name: '继续填写' }).click()
  assert.equal(await page.getByRole('textbox', { name: '画布名称', exact: true }).inputValue(), '还未提交的方案')
  await creation.getByRole('button', { name: '取消', exact: true }).click()
  await discard.getByRole('button', { name: '放弃配置' }).click()
  await creation.waitFor({ state: 'hidden' })
  await search.fill('方案')
  assert.equal(await card('新分镜方案').getByText('最近打开', { exact: true }).count(), 0)
  await card('旧空白方案').getByText('最近打开', { exact: true }).waitFor()
  await search.fill('')
  const later = await data(sceneApi + '/canvases/' + task.canvas_id + '/storyboards', 'POST', {
    request_id: 'cards-reextract', mode: 'faithful', text_model_id: modelId,
  })
  await page.reload()
  const progress = card('新分镜方案').getByRole('button', { name: '查看提取进度', exact: true })
  await Promise.all([page.waitForRequest(req => req.url().endsWith('/storyboards/' + later.task_id)), progress.click()])
  await page.getByRole('button', { name: '暂不处理', exact: true }).click()
  await control({ storyboard_release: 2, storyboard_fail_on: 2 })
  await card('新分镜方案').getByRole('button', { name: '处理提取问题', exact: true }).waitFor()
  await Promise.all([page.waitForRequest(req => req.url().endsWith('/storyboards/' + later.task_id)),
    card('新分镜方案').getByRole('button', { name: '处理提取问题', exact: true }).click()])
  await page.getByRole('button', { name: '暂不处理', exact: true }).click()
  const running = await data(sceneApi + '/canvases/' + task.canvas_id + '/storyboards', 'POST', {
    request_id: 'cards-running', mode: 'faithful', text_model_id: modelId,
  })
  await page.reload()
  await progress.waitFor()
  await Promise.all([page.waitForRequest(req => req.url().endsWith('/storyboards/' + task.task_id)),
    card('新分镜方案').getByRole('button', { name: '查看并采用分镜', exact: true }).click()])
  await page.locator('[data-card-type="direction.shot"]').first().waitFor()
  await control({ storyboard_release: 3 })
  await page.waitForFunction(async ({ path, canvasId, appliedId, candidateId }) => {
    const response = await fetch(path)
    const canvas = (await response.json()).data.canvases.find(row => row.id === canvasId)
    return canvas?.applied_storyboard_task_id === appliedId && canvas.candidate_storyboard_task_id === candidateId
  }, { path: new URL(sceneApi + '/canvases').pathname, canvasId: task.canvas_id, appliedId: task.task_id, candidateId: running.task_id })
  await page.goBack()
  await card('新分镜方案').getByText('最近打开', { exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'desktop.png') })
  for (const theme of ['雾蓝纯色', '雾蓝微渐变']) {
    await page.getByRole('button', { name: '用户与语言设置', exact: true }).click()
    await page.getByRole('menuitemradio', { name: theme }).click()
    await page.getByRole('menuitemradio', { name: theme }).waitFor({ state: 'hidden' })
    for (const [width, height] of [[1440,900],[1366,768],[1024,440],[375,812]]) {
      await page.setViewportSize({ width, height })
      await card('新分镜方案').getByRole('button', { name: '新分镜方案', exact: true }).scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '卡片内容不得造成页面横向溢出')
    assert.ok(await page.locator('.management-canvas-cards .management-card-grid').first().evaluate(node => {
      const style = getComputedStyle(node)
      const gutter = parseFloat(getComputedStyle(document.querySelector('.app-shell')).getPropertyValue('--app-page-gutter'))
      const sidebar = true && window.innerWidth >= 1024 ? 216 : 0
      const expectedWidth = document.documentElement.clientWidth - sidebar - 2 * gutter
      if (Math.abs(node.getBoundingClientRect().width - expectedWidth) > 17) return false
      const columns = style.gridTemplateColumns.split(' ').map(parseFloat)
      const used = columns.reduce((sum, size) => sum + size, 0) + (columns.length - 1) * parseFloat(style.columnGap)
      const remainder = node.getBoundingClientRect().width - used
      return Math.abs(remainder) < 1
    }), 'equal-width tracks fill the content area')
      await page.screenshot({ path: join(output, `cards-${theme}-${width}.png`), animations: 'disabled' })
    }
    await page.setViewportSize({ width: 1366, height: 900 })
  }


  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('group', { name: '选择场次' }).getByRole('button').waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(output, 'mobile.png') })
  await card('新分镜方案').getByRole('button', { name: '新分镜方案', exact: true }).press('Enter')
  await page.waitForURL(url => url.searchParams.get('canvas') === task.canvas_id)
  await page.locator('[data-card-type="direction.shot"]').first().waitFor()
  await page.goBack()
  await card('新分镜方案').getByText('当前已采用', { exact: true }).waitFor()
  await page.setViewportSize({ width: 1366, height: 900 })
  await card('旧空白方案').waitFor()
  assert.deepEqual(await ordering(), ['新分镜方案', '旧空白方案'])

  await control({ storyboard_release: 4, storyboard_fail_on: 4 })
  const failed = await data(sceneApi + '/storyboards', 'POST', {
    request_id: 'cards-fail', name: '失败后保留的方案', mode: 'faithful', text_model_id: modelId,
  })
  await page.reload()
  const failedCard = card('失败后保留的方案')
  await failedCard.getByText('分镜失败', { exact: true }).waitFor()
  await failedCard.getByRole('button', { name: '失败后保留的方案更多操作' }).click()
  await page.getByRole('menuitem', { name: '查看任务详情' }).press('Enter')
  const details = page.getByRole('dialog', { name: '分镜任务详情' })
  await details.getByText(failed.task_id, { exact: true }).waitFor()
  await details.getByRole('button', { name: '关闭分镜任务详情' }).press('Enter')
  await details.waitFor({ state: 'hidden' })
  await failedCard.getByRole('button', { name: '失败后保留的方案更多操作', exact: true }).and(page.locator(':focus')).waitFor()

  await failedCard.getByRole('button', { name: '处理提取问题', exact: true }).waitFor()
  assert.equal(await failedCard.locator('.management-canvas-name').count(), 0)

  const canvasListRequest = '**/directing/chapters/' + chapter + '/sequences/' + sequence.id + '/canvases'
  await page.route(canvasListRequest, route => route.abort('failed'), { times: 1 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const retry = page.getByRole('button', { name: '重试读取画布' })
  await retry.waitFor()
  await failedCard.waitFor()
  await retry.click()
  await retry.waitFor({ state: 'hidden' })

  // HTTP-boundary fixture: long real-field values must keep management details usable.
  const longName = '雨夜码头连续性方案'.repeat(12)
  await page.route(canvasListRequest, async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.canvases = body.data.canvases.map(canvas => canvas.id === failed.canvas_id
      ? { ...canvas, name: longName, latest_storyboard: { ...canvas.latest_storyboard, error: '需要核对上游场次依据。'.repeat(120) } } : canvas)
    await route.fulfill({ response, json: body })
  })
  await page.reload()
  await page.setViewportSize({ width: 1024, height: 440 })
  const longCard = card(longName)
  await longCard.getByRole('button', { name: longName + '更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '查看任务详情', exact: true }).click()
  await details.waitFor()
  const close = details.getByRole('button', { name: '关闭分镜任务详情', exact: true })
  const closeBox = await close.boundingBox()
  assert.ok(closeBox && closeBox.y >= 0 && closeBox.y + closeBox.height <= 440, '矮屏长任务详情底部操作可达')
  await close.focus()
  await page.waitForFunction(() => document.activeElement?.closest('[role="dialog"]') && !document.querySelector('.ant-zoom-appear'))
  await page.screenshot({ path: join(output, 'task-detail-short-viewport.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  await longCard.getByRole('button', { name: longName + '更多操作', exact: true }).and(page.locator(':focus')).waitFor()

  await page.unroute(canvasListRequest)
  for (let index = 1; index <= 6; index++) {
    await data(sceneApi + '/canvases', 'POST', { name: `对照画布 ${index}` })
  }
  await page.setViewportSize({ width: 1440, height: 620 })
  await page.reload()
  const pagination = page.getByRole('navigation', { name: '本场画布分页' })
  await pagination.waitFor()
  assert.deepEqual(await ordering(), ['对照画布 6', '对照画布 5', '对照画布 4'])
  await search.fill('旧空白')
  await card('旧空白方案').waitFor()
  assert.deepEqual(await ordering(), ['旧空白方案'])
  await pagination.waitFor({ state: 'hidden' })

  await search.fill('方案')
  await page.setViewportSize({ width: 390, height: 620 })
  const nextPage = pagination.getByRole('button', { name: '下一页', exact: true })
  await nextPage.click()
  await card('新分镜方案').waitFor()
  await nextPage.click()
  const oldCanvas = card('旧空白方案').getByRole('button', { name: '旧空白方案', exact: true })
  await oldCanvas.click()
  await page.locator('[data-card-type="content.basis"]').waitFor()
  const returnToList = page.getByRole('button', { name: '返回工作台管理', exact: true })
  await returnToList.click()
  await oldCanvas.and(page.locator(':focus')).waitFor()
  assert.equal(await search.inputValue(), '方案')
  await pagination.getByText('3 / 3', { exact: true }).waitFor()

  await oldCanvas.click()
  await page.locator('[data-card-type="content.basis"]').waitFor()
  await page.route(canvasListRequest, async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.canvases = body.data.canvases.map(canvas => canvas.id === older.id ? { ...canvas, name: '已重新命名' } : canvas)
    await route.fulfill({ response, json: body })
  }, { times: 1 })
  await returnToList.click()
  await search.and(page.locator(':focus')).waitFor()
  assert.equal(await search.inputValue(), '方案')
  await page.getByText('原画布无法在当前列表中定位', { exact: true }).waitFor()
  await pagination.getByText('2 / 2', { exact: true }).waitFor()

  await search.fill('对照画布')
  // Send the same URL as the task center without reloading the scene's browse state.
  const followTaskLink = (taskId, canvasId) => page.evaluate(({ url, taskId, canvasId }) => {
    const link = new URL(url)
    link.searchParams.set('storyboardTask', taskId)
    if (canvasId) link.searchParams.set('canvas', canvasId)
    history.pushState(null, '', link)
    dispatchEvent(new PopStateEvent('popstate'))
  }, { url: location, taskId, canvasId })
  await followTaskLink(failed.task_id)
  const review = page.getByRole('dialog', { name: '处理分镜提取结果' })
  await review.waitFor()
  await failedCard.getByText('当前定位', { exact: true }).waitFor()
  assert.equal(await search.inputValue(), '')
  await review.getByRole('button', { name: '暂不处理', exact: true }).click()
  await review.waitFor({ state: 'hidden' })
  await pagination.getByText('7 / 9', { exact: true }).waitFor()

  await page.setViewportSize({ width: 1440, height: 620 })
  await pagination.locator('[aria-current="page"], .ant-pagination-item-active').filter({ hasText: '3' }).waitFor()
  await failedCard.waitFor()
  await page.setViewportSize({ width: 390, height: 620 })
  await pagination.getByText('7 / 9', { exact: true }).waitFor()

  await search.fill('方案')
  // The linked task exists, but this card now has a newer task.
  await page.route(canvasListRequest, async route => {
    const response = await route.fetch()
    const body = await response.json()
    body.data.canvases = body.data.canvases.map(canvas => canvas.id === failed.canvas_id
      ? { ...canvas, latest_storyboard: { ...canvas.latest_storyboard, task_id: 'newer-storyboard-task' } } : canvas)
    await route.fulfill({ response, json: body })
  }, { times: 1 })
  const refreshed = page.waitForResponse(response => response.url().endsWith('/sequences/' + sequence.id + '/canvases'))
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await refreshed
  await followTaskLink(failed.task_id, failed.canvas_id)
  await details.getByText(failed.task_id, { exact: true }).waitFor()
  await details.getByText('已有后续处理结果；此历史任务仅供查看。', { exact: true }).waitFor()
  assert.equal(await search.inputValue(), '方案')
  await details.getByRole('button', { name: '关闭分镜任务详情', exact: true }).click()
  await details.waitFor({ state: 'hidden' })
  await pagination.getByText('1 / 3', { exact: true }).waitFor()

  await search.fill('对照画布')
  await nextPage.click()
  await followTaskLink('missing-storyboard-task')
  await page.getByText('此分镜任务或原画布已不可用', { exact: true }).waitFor()
  assert.equal(await search.inputValue(), '对照画布')
  await pagination.getByText('2 / 6', { exact: true }).waitFor()

  const createBlank = async name => {
    await page.getByRole('button', { name: '画布更多操作', exact: true }).click()
    await page.getByRole('menuitem', { name: '新建空白画布', exact: true }).click()
    const blank = page.getByRole('dialog', { name: '新建空白画布', exact: true })
    await blank.getByRole('textbox', { name: '画布名称', exact: true }).fill(name)
    await blank.getByRole('button', { name: '创建画布', exact: true }).click()
    await card(name).getByText('刚创建', { exact: true }).waitFor()
  }
  await createBlank('对照画布 7')
  assert.equal(await search.inputValue(), '对照画布')
  await pagination.getByText('1 / 7', { exact: true }).waitFor()

  await page.setViewportSize({ width: 1440, height: 620 })
  await pagination.getByText('3', { exact: true }).click()
  await card('对照画布 1').getByRole('button', { name: '对照画布 1更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '删除画布', exact: true }).click()
  await page.getByRole('dialog', { name: '删除画布', exact: true }).getByRole('button', { name: '确认删除', exact: true }).click()
  await page.getByText('匹配 6 张画布', { exact: true }).waitFor()
  assert.deepEqual(await ordering(), ['对照画布 4', '对照画布 3', '对照画布 2'])
  assert.equal(await search.inputValue(), '对照画布')

  await search.fill('对照画布 2')
  await card('对照画布 2').getByRole('button', { name: '对照画布 2更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '更名', exact: true }).click()
  const rename = page.getByRole('dialog', { name: '更名画布', exact: true })
  await rename.getByRole('textbox', { name: '画布名称', exact: true }).fill('调整后的草图')
  await rename.getByRole('button', { name: '保存名称', exact: true }).click()
  await page.getByRole('button', { name: '清除搜索', exact: true }).waitFor()
  await createBlank('别的草图')
  assert.equal(await search.inputValue(), '')

  await search.fill('对照画布')
  await page.setViewportSize({ width: 1023, height: 620 })
  await nextPage.waitFor()
  await page.setViewportSize({ width: 390, height: 320 })
  await pagination.getByText('1 / 5', { exact: true }).waitFor()
  await nextPage.click()
  const focusCard = card('对照画布 6').getByRole('button', { name: '对照画布 6', exact: true })
  await focusCard.scrollIntoViewIfNeeded()
  await focusCard.focus()
  await data(sceneApi + '/canvases', 'POST', { name: '对照画布 8' })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  await search.and(page.locator(':focus')).waitFor()
  await pagination.getByText('2 / 6', { exact: true }).waitFor()
  await card('对照画布 7').scrollIntoViewIfNeeded()

  await page.setViewportSize({ width: 1440, height: 900 })
  await followTaskLink(failed.task_id)
  // Poll the committed retry before the browser receives the POST response.
  let announceRetry, releaseRetry
  const retryCommitted = new Promise(resolve => { announceRetry = resolve })
  const releaseRetryResponse = new Promise(resolve => { releaseRetry = resolve })
  await page.route('**/storyboards/*/retry', async route => {
    const response = await route.fetch()
    announceRetry(response.ok())
    await releaseRetryResponse
    await route.fulfill({ response })
  }, { times: 1 })
  try {
    await review.getByRole('button', { name: '确认重试', exact: true }).click()
    assert.equal(await retryCommitted, true)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await failedCard.getByText(/分镜排队中|正在提取分镜/).waitFor()
    await review.waitFor()
    assert.equal(await details.isVisible(), false)
  } finally {
    releaseRetry()
  }
  await review.getByText('提取或审查正在进行，关闭后可继续查看进度。', { exact: true }).waitFor()
  await details.waitFor({ state: 'hidden' })
  await review.getByRole('button', { name: '暂不处理', exact: true }).click()

} finally {
  if (backend.exitCode === null) {
    await request(api + '/test/runtime-controls', 'POST', { disconnect: true, storyboard_release: 100 }).catch(() => {})
  }
  await cleanup()
}
