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
const api = 'http://127.0.0.1:8573', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8573' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4573, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } })
  page = await context.newPage()
  page.setDefaultTimeout(12000)
  page.on('pageerror', error => console.log('PAGE ERROR', error.message))
  page.on('console',message=>{if(message.type()==='error')console.log('CONSOLE ERROR',message.text())})
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '多图与未完成成果' }) })).json()).data
  const document = { ...canvas.document, cards: [
    { id: 'm', type: 'model.image', model_id: 'canvas-image-model', prompt: { segments: [{ id: 'p', kind: 'text', text: '一张图片' }] }, config: { count: 3, target_ratio: '1:1' } },
    { id: 'text', type: 'content.text', text: '清晨街角' }],
    edges: [{ id: 'text-edge', source_card: 'text', source_port: 'text', target_card: 'm', target_port: 'text' }], input_order: {m:{text:['text-edge']}} }
  const seeded=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seeded.ok,await seeded.text())
  await page.goto(`http://127.0.0.1:4573/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const shell=page.locator('[data-card-id="m"]')
  const status=shell.getByRole('region',{name:'模型状态摘要',exact:true})
  await status.getByText('已采用 0',{exact:true}).waitFor()
  assert.match(await status.innerText(),/尚未运行/)
  await page.locator('[data-card-id="text"]').getByText('4 字',{exact:true}).waitFor()
  await shell.press('Enter')
  const editor=page.locator('.wb-details:visible')
  await editor.locator('summary').filter({hasText:/管理候选与采用|素材/}).first().click()
  await editor.getByRole('button',{name:'采用 @文本1',exact:true}).click()
  await status.getByText('已采用 1',{exact:true}).waitFor()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  let saved=(await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.cards.find(c=>c.id==='m').input_bindings.length,1)
  await editor.getByRole('button',{name:'取消采用 @文本1',exact:true}).click()
  await status.getByText('已采用 0',{exact:true}).waitFor()
  await page.getByLabel('画布保存状态').getByText('已保存',{exact:true}).waitFor()
  saved=(await (await fetch(`${base}/${canvas.id}`)).json()).data
  assert.equal(saved.document.cards.find(c=>c.id==='m').input_bindings.length,0)
  await editor.getByRole('button',{name:'预检运行',exact:true}).click()
  await page.getByRole('button',{name:'确认执行',exact:true}).click()
  await status.getByText('已完成',{exact:true}).waitFor()
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await shell.screenshot({path:join(output,'status-succeeded.png')})
  const formal=(await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data.current_outputs.m
  assert.ok(formal.length)
  // Isolated SQLite stores run timestamps at second precision; keep the two accepted runs ordered.
  await delay(1100)
  await fetch(`${api}/test/image-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fail_next:true})})
  await shell.press('Enter')
  await editor.getByRole('button',{name:'预检运行',exact:true}).click()
  await page.getByRole('button',{name:'确认执行',exact:true}).click()
  await status.getByText(/失败/).first().waitFor()
  await status.getByText('保留上次成果',{exact:true}).waitFor()
  assert.deepEqual((await (await fetch(`${base}/${canvas.id}/runtime`)).json()).data.current_outputs.m,formal)
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await status.getByRole('button',{name:'查看状态说明',exact:true}).click()
  await page.locator('.ant-popover:visible').getByText(/供应商请求失败/).waitFor()
  await page.screenshot({path:join(output,'status-full-reason.png')})
  await page.keyboard.press('Escape')
  await page.locator('.ant-popover:visible').waitFor({state:'hidden'})
  await shell.screenshot({path:join(output,'status-failed.png')})
  const dimensions=await status.evaluate(e=>({height:e.getBoundingClientRect().height,width:e.getBoundingClientRect().width,scroll:e.scrollWidth}))
  assert.ok(dimensions.height<38,'state remains a compact line')
  assert.ok(dimensions.scroll<=dimensions.width+1,'state line does not overflow card')
  await page.reload()
  await status.getByText('保留上次成果',{exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  await shell.screenshot({path:join(output,'status-mobile.png')})
  const observer=await page.context().newPage()
  await observer.addInitScript(()=>{window.__ENV={BACKEND_URL:window.location.origin}})
  await observer.goto(page.url())
  await observer.locator('[data-card-id="m"]').getByRole('region',{name:'模型状态摘要',exact:true}).getByText('只读',{exact:true}).waitFor()
  await observer.close()
  console.log('PASS compact adopted count, real success/failure/retained output/readonly',output)
} catch (error) { if (page) await page.screenshot({path:join(output,'failure.png')}); throw error } finally { await cleanup() }
