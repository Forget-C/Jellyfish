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
const output = await browserOutput('jellyfish-generation-canvas-movement-')
const api = 'http://127.0.0.1:8653', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8653' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let i = 0; i < 80; i++) {
    if (backend.exitCode !== null) throw Error('isolated photography backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready)
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4653, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'move', type: 'direction.movement' }], edges: [] }
  const seed = await fetch(`${base}/${canvas.id}`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok, await seed.text())
  const read = async () => (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate => { for (let i=0;i<80;i++) {const state=await read(); if(predicate(state)) return state;await delay(100)} throw Error('movement save did not arrive') }
  await page.goto(`http://127.0.0.1:4653/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const detail=page.locator('.wb-details:not([hidden])')
  await page.locator('[data-card-id="move"]').getByRole('button', {name:/设计/}).click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).waitFor()
  assert.equal(await detail.getByRole('textbox',{name:'运动路径内容',exact:true}).isVisible(),false)
  await detail.locator('.design-preset-choice').first().click()
  await detail.getByRole('button',{name:'应用即可',exact:true}).click()
  await poll(state=>!!state.document.cards[0].fields.movement_path.text)
  const previewVideo=await detail.locator('.design-preset-preview video').getAttribute('src')
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.locator('[data-card-id="move"]').getByRole('button',{name:'编辑设计',exact:true}).press('Enter')
  await detail.locator('.design-preset-preview video').waitFor()
  assert.equal(await detail.locator('.design-preset-preview video').getAttribute('src'),previewVideo,'applied movement video returns on reopening')
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  await detail.getByRole('textbox',{name:'运动路径内容',exact:true}).fill('沿门廊缓缓推进')
  await detail.getByRole('button',{name:'添加阶段',exact:true}).click()
  await detail.getByRole('textbox',{name:'阶段 1 名称',exact:true}).fill('门口停顿')
  await detail.getByRole('textbox',{name:'阶段 1 画面内容',exact:true}).fill('人物在门口回望')
  const first=await poll(state=>state.document.cards[0].phases[0]?.frame.text==='人物在门口回望')
  const stable=first.document.cards[0].phases[0].id
  await detail.getByRole('button',{name:'添加阶段',exact:true}).click()
  await detail.getByRole('textbox',{name:'阶段 2 名称',exact:true}).fill('窗边落幅')
  await detail.getByRole('textbox',{name:'阶段 2 画面内容',exact:true}).fill('最终停在窗边')
  await detail.getByRole('button',{name:'前移阶段 2',exact:true}).click()
  await detail.getByRole('textbox',{name:'阶段 2 名称',exact:true}).fill('回望')
  const reordered=await poll(state=>state.document.cards[0].phases[1]?.name==='回望')
  assert.equal(reordered.document.cards[0].phases[1].id,stable)
  await page.screenshot({path:join(output,'movement-advanced.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.reload()
  await page.locator('[data-card-id="move"]').getByRole('button',{name:/设计/}).click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  assert.equal(await detail.getByRole('textbox',{name:'阶段 2 名称',exact:true}).inputValue(),'回望')
  assert.equal(await detail.getByRole('textbox',{name:'阶段 1 画面内容',exact:true}).innerText(),'最终停在窗边')
  await detail.getByRole('button',{name:'删除阶段 1',exact:true}).click()
  await poll(state=>state.document.cards[0].phases.length===1)
  assert.equal((await read()).document.cards[0].phases[0].id,stable)
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:join(output,'movement-mobile.png'),animations:'disabled'})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  console.log(`Independent movement preset, edits, stable phases and persisted rename/reorder/delete passed: ${output}`)
} finally { await cleanup() }
