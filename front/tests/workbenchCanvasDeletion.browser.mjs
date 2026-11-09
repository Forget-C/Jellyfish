import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openCanvasManagement } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-workbench-canvas-deletion-')
const api = 'http://127.0.0.1:8390', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'workbench-deletion'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'),
  env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8390' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const json = { 'Content-Type': 'application/json' }
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: json, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
const base = studio + '/generation-canvases/' + project
const canvasUrl = id => base + '/' + id
const rename = (canvas, name, requestId) => request(canvasUrl(canvas.id), 'PUT', {
  request_id: requestId, expected_revision: canvas.revision, document: { ...canvas.document, name },
})

try {
  for (let attempt = 0; ; attempt++) {
    if (backend.exitCode !== null || attempt >= 80) throw new Error('isolated backend did not start')
    try { if ((await fetch(base)).ok) break } catch {}
    await delay(250)
  }
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '删除保护', raw_text: raw })
  const chapterApi = studio + '/projects/' + project + '/directing/chapters/' + chapter
  const source = await request(chapterApi)
  const scene = await request(chapterApi + '/sequences', 'POST', {
    title: '删除目标', position: 0, source_version: source.source_version, span: { start: 0, end: raw.length },
  })
  const sceneApi = chapterApi + '/sequences/' + scene.id
  await request(sceneApi + '/objects/extractions', 'POST', { request_id: 'prepare-delete' })
  for (let attempt = 0; ; attempt++) {
    const row = await request(sceneApi + '/objects')
    if (row.task?.status === 'succeeded') break
    assert.ok(attempt < 80 && row.task?.status !== 'failed', JSON.stringify(row))
    await delay(100)
  }
  const active = await request(sceneApi + '/storyboards', 'POST', {
    request_id: 'active-board', name: '活动分镜', mode: 'faithful', text_model_id: 'canvas-runtime-text',
  })
  const managed = await request(sceneApi + '/canvases', 'POST', { name: '管理删除目标' })
  const ordinary = await request(base, 'POST', { name: '自由画布删除目标' })
  const running = await request(sceneApi + '/canvases', 'POST', { name: '活动模型' })
  await request(canvasUrl(running.id), 'PUT', { request_id: 'runtime-card', expected_revision: 0,
    document: { ...running.document, cards: [...running.document.cards, {
      id: 'text-run', type: 'model.text', model_id: 'canvas-runtime-text',
      prompt: { segments: [{ id: 'body', kind: 'text', text: '保持执行中' }] },
    }] } })
  const checked = await request(canvasUrl(running.id) + '/precheck', 'POST', { card_id: 'text-run' })
  assert.equal(checked.can_run, true)
  await request(canvasUrl(running.id) + '/runs', 'POST', { request_id: 'active-model', preview_token: checked.preview_token })

  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4390, strictPort: true, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  const origin = 'http://127.0.0.1:4390'
  const management = origin + '/projects/' + project + '/chapters/' + chapter + '/workbench-management?sequence=' + scene.id + '&step=storyboard'
  const free = id => origin + '/projects/' + project + '/generation-canvas?canvas=' + id
  const managedDelete = async name => {
    await page.getByRole('menuitem', { name: '删除画布' }).waitFor({ state: 'hidden' })
    await page.getByRole('button', { name }).click()
    await page.getByRole('menuitem', { name: '删除画布' }).click()
  }
  const freeDelete = async () => {
    await openCanvasManagement(page)
    await page.getByRole('button', { name: '删除画布', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: '删除画布' })
  const confirm = () => dialog.getByRole('button', { name: '确认删除' }).click()

  await page.goto(management)
  await managedDelete('活动分镜更多操作')
  await confirm()
  await page.getByText('画布仍有活动分镜任务，任务结束后可删除').waitFor()
  await managedDelete('活动模型更多操作')
  await confirm()
  await page.getByText('画布仍有活动运行，任务结束后可删除').waitFor()

  await page.goto(free(active.canvas_id))
  await freeDelete()
  await confirm()
  await page.getByText('画布仍有活动分镜任务，任务结束后可删除').waitFor()
  const editor = page
  const manager = await context.newPage()
  manager.setDefaultTimeout(12000)
  await manager.goto(management)
  await manager.getByRole('button', { name: '活动分镜更多操作' }).click()
  await manager.getByRole('menuitem', { name: '删除画布' }).click()
  await manager.getByText('画布正在其他页面编辑，请先在原页面处理并释放编辑权。').waitFor()
  await manager.close()

  await editor.goto(free(running.id))
  await openCanvasManagement(editor)
  await editor.getByText('任务结束后可删除', { exact: true }).waitFor()
  assert.equal(await editor.getByRole('button', { name: '删除画布', exact: true }).isDisabled(), true)

  await page.goto(free(ordinary.id))
  await freeDelete()
  await dialog.getByText(/整张画布及其运行历史/).waitFor()
  await rename(ordinary, '自由入口并发保存', 'ordinary-concurrent')
  await confirm()
  await page.getByText('画布已保存新修订，请重新核对并确认删除').waitFor()
  assert.equal((await request(canvasUrl(ordinary.id))).document.name, '自由入口并发保存')

  await page.goto(management)
  await managedDelete('管理删除目标更多操作')
  await dialog.getByText(/整张画布及其运行历史/).waitFor()
  await rename(managed, '管理入口并发保存', 'managed-concurrent')
  await confirm()
  await page.getByText('画布已保存新修订，请重新核对并确认删除').waitFor()
  assert.equal((await request(canvasUrl(managed.id))).document.name, '管理入口并发保存')
  await page.reload()
  await managedDelete('管理入口并发保存更多操作')
  await dialog.getByText(/管理入口并发保存/).waitFor()
  await page.screenshot({ path: join(output, 'confirm-delete.png') })
  const deletion = url => url.pathname === '/api/v1/studio/generation-canvases/' + project + '/' + managed.id
  await page.route(deletion, async route => {
    if (route.request().method() !== 'DELETE') { await route.continue(); return }
    assert.equal(new URL(route.request().url()).searchParams.get('expected_revision'), '1')
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  })
  await confirm()
  await dialog.getByText('删除结果未确认，请核实画布状态后重试').waitFor()
  await dialog.getByRole('button', { name: '核实画布状态' }).click()
  await dialog.waitFor({ state: 'hidden' })
  await page.getByRole('heading', { name: '管理入口并发保存', exact: true }).waitFor({ state: 'hidden' })
  assert.equal((await fetch(canvasUrl(managed.id))).status, 404)
  assert.ok((await request(base)).every(canvas => canvas.id !== managed.id))
  assert.equal((await request(sceneApi + '/canvases')).canvases.length, 2)
  assert.equal((await request(sceneApi + '/storyboards/' + active.task_id)).status, 'running')
  await request(api + '/test/runtime-controls', 'POST', { storyboard_release: 1, release: 3 })
  await page.goto(free(managed.id))
  await page.getByText('此画布已不可用', { exact: true }).waitFor()
} finally {
  await cleanup()
}
