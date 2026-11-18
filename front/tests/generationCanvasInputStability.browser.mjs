import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const api = 'http://127.0.0.1:8587'
const base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8587' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4587, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'同步时输入区稳定'})})
  const canvas=(await response.json()).data
  const document = { ...canvas.document, cards: [{ id: 'model', type: 'model.text', model_id: 'canvas-runtime-text' },
    { id: 'diagnostics', type: 'model.text', model_id: 'canvas-runtime-text', prompt: { segments: ['first', 'second'].map(id => ({ id, kind: 'instruction', command: id === 'first' ? '首帧参考' : '尾帧参考', parameters: {}, references: [] })) } }], edges: [], input_order: {} }
  const seed = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seed.ok, await seed.clone().text())
  let hold = false, release, started, finished, initialResolved
  const gate = new Promise(resolve => { release = resolve })
  const pending = new Promise(resolve => { started = resolve })
  const completed = new Promise(resolve => { finished = resolve })
  const initialReady = new Promise(resolve => { initialResolved = resolve })
  await page.route('**/cards/model/outputs?project_id=*', async route => {
    const refreshing = hold
    const response = await route.fetch()
    if (refreshing) { started(); await gate }
    await route.fulfill({ response })
    if (refreshing) finished()
    else initialResolved()
  })
  try {
    const initialCompile = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/cards/model/compile') && response.ok())
    await page.goto(`http://127.0.0.1:4587/canvases/${canvas.id}`)
    await page.locator('[data-card-id="model"]').press('Enter')
    const editor = page.locator('.generation-card-editor:not([hidden])')
    const input = editor.getByRole('textbox', { name: '模型正文', exact: true })
    await input.waitFor()
    await Promise.all([initialReady, initialCompile])
    await delay(220)
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const geometry = () => input.evaluate(element => { const b = element.getBoundingClientRect(); return { top: b.top, height: b.height } })
    const before = await geometry()
    const draft = '配色切换期间保留正在编辑的内容。'
    await input.fill(draft)
    const world = page.locator('.generation-world')
    const transform = await world.evaluate(element => element.style.transform)
    const selected = await page.locator('[data-card-id="model"]').getAttribute('data-selected')
    for (const [appearance, expected] of [['经典深色', 'rgb(32, 36, 39)'], ['雾蓝纯色', 'rgb(255, 255, 255)'], ['雾蓝微渐变', 'rgb(255, 255, 255)']]) {
      await page.getByRole('button', { name: '画布配色', exact: true }).click()
      await page.getByRole('menuitemradio', { name: appearance, exact: true }).click()
      assert.equal(await input.innerText(), draft, 'palette switch preserves current editor input')
      assert.equal(await world.evaluate(element => element.style.transform), transform, 'palette switch preserves viewport')
      assert.equal(await page.locator('[data-card-id="model"]').getAttribute('data-selected'), selected)
      assert.equal(await editor.evaluate(element => getComputedStyle(element).backgroundColor), expected, 'body-mounted editor follows palette')
      assert.deepEqual(await geometry(), before, 'palette switch preserves editor geometry')
      await page.screenshot({ path: join(output, `palette-${appearance}.png`), animations: 'disabled' })
    }
    hold = true
    await input.fill('连续编辑时保持输入框位置与高度稳定。')
    await pending
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.deepEqual(await geometry(), before, 'background candidate refresh must not move or resize the text input')
    assert.equal(await editor.getByText('正在读取直接候选', { exact: true }).count(), 0)
    hold = false
    const refreshed = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/cards/model/outputs') && response.ok())
    await input.fill('第二次编辑对应最新候选修订。')
    const savedInputs = editor.getByRole('region', { name: '已保存直接输入', exact: true })
    await editor.getByLabel('管理候选与采用', { exact: true }).click()
    const latest = await refreshed
    const latestRevision = (await latest.json()).data.revision
    await savedInputs.getByText(`已保存 revision ${latestRevision} · 本地修改保存后更新`, { exact: true }).waitFor()
    release()
    await completed
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.match(await savedInputs.textContent(), new RegExp(`已保存 revision ${latestRevision} ·`))
    const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
    assert.equal(saved.revision, latestRevision, 'displayed candidates belong to latest saved HTTP revision')
    assert.deepEqual(saved.document.cards[0].input_bindings || [], [], 'candidate refresh does not adopt inputs')
    await editor.getByLabel('管理候选与采用', { exact: true }).click()
    assert.deepEqual(await geometry(), before, 'finishing candidate refresh preserves input geometry')
    assert.equal(await input.textContent(), '第二次编辑对应最新候选修订。')
    await editor.screenshot({ path: join(output, 'stable-input.png'), animations: 'disabled' })
    await openCanvasCard(page, 'diagnostics')
    for (const [index, segment] of ['first', 'second'].entries()) {
      await page.getByRole('button', { name: '预检运行', exact: true }).click()
      const preview = page.getByRole('region', { name: '运行预检', exact: true })
      await preview.getByRole('alert').filter({ hasText: 'INSTRUCTION_REFERENCE_REQUIRED' }).nth(index).getByRole('button', { name: '定位问题', exact: true }).click()
      await page.waitForFunction(id => document.activeElement?.getAttribute('data-segment-id') === id, segment)
      const model = page.getByRole('textbox', { name: '模型正文', exact: true })
      await model.focus()
      await page.setViewportSize({ width: 1420 + index * 20, height: 960 })
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await model.evaluate(element => element === document.activeElement), true, 'ordinary renders do not reclaim diagnostic focus')
    }
    console.log(`PASS latest same-card diagnostic fragments and stale candidate refusal; input remains stable during autosave and candidate refresh: ${output}`)
  } finally { release() }
} finally { await cleanup() }
