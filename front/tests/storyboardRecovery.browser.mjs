import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-recovery-')
const api = 'http://127.0.0.1:8330', studio = `${api}/api/v1/studio`, origin = 'http://127.0.0.1:4330'
const project = 'canvas-project', chapter = 'storyboard-recovery-chapter'
const excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8330' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const http = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return response.json()
}
const data = async (...args) => (await http(...args)).data
const poll = async (read, predicate) => {
  for (let attempt = 0; attempt < 125; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await delay(100)
  }
  throw new Error('expected persisted state not observed')
}
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(`${api}/test/runtime-controls`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await data(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: excerpt })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await data(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length } })
  const scene = `${scenes}/${sequence.id}`
  const tasks = `${scene}/storyboards`
  const canvas = (id, suffix = '') => `${studio}/generation-canvases/${id}${suffix}?project_id=${project}`
  const prep = `${origin}/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  const control = body => http(api + '/test/runtime-controls', body ? 'POST' : 'GET', body)
  const other = await data(`${scene}/canvases`, 'POST', { name: '继续编辑的画布' })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4330, strictPort: true, hmr: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(18000)
  page.on('dialog', dialog => void dialog.accept())
  const management = `${origin}/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  await page.goto(management.replace('step=storyboard', 'step=objects'))
  let objectIntent
  await page.route('**/objects/extractions', async route => {
    objectIntent = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  const extractionConfirmation = page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' })
  assert.equal(objectIntent, undefined, 'opening confirmation does not submit extraction')
  await extractionConfirmation.getByRole('button', { name: '开始提取', exact: true }).click()
  await page.getByRole('button', { name: '核实提取请求', exact: true }).waitFor()
  const extracted = await poll(() => data(`${scene}/objects`), row => row.task?.status === 'succeeded')
  await page.reload()
  const objectReplay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/objects/extractions'))
  await page.getByRole('button', { name: '核实提取请求', exact: true }).click()
  assert.deepEqual((await objectReplay).postDataJSON(), objectIntent)
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const images = await data(`${studio}/entities/character/object-browser-character/images`)
  await data(`${studio}/entities/character/object-browser-character/images/${images.items[0].id}`, 'PATCH', { is_primary: true })
  await front.getByRole('button', { name: '选用', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选用项目资源', exact: true })
  await picker.getByRole('button', { name: '选择已有角色', exact: true }).click()
  await picker.getByRole('button', { name: '确认选用', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await front.getByRole('img', { name: '阿同已选参考图', exact: true }).waitFor()
  const prepared = await data(`${scene}/objects`)
  assert.equal(prepared.task.task_id, extracted.task.task_id, 'replaying the extraction request keeps the original task')

  await page.goto(management)
  const original = await data(tasks, 'POST', { request_id: 'blocked-first', name: '管理页采用分镜' })
  await page.goto(`${prep}?canvas=${original.canvas_id}`)
  await page.waitForURL(url => url.pathname.endsWith('/workbench-management'))
  await page.getByRole('dialog', { name: '处理分镜提取结果', exact: true }).waitFor()
  assert.equal(await page.getByRole('region', { name: '生成画布工作台' }).count(), 0)
  await control({ storyboard_release: 1 })
  await poll(() => data(`${tasks}/${original.task_id}`), row => row.status === 'succeeded')
  await page.goto(management)
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: '管理页采用分镜', exact: true }) })
  await card.getByRole('button', { name: '查看并采用分镜', exact: true }).click()
  await page.getByRole('button', { name: '应用并进入画布', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const adopted = await data(canvas(original.canvas_id))
  assert.equal(adopted.document.storyboard.task_id, original.task_id)
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => data(canvas(original.canvas_id)), row => !row.document.storyboard)
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(() => data(canvas(original.canvas_id)), row => !!row.document.storyboard)

  // A failed later extraction cannot replace or block the adopted canvas.
  await control({ storyboard_release: 2, storyboard_fail_on: 2 })
  const later = await data(`${scene}/canvases/${original.canvas_id}/storyboards`, 'POST', {
    request_id: 'failed-reextract', name: adopted.document.name, adopt_current_source: true,
  })
  await poll(() => data(`${tasks}/${later.task_id}`), row => row.status === 'failed')
  await page.goto(`${prep}?canvas=${original.canvas_id}`)
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  assert.equal((await data(canvas(original.canvas_id))).document.storyboard.task_id, original.task_id)

  // Retry candidates require explicit management review. Lost replies reuse the receipt.
  await page.goto(management)
  await card.getByRole('button', { name: '处理提取问题', exact: true }).click()
  await page.getByRole('button', { name: '确认重试', exact: true }).click()
  await control({ storyboard_release: 3 })
  await poll(() => data(tasks), rows => rows.some(row => row.retry_of_task_id === later.task_id && row.status === 'succeeded'))
  const drawer = page.getByRole('dialog', { name: '处理分镜提取结果', exact: true })
  await drawer.getByRole('button', { name: '应用并进入画布', exact: true }).waitFor()
  let dropped
  await page.route('**/apply', async route => {
    dropped = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await drawer.getByRole('button', { name: '应用并进入画布', exact: true }).click()
  await drawer.getByText(/请求结果未知/).first().waitFor()
  await page.reload()
  // The server accepted the application, so recovery starts from the adopted canvas.
  await card.getByRole('button', { name: '管理页采用分镜', exact: true }).click()
  const restore = page.getByRole('button', { name: '恢复本地内容', exact: true })
  await restore.waitFor()
  const replay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/apply'))
  await restore.click()
  assert.deepEqual((await replay).postDataJSON(), dropped)
  await restore.waitFor({ state: 'hidden' })
  assert.deepEqual((await data(canvas(original.canvas_id, '/runtime'))).runs, [])
  assert.deepEqual((await data(`${scene}/objects`)).objects, prepared.objects)
  await page.screenshot({ path: join(output, 'management-recovery-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'management-recovery-narrow.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  const undo = page.getByRole('button', { name: '撤销操作', exact: true })
  const redo = page.getByRole('button', { name: '重做操作', exact: true })
  const loseUndoReply = async () => {
    let intent
    await page.route('**/restore', async route => {
      intent = route.request().postDataJSON()
      const response = await route.fetch()
      assert.ok(response.ok(), await response.text())
      await route.abort('failed')
    }, { times: 1 })
    await undo.click()
    await page.getByText(/请求结果未知/).first().waitFor()
    return intent
  }
  const undoIntent = await loseUndoReply()
  const undone = await data(canvas(original.canvas_id))
  assert.equal(undone.document.storyboard.task_id, original.task_id)
  await page.reload()
  const undoReplay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/restore'))
  await restore.click()
  assert.deepEqual((await undoReplay).postDataJSON(), undoIntent)
  await restore.waitFor({ state: 'hidden' })
  assert.equal(await undo.isDisabled(), true)
  await redo.click()
  await poll(() => data(canvas(original.canvas_id)), row => row.revision === undone.revision + 1)

  await loseUndoReply()
  const previous = await data(canvas(original.canvas_id))
  const latestName = '服务端已更新分镜画布'
  await data(canvas(original.canvas_id), 'PUT', {
    request_id: 'newer-server-document', expected_revision: previous.revision,
    document: { ...previous.document, name: latestName },
  })
  await page.reload()
  await restore.click()
  await restore.waitFor({ state: 'hidden' })
  assert.equal(await undo.isDisabled(), true)
  assert.equal(await redo.isDisabled(), true)
  await page.getByText(latestName, { exact: true }).first().waitFor()
  process.stdout.write(JSON.stringify({ output, passed: true }) + '\n')

} finally {
  if (backend.exitCode === null) {
    await http(`${api}/test/runtime-controls`, 'POST', { disconnect: true, storyboard_release: 100 }).catch(() => {})
  }
  await cleanup()
}
