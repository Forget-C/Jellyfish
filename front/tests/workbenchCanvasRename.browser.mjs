import { renameFreeCanvas } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-workbench-canvas-rename-')
const origin = 'http://127.0.0.1:4389', api = 'http://127.0.0.1:8389', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'workbench-canvas-rename'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_STORYBOARD_RECOVERY: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'),
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8389' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
const poll = async (read, predicate) => {
  for (let attempt = 0; attempt < 125; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await delay(100)
  }
  throw new Error('未观察到预期持久化结果')
}
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('隔离后端退出')
    try { if ((await fetch(`${studio}/generation-canvases`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const raw = '前门的阿同拿着信封。后门的阿同等待。'
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '更名验收', raw_text: raw })
  const chapterApi = `${studio}/projects/${project}/directing/chapters/${chapter}`
  const source = await request(chapterApi)
  const sequence = await request(`${chapterApi}/sequences`, 'POST', { title: '候车', position: 0,
    source_version: source.source_version, span: { start: 0, end: raw.length } })
  const sceneApi = `${chapterApi}/sequences/${sequence.id}`
  const canvas = await request(`${sceneApi}/canvases`, 'POST', { name: '原方案' })
  const read = () => request(`${studio}/generation-canvases/${canvas.id}?project_id=${project}`)
  const manage = `${origin}/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  const workbench = `${origin}/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${canvas.id}`
  const sceneCanvasPage = id => `${origin}/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${id}`
  const control = body => request(`${api}/test/runtime-controls`, 'POST', body)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4389, strictPort: true, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } })
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('dialog', dialog => void dialog.accept())
  const rename = page.getByRole('dialog', { name: '更名画布', exact: true })
  const input = rename.getByRole('textbox', { name: '画布名称', exact: true })
  const submit = rename.getByRole('button', { name: '保存名称', exact: true })
  const cardMenu = name => page.getByRole('button', { name: `${name}更多操作`, exact: true })
  const openRename = async (name, trigger = cardMenu(name)) => {
    await trigger.press('Enter')
    await page.getByRole('menuitem', { name: '更名', exact: true }).click()
    await input.waitFor()
  }
  await page.goto(manage)
  await openRename('原方案')
  assert.equal(await input.inputValue(), '原方案')
  await input.fill('   ')
  assert.equal(await submit.isDisabled(), true)
  await input.fill('长'.repeat(256))
  assert.equal(await submit.isDisabled(), true)
  await input.fill('取消的名称')
  await rename.getByRole('button', { name: '取消', exact: true }).press('Enter')
  await rename.waitFor({ state: 'hidden' })
  await cardMenu('原方案').and(page.locator(':focus')).waitFor()
  assert.equal((await read()).revision, 0)
  assert.equal((await read()).document.name, '原方案')

  const canvasApi = `${studio}/generation-canvases/${canvas.id}?project_id=${project}`
  const model = { id: 'model', type: 'model.text', model_id: 'canvas-runtime-text', config: {},
    prompt: { segments: [{ id: 'prompt', kind: 'text', text: '保留冻结的模型输入' }] } }
  const seed = await request(canvasApi, 'PUT', { request_id: 'seed-model', expected_revision: 0,
    document: { ...canvas.document, cards: [...canvas.document.cards, model] } })
  const preview = await request(`${studio}/generation-canvases/${canvas.id}/precheck?project_id=${project}`, 'POST', { card_id: model.id })
  assert.ok(preview.can_run)
  const run = await request(`${studio}/generation-canvases/${canvas.id}/runs?project_id=${project}`, 'POST', { request_id: 'model-before-rename', preview_token: preview.preview_token })
  const frozen = (await request(`${studio}/generation-canvases/${canvas.id}/runtime?project_id=${project}`)).runs.find(item => item.id === run.run_id)

  const editingTab = await context.newPage()
  await editingTab.goto(workbench)
  await editingTab.getByRole('status', { name: '画布保存状态' }).filter({ hasText: '已保存' }).waitFor()
  assert.equal(await editingTab.getByRole('textbox', { name: '画布名称', exact: true }).count(), 0)
  await page.bringToFront()
  await openRename('原方案')
  await rename.getByText(/结束其他页面的画布编辑/).waitFor()
  await input.fill('并发后保留的名称')
  assert.equal(await submit.isDisabled(), true)
  await editingTab.close()
  await rename.getByRole('button', { name: '重试取得编辑权' }).click()
  await rename.getByText(/结束其他页面的画布编辑/).waitFor({ state: 'hidden' })
  assert.equal(await input.inputValue(), '并发后保留的名称')

  const saveRoute = `**/generation-canvases/${canvas.id}?project_id=${project}`
  let concurrentDocument
  await page.route(saveRoute, async route => {
    if (route.request().method() !== 'PUT' || concurrentDocument) return route.fallback()
    const current = await read()
    await request(canvasApi, 'PUT', { request_id: 'concurrent-note', expected_revision: current.revision,
      document: { ...current.document, cards: [...current.document.cards, { id: 'note', type: 'content.text', text: '并发备注' }] } })
    concurrentDocument = (await read()).document
    await route.continue()
  })
  await submit.click()
  await rename.getByText(/服务端已有新修订/).waitFor()
  assert.equal(await input.inputValue(), '并发后保留的名称')
  assert.equal((await read()).document.name, '原方案')
  await page.unroute(saveRoute)

  let command
  await page.route(saveRoute, async route => {
    if (route.request().method() !== 'PUT' || command) return route.fallback()
    command = route.request().postDataJSON()
    const response = await route.fetch()
    assert.ok(response.ok(), await response.text())
    await route.abort('failed')
  })
  await submit.click()
  const verify = rename.getByRole('button', { name: '核实更名结果', exact: true })
  await verify.waitFor()
  const renamed = await read()
  assert.equal(renamed.revision, seed.revision + 2)
  assert.deepEqual(renamed.document, { ...concurrentDocument, name: '并发后保留的名称' })
  assert.equal(renamed.scene.sequence_id, sequence.id)
  await page.unroute(saveRoute)
  await page.reload()
  await openRename('并发后保留的名称')
  const replay = page.waitForRequest(req => req.method() === 'PUT' && new URL(req.url()).pathname.endsWith('/' + canvas.id))
  await verify.click()
  assert.deepEqual((await replay).postDataJSON(), command)
  await rename.waitFor({ state: 'hidden' })
  assert.equal((await read()).revision, renamed.revision)
  const activeRun = (await request(`${studio}/generation-canvases/${canvas.id}/runtime?project_id=${project}`)).runs.find(item => item.id === run.run_id)
  assert.equal(activeRun?.lifecycle, 'active')
  assert.deepEqual(activeRun?.nodes.map(node => node.basis), frozen.nodes.map(node => node.basis))
  const stalePrecheck = await fetch(`${studio}/generation-canvases/${canvas.id}/runs?project_id=${project}`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ request_id: 'stale-after-rename', preview_token: preview.preview_token }) })
  assert.equal(stalePrecheck.status, 409)
  await control({ release: 2 })

  await page.goto(sceneCanvasPage(canvas.id))
  await page.locator('.canvas-sequence-name').filter({ hasText: '并发后保留的名称' }).waitFor()

  assert.equal(await page.getByRole('textbox', { name: '画布名称', exact: true }).count(), 0)
  const free = await request(`${studio}/generation-canvases`, 'POST', { name: '自由方案' })
  await page.goto(`${origin}/canvases/${free.id}`)

  await renameFreeCanvas(page, '自由方案仍可更名')
  await poll(() => request(`${studio}/generation-canvases/${free.id}`), row => row.document.name === '自由方案仍可更名')

  await request(`${sceneApi}/objects/extractions`, 'POST', { request_id: 'object-prep' })
  await poll(() => request(`${sceneApi}/objects`), row => row.task?.status === 'succeeded')
  await delay(1050)
  const storyboard = await request(`${sceneApi}/storyboards`, 'POST', {
    request_id: 'active-storyboard', name: '生成中的名称', mode: 'faithful', text_model_id: 'canvas-runtime-text',
  })
  const taskPath = `${sceneApi}/storyboards/${storyboard.task_id}`
  const storyboardCanvas = `${studio}/generation-canvases/${storyboard.canvas_id}?project_id=${project}`
  await poll(() => request(taskPath), task => task.status === 'running')
  await page.goto(manage)
  await page.setViewportSize({ width: 390, height: 844 })
  const cards = page.getByRole('list', { name: '本场画布' }).getByRole('listitem')
  const pagination = page.getByRole('navigation', { name: '本场画布分页' })
  const nextPage = pagination.getByRole('button', { name: '下一页', exact: true })
  const previousPage = pagination.getByRole('button', { name: '上一页', exact: true })
  const verifyPage = async (number, id, name) => {
    await pagination.getByText(`${number} / 2`, { exact: true }).waitFor()
    await cards.getByRole('heading', { name, exact: true }).waitFor()
    assert.equal(await cards.count(), 1)
    assert.equal(await cards.getAttribute('data-canvas-id'), id)
  }
  await verifyPage(1, storyboard.canvas_id, '生成中的名称')
  await nextPage.click()
  await verifyPage(2, canvas.id, '并发后保留的名称')
  await previousPage.click()
  await openRename('生成中的名称')
  const bounds = await rename.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
  await input.fill('并发后保留的名称')
  await submit.press('Enter')
  await rename.waitFor({ state: 'hidden' })
  await verifyPage(1, storyboard.canvas_id, '并发后保留的名称')
  await nextPage.click()
  await verifyPage(2, canvas.id, '并发后保留的名称')
  await previousPage.click()
  await verifyPage(1, storyboard.canvas_id, '并发后保留的名称')
  assert.equal((await request(taskPath)).status, 'running')
  assert.equal((await request(storyboardCanvas)).revision, 1)
  await control({ storyboard_release: 1 })
  await poll(() => request(taskPath), task => task.status === 'succeeded')
  await page.setViewportSize({ width: 1440, height: 960 })
  await page.goto(sceneCanvasPage(storyboard.canvas_id))
  await page.getByRole('dialog', { name: '处理分镜提取结果', exact: true }).waitFor()
  assert.equal((await request(storyboardCanvas)).document.storyboard, undefined)

  const draft = { source_version: source.source_version,
    baseline: [{ sequence_id: sequence.id, version: sequence.version }], members: [],
    lineage: [{ sequence_id: sequence.id, target_keys: [] }], exited_sequence_ids: [sequence.id] }
  const division = await request(`${chapterApi}/division/preview`, 'POST', draft)
  await request(`${chapterApi}/division`, 'PUT', { request_id: 'historical-scene', draft,
    preview_token: division.preview_token, identity_changes_confirmed: true })
  await page.goto(manage)
  await openRename('并发后保留的名称', cardMenu('并发后保留的名称').last())
  await input.fill('历史保留方案')
  await submit.click()
  await rename.waitFor({ state: 'hidden' })
  const historical = await read()
  assert.equal(historical.scene.is_current, false)
  assert.deepEqual(historical.document, { ...renamed.document, name: '历史保留方案' })
} finally {
  if (backend.exitCode === null) {
    await request(`${api}/test/runtime-controls`, 'POST', { disconnect: true, storyboard_release: 100, release: 2 }).catch(() => {})
  }
  await cleanup()
}
