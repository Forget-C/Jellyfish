import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
import { closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const api = 'http://127.0.0.1:8585'
const base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8585' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4585, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await context.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
    localStorage.setItem('jellyfish_canvas_appearance', 'dark')
  })
  const canvas = await createStoryboardCanvas(base, '编辑卡滚动样式')
  const catalog = (await (await fetch(storyboardCanvasApi(base, canvas.id, `/catalog`))).json()).data
  const cards = catalog.cards.map(({ type }, index) => ({ id: `card-${index}`, type, ...(type === 'direction.dialogue' ? { dialogue_id: 'dialogue' } : {}) }))
  const document = { ...canvas.document, cards, edges: [], input_order: {} }
  const seed = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) }) })
  assert.ok(seed.ok, await seed.clone().text())
  await page.goto(`http://127.0.0.1:4585${storyboardCanvasPath(canvas)}`)
  const editor = page.locator('.generation-card-editor:not([hidden])')
  const open = async card => {
    console.log('Checking', card.type)
    await page.getByRole('button', { name: '适应全部', exact: true }).click()
    const node = page.locator(`[data-card-id="${card.id}"]`)
    await node.press('Enter')
    try { await editor.waitFor() }
    catch (error) { await page.screenshot({ path: join(output, 'failure.png') }); console.log('Screenshot:', output); throw error }
  }
  await open(cards.find(card => card.type === 'model.text'))
  const modelInput = editor.getByRole('textbox', { name: '模型正文', exact: true })
  await modelInput.fill('长正文。\n'.repeat(100))
  await modelInput.press('ControlOrMeta+End')
  const fullyVisible = await modelInput.evaluate(element => {
    const box = element.getBoundingClientRect(), body = element.closest('.wb-details-body').getBoundingClientRect()
    return box.top >= body.top + 2 && box.bottom <= body.bottom - 2
  })
  assert.ok(fullyVisible, 'model input and its focus outline fit completely inside editor body')
  await closeCanvasDetails(page)
  for (const card of cards) {
    await open(card)
    assert.equal(await editor.locator('.wb-details-body').evaluate(element => getComputedStyle(element).scrollbarWidth), 'none', `${card.type}: no outer scrollbar`)
    for (const input of await editor.locator('textarea, [contenteditable]').all()) {
      assert.equal(await input.evaluate(element => getComputedStyle(element).scrollbarWidth), 'thin', `${card.type}: input has a thin scrollbar`)
      assert.equal(await input.evaluate(element => getComputedStyle(element).scrollbarColor), 'rgb(80, 80, 80) rgba(0, 0, 0, 0)', `${card.type}: consistent dark scrollbar`)
    }
    assert.doesNotMatch(await editor.innerText(), /完整采用本卡|不自动推导触发行为|通过加号添加候选|正文通过文本出口独立采用/)
    await closeCanvasDetails(page)
  }
  for (const width of [1440, 900, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : width === 900 ? 600 : 960 })
    for (const type of ['content.text', 'model.text', 'model.image', 'model.video']) {
      await open(cards.find(card => card.type === type))
      assert.doesNotMatch(await editor.innerText(), /输入需要核对，请打开管理候选与采用查看诊断/)
      const input = editor.getByRole('textbox', { name: type === 'content.text' ? '文本内容' : '模型正文', exact: true })
      await input.fill('长正文滚动样式。\n'.repeat(100))
      await input.press('ControlOrMeta+End')
      assert.ok(await input.evaluate(element => element.scrollHeight > element.clientHeight), 'long text scrolls within input')
      if (type.startsWith('model.')) {
        const fits = () => input.evaluate(element => {
          const box = element.getBoundingClientRect(), body = element.closest('.wb-details-body').getBoundingClientRect()
          return box.top >= body.top + 2 && box.bottom <= body.bottom - 2 && box.left >= body.left + 2 && box.right <= body.right - 2
        })
        assert.ok(await fits(), `${type} input is fully visible at ${width}px`)
        assert.ok(await editor.locator('.wb-details-body').evaluate(element => element.scrollHeight <= element.clientHeight + 1), 'model editor body does not overflow')
        if (width === 1440 && await editor.getByRole('button',{name:'展开详情',exact:true}).count()) {
          await editor.getByRole('button', { name: '展开详情', exact: true }).click()
          assert.ok(await fits(), `${type} expanded input is fully visible`)
          await editor.getByRole('button', { name: '收起详情', exact: true }).click()
        }
      }
      await editor.screenshot({ path: join(output, `${type}-${width}.png`), animations: 'disabled' })
      await closeCanvasDetails(page)
    }
  }
  console.log(`PASS ${cards.length} editor types, helper removal and long input scrolling at desktop/mobile: ${output}`)
} finally { await cleanup() }
