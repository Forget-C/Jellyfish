import { openCanvasManagement, openCardList, openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'

const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-')
const api = 'http://127.0.0.1:8271'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8271' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch { /* waiting for isolated server */ }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4271, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const chapterRequests = []
  page.on('request', request => { if (/chapters/.test(request.url())) chapterRequests.push(request.url()) })
  await page.goto('http://127.0.0.1:4271/projects/canvas-project/generation-canvas')
  await openCanvasManagement(page)
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  assert.equal(chapterRequests.length, 0, 'standalone canvas must not load chapters')
  assert.equal(await page.locator('.app-shell').count(), 0, 'standalone canvas hides global shell')
  const surface = await page.getByLabel('生成画布视口').boundingBox()
  assert.ok(surface.height >= 780, 'canvas uses remaining viewport instead of a fixed embedded height')
  const name = page.getByRole('textbox', { name: '画布名称' })
  await openCanvasManagement(page)
  await name.fill('第一张独立画布')
  await openCardList(page)
  await page.getByRole('button', { name: '文本卡' }).click()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('刷新后仍然存在的正文')
  const viewportBefore = await page.getByLabel('生成画布视口').boundingBox()
  await page.getByRole('button', { name: '展开详情', exact: true }).click()
  assert.deepEqual(await page.getByLabel('生成画布视口').boundingBox(), viewportBefore, 'expanding details does not move canvas')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.locator('[data-card-id]').first().press('Enter')
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '刷新后仍然存在的正文')
  await page.getByRole('button', { name: '撤销操作', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '')
  await page.getByRole('button', { name: '重做操作', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '刷新后仍然存在的正文')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const firstId = new URL(page.url()).searchParams.get('canvas')
  const first = (await (await fetch(`${base}/${firstId}`)).json()).data
  assert.equal(first.revision, 1)
  assert.equal(first.document.cards[0].text, '刷新后仍然存在的正文')
  await openCanvasManagement(page)
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]')?.value === '未命名画布')
  await openCanvasManagement(page)
  await name.fill('第二张独立画布')
  await openCardList(page)
  await page.getByRole('button', { name: '文本卡' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const secondId = new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(firstId, secondId)
  await openCanvasManagement(page)
  await page.getByRole('combobox', { name: '选择画布' }).press('ArrowDown')
  await page.getByText('第一张独立画布', { exact: true }).last().click()
  await openCanvasCard(page, first.document.cards[0].id)
  await page.reload()
  await openCanvasManagement(page)
  await name.waitFor()
  assert.equal(await name.inputValue(), '第一张独立画布')
  await name.press('Escape')
  await openCanvasCard(page, first.document.cards[0].id)
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '刷新后仍然存在的正文')
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const second = (await (await fetch(`${base}/${secondId}`)).json()).data
  assert.equal(second.document.cards[0].text, '')
  assert.equal(second.document.name, '第二张独立画布')
  await page.getByRole('button', { name: '布局', exact: true }).click()
  await page.getByRole('button', { name: '展开小地图', exact: true }).click()
  await page.getByLabel('小地图导航').waitFor()
  await page.getByRole('button', { name: '收起小地图', exact: true }).click()
  await page.getByRole('button', { name: '布局', exact: true }).click()
  await page.screenshot({ path: join(output, 'generation-canvas.png'), fullPage: true, animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('dialog', { name: '文本内容卡', exact: true }).waitFor()
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'narrow page has no horizontal overflow')
  await page.screenshot({ path: join(output, 'generation-canvas-narrow.png'), fullPage: true })
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '返回项目', exact: true }).waitFor()
  const legacy = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await legacy.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await legacy.goto(`http://127.0.0.1:4271/projects/canvas-project?tab=generation&canvas=${firstId}&run=history-location&node=history-node`)
  await openCanvasManagement(legacy)
  await legacy.getByRole('textbox', { name: '画布名称' }).waitFor()
  const migrated = new URL(legacy.url())
  assert.equal(migrated.pathname, '/projects/canvas-project/generation-canvas')
  assert.equal(migrated.searchParams.get('canvas'), firstId)
  assert.equal(migrated.searchParams.get('run'), 'history-location')
  assert.equal(migrated.searchParams.get('node'), 'history-node')
  await legacy.close()
  await page.setViewportSize({ width: 1440, height: 960 })
  await openCardList(page, '模型生成')
  await page.getByRole('button', { name: '文本模型卡', exact: true }).click()
  await page.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor()
  await page.getByRole('button', { name: '定位问题', exact: true }).first().click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('complementary', { name: '文本模型卡', exact: true }).waitFor()
  console.log('new → edit → save → second canvas → switch → refresh: persistent content and revision verified')
} finally { await cleanup() }
