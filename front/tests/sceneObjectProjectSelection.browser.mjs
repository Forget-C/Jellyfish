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
const api = 'http://127.0.0.1:8298', studio = `${api}/api/v1/studio`
const project = 'canvas-project', chapter = 'object-test-chapter', excerpt = '前门的阿同拿着信封。后门的阿同等待。'
const raw = excerpt + '空镜。'
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_SCENE_OBJECTS: '1', CANVAS_BROWSER_OBJECT_CANDIDATE: '1', CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'),
    CANVAS_BROWSER_PORT: '8298' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4298, strictPort: true, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  page.setDefaultTimeout(12000)
  const management = `http://127.0.0.1:4298/projects/${project}/chapters/${chapter}/workbench-management?sequence=${sequence.id}&step=objects`
  await page.goto(management)
  await page.getByRole('navigation', { name: '制作步骤' }).waitFor()
  const extract = page.getByRole('button', { name: '提取对象', exact: true })
  await page.getByText(/^尚未提取对象/).waitFor()
  await extract.focus()
  await page.keyboard.press('Enter')
  const front = page.getByRole('region', { name: '阿同 · 前门的阿同', exact: true })
  const back = page.getByRole('region', { name: '阿同 · 后门的阿同', exact: true })
  await front.waitFor()
  await front.getByRole('button', { name: '选用', exact: true }).click()
  const picker = page.getByRole('dialog', { name: '选用项目资源', exact: true })
  await picker.waitFor()
  await picker.getByRole('button', { name: '选择已有角色', exact: true }).click()
  assert.equal((await read()).objects.find(item => item.excerpt === '前门的阿同').asset_id, null)
  await picker.getByRole('button', { name: '确认选用', exact: true }).click()
  await picker.waitFor({ state: 'hidden' })
  await front.getByRole('button', { name: '编辑阿同资源', exact: true }).waitFor()
  assert.equal((await read()).objects.find(item => item.excerpt === '前门的阿同').asset_id, 'object-browser-character')
  assert.equal(await front.locator('.management-object-body').evaluate(node => node.children.length), 3)
  assert.equal(await front.locator('.management-object-excerpt').evaluate(node => node.getBoundingClientRect().height), 20)
  await front.getByRole('button', { name: '对象更多操作', exact: true }).click()
  assert.deepEqual(await page.getByRole('menuitem').allTextContents(), ['描述与出处', '清空'])
  await page.keyboard.press('Escape')
  await front.getByRole('button', { name: '编辑阿同资源', exact: true }).click()
  const detail = page.getByRole('region', { name: '已有角色', exact: true })
  await detail.getByRole('button', { name: '返回', exact: true }).click()
  await detail.waitFor({ state: 'hidden' })
  await request(`${studio}/entities/character`, 'POST', { id: 'same-name-role', project_id: project, name: '阿同', description: '同名无图' })
  await page.reload()
  await back.getByRole('button', { name: '选用同名', exact: true }).click()
  const same = page.getByRole('dialog', { name: '选用同名项目资源', exact: true })
  await same.getByRole('button', { name: '选择阿同', exact: true }).click()
  await same.getByText('暂无图片，选用后可进入详情准备图片。').waitFor()
  await same.getByRole('button', { name: '确认选用', exact: true }).click()
  await same.waitFor({ state: 'hidden' })
  await back.getByRole('button', { name: '重新选用', exact: true }).waitFor()
  await back.getByRole('button', { name: '重新选用', exact: true }).click()
  await picker.getByRole('textbox', { name: '搜索项目资源' }).fill('没有这种对象')
  await picker.getByRole('textbox', { name: '搜索项目资源' }).press('Enter')
  await picker.getByText('未找到匹配的项目资源').waitFor()
  await picker.getByRole('textbox', { name: '搜索项目资源' }).fill('已有')
  await picker.getByRole('textbox', { name: '搜索项目资源' }).press('Enter')
  await picker.getByRole('button', { name: '选择已有角色', exact: true }).waitFor()
  await picker.getByRole('button', { name: /取\s*消/ }).click()
  assert.equal((await read()).objects.find(item => item.excerpt === '后门的阿同').asset_id, 'same-name-role')
  await back.getByRole('button', { name: '重新创建', exact: true }).click()
  const creation = page.getByRole('dialog', { name: '新建角色', exact: true })
  await creation.getByRole('textbox', { name: '名称', exact: true }).waitFor()
  assert.equal(await creation.getByRole('textbox', { name: '名称', exact: true }).inputValue(), '阿同')
  await creation.getByRole('textbox', { name: '名称', exact: true }).fill('新建阿同')
  await creation.getByRole('button', { name: '保存设定', exact: true }).click()
  await page.getByRole('dialog', { name: '新建阿同', exact: true }).waitFor()
  await page.getByRole('dialog', { name: '新建阿同', exact: true }).getByRole('button', { name: '返回', exact: true }).click()
  await back.getByRole('button', { name: '编辑阿同资源', exact: true }).waitFor()
  const replaced = (await read()).objects.find(item => item.excerpt === '后门的阿同')
  assert.notEqual(replaced.asset_id, 'same-name-role')
  assert.equal((await request(`${studio}/entities/character/same-name-role`)).name, '阿同')
  for (const [width, height] of [[1440, 900], [390, 844], [280, 760]]) {
    await page.setViewportSize({ width, height })
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.equal(await back.locator('.management-object-excerpt').evaluate(node => node.getBoundingClientRect().height), 20)
    await page.screenshot({ path: join(output, `project-selection-${width}.png`), animations: 'disabled' })
  }
  await page.setViewportSize({ width: 1440, height: 960 })
  for (let index = 0; index < 13; index++) await request(`${studio}/entities/character`, 'POST', { id: `paging-${index}`, project_id: project, name: `分页对象${index}` })
  await front.getByRole('button', { name: '重新选用', exact: true }).click()
  await picker.getByTitle('下一页').click()
  await picker.locator('.ant-pagination-item-active').getByText('2', { exact: true }).waitFor()
  await picker.getByRole('button', { name: /^选择分页对象/ }).first().waitFor()
  await picker.getByRole('button', { name: /取\s*消/ }).click()
  console.log('project object card selection passed')
} catch (error) { if (page) await page.screenshot({ path: join(output, 'failure.png') }); throw error } finally { await cleanup() }
