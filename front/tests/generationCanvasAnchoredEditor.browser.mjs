import { closeCanvasDetails } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const output = await browserOutput('jellyfish-generation-canvas-images-')
const api = 'http://127.0.0.1:8436', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8436' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4436, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多图与未完成成果' }) })).json()).data
  const document = { ...canvas.document, cards: [{ id: 'text', type: 'content.text', text: '下方编辑内容' }, { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [] }, config: {} }, { id: 'image', type: 'content.image' }, { id: 'ref', type: 'reference.character', title: '参考人物', angle: '正面', objects: [] }, ...['content.basis','content.object','content.place','content.video','content.audio','reference.place','reference.prop','reference.costume','model.text','model.video'].map((type,index)=>({id:`kind-${index}`,type}))], edges: [] }
  const seeded = await fetch(`${base}/${canvas.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: 'seed', expected_revision: 0, document }) })
  assert.ok(seeded.ok, await seeded.text())
  await page.goto(`http://127.0.0.1:4436/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const text = page.locator('[data-card-id="text"]')
  await text.press('Enter')
  const editor = page.locator('.wb-details:not([hidden])')
  await editor.waitFor()
  const cardBox = await text.boundingBox(), panelBox = await editor.boundingBox()
  assert.ok(panelBox.y >= cardBox.y + cardBox.height, 'editor is below its card')
  await page.screenshot({ path: join(output, 'anchored-desktop.png') })
  const input = editor.getByRole('textbox', {name: '文本内容',exact:true})
  await input.fill('保留会话及保存内容')
  await editor.getByRole('button', {name:'展开详情',exact:true}).click()
  await page.waitForFunction(() => document.querySelector('.wb-details:not([hidden])')?.getAttribute('role') === 'dialog')
  await editor.getByRole('textbox', {name:'文本内容',exact:true}).waitFor()
  assert.equal(await input.inputValue(), '保留会话及保存内容')
  await page.screenshot({ path: join(output, 'expanded-desktop.png') })
  await editor.getByRole('button', {name:'收起详情',exact:true}).click()
  assert.equal(await input.inputValue(), '保留会话及保存内容')
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  for (const id of ['image','ref','m', ...Array.from({length:10},(_,index)=>`kind-${index}`), 'text']) {
    for(let attempt=0;attempt<2 && await editor.isVisible();attempt++){await page.keyboard.press('Escape');await delay(100)}
    await page.locator(`[data-card-id="${id}"]`).press('Enter'); await editor.waitFor()
  }
  assert.equal(await input.inputValue(), '保留会话及保存内容')
  await closeCanvasDetails(page)
  await page.locator('[data-card-id="image"]').press('Enter')
  await editor.getByRole('button', {name:'从素材中选择',exact:true}).click()
  await page.getByRole('dialog', {name:'项目文件库',exact:true}).waitFor()
  await page.getByRole('dialog', {name:'项目文件库',exact:true}).getByRole('button',{name:'Close',exact:true}).click()
  await closeCanvasDetails(page)
  await page.locator('[data-card-id="text"]').press('Enter')
  const originalEditorWidth = (await editor.boundingBox()).width
  await page.getByRole('button', {name:'缩小',exact:true}).click()
  assert.equal((await editor.boundingBox()).width, originalEditorWidth, 'controls retain screen dimensions while canvas zooms')
  const surface = page.getByLabel('生成画布视口',{exact:true})
  await surface.focus()
  const pan = async delta => { await page.mouse.move(1380,delta<0?600:100); await page.keyboard.down('Space'); await page.mouse.down(); await page.mouse.move(1380,delta<0?100:600,{steps:8}); await page.keyboard.up('Space'); await page.mouse.up() }
  await pan(-500); await pan(-500)
  await editor.waitFor({state:'hidden'})
  await pan(500); await pan(500)
  await editor.waitFor()
  assert.equal(await input.inputValue(), '保留会话及保存内容')
  await page.setViewportSize({width:3830,height:1688})
  await editor.waitFor()
  await page.screenshot({path:join(output,'anchored-wide.png')})
  await page.setViewportSize({width:390,height:844})
  await editor.waitFor()
  await page.screenshot({path:join(output,'anchored-mobile.png')})
  const mobile = await editor.boundingBox()
  assert.ok(mobile.x>=0 && mobile.x+mobile.width<=390 && mobile.y>=0 && mobile.y+mobile.height<=844)
  const saved = (await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.cards.find(card=>card.id==='text').text, '保留会话及保存内容')

} finally { await cleanup() }
