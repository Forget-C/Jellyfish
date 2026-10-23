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
const output = await browserOutput('jellyfish-generation-canvas-graph-')
const api = 'http://127.0.0.1:8274'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_graph_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8274' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4274, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '类型化画布' }) })).json()).data
  const doc = { ...canvas.document, cards: [
    { id: 'a', type: 'content.text', text: '第一份来源' },
    { id: 'b', type: 'content.text', text: '第二份来源' },
    { id: 'm', type: 'model.text', model_id: 'graph-text', prompt: '', config: {} },
  ] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: doc }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4274/projects/canvas-project?tab=generation&canvas=${canvas.id}`)
  const card = id => page.locator(`[data-card-id="${id}"]`)
  await card('a').getByRole('textbox', { name: '文本内容', exact: true }).waitFor()
  await page.getByRole('status').filter({ hasText: 'revision 1 · 已保存' }).waitFor()
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  await page.getByRole('button', { name: '缩小', exact: true }).click()
  const dragPort = async (from, output, to, input) => {
    const source = await card(from).getByRole('button', { name: `输出端口 ${output}`, exact: true }).boundingBox()
    const target = await card(to).getByRole('button', { name: `输入端口 ${input}`, exact: true }).boundingBox()
    assert.ok(source && target)
    await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 })
    await page.mouse.up()
  }
  await dragPort('a', 'text', 'm', 'text')
  await page.getByRole('status').filter({ hasText: '已连接候选输入' }).waitFor()
  await dragPort('a', 'text', 'm', 'text')
  await page.getByRole('status').filter({ hasText: '同一端口连接已存在' }).waitFor()
  await dragPort('b', 'text', 'm', 'text')
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'revision 2 · 已保存' }).waitFor()
  let saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.edges.length, 2)
  const order = saved.document.input_order.m.text
  await card('m').getByRole('button', { name: `前移输入 ${order[1]}`, exact: true }).click()
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: 'revision 3 · 已保存' }).waitFor()
  let puts = 0
  page.on('request', request => { if (request.method() === 'PUT' && request.url().includes('/generation-canvases/')) puts++ })
  const beforeMove = await card('a').boundingBox()
  await card('a').getByRole('button', { name: '移动布局：文本内容卡', exact: true }).press('ArrowDown')
  await page.getByRole('button', { name: '放大', exact: true }).click()
  await delay(5200)
  assert.equal(puts, 0, 'layout/viewport does not save content')
  const afterMove = await card('a').boundingBox()
  assert.ok(afterMove.y > beforeMove.y)
  await page.reload()
  await card('a').waitFor()
  const reopened = await card('a').boundingBox()
  assert.ok(Math.abs(reopened.y - afterMove.y) < 2, 'layout/viewport restored')
  await card('a').getByRole('checkbox').check()
  await card('b').getByRole('checkbox').check()
  await page.getByRole('button', { name: '将所选卡片分组', exact: true }).click()
  await page.getByRole('textbox', { name: '分组名称', exact: true }).fill('保留独立输入')
  const group = page.locator('[data-group-id]')
  await group.getByRole('button', { name: '移动布局：分组 保留独立输入', exact: true }).press('ArrowDown')
  await group.getByRole('button', { name: '折叠组', exact: true }).click()
  assert.equal(await page.locator('[data-card-id="a"]').count(), 0)
  await page.getByRole('button', { name: '保存画布', exact: true }).click()
  await page.getByRole('status').filter({ hasText: '已保存' }).first().waitFor()
  saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.deepEqual(saved.document.input_order.m.text, [order[1], order[0]])
  assert.equal(saved.document.groups[0].collapsed, true)
  await group.getByRole('button', { name: '展开组', exact: true }).click()
  await group.getByRole('button', { name: '解散组', exact: true }).click()
  assert.equal(await page.locator('[data-card-id]').count(), 3)
  await dragPort('m', 'text', 'm', 'text')
  await page.getByRole('status').filter({ hasText: '卡片不能连接自身' }).waitFor()
  await page.screenshot({ path: join(output, 'typed-graph-desktop.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: join(output, 'typed-graph-narrow.png'), fullPage: true })
  console.log('typed port drag, duplicate/self rejection, independent input order, group move/collapse/dissolve, local layout+viewport reopen and no content PUT verified')

} finally { await cleanup() }
