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
const output = await browserOutput('jellyfish-scene-objects-')
const api = 'http://127.0.0.1:8258', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8258' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  const canvas = await request(`${scenes}/${sequence.id}/canvases`, 'POST', { name: '已有方案' })
  const canvasUrl = `${studio}/generation-canvases/${project}/${canvas.id}`
  const canvasBefore = await request(canvasUrl)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4258, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const prep = `http://127.0.0.1:4258/projects/${project}/chapters/${chapter}/sequences/${sequence.id}/canvas-workbench`
  await page.goto(prep)
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText('尚未提取对象', { exact: true }).waitFor()
  await extract.focus()
  await page.keyboard.press('Enter')
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  assert.equal(page.url(), prep)
  await front.getByText('尚未关联资产', { exact: true }).waitFor()
  await back.getByText('尚未关联资产', { exact: true }).waitFor()
  await front.getByRole('combobox', { name: '关联资产' }).click()
  await page.getByText('已有角色（提取建议）', { exact: true }).click()
  await front.getByText('未选参考图', { exact: true }).waitFor()
  await front.getByRole('combobox', { name: '选择参考图' }).click()
  await page.getByText('参考图 1', { exact: true }).click()
  await front.getByText('已选参考图', { exact: true }).waitFor()
  await front.getByRole('button', { name: '准备图片', exact: true }).click()
  const asset = page.getByRole('dialog', { name: '准备角色图片 · 已有角色' })
  await asset.getByRole('button', { name: '重新生成', exact: true }).waitFor()
  await asset.getByRole('button', { name: '返回本场资产', exact: true }).click()
  await asset.waitFor({ state: 'hidden' })

  const prop = page.getByRole('region', { name: '信封 · 拿着信封', exact: true })
  await prop.getByRole('button', { name: '新建并关联' }).click()
  const create = page.getByRole('dialog', { name: '新建并关联资产' })
  await create.getByRole('button', { name: '创建并关联', exact: true }).click()
  await prop.getByText('未选参考图', { exact: true }).waitFor()
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), back.getByRole('button', { name: '上传参考图' }).click()])
  await chooser.setFiles({ name: '后门参考.png', mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64') })
  await back.getByText('已选参考图', { exact: true }).waitFor()
  const read = () => request(`${scenes}/${sequence.id}/objects`)
  const prepared = await read()
  assert.equal(prepared.objects[0].image_file_id, 'object-browser-image')
  assert.equal(prepared.objects[1].asset_id, null)
  assert.ok(prepared.objects[1].image_file_id && prepared.objects[1].image_file_id !== 'object-browser-image')
  assert.equal(prepared.objects[2].image_file_id, null)
  assert.deepEqual(await request(canvasUrl), canvasBefore, 'candidate changes never rewrite a canvas')
  const tasks = await request(`${api}/api/v1/film/tasks?project_id=${project}`)
  assert.deepEqual(tasks.items.map(task => task.task_kind), ['directing_object_extract'])
  await page.reload()
  await front.getByRole('img', { name: '阿同已选参考图' }).waitFor()
  await back.getByRole('img', { name: '阿同已选参考图' }).waitFor()
  await page.screenshot({ path: join(output, 'objects-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: join(output, 'objects-mobile.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '已有方案', exact: true }).click()
  await page.getByRole('region', { name: '生成画布工作台' }).waitFor()
  console.log(JSON.stringify({ output, passed: true }))
} catch (reason) {
  if (page) await page.screenshot({ path: join(output, 'failure.png'), fullPage: true })
  throw reason
} finally { await cleanup() }
