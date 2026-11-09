import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { openReadyStoryboard, closeCanvasDetails, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-scene-storyboard-')
const api = 'http://127.0.0.1:8260', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'storyboard-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8260' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(`${studio}/generation-canvases/${project}`)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: excerpt })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(excerpt).digest('hex'), span: { start: 0, end: Array.from(excerpt).length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4260, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const prep = `http://127.0.0.1:4260/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  await page.goto(prep.replace('step=storyboard', 'step=objects'))
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await front.getByRole('button', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  await page.getByRole('button', { name: '继续到分镜与画布', exact: true }).click()
  await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
  const config = page.getByRole('region', { name: '生成新分镜画布配置' })
  assert.equal(await config.getByRole('radio', { name: '自动产出完整分镜', exact: true }).isChecked(), true)
  assert.ok(await config.getByRole('textbox', { name: '画布名称' }).inputValue())
  await config.getByRole('textbox', { name: '画布名称' }).fill('完整分镜验收')
  await config.getByRole('combobox', { name: '生产模型' }).click()
  await page.getByText('分镜测试图片模型', { exact: true }).click()
  const storyboardName = await config.getByRole('textbox', { name: '画布名称' }).inputValue()
  await config.getByRole('button', { name: '开始提取', exact: true }).click()
  await openReadyStoryboard(page, storyboardName)
  const id = new URL(page.url()).searchParams.get('canvas')
  const canvas = `${studio}/generation-canvases/${project}/${id}`
  const read = () => request(canvas)
  const poll = async (predicate, readState = read) => {
    for (let attempt = 0; attempt < 130; attempt++) {
      const state = await readState()
      if (predicate(state)) return state
      await delay(100)
    }
    throw new Error('canvas state not saved')
  }
  const applied = await poll(state => !!state.document.storyboard)
  const { shots, objects } = applied.document.storyboard
  assert.equal(applied.document.storyboard.mode, 'complete')
  const camera = applied.document.cards.find(card => card.type === 'direction.camera')
  assert.equal(camera.fields.viewpoint.text, '低机位跟拍')
  assert.equal(camera.fields.viewpoint.state, 'proposal')
  assert.equal(shots.length, 2)
  assert.equal(objects.filter(object => object.origin === 'prepared').length, 3)
  const missed = objects.find(object => object.origin === 'missed')
  assert.equal(applied.document.cards.find(card => card.id === missed.reference_card_id).type, 'reference.place')
  assert.equal(applied.document.cards.filter(card => card.type === 'content.character').length, 2)
  assert.notEqual(...applied.document.cards.filter(card => card.type === 'content.character').map(card => card.name))
  assert.equal(applied.document.groups.length, 3)
  const checked = await request(`${canvas}/precheck`, 'POST', { card_id: shots[0].model_card_ids[0] })
  assert.ok(checked.can_run, JSON.stringify(checked.diagnostics))
  assert.match(checked.input.text, /前門|前门/)
  assert.doesNotMatch(checked.input.text, /后门/)
  assert.deepEqual(checked.execution_nodes, shots[0].model_card_ids)
  assert.deepEqual(checked.input.media.map(item => item.file_id), ['object-browser-image'])
  const other = await request(`${canvas}/precheck`, 'POST', { card_id: shots[1].model_card_ids[0] })
  assert.equal(other.input.media.length, 0)
  assert.equal((await request(`${canvas}/runtime`)).runs.length, 0)

  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(state => !state.document.storyboard && state.document.cards.length === 1)
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(state => state.document.storyboard?.task_id === applied.document.storyboard.task_id)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCanvasCard(page, missed.reference_card_id)
  await page.getByText('补漏对象 · 未选择图片', { exact: true }).waitFor()
  await closeCanvasDetails(page)
  await openCanvasCard(page, shots[0].card_id)
  const visible = page.getByRole('textbox', { name: '可见结果内容', exact: true })
  await visible.fill('阿同继续拿着信封。')
  await closeCanvasDetails(page)
  const edited = await poll(state => state.document.cards.find(card => card.id === shots[0].card_id)?.visible_result?.text === '阿同继续拿着信封。')
  const result = edited.document.cards.find(card => card.id === shots[0].card_id).visible_result
  assert.equal(result.authorship, 'user')
  assert.equal(result.state, 'fact')
  assert.equal(result.purpose, 'design')
  assert.equal(result.source_locator, '前门的阿同拿着信封。')
  assert.equal(result.extraction_context, 'storyboard')
  assert.ok(edited.document.storyboard.origins[shots[0].card_id].manually_edited)
  await page.goto(`http://127.0.0.1:4260/projects/${project}/generation-canvas?canvas=${id}`)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCanvasCard(page, shots[0].card_id)
  await visible.waitFor()
  assert.equal(await visible.innerText(), result.text)
  await page.screenshot({ path: join(output, 'storyboard-edited.png'), animations: 'disabled' })
  await page.goto(prep)
  await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
  await config.getByRole('radio', { name: '忠实提取', exact: true }).check()
  await config.getByRole('textbox', { name: '画布名称' }).fill('忠实分镜验收')
  await config.getByRole('button', { name: '开始提取', exact: true }).click()
  await openReadyStoryboard(page, '忠实分镜验收')
  const faithfulId = new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(faithfulId, id)
  const faithfulRead = () => request(`${studio}/generation-canvases/${project}/${faithfulId}`)
  const faithful = await poll(state => state.document.storyboard?.mode === 'faithful', faithfulRead)
  assert.equal(faithful.document.cards.some(card => card.type === 'direction.camera'), false)
  const faithfulShot = faithful.document.storyboard.shots[0]
  const unconfigured = faithful.document.cards.find(card => card.id === faithfulShot.model_card_ids[0])
  assert.equal(unconfigured.model_id, null)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCanvasCard(page, faithfulShot.card_id)
  await visible.fill('阿同站在前门，手持信封。')
  await closeCanvasDetails(page)
  await poll(state => state.document.cards.find(card => card.id === faithfulShot.card_id)?.visible_result?.text === '阿同站在前门，手持信封。', faithfulRead)
  await page.reload()
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCanvasCard(page, faithfulShot.card_id)
  await visible.waitFor()
  assert.equal(await visible.innerText(), '阿同站在前门，手持信封。')
  process.stdout.write(JSON.stringify({ output, passed: true }) + '\n')
} finally { await cleanup() }
