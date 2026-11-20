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
const api = 'http://127.0.0.1:8297', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8297' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4297, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4297/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.press('Enter')
  await page.locator('.ant-modal-confirm').filter({ hasText: '确认提取对象？' }).getByRole('button', { name: '开始提取', exact: true }).click()
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  assert.equal(await front.locator('article, .ant-card').first().evaluate(node => getComputedStyle(node).borderRadius), '12px')
  assert.equal(await front.getByRole('combobox', { name: '参考视角' }).count(), 0)
  assert.equal(await front.getByRole('button', { name: '上传参考图', exact: true }).count(), 0)
  const baseline = await read()
  const object = baseline.objects.find(item => item.excerpt === '前门的阿同')
  assert.ok(object)
  const choose = async assetId => {
    const current = await read()
    return request(`${objectsUrl}/${object.id}`, 'PUT', { expected_revision: current.revision, asset_id: assetId })
  }
  const initialImages = await request(`${studio}/entities/character/object-browser-character/images`)
  await request(`${studio}/entities/character/object-browser-character/images/${initialImages.items[0].id}`, 'PATCH', { is_primary: true })
  await choose('object-browser-character')
  await page.reload()
  const selected = front.getByRole('img', { name: '阿同已选参考图', exact: true })
  await selected.waitFor()
  assert.equal((await read()).objects.find(item => item.id === object.id).image_file_id, 'object-browser-image')
  const directAsset = front.getByRole('button', { name: '编辑阿同资源', exact: true })
  await directAsset.click()
  const detail = page.getByRole('region', { name: '已有角色', exact: true })
  await detail.getByRole('button', { name: '返回', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  assert.equal(page.url(), management)

  // New main images are read through the same object selection, without another choice request.
  const assetUrl = `${studio}/entities/character/object-browser-character`
  const uploadBody = new FormData()
  uploadBody.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' }), 'replacement.png')
  uploadBody.append('project_id', project)
  const uploadedResponse = await fetch(`${studio}/files/upload`, { method: 'POST', body: uploadBody })
  assert.ok(uploadedResponse.ok, await uploadedResponse.clone().text())
  const uploaded = (await uploadedResponse.json()).data
  const replacement = await request(`${assetUrl}/images`, 'POST', { file_id: uploaded.id })
  await request(`${assetUrl}/images/${replacement.id}`, 'PATCH', { is_primary: true })
  await page.reload()
  await selected.waitFor()
  await selected.evaluate(image => image.decode())
  assert.ok((await selected.getAttribute('src')).includes(`/${uploaded.id}/`))
  assert.equal((await read()).objects.find(item => item.id === object.id).asset_id, 'object-browser-character')
  await front.getByRole('button', { name: '预览阿同参考图', exact: true }).press('Enter')
  await page.locator('.ant-image-preview-close:visible').waitFor()
  await page.keyboard.press('Escape')

  // Cancel leaves identity unchanged, confirmation clears only this scene's choice.
  await front.getByRole('button', { name: '对象更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '清空', exact: true }).click()
  let confirmation = page.locator('.ant-modal-confirm:visible')
  await confirmation.getByRole('button', { name: /取\s*消/ }).click()
  assert.equal((await read()).objects.find(item => item.id === object.id).asset_id, 'object-browser-character')
  await front.getByRole('button', { name: '对象更多操作', exact: true }).click()
  await page.getByRole('menuitem', { name: '清空', exact: true }).click()
  confirmation = page.locator('.ant-modal-confirm:visible')
  await confirmation.getByRole('button', { name: /清\s*空/ }).click()
  await selected.waitFor({ state: 'detached' })
  const cleared = (await read()).objects.find(item => item.id === object.id)
  assert.equal(cleared.asset_id, null)
  assert.equal(cleared.image_file_id, null)
  assert.equal(cleared.name, object.name)
  assert.equal(cleared.description, object.description)
  assert.equal(cleared.excerpt, object.excerpt)
  assert.equal((await request(assetUrl)).id, 'object-browser-character')
  assert.deepEqual(await request(canvasUrl), canvasBefore, 'clearing preserves existing fixed canvas data')

  // A selected resource without members remains selected, not an unassociated object.
  await request(`${studio}/entities/character`, 'POST', { id: 'empty-browser-role', project_id: project, name: '尚无图片角色', description: '等待制作图片' })
  await choose('empty-browser-role')
  await page.reload()
  await front.getByRole('button', { name: '编辑阿同资源', exact: true }).waitFor()
  assert.equal((await read()).objects.find(item => item.id === object.id).reference_state, 'missing')
  await request(`${studio}/entities/character/empty-browser-role`, 'DELETE')
  await page.reload()
  await front.getByRole('button', { name: '重新选用', exact: true }).waitFor()
  assert.equal((await read()).objects.find(item => item.id === object.id).reference_state, 'unavailable')
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: join(output, `object-reference-${width}.png`), animations: 'disabled' })
  }
  console.log('dynamic scene object selection browser passed')
} catch (error) { if (page) { await page.screenshot({ path: join(output, 'failure.png') }); console.log((await page.locator('body').innerText()).slice(-3000)) } throw error } finally { await cleanup() }
