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
    try { if ((await fetch(studio + '/generation-canvases/' + project)).ok) { ready = true; break } } catch {}
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
  // The database timestamp has second-level precision.
  await delay(1050)
  const task = await data(sceneApi + '/storyboards', 'POST', {
    request_id: 'cards-start', name: '新分镜方案', mode: 'faithful', text_model_id: 'canvas-runtime-text',
  })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4385, strictPort: true, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const location = 'http://127.0.0.1:4385/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + sequence.id + '&step=storyboard'
  const list = page.getByRole('list', { name: '本场画布' })
  const card = name => list.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) })
  const ordering = () => list.getByRole('heading').allTextContents()
  await page.goto(location)
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
  await card('旧空白方案').getByRole('button', { name: '打开画布' }).click()
  await page.waitForURL(url => url.searchParams.get('canvas') === older.id)
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  await page.goBack()
  await card('旧空白方案').getByText('最近打开', { exact: true }).waitFor()
  assert.deepEqual(await ordering(), ['新分镜方案', '旧空白方案'])
  await page.screenshot({ path: join(output, 'desktop.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换场次' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(output, 'mobile.png') })
  await card('新分镜方案').getByRole('button', { name: '查看分镜' }).press('Enter')
  await page.waitForURL(url => url.searchParams.get('canvas') === task.canvas_id &&
    url.searchParams.get('storyboardTask') === task.task_id)
  await page.locator('[data-card-type="direction.shot"]').first().waitFor()
  await page.goBack()
  await card('新分镜方案').getByText('当前已采用', { exact: true }).waitFor()
  assert.deepEqual(await ordering(), ['新分镜方案', '旧空白方案'])

  await control({ storyboard_release: 2, storyboard_fail_on: 2 })
  const failed = await data(sceneApi + '/storyboards', 'POST', {
    request_id: 'cards-fail', name: '失败后保留的方案', mode: 'faithful', text_model_id: 'canvas-runtime-text',
  })
  await page.reload()
  const failedCard = card('失败后保留的方案')
  await failedCard.getByText('分镜失败', { exact: true }).waitFor()
  await failedCard.getByRole('button', { name: '失败后保留的方案更多操作' }).click()
  await page.getByRole('menuitem', { name: '查看任务详情' }).press('Enter')
  const details = page.getByRole('dialog', { name: '分镜任务详情' })
  await details.getByText(failed.task_id, { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await details.waitFor({ state: 'hidden' })
  await failedCard.getByRole('button', { name: '打开画布' }).waitFor()

  const canvasListRequest = '**/directing/chapters/' + chapter + '/sequences/' + sequence.id + '/canvases'
  await page.route(canvasListRequest, route => route.abort('failed'), { times: 1 })
  await page.evaluate(() => window.dispatchEvent(new Event('focus')))
  const retry = page.getByRole('button', { name: '重试读取画布' })
  await retry.waitFor()
  await failedCard.waitFor()
  await retry.click()
  await retry.waitFor({ state: 'hidden' })
} finally {
  if (backend.exitCode === null) {
    await request(api + '/test/runtime-controls', 'POST', { disconnect: true, storyboard_release: 100 }).catch(() => {})
  }
  await cleanup()
}
