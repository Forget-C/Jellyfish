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
const api = 'http://127.0.0.1:8424'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_PORT: '8424' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4424, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'筛选保持采用'})})
  const canvas=(await response.json()).data
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'被隐藏但明确采用的内容'},
    {id:'model',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}},{id:'dense',type:'direction.performance',input_bindings:[],examples:[],scope:{}}],
    edges:[],input_order:{}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.clone().text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const before=await read()
  const precheck=async()=>(await(await fetch(`${base}/${canvas.id}/precheck`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_id:'model'})})).json()).data
  const initialPreview=await precheck()
  assert.doesNotMatch(initialPreview.input.text,/被隐藏但明确采用的内容/)
  await page.goto(`http://127.0.0.1:4424/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const sourceCard=page.locator('[data-card-id="source"]'), modelCard=page.locator('[data-card-id="model"]')
  await modelCard.waitFor()
  const input=modelCard.locator('[data-input-port="text"]'), outputPort=sourceCard.locator('[data-output-port="text"]')
  await input.waitFor()
  assert.match(await input.innerText(),/候选 0.*已采用 0/)
  await outputPort.dragTo(input)
  await page.waitForFunction(()=>document.querySelector('[data-card-id="model"] [data-input-port="text"]')?.textContent?.includes('候选 1'))
  assert.match(await input.innerText(),/候选 1.*已采用 0/)
  await page.getByRole('button',{name:'保存画布',exact:true}).click()
  assert.doesNotMatch((await precheck()).input.text,/被隐藏但明确采用的内容/)
  await modelCard.press('Enter')
  const details=page.locator('.wb-details:visible')
  await details.getByRole('button',{name:'@文本1',exact:true}).click()
  await page.getByRole('button',{name:'关闭详情',exact:true}).click()
  await page.getByRole('button',{name:'保存画布',exact:true}).click()
  assert.match(await input.innerText(),/候选 1.*已采用 1/)
  for(let i=0;i<40 && !(await read()).document.cards.find(card=>card.id==='model').input_bindings?.length;i++) await delay(100)
  assert.match((await precheck()).input.text,/被隐藏但明确采用的内容/)
  await modelCard.locator('[data-output-port="text"]').dragTo(input)
  await page.getByRole('status').filter({hasText:'卡片不能连接自身'}).waitFor()
  assert.equal((await read()).document.edges.length,1)
  assert.equal((await read()).document.cards.find(card=>card.id==='model').input_bindings.length,1)
  const box=await modelCard.boundingBox(), portBox=await input.boundingBox()
  assert.ok(portBox.x < box.x+30,'input is positioned on the left card edge')
  await page.screenshot({path:join(output,'ports-desktop.png'),animations:'disabled'})
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'适应画布',exact:true}).click()
  const dense=page.locator('[data-card-id="dense"]')
  const bounds=await dense.boundingBox()
  const ports=await dense.locator('[data-input-port]').all()
  for(let i=0;i<ports.length;i++){const b=await ports[i].boundingBox();assert.ok(b.y+b.height<=bounds.y+bounds.height);if(i)assert.ok(b.y>=(await ports[i-1].boundingBox()).y+(await ports[i-1].boundingBox()).height)}
  await page.screenshot({path:join(output,'ports-mobile.png'),animations:'disabled'})
  console.log('edge ports expose candidate and adoption separately')
} finally { await cleanup() }
