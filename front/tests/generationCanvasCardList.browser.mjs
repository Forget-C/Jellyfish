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
const api = 'http://127.0.0.1:8477'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8477' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4477, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(8000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const chapterRequests = []
  page.on('request', request => { if (/chapters/.test(request.url())) chapterRequests.push(request.url()) })
  await page.goto('http://127.0.0.1:4477/projects/canvas-project/generation-canvas')
  await page.getByRole('button', { name: '画布管理', exact: true }).click()
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  await page.waitForURL(/canvas=/)
  const id = new URL(page.url()).searchParams.get('canvas')
  const list = page.getByRole('navigation', { name: '添加卡片', exact: true })
  const categories = page.getByRole('toolbar', { name: '卡片分类', exact: true })
  await categories.waitFor()
  assert.equal(await categories.getByRole('button').count(), 8)
  assert.equal(await list.isVisible(), false)
  const before = await page.locator('.generation-world').evaluate(node => node.style.transform)
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  await list.getByRole('heading', { name: '基础卡', exact: true }).waitFor()
  const catalog = (await (await fetch(`${base}/${id}/catalog`)).json()).data
  const represented = new Set()
  for (const name of ['基础卡', '参考卡', '模型生成', '画面设计', '表演与调度', '叙事与镜头', '声音设计', '连续性与约束']) {
    if (name !== '基础卡') await categories.getByRole('button', { name, exact: true }).click()
    for (const text of await list.getByRole('button').allTextContents()) represented.add(text)
  }
  assert.equal(represented.size, 40, '39 entries plus close control cover the complete catalog')
  assert.equal(catalog.cards.length, 35)
  await page.getByRole('searchbox', { name: '搜索卡片' }).fill('不存在的卡片')
  await list.getByText('没有匹配的卡片').waitFor()
  await page.screenshot({ path: join(output, 'two-level-empty.png') })
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  assert.equal(await page.getByRole('searchbox', { name: '搜索卡片' }).inputValue(), '')
  await page.getByRole('searchbox', { name: '搜索卡片' }).fill('文本')
  await list.getByRole('button', { name: '添加文本卡', exact: true }).click()
  assert.equal(await list.isVisible(), false)
  await page.getByRole('complementary').getByRole('textbox', { name: '文本内容', exact: true }).fill('点击添加的正文')
  assert.equal(await page.locator('.generation-world').evaluate(node => node.style.transform), before)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await delay(1600)
  let doc = (await (await fetch(`${base}/${id}`)).json()).data.document
  assert.equal(doc.cards[0].text, '点击添加的正文')
  assert.equal((doc.edges || []).length, 0)
  await categories.getByRole('button', { name: '画面设计', exact: true }).click()
  await page.screenshot({ path: join(output, 'two-level-desktop.png') })
  await list.getByRole('button', { name: '添加运镜', exact: true }).click()
  await page.getByRole('complementary').getByRole('button', { name: '编辑运镜', exact: true }).waitFor()
  assert.equal(await page.getByRole('complementary').getByRole('button', { name: '编辑运镜', exact: true }).getAttribute('aria-pressed'), 'true')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await categories.getByRole('button', { name: '画面设计', exact: true }).click()
  await list.getByRole('button', { name: '添加景别与构图', exact: true }).click()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await delay(1600)
  doc = (await (await fetch(`${base}/${id}`)).json()).data.document
  assert.equal(doc.cards.filter(card => card.type === 'direction.photography').length, 2)
  assert.equal(new Set(doc.cards.map(card => card.id)).size, 3)
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索卡片' }).fill('图片')
  const surface = page.getByLabel('生成画布视口')
  await list.getByRole('button', { name: '添加图片卡', exact: true }).dragTo(surface, { targetPosition: { x: 1000, y: 450 } })
  await page.getByRole('complementary', { name: '图片内容卡', exact: true }).waitFor()
  assert.equal(await list.isVisible(), false)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await delay(1600)
  doc = (await (await fetch(`${base}/${id}`)).json()).data.document
  assert.equal(doc.cards.length, 4)
  const dropped = await page.locator(`[data-card-id="${doc.cards[3].id}"]`).boundingBox()
  assert.ok(Math.abs(dropped.x - 1000) < 3 && Math.abs(dropped.y - 450) < 3)
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  await list.getByRole('button', { name: '添加图片卡', exact: true }).dragTo(page.getByRole('button', { name: '画布管理', exact: true }))
  assert.equal((await (await fetch(`${base}/${id}`)).json()).data.document.cards.length, 4)
  await page.keyboard.press('Escape')
  assert.equal(await list.isVisible(), false)
  assert.equal(await categories.getByRole('button', { name: '基础卡', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.reload()
  await categories.waitFor()
  assert.equal((await (await fetch(`${base}/${id}`)).json()).data.document.cards[0].text, '点击添加的正文')
  await page.setViewportSize({ width: 390, height: 844 })
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const panel = await list.boundingBox()
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0 && panel.y + panel.height <= 844)
  await page.screenshot({ path: join(output, 'two-level-mobile.png') })
  const other = await page.context().newPage()
  await other.goto(page.url())
  await other.getByText('此画布当前只读', { exact: true }).waitFor()
  await other.getByRole('button', { name: '基础卡', exact: true }).click()
  assert.equal(await other.getByRole('navigation', { name: '添加卡片' }).getByRole('button', { name: '添加文本卡', exact: true }).isDisabled(), true)
  await other.getByRole('status').filter({ hasText: '当前只读，不能添加卡片' }).waitFor()
  await other.close()
  console.log('card list search, explicit addition, save/reopen and responsive panel verified')
} finally { await cleanup() }
