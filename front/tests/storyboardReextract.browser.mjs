import { openReadyStoryboard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-storyboard-reextract-')
const api = 'http://127.0.0.1:8329', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'storyboard-reextract-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_SCENE_STORYBOARD: '1', CANVAS_BROWSER_STORYBOARD_REEXTRACT: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8329' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4329, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(16000)
  const prep = `http://127.0.0.1:4329/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=storyboard`
  await page.goto(prep.replace('step=storyboard', 'step=objects'))
  await page.getByRole('button', { name: '提取对象', exact: true }).click()
  await page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' }).getByRole('button', { name: '开始提取', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const images = `${studio}/entities/character/object-browser-character/images`
  const image = (await request(images)).items.find(row => row.file_id === 'object-browser-image')
  await request(`${images}/${image.id}`, 'PATCH', { is_primary: true })
  await front.getByRole('button', { name: '选用', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选用项目资源', exact: true })
  await picker.getByRole('button', { name: '选择已有角色', exact: true }).click()
  await picker.getByRole('button', { name: '确认选用', exact: true }).click()
  await front.getByRole('img', { name: '阿同已选参考图', exact: true }).waitFor()
  // 通过公开接口建立旧图片分镜，验证现有画布的编辑与引用契约。
  const storyboardName = '已有图片分镜'
  await request(`${scenes}/${sequence.id}/storyboards`, 'POST', {
    request_id: 'existing-image-storyboard', name: storyboardName, mode: 'faithful', pending_modality: 'image',
  })
  const videoName = '自动设计堆叠分镜'
  await request(`${scenes}/${sequence.id}/storyboards`, 'POST', {
    request_id: 'automatic-stack-storyboard', name: videoName, mode: 'faithful', pending_modality: 'video',
  })
  await page.goto(prep)
  await openReadyStoryboard(page, videoName)
  await page.waitForFunction(() => document.querySelectorAll('[data-stack-id]').length === 2)
  assert.equal(await page.getByRole('button', { name: '重新提取', exact: true }).count(), 0)
  await page.goto(prep)
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
  const pending = await poll(state => !!state.document.storyboard)
  assert.ok(pending.document.storyboard)
  assert.equal(await page.getByRole('button', { name: '重新提取', exact: true }).count(), 0)
  await request(studio + '/chapters/' + chapter, 'PATCH', { raw_text: '前缀。前门的阿同放下信封。' })
  await page.reload()
  await page.getByText('章节原文已变化，画布仍保留当前固定原文。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '重新提取', exact: true }).count(), 0, 'source changes do not restore the entry')
  assert.deepEqual((await read()).document, pending.document)
  console.log(`storyboard existing canvas entry passed: ${output}`)
} finally { await cleanup() }
