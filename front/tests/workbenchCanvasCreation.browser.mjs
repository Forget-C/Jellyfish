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
const output = await browserOutput('jellyfish-workbench-create-')
const api = 'http://127.0.0.1:8386', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'workbench-create'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8386' },
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

try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(studio + '/generation-canvases/' + project)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await data(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '创建画布', raw_text: raw })
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const source = await data(chapterApi)
  const scene = await data(chapterApi + '/sequences', 'POST', {
    title: '候车', position: 0, source_version: source.source_version, span: { start: 0, end: raw.length },
  })
  const sceneApi = chapterApi + '/sequences/' + scene.id
  await data(sceneApi + '/objects/extractions', 'POST', { request_id: 'creation-objects' })
  for (let attempt = 0; attempt < 80; attempt++) {
    const result = await data(sceneApi + '/objects')
    if (result.task?.status === 'succeeded') break
    await delay(100)
  }
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4386, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(13000)
  const location = 'http://127.0.0.1:4386/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + scene.id + '&step=storyboard'
  const start = page.getByRole('button', { name: '生成新分镜画布', exact: true })
  const form = page.getByRole('region', { name: '生成新分镜画布配置' })
  const name = form.getByRole('textbox', { name: '画布名称' })
  const openDivision = page.getByRole('button', { name: '场次划分', exact: true })
  const returnToProduction = page.getByRole('button', { name: '返回场次制作', exact: true })
  const list = page.getByRole('list', { name: '本场画布' })

  await page.goto(location)
  assert.equal(await page.getByRole('button', { name: '新建空白画布', exact: true }).count(), 0)
  await page.getByRole('button', { name: '画布更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建空白画布', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await start.click()
  await form.getByText('后门的阿同等待。', { exact: false }).waitFor()
  assert.match(await name.inputValue(), /^分镜画布-\d{8}-\d{6}$/)
  assert.ok(await form.getByRole('radio', { name: '自动产出完整分镜' }).isChecked())
  assert.equal(await form.getByRole('radio', { name: /^(图片|视频)模型卡$/ }).count(), 0)
  assert.equal(await form.getByRole('combobox', { name: '生产模型' }).count(), 0)
  await openDivision.click()
  await page.waitForURL(url => url.searchParams.get('step') === 'division')
  await returnToProduction.click()
  await start.click()
  await name.fill('更改后可保留')
  await openDivision.click()
  const discard = page.getByRole('dialog', { name: '有未提交的配置' })
  await discard.getByRole('button', { name: '继续填写' }).click()
  assert.equal(await name.inputValue(), '更改后可保留')
  await openDivision.click()
  await discard.getByRole('button', { name: '放弃配置' }).click()
  await returnToProduction.click()
  await start.click()
  const defaultName = await name.inputValue()
  const productionLocation = page.url()
  await form.getByText('后门的阿同等待。', { exact: false }).waitFor()
  await page.screenshot({ path: join(output, 'configuration.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '切换场次' }).waitFor()
  await page.screenshot({ path: join(output, 'configuration-mobile.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1366, height: 900 })
  let original
  await page.route('**/storyboards', async route => {
    original = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await form.getByRole('button', { name: '开始提取' }).click()
  const verify = page.getByRole('button', { name: '核实提交' })
  await verify.waitFor()
  await page.reload()
  await verify.waitFor()
  const replay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/storyboards'))
  await verify.click()
  assert.deepEqual((await replay).postDataJSON(), original)
  await list.getByRole('heading', { name: defaultName }).waitFor()
  assert.equal((await data(sceneApi + '/canvases')).canvases.length, 1)
  assert.equal(original.mode, 'complete')
  assert.equal(original.production_model_id, undefined)
  assert.equal(original.pending_modality, 'video')
  assert.equal(page.url(), productionLocation)

  await start.click()
  await name.fill('忠实方案')
  await form.getByRole('radio', { name: '忠实提取' }).check()
  const faithful = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/storyboards'))
  await form.getByRole('button', { name: '开始提取' }).click()
  const payload = (await faithful).postDataJSON()
  assert.equal(payload.mode, 'faithful')
  assert.equal(payload.production_model_id, undefined)
  assert.equal(payload.pending_modality, 'video')
  await list.getByRole('heading', { name: '忠实方案' }).waitFor()
  await data(api + '/test/runtime-controls', 'POST', { storyboard_release: 2 })
  for (const canvasName of [defaultName, '忠实方案']) {
    const card = list.getByRole('listitem').filter({ has: page.getByRole('heading', { name: canvasName, exact: true }) })
    await card.getByText('分镜已就绪', { exact: true }).waitFor()
  }
  const tasks = await data(sceneApi + '/storyboards')
  assert.equal(tasks.length, 2)
  for (const task of tasks) {
    const result = await data(sceneApi + '/storyboards/' + task.task_id)
    const modelCards = result.candidate.document.cards.filter(card => card.type.startsWith('model.'))
    assert.ok(modelCards.length > 0)
    assert.ok(modelCards.every(card => card.type === 'model.video' && card.model_id === null))
  }
  await page.getByRole('button', { name: '画布更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '新建空白画布', exact: true }).click()
  const blank = page.getByRole('region', { name: '新建空白画布配置' })
  await blank.getByRole('textbox', { name: '画布名称' }).fill('空白方案')
  await blank.getByRole('button', { name: '创建画布' }).click()
  await list.getByRole('heading', { name: '空白方案' }).waitFor()
  const summaries = (await data(sceneApi + '/canvases')).canvases
  assert.equal(summaries.length, 3)
  const row = summaries.find(item => item.name === '空白方案')
  const document = (await data(studio + '/generation-canvases/' + project + '/' + row.id)).document
  assert.deepEqual(document.cards.map(card => card.type), ['content.basis'])
  assert.equal(page.url(), productionLocation)
  await openDivision.click()
  await page.waitForURL(url => url.searchParams.get('step') === 'division')
} finally {
  if (backend.exitCode === null) {
    await data(api + '/test/runtime-controls', 'POST', { disconnect: true, storyboard_release: 100 }).catch(() => {})
  }
  await cleanup()
}
