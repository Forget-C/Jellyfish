import { selectPreparedCharacter } from './storyboard-canvas-fixture.mjs'
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import { closePrecheck, omitMissingStoryboardImages, openReadyStoryboard } from './generationCanvasWorkbench.browser-helpers.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-video-defaults-')
const fixture = join(output, 'clip.mp4')
execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=160x90:d=1',
  '-c:v', 'libx264', '-y', fixture])
const api = 'http://127.0.0.1:8352', studio = api + '/api/v1/studio'
const project = 'canvas-project', chapter = 'storyboard-video-defaults', text = '前门的阿同拿着信封。后门的阿同等待。'
const canvases = studio + '/generation-canvases'
const canvasUrl = (id, suffix = '') => `${canvases}/${id}${suffix}?project_id=${project}`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_VIDEO_FIXTURE: fixture,
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8352' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  const result = await response.json()
  return result.data ?? result
}
const poll = async (read, predicate, description) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    const value = await read()
    if (predicate(value)) return value
    await delay(200)
  }
  throw new Error(description)
}

try {
  await poll(async () => {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    return fetch(canvases).then(response => response.ok, () => false)
  }, Boolean, 'isolated backend did not start')
  await request(studio + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: text })
  const sequences = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sequence = await request(sequences, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(text).digest('hex'), span: { start: 0, end: text.length } })
  const settingsUrl = api + '/api/v1/llm/model-settings'
  const settings = await request(settingsUrl)
  const setDefault = model => request(settingsUrl, 'PUT', { ...settings, default_video_model_id: model })
  await setDefault('story-video-model')
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4352, strictPort: true, hmr: false, proxy: { '/api': api },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const management = `http://127.0.0.1:4352/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}`
  await page.goto(management + '&step=objects')
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' }).getByRole('button', { name: '开始提取', exact: true }).click()
  const prepared = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const resourceImages = `${studio}/entities/character/object-browser-character/images`
  const referenceImage = (await request(resourceImages)).items[0]
  await request(`${resourceImages}/${referenceImage.id}`, 'PATCH', { is_primary: true })
  await selectPreparedCharacter(page, prepared, '已有角色')
  const scene = sequences + '/' + sequence.id
  await poll(() => request(scene + '/objects'), value => value.objects[0].image_file_id === 'object-browser-image', 'reference was not saved')
  const name = '视频默认配置验收'
  await request(scene + '/storyboards', 'POST', { name, request_id: 'default-model-storyboard', mode: 'faithful', pending_modality: 'video' })
  await page.goto(management + '&step=storyboard')
  await openReadyStoryboard(page, name)
  const canvas = new URL(page.url()).searchParams.get('canvas')
  const read = () => request(canvasUrl(canvas))
  const current = await poll(read, result => result.document.storyboard, 'storyboard was not applied')
  const [first, second] = current.document.storyboard.shots.map(shot => shot.model_card_ids[0])
  const modelCard = (document, id) => document.cards.find(card => card.id === id)
  const action = id => page.locator(`[data-card-id="${id}"]`).getByRole('button', { name: '生成视频', exact: true })
  const preview = page.getByRole('dialog', { name: '运行预检', exact: true })
  const clickAndPrecheck = async id => {
    await action(id).waitFor()
    const checked = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname.endsWith('/precheck'))
    await action(id).press('Enter')
    await preview.waitFor()
    const response = await checked
    if (!response.ok()) assert.fail(await response.text())
    assert.equal(await page.locator('.wb-details:visible').count(), 0)
    return (await response.json()).data
  }

  for (const id of [first, second]) assert.equal(modelCard(current.document, id).model_id, null)
  const defaultPreview = await clickAndPrecheck(first)
  const saved = await read()
  assert.equal(defaultPreview.revision, saved.revision)
  assert.equal(modelCard(saved.document, first).model_id, 'story-video-model')
  assert.equal(modelCard(saved.document, first).config.ratio, '16:9')
  assert.equal(modelCard(saved.document, second).model_id, null)
  assert.deepEqual(defaultPreview.execution_nodes, [first])
  assert.deepEqual(defaultPreview.input.media.map(item => item.file_id), ['object-browser-image'])
  assert.equal(defaultPreview.can_run, false)
  await closePrecheck(page)
  const withoutEmptyReference = await omitMissingStoryboardImages(page, first, read,
    () => request(canvasUrl(canvas, '/precheck'), 'POST', { card_id: first }), ['信封'])
  assert.deepEqual(withoutEmptyReference.input.media.map(item => item.file_id), ['object-browser-image'])

  await setDefault(null)
  await page.reload()
  await action(second).press('Enter')
  const detail = page.locator('.wb-details:visible').filter({ has: page.locator(`[data-card-details="${second}"]`) })
  await detail.getByRole('combobox', { name: '选择模型', exact: true }).waitFor()
  assert.equal(modelCard((await read()).document, second).model_id, null)
  assert.equal(await preview.count(), 0)

  const manual = await read()
  const manualCard = modelCard(manual.document, first)
  manualCard.config.ratio = '9:16'
  await request(canvasUrl(canvas), 'PUT', { request_id: 'manual-video-ratio', expected_revision: manual.revision, document: manual.document })
  await setDefault('story-video-model')
  await page.reload()
  const manualPreview = await clickAndPrecheck(first)
  const afterManual = await read()
  assert.equal(manualPreview.revision, afterManual.revision)
  assert.equal(modelCard(afterManual.document, first).config.ratio, '9:16')
  assert.equal(manualPreview.model.params.ratio, '9:16')
  assert.deepEqual((await request(canvasUrl(canvas, '/runtime'))).runs, [])
  assert.deepEqual((await request(api + '/test/runtime-controls')).media_calls, [])
  console.log('storyboard video defaults browser passed', output)
} finally {
  await cleanup()
}
