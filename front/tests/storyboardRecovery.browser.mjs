import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openCanvasManagement } from './generationCanvasWorkbench.browser-helpers.mjs'

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
    try { if ((await fetch(`${studio}/generation-canvases/${project}`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await data(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: excerpt })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await data(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length } })
  const scene = `${scenes}/${sequence.id}`
  const tasks = `${scene}/storyboards`
  const canvas = id => `${studio}/generation-canvases/${project}/${id}`
  const prep = `${origin}/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  const control = body => http(api + '/test/runtime-controls', body ? 'POST' : 'GET', body)
  const other = await data(`${scene}/canvases`, 'POST', { name: '继续编辑的画布' })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4330, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(18000)
  page.on('dialog', dialog => void dialog.accept())
  await page.goto(prep)
  let objectIntent
  await page.route('**/objects/extractions', async route => {
    objectIntent = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.getByRole('button', { name: '核实提取请求', exact: true }).waitFor()
  await poll(() => data(`${scene}/objects`), row => row.task?.status === 'succeeded')
  await page.reload()
  const objectReplay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/objects/extractions'))
  await page.getByRole('button', { name: '核实提取请求', exact: true }).click()
  assert.deepEqual((await objectReplay).postDataJSON(), objectIntent)
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await front.getByRole('combobox', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  const prepared = await data(`${scene}/objects`)

  const start = page.getByRole('button', { name: '生成分镜', exact: true })
  const dialog = page.getByRole('dialog', { name: '生成分镜', exact: true })
  const submit = async name => {
    await start.click()
    await dialog.getByRole('textbox', { name: '画布名称' }).fill(name)
    await dialog.getByRole('button', { name: '开始提取', exact: true }).click()
  }
  await submit('离页后完成')
  await dialog.getByRole('status').filter({ hasText: '正在提取分镜' }).waitFor()
  const [original] = await data(tasks)
  assert.equal(original.status, 'running')
  assert.equal(original.stage, 'extracting_storyboard')
  await page.setViewportSize({ width: 390, height: 844 })
  const narrow = await dialog.boundingBox()
  assert.ok(narrow.x >= 0 && narrow.x + narrow.width <= 391)
  await page.keyboard.press('Escape')
  await dialog.waitFor({ state: 'hidden' })
  await page.waitForFunction(() => document.activeElement?.textContent?.trim() === '生成分镜')
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.getByRole('button', { name: '继续编辑的画布', exact: true }).click()
  const nameEditor = page.getByRole('textbox', { name: '画布名称', exact: true })
  await nameEditor.focus()

  const free = await context.newPage()
  const freeUrl = `${origin}/projects/${project}/generation-canvas?canvas=${original.canvas_id}`
  await free.goto(freeUrl)
  await free.locator('[data-card-type="content.basis"]').waitFor()
  await openCanvasManagement(free)
  await free.getByRole('textbox', { name: '画布名称', exact: true }).fill('自由入口先保存')
  await free.getByRole('button', { name: '保存画布', exact: true }).click()
  await poll(() => data(canvas(original.canvas_id)), row => row.revision === 1 && row.document.name === '自由入口先保存')
  await free.close()
  await page.bringToFront()
  await nameEditor.focus()
  await control({ storyboard_release: 1 })
  const completed = await poll(() => data(tasks + '/' + original.task_id), row => row.status === 'succeeded')
  assert.ok(completed.pending_application)
  assert.equal(new URL(page.url()).searchParams.get('canvas'), other.id)
  assert.equal(await nameEditor.evaluate(element => element === document.activeElement), true)

  // Task center opens the scoped task route. The result remains unapplied until explicit review.
  await page.getByRole('button', { name: '任务中心', exact: true }).click()
  await page.getByRole('button', { name: '历史', exact: true }).click()
  await page.getByRole('row').filter({ hasText: '生成完整分镜' }).getByRole('button', { name: /查\s*看/ }).click()
  await page.waitForURL(url => url.searchParams.get('storyboardTask') === original.task_id && !url.searchParams.has('canvas'))
  await page.getByRole('button', { name: '查看分镜结果', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('canvas'), original.canvas_id)
  assert.equal((await data(canvas(original.canvas_id))).revision, 1)
  await page.getByRole('button', { name: '核对差异', exact: true }).click()
  const review = page.getByRole('dialog', { name: '核对分镜差异', exact: true })
  const applyPath = '**/storyboards/' + original.task_id + '/apply'
  let droppedSave
  await page.route(applyPath, async route => {
    droppedSave = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  }, { times: 1 })
  await review.getByRole('button', { name: '应用分镜', exact: true }).click()
  const written = await poll(() => data(canvas(original.canvas_id)), row => row.revision === 2)
  assert.equal(written.document.name, '自由入口先保存')
  await review.getByText(/结果未知|应用尚未完成/).first().waitFor()
  await page.reload()
  const restore = page.getByRole('button', { name: '恢复本地内容', exact: true })
  await restore.waitFor()
  const replay = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/' + original.task_id + '/apply'))
  await restore.click()
  assert.deepEqual((await replay).postDataJSON(), droppedSave)
  await restore.waitFor({ state: 'hidden' })
  assert.equal((await data(canvas(original.canvas_id))).revision, 2)
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => data(canvas(original.canvas_id)), row => row.revision === 3 && !row.document.storyboard)
  assert.equal(await page.getByRole('button', { name: '撤销操作', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '返回场次准备', exact: true }).click()

  // Preserve the exact create intent when the server accepted it but the reply was lost.
  let unknownBody
  await page.route('**/storyboards', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    unknownBody = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  })
  await submit('响应丢失后恢复')
  await dialog.getByRole('button', { name: '核实提交', exact: true }).waitFor()
  await dialog.getByRole('alert').waitFor()
  await page.unroute('**/storyboards')
  const failed = await poll(() => data(tasks), rows => rows.find(row => row.task_id !== original.task_id && row.status === 'running'))
  const countBefore = (await data(`${scene}/canvases`)).canvases.length
  await page.reload()
  const verify = page.getByRole('button', { name: '核实提交', exact: true })
  await verify.waitFor()
  const verified = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/storyboards'))
  await verify.click()
  assert.deepEqual((await verified).postDataJSON(), unknownBody)
  await verify.waitFor({ state: 'hidden' })
  assert.equal((await data(`${scene}/canvases`)).canvases.length, countBefore)
  await control({ storyboard_release: 2, storyboard_fail_on: 2 })
  await page.getByText('分镜提取失败', { exact: true }).waitFor()
  const failedTask = failed.find(row => row.task_id !== original.task_id)
  const failure = await data(tasks + '/' + failedTask.task_id)
  assert.ok(failure.error)
  await page.getByText(failure.error, { exact: true }).waitFor()
  await page.getByRole('button', { name: '重试分镜', exact: true }).click()
  const retry = await poll(() => data(tasks), rows => rows.find(row => row.retry_of_task_id === failedTask.task_id))
  const replacement = retry.find(row => row.retry_of_task_id === failedTask.task_id)
  assert.equal(replacement.canvas_id, failedTask.canvas_id)
  assert.equal((await data(`${scene}/canvases`)).canvases.length, countBefore)
  await control({ storyboard_release: 3 })
  await page.getByRole('button', { name: '查看分镜结果', exact: true }).waitFor()
  assert.equal(new URL(page.url()).searchParams.get('canvas'), null)
  assert.deepEqual((await data(`${scene}/objects`)).objects, prepared.objects)
  assert.equal((await data(canvas(replacement.canvas_id))).revision, 0)
  assert.deepEqual((await data(canvas(replacement.canvas_id) + '/runtime')).runs, [])
  await page.screenshot({ path: join(output, 'storyboard-background-ready.png'), animations: 'disabled' })
  process.stdout.write(JSON.stringify({ output, passed: true }) + '\n')
} finally { await cleanup() }
