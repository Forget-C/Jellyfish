import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-storyboard-video-layout-')
const api = 'http://127.0.0.1:8724/api/v1/studio', origin = 'http://127.0.0.1:4724'
const project = 'canvas-project', chapter = 'video-layout-chapter'
const raw = '前门的阿同拿着信封。后门的阿同等待。他绕过门廊。'
const canvases = api + '/generation-canvases/' + project
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_REFERENCES: '1',
    CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8724' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
const request = async (url, method = 'GET', body) => {
  const response = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  assert.ok(response.ok, await response.clone().text())
  return (await response.json()).data
}
async function poll(read, done) {
  for (let index = 0; index < 100; index++) {
    const result = await read()
    if (done(result)) return result
    await delay(160)
  }
  assert.fail('Expected storyboard or canvas position was not ready')
}
const cards = (page, ids) => Promise.all(ids.map(id => page.locator(`[data-card-id="${id}"]`).boundingBox()))
const fullyVisible = (box, viewport) => box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height

try {
  await poll(() => fetch(canvases).then(response => response.ok, () => false), Boolean)
  await request(api + '/chapters', 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: raw })
  const scenes = `${api}/projects/${project}/directing/chapters/${chapter}/sequences`
  const scene = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: createHash('sha256').update(raw).digest('hex'), span: { start: 0, end: raw.length } })
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4724, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8724' },
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const newPage = async viewport => {
    const page = await browser.newPage({ viewport })
    await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
    page.setDefaultTimeout(12000)
    return page
  }
  const projectUrl = `${origin}/projects/${project}`
  const desktop = await newPage({ width: 1080, height: 900 })
  await desktop.goto(`${projectUrl}/chapters/${chapter}/workbench-management?sequence=${scene.id}&step=objects`)
  await desktop.getByRole('button', { name: '提取对象', exact: true }).click()
  await desktop.getByRole('region', { name: '阿同 · 后门的阿同', exact: true }).waitFor()
  const generate = async name => {
    const collection = `${scenes}/${scene.id}/storyboards`
    const task = await request(collection, 'POST', { request_id: randomUUID(), name, mode: 'faithful', pending_modality: 'video' })
    await poll(() => request(`${collection}/${task.task_id}`), result => result.status === 'succeeded')
    return task
  }
  const open = async (page, task) => {
    const url = `${projectUrl}/chapters/${chapter}/sequences/${scene.id}/canvas-workbench?canvas=${task.canvas_id}&storyboardTask=${task.task_id}`
    await page.goto(url)
    const { document } = await poll(() => request(`${canvases}/${task.canvas_id}`), row => row.document.storyboard)
    const ids = document.storyboard.shots.flatMap(shot => shot.model_card_ids)
    assert.equal(ids.length, 3)
    await page.locator(`[data-card-id="${ids[0]}"]`).waitFor()
    return { url, ids, original: document.fixed_source.card_id }
  }
  const task = await generate('桌面分镜')
  const { url, ids, original } = await open(desktop, task)
  const [first, second, third] = await cards(desktop, ids)
  assert.ok(fullyVisible(first, desktop.viewportSize()) && fullyVisible(second, desktop.viewportSize()), JSON.stringify({ first, second }))
  assert.equal(first.y, second.y, 'two shots share the first production row')
  assert.ok(first.x < second.x && third.y > first.y, 'shots advance left to right, then wrap')
  const initialZoom = await desktop.getByLabel('画布缩放比例').textContent()
  await desktop.getByRole('button', { name: '缩小', exact: true }).click()
  const [zoomed] = await cards(desktop, ids)
  const changedZoom = await desktop.getByLabel('画布缩放比例').textContent()
  assert.notEqual(changedZoom, initialZoom)
  await desktop.reload()
  await desktop.locator(`[data-card-id="${ids[0]}"]`).waitFor()
  assert.equal(await desktop.getByLabel('画布缩放比例').textContent(), changedZoom)
  assert.deepEqual((await cards(desktop, ids))[0], zoomed)
  await desktop.setViewportSize({ width: 820, height: 900 })
  assert.deepEqual((await cards(desktop, ids))[0], zoomed, 'resizing does not move an already placed card')

  const narrow = await newPage({ width: 390, height: 844 })
  const mobile = await open(narrow, await generate('窄屏分镜'))
  const [mobileFirst] = await cards(narrow, mobile.ids)
  assert.ok(fullyVisible(mobileFirst, narrow.viewportSize()), JSON.stringify(mobileFirst))

  const ordinary = await newPage({ width: 1080, height: 900 })
  await ordinary.goto(`${projectUrl}/generation-canvas?canvas=${task.canvas_id}`)
  await ordinary.locator(`[data-card-id="${original}"]`).waitFor()
  const [ordinarySource, ordinaryVideo] = await cards(ordinary, [original, ids[0]])
  assert.ok(ordinarySource.y < ordinaryVideo.y, 'ordinary entry keeps its original layout rules')
  await ordinary.goto(url)
  await ordinary.locator(`[data-card-id="${ids[0]}"]`).waitFor()
  assert.deepEqual((await cards(ordinary, [ids[0]]))[0], ordinaryVideo, 'opening an existing storyboard does not rearrange its layout')
  console.log(output)
} finally {
  await cleanup()
}
