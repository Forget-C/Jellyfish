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
const output = await browserOutput('jellyfish-dynamic-object-reference-')
const api = 'http://127.0.0.1:8304', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8304' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  await request(`${studio}/chapters`, 'POST', { id: chapter, project_id: project, index: 0, title: '候车', raw_text: raw })
  const scenes = `${studio}/projects/${project}/directing/chapters/${chapter}/sequences`
  const sourceVersion = createHash('sha256').update(raw).digest('hex')
  const sequence = await request(scenes, 'POST', { title: '两人等候', position: 0,
    source_version: sourceVersion, span: { start: 0, end: excerpt.length } })
  const emptyScene = await request(scenes, 'POST', { title: '空镜', position: 1,
    source_version: sourceVersion, span: { start: excerpt.length, end: raw.length } })
  const objectsUrl = `${scenes}/${sequence.id}/objects`
  const read = () => request(objectsUrl)
  const canvas = await request(`${scenes}/${sequence.id}/canvases`, 'POST', { name: '已有方案' })
  const canvasUrl = `${studio}/generation-canvases/${canvas.id}?project_id=${project}`
  const canvasBefore = await request(canvasUrl)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4304, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4304/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.press('Enter')
  await page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' }).getByRole('button', { name: '开始提取', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  const uploadInto = async (region, storyName, kind, resourceName) => {
    await region.getByRole('button', { name: /^(创建|重新创建)$/ }).click()
    await page.getByRole('button', { name: /^上传图片/ }).click()
    const form = page.getByRole('dialog', { name: '上传图片创建', exact: true })
    await form.waitFor()
    await page.waitForFunction(() => { const node = document.querySelector('[role="dialog"][aria-label="上传图片创建"]'); if (!node) return false; const box = node.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth + 1 })
    assert.equal(await form.getByRole('textbox', { name: '名称', exact: true }).inputValue(), storyName)
    assert.equal(await form.getByRole('button', { name: '创建', exact: true }).isDisabled(), true)
    await form.getByRole('textbox', { name: '名称', exact: true }).fill(resourceName)
    let fail = true
    await page.route('**/api/v1/studio/files/upload', route => { if (fail) { fail = false; return route.fulfill({ status: 503, json: { detail: '测试上传失败' } }) } return route.continue() })
    const pixels = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0V8AAAAASUVORK5CYII=', 'base64')
    await form.locator('input[type=file]').setInputFiles([{ name: 'front.png', mimeType: 'image/png', buffer: pixels }, { name: 'side.png', mimeType: 'image/png', buffer: pixels }])
    await form.getByRole('button', { name: '重试上传', exact: true }).click()
    await form.getByRole('img', { name: 'front.png', exact: true }).waitFor()
    await form.getByRole('img', { name: 'side.png', exact: true }).waitFor()
    await form.getByRole('button', { name: '设为主图', exact: true }).click()
    await form.locator('.resource-upload-item-controls').first().locator('.ant-select-selector').click()
    await page.locator('.ant-select-dropdown:visible').getByText('侧面', { exact: true }).click()
    await form.locator('.resource-upload-item-controls').first().getByTitle('侧面', { exact: true }).waitFor()
    let creations = 0, failSelection = true
    await page.route(`**/entities/${kind}/image-source`, route => { creations++; return route.continue() })
    await page.route('**/objects/*', route => {
      if (route.request().method() === 'PUT' && failSelection) { failSelection = false; return route.fulfill({ status: 503, json: { detail: '测试选用失败' } }) }
      return route.continue()
    })
    await form.getByRole('button', { name: '创建', exact: true }).click()
    await form.getByText(/资源已创建，选用或刷新失败/).waitFor()
    await form.getByRole('button', { name: '重试选用', exact: true }).click()
    await form.waitFor({ state: 'hidden' })
    await region.getByRole('button', { name: `编辑${storyName}资源`, exact: true }).waitFor()
    const selected = (await read()).objects.find(object => object.kind === kind && object.name === storyName && object.asset_id)
    const resource = await request(`${studio}/entities/${kind}/${selected.asset_id}`)
    assert.equal(resource.name, resourceName)
    assert.equal(resource.origin, 'upload')
    assert.equal(resource.project_id, project)
    const images = (await request(`${studio}/entities/${kind}/${selected.asset_id}/images`)).items
    assert.equal(images.length, 2)
    const primaryImages = images.filter(image => image.is_primary)
    assert.equal(primaryImages.length, 1)
    assert.equal(primaryImages[0].view_angle, 'LEFT')
    assert.equal(selected.image_file_id, primaryImages[0].file_id)
    await region.getByRole('button', { name: `编辑${storyName}资源`, exact: true }).click()
    const detail = page.getByRole('region', { name: resourceName, exact: true })
    await detail.getByRole('button', { name: '添加详情', exact: true }).click()
    await page.getByRole('button', { name: '继续编辑', exact: true }).click()
    await detail.getByRole('textbox', { name: kind === 'character' ? '角色设定' : '补充信息', exact: true }).fill('上传后的独立详情')
    await detail.getByRole('button', { name: '保存设定', exact: true }).click()
    await detail.getByRole('button', { name: '返回', exact: true }).click()
    assert.equal((await request(`${studio}/entities/${kind}/${selected.asset_id}`)).details_editable, true)
    assert.equal(creations, 1)
    await page.unroute(`**/entities/${kind}/image-source`)
    await page.unroute('**/objects/*')
    await page.unroute('**/api/v1/studio/files/upload')
    return selected.asset_id
  }
  const role = await uploadInto(front, '阿同', 'character', '上传阿同')
  await page.setViewportSize({ width: 390, height: 844 })
  const typeFilter = page.getByRole('combobox', { name: '对象类型' })
  await typeFilter.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('道具', { exact: true }).click()
  const prop = page.getByRole('region', { name: '信封 · 拿着信封', exact: true })
  await uploadInto(prop, '信封', 'prop', '上传信封')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await typeFilter.press('ArrowDown')
  await page.locator('.ant-select-dropdown:visible').getByText('全部类型', { exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 960 })
  const extraction = await request(objectsUrl + '/extractions', 'POST', { request_id: 'upload-scene-extract' })
  let candidate
  for (let attempt = 0; attempt < 60; attempt++) {
    candidate = await request(objectsUrl + '/extractions/' + extraction.task_id + '/candidate')
    if (candidate.candidate_available) break
    await delay(200)
  }
  await request(objectsUrl + '/extractions/' + extraction.task_id + '/apply', 'POST', { expected_revision: candidate.revision, preview_token: candidate.preview_token })
  await page.reload()
  const place = page.getByRole('region', { name: '前门 · 前门', exact: true })
  await uploadInto(place, '前门', 'scene', '上传前门')
  assert.equal((await request(`${studio}/entities/character/${role}`)).name, '上传阿同')
  assert.equal((await request(canvasUrl)).revision, canvasBefore.revision)
  await page.screenshot({ path: join(output, 'project-upload.png'), animations: 'disabled' })
  console.log('project object upload passed')
} catch (error) { if (page) await page.screenshot({ path: join(output, 'failure.png') }); throw error } finally { await cleanup() }
