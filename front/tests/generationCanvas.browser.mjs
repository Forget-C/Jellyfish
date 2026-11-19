import { openCanvasSettings, renameFreeCanvas, openCardList, openCanvasCard, selectCanvasByName } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const base = `${api}/api/v1/studio/generation-canvases`
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
  await page.goto('http://127.0.0.1:4271/canvases')

  await page.getByRole('button', { name: /新建画布/ }).click()
  await page.waitForURL(/\/canvases\/[^/]+$/)
  assert.equal(chapterRequests.length, 0, 'standalone canvas must not load chapters')
  assert.equal(await page.locator('.app-shell').count(), 0, 'standalone canvas hides global shell')
  const surface = await page.getByLabel('生成画布视口').boundingBox()
  assert.ok(surface.height >= 780, 'canvas uses remaining viewport instead of a fixed embedded height')
  const name = page.getByRole('textbox', { name: '画布名称' })

  assert.equal(await name.count(), 0, 'name is edited only through settings')
  await renameFreeCanvas(page, '第一张独立画布')
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
  const firstId = new URL(page.url()).pathname.split('/').at(-1)
  const first = (await (await fetch(`${base}/${firstId}`)).json()).data
  assert.equal(first.revision, 2)
  assert.equal(first.document.cards[0].text, '刷新后仍然存在的正文')

  const more = page.getByRole('button', { name: '更多操作', exact: true })
  let coverSettings = await openCanvasSettings(page)
  await coverSettings.getByRole('textbox', { name: '画布名称' }).fill('取消的名称')
  await coverSettings.getByRole('button', { name: '取消', exact: true }).click()
  await coverSettings.waitFor({ state: 'hidden' })
  await more.and(page.locator(':focus')).waitFor()
  assert.equal((await (await fetch(`${base}/${firstId}`)).json()).data.document.name, '第一张独立画布')

  coverSettings = await openCanvasSettings(page)
  await coverSettings.getByRole('textbox', { name: '画布名称' }).fill('第一张独立画布带封面')
  const coverBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGMwCFgAAAHUASELh2rEAAAAAElFTkSuQmCC', 'base64')
  await coverSettings.getByLabel('上传画布封面').setInputFiles({ name: '浏览器封面.png', mimeType: 'image/png', buffer: coverBytes })
  await coverSettings.getByRole('img', { name: '画布封面预览' }).waitFor()
  await coverSettings.getByRole('button', { name: '保存设置' }).click({ trial: true })
  await page.screenshot({ path: join(output, 'canvas-settings-desktop.png'), animations: 'disabled' })
  const saves = []
  let uploads = 0
  const countUploads = request => { if (new URL(request.url()).pathname.endsWith('/files/upload')) uploads++ }
  page.on('request', countUploads)
  const ownCanvas = url => url.pathname === `/api/v1/studio/generation-canvases/${firstId}`
  await page.route(ownCanvas, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    saves.push(route.request().postDataJSON())
    if (saves.length === 1) return route.fulfill({ status: 422, json: { code: 422, message: '封面保存失败，请重试' } })
    return route.continue()
  })
  assert.equal(uploads, 0, 'clicking save triggers upload')
  await coverSettings.getByRole('button', { name: '保存设置' }).click()
  await coverSettings.getByRole('alert').filter({ hasText: '封面保存失败，请重试' }).waitFor()
  assert.equal((await (await fetch(`${base}/${firstId}`)).json()).data.document.name, '第一张独立画布')
  assert.equal(await coverSettings.getByRole('textbox', { name: '画布名称' }).inputValue(), '第一张独立画布带封面')
  await coverSettings.getByRole('button', { name: '保存设置' }).click()
  await coverSettings.waitFor({ state: 'hidden' })
  await page.unroute(ownCanvas)
  page.off('request', countUploads)
  assert.equal(uploads, 1, 'rejected save reuses the upload')
  assert.equal(saves.length, 2)
  assert.equal(saves[1].document.cover_file_id, saves[0].document.cover_file_id)
  assert.equal(saves[1].document.cards[0].text, '刷新后仍然存在的正文')
  const coverId = saves[1].document.cover_file_id
  const recent = (await (await fetch(`${api}/api/v1/studio/home/recent-canvases`)).json()).data
  assert.equal(recent.find(canvas => canvas.id === firstId)?.cover_file_id, coverId)
  const filePath = `${api}/api/v1/studio/files/${coverId}`
  assert.equal((await fetch(filePath, { method: 'DELETE' })).status, 409)
  await page.getByRole('button', { name: '返回画布列表', exact: true }).click()
  const firstCard = page.getByRole('article').filter({ hasText: '第一张独立画布带封面' })
  assert.match(await firstCard.locator('img').getAttribute('src'), new RegExp(coverId))
  await firstCard.getByRole('link', { name: '第一张独立画布带封面' }).click()
  await page.setViewportSize({ width: 390, height: 700 })
  coverSettings = await openCanvasSettings(page)
  await coverSettings.getByRole('button', { name: '恢复默认', exact: true }).click()
  await coverSettings.getByText('默认封面', { exact: true }).waitFor()
  await coverSettings.getByRole('button', { name: '保存设置' }).click()
  await coverSettings.waitFor({ state: 'hidden' })
  coverSettings = await openCanvasSettings(page)
  await coverSettings.getByRole('button', { name: '从文件管理选择', exact: true }).click()
  const library = page.getByRole('dialog', { name: '从文件管理选择图片' })
  await library.getByRole('textbox', { name: '搜索图片' }).and(page.locator(':focus')).waitFor()
  await page.keyboard.press('Escape')
  const chooseLibrary = coverSettings.getByRole('button', { name: '从文件管理选择', exact: true })
  await chooseLibrary.and(page.locator(':focus')).waitFor()
  await chooseLibrary.click()
  await library.getByRole('button', { name: '浏览器封面', exact: true }).click()
  assert.match(await coverSettings.getByRole('img', { name: '画布封面预览' }).getAttribute('src'), new RegExp(coverId))
  const modal = await coverSettings.boundingBox()
  assert.ok(modal.x >= 0 && modal.x + modal.width <= 390)
  await page.screenshot({ path: join(output, 'canvas-settings-narrow.png'), animations: 'disabled' })
  await coverSettings.getByRole('button', { name: '保存设置' }).click()
  await coverSettings.waitFor({ state: 'hidden' })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.setViewportSize({ width: 1440, height: 960 })


  await page.getByRole('button', { name: '返回画布列表', exact: true }).click()
  await page.getByRole('button', { name: /新建画布/ }).click()
  await page.waitForURL(/\/canvases\/[^/]+$/)
  await page.locator('.canvas-sequence-name').filter({ hasText: '未命名画布' }).waitFor()
  await renameFreeCanvas(page, '第二张独立画布')
  await openCardList(page)
  await page.getByRole('button', { name: '文本卡' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  const secondId = new URL(page.url()).pathname.split('/').at(-1)
  assert.notEqual(firstId, secondId)

  await selectCanvasByName(page, '第一张独立画布带封面')
  await openCanvasCard(page, first.document.cards[0].id)
  await page.reload()

  const settings = await openCanvasSettings(page)
  assert.equal(await name.inputValue(), '第一张独立画布带封面')
  await settings.getByRole('button', { name: /取\s*消/ }).click()
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
  await page.getByRole('button', { name: '返回画布列表', exact: true }).waitFor()
  await page.setViewportSize({ width: 1440, height: 960 })
  await openCardList(page, '模型生成')
  await page.getByRole('button', { name: '文本模型卡', exact: true }).click()
  await page.getByRole('textbox', { name: '模型正文', exact: true }).fill('验证未选择模型的预检定位')
  await page.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor()
  await page.getByRole('button', { name: '定位问题', exact: true }).first().click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('complementary', { name: '文本模型卡', exact: true }).waitFor()
  const recoverable = (await (await fetch(base, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '设置恢复基线' }),
  })).json()).data
  const recoverPath = `${base}/${recoverable.id}`
  await page.goto(`http://127.0.0.1:4271/canvases/${recoverable.id}`)
  const recoverRoute = url => url.pathname.endsWith('/' + recoverable.id)
  const attempts = []
  await page.route(recoverRoute, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    attempts.push(route.request().postDataJSON().request_id)
    if (attempts.length === 1) return route.abort('failed')
    return route.continue()
  })
  let recovering = await openCanvasSettings(page)
  await recovering.getByRole('textbox', { name: '画布名称' }).fill('冲突后恢复的名称')
  await recovering.getByRole('button', { name: '保存设置' }).click()
  await recovering.getByRole('button', { name: '核实保存结果' }).waitFor()
  const external = await fetch(recoverPath, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: recoverable.revision,
      document: { ...recoverable.document, name: '外部更新的名称',
        cards: [{ id: 'external', type: 'content.text', text: '来自另一会话' }] } }),
  })
  assert.equal(external.status, 200, await external.text())
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复本地内容' }).click()
  recovering = page.getByRole('dialog', { name: '画布设置', exact: true })
  assert.equal(await recovering.getByRole('textbox', { name: '画布名称' }).inputValue(), '冲突后恢复的名称')
  await recovering.getByRole('button', { name: '保存设置' }).click()
  await recovering.waitFor({ state: 'hidden' })
  assert.equal(attempts[1], attempts[0], 'refresh replays the original settings command')
  assert.notEqual(attempts[2], attempts[1], 'resolved conflict uses a fresh command')
  const recoveredDocument = (await (await fetch(recoverPath)).json()).data.document
  assert.equal(recoveredDocument.name, '冲突后恢复的名称')
  assert.equal(recoveredDocument.cards[0].text, '来自另一会话', 'settings-only recovery keeps new server content')
  await page.unroute(recoverRoute)
  console.log('new → edit → save → second canvas → switch → refresh: persistent content and revision verified')
} finally { await cleanup() }
