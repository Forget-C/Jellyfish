import { createStoryboardCanvas, storyboardCanvasApi, storyboardCanvasPath, withFixedSource } from './storyboard-canvas-fixture.mjs'
import { openCanvasCard } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-spatial-')
const api = 'http://127.0.0.1:8287', base = `${api}/api/v1/studio/generation-canvases`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8287' }, stdio: ['ignore', 'pipe', 'pipe'],
})
captureBackend(backend, output)
let server, browser, page
const cleanup = browserCleanup(() => ({ browser, server, backend }))
try {
  let ready = false
  for (let attempt = 0; attempt < 80; attempt++) {
    if (backend.exitCode !== null) throw new Error('isolated backend exited')
    try { if ((await fetch(base)).ok) { ready = true; break } } catch {}
    await delay(250)
  }
  assert.ok(ready, 'isolated backend ready')
  writeFileSync(join(output, 'openapi.json'), JSON.stringify(await (await fetch(`${api}/openapi.json`)).json()))
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4287, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = await createStoryboardCanvas(base, '命名图片参考')

  const upload = new FormData()
  upload.append('project_id', 'canvas-project')
  upload.append('usage_kind', 'generation_upload')
  upload.append('file', new Blob([Buffer.from(await page.evaluate(() => { const canvas = document.createElement('canvas'); canvas.width = 400; canvas.height = 200; const ctx = canvas.getContext('2d'); ctx.fillStyle = '#789'; ctx.fillRect(0,0,400,200); return canvas.toDataURL().split(',')[1] }), 'base64')], { type: 'image/png' }), 'anchor.png')
  const uploaded = await fetch(`${api}/api/v1/studio/files/upload`, { method: 'POST', body: upload })
  assert.ok(uploaded.ok, await uploaded.clone().text())
  const file = (await uploaded.json()).data
  const document = { ...canvas.document, cards: [
    { id: 'image', type: 'content.image', file_id: file.id },
    { id: 'place', type: 'content.place', object_id: 'hall', name: '大厅', text: '秘密场所正文' },
    { id: 'anchor', type: 'direction.anchor', anchor_id: 'door', name: '门边' },
    { id: 'blocking', type: 'direction.blocking', blocking_id: 'cross', name: '穿过大厅' },
    { id: 'activity', type: 'direction.activity' }, { id: 'environment', type: 'direction.environment' },
    { id: 'consumer', type: 'model.image', model_id: 'canvas-image-model' }],
    edges: [
      { id: 'image', source_card: 'image', source_port: 'image', target_card: 'anchor', target_port: 'image_example' },
      { id: 'space', source_card: 'place', source_port: 'object', target_card: 'anchor', target_port: 'space' },
      { id: 'position', source_card: 'anchor', source_port: 'anchor', target_card: 'blocking', target_port: 'position_anchor' },
      { id: 'design', source_card: 'blocking', source_port: 'text', target_card: 'consumer', target_port: 'text' }],
    input_order: { anchor: { space: ['space'], image_example: ['image'] }, blocking: { position_anchor: ['position'] }, consumer: { text: ['design'] } } }
  const seeded = await fetch(storyboardCanvasApi(base, canvas.id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document: withFixedSource(canvas, document) }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4287${storyboardCanvasPath(canvas)}`)
  const card = page.locator('.wb-details:not([hidden])')
  const open = async (id, advanced = true) => {
    await openCanvasCard(page, id)
    if (advanced && await card.getByRole('button', { name: '高级设置', exact: true }).count()) await card.getByRole('button', { name: '高级设置', exact: true }).click()
  }
  const read = async () => (await (await fetch(storyboardCanvasApi(base, canvas.id))).json()).data
  const poll = async predicate => { for (let i = 0; i < 80; i++) { const state = await read(); if (predicate(state)) return state; await delay(150) } throw Error('saved document did not reach expected state') }
  await open('anchor')
  assert.equal(await card.getByText(/锚点身份/).count(),0)
  assert.equal(await card.getByText('参考素材与图片标记',{exact:true}).count(),0)
  const popover = page.locator('.design-source-inspect:visible')
  await card.locator('[data-design-source]').filter({has:page.locator('img')}).first().click()
  await popover.getByRole('button',{name:'设为本地参考',exact:true}).click()
  await poll(state => state.document.cards.find(item=>item.id==='anchor').examples.length===1)
  const img = popover.getByRole('img',{name:'锚点参考图片',exact:true})
  await img.evaluate(node => node.decode())
  await img.click({position:{x:20,y:20}})
  assert.equal((await read()).document.cards.find(item=>item.id==='anchor').markers.length,0)
  await popover.getByRole('button',{name:'标记位置',exact:true}).click()
  const box = await img.boundingBox()
  await page.mouse.move(box.x+box.width*.25,box.y+box.height*.5)
  await page.mouse.down()
  await page.mouse.move(box.x+box.width*.75,box.y+box.height*.25,{steps:4})
  assert.equal((await read()).document.cards.find(item=>item.id==='anchor').markers.length,0)
  await page.mouse.up()
  await poll(state=>Math.abs((state.document.cards.find(item=>item.id==='anchor').markers[0]?.x||0)-.75)<.02)
  await popover.getByRole('button',{name:'完成标记',exact:true}).click()
  await popover.getByText('精确坐标',{exact:true}).click()
  await popover.getByRole('spinbutton',{name:'标记横坐标百分比',exact:true}).fill('35')
  await poll(state=>state.document.cards.find(item=>item.id==='anchor').markers[0]?.x===.35)
  await popover.getByRole('button',{name:'展开预览',exact:true}).click()
  await page.screenshot({path:join(output,'anchor-reference-desktop.png'),fullPage:true})
  await popover.getByRole('button',{name:'清除标记',exact:true}).click()
  await poll(state=>state.document.cards.find(item=>item.id==='anchor').markers.length===0)
  await popover.getByRole('spinbutton',{name:'标记纵坐标百分比',exact:true}).fill('45')
  await poll(state=>state.document.cards.find(item=>item.id==='anchor').markers.length===1)
  await popover.getByRole('button',{name:'取消本地参考',exact:true}).click()
  const removed=await poll(state=>state.document.cards.find(item=>item.id==='anchor').examples.length===0)
  assert.equal(removed.document.cards.find(item=>item.id==='anchor').markers.length,0)
  assert.ok(removed.document.edges.some(edge=>edge.id==='image'))
  await popover.getByRole('button').first().press('Escape')
  await card.getByRole('button',{name:'撤销',exact:true}).click()
  await poll(state=>state.document.cards.find(item=>item.id==='anchor').examples.length===1 && state.document.cards.find(item=>item.id==='anchor').markers.length===1)
  await page.setViewportSize({width:390,height:844})
  await card.locator('[data-design-source]').filter({has:page.locator('img')}).first().click()
  await popover.waitFor({state:'visible'})
  await popover.evaluate(async element => { await Promise.all(element.getAnimations({subtree:true}).map(animation => animation.finished.catch(()=>{}))) })
  await page.screenshot({path:join(output,'anchor-reference-mobile.png'),fullPage:true})
  const bounds = await popover.boundingBox()
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 391)
  console.log('PASS anchor local reference, marker gesture, percentage, clear, removal and undo')
} finally { await cleanup() }
