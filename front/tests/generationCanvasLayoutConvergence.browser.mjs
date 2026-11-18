import { browserOutput, browserCleanup, captureBackend } from './browser-runtime.mjs'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createServer } from 'vite'
const { chromium } = createRequire(import.meta.url)('playwright')
const root = fileURLToPath(new URL('..', import.meta.url))
const output = await browserOutput('jellyfish-generation-canvas-layout-convergence-')
const api = 'http://127.0.0.1:8638', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8638' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null)
      throw new Error('isolated backend exited')
    try {
      if ((await fetch(base)).ok) {
        ready = true
        break
      }
    }
    catch {
    }
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4638, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1920, height: 790 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('console', message => {
    if (message.type() === 'error')
      console.log('BROWSER ERROR', message.text())
  })
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => {
    window.__ENV = { BACKEND_URL: window.location.origin }
  })
  const request = async (path, body) => {
    const response = await fetch(api + path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined)
    assert.ok(response.ok, await response.clone().text())
    return (await response.json()).data
  }
  const results = []
  const pageErrors = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const canvas = await request('/api/v1/studio/generation-canvases', { name: '画布交互回归' })
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: { ...canvas.document, cards: [
          { id: 'place', type: 'reference.place', name: '', angle: '正面' },
          { id: 'spare', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: {} },
        ], edges: [], input_order: {} } }) })
  assert.ok(seeded.ok, await seeded.text())
  const layoutKey = `jellyfish:generation-layout::${canvas.id}:view:canvas`
  await page.addInitScript(({ layoutKey }) => {
    if (!sessionStorage.getItem('interaction-seeded')) {
      sessionStorage.setItem('interaction-seeded', '1')
      localStorage.setItem(layoutKey, JSON.stringify({ schema: 1, positions: { place: { x: 400, y: 250 }, spare: { x: 2200, y: 700 } }, sizes: { place: { width: 300, height: 251 } }, transform: { x: 0, y: 0, scale: .8 } }))
    }
  }, { layoutKey })
  await page.goto(`http://127.0.0.1:4638/canvases/${canvas.id}`)
  const card = page.locator('[data-card-id="place"]')
  await card.waitFor()
  const check = async (name, fn) => {
    try {
      await fn()
      results.push({ name, status: 'passed' })
      console.log('PASS', name)
    }
    catch (e) {
      results.push({ name, status: 'failed', error: e.message })
      await page.screenshot({ path: join(output, `failure-${results.length}.png`) })
      throw e
    }
  }
  const pos = () => card.evaluate(e => ({ x: parseFloat(e.style.left), y: parseFloat(e.style.top) }))
  for(let iteration=0;iteration<40;iteration++) await check(`iteration ${iteration} layout convergence across pan, zoom and undo`, async () => {
    if(iteration && iteration%4===0){await page.reload();await card.waitFor()}
    const r=await card.boundingBox()
    await page.mouse.move(r.x+70,r.y+70);await page.mouse.down({button:'middle'})
    await page.mouse.move(r.x+110,r.y+90,{steps:4});await page.mouse.up({button:'middle'})
    const initial = await pos()
    await card.focus(); await page.keyboard.press('ArrowRight')
    const surface = page.getByLabel('生成画布视口',{exact:true})
    await surface.press('ArrowDown'); await surface.press(iteration%2 ? '-' : '+')
    const browsed = await page.locator('.generation-world').getAttribute('style')
    await surface.press('ControlOrMeta+z')
    assert.deepEqual(pageErrors, [], 'no runtime errors during layout synchronization')
    assert.deepEqual(await pos(),initial,'undo reaches card movement across pan and zoom')
    assert.equal(await page.locator('.generation-world').getAttribute('style'),browsed,'undo does not revert browsing')
    await surface.press('ControlOrMeta+Shift+z')
    assert.equal((await pos()).x,initial.x+10)
    await surface.press('ControlOrMeta+z')
  })
  assert.deepEqual(pageErrors, [], 'no browser runtime errors')
  writeFileSync(join(output, 'rules.json'), JSON.stringify(results, null, 2))
  console.log(JSON.stringify(results, null, 2))
}
catch (error) {
  if (page) {
    await page.screenshot({ path: join(output, 'failure.png') })
    console.log(await page.locator('body').innerText())
  }
  throw error
}
finally {
  await cleanup()
}
