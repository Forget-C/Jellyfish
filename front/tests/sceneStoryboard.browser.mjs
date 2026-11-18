import { selectPreparedCharacter, storyboardCanvasApi } from './storyboard-canvas-fixture.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { omitMissingStoryboardImages, openStoryboardDefaultModels, openReadyStoryboard, closeCanvasDetails, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'

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
    try { if ((await fetch(`${studio}/generation-canvases`)).ok) { ready = true; break } } catch {}
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
  await page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' }).getByRole('button', { name: '开始提取', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const resourceImages = `${studio}/entities/character/object-browser-character/images`
  const referenceImage = (await request(resourceImages)).items[0]
  await request(`${resourceImages}/${referenceImage.id}`, 'PATCH', { is_primary: true })
  await selectPreparedCharacter(page, front, '已有角色')
  // 通过公开接口建立旧图片分镜，验证现有画布的编辑与引用契约。
  const storyboardName = '完整图片分镜验收'
  await request(`${scenes}/${sequence.id}/storyboards`, 'POST', {
    request_id: 'existing-image-storyboard', name: storyboardName, mode: 'complete', pending_modality: 'image',
  })
  await page.goto(prep)
  await openReadyStoryboard(page, storyboardName)
  const id = new URL(page.url()).searchParams.get('canvas')
  const canvas = `${studio}/generation-canvases/${id}?project_id=${project}`
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
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  await poll(state => !state.document.storyboard && state.document.cards.length === 1)
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  await poll(state => state.document.storyboard?.task_id === applied.document.storyboard.task_id)
  const modelCards = shots.flatMap(shot => shot.model_card_ids)
  await openStoryboardDefaultModels(page, modelCards, '分镜测试图片模型')
  await poll(state => modelCards.every(id => state.document.cards.find(card => card.id === id)?.model_id === 'story-image-model'))
  const firstModel = shots[0].model_card_ids[0]
  const checked = await omitMissingStoryboardImages(page, firstModel, read,
    () => request(storyboardCanvasApi(`${studio}/generation-canvases`, id, '/precheck', project), 'POST', { card_id: firstModel }), ['信封'])
  assert.match(checked.input.text, /前門|前门/)
  assert.doesNotMatch(checked.input.text, /后门/)
  assert.deepEqual(checked.execution_nodes, shots[0].model_card_ids)
  assert.deepEqual(checked.input.media.map(item => item.file_id), ['object-browser-image'])
  const other = await request(storyboardCanvasApi(`${studio}/generation-canvases`, id, '/precheck', project), 'POST', { card_id: shots[1].model_card_ids[0] })
  assert.equal(other.input.media.length, 0)
  assert.equal((await request(storyboardCanvasApi(`${studio}/generation-canvases`, id, '/runtime', project))).runs.length, 0)

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
  await page.goto(`http://127.0.0.1:4260/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench?canvas=${id}`)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await openCanvasCard(page, shots[0].card_id)
  await visible.waitFor()
  assert.equal(await visible.innerText(), result.text)
  await page.screenshot({ path: join(output, 'storyboard-edited.png'), animations: 'disabled' })
  await page.goto(prep)
  await page.getByRole('button', { name: '生成新分镜画布', exact: true }).click()
  const config = page.getByRole('dialog', { name: '生成新分镜画布' })
  await config.getByRole('radio', { name: '忠实提取', exact: true }).check()
  await config.getByRole('textbox', { name: '画布名称' }).fill('忠实分镜验收')
  await config.getByRole('button', { name: '下一步：确认生成', exact: true }).click()
  await config.getByRole('button', { name: '确认生成', exact: true }).click()
  await openReadyStoryboard(page, '忠实分镜验收')
  const faithfulId = new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(faithfulId, id)
  const faithfulRead = () => request(`${studio}/generation-canvases/${faithfulId}?project_id=${project}`)
  const faithful = await poll(state => state.document.storyboard?.mode === 'faithful', faithfulRead)
  assert.equal(faithful.document.cards.some(card => card.type === 'direction.camera'), false)
  const faithfulShot = faithful.document.storyboard.shots[0]
  const unconfigured = faithful.document.cards.find(card => card.id === faithfulShot.model_card_ids[0])
  assert.equal(unconfigured.type, 'model.video')
  assert.equal(unconfigured.model_id, null)
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  const designStack = page.getByRole('button', { name: '查看堆叠 镜头 01 · 设计', exact: true })
  await designStack.hover()
  await designStack.getByRole('button', { name: '解除堆叠', exact: true }).click()
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
