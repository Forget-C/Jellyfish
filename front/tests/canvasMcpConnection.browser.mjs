import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'
import { createServer } from 'vite'
import { browserCleanup, browserOutput, captureBackend } from './browser-runtime.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-canvas-mcp-')
const api = 'http://127.0.0.1:8470'
const origin = 'http://127.0.0.1:4470'
const python = process.env.CANVAS_TEST_PYTHON || 'uv'
const pythonArgs = process.env.CANVAS_TEST_PYTHON ? [] : ['run', '--no-sync', 'python']
const cwd = join(root, '../backend')
const database = join(output, 'browser.sqlite')
const backend = spawn(python, [...pythonArgs, '-m', 'tests.generation_canvas_browser_server'], {
  cwd,
  env: { ...process.env, DATABASE_URL: 'sqlite+aiosqlite:///' + database, CORS_ORIGINS: origin,
    CANVAS_BROWSER_DATABASE: database, CANVAS_BROWSER_PORT: '8470' },
  stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))

try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited: ' + output)
    try { if ((await fetch(api + '/health')).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  const created = await fetch(api + '/api/v1/studio/generation-canvases', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '测试画布' }),
  })
  assert.ok(created.ok, await created.text())
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: {
    host: '127.0.0.1', port: 4470, strictPort: true, open: false,
  } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ locale: 'zh-CN' })
  page.setDefaultTimeout(12000)
  await page.addInitScript(backendUrl => { window.__ENV = { BACKEND_URL: backendUrl } }, api)
  await page.goto(origin + '/settings')
  await page.getByRole('button', { name: '开启 MCP 连接', exact: true }).click()
  const address = page.getByRole('textbox', { name: 'MCP 服务地址' })
  await address.waitFor()
  const url = await address.inputValue()
  const credential = await page.getByRole('textbox', { name: 'MCP 临时凭据' }).inputValue()
  assert.equal(url, api + '/mcp')
  const client = spawn(python, [...pythonArgs, '-m', 'tests.canvas_mcp_browser_client'], {
    cwd, stdio: ['pipe', 'inherit', 'inherit'],
  })
  client.stdin.end(JSON.stringify({ credential, url }))
  assert.deepEqual(await once(client, 'exit'), [0, null])
  await page.reload()
  assert.equal(await page.getByRole('textbox', { name: 'MCP 临时凭据' }).count(), 0)
  await page.getByRole('button', { name: '关闭 MCP 连接', exact: true }).click()
  await page.getByRole('button', { name: '开启 MCP 连接', exact: true }).waitFor()
  const denied = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer ' + credential } })
  assert.equal(denied.status, 401)
} finally {
  await cleanup()
}
