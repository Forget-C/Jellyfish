import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath } from './storyboard-canvas-fixture.mjs'
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
const base = `${api}/api/v1/studio/generation-canvases`
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
  const canvas = await createStoryboardCanvas(base, '卡片分类')
  const id = canvas.id
  await page.goto(`http://127.0.0.1:4477${storyboardCanvasPath(canvas)}`)
  const list = page.getByRole('navigation', { name: '添加卡片', exact: true })
  const categories = page.getByRole('toolbar', { name: '卡片分类', exact: true })
  const assertAlignedEntries = async () => {
    const entries = await list.locator('button[draggable]').evaluateAll(buttons => buttons.map(button => ({
      icon: button.querySelector('.ant-btn-icon').getBoundingClientRect().left,
      label: button.lastElementChild.getBoundingClientRect().left,
    })))
    assert.ok(entries.length > 1)
    for (const { icon, label } of entries) {
      assert.ok(Math.abs(icon - entries[0].icon) < 1, 'card icons share a left edge')
      assert.ok(Math.abs(label - entries[0].label) < 1, 'card names share a left edge')
    }
  }
  await categories.waitFor()
  assert.equal(await categories.getByRole('button').count(), 9)
  assert.equal(await list.isVisible(), false)
  const before = await page.locator('.generation-world').evaluate(node => node.style.transform)
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  await list.getByRole('heading', { name: '基础卡', exact: true }).waitFor()
  await page.screenshot({ path: join(output, 'basic-card-menu-desktop.png') })
  await assertAlignedEntries()
  const catalog = (await (await fetch(storyboardCanvasApi(base, id, `/catalog`))).json()).data
  const represented = new Set()
  const menuWidths = []
  for (const name of ['基础卡', '参考卡', '模型生成', '画面设计', '表演与调度', '叙事与镜头', '声音设计', '连续性与约束', '检查']) {
    if (name !== '基础卡') await categories.getByRole('button', { name, exact: true }).click()
    menuWidths.push((await list.boundingBox()).width)
    assert.ok(await list.locator('button[draggable]').evaluateAll(buttons => buttons.every(button => button.scrollWidth <= button.clientWidth)), 'menu fits complete option labels')
    for (const text of await list.getByRole('button').allTextContents()) represented.add(text)
  }
  assert.equal(represented.size, catalog.cards.reduce((count, card) => count + (card.entries.length || 1), 1), 'catalog entries and the close control cover the complete menu')
  assert.ok(menuWidths.every(width => width < 280), `menus shrink from their previous fixed width: ${menuWidths}`)
  assert.ok([...represented].every(title => !title.startsWith('添加')), 'card creation options show names without the add prefix')
  for (const kind of ['character', 'place', 'prop', 'costume']) assert.ok(catalog.cards.some(card => card.type === 'content.' + kind))
  await page.getByRole('searchbox', { name: '搜索卡片' }).fill('不存在的卡片')
  await list.getByText('没有匹配的卡片').waitFor()
  await page.screenshot({ path: join(output, 'two-level-empty.png') })
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  assert.equal(await page.getByRole('searchbox', { name: '搜索卡片' }).inputValue(), '')
  await page.getByRole('searchbox', { name: '搜索卡片' }).fill('文本')
  await list.getByRole('button', { name: '文本卡', exact: true }).click()
  assert.equal(await list.isVisible(), false)
  await page.locator('.wb-details:visible').getByRole('textbox', { name: '文本内容', exact: true }).fill('点击添加的正文')
  assert.equal(await page.locator('.generation-world').evaluate(node => node.style.transform), before)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await delay(1600)
  let doc = (await (await fetch(storyboardCanvasApi(base, id))).json()).data.document
  assert.equal(doc.cards.find(card => card.type === 'content.text').text, '点击添加的正文')
  assert.equal((doc.edges || []).length, 0)
  await categories.getByRole('button', { name: '画面设计', exact: true }).click()
  await page.screenshot({ path: join(output, 'two-level-desktop.png') })
  await list.getByRole('button', { name: '运镜卡', exact: true }).click()
  await page.locator('[data-card-id][data-selected="true"]').press('Enter')
  await page.locator('.wb-details:visible').getByRole('button', { name: '高级设置', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await categories.getByRole('button', { name: '画面设计', exact: true }).click()
  await list.getByRole('button', { name: '景别与构图卡', exact: true }).click()
  await page.locator('[data-card-id][data-selected="true"]').press('Enter')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await delay(1600)
  doc = (await (await fetch(storyboardCanvasApi(base, id))).json()).data.document
  assert.ok(doc.cards.some(card => card.type === 'direction.movement'))
  assert.ok(doc.cards.some(card => card.type === 'direction.composition'))
  assert.equal(new Set(doc.cards.map(card => card.id)).size, 4)
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  await page.getByRole('searchbox', { name: '搜索卡片' }).fill('图片')
  const surface = page.getByLabel('生成画布视口')
  const dropView=await page.locator('.generation-world').evaluate(node=>{const m=new DOMMatrix(getComputedStyle(node).transform);return {x:m.e,y:m.f,scale:m.a}})
  await list.getByRole('button', { name: '图片卡', exact: true }).dragTo(surface, { targetPosition: { x: 1000, y: 450 } })
  await page.locator('.wb-details:visible').filter({hasText:'图片内容卡'}).waitFor()
  assert.equal(await list.isVisible(), false)
  await delay(220)
  const revealedEditor=await page.locator('.wb-details:visible').boundingBox()
  assert.ok(revealedEditor.x>=16 && revealedEditor.x+revealedEditor.width<=1440-16,'new card editor is revealed inside viewport')
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await delay(1600)
  doc = (await (await fetch(storyboardCanvasApi(base, id))).json()).data.document
  assert.equal(doc.cards.length, 5)
  const dropped = await page.locator(`[data-card-id="${doc.cards.find(card => card.type === 'content.image').id}"]`).evaluate(node=>({x:parseFloat(node.style.left),y:parseFloat(node.style.top)}))
  assert.ok(Math.abs(dropped.x*dropView.scale+dropView.x-1000)<3 && Math.abs(dropped.y*dropView.scale+dropView.y-450)<3,'drop world position matches the pointer before editor reveal')
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  await list.getByRole('button', { name: '图片卡', exact: true }).dragTo(page.getByRole('button', { name: '返回工作台管理', exact: true }))
  assert.equal((await (await fetch(storyboardCanvasApi(base, id))).json()).data.document.cards.length, 5)
  await page.keyboard.press('Escape')
  assert.equal(await list.isVisible(), false)
  assert.equal(await categories.getByRole('button', { name: '基础卡', exact: true }).evaluate(el => el === document.activeElement), true)
  await page.reload()
  await categories.waitFor()
  assert.equal((await (await fetch(storyboardCanvasApi(base, id))).json()).data.document.cards.find(card => card.type === 'content.text').text, '点击添加的正文')
  await page.setViewportSize({ width: 390, height: 844 })
  await categories.getByRole('button', { name: '基础卡', exact: true }).click()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const panel = await list.boundingBox()
  assert.ok(panel.x >= 0 && panel.x + panel.width <= 390 && panel.y >= 0 && panel.y + panel.height <= 844)
  await assertAlignedEntries()
  await page.screenshot({ path: join(output, 'two-level-mobile.png') })
  const other = await page.context().newPage()
  await other.goto(page.url())
  await other.getByText('此画布当前只读', { exact: true }).waitFor()
  await other.getByRole('button', { name: '基础卡', exact: true }).click()
  assert.equal(await other.getByRole('navigation', { name: '添加卡片' }).getByRole('button', { name: '文本卡', exact: true }).isDisabled(), true)
  await other.getByRole('status').filter({ hasText: '当前只读，不能添加卡片' }).waitFor()
  await other.close()
  console.log('card list search, explicit addition, save/reopen and responsive panel verified')
} finally { await cleanup() }
