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
const output = await browserOutput('jellyfish-generation-canvas-presets-')
const api = 'http://127.0.0.1:18044', base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_images_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, PYTHONPATH: join(root, '../backend'), UV_CACHE_DIR: '/tmp/jellyfish-uv-cache', CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '18044' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, cacheDir: join(output, 'vite-cache'), server: { host: '127.0.0.1', port: 4404, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 1440, height: 960 } })
  const page = await context.newPage()
  page.setDefaultTimeout(12000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const canvas = (await (await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: '摄影设计' }) })).json()).data
  const document = { ...canvas.document, cards: [{id:'composition', type:'direction.composition'}, {id:'second',type:'direction.composition',fields:{negative_space:{text:'保留独立留白',state:'fact'}}}], edges:[], input_order:{} }
  assert.ok((await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})).ok)
  const read = async()=> (await (await fetch(`${base}/${canvas.id}`)).json()).data
  const poll = async predicate=> { for(let i=0;i<80;i++){const state=await read();if(predicate(state))return state;await delay(100)}throw Error('composition save timeout') }
  await page.goto(`http://127.0.0.1:4404/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const card=page.locator('[data-card-id="composition"]');await card.getByRole('button',{name:'开始设计',exact:true}).click()
  const detail=page.locator('.wb-details:not([hidden])');await detail.getByRole('button',{name:'高级设置',exact:true}).waitFor()
  assert.equal(await detail.getByRole('tab').count(),0)
  await detail.getByRole('button',{name:/预览 /}).first().click();await detail.getByRole('button',{name:/应用/}).click()
  await detail.getByRole('button',{name:'高级设置',exact:true}).click()
  const composition=detail.getByRole('textbox',{name:'构图重心内容',exact:true});await composition.fill('主体位于画面右侧')
  await detail.getByRole('combobox',{name:'结构化景别',exact:true}).locator('xpath=../..').click();await page.locator('.ant-select-dropdown:visible').getByTitle('特写',{exact:true}).click()
  await poll(s=>s.document.cards[0].fields?.composition?.text==='主体位于画面右侧' && s.document.cards[0].fields?.shot_size?.size==='close_up')
  const sizeSelect=detail.locator('.design-composition-fields .ant-select')
  const layout=await sizeSelect.evaluate(node=>{const box=node.getBoundingClientRect();return {width:box.width,height:box.height,font:getComputedStyle(node.querySelector('.ant-select-selection-item')).fontSize}})
  assert.deepEqual(layout,{width:88,height:24,font:'12px'})
  assert.equal((await detail.getByRole('textbox',{name:'景别内容',exact:true}).boundingBox()).y,(await composition.boundingBox()).y,'first row editors align under equal height labels')
  const shotText=(await read()).document.cards[0].fields.shot_size.text
  await sizeSelect.hover();await sizeSelect.locator('.ant-select-clear').click()
  await poll(s=>!s.document.cards[0].fields.shot_size.size)
  assert.equal((await read()).document.cards[0].fields.shot_size.text,shotText,'clearing the compact selector preserves description')
  await sizeSelect.click();await page.locator('.ant-select-dropdown:visible').getByTitle('特写',{exact:true}).click()
  await poll(s=>s.document.cards[0].fields.shot_size.size==='close_up')
  assert.equal((await read()).document.cards[1].fields.negative_space.text,'保留独立留白')
  await page.screenshot({path:join(output,'composition-desktop.png')})
  await page.reload();await card.getByRole('button',{name:'编辑设计',exact:true}).click();await detail.getByRole('button',{name:'高级设置',exact:true}).click();assert.equal(await composition.innerText(),'主体位于画面右侧')
  await page.setViewportSize({width:390,height:844});await page.screenshot({path:join(output,'composition-mobile.png')});assert.ok(await detail.getByRole('button',{name:'返回预设',exact:true}).isVisible())
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
  console.log('PASS independent composition preset, structured framing, save/reopen, isolation and narrow layout')
} finally { await cleanup() }
