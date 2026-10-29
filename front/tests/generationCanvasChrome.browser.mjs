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
const api = 'http://127.0.0.1:8420'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8420' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4420, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const chapterRequests = []
  page.on('request', request => { if (/chapters/.test(request.url())) chapterRequests.push(request.url()) })
  await page.goto('http://127.0.0.1:4420/projects/canvas-project/generation-canvas')
  await page.getByRole('button', { name: '画布管理', exact: true }).click()
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  await page.getByRole('button', { name: '画布管理', exact: true }).click()
  await page.getByRole('textbox', { name: '画布名称' }).fill('菜单中的画布')
  await page.getByRole('textbox', { name: '画布名称' }).press('Escape')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByLabel('画布保存状态').filter({ hasText: '已保存' }).waitFor()
  const id = new URL(page.url()).searchParams.get('canvas')
  assert.equal((await (await fetch(`${base}/${id}`)).json()).data.document.name, '菜单中的画布')
  assert.equal(await page.getByRole('button', { name: '后退', exact: true }).isDisabled(), true)
  assert.equal(await page.getByRole('button', { name: '前进', exact: true }).isDisabled(), true)
  const surface = await page.getByLabel('生成画布视口').boundingBox()
  assert.ok(surface.y <= 1 && surface.height >= 959, 'canvas fills viewport under floating toolbar')
  await page.getByRole('button', { name: '运行历史', exact: true }).click()
  await page.getByRole('complementary', { name: '运行历史', exact: true }).waitFor()
  assert.deepEqual(await page.getByLabel('生成画布视口').boundingBox(), surface)
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.getByRole('button', { name: '添加文本模型卡', exact: true }).click()
  await page.getByRole('button', { name: '预检运行', exact: true }).click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor()
  await page.getByRole('button', { name: '定位问题', exact: true }).first().click()
  await page.getByRole('dialog', { name: '运行预检', exact: true }).waitFor({ state: 'hidden' })
  await page.getByRole('complementary', { name: '文本模型卡', exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.screenshot({ path: join(output, 'chrome-desktop.png'), animations: 'disabled' })
  await page.reload()
  await page.getByRole('button', { name: '画布管理', exact: true }).click()
  assert.equal(await page.getByRole('textbox', { name: '画布名称' }).inputValue(), '菜单中的画布')
  await page.getByRole('textbox', { name: '画布名称' }).press('Escape')
  if (await page.getByRole('button', { name: '关闭详情', exact: true }).isVisible()) await page.getByRole('button', { name: '关闭详情', exact: true }).click()
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '画布管理', exact: true }).click()
  await page.getByRole('textbox', { name: '画布名称' }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: join(output, 'chrome-mobile.png'), animations: 'disabled' })
  console.log('floating chrome management, save/reopen, history and responsive layout verified')
} finally { await cleanup() }
