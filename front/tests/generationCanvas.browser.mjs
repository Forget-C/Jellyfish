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
  await page.goto('http://127.0.0.1:4271/projects/canvas-project?tab=generation')
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  const name = page.getByRole('textbox', { name: '画布名称' })
  await name.fill('第一张独立画布')
  await page.getByRole('button', { name: '添加文本卡' }).click()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('刷新后仍然存在的正文')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: 'revision 1 · 已保存' }).waitFor()
  const firstId = new URL(page.url()).searchParams.get('canvas')
  const first = (await (await fetch(`${base}/${firstId}`)).json()).data
  assert.equal(first.revision, 1)
  assert.equal(first.document.cards[0].text, '刷新后仍然存在的正文')
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]')?.value === '未命名画布')
  await name.fill('第二张独立画布')
  await page.getByRole('button', { name: '添加文本卡' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: 'revision 1 · 已保存' }).waitFor()
  const secondId = new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(firstId, secondId)
  await page.getByRole('combobox', { name: '选择画布' }).press('ArrowDown')
  await page.getByText('第一张独立画布', { exact: true }).last().click()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).waitFor()
  await page.reload()
  await name.waitFor()
  assert.equal(await name.inputValue(), '第一张独立画布')
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '刷新后仍然存在的正文')
  await page.getByRole('status').filter({ hasText: 'revision 1' }).waitFor()
  const second = (await (await fetch(`${base}/${secondId}`)).json()).data
  assert.equal(second.document.cards[0].text, '')
  assert.equal(second.document.name, '第二张独立画布')
  await page.screenshot({ path: join(output, 'generation-canvas.png'), fullPage: true })
  console.log('new → edit → save → second canvas → switch → refresh: persistent content and revision verified')
} finally { await cleanup() }
