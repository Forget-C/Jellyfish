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
const api = 'http://127.0.0.1:8299', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8299' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  const canvasUrl = `${studio}/generation-canvases/${project}/${canvas.id}`
  const canvasBefore = await request(canvasUrl)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4299, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4299/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.focus()
  await page.keyboard.press('Enter')
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  await request(`${studio}/entities/actor`, 'POST', { id: 'library-person', name: '库中人物' })
  const uploaded = await request(`${studio}/entities/character/object-browser-character/images`)
  await request(`${studio}/entities/actor/library-person/images`, 'POST', { file_id: uploaded.items[0].file_id })
  for (let index = 0; index < 6; index++) await request(`${studio}/entities/actor`, 'POST', { id: `scroll-library-${index}`, name: `滚动资源${index}` })
  await front.getByRole('button', { name: '选用', exact: true }).click()
  await page.locator('.object-resource-picker:visible .ant-segmented').getByText('资产库', { exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选用资产库资源', exact: true })
  await picker.getByRole('button', { name: '选择滚动资源0', exact: true }).waitFor()
  for (const [width, height] of [[1440, 600], [390, 640]]) {
    await page.setViewportSize({ width, height })
    await page.waitForFunction(() => { const node = document.querySelector('.object-resource-dialog'); return node && getComputedStyle(node).transform === 'none' })
    const toolbar = picker.locator('.object-resource-picker-toolbar')
    const footer = picker.locator('.ant-modal-footer')
    const before = { toolbar: await toolbar.boundingBox(), footer: await footer.boundingBox() }
    const scroller = picker.locator('.object-resource-picker-content')
    assert.ok(await scroller.evaluate(node => node.scrollHeight > node.clientHeight), 'candidate list overflows naturally')
    await scroller.evaluate(node => { node.scrollTop = node.scrollHeight })
    assert.ok(await scroller.evaluate(node => node.scrollTop > 0), 'only candidate content scrolls')
    assert.deepEqual(await toolbar.boundingBox(), before.toolbar, 'source and search stay fixed while scrolling')
    assert.deepEqual(await footer.boundingBox(), before.footer, 'confirmation stays fixed while scrolling')
    assert.ok(before.footer.y + before.footer.height <= height, 'footer stays within viewport')
    assert.ok(await picker.locator('.ant-modal-body').evaluate(node => node.scrollHeight <= node.clientHeight + 1), 'no outer body scroll')
    await page.screenshot({ path: join(output, `picker-scroll-${width}.png`), animations: 'disabled' })
    await scroller.evaluate(node => { node.scrollTop = 0 })
  }
  await page.setViewportSize({ width: 1440, height: 960 })

  await picker.getByRole('textbox', { name: '搜索资产库资源', exact: true }).fill('库中人物')
  await picker.getByRole('textbox', { name: '搜索资产库资源', exact: true }).press('Enter')
  await picker.getByRole('button', { name: '选择库中人物', exact: true }).click()
  const member = picker.getByRole('img', { name: '库中人物成员图片', exact: true }).first()
  await member.locator('..').click()
  await page.locator('.ant-image-preview-close:visible').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.ant-image-preview-close:visible').waitFor({ state: 'hidden' })
  await picker.waitFor()
  await picker.getByRole('button', { name: '导入并选用', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  const chosen = (await read()).objects.find(item => item.excerpt === '前门的阿同')
  assert.ok(chosen.asset_id && chosen.asset_id !== 'library-person')
  const copy = await request(`${studio}/entities/character/${chosen.asset_id}`)
  assert.equal(copy.project_id, project)
  assert.equal(copy.name, '库中人物')
  const copiedImages = await request(`${studio}/entities/character/${copy.id}/images`)
  assert.notEqual(copiedImages.items[0].file_id, uploaded.items[0].file_id)
  // Both exact-name origins are visible together; the project candidate stays first.
  await request(`${studio}/entities/character`, 'POST', { id: 'project-same', name: '阿同', project_id: project })
  await request(`${studio}/entities/actor`, 'POST', { id: 'library-same', name: '阿同' })
  await page.reload()
  await back.getByRole('button', { name: '选用同名', exact: true }).click()
  const same = page.getByRole('dialog', { name: '选用同名资源', exact: true })
  await same.getByRole('button', { name: '选择阿同', exact: true }).nth(1).waitFor()
  assert.equal(await same.getByRole('button', { name: '选择阿同', exact: true }).count(), 2)
  assert.ok((await same.getByRole('button', { name: '选择阿同', exact: true }).first().innerText()).includes('项目资源'))
  await same.getByRole('button', { name: '选择阿同', exact: true }).nth(1).click()
  await same.getByText('来源没有有效图片，无法导入。').waitFor()
  assert.equal(await same.getByRole('button', { name: '导入并选用', exact: true }).isDisabled(), true)
  await same.getByRole('button', { name: /取\s*消/ }).click()
  // Existing project name is not overwritten; rename the independent copy explicitly.
  await back.getByRole('button', { name: '选用', exact: true }).click()
  await page.locator('.object-resource-picker:visible .ant-segmented').getByText('资产库', { exact: true }).click()
  await picker.getByRole('button', { name: '选择库中人物', exact: true }).click()
  await picker.getByRole('button', { name: '导入并选用', exact: true }).click()
  await picker.getByRole('alert').filter({ hasText: /名称|存在/ }).waitFor()
  await picker.getByRole('textbox', { name: '副本名称', exact: true }).fill('新项目人物')
  let imports = 0
  page.on('request', req => { if (req.method() === 'POST' && req.url().endsWith('/entities/character/image-source')) imports++ })
  await page.route('**' + new URL(objectsUrl).pathname + '/*', route => route.request().method() === 'PUT' ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '暂时无法选用' }) }) : route.continue(), { times: 1 })
  await picker.getByRole('button', { name: '导入并选用', exact: true }).click()
  await picker.getByText('资源已导入，选用未完成。重试将使用已创建的副本，不会重复导入。').waitFor()
  await picker.getByRole('button', { name: '导入并选用', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  assert.equal(imports, 1)
  const second = (await read()).objects.find(item => item.excerpt === '后门的阿同')
  assert.notEqual(second.asset_id, copy.id)
  assert.equal((await request(`${studio}/entities/character/${second.asset_id}`)).name, '新项目人物')
  await request(`${studio}/entities/actor/library-person`, 'DELETE')
  assert.equal((await request(`${studio}/entities/character/${copy.id}`)).name, '库中人物')
  const copyDownload = await fetch(`${studio}/files/${copiedImages.items[0].file_id}/download`)
  assert.ok(copyDownload.ok)
  for (const [width, height] of [[1440, 900], [390, 844]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.screenshot({ path: join(output, `library-selection-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 900 })
  for (let index = 0; index < 13; index++) await request(`${studio}/entities/actor`, 'POST', { id: `library-paging-${index}`, name: `库分页${index}` })
  await front.getByRole('button', { name: '重新选用', exact: true }).click()
  await page.locator('.object-resource-picker:visible .ant-segmented').getByText('资产库', { exact: true }).click()
  await picker.getByTitle('下一页').click()
  await picker.locator('.ant-pagination-item-active').getByText('2', { exact: true }).waitFor()
  await picker.getByRole('button', { name: /^选择库分页/ }).first().waitFor()
  await picker.getByRole('button', { name: /取\s*消/ }).click()
  console.log('library import and selection passed')
} catch (error) { if (page) await page.screenshot({ path: join(output, 'failure.png') }); throw error } finally { await cleanup() }
