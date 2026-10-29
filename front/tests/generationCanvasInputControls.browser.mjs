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
const api = 'http://127.0.0.1:8497'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8497' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4497, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, hasTouch: true })
  const page = await context.newPage()
  page.on('pageerror',error=>console.error(error))
  page.setDefaultTimeout(15000)
  await context.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response=await fetch(base,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'导入与可见加号'})})
  const canvas=(await response.json()).data
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'导入前正文'},{id:'target',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}}],edges:[],input_order:{}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})});assert.ok(seed.ok,await seed.text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const poll=async predicate=>{for(let i=0;i<80;i++){const value=await read();if(predicate(value))return value;await delay(100)}throw Error('save did not arrive')}
  await page.goto(`http://127.0.0.1:4497/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const source=page.locator('[data-card-id="source"]')
  const captureSource=async name=>{const b=await source.boundingBox();await page.screenshot({path:join(output,name),clip:{x:Math.max(0,b.x-24),y:Math.max(0,b.y-4),width:b.width+48,height:b.height+8},animations:'disabled'})}
  await source.waitFor()
  assert.equal(await source.getByRole('button',{name:'右侧连接点',exact:true}).evaluate(e=>getComputedStyle(e).opacity),'0')
  await captureSource('default-hidden-plus.png')
  await source.press('Enter')
  const detail=page.locator('.wb-details:visible')
  const importer=detail.getByRole('button',{name:'导入文本文件',exact:true})
  await importer.waitFor({timeout:2000})
  const hiddenFile=detail.locator('input[type="file"]')
  assert.equal(await hiddenFile.isVisible(),false,'native file chooser is hidden')
  let chooserPromise=page.waitForEvent('filechooser');await importer.click();await(await chooserPromise).setFiles([])
  assert.equal(await detail.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'导入前正文')
  chooserPromise=page.waitForEvent('filechooser');await importer.click();await(await chooserPromise).setFiles({name:'创作草稿.md',mimeType:'text/markdown',buffer:Buffer.from('导入后的独立正文')})
  await poll(s=>s.document.cards[0].text==='导入后的独立正文')
  await detail.getByRole('status').filter({hasText:'已导入：创作草稿.md'}).waitFor()
  await detail.screenshot({path:join(output,'themed-text-import.png'),animations:'disabled'})
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  await source.hover()
  const right=source.getByRole('button',{name:'右侧连接点',exact:true})
  assert.equal((await right.innerText()).trim(),'+','plus is visible within circular connector')
  const visual=await right.locator('i').boundingBox();assert.ok(visual.width>=28&&visual.width<=32)
  await captureSource('hover-plus-100.png')
  await right.focus();await captureSource('focus-plus-100.png')
  const target=page.locator('[data-card-id="target"]'),left=target.getByRole('button',{name:'左侧连接点',exact:true})
  const start=await right.boundingBox(),end=await left.boundingBox()
  await page.mouse.move(start.x+start.width/2,start.y+start.height/2);await page.mouse.down()
  await page.mouse.move((start.x+end.x)/2,(start.y+end.y)/2,{steps:5})
  await page.locator('[aria-label="正在连接候选"]').waitFor()
  await page.screenshot({path:join(output,'drag-line.png'),animations:'disabled'})
  await page.mouse.move(end.x+end.width/2,end.y+end.height/2,{steps:5});await page.mouse.up()
  await poll(s=>s.document.edges.length===1)
  assert.equal((await read()).document.cards.find(c=>c.id==='target').input_bindings.length,0,'connecting never adopts')
  await page.reload();await source.press('Enter')
  assert.equal(await detail.getByRole('textbox',{name:'文本内容',exact:true}).inputValue(),'导入后的独立正文')
  await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
  for(const [width,height]of[[1440,960],[390,844],[3830,1688]]){
    await page.setViewportSize({width,height});await source.press('Enter');await detail.waitFor()
    await page.screenshot({path:join(output,`import-full-${width}.png`),animations:'disabled'})
    await detail.getByRole('button',{name:'关闭详情',exact:true}).click()
    await source.hover();await page.screenshot({path:join(output,`plus-full-${width}.png`),animations:'disabled'})
  }
  console.log('Themed text import/cancel/reopen, visible circle plus, live drag candidate and three viewports passed:',output)
}finally{await cleanup()}
