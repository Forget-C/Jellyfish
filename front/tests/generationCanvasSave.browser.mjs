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
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await page.goto('http://127.0.0.1:4271/projects/canvas-project?tab=generation')
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  const name = page.getByRole('textbox', { name: '画布名称' })
  await name.fill('第一张独立画布 A')
  await page.getByRole('button', { name: '添加文本卡' }).click()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('快照 A')
  // The editor remains usable while snapshot A is in flight; response A cannot erase B.
  let releaseSave
  const saveGate = new Promise(resolve => { releaseSave = resolve })
  await page.route('**/generation-canvases/canvas-project/*', async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    await saveGate
    await route.continue()
  })
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('textbox', { name: '画布名称' }).fill('第一张独立画布 B')
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('保存中继续输入 B')
  releaseSave()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.unroute('**/generation-canvases/canvas-project/*')
  await page.getByRole('status').filter({ hasText: 'revision 2 · 已保存' }).waitFor()
  const firstId = new URL(page.url()).searchParams.get('canvas')
  const first = (await (await fetch(`${base}/${firstId}`)).json()).data
  assert.equal(first.revision, 2)
  assert.equal(first.document.cards[0].text, '保存中继续输入 B')
  await page.getByRole('button', { name: '新建画布', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]')?.value === '未命名画布')
  await name.fill('第二张独立画布')
  await page.getByRole('button', { name: '添加文本卡' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: 'revision 1 · 已保存' }).waitFor()
  const secondId = new URL(page.url()).searchParams.get('canvas')
  assert.notEqual(firstId, secondId)
  await page.getByRole('combobox', { name: '选择画布' }).press('ArrowDown')
  await page.getByText('第一张独立画布 B', { exact: true }).last().click()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).waitFor()
  await page.reload()
  await name.waitFor()
  assert.equal(await name.inputValue(), '第一张独立画布 B')
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '保存中继续输入 B')
  await page.getByRole('status').filter({ hasText: 'revision 2' }).waitFor()
  const second = (await (await fetch(`${base}/${secondId}`)).json()).data
  assert.equal(second.document.cards[0].text, '')
  assert.equal(second.document.name, '第二张独立画布')
  // Unknown reply: the server committed A, the client kept B and the original request.
  let unknownRequest
  await page.route(`**/generation-canvases/canvas-project/${firstId}`, async route => {
    if (route.request().method() !== 'PUT') return route.continue()
    unknownRequest = route.request().postDataJSON()
    await route.fetch()
    await route.abort('failed')
  })
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('回执丢失 A')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByText('请求结果未知，请重试核实原请求', { exact: true }).waitFor()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('回执之后输入 B')
  await page.unroute(`**/generation-canvases/canvas-project/${firstId}`)
  page.once('dialog', dialog => dialog.accept())
  await page.reload()
  await page.getByRole('button', { name: '恢复本地内容' }).click()
  await page.getByRole('button', { name: '恢复本地内容' }).waitFor({ state: 'hidden' })
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '回执之后输入 B')
  assert.equal((await (await fetch(`${base}/${firstId}`)).json()).data.document.cards[0].text, '回执丢失 A')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  assert.equal((await (await fetch(`${base}/${firstId}`)).json()).data.revision, 4)
  assert.equal(unknownRequest.expected_revision, 2)

  // External CAS conflict must retain current input until the user explicitly resolves it.
  const external = (await (await fetch(`${base}/${firstId}`)).json()).data
  const externalSave = await fetch(`${base}/${firstId}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: crypto.randomUUID(), expected_revision: external.revision, document: { ...external.document, name: '服务器外部修改' } }) })
  assert.equal(externalSave.status, 200)
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('冲突仍保留')
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByText('修订冲突，本地内容已保留。核对后选择处理方式').waitFor()
  assert.equal(await page.getByRole('textbox', { name: '文本内容', exact: true }).inputValue(), '冲突仍保留')
  await page.getByRole('button', { name: '保留本地并以最新修订保存' }).click()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()

  // One owner per canvas; a second canvas can be edited in the same browser context.
  const other = await page.context().newPage()
  await other.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  await other.goto(page.url())
  await other.getByText('此画布当前只读', { exact: true }).waitFor()
  assert.equal(await other.getByRole('textbox', { name: '画布名称' }).isDisabled(), true)
  await other.getByRole('button', { name: '取得编辑权' }).click()
  await other.getByRole('textbox', { name: '画布名称' }).waitFor()
  await other.waitForFunction(() => document.querySelector('[aria-label="画布名称"]') && !document.querySelector('[aria-label="画布名称"]').disabled)
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]').disabled)
  await page.goto(`http://127.0.0.1:4271/projects/canvas-project?tab=generation&canvas=${secondId}`)
  await page.waitForFunction(() => document.querySelector('[aria-label="画布名称"]') && !document.querySelector('[aria-label="画布名称"]').disabled)
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('五秒自动保存')
  await page.getByRole('status').filter({ hasText: '待保存' }).waitFor()
  await page.getByRole('status').filter({ hasText: 'revision 2 · 已保存' }).waitFor()
  assert.equal((await (await fetch(`${base}/${secondId}`)).json()).data.document.cards[0].text, '五秒自动保存')
  // Storage failures are visible without blocking a server save or claiming recovery protection.
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('blocked storage') } })
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('存储不可用')
  await page.getByText('浏览器存储不可用，本地恢复保护失败；请保存后再离开').waitFor()
  await page.getByRole('button', { name: '保存画布' }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await page.getByRole('textbox', { name: '文本内容', exact: true }).fill('离开前保护保存')
  await page.getByRole('combobox', { name: '选择画布' }).press('ArrowDown')
  await page.getByText('第一张独立画布 B', { exact: true }).last().click()
  await page.waitForURL(url => url.searchParams.get('canvas') === firstId)
  assert.equal((await (await fetch(`${base}/${secondId}`)).json()).data.document.cards[0].text, '离开前保护保存')
  await page.screenshot({ path: join(output, 'generation-canvas.png'), fullPage: true })
  console.log('new → edit → save → second canvas → switch → refresh: persistent content and revision verified')
} finally { await cleanup() }
