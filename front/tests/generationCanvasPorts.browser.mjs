import { openModelInspection, closeCanvasDetails, closePrecheck } from './generationCanvasWorkbench.browser-helpers.mjs'
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
const api = 'http://127.0.0.1:8479'
const base = `${api}/api/v1/studio/generation-canvases/canvas-project`
const backend = spawn('uv', ['run', '--no-sync', 'python', '-m', 'tests.generation_canvas_runtime_browser_server'], {
  cwd: join(root, '../backend'), env: { ...process.env, UV_CACHE_DIR: '/tmp/jellyfish-uv-cache',
    CANVAS_BROWSER_DATABASE: join(output, 'browser.sqlite'), CANVAS_BROWSER_MEDIA_STORAGE: join(output, 'media'), CANVAS_BROWSER_PORT: '8479' }, stdio: ['ignore', 'pipe', 'pipe'],
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
  server = await createServer({ root, server: { host: '127.0.0.1', port: 4479, strictPort: true, open: false, proxy: { '/api': api } } })
  await server.listen()
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL })
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
  page.setDefaultTimeout(8000)
  await page.addInitScript(() => { window.__ENV = { BACKEND_URL: window.location.origin } })
  const response = await fetch(base, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'筛选保持采用'})})
  const canvas=(await response.json()).data
  const imageForm = new FormData()
  imageForm.append('file', new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jV4kAAAAASUVORK5CYII=', 'base64')], {type:'image/png'}), 'reference.png')
  imageForm.append('project_id', 'canvas-project'); imageForm.append('usage_kind', 'generation_upload')
  const fileId = (await (await fetch(`${api}/api/v1/studio/files/upload`, {method:'POST',body:imageForm})).json()).data.id
  const document={...canvas.document,cards:[{id:'source',type:'content.text',text:'被隐藏但明确采用的内容'},
    {id:'model',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}},{id:'dense',type:'direction.performance',input_bindings:[],examples:[],scope:{}},{id:'person',type:'content.object',object_id:'actor',name:'张三',category:'character',text:'人物描述'},{id:'photo',type:'direction.photography',input_bindings:[],examples:[],scope:{}},{id:'other',type:'model.text',model_id:'canvas-runtime-text',prompt:{segments:[]},config:{}},{id:'image',type:'content.image',file_id:fileId},{id:'unknown',type:'model.text',model_id:null,prompt:{segments:[]},config:{}}],
    edges:[],input_order:{}}
  const seed=await fetch(`${base}/${canvas.id}`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({request_id:'seed',expected_revision:0,document})})
  assert.ok(seed.ok,await seed.clone().text())
  const read=async()=>(await(await fetch(`${base}/${canvas.id}`)).json()).data
  const before=await read()
  const precheck=async()=>(await(await fetch(`${base}/${canvas.id}/precheck`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({card_id:'model'})})).json()).data
  const initialPreview=await precheck()
  assert.doesNotMatch(initialPreview.input.text,/被隐藏但明确采用的内容/)
  await page.goto(`http://127.0.0.1:4479/projects/canvas-project/generation-canvas?canvas=${canvas.id}`)
  const sourceCard=page.locator('[data-card-id="source"]'), modelCard=page.locator('[data-card-id="model"]')
  await modelCard.waitFor()
  const side = (id, edge) => page.locator(`[data-card-id="${id}"] [data-connection-side="${edge}"]`)
  const drag = async (source, sourceSide, target, targetSide, screenshot) => {
    const center = await source.boundingBox()
    await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2)
    const from = await source.locator(`[data-connection-side="${sourceSide}"]`).boundingBox()
    const to = await target.locator(`[data-connection-side="${targetSide}"]`).boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, {steps: 4})
    await page.getByLabel('正在连接候选', {exact:true}).waitFor()
    if (screenshot) await page.screenshot({path:join(output,screenshot),animations:'disabled'})
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {steps: 5})
    await page.mouse.up()
  }
  const fitForConnecting = async () => {
    await page.getByRole('button',{name:'适应全部',exact:true}).click()
  }
  const savedEdges = async count => { for(let i=0;i<70;i++){const value=await read();if(value.document.edges.length===count)return value;await delay(100)}throw Error('edge count not saved') }
  assert.equal(await sourceCard.locator('[data-connection-side]').count(),2)
  assert.equal(await modelCard.locator('[data-input-port], [data-output-port]').count(),0)
  const dense = page.locator('[data-card-id="dense"]')
  assert.equal(await dense.locator('[data-connection-side]').count(),2)
  assert.ok((await dense.boundingBox()).height < 400,'logical input count does not increase card height')
  await sourceCard.hover()
  await side('source','right').hover()
  await page.getByRole('tooltip').filter({hasText:'文本'}).waitFor()
  await page.screenshot({path:join(output,'ports-hover.png'),animations:'disabled'})
  await page.mouse.move(1000,900)
  await drag(sourceCard,'right',modelCard,'left','ports-dragging.png')
  await page.getByRole('status').filter({hasText:'连接提供候选'}).waitFor()
  await savedEdges(1)
  assert.doesNotMatch((await precheck()).input.text,/被隐藏但明确采用的内容/)
  await modelCard.press('Enter')
  await openModelInspection(page)
  const details=page.locator('.wb-details:visible')
  await details.getByRole('button',{name:'@文本1',exact:true}).click()
  await closeCanvasDetails(page)
  await page.getByRole('button',{name:'保存画布',exact:true}).click()
  for(let i=0;i<40 && !(await read()).document.cards.find(card=>card.id==='model').input_bindings?.length;i++) await delay(100)
  assert.match((await precheck()).input.text,/被隐藏但明确采用的内容/)
  await modelCard.press('Enter')
  await openModelInspection(page)
  await details.getByRole('button',{name:'预检运行',exact:true}).click()
  const runPreview = page.getByRole('region',{name:'运行预检',exact:true})
  await runPreview.waitFor()
  await fetch(`${api}/test/runtime-controls`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({release:2})})
  await runPreview.getByRole('button',{name:'确认执行',exact:true}).click()
  for(let i=0;i<80;i++){const controls=await(await fetch(`${api}/test/runtime-controls`)).json();if(controls.calls.length){assert.match(controls.calls[0].text,/被隐藏但明确采用的内容/);break}await delay(100);if(i===79)throw Error('provider was not called')}
  await closePrecheck(page)
  await closeCanvasDetails(page)
  await fitForConnecting()
  await page.screenshot({path:join(output,'ports-before-self.png')})
  await drag(modelCard,'right',modelCard,'left')
  await page.getByRole('status').filter({hasText:'卡片不能连接自身'}).waitFor()
  assert.equal((await read()).document.edges.length,1)
  assert.equal((await read()).document.cards.find(card=>card.id==='model').input_bindings.length,1)
  const other=page.locator('[data-card-id="other"]')
  await fitForConnecting()
  await drag(modelCard,'right',other,'left')
  await savedEdges(2)
  await drag(other,'left',modelCard,'right')
  await page.getByRole('status').filter({hasText:'候选连接不能形成循环'}).waitFor()
  await drag(sourceCard,'right',dense,'left')
  await page.getByRole('status').filter({hasText:'端口值种类不匹配'}).waitFor()
  const person=page.locator('[data-card-id="person"]'), photo=page.locator('[data-card-id="photo"]')
  await drag(person,'left',photo,'right')
  const menu=page.getByRole('menu',{name:'选择连接用途',exact:true})
  await menu.waitFor()
  assert.equal((await read()).document.edges.length,2,'pending purpose is not yet a candidate edge')
  await page.getByLabel('正在连接候选',{exact:true}).waitFor()
  await page.screenshot({path:join(output,'ports-purpose-menu.png'),animations:'disabled'})
  await page.keyboard.press('Escape')
  assert.equal(await menu.isVisible(),false)
  assert.equal((await read()).document.edges.length,2)
  await drag(person,'left',photo,'right')
  await menu.getByRole('menuitem').filter({hasText:'焦点对象'}).click()
  await savedEdges(3)
  assert.equal((await read()).document.cards.find(card=>card.id==='photo').input_bindings.length,0)
  await drag(page.locator('[data-card-id="image"]'),'right',photo,'left')
  await savedEdges(4)
  assert.equal((await read()).document.edges.find(edge=>edge.source_card==='image').target_port,'image_example')
  assert.equal((await read()).document.cards.find(card=>card.id==='photo').examples.length,0,'material link is still only a candidate')
  await drag(sourceCard,'right',page.locator('[data-card-id="unknown"]'),'left')
  await page.getByRole('status').filter({hasText:'模型能力尚未核实'}).waitFor()
  // Cancel a free drag without changing content, layout or relationships.
  const from=await side('source','right').boundingBox()
  await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();await page.mouse.move(1000,850,{steps:3});await page.mouse.up()
  assert.equal(await page.getByLabel('正在连接候选',{exact:true}).count(),0)
  assert.equal((await read()).document.edges.length,4)
  await page.screenshot({path:join(output,'ports-desktop.png'),animations:'disabled'})
  const initialPath=await page.locator('.generation-edge-adopted .canvas-edge-line').getAttribute('d')
  await modelCard.getByRole('button',{name:/移动布局/}).press('ArrowRight')
  const movedPath=await page.locator('.generation-edge-adopted .canvas-edge-line').getAttribute('d')
  assert.notEqual(movedPath,initialPath)
  await page.reload()
  await page.locator('.generation-edge-adopted .canvas-edge-line').waitFor({state:'attached'})
  assert.equal(await page.locator('.generation-edge-adopted .canvas-edge-line').getAttribute('d'),movedPath,'selected right/left sides and moved layout survive refresh')
  const persistedPath=movedPath.match(/M ([\d.-]+) ([\d.-]+)/)
  assert.ok(persistedPath)
  await page.setViewportSize({width:390,height:844})
  await page.getByRole('button',{name:'适应全部',exact:true}).click()
  assert.equal(await page.locator('[data-card-id="dense"] [data-connection-side]').count(),2)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await page.screenshot({path:join(output,'ports-mobile.png'),animations:'disabled'})
  console.log('edge ports expose candidate and adoption separately')
} finally { await cleanup() }
