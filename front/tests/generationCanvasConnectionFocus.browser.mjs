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
const api = 'http://127.0.0.1:8584'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8584' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4584, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'连接点取消'})})
  const canvas=(await response.json()).data
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'用于候选的正文'}, {id:'model',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}}],edges:[],input_order:{}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.clone().text())
  await page.goto(`http://127.0.0.1:4584/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const source=page.locator('[data-card-id="source"]')
  await source.waitFor()
  await source.press('Enter')
  await page.locator('.generation-card-editor:not([hidden])').getByRole('textbox', { name: '文本内容', exact: true }).focus()
  await page.mouse.click(1100, 800)
  const surface = page.getByLabel('生成画布视口', { exact: true })
  assert.equal(await surface.evaluate(element => element === document.activeElement), true, 'blank click transfers focus to canvas')
  await page.keyboard.press('Escape')
  assert.equal(await surface.evaluate(element => element === document.activeElement), true, 'Escape retains canvas keyboard focus')
  const beforePan = await page.locator('.generation-world').getAttribute('style')
  await surface.press('ArrowRight')
  assert.notEqual(await page.locator('.generation-world').getAttribute('style'), beforePan, 'canvas retains keyboard panning')
  assert.equal(await surface.evaluate(element => element.matches(':focus-visible') && getComputedStyle(element).outlineStyle === 'none' && getComputedStyle(element, '::after').content.includes('画布键盘焦点')), true, 'keyboard canvas focus has a local indicator without a canvas frame')
  const connectionPoint = source.getByRole('button', { name: '左侧连接点', exact: true })
  await connectionPoint.hover()
  await connectionPoint.focus()
  await page.keyboard.press('Space')
  await page.getByRole('dialog', { name: '选择连接目标', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.mouse.click(1100, 800)
  assert.equal(await connectionPoint.evaluate(element => element === document.activeElement), false, 'blank canvas click clears the connection point focus after Space and Escape')
  assert.equal(await page.locator('[data-connecting="true"]').count(), 0, 'cancel clears connection state')
  await page.getByRole('tooltip').waitFor({ state: 'hidden' })
  await connectionPoint.press('Enter')
  await page.getByRole('dialog', { name: '选择连接目标', exact: true }).waitFor()
  await page.mouse.click(1100, 800)
  assert.equal(await page.getByRole('dialog', { name: '选择连接目标', exact: true }).count(), 0, 'blank click cancels unfinished connection')
  await connectionPoint.press('Space')
  await page.getByRole('dialog', { name: '选择连接目标', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await connectionPoint.evaluate(element => element === document.activeElement), true, 'Escape preserves keyboard return to source')
  assert.equal(await connectionPoint.locator('i').evaluate(element => getComputedStyle(element).outlineStyle), 'solid', 'keyboard focus remains visible')
  const dimensions = await connectionPoint.evaluate(element => ({ hit: parseFloat(getComputedStyle(element).width), circle: parseFloat(getComputedStyle(element.querySelector('i')).width) }))
  assert.deepEqual(dimensions, { hit: 32, circle: 20 })
  await page.mouse.click(1100, 800)
  await source.hover()
  await page.screenshot({ path: join(output, 'connection-desktop.png'), animations: 'disabled' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.getByRole('button', { name: '适应全部', exact: true }).click()
  await source.hover()
  await page.screenshot({ path: join(output, 'connection-mobile.png'), animations: 'disabled' })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'mobile has no horizontal overflow')
  await delay(1300)
  const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.edges.length, 0, 'cancelling does not create edges')
  console.log(`PASS connection focus cancellation, keyboard return, compact size and responsive layout; screenshots: ${output}`)
} finally { await cleanup() }
