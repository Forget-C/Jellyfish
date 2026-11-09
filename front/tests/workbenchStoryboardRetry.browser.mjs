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
const output = await browserOutput('jellyfish-workbench-retry-')
const origin = 'http://127.0.0.1:4388', api = 'http://127.0.0.1:8388', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'workbench-retry'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8388' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const data = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
const control = body => data(api + '/test/runtime-controls', 'POST', body)
const poll = async (read, predicate) => {
  for (let attempt = 0; attempt < 120; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await delay(100)
  }
  throw new Error('Expected persisted task state was not observed')
}

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(studio + '/generation-canvases/' + project)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await data(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '重试分镜', raw_text: raw })
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const source = await data(chapterApi)
  const scene = await data(chapterApi + '/sequences', 'POST', {
    title: '候车', position: 0, source_version: source.source_version, span: { start: 0, end: raw.length },
  })
  const sceneApi = chapterApi + '/sequences/' + scene.id
  await data(sceneApi + '/objects/extractions', 'POST', { request_id: 'retry-objects' })
  await poll(() => data(sceneApi + '/objects'), value => value.task?.status === 'succeeded')
  await control({ storyboard_release: 1, storyboard_fail_on: 1 })
  const original = await data(sceneApi + '/storyboards', 'POST', {
    name: '原有画布', request_id: 'retry-original', mode: 'faithful', pending_modality: 'video',
  })
  const taskPath = sceneApi + '/storyboards/' + original.task_id
  await poll(() => data(taskPath), value => value.status === 'failed')

  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4388, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(14000)
  const management = origin + '/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + scene.id + '&step=storyboard'
  const canvas = studio + '/generation-canvases/' + project + '/' + original.canvas_id
  await page.goto(management)
  await page.getByRole('button', { name: '重试分镜', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '核对重试分镜' })
  await dialog.getByText('忠实提取', { exact: true }).waitFor()
  await dialog.getByText('controlled-text', { exact: true }).waitFor()
  await dialog.getByText('稍后配置视频模型卡', { exact: true }).waitFor()
  await dialog.getByText(raw, { exact: true }).waitFor()
  await dialog.getByText('本次采用的对象与参考（3）', { exact: true }).click()
  await dialog.getByText(/阿同（前门的阿同）.*无参考图/).waitFor()
  await dialog.getByText(/阿同（后门的阿同）.*无参考图/).waitFor()
  await page.screenshot({ path: join(output, 'retry-confirmation.png') })

  const current = await data(canvas)
  await data(canvas, 'PUT', { request_id: 'manual-before-retry', expected_revision: current.revision,
    document: { ...current.document, name: '保留人工编辑' } })
  const confirm = dialog.getByRole('button', { name: '确认重试' })
  await confirm.click()
  await dialog.getByText(/请重新核对生成依据/).waitFor()
  await dialog.getByRole('button', { name: '重新读取依据' }).click()
  await dialog.getByText(raw, { exact: true }).waitFor()
  let originalRequest
  await page.route('**/retry', async route => {
    originalRequest = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await confirm.click()
  await dialog.getByText(/重试结果待核实/).waitFor()
  await page.reload()
  const replay = page.waitForRequest(req => req.method() === 'POST' && req.url().endsWith('/retry'))
  await page.getByRole('button', { name: '核实重试', exact: true }).click()
  assert.deepEqual((await replay).postDataJSON(), originalRequest)
  await page.getByRole('button', { name: '核实重试', exact: true }).waitFor({ state: 'hidden' })
  const tasks = await data(sceneApi + '/storyboards')
  assert.equal(tasks.length, 2)
  const retried = tasks.find(task => task.retry_of_task_id === original.task_id)
  assert.equal(retried.canvas_id, original.canvas_id)
  assert.equal((await data(sceneApi + '/canvases')).canvases.length, 1)
  await control({ storyboard_release: 2 })
  await page.getByText('需要核对', { exact: true }).waitFor()
  assert.equal(page.url(), management)

  const ordinary = await context.newPage()
  await ordinary.goto(origin + '/projects/' + project + '/generation-canvas?canvas=' + original.canvas_id)
  await ordinary.getByRole('button', { name: '核对差异', exact: true }).waitFor()
  assert.equal(await ordinary.locator('[data-card-type="direction.shot"]').count(), 0)
  await ordinary.close()
  await page.getByRole('button', { name: '核对分镜', exact: true }).click()
  await page.waitForURL(url => url.searchParams.get('canvas') === original.canvas_id &&
    url.searchParams.get('storyboardTask') === retried.task_id)
  await page.getByRole('button', { name: '核对差异', exact: true }).click()
  await page.getByRole('dialog', { name: '核对分镜差异', exact: true }).waitFor()
  assert.equal((await data(canvas)).document.name, '保留人工编辑')
} finally {
  if (backend.exitCode === null) await control({ disconnect: true, storyboard_release: 100 }).catch(() => {})
  await cleanup()
}
