import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closePrecheck } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-visual-continuity-')
const fixture = join(output, 'clip.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1',
  '-c:v', 'libx264', '-y', fixture])
const api = 'http://127.0.0.1:8732', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'storyboard-visual-continuity-chapter', text = '前门的阿同拿着信封。后门的阿同等待。'
const base = studio + '/generation-canvases/' + project
const controls = api + '/test/runtime-controls'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE: fixture,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8732' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
async function request(url, method = 'GET', body) {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  const result = await response.json()
  return result.data ?? result
}

async function poll(read, predicate, description) {
  let current
  for (let attempt = 0; attempt < 160; attempt++) {
    current = await read()
    if (predicate(current)) return current
    await delay(100)
  }
  throw new Error(description + ' ' + JSON.stringify(current).slice(0, 1200))
}

try {
  await poll(async () => {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    return fetch(base).then(response => response.ok, () => false)
  }, Boolean, 'isolated backend did not start')
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: text })
  const chapterApi = `${studio}/projects/${project}/directing/chapters/${chapter}`
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4732, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const projectUrl = `http://127.0.0.1:4732/projects/${project}`

  const sequence = await request(chapterApi + '/sequences', 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(text).digest('hex'), span: { start: 0, end: text.length } })
  const scene = `${chapterApi}/sequences/${sequence.id}`
  await page.goto(`${projectUrl}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`)
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true }).waitFor()
  const task = await request(scene + '/storyboards', 'POST', { request_id: randomUUID(), name: '视觉承接',
    mode: 'faithful', production_model_id: 'story-video-model', pending_modality: 'video' })
  const ready = await poll(() => request(scene + '/storyboards/' + task.task_id),
    item => ['succeeded', 'failed'].includes(item.status), 'storyboard did not finish')
  assert.equal(ready.status, 'succeeded', JSON.stringify(ready))
  const canvas = base + '/' + task.canvas_id
  await page.goto(`${projectUrl}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${task.canvas_id}&storyboardTask=${task.task_id}`)
  const state = await poll(() => request(canvas), item => item.document.storyboard, 'storyboard was not saved')
  const [first, later] = state.document.storyboard.shots.map(item => item.model_card_ids[0])
  assert.ok(first && later)
  const model = page.locator(`[data-card-id="${later}"]`)
  const open = async () => {
    await model.getByRole('button', { name: '卡片操作' }).click()
    await model.getByRole('button', { name: '视觉承接', exact: true }).click()
  }
  const dialog = page.getByRole('dialog', { name: '视觉承接', exact: true })
  await open()
  await dialog.getByText('前镜尚无成功视频，可先生成当前镜头。').waitFor()
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  await model.getByRole('button', { name: '生成视频', exact: true }).click()
  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  assert.equal(await preview.getByRole('button', { name: '确认执行' }).isEnabled(), true)
  await closePrecheck(page)
  const run = async (id) => {
    const checked = await request(canvas + '/precheck', 'POST', { card_id: id })
    assert.ok(checked.can_run, JSON.stringify(checked.diagnostics))
    const result = await request(canvas + '/runs', 'POST', { request_id: randomUUID(), preview_token: checked.preview_token })
    const runtime = await poll(() => request(canvas + '/runtime'), item => item.runs.find(r => r.id === result.run_id)?.lifecycle === 'finished', 'video did not finish')
    const node = runtime.runs.find(r => r.id === result.run_id).nodes[0]
    assert.equal(node.status, 'succeeded')
    return node
  }
  const predecessor = await run(first)
  await page.reload()
  await open()
  const slider = dialog.getByRole('slider', { name: '视频时间位置' })
  await page.waitForFunction(() => !document.querySelector('[aria-label="视频时间位置"]')?.disabled)
  const purpose = dialog.getByRole('combobox', { name: '参考用途' })
  assert.equal(await purpose.inputValue(), '')
  assert.equal(await dialog.getByRole('button', { name: '定位尾帧并用作首帧' }).count(), 0)
  await dialog.getByRole('checkbox', { name: '同机位接续连续动作' }).check()
  await dialog.getByRole('button', { name: '定位尾帧并用作首帧' }).click()
  assert.equal(await purpose.inputValue(), 'first_frame')
  assert.equal(await slider.inputValue(), '999')
  await slider.fill('600')
  const adopt = dialog.getByRole('button', { name: '确认采用', exact: true })
  const savePath = new URL(canvas).pathname
  const matchesSave = url => url.pathname === savePath
  let rejected = false
  const rejectFirst = async route => {
    if (rejected || route.request().method() !== 'PUT') return route.continue()
    rejected = true
    const body = route.request().postDataJSON()
    body.document.storyboard.visual_continuity[later].binding_id = 'missing-binding'
    return route.continue({ postData: JSON.stringify(body) })
  }
  await page.route(matchesSave, rejectFirst)
  await adopt.click()
  await dialog.getByText(/承接尚未确认/).waitFor()
  assert.deepEqual(await request(canvas), state, 'rejected adoption leaves the saved graph unchanged')
  await page.unroute(matchesSave, rejectFirst)
  const command = page.waitForRequest(sent => sent.method() === 'PUT' && new URL(sent.url()).pathname === savePath)
  await adopt.click()
  await dialog.waitFor({ state: 'hidden' })
  const adopted = await request(canvas)
  assert.equal(adopted.revision, state.revision + 1, 'one document save includes the still and adoption')
  assert.equal((await request(canvas, 'PUT', (await command).postDataJSON())).revision, adopted.revision,
    'the exact confirmation replays its committed revision')
  const relation = adopted.document.storyboard.visual_continuity[later]
  const binding = adopted.document.cards.find(card => card.id === later).input_bindings.find(item => item.id === relation.binding_id)
  const frame = adopted.document.cards.find(card => card.id === binding.source.card_id)
  assert.equal(binding.input_port, 'first_frame')
  assert.equal(frame.frame_origin.source_file_id, predecessor.outputs[0].file_id)
  assert.equal(frame.frame_origin.at_ms, 600)
  assert.equal(frame.frame_origin.result_set_id, predecessor.result_set_id)
  assert.equal((await request(controls)).media_calls.length, 1, 'adoption does not start a task')
  await run(later)
  assert.equal((await request(controls)).media_calls.at(-1).path, '/ent/v2/img2video')
  const fixedBytes = Buffer.from(await (await fetch(studio + '/files/' + frame.file_id + '/download')).arrayBuffer())
  assert.equal((await request(controls)).media_calls.at(-1).body.images[0], 'data:image/png;base64,' + fixedBytes.toString('base64'))
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(() => request(canvas), item => !item.document.cards.some(card => card.id === frame.id), 'undo did not save')
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(() => request(canvas), item => item.document.storyboard.visual_continuity?.[later], 'redo did not save')
  await page.reload()
  await model.getByRole('button', { name: '引用', exact: true }).click()
  await page.getByRole('dialog', { name: '卡片引用' }).getByRole('button', { name: /来源视频.*0.600/ }).waitFor()
  await page.goto(`${projectUrl}/generation-canvas?canvas=${task.canvas_id}`)
  await model.getByRole('button', { name: '卡片操作' }).click()
  assert.equal(await model.getByRole('button', { name: '视觉承接' }).count(), 0)
  console.log('Storyboard visual continuity: later-shot adoption, actual provider input, one save, undo, and reopen')
} finally {
  await cleanup()
}
